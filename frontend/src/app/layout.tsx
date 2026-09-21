import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ApolloWrapper } from '@/components/ApolloWrapper';
import { Header } from '@/components/Header';
import './globals.css';

export const metadata: Metadata = {
  title: 'Afirmative Pill, farmacia en línea',
  description: 'Catálogo de medicamentos, pedidos con fórmula médica y seguimiento en tiempo real.',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        {/* ApolloProvider en la raíz del árbol: todos los componentes comparten cliente y caché. */}
        <ApolloWrapper>
          <Header />
          <main className="shell page">{children}</main>
        </ApolloWrapper>
      </body>
    </html>
  );
}
