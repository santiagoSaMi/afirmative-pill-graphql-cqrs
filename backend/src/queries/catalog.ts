import { GraphQLError } from 'graphql';
import { db } from '../db.js';
import { escapeLike, normalizeText } from '../text.js';

export interface MedicationFilter {
  search?: string | null;
  name?: string | null;
  activeIngredient?: string | null;
  categoryIds?: string[] | null;
  requiresPrescription?: boolean | null;
  inStockOnly?: boolean | null;
}

export interface Medication {
  id: string;
  sku: string;
  name: string;
  activeIngredient: string;
  dosage: string;
  presentation: string;
  price: number;
  description: string;
  requiresPrescription: boolean;
  stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  availableStock: number;
  updatedAt: Date;
  categoryId: number;
  laboratoryId: number;
}

export function mapMedication(r: any): Medication {
  return {
    id: String(r.id),
    sku: r.sku,
    name: r.name,
    activeIngredient: r.active_ingredient,
    dosage: r.dosage,
    presentation: r.presentation,
    price: r.price,
    description: r.description,
    requiresPrescription: r.requires_prescription,
    stockStatus: r.stock_status,
    availableStock: r.stock_available,
    updatedAt: r.updated_at,
    categoryId: r.category_id,
    laboratoryId: r.laboratory_id,
  };
}

// Paginación por cursor (keyset): estable ante inserciones y O(log n) gracias a los índices (col, id).
const SORTS = {
  NAME_ASC: { column: 'm.name', dir: 'ASC', cast: 'text', key: 'name' },
  PRICE_ASC: { column: 'm.price', dir: 'ASC', cast: 'numeric', key: 'price' },
  PRICE_DESC: { column: 'm.price', dir: 'DESC', cast: 'numeric', key: 'price' },
} as const;
export type MedicationSortKey = keyof typeof SORTS;

const encodeCursor = (v: string | number, id: number) => Buffer.from(JSON.stringify({ v, id })).toString('base64url');

function decodeCursor(cursor: string): { v: string | number; id: number } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if ((typeof parsed.v === 'string' || typeof parsed.v === 'number') && Number.isInteger(parsed.id)) return parsed;
  } catch {
    /* cae al error de abajo */
  }
  throw new GraphQLError('Cursor inválido', { extensions: { code: 'BAD_USER_INPUT' } });
}

function buildWhere(filter: MedicationFilter | null | undefined, params: unknown[], opts: { ignoreCategory?: boolean } = {}) {
  const where: string[] = [];
  const f = filter ?? {};

  // Cada palabra debe aparecer (AND). Los índices GIN trigram aceleran LIKE '%palabra%'.
  const addTerms = (column: string, text?: string | null) => {
    if (!text) return;
    for (const word of normalizeText(text).split(/\s+/).filter(Boolean).slice(0, 6)) {
      params.push(`%${escapeLike(word)}%`);
      where.push(`${column} LIKE $${params.length}`);
    }
  };
  addTerms('m.search_text', f.search);
  addTerms('m.name_norm', f.name);
  addTerms('m.ingredient_norm', f.activeIngredient);

  if (!opts.ignoreCategory && f.categoryIds?.length) {
    params.push(f.categoryIds.map(Number).filter(Number.isInteger));
    where.push(`m.category_id = ANY($${params.length}::int[])`);
  }
  if (typeof f.requiresPrescription === 'boolean') {
    params.push(f.requiresPrescription);
    where.push(`m.requires_prescription = $${params.length}`);
  }
  if (f.inStockOnly) where.push('m.stock_available > 0');
  return where;
}

const whereSql = (where: string[]) => (where.length ? `WHERE ${where.join(' AND ')}` : '');

export async function searchMedications(args: {
  filter?: MedicationFilter | null;
  sort?: MedicationSortKey | null;
  first?: number | null;
  after?: string | null;
}) {
  const sort = SORTS[args.sort ?? 'NAME_ASC'];
  const limit = Math.min(Math.max(args.first ?? 12, 1), 50);

  const params: unknown[] = [];
  const where = buildWhere(args.filter, params);
  const countSql = `SELECT count(*)::int AS total FROM qry.medications m ${whereSql(where)}`;
  const countParams = [...params];

  if (args.after) {
    const cursor = decodeCursor(args.after);
    params.push(cursor.v);
    const pv = params.length;
    params.push(cursor.id);
    const pi = params.length;
    where.push(`(${sort.column}, m.id) ${sort.dir === 'ASC' ? '>' : '<'} ($${pv}::${sort.cast}, $${pi}::int)`);
  }
  params.push(limit + 1);

  const { rows } = await db.query(
    `SELECT m.* FROM qry.medications m ${whereSql(where)}
      ORDER BY ${sort.column} ${sort.dir}, m.id ${sort.dir}
      LIMIT $${params.length}`,
    params,
  );

  const page = rows.slice(0, limit);
  const edges = page.map((r) => ({ cursor: encodeCursor(r[sort.key], r.id), node: mapMedication(r) }));
  return {
    edges,
    pageInfo: {
      hasNextPage: rows.length > limit,
      hasPreviousPage: Boolean(args.after),
      startCursor: edges[0]?.cursor ?? null,
      endCursor: edges[edges.length - 1]?.cursor ?? null,
    },
    // Función: graphql-js la invoca solo si el cliente pidió totalCount.
    totalCount: async () => (await db.query<{ total: number }>(countSql, countParams)).rows[0].total,
  };
}

export async function getFacets(filter?: MedicationFilter | null) {
  const params: unknown[] = [];
  const where = buildWhere(filter, params, { ignoreCategory: true });
  const { rows } = await db.query(
    `SELECT m.category_id,
            count(*)::int AS total,
            (count(*) FILTER (WHERE m.requires_prescription))::int AS rx
       FROM qry.medications m ${whereSql(where)}
      GROUP BY m.category_id
      ORDER BY total DESC, m.category_id`,
    params,
  );
  const total = rows.reduce((s, r) => s + r.total, 0);
  const rx = rows.reduce((s, r) => s + r.rx, 0);
  return {
    categories: rows.map((r) => ({ categoryId: r.category_id as number, count: r.total as number })),
    prescriptionRequired: rx,
    overTheCounter: total - rx,
  };
}
