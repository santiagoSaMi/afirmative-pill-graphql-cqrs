import { STOCK_LABEL } from '@/lib/format';

export function RxBadge({ requires }: { requires: boolean }) {
  return requires ? (
    <span className="badge badge--rx">Requiere fórmula médica</span>
  ) : (
    <span className="badge badge--otc">Venta libre</span>
  );
}

export function StockBadge({ status }: { status: string }) {
  const cls = status === 'OUT_OF_STOCK' ? 'badge--danger' : status === 'LOW_STOCK' ? 'badge--warn' : 'badge--muted';
  return <span className={`badge ${cls}`}>{STOCK_LABEL[status] ?? status}</span>;
}
