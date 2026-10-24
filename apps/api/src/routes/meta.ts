import { Router } from 'express';
import {
  DECLARABLE_DOC_TYPES,
  DOC_TYPE_LABELS,
  FIELD_LABELS,
  REASON_CODES,
  ROLE_LABELS,
  STATUS_LABELS,
  STATUS_TRANSITIONS,
} from '@onboardiq/shared';
import { pool } from '../db/pool';
import { ah } from '../lib/http';
import { openApiSpec, swaggerHtml } from '../openapi';
import { businessDate, getRulesConfig, getSettings } from '../services/config';
import { aiServiceHealth } from '../services/extraction';
import { handleOpenAccount } from '../services/coreBanking';

export const metaRouter = Router();

metaRouter.get(
  '/reference/occupations',
  ah(async (_req, res) => {
    const r = await pool.query('SELECT occupation_code, description FROM occupations ORDER BY description');
    res.json({ items: r.rows });
  }),
);

metaRouter.get(
  '/reference/meta',
  ah(async (_req, res) => {
    const cfg = await getRulesConfig();
    res.json({
      business_date: await businessDate(),
      declarable_doc_types: DECLARABLE_DOC_TYPES.map((t) => ({ value: t, label: DOC_TYPE_LABELS[t] })),
      doc_type_labels: DOC_TYPE_LABELS,
      field_labels: FIELD_LABELS,
      status_labels: STATUS_LABELS,
      status_transitions: STATUS_TRANSITIONS,
      role_labels: ROLE_LABELS,
      reason_codes: REASON_CODES.map((r) => ({ code: r.code, rule: r.rule, outcome: r.outcome, title: r.title, applicant_message: r.applicantMessage })),
      upload: { max_bytes: 1024 * 1024, min_files: 3, accept: '.txt' },
      pan_pattern: cfg.pan_pattern,
      resubmission_sla_days: cfg.resubmission_sla_days,
    });
  }),
);

metaRouter.get(
  '/health',
  ah(async (_req, res) => {
    let db = false;
    try {
      await pool.query('SELECT 1');
      db = true;
    } catch {
      db = false;
    }
    const settings = db ? await getSettings() : null;
    const ai = await aiServiceHealth();
    res.status(db ? 200 : 503).json({ status: db ? 'ok' : 'degraded', database: db, extraction_provider: settings?.extraction_provider, ai_service: ai.ok, business_date: db ? await businessDate() : null });
  }),
);

metaRouter.get('/openapi.json', (_req, res) => res.json(openApiSpec()));

export const docsRouter = Router();
docsRouter.get('/', (_req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'self' https://unpkg.com; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https:");
  res.type('html').send(swaggerHtml);
});

/** Mock core-banking API: callable only with the service key (X-Service-Key). */
export const internalRouter = Router();
internalRouter.post(
  '/core-banking/accounts',
  ah(async (req, res) => {
    const b = req.body ?? {};
    const out = await handleOpenAccount(req.header('x-service-key') ?? undefined, {
      application_id: String(b.application_id ?? ''),
      full_name: String(b.full_name ?? ''),
      pan_number: String(b.pan_number ?? ''),
      dob: String(b.dob ?? ''),
    });
    res.status(201).json(out);
  }),
);
