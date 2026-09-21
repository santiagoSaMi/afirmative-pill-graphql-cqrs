import type { Db } from '../db.js';

export type OrderStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'DISPATCHED' | 'CANCELLED';

/** Eventos de dominio publicados vía outbox transaccional. */
export interface OrderPlacedEvent {
  orderId: string;
  userId: string;
  total: number;
  itemCount: number;
  requiresPrescription: boolean;
  placedAt: string;
  items: Array<{ medicationId: number; name: string; quantity: number; unitPrice: number }>;
  prescription: { number: string; doctorName: string; doctorLicense: string; issuedAt: string } | null;
}
export interface OrderTransitionEvent {
  orderId: string;
  userId: string;
  at: string;
  reason?: string | null;
}
export interface StockChangedEvent {
  medicationId: number;
  stock: number;
  at: string;
}

export type EventType = 'OrderPlaced' | 'OrderApproved' | 'OrderDispatched' | 'OrderCancelled' | 'StockChanged';

/** Debe llamarse DENTRO de la transacción del comando: estado y evento se confirman (o revierten) juntos. */
export async function appendEvent(
  tx: Db,
  event: { aggregateType: 'order' | 'medication'; aggregateId: string; type: EventType; payload: object },
): Promise<void> {
  await tx.query(
    `INSERT INTO cmd.outbox_events (aggregate_type, aggregate_id, event_type, payload)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [event.aggregateType, event.aggregateId, event.type, JSON.stringify(event.payload)],
  );
}
