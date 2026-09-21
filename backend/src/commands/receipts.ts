import type { Db } from '../db.js';
import type { OrderStatus } from './events.js';

export interface OrderReceipt {
  orderId: string;
  status: OrderStatus;
  total: number;
  itemCount: number;
  requiresPrescription: boolean;
  placedAt: Date;
}

const RECEIPT_SELECT = `
  SELECT o.id, o.status, o.total, o.requires_prescription, o.created_at,
         COALESCE((SELECT SUM(i.quantity) FROM cmd.order_items i WHERE i.order_id = o.id), 0)::int AS item_count
    FROM cmd.orders o`;

const toReceipt = (r: any): OrderReceipt => ({
  orderId: r.id,
  status: r.status,
  total: r.total,
  itemCount: r.item_count,
  requiresPrescription: r.requires_prescription,
  placedAt: r.created_at,
});

export async function receiptById(tx: Db, orderId: string): Promise<OrderReceipt | null> {
  const { rows } = await tx.query(`${RECEIPT_SELECT} WHERE o.id = $1`, [orderId]);
  return rows[0] ? toReceipt(rows[0]) : null;
}

export async function receiptByIdempotencyKey(tx: Db, userId: string, key: string): Promise<OrderReceipt | null> {
  const { rows } = await tx.query(`${RECEIPT_SELECT} WHERE o.user_id = $1 AND o.idempotency_key = $2`, [userId, key]);
  return rows[0] ? toReceipt(rows[0]) : null;
}
