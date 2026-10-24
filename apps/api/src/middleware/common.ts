import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { HttpError, safeLogPath, zodFields } from '../lib/http';
import { MAX_FILE_BYTES, MAX_FILES } from '../services/uploads';

/** Security headers (no external dependency needed). */
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
    if (!req.path.startsWith('/api/docs')) res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  }
  next();
}

/** Request log without bodies or PII. */
export function requestLog(req: Request, res: Response, next: NextFunction) {
  const t0 = Date.now();
  res.on('finish', () => {
    if (process.env.NODE_ENV === 'test') return;
    // eslint-disable-next-line no-console
    console.log(`${new Date().toISOString()} ${req.method} ${safeLogPath(req.originalUrl.split('?')[0])} ${res.statusCode} ${Date.now() - t0}ms${req.user ? ` u=${req.user.id}` : ''}`);
  });
  next();
}

/** Tiny in-memory rate limiter (per IP + key) for login / register. */
export function rateLimit(max: number, windowMs: number, keyFn: (req: Request) => string = (r) => r.ip ?? 'x') {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const k = keyFn(req);
    const now = Date.now();
    const h = hits.get(k);
    if (!h || h.reset < now) {
      hits.set(k, { n: 1, reset: now + windowMs });
      return next();
    }
    h.n += 1;
    if (h.n > max) {
      res.setHeader('Retry-After', Math.ceil((h.reset - now) / 1000));
      return res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Please wait a minute and try again.' });
    }
    next();
  };
}

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES, fields: 40, fieldSize: 64 * 1024 },
});

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}), ...(err.extra ?? {}) });
  }
  if (err instanceof ZodError) {
    return res.status(422).json({ error: 'VALIDATION_ERROR', message: 'Invalid input', fields: zodFields(err) });
  }
  if (err instanceof multer.MulterError) {
    const msg =
      err.code === 'LIMIT_FILE_SIZE'
        ? `File ${err.field ? '' : ''}is larger than 1 MB and was rejected. Nothing was stored.`
        : err.code === 'LIMIT_FILE_COUNT'
          ? `Upload at most ${MAX_FILES} files`
          : `Upload error: ${err.message}`;
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 422).json({ error: 'INVALID_DOCUMENT', message: msg, fields: { files: msg } });
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'BAD_REQUEST', message: 'Malformed JSON body' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' });
  // eslint-disable-next-line no-console
  console.error('[error]', err?.stack ?? err);
  return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' });
};
