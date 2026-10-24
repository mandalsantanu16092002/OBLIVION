import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../config/env';

/** Uploaded files are stored outside the database under a random (non-guessable) key, never executed. */
export function ensureStorage() {
  mkdirSync(env.STORAGE_DIR, { recursive: true });
}

export const sha256 = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');

export async function storeFile(buf: Buffer): Promise<string> {
  ensureStorage();
  const key = randomUUID();
  // no extension, read-only permissions: the file is data only
  await writeFile(join(env.STORAGE_DIR, key), buf, { mode: 0o440 });
  return key;
}

export async function readStoredText(fileKey: string): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(fileKey)) throw new Error('invalid file key');
  return readFile(join(env.STORAGE_DIR, fileKey), 'utf8');
}
