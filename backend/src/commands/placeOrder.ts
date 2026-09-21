import { z } from 'zod';
import { db, withTransaction } from '../db.js';
import type { AuthUser } from '../auth.js';
import { config } from '../config.js';
import { log } from '../log.js';
import { zodToDomainErrors, type DomainError } from './errors.js';
import { appendEvent, type OrderPlacedEvent, type StockChangedEvent } from './events.js';
import { receiptByIdempotencyKey, type OrderReceipt } from './receipts.js';

export const MAX_LINES = 20;
export const MAX_QUANTITY_PER_LINE = 10;
export const PRESCRIPTION_MAX_AGE_DAYS = 60;

const itemSchema = z.object({
  medicationId: z.coerce.number({ invalid_type_error: 'medicationId inválido' }).int().positive('medicationId inválido'),
  quantity: z
    .number()
    .int('La cantidad debe ser un entero')
    .min(1, 'La cantidad mínima es 1')
    .max(MAX_QUANTITY_PER_LINE, `La cantidad máxima por medicamento es ${MAX_QUANTITY_PER_LINE}`),
});

const prescriptionSchema = z.object({
  prescriptionNumber: z.string().trim().regex(/^[A-Za-z0-9-]{5,30}$/, 'Número de fórmula inválido (5-30 caracteres alfanuméricos)'),
  doctorName: z.string().trim().min(3, 'Ingresa el nombre del médico').max(120),
  doctorLicense: z.string().trim().regex(/^[A-Za-z0-9-]{4,20}$/, 'Registro médico inválido (4-20 caracteres alfanuméricos)'),
  issuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha de emisión inválida'),
  notes: z.string().trim().max(500).nullish(),
});

const placeOrderSchema = z.object({
  items: z.array(itemSchema).min(1, 'El pedido debe tener al menos un ítem').max(MAX_LINES, `Máximo ${MAX_LINES} ítems por pedido`),
  prescription: prescriptionSchema.nullish(),
  idempotencyKey: z.string().trim().min(8).max(64).nullish(),
});

export interface PlaceOrderResult {
  receipt: OrderReceipt | null;
  errors: DomainError[];
}

const cents = (amount: number) => Math.round(amount * 100);

function prescriptionDateError(issuedAt: string): string | null {
  const today = new Date().toISOString().slice(0, 10);
  if (issuedAt > today) return 'La fecha de emisión de la fórmula no puede ser futura';
  const ageDays = (Date.parse(today) - Date.parse(issuedAt)) / 86_400_000;
  if (Number.isNaN(ageDays)) return 'Fecha de emisión inválida';
  if (ageDays > PRESCRIPTION_MAX_AGE_DAYS) return `La fórmula está vencida (vigencia máxima ${PRESCRIPTION_MAX_AGE_DAYS} días)`;
  return null;
}

/**
 * COMANDO: PlaceOrder  (intención de negocio: "el paciente quiere comprar estos medicamentos")
 *
 * Invariantes protegidas dentro de UNA transacción:
 *  1. Todo medicamento existe.
 *  2. Si algún ítem exige fórmula (requires_prescription) DEBE venir el soporte de la fórmula, vigente.
 *  3. Hay stock suficiente. Las filas se bloquean con SELECT ... FOR UPDATE (en orden de id: sin deadlocks),
 *     así la verificación y el descuento son atómicos frente a compras concurrentes;
 *     el CHECK (stock >= 0) de la tabla es la última red de seguridad.
 *  4. El total se calcula en el servidor con los precios de la base de datos (nunca se confía en el cliente).
 * El cambio de estado y los eventos (outbox) se confirman en la misma transacción.
 */
export async function placeOrder(user: AuthUser, rawInput: unknown): Promise<PlaceOrderResult> {
  const parsed = placeOrderSchema.safeParse(rawInput);
  if (!parsed.success) return { receipt: null, errors: zodToDomainErrors(parsed.error) };
  const input = parsed.data;

  // Duplicados del mismo medicamento se fusionan en una sola línea.
  const quantities = new Map<number, number>();
  for (const item of input.items) quantities.set(item.medicationId, (quantities.get(item.medicationId) ?? 0) + item.quantity);
  const overLimit = [...quantities.entries()].find(([, q]) => q > MAX_QUANTITY_PER_LINE);
  if (overLimit) {
    return {
      receipt: null,
      errors: [{ code: 'VALIDATION_ERROR', message: `La cantidad máxima por medicamento es ${MAX_QUANTITY_PER_LINE}`, field: 'items', medicationId: String(overLimit[0]) }],
    };
  }
  const ids = [...quantities.keys()].sort((a, b) => a - b);

  try {
    return await withTransaction(async (tx): Promise<PlaceOrderResult> => {
      if (input.idempotencyKey) {
        const existing = await receiptByIdempotencyKey(tx, user.id, input.idempotencyKey);
        if (existing) return { receipt: existing, errors: [] };
      }

      const { rows: meds } = await tx.query(
        `SELECT id, name, price, stock, requires_prescription
           FROM cmd.medications WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE`,
        [ids],
      );
      const byId = new Map<number, any>(meds.map((m) => [m.id as number, m]));

      const errors: DomainError[] = [];

      for (const id of ids) {
        const med = byId.get(id);
        if (!med) {
          errors.push({ code: 'MEDICATION_NOT_FOUND', message: `El medicamento ${id} no existe`, field: 'items', medicationId: String(id) });
          continue;
        }
        const requested = quantities.get(id)!;
        if (med.stock < requested) {
          errors.push({
            code: 'INSUFFICIENT_STOCK',
            message: med.stock === 0 ? `${med.name} está agotado` : `${med.name}: solo quedan ${med.stock} unidades`,
            field: 'items',
            medicationId: String(id),
            requested,
            available: med.stock,
          });
        }
      }

      const rxMeds = meds.filter((m) => m.requires_prescription);
      const needsPrescription = rxMeds.length > 0;
      if (needsPrescription) {
        if (!input.prescription) {
          errors.push({
            code: 'PRESCRIPTION_REQUIRED',
            message: `Se requiere fórmula médica para: ${rxMeds.map((m) => m.name).join(', ')}`,
            field: 'prescription',
          });
        } else {
          const dateError = prescriptionDateError(input.prescription.issuedAt);
          if (dateError) errors.push({ code: 'PRESCRIPTION_INVALID', message: dateError, field: 'prescription.issuedAt' });
        }
      }

      if (errors.length > 0) {
        log.info('command', `PlaceOrder rechazado (${errors.map((e) => e.code).join(', ')})`, { userId: user.id });
        return { receipt: null, errors };
      }

      const lines = ids.map((id) => {
        const med = byId.get(id);
        return { medicationId: id, name: med.name as string, quantity: quantities.get(id)!, unitPrice: med.price as number };
      });
      const totalCents = lines.reduce((sum, l) => sum + cents(l.unitPrice) * l.quantity, 0);
      const total = totalCents / 100;
      const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);

      // Con fórmula: revisión farmacéutica completa. Solo venta libre: validación automática breve
      // (unos segundos en PENDING_APPROVAL para que el estado sea observable).
      const reviewDelayMs = needsPrescription ? config.REVIEW_DELAY_MS : Math.min(config.REVIEW_DELAY_MS, 4000);
      const reviewDelaySeconds = reviewDelayMs / 1000;
      const { rows: orderRows } = await tx.query(
        `INSERT INTO cmd.orders (user_id, status, total, requires_prescription, idempotency_key, transition_due_at)
         VALUES ($1, 'PENDING_APPROVAL', $2, $3, $4, now() + make_interval(secs => $5::double precision))
         RETURNING id, created_at`,
        [user.id, total, needsPrescription, input.idempotencyKey ?? null, reviewDelaySeconds],
      );
      const orderId: string = orderRows[0].id;
      const placedAt: Date = orderRows[0].created_at;

      await tx.query(
        `INSERT INTO cmd.order_items (order_id, medication_id, medication_name, quantity, unit_price)
         SELECT $1::uuid, t.mid, t.name, t.qty, t.price
           FROM unnest($2::int[], $3::text[], $4::int[], $5::numeric[]) AS t(mid, name, qty, price)`,
        [orderId, lines.map((l) => l.medicationId), lines.map((l) => l.name), lines.map((l) => l.quantity), lines.map((l) => l.unitPrice)],
      );

      let prescriptionEvent: OrderPlacedEvent['prescription'] = null;
      if (needsPrescription && input.prescription) {
        const p = input.prescription;
        await tx.query(
          `INSERT INTO cmd.prescriptions (order_id, prescription_number, doctor_name, doctor_license, issued_at, notes)
           VALUES ($1, $2, $3, $4, $5::date, $6)`,
          [orderId, p.prescriptionNumber, p.doctorName, p.doctorLicense, p.issuedAt, p.notes ?? null],
        );
        prescriptionEvent = { number: p.prescriptionNumber, doctorName: p.doctorName, doctorLicense: p.doctorLicense, issuedAt: p.issuedAt };
      }
      // Minimización de datos: si el pedido no exige fórmula, cualquier fórmula enviada NO se almacena.

      const stockEvents: StockChangedEvent[] = [];
      for (const line of lines) {
        const { rows, rowCount } = await tx.query(
          `UPDATE cmd.medications
              SET stock = stock - $2, version = version + 1, updated_at = now()
            WHERE id = $1 AND stock >= $2
        RETURNING stock, updated_at`,
          [line.medicationId, line.quantity],
        );
        if (!rowCount) throw new Error(`Invariante violada: stock insuficiente para ${line.medicationId} tras el bloqueo`);
        stockEvents.push({ medicationId: line.medicationId, stock: rows[0].stock, at: rows[0].updated_at.toISOString() });
      }

      const placedEvent: OrderPlacedEvent = {
        orderId, userId: user.id, total, itemCount, requiresPrescription: needsPrescription,
        placedAt: placedAt.toISOString(), items: lines, prescription: prescriptionEvent,
      };
      await appendEvent(tx, { aggregateType: 'order', aggregateId: orderId, type: 'OrderPlaced', payload: placedEvent });
      for (const e of stockEvents) {
        await appendEvent(tx, { aggregateType: 'medication', aggregateId: String(e.medicationId), type: 'StockChanged', payload: e });
      }

      log.info('command', `PlaceOrder ${orderId} confirmado: ${itemCount} unidades, total ${total}, fórmula=${needsPrescription}`);
      return {
        receipt: { orderId, status: 'PENDING_APPROVAL', total, itemCount, requiresPrescription: needsPrescription, placedAt },
        errors: [],
      };
    });
  } catch (err: any) {
    // Reintento concurrente con la misma idempotencyKey: devolver la orden ya creada.
    if (err?.code === '23505' && input.idempotencyKey) {
      const existing = await receiptByIdempotencyKey(db, user.id, input.idempotencyKey);
      if (existing) return { receipt: existing, errors: [] };
    }
    throw err;
  }
}
