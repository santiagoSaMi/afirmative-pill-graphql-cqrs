'use client';

import { useReactiveVar } from '@apollo/client';
import Link from 'next/link';
import { addToCart, cartVar, MAX_QTY } from '@/lib/cart';
import { money } from '@/lib/format';
import { RxBadge, StockBadge } from './Badges';

export interface CatalogMedication {
  id: string;
  name: string;
  activeIngredient: string;
  presentation: string;
  price: number;
  requiresPrescription: boolean;
  stockStatus: string;
}

export function MedicationCard({ med }: { med: CatalogMedication }) {
  const cart = useReactiveVar(cartVar);
  const inCart = cart.find((l) => l.medicationId === med.id)?.quantity ?? 0;
  const soldOut = med.stockStatus === 'OUT_OF_STOCK';

  return (
    <article className={`card ${med.requiresPrescription ? 'card--rx' : 'card--otc'}`}>
      <div className="row">
        <RxBadge requires={med.requiresPrescription} />
        {med.stockStatus !== 'IN_STOCK' && <StockBadge status={med.stockStatus} />}
      </div>
      <div>
        <h3>
          <Link href={`/medications/${med.id}`}>{med.name}</Link>
        </h3>
        <p className="ingredient">{med.activeIngredient}</p>
        <p className="small muted">{med.presentation}</p>
      </div>
      <div className="foot">
        <span className="price num">{money(med.price)}</span>
        <button
          type="button"
          className={`btn btn--sm ${med.requiresPrescription ? 'btn--rx' : 'btn--primary'}`}
          disabled={soldOut || inCart >= MAX_QTY}
          onClick={() =>
            addToCart({
              medicationId: med.id,
              name: med.name,
              presentation: med.presentation,
              price: med.price,
              requiresPrescription: med.requiresPrescription,
            })
          }
        >
          {soldOut ? 'Agotado' : inCart > 0 ? `Agregar otra (${inCart} en carrito)` : 'Agregar al carrito'}
        </button>
      </div>
    </article>
  );
}
