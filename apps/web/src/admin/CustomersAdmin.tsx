import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Mail, Phone, Search } from 'lucide-react';
import { get } from '@/lib/api';
import { brl } from '@/lib/format';
import { ErrorBox, Spinner } from '@/ui/misc';
import { Empty, PageHeader } from './AdminUI';

interface Customer { id: string; name: string; email: string; phone: string; created_at: string; last_login_at: string | null; orders_count: number; spent_cents: number; last_order_at: string | null }
interface Order { number: number; status: string; type: string; total_cents: number; created_at: string }
const PAGE = 50;
const STATUS: Record<string, string> = { aguardando: 'Aguardando pagamento', novo: 'Recebido', preparo: 'Em preparo', pronto: 'Pronto', saiu: 'Saiu para entrega', entregue: 'Entregue', cancelado: 'Cancelado' };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');

/** Clientes que criaram conta na loja (login por e-mail): contato, pedidos e quanto já gastaram. */
export default function CustomersAdmin() {
  const [q, setQ] = useState(''); const [term, setTerm] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ total: number; customers: Customer[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [orders, setOrders] = useState<Record<string, Order[]>>({});

  useEffect(() => { const t = setTimeout(() => { setTerm(q.trim()); setOffset(0); }, 300); return () => clearTimeout(t); }, [q]);
  const load = useCallback(async () => {
    try { setData(await get(`/v1/staff/customers?limit=${PAGE}&offset=${offset}${term ? `&q=${encodeURIComponent(term)}` : ''}`)); setError(null); }
    catch (e) { setError((e as Error).message); }
  }, [term, offset]);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (id: string) => {
    setOpen(open === id ? null : id);
    if (open !== id && !orders[id]) { try { const r = await get<{ orders: Order[] }>(`/v1/staff/customers/${id}/orders`); setOrders((o) => ({ ...o, [id]: r.orders })); } catch { /* a linha mostra vazio */ } }
  };

  if (error && !data) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Spinner />;
  return (
    <>
      <PageHeader title="Clientes" subtitle={`${data.total} ${data.total === 1 ? 'cliente cadastrado' : 'clientes cadastrados'} na sua loja`} />
      <div className="relative mb-3 max-w-md">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input className="input !pl-9" placeholder="Buscar por nome, e-mail ou telefone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar cliente" />
      </div>
      {data.customers.length === 0 ? <Empty>{term ? 'Nenhum cliente encontrado.' : 'Ainda não há clientes com conta. Eles aparecem aqui quando entram na loja com o e-mail.'}</Empty> : (
        <div className="card divide-y divide-border overflow-hidden">
          <div className="hidden grid-cols-[1.4fr_1.6fr_.6fr_.8fr_.8fr_.8fr] gap-3 bg-muted px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
            <span>Cliente</span><span>Contato</span><span className="text-right">Pedidos</span><span className="text-right">Total gasto</span><span>Último pedido</span><span>Cliente desde</span>
          </div>
          {data.customers.map((c) => (
            <div key={c.id}>
              <button onClick={() => void toggle(c.id)} className="grid w-full grid-cols-1 items-center gap-1 px-3 py-2.5 text-left text-sm hover:bg-muted/60 md:grid-cols-[1.4fr_1.6fr_.6fr_.8fr_.8fr_.8fr] md:gap-3" aria-expanded={open === c.id}>
                <span className="flex items-center gap-1.5 font-semibold">{open === c.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{c.name || <span className="font-normal text-muted-foreground">Sem nome</span>}</span>
                <span className="min-w-0 text-xs text-muted-foreground"><span className="flex items-center gap-1 truncate"><Mail size={12} />{c.email}</span>{c.phone && <span className="flex items-center gap-1"><Phone size={12} />{c.phone}</span>}</span>
                <span className="md:text-right"><span className="md:hidden text-muted-foreground">Pedidos: </span>{c.orders_count}</span>
                <span className="md:text-right"><span className="md:hidden text-muted-foreground">Total: </span>{brl(c.spent_cents / 100)}</span>
                <span><span className="md:hidden text-muted-foreground">Último: </span>{day(c.last_order_at)}</span>
                <span><span className="md:hidden text-muted-foreground">Desde: </span>{day(c.created_at)}</span>
              </button>
              {open === c.id && (
                <div className="bg-muted/40 px-3 py-2 pl-8 text-xs">
                  {!orders[c.id] ? <span className="text-muted-foreground">Carregando…</span> : orders[c.id]!.length === 0 ? <span className="text-muted-foreground">Nenhum pedido feito na conta.</span> : (
                    <ul className="space-y-1">{orders[c.id]!.map((o) => (
                      <li key={o.number} className="flex flex-wrap justify-between gap-2"><span><b>#{o.number}</b> · {STATUS[o.status] ?? o.status} · {new Date(o.created_at).toLocaleString('pt-BR')}</span><span className="font-semibold">{brl(o.total_cents / 100)}</span></li>
                    ))}</ul>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {data.total > PAGE && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <button className="btn-ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Anterior</button>
          <span>{offset + 1}–{Math.min(offset + PAGE, data.total)} de {data.total}</span>
          <button className="btn-ghost" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Próxima</button>
        </div>
      )}
    </>
  );
}
