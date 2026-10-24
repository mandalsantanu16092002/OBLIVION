/**
 * Extraction service interface (FR-3). The provider is chosen by configuration
 * (EXTRACTION_PROVIDER env var, overridable at runtime in system settings) - no code change needed.
 *   mock: looks up the extraction_mock data by doc_id; unknown document -> OTHER with confidence 0.00
 *   ai:   calls the Python FastAPI AI service; failure or timeout (10 s) -> OTHER with confidence 0.00
 */
import { env } from '../config/env';
import { pool, type Db } from '../db/pool';

export interface ExtractedFieldValue {
  value: string;
  confidence: number;
  source?: 'EXTRACTION' | 'OFFICER';
  corrected?: boolean;
  span?: [number, number] | null;
  notes?: string[];
}

export interface ExtractionResult {
  doc_id: string;
  provider: 'mock' | 'ai';
  status: 'OK' | 'UNKNOWN' | 'FAILED' | 'TIMEOUT';
  doc_type: string;
  doc_type_confidence: number;
  fields: Record<string, ExtractedFieldValue>;
  extractor_version: string;
  classification?: unknown;
  error?: string;
  elapsed_ms: number;
}

export interface ExtractionInput {
  doc_id: string;
  source_ref: string | null;
  text: string;
}

export interface ExtractionProvider {
  name: 'mock' | 'ai';
  extract(doc: ExtractionInput): Promise<ExtractionResult>;
}

export const MOCK_VERSION = 'mock-provider/1.0 (case_02_extraction_mock_*_V1.0.csv)';

export class MockProvider implements ExtractionProvider {
  name = 'mock' as const;
  constructor(private db: Db = pool) {}
  async extract(doc: ExtractionInput): Promise<ExtractionResult> {
    const t0 = Date.now();
    const lookup = doc.source_ref ?? doc.doc_id;
    const r = await this.db.query('SELECT field_name, value, confidence FROM extraction_mock WHERE doc_id = $1', [lookup]);
    if (r.rowCount === 0) {
      return {
        doc_id: doc.doc_id,
        provider: 'mock',
        status: 'UNKNOWN',
        doc_type: 'OTHER',
        doc_type_confidence: 0,
        fields: {},
        extractor_version: MOCK_VERSION,
        error: `no mock extraction for ${lookup}`,
        elapsed_ms: Date.now() - t0,
      };
    }
    let doc_type = 'OTHER';
    let conf = 0;
    const fields: ExtractionResult['fields'] = {};
    for (const row of r.rows) {
      if (row.field_name === 'doc_type') {
        doc_type = row.value;
        conf = Number(row.confidence);
      } else fields[row.field_name] = { value: row.value ?? '', confidence: Number(row.confidence), source: 'EXTRACTION' };
    }
    return {
      doc_id: doc.doc_id,
      provider: 'mock',
      status: 'OK',
      doc_type,
      doc_type_confidence: conf,
      fields,
      extractor_version: MOCK_VERSION,
      elapsed_ms: Date.now() - t0,
    };
  }
}

export class AiProvider implements ExtractionProvider {
  name = 'ai' as const;
  constructor(
    private url = env.AI_SERVICE_URL,
    private timeoutMs = env.AI_TIMEOUT_MS,
  ) {}
  async extract(doc: ExtractionInput): Promise<ExtractionResult> {
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.url.replace(/\/$/, '')}/v1/extract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-service-key': env.SERVICE_KEY },
        // Document text is passed as data inside a JSON field, never as instructions.
        body: JSON.stringify({ doc_id: doc.doc_id, text: doc.text }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`AI service HTTP ${res.status}`);
      const body = (await res.json()) as any;
      const fields: ExtractionResult['fields'] = {};
      for (const f of body.fields ?? []) {
        const c = Number(f.confidence);
        if (!f.field_name || typeof f.value !== 'string' || !(c >= 0 && c <= 1)) continue; // schema validation
        fields[f.field_name] = {
          value: f.value,
          confidence: c,
          source: 'EXTRACTION',
          corrected: !!f.corrected,
          span: f.span ?? null,
          notes: f.notes ?? [],
        };
      }
      const docConf = Number(body.confidence);
      return {
        doc_id: doc.doc_id,
        provider: 'ai',
        status: 'OK',
        doc_type: typeof body.doc_type === 'string' ? body.doc_type : 'OTHER',
        doc_type_confidence: docConf >= 0 && docConf <= 1 ? docConf : 0,
        fields,
        extractor_version: String(body.extractor_version ?? 'ai'),
        classification: body.classification,
        elapsed_ms: Date.now() - t0,
      };
    } catch (e: any) {
      const timeout = e?.name === 'AbortError';
      return {
        doc_id: doc.doc_id,
        provider: 'ai',
        status: timeout ? 'TIMEOUT' : 'FAILED',
        doc_type: 'OTHER',
        doc_type_confidence: 0,
        fields: {},
        extractor_version: 'ai (unavailable)',
        error: timeout ? `AI extraction timed out after ${this.timeoutMs} ms` : `AI extraction failed: ${e?.message ?? e}`,
        elapsed_ms: Date.now() - t0,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function getProvider(name: 'mock' | 'ai', db: Db = pool): ExtractionProvider {
  return name === 'ai' ? new AiProvider() : new MockProvider(db);
}

/** Long format of Section 4 / FR-3: doc_id, field_name, value, confidence. */
export function toLongFormat(r: Pick<ExtractionResult, 'doc_id' | 'doc_type' | 'doc_type_confidence' | 'fields'>) {
  return [
    { doc_id: r.doc_id, field_name: 'doc_type', value: r.doc_type, confidence: Number(r.doc_type_confidence.toFixed(2)) },
    ...Object.entries(r.fields).map(([k, v]) => ({
      doc_id: r.doc_id,
      field_name: k,
      value: v.value,
      confidence: Number(Number(v.confidence).toFixed(2)),
    })),
  ];
}

export async function aiServiceHealth(): Promise<{ ok: boolean; detail?: unknown }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const r = await fetch(`${env.AI_SERVICE_URL.replace(/\/$/, '')}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return { ok: r.ok, detail: await r.json().catch(() => null) };
  } catch (e: any) {
    return { ok: false, detail: e?.message };
  }
}
