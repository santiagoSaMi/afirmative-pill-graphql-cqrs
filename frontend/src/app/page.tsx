'use client';

import { useQuery } from '@apollo/client';
import { useMemo, useState } from 'react';
import { MedicationCard, type CatalogMedication } from '@/components/MedicationCard';
import { CATALOG_FACETS, CATALOG_LIST } from '@/lib/graphql';
import { useDebounced } from '@/lib/useDebounced';

type RxMode = 'all' | 'rx' | 'otc';
const PAGE_SIZE = 12;

export default function CatalogPage() {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [rx, setRx] = useState<RxMode>('all');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [sort, setSort] = useState('NAME_ASC');
  const debouncedSearch = useDebounced(search, 300);

  const filter = useMemo(
    () => ({
      search: debouncedSearch.trim() || undefined,
      categoryIds: categoryId ? [categoryId] : undefined,
      requiresPrescription: rx === 'all' ? undefined : rx === 'rx',
      inStockOnly: inStockOnly || undefined,
    }),
    [debouncedSearch, categoryId, rx, inStockOnly],
  );

  const { data, loading, error, fetchMore, refetch } = useQuery(CATALOG_LIST, {
    variables: { filter, sort, first: PAGE_SIZE },
    notifyOnNetworkStatusChange: true,
  });
  const facets = useQuery(CATALOG_FACETS, { variables: { filter } });

  const connection = data?.medications;
  const edges: Array<{ cursor: string; node: CatalogMedication }> = connection?.edges ?? [];
  const total: number | undefined = connection?.totalCount;
  const [loadingMore, setLoadingMore] = useState(false);

  async function loadMore() {
    setLoadingMore(true);
    try {
      await fetchMore({ variables: { after: connection.pageInfo.endCursor } });
    } finally {
      setLoadingMore(false);
    }
  }

  const categories: Array<{ count: number; category: { id: string; name: string } }> = facets.data?.catalogFacets?.categories ?? [];

  return (
    <>
      <section className="stack" aria-labelledby="titulo">
        <h1 id="titulo">Medicamentos con entrega a domicilio</h1>
        <div className="searchpill">
          <span className="cap cap--a">Buscar</span>
          <label className="sr-only" htmlFor="q">
            Buscar por nombre, principio activo o categoría
          </label>
          <input
            id="q"
            type="search"
            placeholder="Nombre comercial o principio activo, por ejemplo ibuprofeno"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
          />
          <span className="cap cap--b num" aria-live="polite">
            {total === undefined ? '…' : `${total} resultados`}
          </span>
        </div>
      </section>

      <div className="catalog">
        <aside className="facets" aria-label="Filtros">
          <div>
            <h3>Categoría</h3>
            <div className="chips">
              <button type="button" className="chip" aria-pressed={categoryId === null} onClick={() => setCategoryId(null)}>
                <span>Todas</span>
              </button>
              {categories.map(({ category, count }) => (
                <button
                  key={category.id}
                  type="button"
                  className="chip"
                  aria-pressed={categoryId === category.id}
                  onClick={() => setCategoryId(categoryId === category.id ? null : category.id)}
                >
                  <span>{category.name}</span>
                  <span className="count">{count}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3>Tipo de venta</h3>
            <div className="seg" role="group" aria-label="Tipo de venta">
              <button type="button" aria-pressed={rx === 'all'} onClick={() => setRx('all')}>Todos</button>
              <button type="button" aria-pressed={rx === 'otc'} onClick={() => setRx('otc')}>
                Libre{facets.data ? ` ${facets.data.catalogFacets.overTheCounter}` : ''}
              </button>
              <button type="button" aria-pressed={rx === 'rx'} onClick={() => setRx('rx')}>
                Fórmula{facets.data ? ` ${facets.data.catalogFacets.prescriptionRequired}` : ''}
              </button>
            </div>
          </div>

          <label className="check">
            <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} />
            Solo con existencias
          </label>

          <div className="field">
            <label htmlFor="sort">Ordenar por</label>
            <select id="sort" className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="NAME_ASC">Nombre (A a Z)</option>
              <option value="PRICE_ASC">Precio, menor a mayor</option>
              <option value="PRICE_DESC">Precio, mayor a menor</option>
            </select>
          </div>
        </aside>

        <section aria-live="polite">
          {error && (
            <div className="notice notice--error" role="alert">
              No pudimos cargar el catálogo: {error.message}{' '}
              <button type="button" className="btn btn--link" onClick={() => refetch()}>Reintentar</button>
            </div>
          )}

          {loading && edges.length === 0 && (
            <div className="grid" aria-busy="true">
              {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" />)}
            </div>
          )}

          {!loading && !error && edges.length === 0 && (
            <div className="empty">
              <p>Ningún medicamento coincide con esos filtros.</p>
              <button type="button" className="btn" onClick={() => { setSearch(''); setCategoryId(null); setRx('all'); setInStockOnly(false); }}>
                Quitar filtros
              </button>
            </div>
          )}

          {edges.length > 0 && (
            <div className="stack">
              <div className="grid">
                {edges.map(({ node }) => <MedicationCard key={node.id} med={node} />)}
              </div>
              {connection.pageInfo.hasNextPage && (
                <div className="row" style={{ justifyContent: 'center' }}>
                  <button type="button" className="btn" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? 'Cargando…' : `Mostrar más (${(total ?? 0) - edges.length} restantes)`}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
