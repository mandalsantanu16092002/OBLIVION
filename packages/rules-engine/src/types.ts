import type { Decision, RiskCategory } from '@onboardiq/shared';

/** Rule configuration (loaded from case_02_rules_config_V1.0.json into the configuration table). */
export interface RulesConfig {
  version: string;
  min_field_confidence: number;
  min_age: number;
  pan_pattern: string;
  pan_holder_type_char: string;
  name_match_threshold: number;
  name_reject_below: number;
  watchlist_match_threshold: number;
  watchlist_possible_threshold: number;
  address_proof_max_age_days: number;
  medium_risk_income: number;
  rekyc_years: { HIGH: number; MEDIUM: number; LOW: number };
  name_title_tokens: string[];
  mandatory_documents: string[];
  address_proof_types: string[];
  resubmission_sla_days: number;
  checker_sla_hours: number;
}

export interface EngineApplication {
  application_id: string;
  application_date: string; // YYYY-MM-DD (IST calendar date)
  full_name: string;
  dob: string;
  gender?: string;
  pan_number: string;
  aadhaar_last4: string;
  pincode: string;
  occupation_code: string;
  annual_income: number;
}

export interface ExtractedField {
  value: string | null;
  confidence: number;
  source?: 'EXTRACTION' | 'OFFICER';
}

export interface EngineDocument {
  doc_id: string;
  declared_doc_type: string;
  /** doc_type returned by the extraction service (OTHER when unknown / failed). */
  doc_type: string;
  doc_type_confidence: number;
  fields: Record<string, ExtractedField>;
}

export interface WatchlistEntry {
  list_type: 'SANCTIONS' | 'PEP';
  entry_id: string;
  name: string;
  alias?: string | null;
  dob?: string | null;
  extra?: string | null;
}

export interface ReferenceData {
  sanctions: WatchlistEntry[];
  pep: WatchlistEntry[];
  /** Declared PAN lookup in existing customers. */
  isExistingCustomerPan: (pan: string) => boolean;
  /** occupation_code -> risk_level (LOW/MEDIUM/HIGH). */
  occupationRisk: Record<string, string>;
}

export type ScreeningResult = 'MATCH' | 'POSSIBLE' | 'NONE';

export interface ScreeningHit {
  list_type: 'SANCTIONS' | 'PEP';
  entry_id: string;
  entry_name: string;
  matched_on: 'name' | 'alias';
  matched_value: string;
  similarity: number;
  entry_dob: string | null;
  declared_dob: string;
  dob_comparison: 'EQUAL' | 'DIFFERENT' | 'ENTRY_DOB_EMPTY';
  result: Exclude<ScreeningResult, 'NONE'>;
}

export interface ScreeningOutcome {
  result: ScreeningResult;
  /** Best hit (MATCH first, then highest similarity). */
  best: ScreeningHit | null;
  hits: ScreeningHit[];
}

export interface RuleResult {
  rule: string;
  code: string;
  outcome: 'REVIEW' | 'REJECT';
  /** false when the rule was skipped because a field it depends on is not usable. */
  evaluated: boolean;
  triggered: boolean;
  /** Values compared, for explainability. */
  details: Record<string, unknown>;
  message: string;
}

export interface NameComparison {
  source: 'PAN_CARD' | 'AADHAAR_CARD';
  doc_id: string;
  document_name: string;
  usable: boolean;
  normalised_declared: string;
  normalised_document: string;
  similarity: number | null;
}

export interface EngineResult {
  application_id: string;
  decision: Decision;
  reason_codes: string[];
  name_match_score: number | null;
  risk_category: RiskCategory | null;
  rekyc_due_date: string | null;
  /** Computed risk even for REJECT (not reported), useful for the officer screen. */
  computed_risk_category: RiskCategory;
  age: number;
  selected_documents: {
    PAN_CARD: string | null;
    AADHAAR_CARD: string | null;
    ADDRESS_PROOF: string | null;
    ADDRESS_PROOF_TYPE: string | null;
  };
  rules: RuleResult[];
  name_comparisons: NameComparison[];
  sanctions: ScreeningOutcome;
  pep: ScreeningOutcome;
  documents: { doc_id: string; declared_doc_type: string; doc_type: string; doc_type_confidence: number }[];
  config_version: string;
  evaluated_at: string;
}
