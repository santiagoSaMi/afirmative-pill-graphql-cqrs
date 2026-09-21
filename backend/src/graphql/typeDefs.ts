import { readFileSync } from 'node:fs';

// schema.graphql vive en la raíz del backend (y se documenta en el README).
export const typeDefs = readFileSync(new URL('../../schema.graphql', import.meta.url), 'utf8');
