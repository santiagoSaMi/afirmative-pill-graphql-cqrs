'use client';

import { useApolloClient, useReactiveVar } from '@apollo/client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { authVar, clearAuth } from '@/lib/auth';
import { cartUnits, cartVar } from '@/lib/cart';

export function Header() {
  const auth = useReactiveVar(authVar);
  const cart = useReactiveVar(cartVar);
  const client = useApolloClient();
  const pathname = usePathname();
  const router = useRouter();

  const current = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href) ? 'page' : undefined);

  async function logout() {
    clearAuth();
    await client.clearStore(); // descarta pedidos y datos privados del caché
    router.push('/');
  }

  return (
    <header className="topbar">
      <div className="shell">
        <Link href="/" className="brand">
          <span className="capsule" aria-hidden="true" />
          Afirmative Pill
        </Link>
        <nav className="nav" aria-label="Principal">
          <Link href="/" aria-current={pathname === '/' ? 'page' : undefined}>
            Catálogo
          </Link>
          <Link href="/orders" aria-current={current('/orders')}>
            Mis pedidos
          </Link>
        </nav>
        <div className="end">
          <Link href="/cart" className="cartlink" aria-label={`Carrito, ${cartUnits(cart)} unidades`}>
            Carrito <b>{cartUnits(cart)}</b>
          </Link>
          {auth ? (
            <div className="row">
              <span className="small">{auth.user.fullName}</span>
              <button type="button" className="btn btn--sm" onClick={logout}>
                Cerrar sesión
              </button>
            </div>
          ) : (
            <div className="row">
              <Link href="/login" className="btn btn--sm">
                Ingresar
              </Link>
              <Link href="/register" className="btn btn--sm btn--primary">
                Crear cuenta
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
