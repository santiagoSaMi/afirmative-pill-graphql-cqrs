'use client';

import { ApolloProvider } from '@apollo/client';
import { useEffect, useState, type ReactNode } from 'react';
import { loadAuth } from '@/lib/auth';
import { loadCart } from '@/lib/cart';
import { getClient } from '@/lib/client';

/**
 * Provider raíz. La sesión y el carrito viven en localStorage y las suscripciones usan WebSocket, así que
 * la app se monta solo en el navegador: el servidor de Next entrega el cascarón y nunca consulta la API.
 */
export function ApolloWrapper({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadAuth();
    loadCart();
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <div className="boot" aria-busy="true">
        Cargando Afirmative Pill…
      </div>
    );
  }
  return <ApolloProvider client={getClient()}>{children}</ApolloProvider>;
}
