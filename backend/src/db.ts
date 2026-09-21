import pg from 'pg';
import { config } from './config.js';
import { log, sleep } from './log.js';

// Parsers de tipos: fechas calendario como 'YYYY-MM-DD', numeric/int8 como number.
pg.types.setTypeParser(1082, (v: string) => v);
pg.types.setTypeParser(1700, (v: string) => Number(v));
pg.types.setTypeParser(20, (v: string) => Number(v));

/** Abstracción mínima común a pool y transacción: los repositorios no saben cuál reciben. */
export interface Db {
  query<R extends pg.QueryResultRow = any>(text: string, params?: unknown[]): Promise<pg.QueryResult<R>>;
}

function poolConfig(): pg.PoolConfig {
  let connectionString = config.DATABASE_URL;
  try {
    // pg da prioridad a ?sslmode= de la URL sobre la opción `ssl`; lo quitamos y controlamos SSL con DATABASE_SSL.
    const url = new URL(connectionString);
    url.searchParams.delete('sslmode');
    connectionString = url.toString();
  } catch {
    /* connection string no parseable como URL: se usa tal cual */
  }
  return {
    connectionString,
    // Los certificados de Supabase no están en el trust store de Node; el canal sigue cifrado.
    ssl: config.DATABASE_SSL ? { rejectUnauthorized: false } : false,
    max: config.DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'afirmative-pill-api',
  };
}

export const pool = new pg.Pool(poolConfig());
pool.on('error', (err) => log.error('db', `Error en conexión inactiva del pool: ${err.message}`));

async function run<R extends pg.QueryResultRow>(
  target: pg.Pool | pg.PoolClient,
  text: string,
  params: unknown[] | undefined,
  quiet: boolean,
): Promise<pg.QueryResult<R>> {
  const started = performance.now();
  try {
    const result = await target.query<R>(text, params as any[]);
    if (config.LOG_SQL && !quiet) {
      const sql = text.replace(/\s+/g, ' ').trim().slice(0, 170);
      const args = params?.length ? ` -- ${JSON.stringify(params).slice(0, 110)}` : '';
      log.sql(`${(performance.now() - started).toFixed(1)}ms rows=${result.rowCount ?? 0} ${sql}${args}`);
    }
    return result;
  } catch (err) {
    log.error('sql', `${(err as Error).message} :: ${text.replace(/\s+/g, ' ').trim().slice(0, 170)}`);
    throw err;
  }
}

export const db: Db = { query: (text, params) => run(pool, text, params, false) };

/** Ejecuta `fn` dentro de una transacción (BEGIN/COMMIT, ROLLBACK ante error). */
export async function withTransaction<T>(fn: (tx: Db) => Promise<T>, opts: { quiet?: boolean } = {}): Promise<T> {
  const client = await pool.connect();
  const tx: Db = { query: (text, params) => run(client, text, params, opts.quiet ?? false) };
  try {
    await client.query('BEGIN');
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* la conexión ya está rota */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function waitForDatabase(retries = 10, delayMs = 3000): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query('SELECT 1');
      log.info('db', 'Conexión a PostgreSQL (Supabase) establecida');
      return;
    } catch (err) {
      log.warn('db', `Intento ${attempt}/${retries} fallido: ${(err as Error).message}`);
      if (attempt === retries) {
        log.error(
          'db',
          'No se pudo conectar. Revisa DATABASE_URL. Si el error es ENETUNREACH/ENOTFOUND, usa el "Session pooler" de Supabase (compatible con IPv4).',
        );
        throw err;
      }
      await sleep(delayMs);
    }
  }
}
