/**
 * Mock core-banking service. Exposed as an internal HTTP API (/internal/core-banking/accounts) that only
 * accepts calls carrying the service key from the SERVICE_KEY environment variable. When CORE_BANKING_URL
 * is empty (CLI, seed) the same handler is invoked in-process, still with the service key check.
 */
import { env } from '../config/env';
import { pool, type Db } from '../db/pool';
import { HttpError } from '../lib/http';

export interface OpenAccountRequest {
  application_id: string;
  full_name: string;
  pan_number: string;
  dob: string;
}
export interface OpenAccountResponse {
  customer_id: string;
  account_number: string;
  idempotent_replay?: boolean;
}

/** Server side of the mock API. Idempotent per application_id; a PAN can belong to only one customer. */
export async function handleOpenAccount(serviceKey: string | undefined, req: OpenAccountRequest, db: Db = pool): Promise<OpenAccountResponse> {
  if (serviceKey !== env.SERVICE_KEY) throw new HttpError(401, 'UNAUTHORIZED', 'invalid service key');
  const existing = await db.query('SELECT customer_id, account_number FROM core_banking_accounts WHERE application_id = $1', [req.application_id]);
  if (existing.rows[0]) return { ...existing.rows[0], idempotent_replay: true };
  const seq = Number((await db.query("SELECT nextval('core_customer_seq') AS n")).rows[0].n);
  const customer_id = `DDB${String(seq).padStart(7, '0')}`;
  const account_number = `5010${String(seq).padStart(10, '0')}`;
  try {
    await db.query(
      'INSERT INTO core_banking_accounts (customer_id, account_number, application_id, pan_number, full_name) VALUES ($1,$2,$3,$4,$5)',
      [customer_id, account_number, req.application_id, req.pan_number, req.full_name],
    );
  } catch (e: any) {
    if (e?.code === '23505') throw new HttpError(409, 'CONFLICT', 'A customer with this PAN already exists in core banking');
    throw e;
  }
  return { customer_id, account_number };
}

/** Client used by the onboarding workflow. */
export async function openAccount(req: OpenAccountRequest, db: Db = pool): Promise<OpenAccountResponse> {
  if (!env.CORE_BANKING_URL) return handleOpenAccount(env.SERVICE_KEY, req, db);
  const res = await fetch(`${env.CORE_BANKING_URL.replace(/\/$/, '')}/accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-service-key': env.SERVICE_KEY },
    body: JSON.stringify(req),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new HttpError(res.status === 409 ? 409 : 502, 'CORE_BANKING_ERROR', body?.message ?? `core banking HTTP ${res.status}`);
  return body as OpenAccountResponse;
}
