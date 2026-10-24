import { csvEscape } from '@onboardiq/rules-engine';

export const toCsvRow = (vals: unknown[]) => vals.map(csvEscape).join(',');

/** Mask every PAN-looking token in a string (exports and logs). */
export const maskPan = (s: string) => s.replace(/\b([A-Z]{3})[A-Z0-9]{5}([0-9A-Z]{2})\b/g, (m, a, b) => (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(m) || /[0-9]/.test(m) ? `${a}XXXXX${b}` : m));
