import type pg from 'pg';
import {
  applicantReason,
  maskPan,
  REASON_CODE_MAP,
  SENSITIVE_REASON_CODES,
  STATUS_LABELS,
  type ApplicationInput,
} from '@onboardiq/shared';
import { round4 } from '@onboardiq/rules-engine';
import { pool, type Db } from '../db/pool';
import { conflict, forbidden, HttpError, notFound, unprocessable } from '../lib/http';
import type { AuthUser } from '../middleware/auth';
import { audit } from './audit';
import { effectiveDocuments } from './processing';
import { sha256, storeFile } from './storage';
import { sourceRefFromName, type ValidFile } from './uploads';
import type { Actor } from './workflow';

export async function nextApplicationId(c: Db) {
  const n = Number((await c.query("SELECT nextval('application_seq') AS n")).rows[0].n);
  return `A${3000000 + n}`;
}
export async function nextDocId(c: Db) {
  const n = Number((await c.query("SELECT nextval('document_seq') AS n")).rows[0].n);
  return `D${5000000 + n}`;
}

export interface InsertApplicationOptions {
  application_id?: string;
  application_date: string;
  applicant_user_id: number;
  source?: string;
  /** Minimum number of distinct documents (3 for the portal; the data-pack seed contains 2-document cases). */
  minFiles?: number;
}

/** Insert application + documents in one transaction (status SUBMITTED). */
export async function insertApplication(
  c: pg.PoolClient,
  input: ApplicationInput,
  files: (ValidFile & { doc_id?: string })[],
  opts: InsertApplicationOptions,
  actor: Actor,
) {
  // idempotency within one request: identical files (same SHA-256) are stored once
  const seen = new Map<string, ValidFile>();
  const duplicates: string[] = [];
  for (const f of files) {
    const h = sha256(f.buffer);
    if (seen.has(h)) duplicates.push(f.file_name);
    else seen.set(h, f);
  }
  if (seen.size < (opts.minFiles ?? 3)) {
    throw unprocessable('At least 3 different documents are required', {
      files: `Upload at least 3 different documents; ${duplicates.length} identical file(s) were ignored`,
    });
  }
  const application_id = opts.application_id ?? (await nextApplicationId(c));
  try {
    await c.query(
      `INSERT INTO applications (application_id, applicant_user_id, application_date, full_name, dob, gender, pan_number, aadhaar_last4,
         mobile, email, address, city, state, pincode, occupation_code, annual_income, kyc_consent, status, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,TRUE,'SUBMITTED',$17)`,
      [application_id, opts.applicant_user_id, opts.application_date, input.full_name, input.dob, input.gender, input.pan_number,
       input.aadhaar_last4, input.mobile, input.email, input.address, input.city, input.state, input.pincode, input.occupation_code,
       input.annual_income, opts.source ?? 'PORTAL'],
    );
  } catch (e: any) {
    if (e?.code === '23505' && String(e?.constraint).includes('pan_inflight')) {
      throw conflict('Another application with this PAN is already being processed. Duplicate applications are not allowed.');
    }
    throw e;
  }
  await audit({ application_id, event_type: 'APPLICATION_SUBMITTED', ...actor, details: {
    application_date: opts.application_date, documents: seen.size, kyc_consent: true, source: opts.source ?? 'PORTAL' } }, c);
  await audit({ application_id, event_type: 'STATUS_CHANGED', ...actor, details: { from: null, to: 'SUBMITTED' } }, c);
  const docs = [];
  for (const [hash, f] of seen) docs.push(await insertDocument(c, application_id, f, hash, opts.applicant_user_id, actor));
  for (const name of duplicates) {
    await audit({ application_id, event_type: 'DOCUMENT_DUPLICATE_IGNORED', ...actor, details: { file_name: name } }, c);
  }
  return { application_id, documents: docs, duplicates_ignored: duplicates };
}

export async function insertDocument(
  c: pg.PoolClient,
  application_id: string,
  f: ValidFile & { doc_id?: string },
  hash: string,
  uploaderId: number,
  actor: Actor,
) {
  const doc_id = f.doc_id ?? (await nextDocId(c));
  const file_key = await storeFile(f.buffer);
  const source_ref = f.doc_id ?? sourceRefFromName(f.file_name);
  await c.query(
    `INSERT INTO documents (doc_id, application_id, file_name, declared_doc_type, sha256, size_bytes, file_key, source_ref, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [doc_id, application_id, f.file_name, f.declared_doc_type, hash, f.buffer.length, file_key, source_ref, uploaderId],
  );
  await audit({ application_id, doc_id, event_type: 'DOCUMENT_UPLOADED', ...actor, details: {
    file_name: f.file_name, declared_doc_type: f.declared_doc_type, sha256: hash, size_bytes: f.buffer.length } }, c);
  return { doc_id, file_name: f.file_name, declared_doc_type: f.declared_doc_type, sha256: hash };
}

/** Load an application and enforce ownership for applicants (changing the ID in the URL never exposes other data). */
export async function loadAuthorizedApplication(id: string, user: AuthUser, db: Db = pool) {
  const r = await db.query('SELECT * FROM applications WHERE application_id = $1', [id]);
  const app = r.rows[0];
  const officer = user.roles.includes('KYC_OFFICER') || user.roles.includes('COMPLIANCE_OFFICER');
  // Same 404 for "missing" and "not yours" so IDs cannot be probed.
  if (!app || (!officer && app.applicant_user_id !== user.id)) throw notFound('Application not found');
  return { app, officer };
}

export async function statusTimeline(appId: string, db: Db = pool) {
  const r = await db.query(
    `SELECT details->>'to' AS status, created_at AS at FROM audit_log
      WHERE application_id = $1 AND event_type = 'STATUS_CHANGED' ORDER BY id`,
    [appId],
  );
  return r.rows.map((x) => ({ status: x.status, label: STATUS_LABELS[x.status as keyof typeof STATUS_LABELS] ?? x.status, at: x.at }));
}

/** Applicant view: no confidence scores, no watchlist details, plain-language reasons only. */
export async function applicantView(app: any, db: Db = pool) {
  const docs = await db.query(
    'SELECT doc_id, file_name, declared_doc_type, uploaded_at, active FROM documents WHERE application_id = $1 ORDER BY doc_id',
    [app.application_id],
  );
  const showReasons = ['IN_REVIEW', 'PENDING_CHECKER', 'RESUBMISSION_REQUESTED', 'AUTO_REJECTED', 'REJECTED', 'CLOSED_EXPIRED'].includes(app.status);
  const msgs = new Set<string>();
  if (showReasons) for (const c of app.reason_codes ?? []) msgs.add(applicantReason(c));
  if (app.status === 'REJECTED' && msgs.size === 0) msgs.add('Your application was not approved after review.');
  return {
    application_id: app.application_id,
    application_date: app.application_date,
    status: app.status,
    status_label: STATUS_LABELS[app.status as keyof typeof STATUS_LABELS],
    submitted_at: app.submitted_at,
    full_name: app.full_name,
    pan_masked: maskPan(app.pan_number),
    aadhaar_masked: `XXXX XXXX ${app.aadhaar_last4}`,
    reasons: [...msgs],
    resubmission: app.status === 'RESUBMISSION_REQUESTED'
      ? { requested_at: app.resubmission_requested_at, due_at: app.resubmission_due_at, officer_message: app.maker_comment }
      : null,
    account: app.customer_id ? { customer_id: app.customer_id, account_number: app.account_number } : null,
    rekyc_due_date: ['AUTO_APPROVED', 'APPROVED'].includes(app.status) ? app.rekyc_due_date : null,
    documents: docs.rows,
    timeline: await statusTimeline(app.application_id, db),
    version: app.version,
  };
}

/** Officer view: everything needed by the review workbench (documents, extracted fields, rule results, history). */
export async function officerView(app: any, db: Db = pool) {
  const [docs, decisions, actions, corrections, users] = await Promise.all([
    effectiveDocuments(app.application_id, db),
    db.query('SELECT id, trigger, decision, reason_codes, name_match_score, risk_category, rekyc_due_date, provider, config_version, created_at FROM decisions WHERE application_id = $1 ORDER BY id', [app.application_id]),
    db.query(`SELECT a.*, u.full_name AS actor_name, u.email AS actor_email FROM case_actions a JOIN users u ON u.id = a.actor_id WHERE application_id = $1 ORDER BY a.id`, [app.application_id]),
    db.query(`SELECT f.*, u.full_name AS officer_name FROM field_corrections f JOIN users u ON u.id = f.officer_id WHERE application_id = $1 ORDER BY f.id`, [app.application_id]),
    db.query('SELECT id, full_name, email FROM users WHERE id = ANY($1::int[])', [[app.maker_user_id, app.checker_user_id].filter(Boolean)]),
  ]);
  const u = Object.fromEntries(users.rows.map((r) => [r.id, r]));
  const engine = app.engine_result;
  return {
    application: {
      ...app,
      name_match_score_display: round4(app.name_match_score),
      status_label: STATUS_LABELS[app.status as keyof typeof STATUS_LABELS],
      maker: app.maker_user_id ? u[app.maker_user_id] ?? null : null,
      checker: app.checker_user_id ? u[app.checker_user_id] ?? null : null,
    },
    reasons: (app.reason_codes ?? []).map((c: string) => ({ ...REASON_CODE_MAP[c], code: c })),
    engine_result: engine,
    documents: docs,
    decisions: decisions.rows,
    actions: actions.rows,
    corrections: corrections.rows,
    timeline: await statusTimeline(app.application_id, db),
  };
}

/** Decision API response (Section 6.3). */
export async function decisionResponse(app: any, db: Db = pool) {
  const docs = await effectiveDocuments(app.application_id, db);
  return {
    application_id: app.application_id,
    decision: app.decision,
    reason_codes: app.reason_codes ?? [],
    name_match_score: app.name_match_score === null ? null : Number(round4(app.name_match_score)),
    risk_category: app.risk_category,
    rekyc_due_date: app.rekyc_due_date,
    status: app.status,
    documents: docs.map((d) => ({
      doc_id: d.doc_id,
      declared_doc_type: d.declared_doc_type,
      doc_type: d.extraction?.doc_type ?? null,
      confidence: d.extraction?.doc_type_confidence ?? null,
    })),
  };
}

export function assertOwner(app: any, user: AuthUser) {
  if (app.applicant_user_id !== user.id) throw forbidden('Only the applicant can do this');
}

export function assertResubmissionOpen(app: any) {
  if (app.status !== 'RESUBMISSION_REQUESTED') throw conflict(`Documents can only be changed when resubmission is requested (status ${app.status})`);
  if (app.resubmission_due_at && new Date(app.resubmission_due_at).getTime() < Date.now()) {
    throw new HttpError(409, 'RESUBMISSION_EXPIRED', 'The 7-day resubmission window has ended');
  }
}

export function listRow(a: any) {
  return {
    application_id: a.application_id,
    application_date: a.application_date,
    full_name: a.full_name,
    pan_masked: maskPan(a.pan_number),
    status: a.status,
    decision: a.decision,
    reason_codes: a.reason_codes,
    sensitive: (a.reason_codes ?? []).some((c: string) => SENSITIVE_REASON_CODES.includes(c)),
    name_match_score: a.name_match_score === null ? null : round4(a.name_match_score),
    risk_category: a.risk_category,
    submitted_at: a.submitted_at,
    in_review_since: a.in_review_since,
    pending_checker_since: a.pending_checker_since,
    maker_user_id: a.maker_user_id,
    maker_recommendation: a.maker_recommendation,
    version: a.version,
  };
}
