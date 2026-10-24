import { DOC_TYPE_LABELS, FIELD_LABELS, STATUS_LABELS, type ApplicationStatus } from '@onboardiq/shared';

export const fmtDate = (d?: string | null) =>
  d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const fmtDateTime = (d?: string | null) =>
  d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export const fmtInr = (n?: number | string | null) =>
  n === null || n === undefined || n === '' ? '—' : '₹' + Number(n).toLocaleString('en-IN');

export const pct = (x?: number | null, digits = 1) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(digits)}%`);

export const docLabel = (t?: string | null) => (t ? DOC_TYPE_LABELS[t as keyof typeof DOC_TYPE_LABELS] ?? t : '—');
export const fieldLabel = (f: string) => FIELD_LABELS[f] ?? f;
export const statusLabel = (s: string) => STATUS_LABELS[s as ApplicationStatus] ?? s;

export function statusTone(s: string): 'green' | 'red' | 'amber' | 'teal' | 'violet' | '' {
  if (s === 'AUTO_APPROVED' || s === 'APPROVED') return 'green';
  if (s === 'AUTO_REJECTED' || s === 'REJECTED' || s === 'CLOSED_EXPIRED') return 'red';
  if (s === 'IN_REVIEW' || s === 'RESUBMISSION_REQUESTED') return 'amber';
  if (s === 'PENDING_CHECKER') return 'violet';
  return 'teal';
}

export function decisionTone(d?: string | null) {
  return d === 'APPROVE' ? 'var(--leaf)' : d === 'REJECT' ? 'var(--brick)' : d === 'REVIEW' ? 'var(--saffron)' : 'var(--muted)';
}

export const riskTone = (r?: string | null) => (r === 'HIGH' ? 'red' : r === 'MEDIUM' ? 'amber' : r === 'LOW' ? 'green' : '');

export function sinceHours(d?: string | null) {
  if (!d) return null;
  return (Date.now() - new Date(d).getTime()) / 3_600_000;
}

/** First Zod message per field (Zod reports issues in order; keep the first one). */
export function firstIssues(issues: { path: (string | number)[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? '_');
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

/** Officer-facing labels distinguish automatic and checker outcomes. */
const OFFICER_LABELS: Record<string, string> = {
  AUTO_APPROVED: 'Auto-approved',
  APPROVED: 'Approved by checker',
  AUTO_REJECTED: 'Auto-rejected',
  REJECTED: 'Rejected by checker',
  PENDING_CHECKER: 'Pending checker',
  IN_REVIEW: 'In review',
  RESUBMISSION_REQUESTED: 'Resubmission requested',
  CLOSED_EXPIRED: 'Closed (expired)',
  SUBMITTED: 'Submitted',
  EXTRACTING: 'Extracting',
};
export const officerStatusLabel = (s: string) => OFFICER_LABELS[s] ?? s;
