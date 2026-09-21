import { GraphQLError } from 'graphql';
import { db } from '../db.js';

export interface OrderView {
  id: string;
  status: string;
  total: number;
  itemCount: number;
  requiresPrescription: boolean;
  cancelReason: string | null;
  placedAt: Date;
  updatedAt: Date;
}

const mapOrder = (r: any): OrderView => ({
  id: r.order_id,
  status: r.status,
  total: r.total,
  itemCount: r.item_count,
  requiresPrescription: r.requires_prescription,
  cancelReason: r.cancel_reason,
  placedAt: r.placed_at,
  updatedAt: r.updated_at,
});

/** Lee SOLO del read model. Si la proyección aún no existe devuelve null (consistencia eventual). */
export async function getOrderView(userId: string, orderId: string): Promise<OrderView | null> {
  const { rows } = await db.query('SELECT * FROM qry.order_views WHERE order_id = $1 AND user_id = $2', [orderId, userId]);
  return rows[0] ? mapOrder(rows[0]) : null;
}

export async function listOrderViews(userId: string, first?: number | null, after?: string | null) {
  const limit = Math.min(Math.max(first ?? 10, 1), 50);
  const params: unknown[] = [userId];
  let cursorSql = '';
  if (after) {
    let parsed: { ts: string; id: string };
    try {
      parsed = JSON.parse(Buffer.from(after, 'base64url').toString('utf8'));
      if (typeof parsed.ts !== 'string' || typeof parsed.id !== 'string') throw new Error();
    } catch {
      throw new GraphQLError('Cursor inválido', { extensions: { code: 'BAD_USER_INPUT' } });
    }
    params.push(parsed.ts, parsed.id);
    cursorSql = 'AND (o.placed_at, o.order_id) < ($2::timestamptz, $3::uuid)';
  }
  params.push(limit + 1);

  // El cursor lleva el timestamp como texto con microsegundos: un Date de JS truncaría a milisegundos.
  const { rows } = await db.query(
    `SELECT o.*, to_char(o.placed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_ts
       FROM qry.order_views o
      WHERE o.user_id = $1 ${cursorSql}
      ORDER BY o.placed_at DESC, o.order_id DESC
      LIMIT $${params.length}`,
    params,
  );
  const page = rows.slice(0, limit);
  const edges = page.map((r) => ({
    cursor: Buffer.from(JSON.stringify({ ts: r.cursor_ts, id: r.order_id })).toString('base64url'),
    node: mapOrder(r),
  }));
  return {
    edges,
    pageInfo: {
      hasNextPage: rows.length > limit,
      hasPreviousPage: Boolean(after),
      startCursor: edges[0]?.cursor ?? null,
      endCursor: edges[edges.length - 1]?.cursor ?? null,
    },
  };
}
