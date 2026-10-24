/**
 * FR-11 batch command: reads an applications file, its documents file and an extraction file and writes
 * decisions_output.csv (application_id, decision, reason_codes, name_match_score, risk_category, rekyc_due_date).
 * Runs purely on files (no database needed); configuration, watchlists, customers and occupations come from data/reference.
 *
 * Examples (from repo root):
 *   npm run batch:eval        -> output/decisions_output.csv (evaluation set, mock extraction)
 *   npm run batch:ai          -> output/ai_decisions_output.csv (evaluation set, AI extraction_output.csv)
 *   npm run verify:sample     -> checks the 60 sample applications against the expected columns
 *   npm run batch -- --applications A.csv --documents D.csv --extraction E.csv --out out.csv [--config cfg.json]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  buildEngineDocument,
  buildReferenceData,
  DECISION_COLUMNS,
  decisionRow,
  evaluateApplication,
  groupExtraction,
  parseCsv,
  parseRulesConfig,
  toCsv,
  toEngineApplication,
  type ExtractionRow,
} from '@onboardiq/rules-engine';
import { env } from '../config/env';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const set = arg('set');
const D = (p: string) => resolve(env.DATA_DIR, p);
const cwdPath = (p: string) => resolve(process.cwd(), p);

const appsFile = arg('applications') ? cwdPath(arg('applications')!) : D(`${set ?? 'eval'}/case_02_applications_${set ?? 'eval'}_V1.0.csv`);
const docsFile = arg('documents') ? cwdPath(arg('documents')!) : D(`${set ?? 'eval'}/case_02_documents_${set ?? 'eval'}_V1.0.csv`);
const extFile = arg('extraction') ? cwdPath(arg('extraction')!) : D(`${set ?? 'eval'}/case_02_extraction_mock_${set ?? 'eval'}_V1.0.csv`);
const cfgFile = arg('config') ? cwdPath(arg('config')!) : D('reference/case_02_rules_config_V1.0.json');
const outFile = arg('out') ? cwdPath(arg('out')!) : resolve(env.OUTPUT_DIR, 'decisions_output.csv');
const verify = process.argv.includes('--verify');

const t0 = Date.now();
const cfg = parseRulesConfig(readFileSync(cfgFile, 'utf8'));
const ref = buildReferenceData({
  sanctionsCsv: readFileSync(D('reference/case_02_sanctions_list_V1.0.csv'), 'utf8'),
  pepCsv: readFileSync(D('reference/case_02_pep_list_V1.0.csv'), 'utf8'),
  existingCustomersCsv: readFileSync(D('reference/case_02_existing_customers_V1.0.csv'), 'utf8'),
  occupationsCsv: readFileSync(D('reference/case_02_occupations_V1.0.csv'), 'utf8'),
});
const apps = parseCsv(readFileSync(appsFile, 'utf8'));
const docs = parseCsv(readFileSync(docsFile, 'utf8'));
const extraction = groupExtraction(parseCsv(readFileSync(extFile, 'utf8')) as unknown as ExtractionRow[]);

const rows = apps.map((a) => {
  const engineDocs = docs
    .filter((d) => d.application_id === a.application_id)
    .map((d) => buildEngineDocument(d.doc_id, d.declared_doc_type, extraction.get(d.doc_id)));
  return { raw: a, row: decisionRow(evaluateApplication(toEngineApplication(a), engineDocs, cfg, ref)) };
});

if (verify) {
  let ok = 0;
  const cols: [string, string][] = [
    ['decision', 'expected_decision'],
    ['reason_codes', 'expected_reason_codes'],
    ['name_match_score', 'expected_name_match_score'],
    ['risk_category', 'expected_risk_category'],
    ['rekyc_due_date', 'expected_rekyc_due_date'],
  ];
  for (const { raw, row } of rows) {
    const diffs = cols.filter(([c, e]) => (row as any)[c] !== raw[e]).map(([c, e]) => `${c}: got '${(row as any)[c]}' expected '${raw[e]}'`);
    if (diffs.length) console.log(`MISMATCH ${raw.application_id}: ${diffs.join('; ')}`);
    else ok++;
  }
  console.log(`[verify] ${ok}/${rows.length} applications match all expected columns`);
  process.exit(ok === rows.length ? 0 : 1);
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, toCsv(DECISION_COLUMNS, rows.map((r) => r.row)), 'utf8');
const dist = rows.reduce<Record<string, number>>((m, r) => ((m[r.row.decision] = (m[r.row.decision] ?? 0) + 1), m), {});
console.log(`[batch] ${rows.length} applications in ${Date.now() - t0} ms -> ${outFile} ${JSON.stringify(dist)}`);
