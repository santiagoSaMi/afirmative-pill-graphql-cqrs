import { readdir, readFile } from 'node:fs/promises';
import { withTransaction } from './db.js';
import { log } from './log.js';

const MIGRATIONS_DIR = new URL('../db/migrations/', import.meta.url);
const MIGRATION_LOCK = 727_271;

/**
 * Migraciones versionadas e idempotentes. Todo corre en una sola transacción con un
 * advisory lock transaccional (compatible con el pooler de Supabase) para que dos
 * instancias no migren a la vez.
 */
export async function runMigrations(): Promise<void> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  await withTransaction(
    async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
      await tx.query('CREATE SCHEMA IF NOT EXISTS cmd');
      await tx.query(`
        CREATE TABLE IF NOT EXISTS cmd.schema_migrations (
          name       text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )`);

      const { rows } = await tx.query<{ name: string }>('SELECT name FROM cmd.schema_migrations');
      const applied = new Set(rows.map((r) => r.name));

      for (const file of files) {
        if (applied.has(file)) continue;
        log.info('migrate', `Aplicando ${file}`);
        const sql = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8');
        await tx.query(sql);
        await tx.query('INSERT INTO cmd.schema_migrations (name) VALUES ($1)', [file]);
      }
    },
    { quiet: true },
  );
  log.info('migrate', 'Esquema de base de datos al día');
}
