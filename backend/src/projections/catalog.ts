import { withTransaction, type Db } from '../db.js';
import { log } from '../log.js';
import type { StockChangedEvent } from '../commands/events.js';
import { normalizeText, slugify } from '../text.js';

export const LOW_STOCK_THRESHOLD = 20;

export function stockStatus(stock: number): 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' {
  if (stock <= 0) return 'OUT_OF_STOCK';
  return stock <= LOW_STOCK_THRESHOLD ? 'LOW_STOCK' : 'IN_STOCK';
}

/**
 * Construye el modelo de lectura del catálogo desde el write model.
 * Solo corre si la proyección está vacía (primer arranque): demuestra que el read model es
 * derivable y reconstruible a partir de la fuente de verdad.
 */
export async function rebuildCatalogIfEmpty(): Promise<void> {
  await withTransaction(
    async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [727_272]);
      const { rows: count } = await tx.query<{ total: number }>('SELECT count(*)::int AS total FROM qry.medications');
      if (count[0].total > 0) return;

      const { rows: meds } = await tx.query('SELECT * FROM cmd.medications ORDER BY id');
      if (meds.length === 0) return;

      const categoryNames = [...new Set<string>(meds.map((m) => m.category))];
      const labNames = [...new Set<string>(meds.map((m) => m.manufacturer))];

      const { rows: cats } = await tx.query(
        `INSERT INTO qry.categories (name, slug)
         SELECT * FROM unnest($1::text[], $2::text[])
         ON CONFLICT (name) DO UPDATE SET slug = EXCLUDED.slug
         RETURNING id, name`,
        [categoryNames, categoryNames.map(slugify)],
      );
      const { rows: labs } = await tx.query(
        `INSERT INTO qry.laboratories (name) SELECT * FROM unnest($1::text[])
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id, name`,
        [labNames],
      );
      const categoryId = new Map<string, number>(cats.map((c) => [c.name, c.id]));
      const labId = new Map<string, number>(labs.map((l) => [l.name, l.id]));

      for (const m of meds) {
        await tx.query(
          `INSERT INTO qry.medications
             (id, sku, name, active_ingredient, category_id, laboratory_id, dosage, presentation, price, description,
              requires_prescription, stock_available, stock_status, name_norm, ingredient_norm, search_text)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            m.id, m.sku, m.name, m.active_ingredient, categoryId.get(m.category), labId.get(m.manufacturer),
            m.dosage, m.presentation, m.price, m.description, m.requires_prescription, m.stock, stockStatus(m.stock),
            normalizeText(m.name), normalizeText(m.active_ingredient),
            normalizeText(`${m.name} ${m.active_ingredient} ${m.category} ${m.manufacturer}`),
          ],
        );
      }
      log.info('projection', `Catálogo proyectado desde el write model: ${meds.length} medicamentos, ${cats.length} categorías, ${labs.length} laboratorios`);
    },
    { quiet: true },
  );
}

/** Aplica un StockChanged (valor absoluto + guarda por id de evento => idempotente y tolerante a reintentos). */
export async function applyStockChanged(tx: Db, eventId: number, e: StockChangedEvent): Promise<void> {
  await tx.query(
    `UPDATE qry.medications
        SET stock_available = $2, stock_status = $3, last_event_id = $4, updated_at = $5
      WHERE id = $1 AND last_event_id < $4`,
    [e.medicationId, e.stock, stockStatus(e.stock), eventId, e.at],
  );
}
