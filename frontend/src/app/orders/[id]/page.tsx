'use client';

import { useMutation, useQuery, useReactiveVar, useSubscription } from '@apollo/client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { StatusTimeline } from '@/components/StatusTimeline';
import { authVar } from '@/lib/auth';
import { receiptsVar } from '@/lib/cart';
import { dateOnly, dateTime, money, shortId, STATUS_LABEL } from '@/lib/format';
import { CANCEL_ORDER, ORDER_DETAIL, ORDER_STATUS_CHANGED } from '@/lib/graphql';

const SYNC_GIVE_UP_MS = 45_000;

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const auth = useReactiveVar(authVar);
  const receipts = useReactiveVar(receiptsVar);
  const receipt = receipts[id];
  const [liveNotice, setLiveNotice] = useState<string | null>(null);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  const { data, loading, error, refetch, startPolling, stopPolling } = useQuery(ORDER_DETAIL, {
    variables: { id },
    skip: !auth,
    fetchPolicy: 'cache-and-network',
  });
  const order = data?.order ?? null;

  // Consistencia eventual: el comando ya confirmó, pero la proyección puede tardar unos instantes.
  // Mientras Query.order devuelva null se sondea; al aparecer, las Subscriptions toman el relevo.
  useEffect(() => {
    if (!auth) return;
    if (order) stopPolling();
    else startPolling(1500);
    return () => stopPolling();
  }, [order, auth, startPolling, stopPolling]);

  useEffect(() => {
    if (order) return;
    const t = setTimeout(() => setGaveUp(true), SYNC_GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [order]);

  // Tiempo real: el servidor empuja la proyección actualizada; el caché normalizado la fusiona por id.
  useSubscription(ORDER_STATUS_CHANGED, {
    variables: { orderId: id },
    skip: !auth,
    onData: ({ data: sub }) => {
      const updated = sub.data?.orderStatusChanged;
      if (!updated) return;
      setLiveNotice(`Estado actualizado: ${STATUS_LABEL[updated.status] ?? updated.status}`);
      if (!order) refetch();
    },
  });

  const [cancelOrder, { loading: cancelling }] = useMutation(CANCEL_ORDER);

  async function cancel() {
    setCancelNotice(null);
    try {
      const { data: res } = await cancelOrder({ variables: { input: { orderId: id } } });
      const errs = res?.cancelOrder?.errors ?? [];
      setCancelNotice(errs.length ? errs[0].message : 'Recibimos la cancelación. El estado se actualizará en unos segundos.');
    } catch (err) {
      setCancelNotice((err as Error).message);
    }
  }

  if (!auth) {
    return (
      <div className="empty">
        <h1>Seguimiento del pedido</h1>
        <p>Ingresa para ver este pedido.</p>
        <Link href="/login" className="btn btn--primary">Ingresar</Link>
      </div>
    );
  }
  if (error && !order) return <div className="notice notice--error" role="alert">No pudimos cargar el pedido: {error.message}</div>;

  // Vista intermedia: acuse del comando sin proyección todavía.
  if (!order) {
    if (!receipt && gaveUp) {
      return (
        <div className="empty">
          <h1>No encontramos este pedido</h1>
          <p>Verifica el enlace o revisa tu lista de pedidos.</p>
          <Link href="/orders" className="btn">Mis pedidos</Link>
        </div>
      );
    }
    return (
      <>
        <h1>Pedido {shortId(id)}</h1>
        <section className="panel stack" aria-live="polite">
          <div className="row">
            <span className="pulse" aria-hidden="true" />
            <strong>{receipt ? 'Recibimos tu pedido' : 'Buscando tu pedido'}</strong>
          </div>
          {receipt ? (
            <>
              <p>
                El inventario ya quedó reservado y el pedido está en estado <strong>{STATUS_LABEL[receipt.status]}</strong>.
                Estamos preparando el detalle y el seguimiento; aparecerán aquí en unos segundos.
              </p>
              <p className="muted small">{receipt.itemCount} unidades, total {money(receipt.total)}</p>
            </>
          ) : (
            <p className="muted">Estamos sincronizando la información del pedido.</p>
          )}
        </section>
      </>
    );
  }

  const canCancel = order.status === 'PENDING_APPROVAL' || order.status === 'APPROVED';
  const badge = order.status === 'CANCELLED' ? 'badge--danger' : order.status === 'PENDING_APPROVAL' ? 'badge--warn' : 'badge--otc';

  return (
    <>
      <div className="spread">
        <div>
          <p className="small"><Link href="/orders">Mis pedidos</Link></p>
          <h1>Pedido {shortId(order.id)}</h1>
        </div>
        <div className="row">
          <span className="live"><i aria-hidden="true" /> Actualización en vivo</span>
          <span className={`badge ${badge}`}>{STATUS_LABEL[order.status]}</span>
        </div>
      </div>

      {liveNotice && <div className="notice notice--ok" role="status">{liveNotice}</div>}
      {order.cancelReason && <div className="notice notice--warn">Motivo de cancelación: {order.cancelReason}</div>}

      <div className="detail">
        <section className="panel stack" aria-label="Detalle del pedido">
          <table className="lines">
            <thead>
              <tr>
                <th scope="col">Medicamento</th>
                <th scope="col">Cantidad</th>
                <th scope="col" className="r">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((it: any) => (
                <tr key={it.medicationId}>
                  <td>
                    <Link href={`/medications/${it.medicationId}`}>{it.medicationName}</Link>
                    {it.medication?.presentation && <div className="small muted">{it.medication.presentation}</div>}
                  </td>
                  <td className="num">{it.quantity} × {money(it.unitPrice)}</td>
                  <td className="r num">{money(it.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="spread">
            <span className="muted">Realizado el {dateTime(order.placedAt)}</span>
            <span className="total num">{money(order.total)}</span>
          </div>
          {order.prescription && (
            <div className="notice notice--info">
              <strong>Fórmula médica {order.prescription.prescriptionNumber}</strong>
              <div className="small">
                {order.prescription.doctorName}, registro {order.prescription.doctorLicense}, emitida el {dateOnly(order.prescription.issuedAt)}
              </div>
            </div>
          )}
        </section>

        <aside className="panel stack">
          <h2>Seguimiento</h2>
          <StatusTimeline history={order.statusHistory} current={order.status} />
          {canCancel && (
            <button type="button" className="btn btn--danger" onClick={cancel} disabled={cancelling}>
              {cancelling ? 'Cancelando…' : 'Cancelar pedido'}
            </button>
          )}
          {cancelNotice && <p className="small" role="status">{cancelNotice}</p>}
        </aside>
      </div>
    </>
  );
}
