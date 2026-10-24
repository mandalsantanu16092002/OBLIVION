import { parseCsv } from './csv';
import { round4 } from './names';
import type {
  EngineApplication,
  EngineDocument,
  EngineResult,
  ReferenceData,
  RulesConfig,
  WatchlistEntry,
} from './types';

export interface ExtractionRow {
  doc_id: string;
  field_name: string;
  value: string;
  confidence: string | number;
}

/** Convert data-pack application rows into engine applications. */
export function toEngineApplication(r: Record<string, string>): EngineApplication {
  return {
    application_id: r.application_id,
    application_date: r.application_date,
    full_name: r.full_name,
    dob: r.dob,
    gender: r.gender,
    pan_number: r.pan_number,
    aadhaar_last4: r.aadhaar_last4,
    pincode: r.pincode,
    occupation_code: r.occupation_code,
    annual_income: Number(r.annual_income || 0),
  };
}

/** Group long-format extraction rows by doc_id. */
export function groupExtraction(rows: ExtractionRow[]): Map<string, ExtractionRow[]> {
  const m = new Map<string, ExtractionRow[]>();
  for (const r of rows) {
    const list = m.get(r.doc_id) ?? [];
    list.push(r);
    m.set(r.doc_id, list);
  }
  return m;
}

/**
 * Build an engine document from extraction rows. An unknown document (no rows) gets doc_type OTHER
 * with confidence 0.00, as required for the mock provider.
 */
export function buildEngineDocument(
  doc_id: string,
  declared_doc_type: string,
  rows: ExtractionRow[] | undefined,
): EngineDocument {
  const fields: EngineDocument['fields'] = {};
  let doc_type = 'OTHER';
  let doc_type_confidence = 0;
  for (const r of rows ?? []) {
    const conf = Number(r.confidence);
    if (r.field_name === 'doc_type') {
      doc_type = r.value || 'OTHER';
      doc_type_confidence = Number.isFinite(conf) ? conf : 0;
    } else {
      fields[r.field_name] = { value: r.value ?? '', confidence: Number.isFinite(conf) ? conf : 0, source: 'EXTRACTION' };
    }
  }
  return { doc_id, declared_doc_type, doc_type, doc_type_confidence, fields };
}

export function loadWatchlists(sanctionsCsv: string, pepCsv: string): { sanctions: WatchlistEntry[]; pep: WatchlistEntry[] } {
  const sanctions = parseCsv(sanctionsCsv).map((r) => ({
    list_type: 'SANCTIONS' as const,
    entry_id: r.list_id,
    name: r.name,
    alias: r.alias || null,
    dob: r.dob || null,
    extra: [r.nationality, r.program].filter(Boolean).join(' / ') || null,
  }));
  const pep = parseCsv(pepCsv).map((r) => ({
    list_type: 'PEP' as const,
    entry_id: r.pep_id,
    name: r.name,
    alias: null,
    dob: r.dob || null,
    extra: [r.position, r.category].filter(Boolean).join(' / ') || null,
  }));
  return { sanctions, pep };
}

export function buildReferenceData(files: {
  sanctionsCsv: string;
  pepCsv: string;
  existingCustomersCsv: string;
  occupationsCsv: string;
}): ReferenceData {
  const { sanctions, pep } = loadWatchlists(files.sanctionsCsv, files.pepCsv);
  const pans = new Set(parseCsv(files.existingCustomersCsv).map((r) => r.pan_number.trim().toUpperCase()));
  const occupationRisk: Record<string, string> = {};
  for (const r of parseCsv(files.occupationsCsv)) occupationRisk[r.occupation_code] = r.risk_level;
  return { sanctions, pep, isExistingCustomerPan: (p) => pans.has(p.trim().toUpperCase()), occupationRisk };
}

export function parseRulesConfig(json: string | object): RulesConfig {
  const c = (typeof json === 'string' ? JSON.parse(json) : json) as RulesConfig;
  return c;
}

export const DECISION_COLUMNS = [
  'application_id',
  'decision',
  'reason_codes',
  'name_match_score',
  'risk_category',
  'rekyc_due_date',
];

/** One output row in the format of Section 6.3. */
export function decisionRow(r: EngineResult): Record<string, string> {
  return {
    application_id: r.application_id,
    decision: r.decision,
    reason_codes: r.reason_codes.join('|'),
    name_match_score: round4(r.name_match_score),
    risk_category: r.risk_category ?? '',
    rekyc_due_date: r.rekyc_due_date ?? '',
  };
}
