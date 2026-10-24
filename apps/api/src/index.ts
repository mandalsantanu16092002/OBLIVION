import { createApp } from './app';
import { env } from './config/env';
import { pool } from './db/pool';
import { migrate } from './db/migrate';
import { closeExpired } from './services/cases';
import { recoverStuck } from './services/processing';
import { ensureStorage } from './services/storage';

async function main() {
  ensureStorage();
  await migrate({ log: true });
  if (env.SEED_ON_START) {
    const { seedIfEmpty } = await import('./db/seed');
    await seedIfEmpty();
  }
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`[api] OnboardIQ API listening on http://localhost:${env.PORT} (docs: /api/docs, provider default: ${env.EXTRACTION_PROVIDER})`);
  });
  // background jobs: recover interrupted processing, close expired resubmissions every minute
  recoverStuck().catch((e) => console.error('[recover]', e.message));
  const timer = setInterval(() => {
    closeExpired()
      .then((c) => c.length && console.log(`[expiry] closed ${c.join(', ')}`))
      .catch((e) => console.error('[expiry]', e.message));
  }, 60_000);
  const shutdown = () => {
    clearInterval(timer);
    server.close(() => pool.end().then(() => process.exit(0)));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[api] failed to start:', e);
  process.exit(1);
});
