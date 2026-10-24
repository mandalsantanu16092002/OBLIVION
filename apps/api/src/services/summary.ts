import { round4 } from '@onboardiq/rules-engine';
import { env } from '../config/env';

/**
 * AI-5 reviewer summary. Asks the AI service (LLM when configured, template otherwise). If the AI
 * service is down, a local template summary is produced. Never recommends a decision.
 */
export async function reviewerSummary(app: any): Promise<{ summary: string; label: string; generated_by: string; words: number }> {
  const engine = app.engine_result ?? {};
  const payload = {
    application_id: app.application_id,
    decision: app.decision,
    reason_codes: app.reason_codes,
    name_match_score: app.name_match_score,
    rules: (engine.rules ?? []).filter((r: any) => r.triggered).map((r: any) => ({ rule: r.rule, code: r.code, triggered: true, details: r.details })),
  };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(`${env.AI_SERVICE_URL.replace(/\/$/, '')}/v1/summary`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-service-key': env.SERVICE_KEY },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.ok) return (await res.json()) as any;
  } catch {
    /* fall through to local template */
  }
  const parts = (app.reason_codes ?? []).map((c: string) => {
    const r = (engine.rules ?? []).find((x: any) => x.code === c);
    if (c === 'NAME_MISMATCH_MINOR' || c === 'NAME_MISMATCH') return `Name similarity ${round4(app.name_match_score)}.`;
    if (c === 'ADDRESS_MISMATCH') return `Pincode declared ${r?.details?.declared_pincode} vs proof ${r?.details?.pincode_on_address_proof}.`;
    if (c === 'ADDRESS_PROOF_STALE') return `Address proof dated ${r?.details?.document_date}.`;
    return `${c.replace(/_/g, ' ').toLowerCase()}.`;
  });
  const summary = (parts.join(' ') || 'No discrepancies were found by the rules.').split(/\s+/).slice(0, 80).join(' ');
  return { summary, label: 'Auto-generated (template, AI service unavailable)', generated_by: 'template', words: summary.split(/\s+/).length };
}
