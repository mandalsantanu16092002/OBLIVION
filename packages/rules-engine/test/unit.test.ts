import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addYears,
  ageOn,
  buildEngineDocument,
  daysBetween,
  evaluateApplication,
  levenshtein,
  nameSimilarity,
  normaliseName,
  parseCsv,
  round4,
  screen,
  toCsv,
} from '../src/index';
import { loadConfig, loadReference } from './helpers';

const cfg = loadConfig();
const T = cfg.name_title_tokens;

describe('name normalisation and similarity', () => {
  it('normalises per 6.1', () => {
    assert.equal(normaliseName('Ravi Kumar Sharma', T), 'KUMAR RAVI SHARMA');
    assert.equal(normaliseName('Shri Varun Chandra Verma', T), 'CHANDRA VARUN VERMA');
    assert.equal(normaliseName('K. Okonkwo-Lee', T), 'K LEE OKONKWO');
    assert.equal(normaliseName('Dr.  O\'Brien  9', T), 'OBRIEN');
    assert.equal(normaliseName('', T), '');
  });
  it('levenshtein and similarity', () => {
    assert.equal(levenshtein('KUMAR RAVI SHARMA', 'K RAVI SHARMA'), 4);
    assert.equal(round4(nameSimilarity('Ravi Kumar Sharma', 'Ravi K Sharma', T)), '0.7647');
    assert.equal(nameSimilarity('', '', T), 1);
    assert.equal(round4(nameSimilarity('Aisha Gupta', 'Aish Gupta', T)), '0.9091');
    assert.equal(nameSimilarity('Sharma Ravi', 'ravi sharma', T), 1);
  });
});

describe('dates', () => {
  it('age in completed years', () => {
    assert.equal(ageOn('2008-09-10', '2026-03-04'), 17);
    assert.equal(ageOn('2008-03-04', '2026-03-04'), 18);
    assert.equal(ageOn('2008-03-05', '2026-03-04'), 17);
  });
  it('29 February moves to 28 February', () => {
    assert.equal(addYears('2024-02-29', 2), '2026-02-28');
    assert.equal(addYears('2024-02-29', 4), '2028-02-29');
    assert.equal(addYears('2026-03-04', 10), '2036-03-04');
  });
  it('days between', () => {
    assert.equal(daysBetween('2025-11-04', '2026-03-04'), 120);
    assert.equal(daysBetween('2026-03-04', '2026-03-04'), 0);
  });
});

describe('watchlist screening', () => {
  const ref = loadReference();
  it('MATCH when similarity >= 0.90 and dob empty or equal', () => {
    assert.equal(screen('Valko Quillon', '1986-02-23', ref.sanctions, cfg).result, 'MATCH');
    // SAN0048 Tavish Morrigan has an empty dob -> MATCH even with 0.9375 similarity
    const t = screen('Tavish Morrigana', '1979-07-14', ref.sanctions, cfg);
    assert.equal(t.result, 'MATCH');
    assert.equal(t.best?.entry_id, 'SAN0048');
  });
  it('POSSIBLE when dob differs', () => {
    const r = screen('Darius Okonkwo-Lee', '1979-07-14', ref.sanctions, cfg);
    assert.equal(r.result, 'POSSIBLE');
    assert.equal(r.best?.dob_comparison, 'DIFFERENT');
  });
  it('POSSIBLE for similarity in [0.80, 0.90)', () => {
    const r = screen('Nisha Banerjee', '1974-09-11', ref.pep, cfg);
    assert.equal(r.result, 'POSSIBLE');
    assert.equal(r.best?.entry_id, 'PEP0030');
  });
  it('matches on alias', () => {
    const r = screen('K Silvermane', '1950-03-24', ref.sanctions, cfg);
    assert.equal(r.result, 'MATCH');
    assert.equal(r.best?.matched_on, 'alias');
  });
});

describe('engine edge cases', () => {
  const ref = loadReference();
  const app = {
    application_id: 'T1',
    application_date: '2026-03-04',
    full_name: 'Test Person',
    dob: '1990-01-01',
    pan_number: 'ZZAPT1234Q',
    aadhaar_last4: '1234',
    pincode: '400001',
    occupation_code: 'SALARIED_PRIVATE',
    annual_income: 100000,
  };
  const good = () => [
    buildEngineDocument('D1', 'PAN_CARD', [
      { doc_id: 'D1', field_name: 'doc_type', value: 'PAN_CARD', confidence: 0.99 },
      { doc_id: 'D1', field_name: 'name', value: 'Test Person', confidence: 0.99 },
      { doc_id: 'D1', field_name: 'dob', value: '1990-01-01', confidence: 0.99 },
      { doc_id: 'D1', field_name: 'pan_number', value: 'ZZAPT1234Q', confidence: 0.99 },
    ]),
    buildEngineDocument('D2', 'AADHAAR_CARD', [
      { doc_id: 'D2', field_name: 'doc_type', value: 'AADHAAR_CARD', confidence: 0.99 },
      { doc_id: 'D2', field_name: 'name', value: 'Test Person', confidence: 0.99 },
      { doc_id: 'D2', field_name: 'dob', value: '1990-01-01', confidence: 0.99 },
      { doc_id: 'D2', field_name: 'aadhaar_last4', value: '1234', confidence: 0.99 },
    ]),
    buildEngineDocument('D3', 'DRIVING_LICENCE', [
      { doc_id: 'D3', field_name: 'doc_type', value: 'DRIVING_LICENCE', confidence: 0.99 },
      { doc_id: 'D3', field_name: 'pincode', value: '400001', confidence: 0.99 },
      { doc_id: 'D3', field_name: 'valid_until', value: '2026-03-03', confidence: 0.99 },
    ]),
  ];
  it('expired driving licence -> DOCUMENT_EXPIRED', () => {
    const r = evaluateApplication(app, good(), cfg, ref);
    assert.deepEqual(r.reason_codes, ['DOCUMENT_EXPIRED']);
  });
  it('unknown document from the mock -> OTHER 0.00 -> type mismatch + low confidence', () => {
    const docs = [...good(), buildEngineDocument('D4', 'BANK_STATEMENT', undefined)];
    const r = evaluateApplication(app, docs, cfg, ref);
    assert.ok(r.reason_codes.includes('DOCUMENT_TYPE_MISMATCH'));
    assert.ok(r.reason_codes.includes('LOW_EXTRACTION_CONFIDENCE'));
  });
  it('future-dated bill -> ADDRESS_PROOF_STALE; lowest doc_id selected', () => {
    const docs = good().slice(0, 2);
    docs.push(
      buildEngineDocument('D5', 'ELECTRICITY_BILL', [
        { doc_id: 'D5', field_name: 'doc_type', value: 'ELECTRICITY_BILL', confidence: 0.99 },
        { doc_id: 'D5', field_name: 'pincode', value: '400001', confidence: 0.99 },
        { doc_id: 'D5', field_name: 'document_date', value: '2026-03-05', confidence: 0.99 },
      ]),
    );
    const r = evaluateApplication(app, docs, cfg, ref);
    assert.deepEqual(r.reason_codes, ['ADDRESS_PROOF_STALE']);
    assert.equal(r.selected_documents.ADDRESS_PROOF, 'D5');
  });
  it('duplicate customer, DOB mismatch, reject has empty risk', () => {
    const r = evaluateApplication({ ...app, pan_number: 'ZZUPV6368Q', dob: '1990-01-02' }, good(), cfg, ref);
    assert.ok(r.reason_codes.includes('DUPLICATE_CUSTOMER'));
    assert.ok(r.reason_codes.includes('DOB_MISMATCH'));
    assert.equal(r.decision, 'REJECT');
    assert.equal(r.risk_category, null);
    assert.equal(r.rekyc_due_date, null);
  });
  it('income at the MEDIUM threshold -> MEDIUM risk / 8 years', () => {
    const docs = good();
    docs[2].fields.valid_until = { value: '2030-01-01', confidence: 0.99 };
    const r = evaluateApplication({ ...app, annual_income: 2500000 }, docs, cfg, ref);
    assert.equal(r.risk_category, 'MEDIUM');
    assert.equal(r.rekyc_due_date, '2034-03-04');
  });
});

describe('csv', () => {
  it('round trips quoted values', () => {
    const csv = toCsv(['a', 'b'], [['x, y', 'he said "hi"']]);
    assert.deepEqual(parseCsv(csv), [{ a: 'x, y', b: 'he said "hi"' }]);
  });
});
