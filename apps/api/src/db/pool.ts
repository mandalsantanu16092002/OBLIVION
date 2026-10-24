import pg from 'pg';
import { env } from '../config/env';

// Return DATE columns as 'YYYY-MM-DD' strings (calendar dates, no timezone shifting).
pg.types.setTypeParser(1082, (v: string) => v);
// BIGINT as number (amounts and counts fit safely in this application).
pg.types.setTypeParser(20, (v: string) => Number(v));
// NUMERIC as number
pg.types.setTypeParser(1700, (v: string) => Number(v));

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 15 });

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] idle client error', err.message);
});

export type Db = pg.Pool | pg.PoolClient;

export async function query<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Db = pool) {
  return db.query<T>(text, params as any[]);
}

/** Run fn in a transaction. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
