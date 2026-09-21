import { dateTime, STATUS_LABEL } from '@/lib/format';

interface Change {
  status: string;
  reason?: string | null;
  occurredAt: string;
}

const FLOW = ['PENDING_APPROVAL', 'APPROVED', 'DISPATCHED'];

/** Línea de tiempo derivada del historial proyectado (statusHistory). */
export function StatusTimeline({ history, current }: { history: Change[]; current: string }) {
  const at = new Map(history.map((h) => [h.status, h]));
  const cancelled = at.get('CANCELLED');
  const steps = cancelled ? [...FLOW.filter((s) => at.has(s)), 'CANCELLED'] : FLOW;

  return (
    <ol className="steps" aria-label="Historial del pedido">
      {steps.map((status) => {
        const change = at.get(status);
        const isCancelled = status === 'CANCELLED';
        const cls = isCancelled ? 'cancelled' : change ? (status === current ? 'done now' : 'done') : 'pending';
        return (
          <li key={status} className={cls} aria-current={status === current ? 'step' : undefined}>
            <span className="dot" aria-hidden="true">
              {change ? '✓' : ''}
            </span>
            <div>
              <strong>{STATUS_LABEL[status]}</strong>
              {change ? (
                <span className="small muted">
                  {dateTime(change.occurredAt)}
                  {change.reason ? <><br />{change.reason}</> : null}
                </span>
              ) : (
                <span className="small">Aún no</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
