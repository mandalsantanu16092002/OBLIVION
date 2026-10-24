/**
 * Name normalisation and similarity exactly as defined in Section 6.1:
 *  upper case; replace "." and "-" with a space; remove every character other than A-Z and space;
 *  drop title tokens; collapse spaces; sort tokens alphabetically and join with one space.
 *  Similarity = 1 - Levenshtein distance / length of the longer normalised string (1.0 when both empty).
 */
export function normaliseName(name: string | null | undefined, titleTokens: string[]): string {
  if (!name) return '';
  const titles = new Set(titleTokens.map((t) => t.toUpperCase()));
  const cleaned = String(name)
    .toUpperCase()
    .replace(/[.\-]/g, ' ')
    .replace(/[^A-Z ]/g, '');
  const tokens = cleaned
    .split(' ')
    .filter((t) => t.length > 0 && !titles.has(t));
  tokens.sort();
  return tokens.join(' ');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Similarity of two already-normalised strings. Floating point; round only for output. */
export function similarityNormalised(a: string, b: string): number {
  const longer = Math.max(a.length, b.length);
  if (longer === 0) return 1.0;
  return 1 - levenshtein(a, b) / longer;
}

export function nameSimilarity(a: string, b: string, titleTokens: string[]): number {
  return similarityNormalised(normaliseName(a, titleTokens), normaliseName(b, titleTokens));
}

/** Round to 4 decimals for output only. */
export function round4(x: number | null | undefined): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '';
  return (Math.round(x * 10000 + Number.EPSILON) / 10000).toFixed(4);
}
