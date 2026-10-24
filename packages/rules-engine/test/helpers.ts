import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildEngineDocument,
  buildReferenceData,
  groupExtraction,
  parseCsv,
  parseRulesConfig,
  toEngineApplication,
  type ExtractionRow,
} from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));
export const DATA = resolve(here, '../../../data');
export const read = (p: string) => readFileSync(resolve(DATA, p), 'utf8');

export function loadReference() {
  return buildReferenceData({
    sanctionsCsv: read('reference/case_02_sanctions_list_V1.0.csv'),
    pepCsv: read('reference/case_02_pep_list_V1.0.csv'),
    existingCustomersCsv: read('reference/case_02_existing_customers_V1.0.csv'),
    occupationsCsv: read('reference/case_02_occupations_V1.0.csv'),
  });
}

export function loadConfig() {
  return parseRulesConfig(read('reference/case_02_rules_config_V1.0.json'));
}

export function loadSet(set: 'sample' | 'eval', extractionFile?: string) {
  const apps = parseCsv(read(`${set}/case_02_applications_${set}_V1.0.csv`));
  const docs = parseCsv(read(`${set}/case_02_documents_${set}_V1.0.csv`));
  const extraction = groupExtraction(
    parseCsv(extractionFile ? readFileSync(extractionFile, 'utf8') : read(`${set}/case_02_extraction_mock_${set}_V1.0.csv`)) as unknown as ExtractionRow[],
  );
  return apps.map((a) => ({
    raw: a,
    app: toEngineApplication(a),
    docs: docs
      .filter((d) => d.application_id === a.application_id)
      .map((d) => buildEngineDocument(d.doc_id, d.declared_doc_type, extraction.get(d.doc_id))),
  }));
}
