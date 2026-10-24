import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cors from 'cors';
import express from 'express';
import { env } from './config/env';
import { errorHandler, requestLog, securityHeaders } from './middleware/common';
import { adminRouter } from './routes/admin';
import { applicationsRouter } from './routes/applications';
import { authRouter } from './routes/auth';
import { documentsRouter } from './routes/documents';
import { docsRouter, internalRouter, metaRouter } from './routes/meta';
import { officerRouter } from './routes/officer';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: false }));
  app.use(express.json({ limit: '256kb' }));
  app.use(requestLog);

  const v1 = express.Router();
  v1.use('/auth', authRouter);
  v1.use('/', metaRouter);
  v1.use('/applications', applicationsRouter);
  v1.use('/', documentsRouter);
  v1.use('/', officerRouter);
  v1.use('/admin', adminRouter);
  app.use('/api/v1', v1);
  app.use('/api/docs', docsRouter);
  app.use('/internal', internalRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'Unknown API route' }));

  // Optional: serve the built web app from the API (single-container deployments).
  const dist = env.WEB_DIST ? resolve(env.WEB_DIST) : '';
  if (dist && existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
