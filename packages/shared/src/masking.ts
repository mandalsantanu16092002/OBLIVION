/** PAN masked as ZZKXXXXX4Q (first 3 and last 2 characters kept). */
export function maskPan(pan: string | null | undefined): string {
  if (!pan) return '';
  const p = String(pan);
  if (p.length < 6) return 'X'.repeat(p.length);
  return p.slice(0, 3) + 'X'.repeat(p.length - 5) + p.slice(-2);
}

/** Only the last 4 Aadhaar digits ever exist in the system; displayed as XXXX XXXX 1234. */
export function maskAadhaar(last4: string | null | undefined): string {
  if (!last4) return '';
  return `XXXX XXXX ${last4}`;
}

export function maskMobile(mobile: string | null | undefined): string {
  if (!mobile) return '';
  return mobile.length > 4 ? 'XXXXXX' + mobile.slice(-4) : mobile;
}

export function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  const [u, d] = email.split('@');
  if (!d) return email;
  return (u.length <= 2 ? u[0] ?? '' : u.slice(0, 2)) + '***@' + d;
}
