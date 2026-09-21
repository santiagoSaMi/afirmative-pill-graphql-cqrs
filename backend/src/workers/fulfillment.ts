import { config } from '../config.js';
import { withTransaction } from '../db.js';
import { log, sleep } from '../log.js';
import { approveOrder, cancelOrderAndReleaseStock, dispatchOrder, type LockedOrder } from '../commands/orderLifecycle.js';

/**
 * Process manager de fulfillment (simulación del proceso asíncrono de validación médica y despacho):
 *   PENDING_APPROVAL -> (revisión de fórmula si aplica) -> APPROVED -> DISPATCHED
 * Regla de demostración: una fórmula cuyo número empiece por "REJ" es rechazada por la farmacia
 * y la orden se cancela liberando el inventario.
 * Es durable: se guía por cmd.orders.transition_due_at, no por temporizadores en memoria.
 */
async function tick(): Promise<void> {
  await withTransaction(
    async (tx) => {
      const { rows } = await tx.query<LockedOrder>(
        `SELECT id, user_id, status, requires_prescription
           FROM cmd.orders
          WHERE status IN ('PENDING_APPROVAL', 'APPROVED') AND transition_due_at <= now()
          ORDER BY transition_due_at
          LIMIT 10
            FOR UPDATE SKIP LOCKED`,
      );
      for (const order of rows) {
        if (order.status === 'APPROVED') {
          await dispatchOrder(tx, order);
          continue;
        }
        if (order.requires_prescription) {
          const rx = await tx.query<{ prescription_number: string }>(
            'SELECT prescription_number FROM cmd.prescriptions WHERE order_id = $1',
            [order.id],
          );
          const number = rx.rows[0]?.prescription_number;
          if (!number || /^REJ/i.test(number)) {
            await cancelOrderAndReleaseStock(tx, order, 'Fórmula médica rechazada en la validación farmacéutica');
            continue;
          }
        }
        await approveOrder(tx, order);
      }
    },
    { quiet: true },
  );
}

export function startFulfillmentWorker() {
  let stopped = false;
  void (async () => {
    while (!stopped) {
      try {
        await tick();
      } catch (err) {
        log.error('fulfillment', `Fallo del ciclo: ${(err as Error).message}`);
      }
      await sleep(config.WORKER_POLL_MS);
    }
  })();
  log.info('fulfillment', `Worker iniciado (revisión de fórmula ${config.REVIEW_DELAY_MS}ms, despacho ${config.DISPATCH_DELAY_MS}ms)`);
  return { stop: () => { stopped = true; } };
}
