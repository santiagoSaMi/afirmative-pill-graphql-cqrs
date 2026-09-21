'use client';

import { useQuery, useReactiveVar } from '@apollo/client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { RxBadge, StockBadge } from '@/components/Badges';
import { addToCart, cartVar, MAX_QTY } from '@/lib/cart';
import { money } from '@/lib/format';
import { MEDICATION_DETAIL } from '@/lib/graphql';

export default function MedicationPage() {
  const { id } = useParams<{ id: string }>();
  const cart = useReactiveVar(cartVar);
  const { data, loading, error } = useQuery(MEDICATION_DETAIL, { variables: { id } });
  const med = data?.medication;

  if (loading && !med) return <div className="skeleton" aria-busy="true" />;
  if (error) return <div className="notice notice--error" role="alert">No pudimos cargar el medicamento: {error.message}</div>;
  if (!med) {
    return (
      <div className="empty">
        <p>Ese medicamento no existe.</p>
        <Link href="/" className="btn">Volver al catálogo</Link>
      </div>
    );
  }

  const inCart = cart.find((l) => l.medicationId === med.id)?.quantity ?? 0;
  const soldOut = med.stockStatus === 'OUT_OF_STOCK';

  return (
    <>
      <p className="small"><Link href="/">Catálogo</Link> / {med.category.name}</p>
      <div className="detail">
        <section className="panel stack">
          <div className="row">
            <RxBadge requires={med.requiresPrescription} />
            <StockBadge status={med.stockStatus} />
          </div>
          <div>
            <h1>{med.name}</h1>
            <p className="muted">{med.activeIngredient}, {med.dosage}</p>
          </div>
          <p>{med.description}</p>
          <dl className="spec">
            <dt>Presentación</dt><dd>{med.presentation}</dd>
            <dt>Categoría</dt><dd>{med.category.name}</dd>
            <dt>Laboratorio</dt><dd>{med.laboratory.name}</dd>
            <dt>Referencia</dt><dd className="num">{med.sku}</dd>
            <dt>Unidades disponibles</dt><dd className="num">{med.availableStock}</dd>
          </dl>
        </section>

        <aside className={`panel stack ${med.requiresPrescription ? 'panel--rx' : ''}`}>
          <p className="price num">{money(med.price)}</p>
          {med.requiresPrescription && (
            <p className="small">Este medicamento se vende con fórmula médica. La solicitarás al finalizar el pedido.</p>
          )}
          <button
            type="button"
            className={`btn ${med.requiresPrescription ? 'btn--rx' : 'btn--primary'}`}
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
            {soldOut ? 'Agotado' : 'Agregar al carrito'}
          </button>
          {inCart > 0 && <p className="small">Tienes {inCart} en el carrito. <Link href="/cart">Ver carrito</Link></p>}
        </aside>
      </div>
    </>
  );
}
