import { useEffect, useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import { get } from '@/lib/api';
import { STATUS_LABEL, brlc } from '@/lib/orders';
import { describeEvent, type TableEvent } from './tableHistory';

const hour = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Histórico de atividades da mesa: quem abriu, quem adicionou o quê, conta, transferência, pagamento. `version` muda quando a comanda muda (recarrega). */
export function TableHistory({ orderId, version, title = 'Histórico da comanda' }: { orderId: string; version: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<TableEvent[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError(false);
    get<{ events: TableEvent[] }>(`/v1/staff/orders/${orderId}/events`).then((r) => alive && setEvents(r.events)).catch(() => alive && setError(true));
    return () => { alive = false; };
  }, [open, orderId, version]);

  return (
    <div className="card mb-3 overflow-hidden">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 p-3 text-left text-sm font-medium">
        <History size={16} className="text-muted-foreground" aria-hidden /> {title} <span className="ml-auto text-xs font-normal text-muted-foreground">{open ? 'ocultar' : 'ver quem fez o quê'}</span>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2">
          {error && <p className="py-2 text-sm text-destructive">Não foi possível carregar o histórico.</p>}
          {!events && !error && <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Carregando…</p>}
          {events && events.length === 0 && <p className="py-2 text-sm text-muted-foreground">Sem atividades registradas.</p>}
          {events && events.length > 0 && (
            <ol className="relative space-y-3 border-l border-border py-1 pl-4">
              {[...events].reverse().map((e, i) => {
                const d = describeEvent(e, { money: brlc, status: (s) => STATUS_LABEL[s as keyof typeof STATUS_LABEL] ?? s });
                return (
                  <li key={i} className="text-sm">
                    <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-primary" aria-hidden />
                    <div><b>{d.who}</b> {d.text}</div>
                    <div className="text-xs text-muted-foreground">{hour(e.at)}</div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
