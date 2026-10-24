import type pg from 'pg';
import { FINAL_STATUSES, STATUS_LABELS, STATUS_TRANSITIONS, type ApplicationStatus } from '@onboardiq/shared';
import { conflict, notFound } from '../lib/http';
import { audit, type AuditEvent } from './audit';

export type Actor = Pick<AuditEvent, 'actor_id' | 'actor_email' | 'actor_role' | 'ip'>;

/**
 * Lock an application row for update (SELECT ... FOR UPDATE). Two officers acting on the same case at
 * the same time are serialised here; the second one sees the changed status/version and gets HTTP 409.
 */
export async function lockApplication(
  c: pg.PoolClient,
  id: string,
  opts: { allowed?: ApplicationStatus[]; expectedVersion?: number } = {},
) {
  const r = await c.query('SELECT * FROM applications WHERE application_id = $1 FOR UPDATE', [id]);
  const app = r.rows[0];
  if (!app) throw notFound('Application not found');
  if (opts.allowed && !opts.allowed.includes(app.status)) {
    throw conflict(`Application is ${app.status}; this action needs ${opts.allowed.join(' or ')}. Another user may have acted on it already.`, {
      current_status: app.status,
      current_version: app.version,
    });
  }
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== app.version) {
    throw conflict('The application was changed by someone else. Reload and try again.', {
      current_status: app.status,
      current_version: app.version,
    });
  }
  return app;
}

/** Status change following the lifecycle of Section 6.1.1, audited and with an applicant notification log entry. */
export async function transition(
  c: pg.PoolClient,
  app: { application_id: string; status: ApplicationStatus; applicant_user_id: number },
  to: ApplicationStatus,
  actor: Actor,
  details: Record<string, unknown> = {},
) {
  if (!STATUS_TRANSITIONS[app.status]?.includes(to)) {
    throw conflict(`Status change ${app.status} -> ${to} is not allowed by the lifecycle`);
  }
  await c.query(
    `UPDATE applications SET status = $2, version = version + 1, updated_at = now(),
       in_review_since = CASE WHEN $2 = 'IN_REVIEW' THEN now() ELSE in_review_since END,
       pending_checker_since = CASE WHEN $2 = 'PENDING_CHECKER' THEN now() ELSE pending_checker_since END,
       decided_at = CASE WHEN $2 = ANY($3::text[]) THEN now() ELSE decided_at END
     WHERE application_id = $1`,
    [app.application_id, to, FINAL_STATUSES],
  );
  await audit({ application_id: app.application_id, event_type: 'STATUS_CHANGED', ...actor, details: { from: app.status, to, ...details } }, c);
  await c.query('INSERT INTO notifications (application_id, user_id, message) VALUES ($1,$2,$3)', [
    app.application_id,
    app.applicant_user_id,
    `Your application ${app.application_id} is now: ${STATUS_LABELS[to]}`,
  ]);
  app.status = to;
}
