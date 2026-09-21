import { config } from '../config.js';
import { withTransaction, type Db } from '../db.js';
import { log, sleep } from '../log.js';
import { ORDER_CHANGED, pubsub, type OrderChangedMessage } from '../pubsub.js';
import { applyStockChanged } from './catalog.js';
import { applyOrderPlaced, applyOrderTransition } from './orders.js';

const PROJECTOR_LOCK = 727_273;

interface OutboxRow {
  id: number;
  event_type: string;
  payload: any;
}

/** Aplica un evento al read model. Devuelve el mensaje de notificación si afecta a una orden. */
async function applyEvent(tx: Db, ev: OutboxRow): Promise<OrderChangedMessage | null> {
  switch (ev.event_type) {
    case 'OrderPlaced':
      await applyOrderPlaced(tx, ev.id, ev.payload);
      return { orderId: ev.payload.orderId, userId: ev.payload.userId };
    case 'OrderApproved':
      await applyOrderTransition(tx, ev.id, 'APPROVED', ev.payload);
      return { orderId: ev.payload.orderId, userId: ev.payload.userId };
    case 'OrderDispatched':
      await applyOrderTransition(tx, ev.id, 'DISPATCHED', ev.payload);
      return { orderId: ev.payload.orderId, userId: ev.payload.userId };
    case 'OrderCancelled':
      await applyOrderTransition(tx, ev.id, 'CANCELLED', ev.payload);
      return { orderId: ev.payload.orderId, userId: ev.payload.userId };
    case 'StockChanged':
      await applyStockChanged(tx, ev.id, ev.payload);
      return null;
    default:
      log.warn('projector', `Evento desconocido ${ev.event_type} (#${ev.id}); se marca como procesado`);
      return null;
  }
}

/**
 * Proyector: consume el outbox y actualiza el read model.
 *  · Un advisory lock transaccional garantiza un único proyector activo => orden estricto por id.
 *  · PROJECTION_DELAY_MS retrasa a propósito la proyección para hacer visible la consistencia eventual.
 *  · Tras el COMMIT se notifica a las Subscriptions (nunca antes: el cliente solo ve lo ya proyectado).
 */
async function tick(): Promise<void> {
  const notifications: OrderChangedMessage[] = [];

  const processed = await withTransaction(
    async (tx) => {
      const lock = await tx.query<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS ok', [PROJECTOR_LOCK]);
      if (!lock.rows[0].ok) return 0;

      const { rows } = await tx.query<OutboxRow>(
        `SELECT id, event_type, payload
           FROM cmd.outbox_events
          WHERE processed_at IS NULL
            AND created_at <= now() - make_interval(secs => $1::double precision)
          ORDER BY id
          LIMIT 100`,
        [config.PROJECTION_DELAY_MS / 1000],
      );
      if (rows.length === 0) return 0;

      for (const ev of rows) {
        const note = await applyEvent(tx, ev);
        if (note) notifications.push(note);
      }
      await tx.query('UPDATE cmd.outbox_events SET processed_at = now() WHERE id = ANY($1::bigint[])', [rows.map((r) => r.id)]);
      return rows.length;
    },
    { quiet: true },
  );

  if (processed > 0) {
    log.info('projector', `${processed} evento(s) proyectado(s) al read model; ${notifications.length} notificación(es) a suscriptores`);
  }
  for (const n of notifications) await pubsub.publish(ORDER_CHANGED, n);
}

export function startProjector() {
  let stopped = false;
  void (async () => {
    while (!stopped) {
      try {
        await tick();
      } catch (err) {
        log.error('projector', `Fallo del ciclo de proyección: ${(err as Error).message}`);
      }
      await sleep(config.PROJECTOR_POLL_MS);
    }
  })();
  log.info('projector', `Proyector iniciado (poll ${config.PROJECTOR_POLL_MS}ms, retraso artificial ${config.PROJECTION_DELAY_MS}ms)`);
  return { stop: () => { stopped = true; } };
}
