import { z } from 'zod';
import { withTransaction, type Db } from '../db.js';
import type { AuthUser } from '../auth.js';
import { config } from '../config.js';
import { log } from '../log.js';
import type { DomainError } from './errors.js';
import { appendEvent, type OrderStatus, type OrderTransitionEvent, type StockChangedEvent } from './events.js';
import { receiptById, type OrderReceipt } from './receipts.js';

/** Máquina de estados de la orden (el agregado protege sus transiciones). */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_APPROVAL: ['APPROVED', 'CANCELLED'],
  APPROVED: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: [],
  CANCELLED: [],
};
export const canTransition = (from: OrderStatus, to: OrderStatus) => TRANSITIONS[from].includes(to);

export interface LockedOrder {
  id: string;
  user_id: string;
  status: OrderStatus;
  requires_prescription: boolean;
}

async function applyTransition(
  tx: Db,
  order: LockedOrder,
  to: OrderStatus,
  opts: { reason?: string | null; nextTransitionMs?: number | null },
): Promise<Date> {
  if (!canTransition(order.status, to)) {
    throw new Error(`Transición inválida ${order.status} -> ${to} (orden ${order.id})`);
  }
  const { rows, rowCount } = await tx.query(
    `UPDATE cmd.orders
        SET status = $2, cancel_reason = $3, version = version + 1, updated_at = now(),
            transition_due_at = CASE WHEN $4::double precision IS NULL THEN NULL
                                     ELSE now() + make_interval(secs => $4::double precision) END
      WHERE id = $1 AND status = $5
  RETURNING updated_at`,
    [order.id, to, opts.reason ?? null, opts.nextTransitionMs == null ? null : opts.nextTransitionMs / 1000, order.status],
  );
  if (!rowCount) throw new Error(`Conflicto de concurrencia al mover la orden ${order.id} a ${to}`);
  return rows[0].updated_at as Date;
}

export async function approveOrder(tx: Db, order: LockedOrder): Promise<void> {
  const at = await applyTransition(tx, order, 'APPROVED', { nextTransitionMs: config.DISPATCH_DELAY_MS });
  const payload: OrderTransitionEvent = { orderId: order.id, userId: order.user_id, at: at.toISOString() };
  await appendEvent(tx, { aggregateType: 'order', aggregateId: order.id, type: 'OrderApproved', payload });
  log.info('command', `ApproveOrder ${order.id}`);
}

export async function dispatchOrder(tx: Db, order: LockedOrder): Promise<void> {
  const at = await applyTransition(tx, order, 'DISPATCHED', { nextTransitionMs: null });
  const payload: OrderTransitionEvent = { orderId: order.id, userId: order.user_id, at: at.toISOString() };
  await appendEvent(tx, { aggregateType: 'order', aggregateId: order.id, type: 'OrderDispatched', payload });
  log.info('command', `DispatchOrder ${order.id}`);
}

/** Cancela y LIBERA el inventario reservado (compensación), emitiendo StockChanged por cada medicamento. */
export async function cancelOrderAndReleaseStock(tx: Db, order: LockedOrder, reason: string): Promise<void> {
  const at = await applyTransition(tx, order, 'CANCELLED', { reason, nextTransitionMs: null });

  // Bloqueo ordenado por id (mismo orden que PlaceOrder) para evitar deadlocks.
  await tx.query(
    `SELECT id FROM cmd.medications
      WHERE id IN (SELECT medication_id FROM cmd.order_items WHERE order_id = $1)
      ORDER BY id FOR UPDATE`,
    [order.id],
  );
  const { rows } = await tx.query(
    `UPDATE cmd.medications m
        SET stock = m.stock + i.quantity, version = m.version + 1, updated_at = now()
       FROM cmd.order_items i
      WHERE i.order_id = $1 AND m.id = i.medication_id
  RETURNING m.id, m.stock, m.updated_at`,
    [order.id],
  );
  for (const r of rows) {
    const payload: StockChangedEvent = { medicationId: r.id, stock: r.stock, at: r.updated_at.toISOString() };
    await appendEvent(tx, { aggregateType: 'medication', aggregateId: String(r.id), type: 'StockChanged', payload });
  }
  const payload: OrderTransitionEvent = { orderId: order.id, userId: order.user_id, at: at.toISOString(), reason };
  await appendEvent(tx, { aggregateType: 'order', aggregateId: order.id, type: 'OrderCancelled', payload });
  log.info('command', `CancelOrder ${order.id}: ${reason}`);
}

// ─────────────────────── Comando de paciente: CancelOrder ───────────────────────

const cancelSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().trim().max(300).nullish(),
});

export interface CancelOrderResult {
  receipt: OrderReceipt | null;
  errors: DomainError[];
}

export async function cancelOrder(user: AuthUser, rawInput: unknown): Promise<CancelOrderResult> {
  const parsed = cancelSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { receipt: null, errors: [{ code: 'VALIDATION_ERROR', message: 'Identificador de orden inválido', field: 'orderId' }] };
  }
  const { orderId, reason } = parsed.data;

  return withTransaction(async (tx) => {
    const { rows } = await tx.query<LockedOrder>(
      'SELECT id, user_id, status, requires_prescription FROM cmd.orders WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [orderId, user.id],
    );
    const order = rows[0];
    if (!order) {
      return { receipt: null, errors: [{ code: 'ORDER_NOT_FOUND' as const, message: 'La orden no existe', field: 'orderId' }] };
    }
    if (!canTransition(order.status, 'CANCELLED')) {
      return {
        receipt: await receiptById(tx, orderId),
        errors: [{ code: 'INVALID_STATE_TRANSITION' as const, message: `No se puede cancelar una orden en estado ${order.status}`, field: 'orderId' }],
      };
    }
    await cancelOrderAndReleaseStock(tx, order, reason || 'Cancelada por el paciente');
    return { receipt: await receiptById(tx, orderId), errors: [] };
  });
}
