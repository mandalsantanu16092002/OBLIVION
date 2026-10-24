import { Router, type Request } from 'express';
import { z } from 'zod';
import { pool, tx } from '../db/pool';
import { ah, notFound, parseOr422 } from '../lib/http';
import { authenticate, isOfficer, requireRole } from '../middleware/auth';
import { actorFrom, audit } from '../services/audit';
import { getSettings } from '../services/config';
import { toLongFormat } from '../services/extraction';
import { evaluateAndStore, extractAndStore } from '../services/processing';
import { readStoredText } from '../services/storage';
import { lockApplication } from '../services/workflow';

export const documentsRouter = Router();
documentsRouter.use(authenticate);

/** Documents are served only to officers and to their owner; every view is audited. */
async function loadAuthorizedDoc(req: Request, where: 'doc_id' | 'file_key', value: string) {
  if (where === 'file_key' && !/^[0-9a-f-]{36}$/i.test(value)) throw notFound('Document not found');
  const r = await pool.query(
    `SELECT d.*, a.applicant_user_id FROM documents d JOIN applications a ON a.application_id = d.application_id WHERE d.${where} = $1`,
    [value],
  );
  const doc = r.rows[0];
  if (!doc || (!isOfficer(req.user) && doc.applicant_user_id !== req.user!.id)) throw notFound('Document not found');
  return doc;
}

documentsRouter.get(
  '/documents/:docId/text',
  ah(async (req, res) => {
    const doc = await loadAuthorizedDoc(req, 'doc_id', req.params.docId);
    const text = await readStoredText(doc.file_key);
    await audit({ application_id: doc.application_id, doc_id: doc.doc_id, event_type: 'DOCUMENT_VIEWED', ...actorFrom(req), details: { via: 'text' } });
    res.json({ doc_id: doc.doc_id, file_name: doc.file_name, declared_doc_type: doc.declared_doc_type, sha256: doc.sha256, text, file_url: `/api/v1/files/${doc.file_key}` });
  }),
);

/** Raw file by its non-guessable key (still requires authorisation). Served as inert text, never executed. */
documentsRouter.get(
  '/files/:fileKey',
  ah(async (req, res) => {
    const doc = await loadAuthorizedDoc(req, 'file_key', req.params.fileKey);
    const text = await readStoredText(doc.file_key);
    await audit({ application_id: doc.application_id, doc_id: doc.doc_id, event_type: 'DOCUMENT_VIEWED', ...actorFrom(req), details: { via: 'file' } });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${doc.file_name.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
    res.send(text);
  }),
);

/**
 * FR-3: POST /api/v1/documents/{doc_id}/extract - runs the configured provider (or ?provider=mock|ai)
 * and returns doc_type and fields with confidence in the long format. If the case is IN_REVIEW the rules re-run.
 */
documentsRouter.post(
  '/documents/:docId/extract',
  requireRole('KYC_OFFICER', 'COMPLIANCE_OFFICER'),
  ah(async (req, res) => {
    const q = parseOr422(z.object({ provider: z.enum(['mock', 'ai']).optional() }), req.query);
    const doc = await loadAuthorizedDoc(req, 'doc_id', req.params.docId);
    const provider = q.provider ?? (await getSettings()).extraction_provider;
    const actor = actorFrom(req);
    const r = await extractAndStore(pool, doc, provider, actor);
    let rules = null;
    const app = (await pool.query('SELECT status FROM applications WHERE application_id = $1', [doc.application_id])).rows[0];
    if (app?.status === 'IN_REVIEW') {
      rules = await tx(async (c) => {
        const locked = await lockApplication(c, doc.application_id, { allowed: ['IN_REVIEW'] });
        const out = await evaluateAndStore(c, locked, 'REEXTRACT', actor);
        await c.query('UPDATE applications SET version = version + 1 WHERE application_id = $1', [doc.application_id]);
        return { decision: out.decision, reason_codes: out.reason_codes };
      });
    }
    res.json({
      doc_id: r.doc_id,
      provider: r.provider,
      status: r.status,
      doc_type: r.doc_type,
      confidence: r.doc_type_confidence,
      extractor_version: r.extractor_version,
      error: r.error ?? null,
      rows: toLongFormat(r),
      fields: r.fields,
      rules,
    });
  }),
);
