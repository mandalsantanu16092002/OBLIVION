import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decisionRow, evaluateApplication, routeDecision } from '../src/index';
import { loadConfig, loadReference, loadSet } from './helpers';

describe('FR-4: all 60 sample applications match the expected columns (mock extraction)', () => {
  const cfg = loadConfig();
  const ref = loadReference();
  for (const { raw, app, docs } of loadSet('sample')) {
    it(`${app.application_id} -> ${raw.expected_decision} ${raw.expected_reason_codes}`, () => {
      const row = decisionRow(evaluateApplication(app, docs, cfg, ref));
      assert.equal(row.decision, raw.expected_decision, 'decision');
      assert.equal(row.reason_codes, raw.expected_reason_codes, 'reason codes');
      assert.equal(row.name_match_score, raw.expected_name_match_score, 'name_match_score');
      assert.equal(row.risk_category, raw.expected_risk_category, 'risk');
      assert.equal(row.rekyc_due_date, raw.expected_rekyc_due_date, 'rekyc');
    });
  }
});

describe('Worked examples', () => {
  const cfg = loadConfig();
  const ref = loadReference();
  const set = Object.fromEntries(loadSet('sample').map((s) => [s.app.application_id, s]));
  const run = (id: string, c = cfg) => evaluateApplication(set[id].app, set[id].docs, c, ref);

  it('Example 1 -> AUTO_APPROVED', () => {
    const r = run('A2000001');
    assert.equal(r.decision, 'APPROVE');
    assert.equal(routeDecision(r), 'AUTO_APPROVED');
  });

  it('Example 4 shows 0.7647 and NAME_MISMATCH_MINOR', () => {
    const r = run('A2000004');
    assert.equal(decisionRow(r).name_match_score, '0.7647');
    assert.deepEqual(r.reason_codes, ['NAME_MISMATCH_MINOR']);
    const pan = r.name_comparisons.find((c) => c.source === 'PAN_CARD')!;
    assert.equal(pan.normalised_declared, 'KUMAR RAVI SHARMA');
    assert.equal(pan.normalised_document, 'K RAVI SHARMA');
  });

  it('Examples 6 and 7 show the matched list entries SAN0002 and PEP0001', () => {
    assert.equal(run('A2000006').sanctions.best?.entry_id, 'SAN0002');
    assert.equal(run('A2000007').pep.best?.entry_id, 'PEP0001');
    assert.equal(run('A2000007').risk_category, 'HIGH');
  });

  it('Example 9: PAN_MISMATCH is not evaluated because the field is not usable', () => {
    const r = run('A2000009');
    const r6 = r.rules.find((x) => x.rule === 'R6')!;
    assert.equal(r6.evaluated, false);
    assert.deepEqual(r.reason_codes, ['LOW_EXTRACTION_CONFIDENCE']);
  });

  it('Example 12: officer correction of the PAN (confidence 1.00) gives APPROVE', () => {
    const s = set['A2000009'];
    const docs = s.docs.map((d) =>
      d.doc_id === 'D3000025'
        ? { ...d, fields: { ...d.fields, pan_number: { value: 'ZZTPS9012Y', confidence: 1, source: 'OFFICER' as const } } }
        : d,
    );
    const r = evaluateApplication(s.app, docs, cfg, ref);
    assert.equal(r.decision, 'APPROVE');
    assert.deepEqual(r.reason_codes, []);
  });

  it('Example 10: HIGH-risk APPROVE routes to PENDING_CHECKER', () => {
    const r = run('A2000010');
    assert.equal(r.decision, 'APPROVE');
    assert.equal(r.risk_category, 'HIGH');
    assert.equal(routeDecision(r), 'PENDING_CHECKER');
  });

  it('Change challenge 1: name_match_threshold 0.85 keeps example 4 in REVIEW; configuration only', () => {
    const r = run('A2000004', { ...cfg, name_match_threshold: 0.85 });
    assert.equal(r.decision, 'REVIEW');
    // and a 0.88 case becomes APPROVE: synthesise one by lowering the threshold below the score
    const r2 = run('A2000004', { ...cfg, name_match_threshold: 0.76 });
    assert.equal(r2.decision, 'APPROVE');
  });

  it('Changing min_field_confidence changes R3 without code change', () => {
    const r = run('A2000013', { ...cfg, min_field_confidence: 0.6 });
    assert.equal(r.decision, 'APPROVE');
  });
});
