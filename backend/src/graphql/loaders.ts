import DataLoader from 'dataloader';
import { db } from '../db.js';
import { log } from '../log.js';
import { mapMedication, type Medication } from '../queries/catalog.js';

export interface Category { id: number; name: string; slug: string }
export interface Laboratory { id: number; name: string }
export interface OrderItemView {
  orderId: string; medicationId: number; medicationName: string;
  quantity: number; unitPrice: number; lineTotal: number;
}
export interface PrescriptionView {
  orderId: string; prescriptionNumber: string; doctorName: string; doctorLicense: string; issuedAt: string;
}
export interface StatusChangeView { orderId: string; status: string; reason: string | null; occurredAt: Date }

/**
 * DataLoader instrumentado. Cada lote se registra en el log del servidor:
 *   "[dataloader] categoryById: 12 load() -> 1 consulta SQL (3 claves únicas)"
 * Es la evidencia pedida en la sustentación de que N resoluciones anidadas colapsan en 1 query.
 */
function loader<K extends string | number, V>(name: string, batch: (keys: readonly K[]) => Promise<Array<V | Error>>) {
  let calls = 0;
  const dl = new DataLoader<K, V>(async (keys) => {
    log.info('dataloader', `${name}: ${calls} load() -> 1 consulta SQL (${keys.length} claves únicas)`);
    calls = 0;
    return batch(keys);
  });
  const originalLoad = dl.load.bind(dl);
  dl.load = (key: K) => {
    calls += 1;
    return originalLoad(key);
  };
  return dl;
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/** Un conjunto de loaders POR REQUEST: el caché de DataLoader nunca se comparte entre usuarios. */
export function createLoaders() {
  return {
    categoryById: loader<number, Category | null>('categoryById', async (ids) => {
      const { rows } = await db.query<Category>('SELECT id, name, slug FROM qry.categories WHERE id = ANY($1::int[])', [ids]);
      const byId = new Map(rows.map((r) => [r.id, r]));
      return ids.map((id) => byId.get(id) ?? null);
    }),

    laboratoryById: loader<number, Laboratory | null>('laboratoryById', async (ids) => {
      const { rows } = await db.query<Laboratory>('SELECT id, name FROM qry.laboratories WHERE id = ANY($1::int[])', [ids]);
      const byId = new Map(rows.map((r) => [r.id, r]));
      return ids.map((id) => byId.get(id) ?? null);
    }),

    medicationById: loader<number, Medication | null>('medicationById', async (ids) => {
      const { rows } = await db.query('SELECT * FROM qry.medications WHERE id = ANY($1::int[])', [ids]);
      const byId = new Map(rows.map((r) => [r.id as number, mapMedication(r)]));
      return ids.map((id) => byId.get(id) ?? null);
    }),

    itemsByOrderId: loader<string, OrderItemView[]>('itemsByOrderId', async (orderIds) => {
      const { rows } = await db.query(
        `SELECT order_id, medication_id, medication_name, quantity, unit_price, line_total
           FROM qry.order_item_views WHERE order_id = ANY($1::uuid[]) ORDER BY medication_name`,
        [orderIds],
      );
      const grouped = groupBy(
        rows.map((r) => ({
          orderId: r.order_id as string, medicationId: r.medication_id as number, medicationName: r.medication_name as string,
          quantity: r.quantity as number, unitPrice: r.unit_price as number, lineTotal: r.line_total as number,
        })),
        (r) => r.orderId,
      );
      return orderIds.map((id) => grouped.get(id) ?? []);
    }),

    prescriptionByOrderId: loader<string, PrescriptionView | null>('prescriptionByOrderId', async (orderIds) => {
      const { rows } = await db.query(
        `SELECT order_id, prescription_number, doctor_name, doctor_license, issued_at
           FROM qry.prescription_views WHERE order_id = ANY($1::uuid[])`,
        [orderIds],
      );
      const byId = new Map<string, PrescriptionView>(
        rows.map((r) => [r.order_id as string, {
          orderId: r.order_id, prescriptionNumber: r.prescription_number, doctorName: r.doctor_name,
          doctorLicense: r.doctor_license, issuedAt: r.issued_at,
        }]),
      );
      return orderIds.map((id) => byId.get(id) ?? null);
    }),

    historyByOrderId: loader<string, StatusChangeView[]>('historyByOrderId', async (orderIds) => {
      const { rows } = await db.query(
        `SELECT order_id, status, reason, occurred_at
           FROM qry.order_status_history WHERE order_id = ANY($1::uuid[]) ORDER BY occurred_at, status`,
        [orderIds],
      );
      const grouped = groupBy(
        rows.map((r) => ({ orderId: r.order_id as string, status: r.status as string, reason: r.reason as string | null, occurredAt: r.occurred_at as Date })),
        (r) => r.orderId,
      );
      return orderIds.map((id) => grouped.get(id) ?? []);
    }),
  };
}

export type Loaders = ReturnType<typeof createLoaders>;
