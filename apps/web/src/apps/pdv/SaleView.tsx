import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Bike, Loader2, Minus, Plus, Search, ShoppingBag, Store as StoreIcon, Tag, Trash2, User, UserX, UtensilsCrossed, X } from 'lucide-react';
import type { Menu } from '@/store/StoreContext';
import { ApiError, get, post } from '@/lib/api';
import { brl } from '@/lib/format';
import { brlc } from '@/lib/orders';
import { Modal, cx } from '@/ui/kit';
import { useProductPicker } from '../ProductPicker';
import { MODE_LABEL, totalsOf, type Draft, type Mode, type PdvCustomer } from './shared';

const MODES: [Mode, typeof StoreIcon][] = [['balcao', StoreIcon], ['retirada', ShoppingBag], ['delivery', Bike]];

/** Tela de venda: categorias, produtos com foto e o ticket do pedido (modo, cliente, cupom, itens e total). */
export default function SaleView({ menu, draft, setDraft, onCheckout }: { menu: Menu; draft: Draft; setDraft: (d: Draft) => void; onCheckout: () => void }) {
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const setLines = (lines: Draft['lines']) => setDraft({ ...draft, lines });
  const picker = useProductPicker(menu, draft.lines, setLines);
  const active = cat ?? menu.categories[0]?.id;
  const term = q.trim().toLowerCase();
  const products = useMemo(() => menu.products.filter((p) => (term ? p.name.toLowerCase().includes(term) || p.description.toLowerCase().includes(term) : p.categoryId === active)), [menu.products, term, active]);
  const t = totalsOf(draft, menu);
  const zone = menu.zones.find((z) => z.id === (draft.zoneId || menu.zones[0]?.id));
  const setQty = (i: number, qty: number) => setLines(qty <= 0 ? draft.lines.filter((_, k) => k !== i) : draft.lines.map((l, k) => (k === i ? { ...l, qty } : l)));
  const needsName = draft.mode !== 'balcao';
  const ready = draft.lines.length > 0 && (!needsName || !!draft.name.trim()) && (draft.mode !== 'delivery' || (!!draft.address.trim() && !!zone)) && (draft.mode !== 'retirada' || !!draft.phone.trim());
  const missing = draft.lines.length === 0 ? '' : needsName && !draft.name.trim() ? 'Informe o nome do cliente.' : draft.mode === 'retirada' && !draft.phone.trim() ? 'Informe o telefone para a retirada.' : draft.mode === 'delivery' && !draft.address.trim() ? 'Informe o endereço de entrega.' : '';

  // o desconto do cupom depende do subtotal: ao mudar os itens, confere de novo (e solta o cupom se deixar de valer)
  const lastSub = useRef(t.subtotalCents);
  const [couponMsg, setCouponMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!draft.coupon || lastSub.current === t.subtotalCents) { lastSub.current = t.subtotalCents; return; }
    lastSub.current = t.subtotalCents;
    const id = setTimeout(() => {
      post<{ code: string; description: string; discountCents: number }>('/v1/staff/coupons/check', { code: draft.coupon!.code, subtotalCents: t.subtotalCents, customerId: draft.customer?.id, phone: draft.phone })
        .then((r) => setDraft({ ...draft, coupon: { code: r.code, description: r.description, discountCents: r.discountCents } }))
        .catch((e) => { setCouponMsg(e instanceof ApiError ? `Cupom removido: ${e.message}` : 'Cupom removido.'); setDraft({ ...draft, coupon: null }); });
    }, 300);
    return () => clearTimeout(id);
  }, [t.subtotalCents]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid gap-4 lg:h-[calc(100vh-7.5rem)] lg:grid-cols-[11rem_minmax(0,1fr)_23rem] xl:grid-cols-[12rem_minmax(0,1fr)_25rem]">
      {/* categorias */}
      <nav className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-y-auto lg:pb-0" aria-label="Categorias">
        {menu.categories.map((c) => (
          <button key={c.id} onClick={() => { setCat(c.id); setQ(''); }} className={cx('flex shrink-0 items-center gap-3 rounded-2xl px-3 py-3 text-left text-[15px] font-semibold transition', active === c.id && !term ? 'bg-primary text-primary-foreground shadow-ui-sm' : 'bg-card hover:bg-accent')}>
            {c.imageUrl ? <img src={c.imageUrl} alt="" className="h-9 w-9 rounded-full object-cover" /> : <span className={cx('flex h-9 w-9 items-center justify-center rounded-full', active === c.id && !term ? 'bg-white/20' : 'bg-muted')}><UtensilsCrossed size={17} /></span>}
            <span className="truncate">{c.name}</span>
          </button>
        ))}
      </nav>

      {/* produtos */}
      <section className="flex min-h-0 flex-col">
        <label className="mb-3 flex items-center gap-2.5 rounded-full border border-border bg-card px-4 py-2.5 focus-within:border-ring">
          <Search size={18} className="text-muted-foreground" />
          <input className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" placeholder="Buscar produtos, categorias ou códigos…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar produtos" />
          {q && <button onClick={() => setQ('')} aria-label="Limpar busca"><X size={16} className="text-muted-foreground" /></button>}
        </label>
        <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-3 overflow-y-auto pr-1 sm:grid-cols-3 xl:grid-cols-4">
          {products.map((p) => {
            const n = draft.lines.filter((l) => l.productId === p.id).reduce((s, l) => s + l.qty, 0);
            return (
              <button key={p.id} disabled={!p.available} onClick={() => picker.addProduct(p)} className="card group relative flex flex-col overflow-hidden text-left transition hover:shadow-ui active:scale-[.985] disabled:opacity-50">
                <div className="aspect-[4/3] w-full overflow-hidden bg-muted">{p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.03]" /> : <div className="flex h-full items-center justify-center text-muted-foreground"><UtensilsCrossed size={30} /></div>}</div>
                {n > 0 && <span className="absolute left-2 top-2 rounded-full bg-primary px-2.5 py-0.5 text-sm font-bold text-primary-foreground shadow">{n}</span>}
                <div className="flex flex-1 flex-col gap-1 p-3">
                  <span className="text-[15px] font-bold leading-tight">{p.name}</span>
                  {p.description && <span className="line-clamp-2 text-xs text-muted-foreground">{p.description}</span>}
                  <div className="mt-auto flex items-end justify-between gap-2 pt-1.5">
                    <span className="text-lg font-extrabold">{picker.groupsOf(p).length ? <span className="mr-1 text-xs font-medium text-muted-foreground">a partir de</span> : null}{brl(p.price)}</span>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Plus size={20} /></span>
                  </div>
                  {!p.available && <span className="text-[11px] font-semibold text-destructive">Indisponível</span>}
                </div>
              </button>
            );
          })}
          {products.length === 0 && <div className="col-span-full rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Nenhum produto encontrado.</div>}
        </div>
      </section>

      {/* ticket */}
      <aside className="card flex min-h-0 flex-col overflow-hidden p-0 lg:h-full">
        <div className="grid grid-cols-3 gap-1.5 border-b border-border bg-muted/50 p-2" role="tablist" aria-label="Tipo de atendimento">
          {MODES.map(([m, Icon]) => <button key={m} role="tab" aria-selected={draft.mode === m} onClick={() => setDraft({ ...draft, mode: m })} className={cx('flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold transition', draft.mode === m ? 'bg-primary text-primary-foreground shadow-ui-sm' : 'text-foreground/70 hover:bg-card')}><Icon size={16} />{MODE_LABEL[m]}</button>)}
        </div>
        <div className="flex items-center justify-between px-4 pb-1 pt-3"><h2 className="text-xl font-extrabold">Itens do pedido</h2>
          {draft.lines.length > 0 && <button className="flex items-center gap-1.5 text-sm font-semibold text-primary" onClick={() => setDraft({ ...draft, lines: [], coupon: null })}><Trash2 size={15} /> Limpar tudo</button>}</div>

        <div className="space-y-2 px-4 pb-2">
          <button onClick={() => setCustomerOpen(true)} className="flex w-full items-center gap-2 rounded-xl border border-border px-3 py-2 text-left text-sm hover:bg-accent">
            {draft.customer ? <User size={16} className="text-primary" /> : <UserX size={16} className="text-muted-foreground" />}
            <span className="min-w-0 flex-1 truncate">{draft.customer ? <><b>{draft.customer.name || draft.customer.email}</b><span className="text-muted-foreground"> · {draft.customer.email}</span></> : <span className="text-muted-foreground">Cliente não informado</span>}</span>
            <span className="text-xs font-semibold text-primary">{draft.customer ? 'Trocar' : 'Escolher'}</span>
          </button>
          {needsName && <input className="input" placeholder="Nome do cliente" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}
          {needsName && <input className="input" inputMode="tel" placeholder={draft.mode === 'retirada' ? 'Telefone (obrigatório)' : 'Telefone'} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />}
          {draft.mode === 'delivery' && <>
            <input className="input" placeholder="Endereço de entrega" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
            <select className="input" value={zone?.id ?? ''} onChange={(e) => setDraft({ ...draft, zoneId: e.target.value })} aria-label="Região de entrega">{menu.zones.map((z) => <option key={z.id} value={z.id}>{z.name} — {brlc(Math.round(z.fee * 100))}</option>)}</select>
          </>}
          {draft.mode === 'balcao' && <input className="input" placeholder="Nome (opcional)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}
        </div>

        <div className="min-h-[7rem] flex-1 divide-y divide-border overflow-y-auto border-y border-border px-4">
          {draft.lines.length === 0 && <div className="flex h-full min-h-[7rem] items-center justify-center py-6 text-center text-sm text-muted-foreground">Toque nos produtos para adicionar ao pedido</div>}
          {draft.lines.map((l, i) => {
            const img = menu.products.find((p) => p.id === l.productId)?.imageUrl;
            return (
              <div key={l.key} className="py-3">
                <div className="flex gap-3">
                  {img ? <img src={img} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" /> : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"><UtensilsCrossed size={20} /></span>}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2"><span className="font-bold leading-tight">{l.name}</span><span className="shrink-0 font-bold">{brlc(Math.round(l.unitPrice * l.qty * 100))}</span></div>
                    {l.picks.map((p, k) => <div key={k} className="truncate text-xs text-muted-foreground">+ {p.name}</div>)}
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <button className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted hover:bg-muted/70" onClick={() => setQty(i, l.qty - 1)} aria-label={l.qty === 1 ? 'Remover item' : 'Diminuir'}>{l.qty === 1 ? <Trash2 size={14} className="text-destructive" /> : <Minus size={14} />}</button>
                      <b className="w-7 text-center">{l.qty}</b>
                      <button className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted hover:bg-muted/70" onClick={() => setQty(i, l.qty + 1)} aria-label="Aumentar"><Plus size={14} /></button>
                    </div>
                  </div>
                </div>
                <input className="mt-2 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs" placeholder="Observação (ex.: sem cebola)" value={l.note} onChange={(e) => setLines(draft.lines.map((x, k) => (k === i ? { ...x, note: e.target.value } : x)))} />
              </div>
            );
          })}
        </div>

        <div className="space-y-2 px-4 py-3 text-sm">
          <div className="flex justify-between text-muted-foreground"><span>Subtotal ({t.count} {t.count === 1 ? 'item' : 'itens'})</span><b className="text-foreground">{brlc(t.subtotalCents)}</b></div>
          {t.feeCents > 0 && <div className="flex justify-between text-muted-foreground"><span>Entrega</span><b className="text-foreground">{brlc(t.feeCents)}</b></div>}
          <CouponRow draft={draft} setDraft={setDraft} subtotalCents={t.subtotalCents} discountCents={t.discountCents} msg={couponMsg} clearMsg={() => setCouponMsg(null)} />
          <div className="flex items-end justify-between pt-1"><span className="text-xl font-extrabold">Total</span><span className="text-3xl font-extrabold">{brlc(t.totalCents)}</span></div>
          {missing && <p className="text-xs text-amber-700" role="status">{missing}</p>}
          <div className="grid grid-cols-[auto_1fr] gap-2 pt-1">
            <button className="rounded-2xl border border-destructive/40 px-4 py-3.5 text-sm font-semibold text-destructive hover:bg-destructive/5 disabled:opacity-40" disabled={draft.lines.length === 0} onClick={() => setDraft({ ...draft, lines: [], coupon: null })}>Cancelar</button>
            <button className="btn !rounded-2xl !py-3.5 text-base font-bold" disabled={!ready} onClick={onCheckout}>Continuar para pagamento <ArrowRight size={18} /></button>
          </div>
        </div>
      </aside>

      {picker.modal}
      <CustomerPicker open={customerOpen} onClose={() => setCustomerOpen(false)} current={draft.customer} onPick={(c) => { setDraft({ ...draft, customer: c, name: c && !draft.name ? c.name : draft.name }); setCustomerOpen(false); }} />
    </div>
  );
}

function CouponRow({ draft, setDraft, subtotalCents, discountCents, msg, clearMsg }: { draft: Draft; setDraft: (d: Draft) => void; subtotalCents: number; discountCents: number; msg: string | null; clearMsg: () => void }) {
  const [editing, setEditing] = useState(false); const [code, setCode] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const apply = async () => {
    setBusy(true); setErr(null);
    try { const r = await post<{ code: string; description: string; discountCents: number }>('/v1/staff/coupons/check', { code: code.trim(), subtotalCents, customerId: draft.customer?.id, phone: draft.phone }); setDraft({ ...draft, coupon: { code: r.code, description: r.description, discountCents: r.discountCents } }); setEditing(false); setCode(''); clearMsg(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível validar o cupom.'); } finally { setBusy(false); }
  };
  if (draft.coupon) return <div className="flex items-center justify-between text-emerald-700"><span className="flex items-center gap-1.5"><Tag size={15} /> Cupom <b>{draft.coupon.code}</b><button className="text-muted-foreground hover:text-destructive" onClick={() => setDraft({ ...draft, coupon: null })} aria-label="Remover cupom"><X size={14} /></button></span><b>− {brlc(discountCents)}</b></div>;
  if (editing) return (
    <div className="space-y-1.5"><div className="flex gap-2"><input autoFocus className="input uppercase" placeholder="Código do cupom" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter' && code.trim()) void apply(); }} maxLength={30} />
      <button className="btn" disabled={!code.trim() || busy || subtotalCents === 0} onClick={() => void apply()}>{busy ? <Loader2 size={14} className="animate-spin" /> : 'Aplicar'}</button><button className="btn-ghost" onClick={() => { setEditing(false); setErr(null); }} aria-label="Fechar"><X size={14} /></button></div>
      {err && <p className="text-xs text-destructive" role="alert">{err}</p>}</div>
  );
  return <div className="flex items-center justify-between text-muted-foreground"><span>Desconto</span><button className="flex items-center gap-1.5 font-semibold text-primary" onClick={() => setEditing(true)} disabled={subtotalCents === 0}><Tag size={15} /> Adicionar cupom</button>{msg && <span className="sr-only" role="status">{msg}</span>}</div>;
}

function CustomerPicker({ open, onClose, current, onPick }: { open: boolean; onClose: () => void; current: PdvCustomer | null; onPick: (c: PdvCustomer | null) => void }) {
  const [q, setQ] = useState(''); const [list, setList] = useState<PdvCustomer[] | null>(null);
  useEffect(() => {
    const term = q.trim(); if (!open || term.length < 2) { setList(null); return; }
    let alive = true; const t = setTimeout(() => { get<{ customers: PdvCustomer[] }>(`/v1/staff/search?q=${encodeURIComponent(term)}`).then((r) => alive && setList(r.customers)).catch(() => alive && setList([])); }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, open]);
  return (
    <Modal open={open} onClose={onClose} title="Cliente do pedido" footer={<button className="btn-ghost" onClick={() => onPick(null)}><UserX size={14} /> Sem cliente</button>}>
      <div className="space-y-3">
        <input autoFocus className="input" placeholder="Buscar por nome, e-mail ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
        <p className="text-xs text-muted-foreground">Mostra os clientes que criaram conta na loja. Vincular o cliente guarda o pedido no histórico dele e libera cupons exclusivos.</p>
        {current && <div className="rounded-xl bg-accent px-3 py-2 text-sm">Atual: <b>{current.name || current.email}</b></div>}
        <div className="max-h-64 divide-y divide-border overflow-y-auto">
          {list === null ? <p className="py-3 text-sm text-muted-foreground">Digite ao menos 2 letras.</p> : list.length === 0 ? <p className="py-3 text-sm text-muted-foreground">Nenhum cliente encontrado.</p> : list.map((c) => (
            <button key={c.id} className="flex w-full items-center justify-between gap-3 py-2.5 text-left text-sm hover:bg-accent" onClick={() => onPick({ id: c.id, name: c.name, email: c.email })}><b>{c.name || 'Sem nome'}</b><span className="truncate text-xs text-muted-foreground">{c.email}</span></button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
