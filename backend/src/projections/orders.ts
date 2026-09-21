import type { Db } from '../db.js';
import type { OrderPlacedEvent, OrderStatus, OrderTransitionEvent } from '../commands/events.js';

/** Proyección de la orden: cada evento se aplica de forma idempotente (ON CONFLICT / guarda por last_event_id). */
export async function applyOrderPlaced(tx: Db, eventId: number, e: OrderPlacedEvent): Promise<void> {
  await tx.query(
    `INSERT INTO qry.order_views
       (order_id, user_id, status, total, item_count, requires_prescription, placed_at, updated_at, last_event_id)
     VALUES ($1, $2, 'PENDING_APPROVAL', $3, $4, $5, $6, $6, $7)
     ON CONFLICT (order_id) DO NOTHING`,
    [e.orderId, e.userId, e.total, e.itemCount, e.requiresPrescription, e.placedAt, eventId],
  );
  await tx.query(
    `INSERT INTO qry.order_item_views (order_id, medication_id, medication_name, quantity, unit_price, line_total)
     SELECT $1::uuid, t.mid, t.name, t.qty, t.price, t.qty * t.price
       FROM unnest($2::int[], $3::text[], $4::int[], $5::numeric[]) AS t(mid, name, qty, price)
     ON CONFLICT DO NOTHING`,
    [e.orderId, e.items.map((i) => i.medicationId), e.items.map((i) => i.name), e.items.map((i) => i.quantity), e.items.map((i) => i.unitPrice)],
  );
  await tx.query(
    `INSERT INTO qry.order_status_history (order_id, status, occurred_at)
     VALUES ($1, 'PENDING_APPROVAL', $2) ON CONFLICT DO NOTHING`,
    [e.orderId, e.placedAt],
  );
  if (e.prescription) {
    await tx.query(
      `INSERT INTO qry.prescription_views (order_id, prescription_number, doctor_name, doctor_license, issued_at)
       VALUES ($1, $2, $3, $4, $5::date) ON CONFLICT DO NOTHING`,
      [e.orderId, e.prescription.number, e.prescription.doctorName, e.prescription.doctorLicense, e.prescription.issuedAt],
    );
  }
}

export async function applyOrderTransition(tx: Db, eventId: number, status: OrderStatus, e: OrderTransitionEvent): Promise<void> {
  await tx.query(
    `UPDATE qry.order_views
        SET status = $2, cancel_reason = $3, updated_at = $4, last_event_id = $5
      WHERE order_id = $1 AND last_event_id < $5`,
    [e.orderId, status, e.reason ?? null, e.at, eventId],
  );
  await tx.query(
    `INSERT INTO qry.order_status_history (order_id, status, reason, occurred_at)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [e.orderId, status, e.reason ?? null, e.at],
  );
}
