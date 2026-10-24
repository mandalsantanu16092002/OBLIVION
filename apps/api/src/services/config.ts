import type { ReferenceData, RulesConfig, WatchlistEntry } from '@onboardiq/rules-engine';
import { todayIst } from '@onboardiq/rules-engine';
import { env } from '../config/env';
import { pool, type Db } from '../db/pool';

export async function getRulesConfig(db: Db = pool): Promise<RulesConfig & { _id: number }> {
  const r = await db.query('SELECT id, config FROM rules_config ORDER BY id DESC LIMIT 1');
  if (!r.rows[0]) throw new Error('rules_config is empty: run npm run db:seed');
  return { ...(r.rows[0].config as RulesConfig), _id: r.rows[0].id };
}

export interface Settings {
  extraction_provider: 'mock' | 'ai';
  business_date: string | null;
}

export async function getSettings(db: Db = pool): Promise<Settings> {
  const r = await db.query('SELECT key, value FROM system_settings');
  const m = Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
  return {
    extraction_provider: (m.extraction_provider ?? env.EXTRACTION_PROVIDER) === 'ai' ? 'ai' : 'mock',
    business_date: m.business_date ?? (env.DEMO_BUSINESS_DATE || null),
  };
}

/** Business date (IST calendar date) used as application_date for new applications. */
export async function businessDate(db: Db = pool): Promise<string> {
  const s = await getSettings(db);
  return s.business_date || todayIst();
}

/** Reference data for the rules. excludeApplicationId: a customer record created by that same application is not a duplicate. */
export async function getReferenceData(db: Db = pool, excludeApplicationId?: string): Promise<ReferenceData> {
  // sequential: db may be a single transaction client
  const wl = await db.query('SELECT list_type, entry_id, name, alias, dob, extra FROM watchlist_entries WHERE active ORDER BY list_type, entry_id');
  const cust = await db.query('SELECT pan_number, application_id FROM existing_customers');
  const occ = await db.query('SELECT occupation_code, risk_level FROM occupations');
  const entries = wl.rows as WatchlistEntry[];
  const pans = new Set(
    cust.rows.filter((r) => !excludeApplicationId || r.application_id !== excludeApplicationId).map((r) => String(r.pan_number).toUpperCase()),
  );
  return {
    sanctions: entries.filter((e) => e.list_type === 'SANCTIONS'),
    pep: entries.filter((e) => e.list_type === 'PEP'),
    isExistingCustomerPan: (p) => pans.has(p.toUpperCase()),
    occupationRisk: Object.fromEntries(occ.rows.map((r) => [r.occupation_code, r.risk_level])),
  };
}

export async function occupationCodes(db: Db = pool): Promise<string[]> {
  return (await db.query('SELECT occupation_code FROM occupations')).rows.map((r) => r.occupation_code);
}
