import { Router } from 'express';
import { configUpdateSchema, settingsUpdateSchema, watchlistEntrySchema } from '@onboardiq/shared';
import { pool } from '../db/pool';
import { ah, notFound, parseOr422, unprocessable } from '../lib/http';
import { authenticate, requireRole } from '../middleware/auth';
import { actorFrom, audit } from '../services/audit';
import { closeExpired } from '../services/cases';
import { getRulesConfig, getSettings } from '../services/config';
import { recoverStuck, rescreenOpenCases } from '../services/processing';

export const adminRouter = Router();
adminRouter.use(authenticate, requireRole('COMPLIANCE_OFFICER'));

adminRouter.get(
  '/config',
  ah(async (_req, res) => {
    const cfg = await getRulesConfig();
    const { _id, ...config } = cfg;
    res.json({ id: _id, config });
  }),
);

adminRouter.get(
  '/config/history',
  ah(async (_req, res) => {
    const r = await pool.query(
      'SELECT c.id, c.version, c.comment, c.created_at, u.email AS created_by FROM rules_config c LEFT JOIN users u ON u.id = c.created_by ORDER BY c.id DESC LIMIT 50',
    );
    res.json({ items: r.rows });
  }),
);

/** Update thresholds / patterns / periods. A new configuration version row is stored; decisions change without code changes. */
adminRouter.put(
  '/config',
  ah(async (req, res) => {
    const patch = parseOr422(configUpdateSchema, req.body?.config ?? req.body);
    if (patch.pan_pattern) {
      try {
        new RegExp(patch.pan_pattern);
      } catch {
        throw unprocessable('Invalid configuration', { pan_pattern: 'Not a valid regular expression' });
      }
    }
    const current = await getRulesConfig();
    const { _id, ...base } = current;
    const next = { ...base, ...patch };
    if (next.name_reject_below > next.name_match_threshold) {
      throw unprocessable('Invalid configuration', { name_reject_below: 'Must not exceed name_match_threshold' });
    }
    if (next.watchlist_possible_threshold > next.watchlist_match_threshold) {
      throw unprocessable('Invalid configuration', { watchlist_possible_threshold: 'Must not exceed watchlist_match_threshold' });
    }
    const changed = Object.fromEntries(
      Object.keys(patch).filter((k) => JSON.stringify((base as any)[k]) !== JSON.stringify((next as any)[k])).map((k) => [k, { before: (base as any)[k], after: (next as any)[k] }]),
    );
    const r = await pool.query('INSERT INTO rules_config (version, config, created_by, comment) VALUES ($1,$2,$3,$4) RETURNING id', [
      next.version,
      JSON.stringify(next),
      req.user!.id,
      typeof req.body?.comment === 'string' ? req.body.comment.slice(0, 200) : null,
    ]);
    await audit({ event_type: 'CONFIG_UPDATED', ...actorFrom(req), details: { config_id: r.rows[0].id, changed } });
    res.json({ id: r.rows[0].id, config: next, changed });
  }),
);

adminRouter.get('/settings', ah(async (_req, res) => res.json(await getSettings())));

adminRouter.put(
  '/settings',
  ah(async (req, res) => {
    const body = parseOr422(settingsUpdateSchema, req.body);
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      await pool.query(
        `INSERT INTO system_settings (key, value, updated_by, updated_at) VALUES ($1,$2,$3,now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [k, JSON.stringify(v === '' ? null : v), req.user!.id],
      );
    }
    await audit({ event_type: 'SETTINGS_UPDATED', ...actorFrom(req), details: body });
    res.json(await getSettings());
  }),
);

adminRouter.get(
  '/watchlists',
  ah(async (req, res) => {
    const r = await pool.query(
      `SELECT list_type, entry_id, name, alias, dob, extra, active, updated_at FROM watchlist_entries
        WHERE ($1::text IS NULL OR list_type = $1) ORDER BY list_type, entry_id`,
      [req.query.list_type || null],
    );
    res.json({ items: r.rows });
  }),
);

/** Add or update a watchlist entry; optionally re-screen open cases straight away. */
adminRouter.post(
  '/watchlists',
  ah(async (req, res) => {
    const e = parseOr422(watchlistEntrySchema, req.body);
    await pool.query(
      `INSERT INTO watchlist_entries (list_type, entry_id, name, alias, dob, extra, active)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE)
       ON CONFLICT (list_type, entry_id) DO UPDATE SET name = EXCLUDED.name, alias = EXCLUDED.alias, dob = EXCLUDED.dob,
         extra = EXCLUDED.extra, active = TRUE, updated_at = now()`,
      [e.list_type, e.entry_id, e.name, e.alias || null, e.dob || null, e.extra || null],
    );
    await audit({ event_type: 'WATCHLIST_UPDATED', ...actorFrom(req), details: { action: 'UPSERT', ...e } });
    const rescreen = req.body?.rescreen ? await rescreenOpenCases(actorFrom(req)) : null;
    res.status(201).json({ ok: true, rescreen });
  }),
);

adminRouter.delete(
  '/watchlists/:listType/:entryId',
  ah(async (req, res) => {
    const r = await pool.query('UPDATE watchlist_entries SET active = FALSE, updated_at = now() WHERE list_type = $1 AND entry_id = $2 AND active RETURNING entry_id', [
      req.params.listType,
      req.params.entryId,
    ]);
    if (!r.rowCount) throw notFound('Watchlist entry not found');
    await audit({ event_type: 'WATCHLIST_UPDATED', ...actorFrom(req), details: { action: 'DEACTIVATE', list_type: req.params.listType, entry_id: req.params.entryId } });
    res.json({ ok: true });
  }),
);

/** NFR: updating a watchlist re-screens open cases on request. */
adminRouter.post(
  '/watchlists/rescreen',
  ah(async (req, res) => {
    const changed = await rescreenOpenCases(actorFrom(req));
    await audit({ event_type: 'RESCREENED', ...actorFrom(req), details: { changed: changed.length } });
    res.json({ changed });
  }),
);

adminRouter.post(
  '/jobs/expire',
  ah(async (req, res) => {
    const closed = await closeExpired();
    res.json({ closed });
  }),
);

adminRouter.post(
  '/jobs/recover',
  ah(async (_req, res) => {
    res.json({ recovered: await recoverStuck() });
  }),
);
