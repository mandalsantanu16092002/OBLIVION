import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const API_ROOT = resolve(here, '../..');
export const REPO_ROOT = resolve(API_ROOT, '../..');

/** Load KEY=VALUE pairs from the repo-root .env (if present) without overriding real env vars. */
function loadDotEnv() {
  for (const p of [resolve(REPO_ROOT, '.env'), resolve(API_ROOT, '.env')]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      const v = m[2].replace(/^["']|["']$/g, '');
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  }
}
loadDotEnv();

const str = (k: string, d: string) => process.env[k] ?? d;
const num = (k: string, d: number) => (process.env[k] ? Number(process.env[k]) : d);

export const env = {
  NODE_ENV: str('NODE_ENV', 'development'),
  PORT: num('PORT', 4000),
  DATABASE_URL: str('DATABASE_URL', 'postgres://onboardiq:onboardiq@localhost:5432/onboardiq'),
  JWT_SECRET: str('JWT_SECRET', 'dev-only-change-me-onboardiq-secret'),
  JWT_EXPIRES_IN: str('JWT_EXPIRES_IN', '8h'),
  /** Service key used by the backend for the AI extraction service and the mock core-banking API. */
  SERVICE_KEY: str('SERVICE_KEY', 'dev-service-key'),
  EXTRACTION_PROVIDER: str('EXTRACTION_PROVIDER', 'mock') as 'mock' | 'ai',
  AI_SERVICE_URL: str('AI_SERVICE_URL', 'http://localhost:8000'),
  AI_TIMEOUT_MS: num('AI_TIMEOUT_MS', 10_000),
  CORE_BANKING_URL: str('CORE_BANKING_URL', ''),
  STORAGE_DIR: resolve(REPO_ROOT, str('STORAGE_DIR', 'storage/documents')),
  DATA_DIR: resolve(REPO_ROOT, str('DATA_DIR', 'data')),
  OUTPUT_DIR: resolve(REPO_ROOT, str('OUTPUT_DIR', 'output')),
  CORS_ORIGIN: str('CORS_ORIGIN', 'http://localhost:5173'),
  /** Optional business-date override (YYYY-MM-DD) so the 2026 data-pack documents can be demoed. */
  DEMO_BUSINESS_DATE: str('DEMO_BUSINESS_DATE', ''),
  SEED_ON_START: str('SEED_ON_START', 'false') === 'true',
  WEB_DIST: str('WEB_DIST', ''),
};

if (env.NODE_ENV === 'production' && env.JWT_SECRET.startsWith('dev-only')) {
  // eslint-disable-next-line no-console
  console.warn('[security] JWT_SECRET is using the development default. Set JWT_SECRET in production.');
}
