import { FINAL_STATUSES, STATUSES } from '@onboardiq/shared';
import { pool } from '../db/pool';
import { getRulesConfig } from './config';

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

/** FR-10 dashboard figures, all computed from the underlying tables so they reconcile. */
export async function dashboard(from?: string, to?: string) {
  const f = from || '1900-01-01';
  const t = to || '2999-12-31';
  const cfg = await getRulesConfig();
  const where = 'application_date BETWEEN $1 AND $2';

  const [byStatus, initial, reasons, review, pending, trend, risk] = await Promise.all([
    pool.query(`SELECT status, count(*)::int AS n FROM applications WHERE ${where} GROUP BY status`, [f, t]),
    pool.query(`SELECT initial_decision AS d, count(*)::int AS n FROM applications WHERE ${where} AND initial_decision IS NOT NULL GROUP BY initial_decision`, [f, t]),
    pool.query(
      `SELECT code, count(*)::int AS n FROM applications, unnest(initial_reason_codes) AS code
        WHERE ${where} GROUP BY code ORDER BY n DESC, code LIMIT 5`,
      [f, t],
    ),
    pool.query(
      `WITH s AS (
         SELECT l.application_id, l.created_at, l.details->>'to' AS to_status, l.details->>'from' AS from_status
           FROM audit_log l JOIN applications a ON a.application_id = l.application_id
          WHERE l.event_type = 'STATUS_CHANGED' AND a.${where}
       ), e AS (
         SELECT s.application_id, s.created_at AS entered,
                (SELECT min(s2.created_at) FROM s s2 WHERE s2.application_id = s.application_id AND s2.from_status = 'IN_REVIEW' AND s2.created_at > s.created_at) AS left_at
           FROM s WHERE s.to_status = 'IN_REVIEW'
       )
       SELECT avg(extract(epoch FROM (left_at - entered))) FILTER (WHERE left_at IS NOT NULL) AS avg_seconds,
              count(*) FILTER (WHERE left_at IS NOT NULL)::int AS completed,
              count(*) FILTER (WHERE left_at IS NULL)::int AS open
         FROM e`,
      [f, t],
    ),
    pool.query(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE pending_checker_since < now() - ($3 || ' hours')::interval)::int AS overdue,
              min(pending_checker_since) AS oldest
         FROM applications WHERE status = 'PENDING_CHECKER' AND ${where}`,
      [f, t, String(cfg.checker_sla_hours)],
    ),
    pool.query(
      `SELECT application_date::text AS day, count(*)::int AS submitted,
              count(*) FILTER (WHERE status = 'AUTO_APPROVED')::int AS auto_approved,
              count(*) FILTER (WHERE initial_decision = 'REVIEW')::int AS review,
              count(*) FILTER (WHERE initial_decision = 'REJECT')::int AS reject
         FROM applications WHERE ${where} GROUP BY application_date ORDER BY application_date`,
      [f, t],
    ),
    pool.query(`SELECT COALESCE(risk_category, 'N/A') AS risk, count(*)::int AS n FROM applications WHERE ${where} GROUP BY 1`, [f, t]),
  ]);

  const statusCounts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<string, number>;
  for (const r of byStatus.rows) statusCounts[r.status] = r.n;
  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const decided = FINAL_STATUSES.reduce((a, s) => a + statusCounts[s], 0);
  const init = Object.fromEntries(initial.rows.map((r) => [r.d, r.n])) as Record<string, number>;
  const evaluated = (init.APPROVE ?? 0) + (init.REVIEW ?? 0) + (init.REJECT ?? 0);
  const rv = review.rows[0];

  return {
    filter: { from: from ?? null, to: to ?? null },
    total_applications: total,
    by_status: statusCounts,
    decided,
    straight_through: {
      auto_approved: statusCounts.AUTO_APPROVED,
      decided,
      rate: ratio(statusCounts.AUTO_APPROVED, decided),
      definition: 'AUTO_APPROVED / applications in a final status (AUTO_APPROVED, APPROVED, REJECTED, AUTO_REJECTED, CLOSED_EXPIRED)',
    },
    rules_outcome: {
      evaluated,
      approve: init.APPROVE ?? 0,
      review: init.REVIEW ?? 0,
      reject: init.REJECT ?? 0,
      review_rate: ratio(init.REVIEW ?? 0, evaluated),
      reject_rate: ratio(init.REJECT ?? 0, evaluated),
      definition: 'First rules evaluation of each application',
    },
    top_reason_codes: reasons.rows,
    review_time: {
      average_hours: rv.avg_seconds === null ? null : Number(rv.avg_seconds) / 3600,
      completed_reviews: rv.completed,
      open_reviews: rv.open,
    },
    pending_checker: {
      count: pending.rows[0].n,
      overdue: pending.rows[0].overdue,
      oldest: pending.rows[0].oldest,
      sla_hours: cfg.checker_sla_hours,
    },
    risk_mix: risk.rows,
    trend: trend.rows,
  };
}

/** AI-4: officer corrections as labelled feedback and the officer correction rate. */
export async function aiFeedback() {
  const [fieldsTotal, corr, byField, recent] = await Promise.all([
    pool.query(`SELECT e.provider, count(*)::int AS docs, COALESCE(sum((SELECT count(*) FROM jsonb_object_keys(e.fields))), 0)::int AS fields
                  FROM extractions e WHERE e.is_current GROUP BY e.provider`),
    pool.query(`SELECT provider, count(*)::int AS n FROM extraction_feedback GROUP BY provider`),
    pool.query(`SELECT field_name, count(*)::int AS n FROM extraction_feedback GROUP BY field_name ORDER BY n DESC`),
    pool.query(`SELECT f.doc_id, f.field_name, f.extracted_value, f.extracted_confidence, f.corrected_value, f.provider, f.extractor_version, f.created_at
                  FROM extraction_feedback f ORDER BY f.id DESC LIMIT 20`),
  ]);
  const totals = Object.fromEntries(fieldsTotal.rows.map((r) => [r.provider, r]));
  const corrections = Object.fromEntries(corr.rows.map((r) => [r.provider ?? 'unknown', r.n]));
  const providers = [...new Set([...Object.keys(totals), ...Object.keys(corrections)])];
  return {
    by_provider: providers.map((p) => ({
      provider: p,
      documents: totals[p]?.docs ?? 0,
      extracted_fields: totals[p]?.fields ?? 0,
      corrections: corrections[p] ?? 0,
      correction_rate: ratio(corrections[p] ?? 0, totals[p]?.fields ?? 0),
    })),
    by_field: byField.rows,
    recent: recent.rows,
  };
}
