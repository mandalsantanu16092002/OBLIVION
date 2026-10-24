import { normaliseName, similarityNormalised } from './names';
import type { RulesConfig, ScreeningHit, ScreeningOutcome, WatchlistEntry } from './types';

/**
 * Watchlist screening (Section 6.1): compare the declared full_name with each entry's name and alias.
 *  MATCH    = similarity >= watchlist_match_threshold and entry dob empty or equal to declared dob.
 *  POSSIBLE = similarity >= watchlist_match_threshold with a different dob,
 *             or similarity from watchlist_possible_threshold to below watchlist_match_threshold.
 */
export function screen(
  fullName: string,
  declaredDob: string,
  entries: WatchlistEntry[],
  cfg: RulesConfig,
): ScreeningOutcome {
  const declared = normaliseName(fullName, cfg.name_title_tokens);
  const hits: ScreeningHit[] = [];
  for (const e of entries) {
    const candidates: { on: 'name' | 'alias'; value: string }[] = [{ on: 'name', value: e.name }];
    if (e.alias && e.alias.trim()) candidates.push({ on: 'alias', value: e.alias });
    let bestForEntry: ScreeningHit | null = null;
    for (const c of candidates) {
      const sim = similarityNormalised(declared, normaliseName(c.value, cfg.name_title_tokens));
      if (sim < cfg.watchlist_possible_threshold) continue;
      const entryDob = e.dob && e.dob.trim() ? e.dob.trim() : null;
      const dobCmp: ScreeningHit['dob_comparison'] =
        entryDob === null ? 'ENTRY_DOB_EMPTY' : entryDob === declaredDob ? 'EQUAL' : 'DIFFERENT';
      const result: ScreeningHit['result'] =
        sim >= cfg.watchlist_match_threshold && dobCmp !== 'DIFFERENT' ? 'MATCH' : 'POSSIBLE';
      const hit: ScreeningHit = {
        list_type: e.list_type,
        entry_id: e.entry_id,
        entry_name: e.name,
        matched_on: c.on,
        matched_value: c.value,
        similarity: sim,
        entry_dob: entryDob,
        declared_dob: declaredDob,
        dob_comparison: dobCmp,
        result,
      };
      if (!bestForEntry || rank(hit) > rank(bestForEntry)) bestForEntry = hit;
    }
    if (bestForEntry) hits.push(bestForEntry);
  }
  hits.sort((a, b) => rank(b) - rank(a));
  const result = hits.some((h) => h.result === 'MATCH')
    ? 'MATCH'
    : hits.length > 0
      ? 'POSSIBLE'
      : 'NONE';
  return { result, best: hits[0] ?? null, hits };
}

function rank(h: ScreeningHit): number {
  return (h.result === 'MATCH' ? 10 : 0) + h.similarity;
}
