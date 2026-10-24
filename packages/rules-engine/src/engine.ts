import { REASON_CODE_MAP, type Decision, type RiskCategory } from '@onboardiq/shared';
import { addYears, ageOn, daysBetween, isIsoDate } from './dates';
import { normaliseName, similarityNormalised } from './names';
import { screen } from './screening';
import type {
  EngineApplication,
  EngineDocument,
  EngineResult,
  ExtractedField,
  NameComparison,
  ReferenceData,
  RuleResult,
  RulesConfig,
} from './types';

const docIdCompare = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

const REQUIRED_FIELDS: Record<string, string[]> = {
  PAN_CARD: ['name', 'dob', 'pan_number'],
  AADHAAR_CARD: ['name', 'dob', 'aadhaar_last4'],
  ELECTRICITY_BILL: ['pincode', 'document_date'],
  BANK_STATEMENT: ['pincode', 'document_date'],
  DRIVING_LICENCE: ['pincode', 'valid_until'],
};

/** A field is usable when present, not empty and its confidence is at least min_field_confidence. */
export function isUsable(f: ExtractedField | undefined, cfg: RulesConfig): f is ExtractedField & { value: string } {
  return (
    !!f &&
    f.value !== null &&
    f.value !== undefined &&
    String(f.value).trim() !== '' &&
    Number(f.confidence) >= cfg.min_field_confidence
  );
}

/** Lowest doc_id per classified type; address proof = lowest doc_id among the address-proof types. */
export function selectDocuments(docs: EngineDocument[], cfg: RulesConfig) {
  const sorted = [...docs].sort((a, b) => docIdCompare(a.doc_id, b.doc_id));
  const first = (pred: (d: EngineDocument) => boolean) => sorted.find(pred) ?? null;
  const pan = first((d) => d.doc_type === 'PAN_CARD');
  const aadhaar = first((d) => d.doc_type === 'AADHAAR_CARD');
  const addressProof = first((d) => cfg.address_proof_types.includes(d.doc_type));
  return { pan, aadhaar, addressProof };
}

export function evaluateApplication(
  app: EngineApplication,
  docs: EngineDocument[],
  cfg: RulesConfig,
  ref: ReferenceData,
): EngineResult {
  const minConf = cfg.min_field_confidence;
  const { pan, aadhaar, addressProof } = selectDocuments(docs, cfg);
  const field = (d: EngineDocument | null, name: string) => (d ? d.fields[name] : undefined);
  const usable = (d: EngineDocument | null, name: string) => isUsable(field(d, name), cfg);
  const val = (d: EngineDocument | null, name: string) => String(field(d, name)?.value ?? '').trim();

  const rules: RuleResult[] = [];
  const add = (rule: string, code: string, evaluated: boolean, triggered: boolean, details: Record<string, unknown>) => {
    const info = REASON_CODE_MAP[code];
    rules.push({
      rule,
      code,
      outcome: info.outcome,
      evaluated,
      triggered: evaluated && triggered,
      details,
      message: info.officerMessage,
    });
  };

  // ---- R1 DOCUMENT_MISSING ----------------------------------------------------------
  const missing: string[] = [];
  const mandatory = cfg.mandatory_documents ?? ['PAN_CARD', 'AADHAAR_CARD', 'ADDRESS_PROOF'];
  if (mandatory.includes('PAN_CARD') && !pan) missing.push('PAN_CARD');
  if (mandatory.includes('AADHAAR_CARD') && !aadhaar) missing.push('AADHAAR_CARD');
  if (mandatory.includes('ADDRESS_PROOF') && !addressProof) missing.push('ADDRESS_PROOF');
  add('R1', 'DOCUMENT_MISSING', true, missing.length > 0, { missing });

  // ---- R2 DOCUMENT_TYPE_MISMATCH ----------------------------------------------------
  const mismatches = docs
    .filter((d) => d.doc_type !== d.declared_doc_type)
    .map((d) => ({ doc_id: d.doc_id, declared: d.declared_doc_type, classified: d.doc_type }));
  add('R2', 'DOCUMENT_TYPE_MISMATCH', true, mismatches.length > 0, { mismatches });

  // ---- R3 LOW_EXTRACTION_CONFIDENCE -------------------------------------------------
  const lowDocType = docs
    .filter((d) => !(Number(d.doc_type_confidence) >= minConf))
    .map((d) => ({ doc_id: d.doc_id, doc_type: d.doc_type, confidence: d.doc_type_confidence }));
  const lowFields: { doc_id: string; doc_type: string; field: string; value: string | null; confidence: number | null }[] = [];
  for (const d of [pan, aadhaar, addressProof]) {
    if (!d) continue;
    for (const f of REQUIRED_FIELDS[d.doc_type] ?? []) {
      const fv = d.fields[f];
      if (!isUsable(fv, cfg)) {
        lowFields.push({
          doc_id: d.doc_id,
          doc_type: d.doc_type,
          field: f,
          value: fv?.value ?? null,
          confidence: fv ? Number(fv.confidence) : null,
        });
      }
    }
  }
  add('R3', 'LOW_EXTRACTION_CONFIDENCE', true, lowDocType.length > 0 || lowFields.length > 0, {
    min_field_confidence: minConf,
    low_doc_type_confidence: lowDocType,
    low_or_missing_fields: lowFields,
  });

  // ---- R4 AGE_BELOW_18 --------------------------------------------------------------
  const dobValid = isIsoDate(app.dob) && isIsoDate(app.application_date);
  const age = dobValid ? ageOn(app.dob, app.application_date) : NaN;
  add('R4', 'AGE_BELOW_18', dobValid, dobValid && age < cfg.min_age, {
    declared_dob: app.dob,
    application_date: app.application_date,
    age,
    min_age: cfg.min_age,
  });

  // ---- R5 PAN_INVALID ---------------------------------------------------------------
  const declaredPan = String(app.pan_number ?? '').trim().toUpperCase();
  const panRe = new RegExp(cfg.pan_pattern);
  const panFormatOk = panRe.test(declaredPan);
  const holderChar = declaredPan.charAt(3);
  add('R5', 'PAN_INVALID', true, !panFormatOk || holderChar !== cfg.pan_holder_type_char, {
    declared_pan: declaredPan,
    pattern: cfg.pan_pattern,
    format_ok: panFormatOk,
    holder_type_char: holderChar,
    expected_holder_type_char: cfg.pan_holder_type_char,
  });

  // ---- R6 PAN_MISMATCH --------------------------------------------------------------
  const panUsable = usable(pan, 'pan_number');
  const panRead = panUsable ? val(pan, 'pan_number').toUpperCase() : null;
  add('R6', 'PAN_MISMATCH', panUsable, panUsable && panRead !== declaredPan, {
    declared_pan: declaredPan,
    pan_on_card: panRead,
    doc_id: pan?.doc_id ?? null,
    confidence: field(pan, 'pan_number')?.confidence ?? null,
  });

  // ---- R7 DOB_MISMATCH --------------------------------------------------------------
  const dobChecks: { source: string; doc_id: string; dob: string; matches: boolean }[] = [];
  for (const [src, d] of [['PAN_CARD', pan], ['AADHAAR_CARD', aadhaar]] as const) {
    if (d && usable(d, 'dob')) dobChecks.push({ source: src, doc_id: d.doc_id, dob: val(d, 'dob'), matches: val(d, 'dob') === app.dob });
  }
  add('R7', 'DOB_MISMATCH', dobChecks.length > 0, dobChecks.some((c) => !c.matches), {
    declared_dob: app.dob,
    compared: dobChecks,
  });

  // ---- R8 AADHAAR_MISMATCH ----------------------------------------------------------
  const aUsable = usable(aadhaar, 'aadhaar_last4');
  const aRead = aUsable ? val(aadhaar, 'aadhaar_last4') : null;
  add('R8', 'AADHAAR_MISMATCH', aUsable, aUsable && aRead !== String(app.aadhaar_last4).trim(), {
    declared_aadhaar_last4: app.aadhaar_last4,
    aadhaar_last4_on_card: aRead,
    doc_id: aadhaar?.doc_id ?? null,
  });

  // ---- Name match score (used by R9 / R11) ------------------------------------------
  const declaredNorm = normaliseName(app.full_name, cfg.name_title_tokens);
  const nameComparisons: NameComparison[] = [];
  for (const [src, d] of [['PAN_CARD', pan], ['AADHAAR_CARD', aadhaar]] as const) {
    if (!d) continue;
    const u = usable(d, 'name');
    const docNorm = normaliseName(val(d, 'name'), cfg.name_title_tokens);
    nameComparisons.push({
      source: src,
      doc_id: d.doc_id,
      document_name: val(d, 'name'),
      usable: u,
      normalised_declared: declaredNorm,
      normalised_document: docNorm,
      similarity: u ? similarityNormalised(declaredNorm, docNorm) : null,
    });
  }
  const usableScores = nameComparisons.filter((c) => c.usable).map((c) => c.similarity as number);
  const nameScore = usableScores.length > 0 ? Math.min(...usableScores) : null;

  // ---- R9 NAME_MISMATCH -------------------------------------------------------------
  add('R9', 'NAME_MISMATCH', nameScore !== null, nameScore !== null && nameScore < cfg.name_reject_below, {
    name_match_score: nameScore,
    name_reject_below: cfg.name_reject_below,
    comparisons: nameComparisons,
  });

  // ---- Screening ----------------------------------------------------------------------
  const sanctions = screen(app.full_name, app.dob, ref.sanctions, cfg);
  const pep = screen(app.full_name, app.dob, ref.pep, cfg);

  // ---- R10 SANCTIONS_MATCH ----------------------------------------------------------
  add('R10', 'SANCTIONS_MATCH', true, sanctions.result === 'MATCH', {
    result: sanctions.result,
    best: sanctions.best,
  });

  // ---- R11 NAME_MISMATCH_MINOR ------------------------------------------------------
  add(
    'R11',
    'NAME_MISMATCH_MINOR',
    nameScore !== null,
    nameScore !== null && nameScore >= cfg.name_reject_below && nameScore < cfg.name_match_threshold,
    {
      name_match_score: nameScore,
      name_reject_below: cfg.name_reject_below,
      name_match_threshold: cfg.name_match_threshold,
      comparisons: nameComparisons,
    },
  );

  // ---- R12 DOCUMENT_EXPIRED ---------------------------------------------------------
  const isDl = addressProof?.doc_type === 'DRIVING_LICENCE';
  const vuUsable = isDl && usable(addressProof, 'valid_until') && isIsoDate(val(addressProof, 'valid_until'));
  const validUntil = vuUsable ? val(addressProof, 'valid_until') : null;
  add('R12', 'DOCUMENT_EXPIRED', !!vuUsable, !!validUntil && validUntil < app.application_date, {
    address_proof_doc_id: addressProof?.doc_id ?? null,
    address_proof_type: addressProof?.doc_type ?? null,
    valid_until: validUntil,
    application_date: app.application_date,
  });

  // ---- R13 ADDRESS_PROOF_STALE ------------------------------------------------------
  const isBill = addressProof?.doc_type === 'ELECTRICITY_BILL' || addressProof?.doc_type === 'BANK_STATEMENT';
  const ddUsable = isBill && usable(addressProof, 'document_date') && isIsoDate(val(addressProof, 'document_date'));
  const docDate = ddUsable ? val(addressProof, 'document_date') : null;
  const ageDays = docDate ? daysBetween(docDate, app.application_date) : null;
  add(
    'R13',
    'ADDRESS_PROOF_STALE',
    !!ddUsable,
    ageDays !== null && (ageDays > cfg.address_proof_max_age_days || ageDays < 0),
    {
      address_proof_doc_id: addressProof?.doc_id ?? null,
      address_proof_type: addressProof?.doc_type ?? null,
      document_date: docDate,
      application_date: app.application_date,
      age_days: ageDays,
      max_age_days: cfg.address_proof_max_age_days,
    },
  );

  // ---- R14 ADDRESS_MISMATCH ---------------------------------------------------------
  const pinUsable = usable(addressProof, 'pincode');
  const pinRead = pinUsable ? val(addressProof, 'pincode') : null;
  add('R14', 'ADDRESS_MISMATCH', pinUsable, pinUsable && pinRead !== String(app.pincode).trim(), {
    declared_pincode: app.pincode,
    pincode_on_address_proof: pinRead,
    address_proof_doc_id: addressProof?.doc_id ?? null,
  });

  // ---- R15 SANCTIONS_POSSIBLE_MATCH -------------------------------------------------
  add('R15', 'SANCTIONS_POSSIBLE_MATCH', true, sanctions.result === 'POSSIBLE', {
    result: sanctions.result,
    best: sanctions.best,
  });

  // ---- R16 PEP_MATCH ----------------------------------------------------------------
  add('R16', 'PEP_MATCH', true, pep.result === 'MATCH', { result: pep.result, best: pep.best });

  // ---- R17 DUPLICATE_CUSTOMER -------------------------------------------------------
  const dup = ref.isExistingCustomerPan(declaredPan);
  add('R17', 'DUPLICATE_CUSTOMER', true, dup, { declared_pan: declaredPan, exists: dup });

  // ---- Decision ---------------------------------------------------------------------
  const triggered = rules.filter((r) => r.triggered);
  const reason_codes = triggered.map((r) => r.code); // already in rule order R1..R17
  const decision: Decision = triggered.some((r) => r.outcome === 'REJECT')
    ? 'REJECT'
    : triggered.length > 0
      ? 'REVIEW'
      : 'APPROVE';

  // ---- Risk category and re-KYC (6.1.2) ---------------------------------------------
  const occRisk = (ref.occupationRisk[app.occupation_code] ?? 'LOW').toUpperCase();
  let risk: RiskCategory = 'LOW';
  if (reason_codes.includes('PEP_MATCH') || reason_codes.includes('SANCTIONS_POSSIBLE_MATCH') || occRisk === 'HIGH') {
    risk = 'HIGH';
  } else if (occRisk === 'MEDIUM' || Number(app.annual_income) >= cfg.medium_risk_income) {
    risk = 'MEDIUM';
  }
  const reportRisk = decision !== 'REJECT';

  return {
    application_id: app.application_id,
    decision,
    reason_codes,
    name_match_score: nameScore,
    risk_category: reportRisk ? risk : null,
    rekyc_due_date: reportRisk ? addYears(app.application_date, cfg.rekyc_years[risk]) : null,
    computed_risk_category: risk,
    age,
    selected_documents: {
      PAN_CARD: pan?.doc_id ?? null,
      AADHAAR_CARD: aadhaar?.doc_id ?? null,
      ADDRESS_PROOF: addressProof?.doc_id ?? null,
      ADDRESS_PROOF_TYPE: addressProof?.doc_type ?? null,
    },
    rules,
    name_comparisons: nameComparisons,
    sanctions,
    pep,
    documents: docs.map((d) => ({
      doc_id: d.doc_id,
      declared_doc_type: d.declared_doc_type,
      doc_type: d.doc_type,
      doc_type_confidence: d.doc_type_confidence,
    })),
    config_version: cfg.version,
    evaluated_at: new Date().toISOString(),
  };
}

/** Routing (6.1.2): APPROVE LOW/MEDIUM -> AUTO_APPROVED; APPROVE HIGH -> PENDING_CHECKER; REVIEW -> IN_REVIEW; REJECT -> AUTO_REJECTED. */
export function routeDecision(result: Pick<EngineResult, 'decision' | 'risk_category'>) {
  if (result.decision === 'REJECT') return 'AUTO_REJECTED' as const;
  if (result.decision === 'REVIEW') return 'IN_REVIEW' as const;
  return result.risk_category === 'HIGH' ? ('PENDING_CHECKER' as const) : ('AUTO_APPROVED' as const);
}
