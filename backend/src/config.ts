import { z } from 'zod';

const bool = (fallback: 'true' | 'false') =>
  z.enum(['true', 'false']).default(fallback).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria (connection string de Supabase)'),
  DATABASE_SSL: bool('true'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  JWT_EXPIRES_IN: z.string().default('12h'),

  FRONTEND_ORIGIN: z.string().default('http://localhost:3000'),
  ENABLE_INTROSPECTION: bool('true'),
  LOG_SQL: bool('true'),

  // Consistencia eventual: retraso artificial y frecuencia del proyector (outbox -> read model)
  PROJECTION_DELAY_MS: z.coerce.number().int().min(0).default(1500),
  PROJECTOR_POLL_MS: z.coerce.number().int().min(50).default(500),

  // Process manager de fulfillment (validación farmacéutica y despacho simulados)
  WORKER_POLL_MS: z.coerce.number().int().min(100).default(1000),
  REVIEW_DELAY_MS: z.coerce.number().int().min(0).default(10_000),
  DISPATCH_DELAY_MS: z.coerce.number().int().min(0).default(15_000),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Configuración inválida:');
  for (const issue of parsed.error.issues) console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const config = parsed.data;
