import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from '@onboardiq/shared';
import { env } from '../config/env';
import { forbidden, unauthorized } from '../lib/http';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  roles: Role[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** Role the user acts in for this request (X-Acting-Role header, must be one of the user's roles). */
      actingRole?: Role;
    }
  }
}

export function signToken(u: AuthUser): string {
  return jwt.sign({ sub: String(u.id), email: u.email, name: u.name, roles: u.roles }, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    issuer: 'onboardiq',
  });
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return next(unauthorized());
  try {
    const p = jwt.verify(h.slice(7), env.JWT_SECRET, { algorithms: ['HS256'], issuer: 'onboardiq' }) as jwt.JwtPayload;
    req.user = { id: Number(p.sub), email: String(p.email), name: String(p.name), roles: p.roles as Role[] };
    const acting = req.headers['x-acting-role'] as Role | undefined;
    req.actingRole = acting && req.user.roles.includes(acting) ? acting : req.user.roles[0];
    next();
  } catch {
    next(unauthorized('Session expired or invalid token. Please log in again.'));
  }
}

/** Server-side role enforcement (FR-1). */
export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!req.user.roles.some((r) => roles.includes(r))) return next(forbidden(`This action requires role: ${roles.join(' or ')}`));
    next();
  };

export const isOfficer = (u?: AuthUser) => !!u && (u.roles.includes('KYC_OFFICER') || u.roles.includes('COMPLIANCE_OFFICER'));

/** Primary role used for audit records: the acting role when it is an officer role. */
export function auditRole(req: Request): string {
  return req.actingRole ?? req.user?.roles[0] ?? 'SYSTEM';
}
