import { DECLARABLE_DOC_TYPES } from '@onboardiq/shared';
import { HttpError } from '../lib/http';

export const MAX_FILE_BYTES = 1024 * 1024; // 1 MB
export const MAX_FILES = 10;

export interface IncomingFile {
  originalname: string;
  size: number;
  buffer: Buffer;
  mimetype?: string;
}

export interface ValidFile {
  file_name: string;
  declared_doc_type: (typeof DECLARABLE_DOC_TYPES)[number];
  buffer: Buffer;
  text: string;
}

const BINARY_SIGNATURES: [string, number[]][] = [
  ['Windows executable (MZ)', [0x4d, 0x5a]],
  ['ELF executable', [0x7f, 0x45, 0x4c, 0x46]],
  ['PDF', [0x25, 0x50, 0x44, 0x46]],
  ['ZIP archive', [0x50, 0x4b, 0x03, 0x04]],
  ['PNG image', [0x89, 0x50, 0x4e, 0x47]],
  ['JPEG image', [0xff, 0xd8, 0xff]],
  ['GIF image', [0x47, 0x49, 0x46, 0x38]],
];

/** Validate one uploaded file: extension, size, UTF-8 encoding, no binary content. Returns an error message or the text. */
export function checkFile(f: IncomingFile): { ok: true; text: string } | { ok: false; error: string } {
  const name = f.originalname || '';
  if (!/\.txt$/i.test(name)) return { ok: false, error: `${name}: only .txt files are accepted` };
  if (/[\\/]/.test(name) || name.length > 120) return { ok: false, error: `${name}: invalid file name` };
  if (f.size === 0 || f.buffer.length === 0) return { ok: false, error: `${name}: file is empty` };
  if (f.size > MAX_FILE_BYTES || f.buffer.length > MAX_FILE_BYTES) return { ok: false, error: `${name}: file is larger than 1 MB` };
  for (const [label, sig] of BINARY_SIGNATURES) {
    if (sig.every((b, i) => f.buffer[i] === b) && (label !== 'Windows executable (MZ)' || f.buffer.includes(0))) {
      return { ok: false, error: `${name}: content is a ${label}, not a text document` };
    }
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(f.buffer);
  } catch {
    return { ok: false, error: `${name}: file is not valid UTF-8 text` };
  }
  // control characters other than tab / CR / LF / form feed indicate binary content
  if (/[\u0000-\u0008\u000B\u000E-\u001F\u007F]/.test(text)) return { ok: false, error: `${name}: file contains binary data` };
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { ok: true, text };
}

/** Validate a batch of files with their declared types. Throws HTTP 422 with per-file messages. */
export function validateFiles(files: IncomingFile[], declared: unknown, minFiles: number): ValidFile[] {
  const fields: Record<string, string> = {};
  if (files.length < minFiles) fields.files = `Upload at least ${minFiles} documents (PAN card, Aadhaar card and an address proof)`;
  if (files.length > MAX_FILES) fields.files = `Upload at most ${MAX_FILES} documents`;
  let types: unknown[] = [];
  try {
    types = typeof declared === 'string' ? JSON.parse(declared) : Array.isArray(declared) ? declared : [];
  } catch {
    fields.declared_types = 'declared_types must be a JSON array of document types';
  }
  if (!Array.isArray(types) || types.length !== files.length) {
    fields.declared_types = 'Choose a document type for every file';
  }
  const out: ValidFile[] = [];
  files.forEach((f, i) => {
    const t = (types as string[])[i];
    if (!DECLARABLE_DOC_TYPES.includes(t as never)) {
      fields[`declared_types.${i}`] = `${f.originalname}: choose a valid document type`;
    }
    const c = checkFile(f);
    if (!c.ok) fields[`files.${i}`] = c.error;
    else out.push({ file_name: f.originalname, declared_doc_type: t as ValidFile['declared_doc_type'], buffer: f.buffer, text: c.text });
  });
  if (Object.keys(fields).length) {
    throw new HttpError(422, 'INVALID_DOCUMENT', 'Invalid document type, format or size. Please upload valid documents.', fields);
  }
  return out;
}

/** Data-pack doc id from a file name like D3000025.txt (used by the mock extraction provider). */
export function sourceRefFromName(name: string): string | null {
  const m = name.match(/^(D\d{7})\.txt$/i);
  return m ? m[1].toUpperCase() : null;
}
