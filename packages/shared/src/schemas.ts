import { z } from 'zod';
import {
  CHECKER_DECISIONS,
  DECLARABLE_DOC_TYPES,
  FIELD_NAMES,
  MAKER_RECOMMENDATIONS,
} from './constants';

export const DEFAULT_PAN_PATTERN = '^[A-Z]{5}[0-9]{4}[A-Z]$';
export const AADHAAR_LAST4_PATTERN = /^[0-9]{4}$/;
export const MOBILE_PATTERN = /^[6-9][0-9]{9}$/;
export const PINCODE_PATTERN = /^[1-9][0-9]{5}$/;
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE_PATTERN.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const isoDate = (label: string) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .refine((v) => isValidIsoDate(v), { message: `${label} must be a valid date (YYYY-MM-DD)` });

export interface ApplicationSchemaOptions {
  /** PAN format pattern from configuration (rules_config.pan_pattern). */
  panPattern?: string;
  /** Business date (YYYY-MM-DD, IST) used for "dob not in the future". */
  today: string;
  /** Known occupation codes (from the occupations table). */
  occupationCodes?: string[];
}

/** Application form schema (Section 4 validation). Built per request so patterns come from configuration. */
export function makeApplicationSchema(opts: ApplicationSchemaOptions) {
  const panRe = new RegExp(opts.panPattern || DEFAULT_PAN_PATTERN);
  return z.object({
    full_name: z
      .string({ required_error: 'Full name is required' })
      .trim()
      .min(2, 'Full name must have at least 2 characters')
      .max(120, 'Full name is too long')
      .regex(/^[A-Za-z][A-Za-z .'-]*$/, 'Full name may contain letters, spaces, dots, hyphens and apostrophes only'),
    dob: isoDate('Date of birth').refine((v) => v <= opts.today, {
      message: 'Date of birth cannot be in the future',
    }),
    gender: z.enum(['M', 'F', 'O'], {
      errorMap: () => ({ message: 'Gender must be M, F or O' }),
    }),
    pan_number: z
      .string({ required_error: 'PAN is required' })
      .trim()
      .transform((v) => v.toUpperCase())
      .refine((v) => panRe.test(v), {
        message: 'PAN must have the format AAAAA9999A (5 letters, 4 digits, 1 letter)',
      }),
    aadhaar_last4: z
      .string({ required_error: 'Aadhaar last 4 digits are required' })
      .trim()
      .superRefine((v, ctx) => {
        const digits = v.replace(/\s/g, '');
        if (/^[0-9]{12}$/.test(digits)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'Enter only the LAST 4 digits of your Aadhaar. Full 12-digit Aadhaar numbers are never accepted or stored.',
          });
          return;
        }
        if (!AADHAAR_LAST4_PATTERN.test(v)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Aadhaar last 4 must be exactly 4 digits' });
        }
      }),
    mobile: z
      .string({ required_error: 'Mobile number is required' })
      .trim()
      .regex(MOBILE_PATTERN, 'Mobile must be 10 digits starting with 6, 7, 8 or 9'),
    email: z.string({ required_error: 'Email is required' }).trim().toLowerCase().email('Enter a valid email address'),
    address: z
      .string({ required_error: 'Address is required' })
      .trim()
      .min(5, 'Address is too short')
      .max(300, 'Address is too long'),
    city: z.string({ required_error: 'City is required' }).trim().min(2, 'City is required').max(60),
    state: z.string({ required_error: 'State is required' }).trim().min(2, 'State is required').max(60),
    pincode: z
      .string({ required_error: 'Pincode is required' })
      .trim()
      .regex(PINCODE_PATTERN, 'Pincode must be 6 digits and cannot start with 0'),
    occupation_code: z
      .string({ required_error: 'Occupation is required' })
      .trim()
      .refine((v) => !opts.occupationCodes || opts.occupationCodes.includes(v), {
        message: 'Select a valid occupation',
      }),
    annual_income: z.coerce
      .number({ invalid_type_error: 'Annual income must be a number' })
      .int('Annual income must be a whole number of rupees')
      .min(0, 'Annual income cannot be negative')
      .max(100_000_000_000, 'Annual income is too large'),
    kyc_consent: z.preprocess(
      (v) => v === true || v === 'true' || v === 'on' || v === '1',
      z.literal(true, { errorMap: () => ({ message: 'Consent to KYC checks is mandatory' }) }),
    ),
  });
}
export type ApplicationInput = z.infer<ReturnType<typeof makeApplicationSchema>>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z.object({
  full_name: z.string().trim().min(2, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must have at least 8 characters')
    .max(72, 'Password is too long')
    .regex(/[A-Za-z]/, 'Password must contain a letter')
    .regex(/[0-9]/, 'Password must contain a digit'),
});

export const declaredTypesSchema = z.array(z.enum(DECLARABLE_DOC_TYPES, {
  errorMap: () => ({ message: 'Choose a valid document type for every file' }),
}));

export const fieldCorrectionSchema = z.object({
  doc_id: z.string().trim().min(1),
  field_name: z.enum([...FIELD_NAMES, 'doc_type'] as [string, ...string[]], {
    errorMap: () => ({ message: 'Unknown field' }),
  }),
  new_value: z.string().trim().min(1, 'New value is required').max(300),
  reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500),
  expected_version: z.number().int().optional(),
});

export const recommendationSchema = z.object({
  recommendation: z.enum(MAKER_RECOMMENDATIONS),
  comment: z.string().trim().min(10, 'Comment must have at least 10 characters').max(2000),
  expected_version: z.number().int().optional(),
});

export const checkerDecisionSchema = z.object({
  decision: z.enum(CHECKER_DECISIONS),
  comment: z.string().trim().min(10, 'Comment must have at least 10 characters').max(2000),
  expected_version: z.number().int().optional(),
});

export const configUpdateSchema = z.object({
  min_field_confidence: z.number().min(0).max(1).optional(),
  min_age: z.number().int().min(0).max(120).optional(),
  pan_pattern: z.string().min(1).optional(),
  pan_holder_type_char: z.string().length(1).optional(),
  name_match_threshold: z.number().min(0).max(1).optional(),
  name_reject_below: z.number().min(0).max(1).optional(),
  watchlist_match_threshold: z.number().min(0).max(1).optional(),
  watchlist_possible_threshold: z.number().min(0).max(1).optional(),
  address_proof_max_age_days: z.number().int().min(0).max(3650).optional(),
  medium_risk_income: z.number().min(0).optional(),
  rekyc_years: z
    .object({ HIGH: z.number().int().min(0), MEDIUM: z.number().int().min(0), LOW: z.number().int().min(0) })
    .optional(),
  name_title_tokens: z.array(z.string().min(1)).optional(),
  resubmission_sla_days: z.number().int().min(1).max(365).optional(),
  checker_sla_hours: z.number().int().min(1).max(10000).optional(),
});

export const watchlistEntrySchema = z.object({
  list_type: z.enum(['SANCTIONS', 'PEP']),
  entry_id: z.string().trim().min(1).max(30),
  name: z.string().trim().min(2).max(120),
  alias: z.string().trim().max(120).optional().nullable(),
  dob: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine((v) => !v || isValidIsoDate(v), { message: 'dob must be YYYY-MM-DD' }),
  extra: z.string().trim().max(200).optional().nullable(),
});

export const settingsUpdateSchema = z.object({
  extraction_provider: z.enum(['mock', 'ai']).optional(),
  business_date: z
    .string()
    .trim()
    .nullable()
    .optional()
    .refine((v) => !v || isValidIsoDate(v), { message: 'business_date must be YYYY-MM-DD' }),
});
