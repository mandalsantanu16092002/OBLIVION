import { Router } from 'express';
import {
  checkerDecisionSchema,
  fieldCorrectionSchema,
  makeApplicationSchema,
  recommendationSchema,
} from '@onboardiq/shared';
import { pool, tx } from '../db/pool';
import { ah, conflict, notFound, parseOr422, unprocessable } from '../lib/http';
import { authenticate, requireRole } from '../middleware/auth';
import { upload } from '../middleware/common';
import {
  applicantView,
  assertOwner,
  assertResubmissionOpen,
  decisionResponse,
  insertApplication,
  insertDocument,
  listRow,
  loadAuthorizedApplication,
  officerView,
} from '../services/applications';
import { actorFrom, audit } from '../services/audit';
import { checkerDecide, correctField, recommend } from '../services/cases';
import { businessDate, getRulesConfig, occupationCodes } from '../services/config';
import { enqueueProcessing } from '../services/processing';
import { sha256 } from '../services/storage';
import { reviewerSummary } from '../services/summary';
import { validateFiles } from '../services/uploads';
import { lockApplication, transition } from '../services/workflow';
import { maskPan, toCsvRow } from './util';

export const applicationsRouter = Router();
applicationsRouter.use(authenticate);

async function applicationSchema() {
  const [cfg, today, occ] = await Promise.all([getRulesConfig(), businessDate(), occupationCodes()]);
  return { schema: makeApplicationSchema({ panPattern: cfg.pan_pattern, today, occupationCodes: occ }), today };
}

/** Step 1 of the form: server-side validation only (HTTP 422 with field names). */
applicationsRouter.post(
  '/validate',
  requireRole('APPLICANT'),
  ah(async (req, res) => {
    const { schema } = await applicationSchema();
    const data = parseOr422(schema, req.body, 'Please correct the highlighted fields');
    const open = await pool.query(
      "SELECT 1 FROM applications WHERE pan_number = $1 AND status IN ('SUBMITTED','EXTRACTING','IN_REVIEW','RESUBMISSION_REQUESTED','PENDING_CHECKER')",
      [data.pan_number],
    );
    if (open.rowCount) throw conflict('Another application with this PAN is already being processed.');
    res.json({ ok: true, normalised: { ...data, aadhaar_last4: data.aadhaar_last4 } });
  }),
);

/** Submit application + documents (multipart). Persists, sets SUBMITTED and queues extraction (-> EXTRACTING). */
applicationsRouter.post(
  '/',
  requireRole('APPLICANT'),
  upload.array('files', 10),
  ah(async (req, res) => {
    const { schema, today } = await applicationSchema();
    const data = parseOr422(schema, req.body, 'Please correct the highlighted fields');
    const files = validateFiles((req.files as Express.Multer.File[]) ?? [], req.body.declared_types, 3);
    const actor = actorFrom(req);
    const out = await tx((c) =>
      insertApplication(c, data, files, { application_date: today, applicant_user_id: req.user!.id }, actor),
    );
    enqueueProcessing(out.application_id);
    res.status(202).json({ ...out, status: 'SUBMITTED' });
  }),
);

applicationsRouter.get(
  '/mine',
  requireRole('APPLICANT'),
  ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM applications WHERE applicant_user_id = $1 ORDER BY submitted_at DESC', [req.user!.id]);
    res.json({ items: await Promise.all(r.rows.map((a) => applicantView(a))) });
  }),
);

/** Officer list / search (PAN masked in lists). */
applicationsRouter.get(
  '/',
  requireRole('KYC_OFFICER', 'COMPLIANCE_OFFICER'),
  ah(async (req, res) => {
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status.split(',') : null;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const r = await pool.query(
      `SELECT * FROM applications
        WHERE ($1::text[] IS NULL OR status = ANY($1))
          AND ($2 = '' OR application_id ILIKE '%' || $2 || '%' OR full_name ILIKE '%' || $2 || '%')
          AND ($3::date IS NULL OR application_date >= $3) AND ($4::date IS NULL OR application_date <= $4)
        ORDER BY submitted_at DESC, application_id DESC LIMIT $5`,
      [status, q, req.query.from || null, req.query.to || null, limit],
    );
    res.json({ items: r.rows.map(listRow) });
  }),
);

applicationsRouter.get(
  '/:id',
  ah(async (req, res) => {
    const { app, officer } = await loadAuthorizedApplication(req.params.id, req.user!);
    if (!officer) return res.json({ view: 'applicant', ...(await applicantView(app)) });
    await audit({ application_id: app.application_id, event_type: 'APPLICATION_VIEWED', ...actorFrom(req) });
    res.json({ view: 'officer', ...(await officerView(app)) });
  }),
);

/** Decision API response (Section 6.3) - officers only (contains confidence values). */
applicationsRouter.get(
  '/:id/decision',
  requireRole('KYC_OFFICER', 'COMPLIANCE_OFFICER'),
  ah(async (req, res) => {
    const { app } = await loadAuthorizedApplication(req.params.id, req.user!);
    res.json(await decisionResponse(app));
  }),
);

/** Resubmission: upload additional documents (idempotent by SHA-256). */
applicationsRouter.post(
  '/:id/documents',
  requireRole('APPLICANT'),
  upload.array('files', 10),
  ah(async (req, res) => {
    const { app } = await loadAuthorizedApplication(req.params.id, req.user!);
    assertOwner(app, req.user!);
    assertResubmissionOpen(app);
    const files = validateFiles((req.files as Express.Multer.File[]) ?? [], req.body.declared_types, 1);
    const actor = actorFrom(req);
    const result = await tx(async (c) => {
      await lockApplication(c, app.application_id, { allowed: ['RESUBMISSION_REQUESTED'] });
      const added = [];
      const duplicates = [];
      for (const f of files) {
        const h = sha256(f.buffer);
        const dup = await c.query('SELECT doc_id FROM documents WHERE application_id = $1 AND sha256 = $2 AND active', [app.application_id, h]);
        if (dup.rowCount) {
          duplicates.push({ file_name: f.file_name, existing_doc_id: dup.rows[0].doc_id });
          await audit({ application_id: app.application_id, doc_id: dup.rows[0].doc_id, event_type: 'DOCUMENT_DUPLICATE_IGNORED', ...actor, details: { file_name: f.file_name } }, c);
          continue;
        }
        added.push(await insertDocument(c, app.application_id, f, h, req.user!.id, actor));
      }
      return { added, duplicates_ignored: duplicates };
    });
    res.status(201).json(result);
  }),
);

applicationsRouter.delete(
  '/:id/documents/:docId',
  requireRole('APPLICANT'),
  ah(async (req, res) => {
    const { app } = await loadAuthorizedApplication(req.params.id, req.user!);
    assertOwner(app, req.user!);
    assertResubmissionOpen(app);
    const r = await pool.query('UPDATE documents SET active = FALSE, removed_at = now() WHERE doc_id = $1 AND application_id = $2 AND active RETURNING doc_id', [
      req.params.docId,
      app.application_id,
    ]);
    if (!r.rowCount) throw notFound('Document not found');
    await audit({ application_id: app.application_id, doc_id: req.params.docId, event_type: 'DOCUMENT_REMOVED', ...actorFrom(req) });
    res.json({ ok: true });
  }),
);

applicationsRouter.post(
  '/:id/resubmit',
  requireRole('APPLICANT'),
  ah(async (req, res) => {
    const { app } = await loadAuthorizedApplication(req.params.id, req.user!);
    assertOwner(app, req.user!);
    assertResubmissionOpen(app);
    const actor = actorFrom(req);
    await tx(async (c) => {
      const locked = await lockApplication(c, app.application_id, { allowed: ['RESUBMISSION_REQUESTED'] });
      const n = Number((await c.query('SELECT count(*) FROM documents WHERE application_id = $1 AND active', [app.application_id])).rows[0].count);
      if (n < 3) throw unprocessable('At least 3 documents are required', { files: 'Keep or upload at least 3 documents before resubmitting' });
      await c.query('UPDATE applications SET resubmission_count = resubmission_count + 1, submitted_at = now() WHERE application_id = $1', [app.application_id]);
      await audit({ application_id: app.application_id, event_type: 'RESUBMITTED', ...actor, details: { documents: n } }, c);
      await transition(c, locked, 'SUBMITTED', actor, { resubmission: true });
    });
    enqueueProcessing(app.application_id);
    res.status(202).json({ application_id: app.application_id, status: 'SUBMITTED' });
  }),
);

// ---------------------------------------------------------------- officer actions
applicationsRouter.post(
  '/:id/corrections',
  requireRole('KYC_OFFICER'),
  ah(async (req, res) => {
    const body = parseOr422(fieldCorrectionSchema, req.body);
    const out = await correctField(req.user!, actorFrom(req), req.params.id, body);
    const { app } = await loadAuthorizedApplication(req.params.id, req.user!);
    res.json({ result: { decision: out.result.decision, reason_codes: out.result.reason_codes, name_match_score: out.result.name_match_score, risk_category: out.result.risk_category, rekyc_due_date: out.result.rekyc_due_date }, ...(await officerView(app)) });
  }),
);

applicationsRouter.post(
  '/:id/recommendation',
  requireRole('KYC_OFFICER'),
  ah(async (req, res) => {
    const body = parseOr422(recommendationSchema, req.body);
    const out = await recommend(req.user!, actorFrom(req), req.params.id, body);
    res.json(out);
  }),
);

applicationsRouter.post(
  '/:id/checker-decision',
  requireRole('COMPLIANCE_OFFICER'),
  ah(async (req, res) => {
    const body = parseOr422(checkerDecisionSchema, req.body);
    const out = await checkerDecide(req.user!, actorFrom(req), req.params.id, body);
    res.json(out);
  }),
);

applicationsRouter.get(
  '/:id/summary',
  requireRole('KYC_OFFICER', 'COMPLIANCE_OFFICER'),
  ah(async (req, res) => {
    const { app } = await loadAuthorizedApplication(req.params.id, req.user!);
    res.json(await reviewerSummary(app));
  }),
);

// ---------------------------------------------------------------- audit
applicationsRouter.get(
  '/:id/audit',
  requireRole('COMPLIANCE_OFFICER'),
  ah(async (req, res) => {
    const { app } = await loadAuthorizedApplication(req.params.id, req.user!);
    const r = await pool.query('SELECT * FROM audit_log WHERE application_id = $1 ORDER BY id', [app.application_id]);
    res.json({ application_id: app.application_id, items: r.rows });
  }),
);

applicationsRouter.get(
  '/:id/audit.csv',
  requireRole('COMPLIANCE_OFFICER'),
  ah(async (req, res) => {
    const { app } = await loadAuthorizedApplication(req.params.id, req.user!);
    await audit({ application_id: app.application_id, event_type: 'AUDIT_EXPORTED', ...actorFrom(req) });
    const r = await pool.query('SELECT * FROM audit_log WHERE application_id = $1 ORDER BY id', [app.application_id]);
    const header = ['id', 'timestamp', 'event_type', 'application_id', 'doc_id', 'actor_id', 'actor_email', 'actor_role', 'details'];
    const lines = [header.join(',')];
    for (const row of r.rows) {
      lines.push(
        toCsvRow([row.id, new Date(row.created_at).toISOString(), row.event_type, row.application_id, row.doc_id, row.actor_id, row.actor_email, row.actor_role,
          maskPan(JSON.stringify(row.details))]),
      );
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit_${app.application_id}.csv"`);
    res.send(lines.join('\n') + '\n');
  }),
);
