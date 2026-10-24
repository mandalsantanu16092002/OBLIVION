import type { Decision } from './constants';

export interface ReasonCodeInfo {
  code: string;
  rule: string;
  outcome: Exclude<Decision, 'APPROVE'>;
  /** Short label for officers. */
  title: string;
  /** Plain-language message safe to show the applicant (no watchlist or confidence details). */
  applicantMessage: string;
  /** Explanation for officers. */
  officerMessage: string;
}

export const REASON_CODES: ReasonCodeInfo[] = [
  {
    code: 'DOCUMENT_MISSING',
    rule: 'R1',
    outcome: 'REVIEW',
    title: 'Mandatory document missing',
    applicantMessage:
      'We could not find all mandatory documents. Please make sure you upload a PAN card, an Aadhaar card and one address proof (electricity bill, bank statement or driving licence).',
    officerMessage: 'No document classified as PAN_CARD, AADHAAR_CARD or an address-proof type.',
  },
  {
    code: 'DOCUMENT_TYPE_MISMATCH',
    rule: 'R2',
    outcome: 'REVIEW',
    title: 'Document type differs from declared type',
    applicantMessage:
      'One of your files does not look like the document type you selected for it. An officer will check it.',
    officerMessage: "A document's classified doc_type differs from the declared_doc_type.",
  },
  {
    code: 'LOW_EXTRACTION_CONFIDENCE',
    rule: 'R3',
    outcome: 'REVIEW',
    title: 'Low extraction confidence',
    applicantMessage:
      'Some details on your documents were not clear enough to read automatically. An officer will verify them.',
    officerMessage:
      'A doc_type confidence is below the minimum, or a required field of a selected document is missing or below the minimum confidence.',
  },
  {
    code: 'AGE_BELOW_18',
    rule: 'R4',
    outcome: 'REJECT',
    title: 'Applicant under minimum age',
    applicantMessage: 'You must be at least 18 years old on the application date to open a savings account.',
    officerMessage: 'Age on application_date is below min_age.',
  },
  {
    code: 'PAN_INVALID',
    rule: 'R5',
    outcome: 'REJECT',
    title: 'PAN invalid for an individual',
    applicantMessage:
      'The PAN you entered is not a valid PAN for an individual (the 4th character must be P).',
    officerMessage: 'Declared pan_number does not match the PAN pattern or its holder-type character is not P.',
  },
  {
    code: 'PAN_MISMATCH',
    rule: 'R6',
    outcome: 'REJECT',
    title: 'PAN differs from PAN card',
    applicantMessage: 'The PAN you entered does not match the PAN printed on your PAN card.',
    officerMessage: 'Usable pan_number on the PAN card differs from the declared pan_number.',
  },
  {
    code: 'DOB_MISMATCH',
    rule: 'R7',
    outcome: 'REJECT',
    title: 'Date of birth differs from documents',
    applicantMessage: 'The date of birth you entered does not match the date printed on your identity documents.',
    officerMessage: 'Usable dob on the PAN card or the Aadhaar card differs from the declared dob.',
  },
  {
    code: 'AADHAAR_MISMATCH',
    rule: 'R8',
    outcome: 'REJECT',
    title: 'Aadhaar last 4 digits differ',
    applicantMessage: 'The last 4 Aadhaar digits you entered do not match your Aadhaar card.',
    officerMessage: 'Usable aadhaar_last4 differs from the declared aadhaar_last4.',
  },
  {
    code: 'NAME_MISMATCH',
    rule: 'R9',
    outcome: 'REJECT',
    title: 'Name does not match documents',
    applicantMessage: 'The name you entered does not match the name on your identity documents.',
    officerMessage: 'name_match_score is below name_reject_below.',
  },
  {
    code: 'SANCTIONS_MATCH',
    rule: 'R10',
    outcome: 'REJECT',
    title: 'Sanctions list match',
    applicantMessage: 'We are unable to open an account for you based on our regulatory screening checks.',
    officerMessage: 'Sanctions screening result is MATCH.',
  },
  {
    code: 'NAME_MISMATCH_MINOR',
    rule: 'R11',
    outcome: 'REVIEW',
    title: 'Minor name difference',
    applicantMessage:
      'The name you entered differs slightly from the name on your documents. An officer will verify it.',
    officerMessage: 'name_match_score is from name_reject_below to below name_match_threshold.',
  },
  {
    code: 'DOCUMENT_EXPIRED',
    rule: 'R12',
    outcome: 'REVIEW',
    title: 'Driving licence expired',
    applicantMessage: 'The driving licence you uploaded as address proof has expired.',
    officerMessage: 'Address proof is a DRIVING_LICENCE and valid_until is earlier than application_date.',
  },
  {
    code: 'ADDRESS_PROOF_STALE',
    rule: 'R13',
    outcome: 'REVIEW',
    title: 'Address proof too old or future-dated',
    applicantMessage:
      'Your address proof must be dated within the last 90 days. An officer may ask you for a newer document.',
    officerMessage:
      'Address proof is an ELECTRICITY_BILL or BANK_STATEMENT dated more than address_proof_max_age_days before application_date, or after it.',
  },
  {
    code: 'ADDRESS_MISMATCH',
    rule: 'R14',
    outcome: 'REVIEW',
    title: 'Pincode differs from address proof',
    applicantMessage: 'The pincode you entered differs from the pincode on your address proof. An officer will check it.',
    officerMessage: 'Usable pincode on the address proof differs from the declared pincode.',
  },
  {
    code: 'SANCTIONS_POSSIBLE_MATCH',
    rule: 'R15',
    outcome: 'REVIEW',
    title: 'Possible sanctions match',
    applicantMessage: 'Your application needs an additional routine compliance check.',
    officerMessage: 'Sanctions screening result is POSSIBLE.',
  },
  {
    code: 'PEP_MATCH',
    rule: 'R16',
    outcome: 'REVIEW',
    title: 'Politically exposed person match',
    applicantMessage: 'Your application needs an additional routine compliance check.',
    officerMessage: 'PEP screening result is MATCH (enhanced due diligence).',
  },
  {
    code: 'DUPLICATE_CUSTOMER',
    rule: 'R17',
    outcome: 'REVIEW',
    title: 'Existing customer with same PAN',
    applicantMessage: 'It looks like you may already be a customer of the bank. An officer will check this.',
    officerMessage: 'Declared pan_number exists in existing_customers.',
  },
];

export const REASON_CODE_MAP: Record<string, ReasonCodeInfo> = Object.fromEntries(
  REASON_CODES.map((r) => [r.code, r]),
);

/** Codes whose details must never be shown to applicants beyond the generic message. */
export const SENSITIVE_REASON_CODES = ['SANCTIONS_MATCH', 'SANCTIONS_POSSIBLE_MATCH', 'PEP_MATCH'];

export function applicantReason(code: string): string {
  return REASON_CODE_MAP[code]?.applicantMessage ?? 'Your application needs an additional check.';
}
