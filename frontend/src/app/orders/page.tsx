'use client';

import { useQuery, useReactiveVar } from '@apollo/client';
import Link from 'next/link';
import { useState } from 'react';
import { authVar } from '@/lib/auth';
import { dateTime, money, shortId, STATUS_LABEL } from '@/lib/format';
import { MY_ORDERS } from '@/lib/graphql';

const statusClass = (s: string) => (s === 'CANCELLED' ? 'badge--danger' : s === 'PENDING_APPROVAL' ? 'badge--warn' : 'badge--otc');

export default function OrdersPage() {
  const auth = useReactiveVar(authVar);
  const { data, loading, error, fetchMore } = useQuery(MY_ORDERS, {
    variables: { first: 10 },
    skip: !auth,
    fetchPolicy: 'cache-and-network',
  });
  const [loadingMore, setLoadingMore] = useState(false);

  if (!auth) {
    return (
      <div className="empty">
        <h1>Mis pedidos</h1>
        <p>Ingresa para ver tus pedidos y su estado.</p>
        <Link href="/login" className="btn btn--primary">Ingresar</Link>
      </div>
    );
  }

  const conn = data?.myOrders;
  const edges: Array<{ cursor: string; node: any }> = conn?.edges ?? [];

  return (
    <>
      <h1>Mis pedidos</h1>
      {error && <div className="notice notice--error" role="alert">{error.message}</div>}
      {loading && edges.length === 0 && <div className="skeleton" aria-busy="true" />}
      {!loading && !error && edges.length === 0 && (
        <div className="empty">
          <p>Aún no tienes pedidos.</p>
          <Link href="/" className="btn btn--primary">Ir al catálogo</Link>
        </div>
      )}
      <div className="stack">
        {edges.map(({ node }) => (
          <Link key={node.id} href={`/orders/${node.id}`} className="panel spread" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div>
              <strong>Pedido {shortId(node.id)}</strong>
              <div className="small muted">{dateTime(node.placedAt)}, {node.itemCount} unidades</div>
            </div>
            <div className="row">
              <span className={`badge ${statusClass(node.status)}`}>{STATUS_LABEL[node.status]}</span>
              <span className="price num">{money(node.total)}</span>
            </div>
          </Link>
        ))}
        {conn?.pageInfo.hasNextPage && (
          <button
            type="button"
            className="btn"
            disabled={loadingMore}
            onClick={async () => {
              setLoadingMore(true);
              try { await fetchMore({ variables: { after: conn.pageInfo.endCursor } }); } finally { setLoadingMore(false); }
            }}
          >
            {loadingMore ? 'Cargando…' : 'Mostrar más'}
          </button>
        )}
      </div>
    </>
  );
}
