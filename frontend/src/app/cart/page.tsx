'use client';

import { useMutation, useReactiveVar } from '@apollo/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { authVar } from '@/lib/auth';
import { cartTotal, cartUnits, cartVar, clearCart, MAX_QTY, receiptsVar, removeFromCart, setQuantity } from '@/lib/cart';
import { money } from '@/lib/format';
import { PLACE_ORDER } from '@/lib/graphql';

interface DomainError {
  code: string;
  message: string;
  field?: string | null;
  medicationId?: string | null;
  requested?: number | null;
  available?: number | null;
}

const EMPTY_RX = { prescriptionNumber: '', doctorName: '', doctorLicense: '', issuedAt: '', notes: '' };

export default function CartPage() {
  const router = useRouter();
  const lines = useReactiveVar(cartVar);
  const auth = useReactiveVar(authVar);
  const [rx, setRx] = useState(EMPTY_RX);
  const [errors, setErrors] = useState<DomainError[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const idempotency = useRef<{ signature: string; key: string } | null>(null);
  const [placeOrder, { loading }] = useMutation(PLACE_ORDER);

  const needsRx = lines.some((l) => l.requiresPrescription);
  const today = new Date().toISOString().slice(0, 10);
  const fieldError = (field: string) => errors.find((e) => e.field === field)?.message;
  const stockErrors = errors.filter((e) => e.code === 'INSUFFICIENT_STOCK' || e.code === 'MEDICATION_NOT_FOUND');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors([]);
    setFailure(null);

    // Misma clave mientras el carrito no cambie: reintentar tras un corte de red no duplica el pedido.
    const signature = JSON.stringify(lines.map((l) => [l.medicationId, l.quantity]));
    if (!idempotency.current || idempotency.current.signature !== signature) {
      idempotency.current = { signature, key: crypto.randomUUID() };
    }

    // Formulario vacío: se envía sin fórmula y es el SERVIDOR quien rechaza (PRESCRIPTION_REQUIRED).
    // Formulario a medias: se avisa qué campos faltan antes de viajar (solo comodidad; el servidor revalida todo).
    const rxFilled = needsRx && Object.values({ ...rx, notes: '' }).some((v) => v.trim() !== '');
    if (rxFilled) {
      const required: Array<[keyof typeof rx, string]> = [
        ['prescriptionNumber', 'Ingresa el número de la fórmula'],
        ['doctorName', 'Ingresa el nombre del médico'],
        ['doctorLicense', 'Ingresa el registro médico'],
        ['issuedAt', 'Selecciona la fecha de emisión'],
      ];
      const missing = required.filter(([key]) => !rx[key].trim());
      if (missing.length) {
        setErrors(missing.map(([key, message]) => ({ code: 'VALIDATION_ERROR', message, field: `prescription.${key}` })));
        return;
      }
    }

    const input = {
      items: lines.map((l) => ({ medicationId: l.medicationId, quantity: l.quantity })),
      prescription: rxFilled
        ? {
            prescriptionNumber: rx.prescriptionNumber.trim(),
            doctorName: rx.doctorName.trim(),
            doctorLicense: rx.doctorLicense.trim(),
            issuedAt: rx.issuedAt,
            notes: rx.notes.trim() || undefined,
          }
        : undefined,
      idempotencyKey: idempotency.current.key,
    };

    try {
      const { data } = await placeOrder({
        variables: { input },
        // Actualización de caché tras la mutation (sin recargar nada)
        update(cache, { data }) {
          const receipt = data?.placeOrder?.receipt;
          if (!receipt) return;
          // 1) Descuento local del stock en las fichas ya cacheadas (la proyección real llegará después).
          for (const line of lines) {
            cache.modify({
              id: cache.identify({ __typename: 'Medication', id: line.medicationId }),
              fields: { availableStock: (current: number) => Math.max(0, current - line.quantity) },
            });
          }
          // 2) "Mis pedidos" quedó obsoleto: se invalida y se vuelve a pedir al abrirlo.
          cache.evict({ id: 'ROOT_QUERY', fieldName: 'myOrders' });
          cache.gc();
        },
      });

      const payload = data?.placeOrder;
      if (payload?.errors?.length) {
        setErrors(payload.errors);
        return;
      }
      const receipt = payload.receipt;
      receiptsVar({ ...receiptsVar(), [receipt.orderId]: receipt });
      clearCart();
      router.push(`/orders/${receipt.orderId}`);
    } catch (err) {
      setFailure((err as Error).message);
    }
  }

  if (lines.length === 0) {
    return (
      <div className="empty">
        <h1>Tu carrito está vacío</h1>
        <p>Agrega medicamentos desde el catálogo para armar tu pedido.</p>
        <Link href="/" className="btn btn--primary">Ir al catálogo</Link>
      </div>
    );
  }

  return (
    <>
      <h1>Carrito</h1>
      <form className="stack" onSubmit={submit} noValidate>
        <section className="panel" aria-label="Ítems del pedido">
          <table className="lines">
            <thead>
              <tr>
                <th scope="col">Medicamento</th>
                <th scope="col">Cantidad</th>
                <th scope="col" className="r">Subtotal</th>
                <th scope="col"><span className="sr-only">Quitar</span></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.medicationId}>
                  <td>
                    <strong>{l.name}</strong>
                    <div className="small muted">
                      {l.presentation}, {money(l.price)} c/u{l.requiresPrescription ? ', requiere fórmula' : ''}
                    </div>
                  </td>
                  <td>
                    <div className="qty">
                      <button type="button" aria-label={`Quitar una unidad de ${l.name}`} onClick={() => setQuantity(l.medicationId, l.quantity - 1)} disabled={l.quantity <= 1}>−</button>
                      <span>{l.quantity}</span>
                      <button type="button" aria-label={`Agregar una unidad de ${l.name}`} onClick={() => setQuantity(l.medicationId, l.quantity + 1)} disabled={l.quantity >= MAX_QTY}>+</button>
                    </div>
                  </td>
                  <td className="r num">{money(l.price * l.quantity)}</td>
                  <td className="r">
                    <button type="button" className="btn btn--link" onClick={() => removeFromCart(l.medicationId)}>Quitar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="spread" style={{ marginTop: '1rem' }}>
            <span className="muted">{cartUnits(lines)} unidades</span>
            <span className="total num">{money(cartTotal(lines))}</span>
          </div>
          <p className="small muted">El total definitivo lo calcula el servidor con los precios vigentes.</p>
        </section>

        {needsRx && (
          <fieldset className="panel panel--rx stack" style={{ margin: 0 }}>
            <legend className="sr-only">Fórmula médica</legend>
            <div>
              <h2>Fórmula médica</h2>
              <p className="muted small">Tu pedido incluye medicamentos que se venden solo con fórmula. La farmacia la revisa antes de aprobar.</p>
            </div>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="rxn">Número de fórmula</label>
                <input id="rxn" className="input" value={rx.prescriptionNumber} onChange={(e) => setRx({ ...rx, prescriptionNumber: e.target.value })} aria-invalid={!!fieldError('prescription.prescriptionNumber')} />
                {fieldError('prescription.prescriptionNumber') && <span className="small" style={{ color: 'var(--danger)' }}>{fieldError('prescription.prescriptionNumber')}</span>}
              </div>
              <div className="field">
                <label htmlFor="rxd">Fecha de emisión</label>
                <input id="rxd" type="date" max={today} className="input" value={rx.issuedAt} onChange={(e) => setRx({ ...rx, issuedAt: e.target.value })} />
                {(fieldError('prescription.issuedAt')) && <span className="small" style={{ color: 'var(--danger)' }}>{fieldError('prescription.issuedAt')}</span>}
              </div>
              <div className="field">
                <label htmlFor="rxm">Nombre del médico</label>
                <input id="rxm" className="input" value={rx.doctorName} onChange={(e) => setRx({ ...rx, doctorName: e.target.value })} />
                {fieldError('prescription.doctorName') && <span className="small" style={{ color: 'var(--danger)' }}>{fieldError('prescription.doctorName')}</span>}
              </div>
              <div className="field">
                <label htmlFor="rxl">Registro médico</label>
                <input id="rxl" className="input" value={rx.doctorLicense} onChange={(e) => setRx({ ...rx, doctorLicense: e.target.value })} />
                {fieldError('prescription.doctorLicense') && <span className="small" style={{ color: 'var(--danger)' }}>{fieldError('prescription.doctorLicense')}</span>}
              </div>
            </div>
            <div className="field">
              <label htmlFor="rxo">Observaciones (opcional)</label>
              <input id="rxo" className="input" value={rx.notes} onChange={(e) => setRx({ ...rx, notes: e.target.value })} />
              <span className="hint">Para probar un rechazo de la farmacia, usa un número de fórmula que empiece por REJ.</span>
            </div>
          </fieldset>
        )}

        {(errors.length > 0 || failure) && (
          <div className="notice notice--error" role="alert">
            <strong>No pudimos emitir el pedido.</strong>
            <ul>
              {stockErrors.map((e, i) => <li key={`s${i}`}>{e.message}</li>)}
              {errors.filter((e) => !stockErrors.includes(e)).map((e, i) => <li key={`o${i}`}>{e.message}</li>)}
              {failure && <li>{failure}</li>}
            </ul>
          </div>
        )}

        {!auth ? (
          <div className="notice notice--info">
            Para emitir el pedido necesitas una cuenta.{' '}
            <Link href="/login" onClick={() => sessionStorage.setItem('ap.next', '/cart')}>Ingresa</Link> o{' '}
            <Link href="/register" onClick={() => sessionStorage.setItem('ap.next', '/cart')}>crea una cuenta</Link>.
          </div>
        ) : (
          <div className="row">
            <button type="submit" className="btn btn--primary" disabled={loading}>
              {loading ? 'Enviando pedido…' : 'Confirmar pedido'}
            </button>
            <Link href="/" className="btn">Seguir comprando</Link>
          </div>
        )}
      </form>
    </>
  );
}
