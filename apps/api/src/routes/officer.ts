import { Router } from 'express';
import { pool } from '../db/pool';
import { ah } from '../lib/http';
import { authenticate, requireRole } from '../middleware/auth';
import { listRow } from '../services/applications';
import { aiFeedback, dashboard } from '../services/dashboard';

export const officerRouter = Router();
officerRouter.use(authenticate);

const RISK_ORDER = `CASE risk_category WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 WHEN 'LOW' THEN 2 ELSE 3 END`;

/** FR-6: REVIEW queue ordered by risk (HIGH first) then submission time. */
officerRouter.get(
  '/review/queue',
  requireRole('KYC_OFFICER'),
  ah(async (_req, res) => {
    const r = await pool.query(`SELECT * FROM applications WHERE status = 'IN_REVIEW' ORDER BY ${RISK_ORDER}, submitted_at, application_id`);
    res.json({ items: r.rows.map(listRow) });
  }),
);

/** Checker queue: PENDING_CHECKER, HIGH risk first then oldest. */
officerRouter.get(
  '/checker/queue',
  requireRole('COMPLIANCE_OFFICER'),
  ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM applications WHERE status = 'PENDING_CHECKER' ORDER BY ${RISK_ORDER}, pending_checker_since, application_id`);
    res.json({ items: r.rows.map((a) => ({ ...listRow(a), you_are_maker: a.maker_user_id === req.user!.id })) });
  }),
);

officerRouter.get(
  '/dashboard',
  requireRole('COMPLIANCE_OFFICER'),
  ah(async (req, res) => {
    const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : undefined;
    res.json(await dashboard(from, to));
  }),
);

officerRouter.get(
  '/dashboard/ai-feedback',
  requireRole('COMPLIANCE_OFFICER'),
  ah(async (_req, res) => res.json(await aiFeedback())),
);

/** Global audit trail (latest events first). */
officerRouter.get(
  '/audit',
  requireRole('COMPLIANCE_OFFICER'),
  ah(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const r = await pool.query(
      `SELECT * FROM audit_log
        WHERE ($1::text IS NULL OR application_id = $1) AND ($2::text IS NULL OR event_type = $2)
        ORDER BY id DESC LIMIT $3`,
      [req.query.application_id || null, req.query.event_type || null, limit],
    );
    res.json({ items: r.rows });
  }),
);
