/**
 * Seed the database from the data pack:
 *   users (KYC officer, compliance officer, demo applicant), occupations,
 *   rule configuration (case_02_rules_config_V1.0.json), watchlists, existing customers, mock extraction,
 *   and the 60 sample applications (processed through the real pipeline with the mock provider).
 * Usage:
 *   npm run db:seed               reference data + sample applications
 *   npm run db:seed -- --with-eval  also the 100 evaluation applications
 *   npm run seed:eval             only the evaluation applications
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { parseCsv } from '@onboardiq/rules-engine';
import { env } from '../config/env';
import { insertApplication } from '../services/applications';
import { SYSTEM_ACTOR } from '../services/audit';
import { processApplication } from '../services/processing';
import { ensureStorage } from '../services/storage';
import type { ValidFile } from '../services/uploads';
import { migrate } from './migrate';
import { pool, tx } from './pool';

const D = (p: string) => resolve(env.DATA_DIR, p);
const read = (p: string) => readFileSync(D(p), 'utf8');

export const DEMO_USERS = [
  { email: 'kyc@onboardiq.local', name: 'Kiran Mehta', roles: ['KYC_OFFICER'], password: 'Officer@123' },
  { email: 'compliance@onboardiq.local', name: 'Chitra Nair', roles: ['COMPLIANCE_OFFICER'], password: 'Officer@123' },
  { email: 'applicant@onboardiq.local', name: 'Demo Applicant', roles: ['APPLICANT'], password: 'Applicant@123' },
];
export const SEED_APPLICANT_PASSWORD = 'Applicant@123';

export async function seedReference(log = console.log) {
  for (const u of DEMO_USERS) {
    await pool.query(
      `INSERT INTO users (email, password_hash, full_name, roles) VALUES ($1,$2,$3,$4)
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, roles = EXCLUDED.roles`,
      [u.email, await bcrypt.hash(u.password, 10), u.name, u.roles],
    );
  }
  for (const o of parseCsv(read('reference/case_02_occupations_V1.0.csv'))) {
    await pool.query(
      'INSERT INTO occupations VALUES ($1,$2,$3) ON CONFLICT (occupation_code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level',
      [o.occupation_code, o.description, o.risk_level],
    );
  }
  const cfgCount = Number((await pool.query('SELECT count(*) FROM rules_config')).rows[0].count);
  if (cfgCount === 0) {
    const cfg = JSON.parse(read('reference/case_02_rules_config_V1.0.json'));
    await pool.query("INSERT INTO rules_config (version, config, comment) VALUES ($1,$2,'Loaded from case_02_rules_config_V1.0.json')", [cfg.version, JSON.stringify(cfg)]);
  }
  for (const s of parseCsv(read('reference/case_02_sanctions_list_V1.0.csv'))) {
    await pool.query(
      `INSERT INTO watchlist_entries (list_type, entry_id, name, alias, dob, extra) VALUES ('SANCTIONS',$1,$2,$3,$4,$5) ON CONFLICT (list_type, entry_id) DO NOTHING`,
      [s.list_id, s.name, s.alias || null, s.dob || null, [s.nationality, s.program].filter(Boolean).join(' / ')],
    );
  }
  for (const p of parseCsv(read('reference/case_02_pep_list_V1.0.csv'))) {
    await pool.query(
      `INSERT INTO watchlist_entries (list_type, entry_id, name, alias, dob, extra) VALUES ('PEP',$1,$2,NULL,$3,$4) ON CONFLICT (list_type, entry_id) DO NOTHING`,
      [p.pep_id, p.name, p.dob || null, [p.position, p.category].filter(Boolean).join(' / ')],
    );
  }
  for (const c of parseCsv(read('reference/case_02_existing_customers_V1.0.csv'))) {
    await pool.query('INSERT INTO existing_customers (customer_id, full_name, pan_number, dob) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [
      c.customer_id,
      c.full_name,
      c.pan_number,
      c.dob || null,
    ]);
  }
  for (const set of ['sample', 'eval']) {
    const rows = parseCsv(read(`${set}/case_02_extraction_mock_${set}_V1.0.csv`));
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const vals: unknown[] = [];
      const ph = chunk.map((r, j) => {
        vals.push(r.doc_id, r.field_name, r.value, Number(r.confidence));
        return `($${j * 4 + 1},$${j * 4 + 2},$${j * 4 + 3},$${j * 4 + 4})`;
      });
      await pool.query(`INSERT INTO extraction_mock (doc_id, field_name, value, confidence) VALUES ${ph.join(',')} ON CONFLICT DO NOTHING`, vals);
    }
  }
  await pool.query(
    `INSERT INTO system_settings (key, value) VALUES ('extraction_provider', $1), ('business_date', $2) ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify(env.EXTRACTION_PROVIDER), JSON.stringify(env.DEMO_BUSINESS_DATE || null)],
  );
  log(`[seed] reference data loaded (${DEMO_USERS.length} demo users, watchlists, customers, mock extraction)`);
}

export async function seedApplications(set: 'sample' | 'eval', log = console.log) {
  ensureStorage();
  const prevCoreUrl = env.CORE_BANKING_URL;
  env.CORE_BANKING_URL = ''; // the API server is not running during seeding: call the mock in-process
  const apps = parseCsv(read(`${set}/case_02_applications_${set}_V1.0.csv`));
  const docs = parseCsv(read(`${set}/case_02_documents_${set}_V1.0.csv`));
  const texts = new Map<string, string>();
  for (const line of read(`${set}/case_02_document_text_${set}_V1.0.jsonl`).split('\n')) {
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    texts.set(j.doc_id, j.text);
  }
  const hash = await bcrypt.hash(SEED_APPLICANT_PASSWORD, 10);
  let created = 0;
  for (const a of apps) {
    const exists = await pool.query('SELECT 1 FROM applications WHERE application_id = $1', [a.application_id]);
    if (exists.rowCount) continue;
    const user = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, roles) VALUES ($1,$2,$3,ARRAY['APPLICANT'])
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name RETURNING id`,
      [a.email.toLowerCase(), hash, a.full_name],
    );
    const files: (ValidFile & { doc_id: string })[] = docs
      .filter((d) => d.application_id === a.application_id)
      .map((d) => ({
        doc_id: d.doc_id,
        file_name: d.file_name,
        declared_doc_type: d.declared_doc_type as ValidFile['declared_doc_type'],
        buffer: Buffer.from(texts.get(d.doc_id) ?? '', 'utf8'),
        text: texts.get(d.doc_id) ?? '',
      }));
    const actor = { ...SYSTEM_ACTOR, actor_id: user.rows[0].id, actor_email: a.email.toLowerCase(), actor_role: 'APPLICANT' };
    await tx((c) =>
      insertApplication(
        c,
        {
          full_name: a.full_name,
          dob: a.dob,
          gender: a.gender as 'M' | 'F' | 'O',
          pan_number: a.pan_number,
          aadhaar_last4: a.aadhaar_last4,
          mobile: a.mobile,
          email: a.email.toLowerCase(),
          address: a.address,
          city: a.city,
          state: a.state,
          pincode: a.pincode,
          occupation_code: a.occupation_code,
          annual_income: Number(a.annual_income),
          kyc_consent: true,
        },
        files,
        { application_id: a.application_id, application_date: a.application_date, applicant_user_id: user.rows[0].id, source: `SEED_${set.toUpperCase()}`, minFiles: 1 },
        actor,
      ),
    );
    await processApplication(a.application_id, { providerOverride: 'mock' });
    created++;
  }
  env.CORE_BANKING_URL = prevCoreUrl;
  const dist = await pool.query("SELECT status, count(*)::int AS n FROM applications WHERE source = $1 GROUP BY status ORDER BY status", [`SEED_${set.toUpperCase()}`]);
  log(`[seed] ${set}: ${created} applications processed -> ${dist.rows.map((r) => `${r.status}=${r.n}`).join(', ')}`);
}

export async function seedIfEmpty() {
  const n = Number((await pool.query('SELECT count(*) FROM users')).rows[0].count);
  if (n > 0) return false;
  await seedReference();
  await seedApplications('sample');
  return true;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  (async () => {
    await migrate({ log: false });
    const evalOnly = process.argv.includes('--eval-only');
    if (!evalOnly) {
      await seedReference();
      await seedApplications('sample');
    }
    if (evalOnly || process.argv.includes('--with-eval')) await seedApplications('eval');
    console.log('[seed] done. Demo logins: kyc@onboardiq.local / compliance@onboardiq.local (Officer@123), applicant@onboardiq.local (Applicant@123)');
    await pool.end();
  })().catch((e) => {
    console.error('[seed] failed:', e);
    process.exit(1);
  });
}
