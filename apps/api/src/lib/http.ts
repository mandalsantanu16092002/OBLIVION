import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, fields?: Record<string, string>) => new HttpError(400, 'BAD_REQUEST', msg, fields);
export const unprocessable = (msg: string, fields?: Record<string, string>) =>
  new HttpError(422, 'VALIDATION_ERROR', msg, fields);
export const unauthorized = (msg = 'Authentication required') => new HttpError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'You do not have permission to perform this action') => new HttpError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Not found') => new HttpError(404, 'NOT_FOUND', msg);
export const conflict = (msg: string, extra?: Record<string, unknown>) => new HttpError(409, 'CONFLICT', msg, undefined, extra);

/** Wrap async route handlers so rejected promises reach the error middleware (Express 4). */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function zodFields(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Parse with a Zod schema; throws HTTP 422 with field names on failure. */
export function parseOr422<S extends ZodTypeAny>(schema: S, data: unknown, message = 'Invalid input'): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw unprocessable(message, zodFields(r.error));
  return r.data;
}

/** Strip values that could contain PII before logging. */
export function safeLogPath(path: string) {
  return path.replace(/[A-Z]{5}[0-9]{4}[A-Z]/g, (p) => p.slice(0, 3) + 'XXXXX' + p.slice(-2));
}
