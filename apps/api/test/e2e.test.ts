/**
 * API end-to-end tests: worked examples 1-12, change/failure challenges and edge cases.
 * Uses a separate database (TEST_DATABASE_URL, default .../onboardiq_test) that is reset and seeded.
 * Run: npm test -w @onboardiq/api   (PostgreSQL must be running; the AI-provider test runs only if the AI service is up)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://onboardiq:onboardiq@localhost:5432/onboardiq_test';
process.env.STORAGE_DIR = process.env.TEST_STORAGE_DIR ?? 'storage/test-documents';
process.env.CORE_BANKING_URL = '';
process.env.DEMO_BUSINESS_DATE = '2026-03-04';

const { createApp } = await import('../src/app');
const { pool } = await import('../src/db/pool');
const { migrate } = await import('../src/db/migrate');
const { seedReference, seedApplications } = await import('../src/db/seed');
const { queueIdle } = await import('../src/services/processing');
const { env } = await import('../src/config/env');

const DATA = resolve(env.DATA_DIR);
let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
const tokens: Record<string, string> = {};

async function api(method: string, path: string, opts: { token?: string; body?: unknown; form?: FormData; role?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.role) headers['x-acting-role'] = opts.role;
  let body: FormData | string | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(base + path, { method, headers, body });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

async function login(email: string, password: string) {
  const r = await api('POST', '/api/v1/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token as string;
}

const docText = (set: string, id: string) => readFileSync(resolve(DATA, set, 'documents', `${id}.txt`));

function appForm(fields: Record<string, string>, files: { name: string; content: Buffer | string; type: string }[]) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const f of files) fd.append('files', new Blob([typeof f.content === 'string' ? f.content : new Uint8Array(f.content)]), f.name);
  fd.append('declared_types', JSON.stringify(files.map((f) => f.type)));
  return fd;
}

const evalApp = (id: string) => {
  const lines = readFileSync(resolve(DATA, 'eval/case_02_applications_eval_V1.0.csv'), 'utf8').split(/\r?\n/);
  const header = lines[0].split(',');
  const line = lines.find((l) => l.startsWith(id + ','))!;
  const vals = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((v) => v.replace(/,$/, '').replace(/^"|"$/g, ''));
  return Object.fromEntries(header.map((h, i) => [h, vals[i]]));
};

function formFromEval(id: string) {
  const a = evalApp(id);
  return {
    full_name: a.full_name, dob: a.dob, gender: a.gender, pan_number: a.pan_number, aadhaar_last4: a.aadhaar_last4,
    mobile: a.mobile, email: a.email, address: a.address, city: a.city, state: a.state, pincode: a.pincode,
    occupation_code: a.occupation_code, annual_income: a.annual_income, kyc_consent: 'true',
  };
}

before(async () => {
  await migrate({ reset: true, log: false });
  await seedReference(() => undefined);
  await seedApplications('sample', () => undefined);
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Test-only officers (not seeded): a second KYC officer and a user holding both roles,
  // so concurrency and the maker != checker guard can be exercised.
  const hash = await bcrypt.hash('Officer@123', 4);
  await pool.query(
    `INSERT INTO users (email, password_hash, full_name, roles) VALUES
       ('kyc2@test.local', $1, 'Second KYC Officer', ARRAY['KYC_OFFICER']),
       ('dual@test.local', $1, 'Dual Role Officer', ARRAY['KYC_OFFICER','COMPLIANCE_OFFICER'])`,
    [hash],
  );
  tokens.kyc2 = await login('kyc2@test.local', 'Officer@123');
  tokens.dual = await login('dual@test.local', 'Officer@123');
  tokens.kyc = await login('kyc@onboardiq.local', 'Officer@123');
  tokens.compliance = await login('compliance@onboardiq.local', 'Officer@123');
  tokens.applicant = await login('applicant@onboardiq.local', 'Applicant@123');
  tokens.a4 = await login('a2000004@example.com', 'Applicant@123');
  tokens.a5 = await login('a2000005@example.com', 'Applicant@123');
});

after(async () => {
  await queueIdle();
  server?.close();
  await pool.end();
});

describe('FR-1 authentication and roles (server-side)', () => {
  it('rejects unauthenticated calls with 401', async () => {
    assert.equal((await api('GET', '/api/v1/review/queue')).status, 401);
  });
  it('an Applicant calling an officer API receives 403', async () => {
    assert.equal((await api('GET', '/api/v1/review/queue', { token: tokens.applicant })).status, 403);
    assert.equal((await api('GET', '/api/v1/dashboard', { token: tokens.applicant })).status, 403);
    assert.equal((await api('POST', '/api/v1/applications/A2000004/checker-decision', { token: tokens.a4, body: { decision: 'APPROVE', comment: 'approve myself please' } })).status, 403);
  });
  it("changing the application ID in the URL does not expose another applicant's data or documents", async () => {
    const own = await api('GET', '/api/v1/applications/A2000004', { token: tokens.a4 });
    assert.equal(own.status, 200);
    assert.equal(own.body.view, 'applicant');
    assert.equal(JSON.stringify(own.body).includes('confidence'), false, 'no confidence for applicants');
    assert.equal((await api('GET', '/api/v1/applications/A2000005', { token: tokens.a4 })).status, 404);
    assert.equal((await api('GET', '/api/v1/documents/D3000013/text', { token: tokens.a4 })).status, 404);
    assert.equal((await api('GET', '/api/v1/documents/D3000010/text', { token: tokens.a4 })).status, 200);
  });
  it('a KYC officer cannot give final approval', async () => {
    assert.equal((await api('POST', '/api/v1/applications/A2000010/checker-decision', { token: tokens.kyc, body: { decision: 'APPROVE', comment: 'looks fine to me' } })).status, 403);
  });
});

describe('FR-2 application validation (HTTP 422 with field names)', () => {
  const good = formFromEval('A2100002');
  it('refuses a 12-digit Aadhaar with a clear message', async () => {
    const r = await api('POST', '/api/v1/applications/validate', { token: tokens.applicant, body: { ...good, aadhaar_last4: '123456789012' } });
    assert.equal(r.status, 422);
    assert.match(r.body.fields.aadhaar_last4, /LAST 4 digits/);
  });
  it('reports invalid PAN, mobile, pincode, future dob and missing consent', async () => {
    const r = await api('POST', '/api/v1/applications/validate', {
      token: tokens.applicant,
      body: { ...good, pan_number: 'ABC123', mobile: '12345', pincode: '012345', dob: '2099-01-01', kyc_consent: false },
    });
    assert.equal(r.status, 422);
    for (const f of ['pan_number', 'mobile', 'pincode', 'dob', 'kyc_consent']) assert.ok(r.body.fields[f], `missing error for ${f}`);
  });
  it('accepts a valid form', async () => {
    const r = await api('POST', '/api/v1/applications/validate', { token: tokens.applicant, body: good });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });
});

describe('Challenge 4: invalid files are rejected and nothing is stored', () => {
  const fields = formFromEval('A2100002');
  const docsBefore = async () => Number((await pool.query('SELECT count(*) FROM documents')).rows[0].count);
  it('5 MB file -> 413', async () => {
    const n = await docsBefore();
    const big = Buffer.alloc(5 * 1024 * 1024, 'a');
    const r = await api('POST', '/api/v1/applications', { token: tokens.applicant, form: appForm(fields, [
      { name: 'a.txt', content: big, type: 'PAN_CARD' }, { name: 'b.txt', content: 'x', type: 'AADHAAR_CARD' }, { name: 'c.txt', content: 'y', type: 'BANK_STATEMENT' }]) });
    assert.equal(r.status, 413);
    assert.equal(await docsBefore(), n);
  });
  it('binary (non UTF-8) content and an .exe renamed to .txt -> 422 per file', async () => {
    const n = await docsBefore();
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.from([0x90, 0x00, 0x03, 0x00, 0x00, 0x00]), Buffer.alloc(64)]);
    const bin = Buffer.from([0xff, 0xfe, 0xc3, 0x28, 0xa0, 0xa1]);
    const r = await api('POST', '/api/v1/applications', { token: tokens.applicant, form: appForm(fields, [
      { name: 'setup.txt', content: exe, type: 'PAN_CARD' }, { name: 'bin.txt', content: bin, type: 'AADHAAR_CARD' }, { name: 'D3000188.txt', content: docText('eval', 'D3000188'), type: 'BANK_STATEMENT' }]) });
    assert.equal(r.status, 422);
    assert.match(r.body.fields['files.0'], /executable|binary/);
    assert.match(r.body.fields['files.1'], /UTF-8|binary/);
    assert.equal(await docsBefore(), n);
  });
  it('fewer than 3 documents or wrong extension -> 422', async () => {
    const r = await api('POST', '/api/v1/applications', { token: tokens.applicant, form: appForm(fields, [
      { name: 'a.pdf', content: 'hello', type: 'PAN_CARD' }]) });
    assert.equal(r.status, 422);
    assert.ok(r.body.fields.files);
    assert.ok(r.body.fields['files.0']);
  });
});

describe('Live submission with the mock provider', () => {
  it('SUBMITTED -> EXTRACTING -> AUTO_APPROVED with customer ID and account number; duplicate file ignored', async () => {
    await api('PUT', '/api/v1/admin/settings', { token: tokens.compliance, body: { business_date: '2026-03-05', extraction_provider: 'mock' } });
    const files = [
      { name: 'D3000186.txt', content: docText('eval', 'D3000186'), type: 'PAN_CARD' },
      { name: 'D3000187.txt', content: docText('eval', 'D3000187'), type: 'AADHAAR_CARD' },
      { name: 'D3000188.txt', content: docText('eval', 'D3000188'), type: 'BANK_STATEMENT' },
      { name: 'D3000188.txt', content: docText('eval', 'D3000188'), type: 'BANK_STATEMENT' },
    ];
    const r = await api('POST', '/api/v1/applications', { token: tokens.applicant, form: appForm(formFromEval('A2100002'), files) });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    assert.equal(r.body.documents.length, 3, 'same hash stored once');
    assert.equal(r.body.duplicates_ignored.length, 1);
    await queueIdle();
    const v = await api('GET', `/api/v1/applications/${r.body.application_id}`, { token: tokens.applicant });
    assert.equal(v.body.status, 'AUTO_APPROVED');
    assert.match(v.body.account.customer_id, /^DDB/);
    assert.ok(v.body.timeline.map((t: any) => t.status).join('>').includes('SUBMITTED>EXTRACTING>AUTO_APPROVED'));
    const d = await api('GET', `/api/v1/applications/${r.body.application_id}/decision`, { token: tokens.kyc });
    assert.deepEqual(Object.keys(d.body).sort(), ['application_id', 'decision', 'documents', 'name_match_score', 'reason_codes', 'rekyc_due_date', 'risk_category', 'status']);
    assert.equal(d.body.decision, 'APPROVE');
    assert.equal(d.body.documents[0].confidence > 0.8, true);
  });

  it('Challenge 2: same PAN submitted twice at the same time -> one accepted, the other 409 (never two approvals)', async () => {
    const files = () => [
      { name: 'D3000189.txt', content: docText('eval', 'D3000189'), type: 'PAN_CARD' },
      { name: 'D3000190.txt', content: docText('eval', 'D3000190'), type: 'AADHAAR_CARD' },
      { name: 'D3000191.txt', content: docText('eval', 'D3000191'), type: 'DRIVING_LICENCE' },
    ];
    const [a, b] = await Promise.all([
      api('POST', '/api/v1/applications', { token: tokens.applicant, form: appForm(formFromEval('A2100003'), files()) }),
      api('POST', '/api/v1/applications', { token: tokens.applicant, form: appForm(formFromEval('A2100003'), files()) }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [202, 409]);
    await queueIdle();
    const n = await pool.query("SELECT count(*)::int AS n FROM applications WHERE pan_number = $1 AND status IN ('AUTO_APPROVED','APPROVED')", [evalApp('A2100003').pan_number]);
    assert.ok(n.rows[0].n <= 1);
  });

  it('unknown document with the mock provider -> OTHER 0.00 -> REVIEW', async () => {
    const f = formFromEval('A2100010');
    const files = [
      { name: 'D3000210.txt', content: docText('eval', 'D3000210'), type: 'PAN_CARD' },
      { name: 'D3000211.txt', content: docText('eval', 'D3000211'), type: 'AADHAAR_CARD' },
      { name: 'my_bill.txt', content: docText('eval', 'D3000212'), type: 'ELECTRICITY_BILL' },
    ];
    const r = await api('POST', '/api/v1/applications', { token: tokens.applicant, form: appForm(f, files) });
    await queueIdle();
    const v = await api('GET', `/api/v1/applications/${r.body.application_id}`, { token: tokens.kyc });
    assert.equal(v.body.application.status, 'IN_REVIEW');
    assert.ok(v.body.application.reason_codes.includes('LOW_EXTRACTION_CONFIDENCE'));
    const other = v.body.documents.find((d: any) => d.file_name === 'my_bill.txt');
    assert.equal(other.extraction.doc_type, 'OTHER');
    assert.equal(other.extraction.doc_type_confidence, 0);
  });
});

describe('Worked examples on seeded sample data', () => {
  it('Examples 4, 6, 7 explainability: 0.7647, SAN0002, PEP0001', async () => {
    const e4 = await api('GET', '/api/v1/applications/A2000004', { token: tokens.kyc });
    assert.equal(e4.body.application.name_match_score_display, '0.7647');
    const e6 = await api('GET', '/api/v1/applications/A2000006', { token: tokens.kyc });
    assert.equal(e6.body.engine_result.sanctions.best.entry_id, 'SAN0002');
    const e7 = await api('GET', '/api/v1/applications/A2000007', { token: tokens.kyc });
    assert.equal(e7.body.engine_result.pep.best.entry_id, 'PEP0001');
  });

  it('REVIEW queue is ordered HIGH risk first then submission time', async () => {
    const q = await api('GET', '/api/v1/review/queue', { token: tokens.kyc });
    const order = { HIGH: 0, MEDIUM: 1, LOW: 2 } as Record<string, number>;
    const ranks = q.body.items.map((i: any) => order[i.risk_category] ?? 3);
    assert.deepEqual(ranks, [...ranks].sort((a: number, b: number) => a - b));
    assert.match(q.body.items[0].pan_masked, /^[A-Z]{3}X{5}[A-Z0-9]{2}$/);
  });

  it('Example 10 waits in PENDING_CHECKER', async () => {
    const q = await api('GET', '/api/v1/checker/queue', { token: tokens.compliance });
    assert.ok(q.body.items.some((i: any) => i.application_id === 'A2000010'));
  });

  it('Example 11: maker recommends APPROVE on example 4, the same user as checker gets 403, compliance officer approves -> APPROVED with account', async () => {
    const rec = await api('POST', '/api/v1/applications/A2000004/recommendation', { token: tokens.dual, body: { recommendation: 'APPROVE', comment: 'Initial K matches Kumar on Aadhaar.' } });
    assert.equal(rec.status, 200, JSON.stringify(rec.body));
    assert.equal(rec.body.status, 'PENDING_CHECKER');
    const self = await api('POST', '/api/v1/applications/A2000004/checker-decision', { token: tokens.dual, role: 'COMPLIANCE_OFFICER', body: { decision: 'APPROVE', comment: 'Approving my own case' } });
    assert.equal(self.status, 403);
    const ok = await api('POST', '/api/v1/applications/A2000004/checker-decision', { token: tokens.compliance, body: { decision: 'APPROVE', comment: 'Verified the maker evidence.' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.status, 'APPROVED');
    assert.match(ok.body.account.customer_id, /^DDB/);
    assert.match(ok.body.account.account_number, /^5010/);
    const audit = await api('GET', '/api/v1/applications/A2000004/audit', { token: tokens.compliance });
    assert.ok(audit.body.items.some((e: any) => e.event_type === 'MAKER_CHECKER_VIOLATION'));
  });

  it('Example 12: correcting the PAN of example 9 re-runs the rules -> APPROVE; audit has old and new values; goes to checker', async () => {
    const before = await api('GET', '/api/v1/applications/A2000009', { token: tokens.kyc });
    const c = await api('POST', '/api/v1/applications/A2000009/corrections', {
      token: tokens.kyc,
      body: { doc_id: 'D3000025', field_name: 'pan_number', new_value: 'ZZTPS9012Y', reason: 'Read from document text: ZZTPS9012Y', expected_version: before.body.application.version },
    });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal(c.body.result.decision, 'APPROVE');
    assert.deepEqual(c.body.result.reason_codes, []);
    assert.equal(c.body.application.status, 'IN_REVIEW');
    const f = c.body.documents.find((d: any) => d.doc_id === 'D3000025').fields.pan_number;
    assert.equal(f.confidence, 1);
    assert.equal(f.source, 'OFFICER');
    const audit = await api('GET', '/api/v1/applications/A2000009/audit', { token: tokens.compliance });
    const ev = audit.body.items.find((e: any) => e.event_type === 'FIELD_CORRECTED');
    assert.equal(ev.details.before.value, 'ZZTP59O12Y');
    assert.equal(ev.details.after.value, 'ZZTPS9012Y');
    const rec = await api('POST', '/api/v1/applications/A2000009/recommendation', { token: tokens.kyc, body: { recommendation: 'APPROVE', comment: 'PAN corrected from clear text.' } });
    assert.equal(rec.body.status, 'PENDING_CHECKER');
  });

  it('NFR concurrency: two officers acting on the same case at the same time -> second gets 409', async () => {
    const v = await api('GET', '/api/v1/applications/A2000005', { token: tokens.kyc });
    const body = (c: string) => ({ recommendation: 'REJECT', comment: c, expected_version: v.body.application.version });
    const [a, b] = await Promise.all([
      api('POST', '/api/v1/applications/A2000005/recommendation', { token: tokens.kyc, body: body('Stale address proof, reject.') }),
      api('POST', '/api/v1/applications/A2000005/recommendation', { token: tokens.kyc2, body: body('Stale address proof, reject!') }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    // send back so the next tests can use the case
    const s = await api('POST', '/api/v1/applications/A2000005/checker-decision', { token: tokens.compliance, body: { decision: 'SEND_BACK', comment: 'Please request a newer bill.' } });
    assert.equal(s.body.status ?? s.status, 'IN_REVIEW');
  });

  it('comment shorter than 10 characters -> 422', async () => {
    const r = await api('POST', '/api/v1/applications/A2000008/recommendation', { token: tokens.kyc, body: { recommendation: 'APPROVE', comment: 'ok' } });
    assert.equal(r.status, 422);
    assert.ok(r.body.fields.comment);
  });
});

describe('FR-8 resubmission and expiry', () => {
  it('officer requests resubmission; re-uploading the same file is idempotent; applicant resubmits; case evaluated again', async () => {
    const r = await api('POST', '/api/v1/applications/A2000005/recommendation', { token: tokens.kyc, body: { recommendation: 'REQUEST_RESUBMISSION', comment: 'Please upload a bill from the last 90 days.' } });
    assert.equal(r.body.status, 'RESUBMISSION_REQUESTED');
    const v = await api('GET', '/api/v1/applications/A2000005', { token: tokens.a5 });
    assert.equal(v.body.resubmission.officer_message, 'Please upload a bill from the last 90 days.');
    assert.ok(v.body.reasons.length > 0);
    const fd = new FormData();
    fd.append('files', new Blob([docText('sample', 'D3000015')]), 'D3000015.txt');
    fd.append('declared_types', JSON.stringify(['ELECTRICITY_BILL']));
    const up = await api('POST', '/api/v1/applications/A2000005/documents', { token: tokens.a5, form: fd });
    assert.equal(up.status, 201);
    assert.equal(up.body.added.length, 0);
    assert.equal(up.body.duplicates_ignored.length, 1);
    const re = await api('POST', '/api/v1/applications/A2000005/resubmit', { token: tokens.a5 });
    assert.equal(re.status, 202);
    await queueIdle();
    const after = await api('GET', '/api/v1/applications/A2000005', { token: tokens.kyc });
    assert.equal(after.body.application.status, 'IN_REVIEW');
    assert.ok(after.body.decisions.some((d: any) => d.trigger === 'RESUBMISSION'));
  });

  it('no resubmission within 7 days -> CLOSED_EXPIRED', async () => {
    await api('POST', '/api/v1/applications/A2000026/recommendation', { token: tokens.kyc, body: { recommendation: 'REQUEST_RESUBMISSION', comment: 'Please upload a clearer Aadhaar scan.' } });
    await pool.query("UPDATE applications SET resubmission_due_at = now() - interval '1 minute' WHERE application_id = 'A2000026'");
    const r = await api('POST', '/api/v1/admin/jobs/expire', { token: tokens.compliance });
    assert.ok(r.body.closed.includes('A2000026'));
  });
});

describe('Configuration, watchlists, extraction interface', () => {
  it('Challenge 1: changing name_match_threshold changes the decision without code change', async () => {
    const put = await api('PUT', '/api/v1/admin/config', { token: tokens.compliance, body: { config: { name_match_threshold: 0.85 } } });
    assert.equal(put.status, 200);
    await pool.query("UPDATE applications SET status = 'IN_REVIEW' WHERE application_id = 'A2000011'"); // test fixture: open an approved case
    const cfg = await api('PUT', '/api/v1/admin/config', { token: tokens.compliance, body: { config: { name_match_threshold: 0.92 } } });
    assert.equal(cfg.status, 200);
    await api('POST', '/api/v1/admin/watchlists/rescreen', { token: tokens.compliance });
    const a11 = await api('GET', '/api/v1/applications/A2000011', { token: tokens.kyc });
    assert.deepEqual(a11.body.application.reason_codes, ['NAME_MISMATCH_MINOR']); // 0.9091 < 0.92
    await api('PUT', '/api/v1/admin/config', { token: tokens.compliance, body: { config: { name_match_threshold: 0.9 } } });
    await api('POST', '/api/v1/admin/watchlists/rescreen', { token: tokens.compliance });
    const back = await api('GET', '/api/v1/applications/A2000011', { token: tokens.kyc });
    assert.deepEqual(back.body.application.reason_codes, []);
  });

  it('adding a watchlist entry re-screens open cases on request', async () => {
    const r = await api('POST', '/api/v1/admin/watchlists', {
      token: tokens.compliance,
      body: { list_type: 'SANCTIONS', entry_id: 'SAN9999', name: 'Meera Joshi', dob: '1988-07-07', rescreen: true },
    });
    assert.equal(r.status, 201);
    assert.ok(r.body.rescreen.some((x: any) => x.application_id === 'A2000005' && x.after.includes('SANCTIONS_MATCH')) ||
      (await api('GET', '/api/v1/applications/A2000005', { token: tokens.kyc })).body.application.reason_codes.includes('SANCTIONS_MATCH'));
    await api('DELETE', '/api/v1/admin/watchlists/SANCTIONS/SAN9999', { token: tokens.compliance });
    await api('POST', '/api/v1/admin/watchlists/rescreen', { token: tokens.compliance });
  });

  it('FR-3: POST /documents/{doc_id}/extract returns doc_type and fields in long format', async () => {
    const r = await api('POST', '/api/v1/documents/D3000001/extract?provider=mock', { token: tokens.kyc });
    assert.equal(r.status, 200);
    assert.equal(r.body.doc_type, 'PAN_CARD');
    assert.deepEqual(r.body.rows[0], { doc_id: 'D3000001', field_name: 'doc_type', value: 'PAN_CARD', confidence: 0.97 });
    assert.ok(r.body.rows.some((x: any) => x.field_name === 'pan_number' && x.value === 'ZZKPS1234Q'));
  });
});

describe('FR-9 / FR-10 audit and dashboard', () => {
  it('document views are audited (user, role, timestamp, doc_id)', async () => {
    await api('GET', '/api/v1/documents/D3000019/text', { token: tokens.kyc });
    const r = await pool.query("SELECT * FROM audit_log WHERE event_type = 'DOCUMENT_VIEWED' AND doc_id = 'D3000019' ORDER BY id DESC LIMIT 1");
    assert.equal(r.rows[0].actor_email, 'kyc@onboardiq.local');
    assert.equal(r.rows[0].actor_role, 'KYC_OFFICER');
    assert.ok(r.rows[0].created_at);
  });
  it('audit rows cannot be updated or deleted', async () => {
    await assert.rejects(pool.query("UPDATE audit_log SET event_type = 'X' WHERE id = 1"), /append-only/);
    await assert.rejects(pool.query('DELETE FROM audit_log WHERE id = 1'), /append-only/);
  });
  it('audit export masks PAN', async () => {
    const res = await fetch(`${base}/api/v1/applications/A2000009/audit.csv`, { headers: { authorization: `Bearer ${tokens.compliance}` } });
    const csv = await res.text();
    assert.equal(res.status, 200);
    assert.ok(csv.includes('FIELD_CORRECTED'));
    assert.equal(csv.includes('ZZTPS9012Y'), false);
    assert.ok(csv.includes('ZZTXXXXX2Y'));
  });
  it('dashboard figures reconcile with the underlying data', async () => {
    const d = await api('GET', '/api/v1/dashboard', { token: tokens.compliance });
    const total = Number((await pool.query('SELECT count(*) FROM applications')).rows[0].count);
    assert.equal(d.body.total_applications, total);
    assert.equal(Object.values(d.body.by_status as Record<string, number>).reduce((a, b) => a + b, 0), total);
    const aa = Number((await pool.query("SELECT count(*) FROM applications WHERE status = 'AUTO_APPROVED'")).rows[0].count);
    assert.equal(d.body.straight_through.auto_approved, aa);
    assert.equal(d.body.straight_through.rate, aa / d.body.decided);
    assert.ok(d.body.top_reason_codes.length <= 5);
    const filtered = await api('GET', '/api/v1/dashboard?from=2026-03-05&to=2026-03-05', { token: tokens.compliance });
    assert.ok(filtered.body.total_applications < total);
  });
});

describe('AI provider (challenge 3: AI unavailable -> REVIEW with LOW_EXTRACTION_CONFIDENCE)', () => {
  it('falls back to OTHER/0 when the AI service is down; officer can enter fields manually', async () => {
    const prev = env.AI_SERVICE_URL;
    env.AI_SERVICE_URL = 'http://127.0.0.1:9'; // nothing listens here
    await api('PUT', '/api/v1/admin/settings', { token: tokens.compliance, body: { extraction_provider: 'ai' } });
    try {
    const files = [
      { name: 'D3000198.txt', content: docText('eval', 'D3000198'), type: 'PAN_CARD' },
      { name: 'D3000199.txt', content: docText('eval', 'D3000199'), type: 'AADHAAR_CARD' },
      { name: 'D3000200.txt', content: docText('eval', 'D3000200'), type: 'ELECTRICITY_BILL' },
    ];
    const r = await api('POST', '/api/v1/applications', { token: tokens.applicant, form: appForm(formFromEval('A2100006'), files) });
    await queueIdle();
    const v = await api('GET', `/api/v1/applications/${r.body.application_id}`, { token: tokens.kyc });
    assert.equal(v.body.application.status, 'IN_REVIEW');
    assert.ok(v.body.application.reason_codes.includes('LOW_EXTRACTION_CONFIDENCE'));
    assert.equal(v.body.documents[0].extraction.status, 'FAILED');
    // manual entry by an officer keeps the flow working
    const docId = v.body.documents[0].doc_id;
    const c = await api('POST', `/api/v1/applications/${r.body.application_id}/corrections`, {
      token: tokens.kyc, body: { doc_id: docId, field_name: 'doc_type', new_value: 'PAN_CARD', reason: 'AI unavailable; verified visually' } });
    assert.equal(c.status, 200);
    } finally {
      env.AI_SERVICE_URL = prev;
      await api('PUT', '/api/v1/admin/settings', { token: tokens.compliance, body: { extraction_provider: 'mock' } });
    }
  });

  it('with the AI service up: poor scan read correctly -> AUTO_APPROVED (A2100001)', async (t) => {
    const h = await fetch(`${env.AI_SERVICE_URL}/health`).then((x) => x.ok).catch(() => false);
    if (!h) return t.skip('AI service not running');
    await api('PUT', '/api/v1/admin/settings', { token: tokens.compliance, body: { extraction_provider: 'ai' } });
    const files = [
      { name: 'D3000183.txt', content: docText('eval', 'D3000183'), type: 'PAN_CARD' },
      { name: 'D3000184.txt', content: docText('eval', 'D3000184'), type: 'AADHAAR_CARD' },
      { name: 'D3000185.txt', content: docText('eval', 'D3000185'), type: 'BANK_STATEMENT' },
    ];
    const r = await api('POST', '/api/v1/applications', { token: tokens.applicant, form: appForm(formFromEval('A2100001'), files) });
    await queueIdle();
    const v = await api('GET', `/api/v1/applications/${r.body.application_id}`, { token: tokens.kyc });
    assert.equal(v.body.application.status, 'AUTO_APPROVED', JSON.stringify(v.body.application.reason_codes));
    assert.ok(String(v.body.documents[0].extraction.extractor_version).startsWith('onboardiq-ai-extractor'));
    // prompt-injection document is classified OTHER and cannot approve anything
    const inj = [
      { name: 'D3000483.txt', content: docText('eval', 'D3000483'), type: 'PAN_CARD' },
      { name: 'D3000485.txt', content: docText('eval', 'D3000485'), type: 'ELECTRICITY_BILL' },
      { name: 'D3000486.txt', content: docText('eval', 'D3000486'), type: 'AADHAAR_CARD' },
    ];
    const r2 = await api('POST', '/api/v1/applications', { token: tokens.applicant, form: appForm(formFromEval('A2100100'), inj) });
    await queueIdle();
    const v2 = await api('GET', `/api/v1/applications/${r2.body.application_id}`, { token: tokens.kyc });
    assert.deepEqual(v2.body.application.reason_codes, ['DOCUMENT_MISSING', 'DOCUMENT_TYPE_MISMATCH']);
    assert.equal(v2.body.documents.find((d: any) => d.file_name === 'D3000486.txt').extraction.doc_type, 'OTHER');
    await api('PUT', '/api/v1/admin/settings', { token: tokens.compliance, body: { extraction_provider: 'mock' } });
  });
});
