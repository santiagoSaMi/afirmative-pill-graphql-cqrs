import { makeVar } from '@apollo/client';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
}
export interface AuthState {
  token: string;
  user: AuthUser;
}

const KEY = 'ap.auth';

/** Estado de sesión como reactive variable de Apollo (fuente única, sin Redux/Context extra). */
export const authVar = makeVar<AuthState | null>(null);

export function loadAuth() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) authVar(JSON.parse(raw) as AuthState);
  } catch {
    /* almacenamiento no disponible o corrupto */
  }
}

export function setAuth(state: AuthState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* sin persistencia */
  }
  authVar(state);
}

export function clearAuth() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
  authVar(null);
}

export const getToken = () => authVar()?.token ?? null;
