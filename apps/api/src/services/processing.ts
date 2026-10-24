import type pg from 'pg';
import {
  evaluateApplication,
  routeDecision,
  type EngineApplication,
  type EngineDocument,
  type EngineResult,
} from '@onboardiq/rules-engine';
import { pool, tx, type Db } from '../db/pool';
import { audit, SYSTEM_ACTOR } from './audit';
import { getReferenceData, getRulesConfig, getSettings } from './config';
import { openAccount } from './coreBanking';
import { getProvider, type ExtractionResult } from './extraction';
import { readStoredText } from './storage';
import { lockApplication, transition, type Actor } from './workflow';

export interface EffectiveField {
  value: string | null;
  confidence: number;
  source: 'EXTRACTION' | 'OFFICER';
  corrected?: boolean;
  span?: [number, number] | null;
  notes?: string[];
  original?: { value: string | null; confidence: number } | null;
}

export interface EffectiveDocument {
  doc_id: string;
  file_name: string;
  declared_doc_type: string;
  file_key: string;
  source_ref: string | null;
  uploaded_at: string;
  extraction: {
    id: number;
    provider: string;
    status: string;
    doc_type: string;
    doc_type_confidence: number;
    doc_type_source: 'EXTRACTION' | 'OFFICER';
    extractor_version: string | null;
    classification: unknown;
    error: string | null;
    created_at: string;
  } | null;
  fields: Record<string, EffectiveField>;
}

/** Active documents with their current extraction, overlaid with officer corrections (confidence 1.00, source OFFICER). */
export async function effectiveDocuments(appId: string, db: Db = pool): Promise<EffectiveDocument[]> {
  const docs = await db.query(
    `SELECT d.doc_id, d.file_name, d.declared_doc_type, d.file_key, d.source_ref, d.uploaded_at,
            e.id AS ext_id, e.provider, e.status, e.doc_type, e.doc_type_confidence, e.fields, e.extractor_version,
            e.classification, e.error, e.created_at AS ext_at
       FROM documents d
       LEFT JOIN extractions e ON e.doc_id = d.doc_id AND e.is_current
      WHERE d.application_id = $1 AND d.active
      ORDER BY d.doc_id`,
    [appId],
  );
  const corr = await db.query(
    `SELECT DISTINCT ON (doc_id, field_name) doc_id, field_name, new_value, old_value, old_confidence
       FROM field_corrections WHERE application_id = $1 ORDER BY doc_id, field_name, id DESC`,
    [appId],
  );
  const byDoc = new Map<string, any[]>();
  for (const c of corr.rows) byDoc.set(c.doc_id, [...(byDoc.get(c.doc_id) ?? []), c]);
  return docs.rows.map((d) => {
    const fields: Record<string, EffectiveField> = {};
    for (const [k, v] of Object.entries((d.fields ?? {}) as Record<string, any>)) {
      fields[k] = { value: v.value, confidence: Number(v.confidence), source: 'EXTRACTION', corrected: v.corrected, span: v.span ?? null, notes: v.notes ?? [] };
    }
    let docType = d.doc_type ?? 'OTHER';
    let docTypeConf = d.doc_type_confidence === null || d.doc_type_confidence === undefined ? 0 : Number(d.doc_type_confidence);
    let docTypeSource: 'EXTRACTION' | 'OFFICER' = 'EXTRACTION';
    for (const c of byDoc.get(d.doc_id) ?? []) {
      if (c.field_name === 'doc_type') {
        docType = c.new_value;
        docTypeConf = 1;
        docTypeSource = 'OFFICER';
      } else {
        const orig = fields[c.field_name];
        fields[c.field_name] = {
          value: c.new_value,
          confidence: 1,
          source: 'OFFICER',
          original: orig ? { value: orig.original?.value ?? orig.value, confidence: orig.original?.confidence ?? orig.confidence } : null,
        };
      }
    }
    return {
      doc_id: d.doc_id,
      file_name: d.file_name,
      declared_doc_type: d.declared_doc_type,
      file_key: d.file_key,
      source_ref: d.source_ref,
      uploaded_at: d.uploaded_at,
      extraction: d.ext_id
        ? {
            id: d.ext_id,
            provider: d.provider,
            status: d.status,
            doc_type: docType,
            doc_type_confidence: docTypeConf,
            doc_type_source: docTypeSource,
            extractor_version: d.extractor_version,
            classification: d.classification,
            error: d.error,
            created_at: d.ext_at,
          }
        : null,
      fields,
    };
  });
}

export function toEngineApp(app: any): EngineApplication {
  return {
    application_id: app.application_id,
    application_date: app.application_date,
    full_name: app.full_name,
    dob: app.dob,
    gender: app.gender,
    pan_number: app.pan_number,
    aadhaar_last4: String(app.aadhaar_last4).trim(),
    pincode: app.pincode,
    occupation_code: app.occupation_code,
    annual_income: Number(app.annual_income),
  };
}

export function toEngineDocs(docs: EffectiveDocument[]): EngineDocument[] {
  return docs.map((d) => ({
    doc_id: d.doc_id,
    declared_doc_type: d.declared_doc_type,
    doc_type: d.extraction?.doc_type ?? 'OTHER',
    doc_type_confidence: d.extraction?.doc_type_confidence ?? 0,
    fields: Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, { value: v.value, confidence: v.confidence, source: v.source }])),
  }));
}

/** Evaluate R1-R17 on the current data and persist the result (decision history + application summary). */
export async function evaluateAndStore(
  c: pg.PoolClient,
  app: any,
  trigger: string,
  actor: Actor,
): Promise<EngineResult> {
  const cfg = await getRulesConfig(c);
  const ref = await getReferenceData(c, app.application_id);
  const settings = await getSettings(c);
  const docs = await effectiveDocuments(app.application_id, c);
  const result = evaluateApplication(toEngineApp(app), toEngineDocs(docs), cfg, ref);
  await c.query(
    `INSERT INTO decisions (application_id, trigger, decision, reason_codes, name_match_score, risk_category, rekyc_due_date, engine_result, provider, config_version, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [app.application_id, trigger, result.decision, result.reason_codes, result.name_match_score, result.risk_category,
     result.rekyc_due_date, JSON.stringify(result), settings.extraction_provider, `${cfg.version}#${cfg._id}`, actor.actor_id ?? null],
  );
  await c.query(
    `UPDATE applications SET decision = $2, reason_codes = $3, name_match_score = $4, risk_category = $5, rekyc_due_date = $6,
       engine_result = $7, initial_decision = COALESCE(initial_decision, $2), initial_reason_codes = COALESCE(initial_reason_codes, $3),
       updated_at = now()
     WHERE application_id = $1`,
    [app.application_id, result.decision, result.reason_codes, result.name_match_score, result.risk_category, result.rekyc_due_date, JSON.stringify(result)],
  );
  await audit(
    {
      application_id: app.application_id,
      event_type: 'RULES_EVALUATED',
      ...actor,
      details: {
        trigger,
        decision: result.decision,
        reason_codes: result.reason_codes,
        name_match_score: result.name_match_score,
        risk_category: result.risk_category,
        rekyc_due_date: result.rekyc_due_date,
        config_version: `${cfg.version}#${cfg._id}`,
      },
    },
    c,
  );
  for (const s of [result.sanctions, result.pep]) {
    if (s.best) {
      await audit(
        {
          application_id: app.application_id,
          event_type: 'WATCHLIST_HIT',
          ...actor,
          details: {
            list: s.best.list_type,
            result: s.result,
            entry_id: s.best.entry_id,
            entry_name: s.best.entry_name,
            matched_on: s.best.matched_on,
            similarity: Number(s.best.similarity.toFixed(4)),
            entry_dob: s.best.entry_dob,
            declared_dob: s.best.declared_dob,
            dob_comparison: s.best.dob_comparison,
          },
        },
        c,
      );
    }
  }
  Object.assign(app, { decision: result.decision, reason_codes: result.reason_codes, risk_category: result.risk_category });
  return result;
}

/** Extract one document with the given provider and store it as the current extraction. */
export async function extractAndStore(
  db: Db,
  doc: { doc_id: string; source_ref: string | null; file_key: string; application_id: string },
  providerName: 'mock' | 'ai',
  actor: Actor = SYSTEM_ACTOR,
): Promise<ExtractionResult> {
  let text = '';
  try {
    text = await readStoredText(doc.file_key);
  } catch {
    text = '';
  }
  const provider = getProvider(providerName, db);
  const r = await provider.extract({ doc_id: doc.doc_id, source_ref: doc.source_ref, text });
  await db.query('UPDATE extractions SET is_current = FALSE WHERE doc_id = $1 AND is_current', [doc.doc_id]);
  await db.query(
    `INSERT INTO extractions (doc_id, provider, status, doc_type, doc_type_confidence, fields, extractor_version, classification, error, elapsed_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [doc.doc_id, r.provider, r.status, r.doc_type, r.doc_type_confidence, JSON.stringify(r.fields), r.extractor_version,
     r.classification ? JSON.stringify(r.classification) : null, r.error ?? null, Math.round(r.elapsed_ms)],
  );
  await audit(
    {
      application_id: doc.application_id,
      doc_id: doc.doc_id,
      event_type: r.status === 'OK' ? 'EXTRACTION_COMPLETED' : 'EXTRACTION_FAILED',
      ...actor,
      details: {
        provider: r.provider,
        status: r.status,
        doc_type: r.doc_type,
        doc_type_confidence: r.doc_type_confidence,
        fields: Object.keys(r.fields),
        extractor_version: r.extractor_version,
        error: r.error,
        elapsed_ms: Math.round(r.elapsed_ms),
        prompt_injection: (r.classification as any)?.prompt_injection ?? false,
      },
    },
    db,
  );
  return r;
}

async function openAccountFor(c: pg.PoolClient, app: any, actor: Actor) {
  const acct = await openAccount({ application_id: app.application_id, full_name: app.full_name, pan_number: app.pan_number, dob: app.dob }, c);
  await c.query('UPDATE applications SET customer_id = $2, account_number = $3 WHERE application_id = $1', [app.application_id, acct.customer_id, acct.account_number]);
  await c.query(
    `INSERT INTO existing_customers (customer_id, full_name, pan_number, dob, source, application_id, account_number)
     VALUES ($1,$2,$3,$4,'ONBOARDIQ',$5,$6) ON CONFLICT (customer_id) DO NOTHING`,
    [acct.customer_id, app.full_name, app.pan_number, app.dob, app.application_id, acct.account_number],
  );
  await audit(
    { application_id: app.application_id, event_type: 'ACCOUNT_OPENED', ...actor, details: { customer_id: acct.customer_id, account_number: acct.account_number } },
    c,
  );
  return acct;
}
export { openAccountFor };

/**
 * Pipeline after submission / resubmission:
 *   SUBMITTED -> EXTRACTING -> extraction per document -> R1..R17 -> AUTO_APPROVED | PENDING_CHECKER | IN_REVIEW | AUTO_REJECTED
 */
export async function processApplication(appId: string, opts: { providerOverride?: 'mock' | 'ai' } = {}): Promise<void> {
  const actor = SYSTEM_ACTOR;
  const settings = await getSettings();
  const providerName = opts.providerOverride ?? settings.extraction_provider;

  const started = await tx(async (c) => {
    const app = await lockApplication(c, appId);
    if (app.status !== 'SUBMITTED' && app.status !== 'EXTRACTING') return false;
    if (app.status === 'SUBMITTED') await transition(c, app, 'EXTRACTING', actor, { provider: providerName });
    await c.query('UPDATE applications SET extraction_provider = $2 WHERE application_id = $1', [appId, providerName]);
    return true;
  });
  if (!started) return;

  // Extraction outside the row lock (the AI provider may take up to 10 s per document).
  const docs = await pool.query(
    `SELECT d.doc_id, d.source_ref, d.file_key, d.application_id FROM documents d
      WHERE d.application_id = $1 AND d.active
        AND NOT EXISTS (SELECT 1 FROM extractions e WHERE e.doc_id = d.doc_id AND e.is_current)
      ORDER BY d.doc_id`,
    [appId],
  );
  for (const d of docs.rows) await extractAndStore(pool, d, providerName, actor);

  await tx(async (c) => {
    const app = await lockApplication(c, appId);
    if (app.status !== 'EXTRACTING') return;
    const result = await evaluateAndStore(c, app, app.resubmission_count > 0 ? 'RESUBMISSION' : 'SUBMISSION', actor);
    let next = routeDecision(result);
    // A previously reviewed case that comes back after resubmission is not auto-approved: it returns to the
    // officer queue so that maker-checker applies (assumption, see design document).
    if (app.reviewed && next !== 'AUTO_REJECTED') next = 'IN_REVIEW';
    await transition(c, app, next, actor, { decision: result.decision, reason_codes: result.reason_codes, risk_category: result.risk_category });
    if (next === 'IN_REVIEW') await c.query('UPDATE applications SET reviewed = TRUE WHERE application_id = $1', [appId]);
    if (next === 'AUTO_APPROVED') await openAccountFor(c, app, actor);
  });
}

/** Re-run rules on open cases (e.g. after a watchlist update) without changing their status. */
export async function rescreenOpenCases(actor: Actor): Promise<{ application_id: string; before: string[]; after: string[] }[]> {
  const ids = (
    await pool.query("SELECT application_id FROM applications WHERE status IN ('IN_REVIEW','PENDING_CHECKER','RESUBMISSION_REQUESTED') ORDER BY application_id")
  ).rows.map((r) => r.application_id);
  const out: { application_id: string; before: string[]; after: string[] }[] = [];
  for (const id of ids) {
    await tx(async (c) => {
      const app = await lockApplication(c, id);
      if (!['IN_REVIEW', 'PENDING_CHECKER', 'RESUBMISSION_REQUESTED'].includes(app.status)) return;
      const before = app.reason_codes ?? [];
      const r = await evaluateAndStore(c, app, 'RESCREEN', actor);
      if (JSON.stringify(before) !== JSON.stringify(r.reason_codes)) out.push({ application_id: id, before, after: r.reason_codes });
    });
  }
  return out;
}

/** Recover applications left in SUBMITTED / EXTRACTING (e.g. after a restart). */
export async function recoverStuck(): Promise<number> {
  const r = await pool.query("SELECT application_id FROM applications WHERE status IN ('SUBMITTED','EXTRACTING') ORDER BY submitted_at");
  for (const row of r.rows) {
    await processApplication(row.application_id).catch((e) => console.error('[recover]', row.application_id, e.message));
  }
  return r.rowCount ?? 0;
}

/** Fire-and-forget processing used by the HTTP handlers (in-process queue). */
const queue: string[] = [];
let running = false;
export function enqueueProcessing(appId: string) {
  queue.push(appId);
  if (running) return;
  running = true;
  setImmediate(async () => {
    while (queue.length) {
      const id = queue.shift()!;
      try {
        await processApplication(id);
      } catch (e: any) {
        console.error('[processing] failed', id, e?.message);
        await audit({ application_id: id, event_type: 'PROCESSING_ERROR', ...SYSTEM_ACTOR, details: { error: String(e?.message ?? e) } }).catch(() => undefined);
      }
    }
    running = false;
  });
}

export function queueIdle(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => (queue.length === 0 && !running ? resolve() : setTimeout(check, 25));
    check();
  });
}
