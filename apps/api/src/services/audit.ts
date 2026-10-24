import type { Request } from 'express';
import { pool, type Db } from '../db/pool';
import { auditRole } from '../middleware/auth';

export interface AuditEvent {
  application_id?: string | null;
  event_type: string;
  actor_id?: number | null;
  actor_email?: string | null;
  actor_role?: string | null;
  doc_id?: string | null;
  details?: Record<string, unknown>;
  ip?: string | null;
}

/** Append one audit row. There is no update or delete operation on audit rows (DB trigger enforces it). */
export async function audit(e: AuditEvent, db: Db = pool) {
  await db.query(
    `INSERT INTO audit_log (application_id, event_type, actor_id, actor_email, actor_role, doc_id, details, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      e.application_id ?? null,
      e.event_type,
      e.actor_id ?? null,
      e.actor_email ?? null,
      e.actor_role ?? 'SYSTEM',
      e.doc_id ?? null,
      JSON.stringify(e.details ?? {}),
      e.ip ?? null,
    ],
  );
}

export function actorFrom(req: Request) {
  return {
    actor_id: req.user?.id ?? null,
    actor_email: req.user?.email ?? null,
    actor_role: auditRole(req),
    ip: req.ip ?? null,
  };
}

export const SYSTEM_ACTOR = { actor_id: null, actor_email: 'system', actor_role: 'SYSTEM', ip: null };
