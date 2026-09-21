import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
}

const ISSUER = 'afirmative-pill';
const BCRYPT_ROUNDS = 10;

export const hashPassword = (plain: string) => bcrypt.hash(plain, BCRYPT_ROUNDS);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

export function signToken(user: AuthUser): string {
  return jwt.sign({ email: user.email, name: user.fullName }, config.JWT_SECRET, {
    subject: user.id,
    issuer: ISSUER,
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

/** Acepta "Bearer <jwt>" (cabecera HTTP o connectionParams de graphql-ws). Devuelve null si no es válido. */
export function userFromAuthHeader(header?: string | null): AuthUser | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { issuer: ISSUER }) as jwt.JwtPayload;
    if (!payload.sub) return null;
    return { id: payload.sub, email: String(payload.email), fullName: String(payload.name) };
  } catch {
    return null;
  }
}
