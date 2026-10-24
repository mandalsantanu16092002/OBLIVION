import { DOC_TYPES, isValidIsoDate } from '@onboardiq/shared';
import type { EngineResult } from '@onboardiq/rules-engine';
import { pool, tx } from '../db/pool';
import { forbidden, notFound, unprocessable } from '../lib/http';
import type { AuthUser } from '../middleware/auth';
import { audit, SYSTEM_ACTOR } from './audit';
import { getRulesConfig } from './config';
import { effectiveDocuments, evaluateAndStore, openAccountFor } from './processing';
import { lockApplication, transition, type Actor } from './workflow';

/** Validate / normalise an officer-entered value. */
export function normaliseCorrection(field: string, raw: string): string {
  const v = raw.trim();
  const bad = (m: string) => unprocessable('Invalid value', { new_value: m });
  switch (field) {
    case 'dob':
    case 'document_date':
    case 'valid_until':
      if (!isValidIsoDate(v)) throw bad('Enter a date as YYYY-MM-DD');
      return v;
    case 'pan_number':
      if (!/^[A-Za-z0-9]{10}$/.test(v)) throw bad('PAN must be 10 letters/digits');
      return v.toUpperCase();
    case 'aadhaar_last4':
      if (/^\d{12}$/.test(v.replace(/\s/g, ''))) throw bad('Only the last 4 Aadhaar digits may be entered');
      if (!/^\d{4}$/.test(v)) throw bad('Aadhaar last 4 must be exactly 4 digits');
      return v;
    case 'pincode':
      if (!/^[1-9][0-9]{5}$/.test(v)) throw bad('Pincode must be 6 digits');
      return v;
    case 'gender':
      if (!/^[MF]$/i.test(v)) throw bad('Gender must be M or F');
      return v.toUpperCase();
    case 'doc_type':
      if (!DOC_TYPES.includes(v.toUpperCase() as never)) throw bad(`Document type must be one of ${DOC_TYPES.join(', ')}`);
      return v.toUpperCase();
    default:
      return v.replace(/\s+/g, ' ');
  }
}

/** FR-6: officer correction (confidence 1.00, source OFFICER), audited before/after, rules re-run; status stays IN_REVIEW. */
export async function correctField(
  user: AuthUser,
  actor: Actor,
  appId: string,
  body: { doc_id: string; field_name: string; new_value: string; reason: string; expected_version?: number },
) {
  const value = normaliseCorrection(body.field_name, body.new_value);
  return tx(async (c) => {
    const app = await lockApplication(c, appId, { allowed: ['IN_REVIEW'], expectedVersion: body.expected_version });
    const docs = await effectiveDocuments(appId, c);
    const doc = docs.find((d) => d.doc_id === body.doc_id);
    if (!doc) throw notFound('Document not found on this application');
    const before =
      body.field_name === 'doc_type'
        ? { value: doc.extraction?.doc_type ?? null, confidence: doc.extraction?.doc_type_confidence ?? 0, source: doc.extraction?.doc_type_source ?? 'EXTRACTION' }
        : { value: doc.fields[body.field_name]?.value ?? null, confidence: doc.fields[body.field_name]?.confidence ?? null, source: doc.fields[body.field_name]?.source ?? null };
    await c.query(
      `INSERT INTO field_corrections (application_id, doc_id, field_name, old_value, old_confidence, new_value, reason, provider, extractor_version, officer_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [appId, body.doc_id, body.field_name, before.value, before.confidence, value, body.reason, doc.extraction?.provider ?? null,
       doc.extraction?.extractor_version ?? null, user.id],
    );
    await audit(
      {
        application_id: appId,
        doc_id: body.doc_id,
        event_type: 'FIELD_CORRECTED',
        ...actor,
        details: { field: body.field_name, before, after: { value, confidence: 1, source: 'OFFICER' }, reason: body.reason },
      },
      c,
    );
    const result = await evaluateAndStore(c, app, 'CORRECTION', actor);
    await c.query('UPDATE applications SET version = version + 1 WHERE application_id = $1', [appId]);
    return { result, version: app.version + 1 };
  });
}

function hasSanctionsMatch(app: any) {
  return (app.reason_codes ?? []).includes('SANCTIONS_MATCH');
}

/** Maker recommendation (KYC Officer). */
export async function recommend(
  user: AuthUser,
  actor: Actor,
  appId: string,
  body: { recommendation: 'APPROVE' | 'REJECT' | 'REQUEST_RESUBMISSION'; comment: string; expected_version?: number },
) {
  return tx(async (c) => {
    const app = await lockApplication(c, appId, { allowed: ['IN_REVIEW'], expectedVersion: body.expected_version });
    if (body.recommendation === 'APPROVE' && hasSanctionsMatch(app)) {
      throw unprocessable('A sanctions MATCH cannot be recommended for approval', { recommendation: 'Sanctions MATCH: approval is prohibited' });
    }
    await c.query(
      `UPDATE applications SET maker_user_id = $2, maker_recommendation = $3, maker_comment = $4, maker_at = now(), reviewed = TRUE,
         checker_user_id = NULL, checker_decision = NULL, checker_comment = NULL, checker_at = NULL WHERE application_id = $1`,
      [appId, user.id, body.recommendation, body.comment],
    );
    await c.query("INSERT INTO case_actions (application_id, actor_id, actor_role, action, value, comment) VALUES ($1,$2,'KYC_OFFICER','RECOMMENDATION',$3,$4)", [
      appId,
      user.id,
      body.recommendation,
      body.comment,
    ]);
    await audit({ application_id: appId, event_type: 'RECOMMENDATION_RECORDED', ...actor, details: { recommendation: body.recommendation, comment: body.comment } }, c);
    if (body.recommendation === 'REQUEST_RESUBMISSION') {
      const cfg = await getRulesConfig(c);
      await c.query(
        `UPDATE applications SET resubmission_requested_at = now(), resubmission_due_at = now() + ($2 || ' days')::interval WHERE application_id = $1`,
        [appId, String(cfg.resubmission_sla_days)],
      );
      await transition(c, app, 'RESUBMISSION_REQUESTED', actor, { comment: body.comment, due_in_days: cfg.resubmission_sla_days });
      await c.query('INSERT INTO notifications (application_id, user_id, message) VALUES ($1,$2,$3)', [
        appId,
        app.applicant_user_id,
        `Please upload new documents for ${appId} within ${cfg.resubmission_sla_days} days. Officer note: ${body.comment}`,
      ]);
    } else {
      await transition(c, app, 'PENDING_CHECKER', actor, { recommendation: body.recommendation });
    }
    return { status: app.status };
  });
}

/** Checker decision (Compliance Officer). Maker and checker must be different users (HTTP 403). */
export async function checkerDecide(
  user: AuthUser,
  actor: Actor,
  appId: string,
  body: { decision: 'APPROVE' | 'REJECT' | 'SEND_BACK'; comment: string; expected_version?: number },
) {
  try {
    return await tx(async (c) => {
      const app = await lockApplication(c, appId, { allowed: ['PENDING_CHECKER'], expectedVersion: body.expected_version });
      if (app.maker_user_id && app.maker_user_id === user.id) {
        throw Object.assign(forbidden('Maker and checker must be different users: you made the recommendation on this case.'), { makerChecker: true });
      }
      if (body.decision === 'APPROVE' && hasSanctionsMatch(app)) {
        throw unprocessable('A sanctions MATCH cannot be approved', { decision: 'Sanctions MATCH: approval is prohibited' });
      }
      await c.query("INSERT INTO case_actions (application_id, actor_id, actor_role, action, value, comment) VALUES ($1,$2,'COMPLIANCE_OFFICER','CHECKER_DECISION',$3,$4)", [
        appId,
        user.id,
        body.decision,
        body.comment,
      ]);
      await audit({ application_id: appId, event_type: 'CHECKER_DECISION', ...actor, details: { decision: body.decision, comment: body.comment, maker_user_id: app.maker_user_id } }, c);
      let account = null;
      if (body.decision === 'SEND_BACK') {
        await c.query(
          `UPDATE applications SET maker_user_id = NULL, maker_recommendation = NULL, maker_comment = NULL, maker_at = NULL, reviewed = TRUE
            WHERE application_id = $1`,
          [appId],
        );
        await transition(c, app, 'IN_REVIEW', actor, { sent_back_by: user.id, comment: body.comment });
      } else {
        await c.query('UPDATE applications SET checker_user_id = $2, checker_decision = $3, checker_comment = $4, checker_at = now() WHERE application_id = $1', [
          appId,
          user.id,
          body.decision,
          body.comment,
        ]);
        if (body.decision === 'APPROVE') {
          await transition(c, app, 'APPROVED', actor, { checker: user.id });
          account = await openAccountFor(c, app, actor);
        } else {
          await transition(c, app, 'REJECTED', actor, { checker: user.id });
        }
      }
      return { status: app.status, account };
    });
  } catch (e: any) {
    if (e?.makerChecker) {
      // recorded outside the rolled-back transaction
      await audit({ application_id: appId, event_type: 'MAKER_CHECKER_VIOLATION', ...actor, details: { attempted: body.decision } });
    }
    throw e;
  }
}

/** Close RESUBMISSION_REQUESTED applications whose 7-day window has passed. */
export async function closeExpired(): Promise<string[]> {
  const r = await pool.query("SELECT application_id FROM applications WHERE status = 'RESUBMISSION_REQUESTED' AND resubmission_due_at < now()");
  const closed: string[] = [];
  for (const { application_id } of r.rows) {
    await tx(async (c) => {
      const app = await lockApplication(c, application_id);
      if (app.status !== 'RESUBMISSION_REQUESTED' || new Date(app.resubmission_due_at).getTime() >= Date.now()) return;
      await transition(c, app, 'CLOSED_EXPIRED', SYSTEM_ACTOR, { reason: 'No resubmission within the window' });
      closed.push(application_id);
    });
  }
  return closed;
}

export type { EngineResult };
