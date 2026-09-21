import { GraphQLError, GraphQLScalarType, Kind, type ValueNode } from 'graphql';

const fail = (name: string, value: unknown): never => {
  throw new GraphQLError(`${name} inválido: ${JSON.stringify(value)}`, { extensions: { code: 'BAD_USER_INPUT' } });
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) return fail('UUID', value);
  return value.toLowerCase();
}

function parseDate(value: unknown): string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return fail('Date', value);
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return fail('Date', value);
  return value;
}

function parseDateTime(value: unknown): Date {
  const d = typeof value === 'string' ? new Date(value) : new Date(NaN);
  if (Number.isNaN(d.getTime())) return fail('DateTime', value);
  return d;
}

function parseMoney(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail('Money', value);
  return Math.round(value * 100) / 100;
}

function serializeDateTime(value: unknown): string {
  const d = value instanceof Date ? value : new Date(value as string | number);
  if (Number.isNaN(d.getTime())) return fail('DateTime', value);
  return d.toISOString();
}

const literal = <T>(ast: ValueNode, kind: Kind, name: string, parse: (v: unknown) => T): T => {
  if (ast.kind !== kind || !('value' in ast)) return fail(name, ast.kind);
  return parse(kind === Kind.FLOAT || kind === Kind.INT ? Number(ast.value) : ast.value);
};

export const UUID = new GraphQLScalarType({
  name: 'UUID',
  serialize: (v) => parseUuid(v),
  parseValue: parseUuid,
  parseLiteral: (ast) => literal(ast, Kind.STRING, 'UUID', parseUuid),
});

export const DateScalar = new GraphQLScalarType({
  name: 'Date',
  serialize: (v) => parseDate(v instanceof Date ? v.toISOString().slice(0, 10) : v),
  parseValue: parseDate,
  parseLiteral: (ast) => literal(ast, Kind.STRING, 'Date', parseDate),
});

export const DateTime = new GraphQLScalarType({
  name: 'DateTime',
  serialize: serializeDateTime,
  parseValue: parseDateTime,
  parseLiteral: (ast) => literal(ast, Kind.STRING, 'DateTime', parseDateTime),
});

export const Money = new GraphQLScalarType({
  name: 'Money',
  serialize: (v) => parseMoney(typeof v === 'string' ? Number(v) : v),
  parseValue: parseMoney,
  parseLiteral: (ast) =>
    ast.kind === Kind.INT || ast.kind === Kind.FLOAT ? parseMoney(Number(ast.value)) : fail('Money', ast.kind),
});
