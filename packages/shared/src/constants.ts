// Domain constants shared by the API, the rules engine, the batch CLI and the web UI.

export const DOC_TYPES = [
  'PAN_CARD',
  'AADHAAR_CARD',
  'ELECTRICITY_BILL',
  'BANK_STATEMENT',
  'DRIVING_LICENCE',
  'OTHER',
] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Types an applicant may declare when uploading (OTHER is a classification result only). */
export const DECLARABLE_DOC_TYPES = [
  'PAN_CARD',
  'AADHAAR_CARD',
  'ELECTRICITY_BILL',
  'BANK_STATEMENT',
  'DRIVING_LICENCE',
] as const;
export type DeclarableDocType = (typeof DECLARABLE_DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  PAN_CARD: 'PAN card',
  AADHAAR_CARD: 'Aadhaar card',
  ELECTRICITY_BILL: 'Electricity bill',
  BANK_STATEMENT: 'Bank statement',
  DRIVING_LICENCE: 'Driving licence',
  OTHER: 'Other / unrelated',
};

/** Required fields per document type (Section 6.1 Definitions). */
export const REQUIRED_FIELDS: Record<string, string[]> = {
  PAN_CARD: ['name', 'dob', 'pan_number'],
  AADHAAR_CARD: ['name', 'dob', 'aadhaar_last4'],
  ELECTRICITY_BILL: ['pincode', 'document_date'],
  BANK_STATEMENT: ['pincode', 'document_date'],
  DRIVING_LICENCE: ['pincode', 'valid_until'],
  OTHER: [],
};

export const FIELD_NAMES = [
  'name',
  'dob',
  'gender',
  'pan_number',
  'aadhaar_last4',
  'address',
  'pincode',
  'document_date',
  'valid_until',
] as const;
export type FieldName = (typeof FIELD_NAMES)[number];

export const FIELD_LABELS: Record<string, string> = {
  doc_type: 'Document type',
  name: 'Name',
  dob: 'Date of birth',
  gender: 'Gender',
  pan_number: 'PAN',
  aadhaar_last4: 'Aadhaar (last 4)',
  address: 'Address',
  pincode: 'Pincode',
  document_date: 'Document date',
  valid_until: 'Valid until',
};

export const STATUSES = [
  'SUBMITTED',
  'EXTRACTING',
  'AUTO_APPROVED',
  'IN_REVIEW',
  'RESUBMISSION_REQUESTED',
  'PENDING_CHECKER',
  'APPROVED',
  'REJECTED',
  'AUTO_REJECTED',
  'CLOSED_EXPIRED',
] as const;
export type ApplicationStatus = (typeof STATUSES)[number];

export const FINAL_STATUSES: ApplicationStatus[] = [
  'AUTO_APPROVED',
  'APPROVED',
  'REJECTED',
  'AUTO_REJECTED',
  'CLOSED_EXPIRED',
];

/** Allowed transitions (Section 6.1.1 Status Lifecycle). */
export const STATUS_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  SUBMITTED: ['EXTRACTING'],
  EXTRACTING: ['AUTO_APPROVED', 'PENDING_CHECKER', 'IN_REVIEW', 'AUTO_REJECTED'],
  AUTO_APPROVED: [],
  IN_REVIEW: ['PENDING_CHECKER', 'RESUBMISSION_REQUESTED'],
  RESUBMISSION_REQUESTED: ['SUBMITTED', 'CLOSED_EXPIRED'],
  PENDING_CHECKER: ['APPROVED', 'REJECTED', 'IN_REVIEW'],
  APPROVED: [],
  REJECTED: [],
  AUTO_REJECTED: [],
  CLOSED_EXPIRED: [],
};

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  SUBMITTED: 'Submitted',
  EXTRACTING: 'Checking documents',
  AUTO_APPROVED: 'Approved',
  IN_REVIEW: 'Under review',
  RESUBMISSION_REQUESTED: 'Action needed: re-upload documents',
  PENDING_CHECKER: 'Awaiting final approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  AUTO_REJECTED: 'Rejected',
  CLOSED_EXPIRED: 'Closed (no resubmission)',
};

export const ROLES = ['APPLICANT', 'KYC_OFFICER', 'COMPLIANCE_OFFICER'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  APPLICANT: 'Applicant',
  KYC_OFFICER: 'KYC Officer (maker)',
  COMPLIANCE_OFFICER: 'Compliance Officer (checker)',
};

export const DECISIONS = ['APPROVE', 'REVIEW', 'REJECT'] as const;
export type Decision = (typeof DECISIONS)[number];

export const RISK_CATEGORIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export const MAKER_RECOMMENDATIONS = ['APPROVE', 'REJECT', 'REQUEST_RESUBMISSION'] as const;
export type MakerRecommendation = (typeof MAKER_RECOMMENDATIONS)[number];

export const CHECKER_DECISIONS = ['APPROVE', 'REJECT', 'SEND_BACK'] as const;
export type CheckerDecision = (typeof CHECKER_DECISIONS)[number];

export const EXTRACTION_PROVIDERS = ['mock', 'ai'] as const;
export type ExtractionProvider = (typeof EXTRACTION_PROVIDERS)[number];
