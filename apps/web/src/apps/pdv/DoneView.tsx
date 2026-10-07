import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Check, ClipboardList, Clock, Loader2, Plus, Printer, ReceiptText, ShoppingBag, XCircle } from 'lucide-react';
import { ApiError, get, post } from '@/lib/api';
import { brlc } from '@/lib/orders';
import { cx } from '@/ui/kit';
import { PAY_LABEL, type Receipt } from './shared';

interface Job { id: string; kind: string; status: 'pendente' | 'enviado' | 'impresso' | 'falhou'; zone: string; created_at: string; printed_at: string | null; last_error: string | null }
const hour = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');

/** Pedido finalizado: confirmação, resumo, forma de pagamento e o cupom enviado a cada setor de impressão. */
export default function DoneView({ r, onNew, onOpenOrder, onReprint }: { r: Receipt; onNew: () => void; onOpenOrder: () => void; onReprint: () => Promise<number> }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setJobs((await get<{ jobs: Job[] }>(`/v1/staff/print/orders/${r.orderId}/jobs`)).jobs); } catch { setJobs([]); } }, [r.orderId]);
  // as impressões saem em segundos: acompanha até todas terminarem (ou por ~30 s)
  useEffect(() => {
    void load(); let n = 0;
    const t = setInterval(() => { n++; void load(); if (n >= 12) clearInterval(t); }, 2500);
    return () => clearInterval(t);
  }, [load]);

  const bySector = new Map<string, Job>();
  for (const j of jobs ?? []) if (j.kind !== 'conta' || !bySector.has(j.zone)) bySector.set(j.zone, j);     // o último de cada setor
  const reprint = async () => { setBusy(true); setMsg(null); try { const n = await onReprint(); setMsg(n ? `${n} cupom(ns) enviado(s) para impressão.` : 'Nenhuma impressora configurada para este pedido.'); void load(); } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Não foi possível reimprimir.'); } finally { setBusy(false); } };
  const retry = async (id: string) => { try { await post(`/v1/staff/print/jobs/${id}/retry`); void load(); } catch { /* o status continua "falhou" */ } };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className={cx('flex items-center gap-5 rounded-3xl border p-5', r.paid ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900')} role="status">
          <span className={cx('flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-white', r.paid ? 'bg-emerald-600' : 'bg-amber-500')}>{r.paid ? <Check size={44} strokeWidth={3} /> : <Clock size={40} />}</span>
          <div><h1 className="text-3xl font-extrabold leading-tight">{r.paid ? 'Pedido finalizado com sucesso!' : 'Pedido lançado, a receber'}</h1>
            <p className="text-lg">{r.paid ? (r.mode === 'tela' ? 'Pagamento aprovado e registrado no sistema.' : 'Pagamento recebido e registrado no sistema.') : 'O pagamento ainda não foi recebido. Receba depois em Pedidos.'}</p></div>
        </div>

        <div className="card p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-primary"><ReceiptText size={24} /></span><div><div className="text-sm text-muted-foreground">Nº do pedido</div><div className="text-2xl font-extrabold">#{r.number}</div><div className="text-xs text-muted-foreground">{r.at}</div></div></div>
            <div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-primary"><ShoppingBag size={24} /></span><div><div className="text-sm text-muted-foreground">Tipo de atendimento</div><div className="text-xl font-extrabold">{r.modeLabel}</div><div className="text-sm text-muted-foreground">{r.customer || 'Cliente não informado'}</div></div></div>
          </div>
          <h2 className="mb-2 mt-5 text-lg font-bold">Itens do pedido</h2>
          <div className="overflow-hidden rounded-2xl border border-border">
            <table className="w-full text-sm"><thead className="bg-muted/60 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Qtd.</th><th className="px-3 py-2 text-left">Item</th><th className="px-3 py-2 text-right">Total</th></tr></thead>
              <tbody className="divide-y divide-border">{r.lines.map((l) => (
                <tr key={l.key}><td className="px-3 py-2.5 font-semibold">{l.qty}</td>
                  <td className="px-3 py-2.5"><div className="flex items-center gap-3">{l.image ? <img src={l.image} alt="" className="h-11 w-11 rounded-lg object-cover" /> : null}<div><div className="font-bold">{l.name}</div>{l.detail && <div className="text-xs text-muted-foreground">{l.detail}</div>}</div></div></td>
                  <td className="px-3 py-2.5 text-right font-bold">{brlc(l.totalCents)}</td></tr>))}</tbody></table>
          </div>
          <div className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{brlc(r.subtotalCents)}</span></div>
            {r.feeCents > 0 && <div className="flex justify-between text-muted-foreground"><span>Entrega</span><span>{brlc(r.feeCents)}</span></div>}
            {r.discountCents > 0 && <div className="flex justify-between text-emerald-700"><span>Desconto</span><span>− {brlc(r.discountCents)}</span></div>}
            <div className="flex items-end justify-between pt-1"><span className="text-xl font-extrabold">{r.paid ? 'Total pago' : 'Total a receber'}</span><span className="text-3xl font-extrabold text-primary">{brlc(r.totalCents)}</span></div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4 rounded-2xl bg-muted/60 p-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-card text-primary"><ClipboardList size={22} /></span>
            <div className="min-w-0 flex-1"><div className="text-xs text-muted-foreground">Forma de pagamento</div><div className="text-lg font-bold">{r.paid ? (r.type ? PAY_LABEL[r.type] : r.method) : 'A receber'}{r.paid && r.method && r.type && r.method !== PAY_LABEL[r.type] ? <span className="text-sm font-normal text-muted-foreground"> · {r.method}</span> : null}</div>
              <div className="text-sm text-muted-foreground">{r.paid ? `${r.mode === 'tela' ? 'Pago na tela' : 'Pagamento externo'}${r.ref ? ` · autorização ${r.ref}` : ''}${r.receivedCents != null ? ` · recebido ${brlc(r.receivedCents)}` : ''}${r.changeCents > 0 ? ` · troco ${brlc(r.changeCents)}` : ''}` : 'Pagamento pendente'}</div></div>
            {r.paid && <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-sm font-semibold text-emerald-700">Pagamento registrado</span>}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <section className="card p-5">
          <div className="mb-3 flex items-start gap-3"><Printer size={30} className="mt-1 text-primary" /><div><h2 className="text-xl font-extrabold leading-tight">Cupom enviado para impressão</h2><p className="text-sm text-muted-foreground">Os cupons vão para os setores correspondentes.</p></div></div>
          {jobs === null ? <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 size={15} className="animate-spin" /> Consultando impressões…</p>
            : bySector.size === 0 ? <p className="rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">Nenhum cupom foi enviado. Cadastre zonas e impressoras em <b>Impressão</b> no painel, ou use “Reimprimir”.</p>
            : <ul className="space-y-2.5">{[...bySector.entries()].map(([zone, j]) => (
              <li key={zone} className="flex items-center gap-3 rounded-2xl border border-border p-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-primary"><Printer size={20} /></span>
                <div className="min-w-0 flex-1"><div className="font-bold">{zone}</div><div className="truncate text-xs text-muted-foreground">{j.status === 'falhou' ? j.last_error || 'Falha ao imprimir' : j.kind === 'reimpressao' ? 'Reimpressão' : 'Cupom do pedido'}</div></div>
                <span className="text-xs text-muted-foreground">{hour(j.printed_at ?? j.created_at)}</span>
                {j.status === 'impresso' ? <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"><Check size={13} /> Impresso</span>
                  : j.status === 'falhou' ? <button className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-600" onClick={() => void retry(j.id)}><XCircle size={13} /> Falhou · tentar de novo</button>
                  : <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700"><Loader2 size={13} className="animate-spin" /> Enviando</span>}
              </li>))}</ul>}
          {msg && <p className="mt-3 text-sm text-muted-foreground" role="status">{msg}</p>}
        </section>
        <button onClick={onNew} className="flex w-full items-center gap-4 rounded-3xl bg-primary p-5 text-left text-primary-foreground shadow-ui hover:bg-primary/90"><span className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-primary"><Plus size={30} /></span><span className="flex-1"><span className="block text-2xl font-extrabold">Novo pedido</span><span className="text-primary-foreground/80">Iniciar um novo atendimento</span></span><ArrowRight size={26} /></button>
        <div className="grid gap-3 sm:grid-cols-2">
          <button className="card flex items-center gap-3 p-4 text-left hover:bg-accent/50" disabled={busy} onClick={() => void reprint()}><Printer size={26} className="text-primary" /><span><span className="block font-bold">Reimprimir cupom</span><span className="text-xs text-muted-foreground">Imprimir novamente</span></span></button>
          <button className="card flex items-center gap-3 p-4 text-left hover:bg-accent/50" onClick={onOpenOrder}><ReceiptText size={26} className="text-primary" /><span><span className="block font-bold">Ver pedido</span><span className="text-xs text-muted-foreground">Visualizar detalhes</span></span></button>
        </div>
      </div>
    </div>
  );
}
