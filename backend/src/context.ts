import { userFromAuthHeader, type AuthUser } from './auth.js';
import { createLoaders, type Loaders } from './graphql/loaders.js';

export interface Context {
  user: AuthUser | null;
  loaders: Loaders;
}

export function createContext(authHeader?: string | null): Context {
  return { user: userFromAuthHeader(authHeader), loaders: createLoaders() };
}
