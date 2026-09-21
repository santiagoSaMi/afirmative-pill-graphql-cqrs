import { z } from 'zod';
import { db } from '../db.js';
import { hashPassword, signToken, verifyPassword, type AuthUser } from '../auth.js';
import { log } from '../log.js';
import { zodToDomainErrors, type DomainError } from './errors.js';

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Correo electrónico inválido').max(254),
  fullName: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres').max(120),
  password: z
    .string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres')
    .max(72, 'La contraseña no puede superar 72 caracteres')
    .regex(/[A-Za-z]/, 'La contraseña debe incluir al menos una letra')
    .regex(/\d/, 'La contraseña debe incluir al menos un número'),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Correo electrónico inválido'),
  password: z.string().min(1, 'Ingresa tu contraseña'),
});

export interface AuthResult {
  token: string | null;
  user: AuthUser | null;
  errors: DomainError[];
}

const failure = (errors: DomainError[]): AuthResult => ({ token: null, user: null, errors });

/** Comando: RegisterPatient */
export async function registerPatient(rawInput: unknown): Promise<AuthResult> {
  const parsed = registerSchema.safeParse(rawInput);
  if (!parsed.success) return failure(zodToDomainErrors(parsed.error));
  const { email, fullName, password } = parsed.data;

  const passwordHash = await hashPassword(password);
  const { rows } = await db.query(
    `INSERT INTO cmd.users (email, full_name, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    [email, fullName, passwordHash],
  );
  if (!rows[0]) {
    return failure([{ code: 'EMAIL_TAKEN', message: 'Ya existe una cuenta con ese correo', field: 'email' }]);
  }
  const user: AuthUser = { id: rows[0].id, email, fullName };
  log.info('command', `RegisterPatient ${user.id}`);
  return { token: signToken(user), user, errors: [] };
}

// Hash de relleno para igualar tiempos cuando el correo no existe (evita enumeración por timing).
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8.4x2C0lqHq2p9yQw4pQmK5v9uJt2K';

/** Comando: Authenticate */
export async function authenticate(rawInput: unknown): Promise<AuthResult> {
  const parsed = loginSchema.safeParse(rawInput);
  if (!parsed.success) return failure(zodToDomainErrors(parsed.error));
  const { email, password } = parsed.data;

  const { rows } = await db.query('SELECT id, email, full_name, password_hash FROM cmd.users WHERE email = $1', [email]);
  const row = rows[0];
  const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) {
    return failure([{ code: 'INVALID_CREDENTIALS', message: 'Correo o contraseña incorrectos' }]);
  }
  const user: AuthUser = { id: row.id, email: row.email, fullName: row.full_name };
  return { token: signToken(user), user, errors: [] };
}
