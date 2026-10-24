/** Writes output/design/openapi.json (the same spec served at /api/v1/openapi.json). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '../config/env';
import { openApiSpec } from '../openapi';

const out = resolve(env.OUTPUT_DIR, 'design/openapi.json');
mkdirSync(resolve(env.OUTPUT_DIR, 'design'), { recursive: true });
writeFileSync(out, JSON.stringify(openApiSpec(), null, 2));
console.log(`[openapi] ${Object.keys(openApiSpec().paths).length} paths -> ${out}`);
