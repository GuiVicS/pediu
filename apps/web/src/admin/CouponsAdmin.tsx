import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Save, Trash2, Users, X } from 'lucide-react';
import { ApiError, del, get, post, put } from '@/lib/api';
import { brl } from '@/lib/format';
import { Field, Modal, Toggle } from '@/ui/kit';
import { ErrorBox, Spinner } from '@/ui/misc';
import { Empty, PageHeader, useToast } from './AdminUI';

interface Coupon { id: string; code: string; description: string; kind: 'percent' | 'fixed'; percent: number | null; amount_cents: number | null; max_discount_cents: number | null; min_order_cents: number; starts_at: string | null; ends_at: string | null; max_uses: number | null; max_uses_per_customer: number | null; audience: 'all' | 'selected'; active: boolean; used_count: number; customers: number; discount_total_cents: number }
interface Form { id?: string; code: string; description: string; kind: 'percent' | 'fixed'; percent: string; amount: string; maxDiscount: string; minOrder: string; startsAt: string; endsAt: string; maxUses: string; maxUsesPerCustomer: string; audience: 'all' | 'selected'; active: boolean }
interface Cust { id: string; name: string; email: string }

const blank = (): Form => ({ code: '', description: '', kind: 'percent', percent: '10', amount: '', maxDiscount: '', minOrder: '', startsAt: '', endsAt: '', maxUses: '', maxUsesPerCustomer: '', audience: 'all', active: true });
const toReais = (c: number | null) => (c == null ? '' : String(c / 100).replace('.', ','));
const cents = (v: string) => { const n = Number(v.replace(',', '.')); return Number.isFinite(n) && v.trim() ? Math.round(n * 100) : null; };
const intOrNull = (v: string) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; };
// <input type="datetime-local"> trabalha no horário local do navegador
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
const toIso = (v: string) => (v ? new Date(v).toISOString() : null);
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : null);

function status(c: Coupon): { label: string; cls: string } {
  const now = Date.now();
  if (!c.active) return { label: 'Desativado', cls: 'bg-muted text-muted-foreground' };
  if (c.starts_at && new Date(c.starts_at).getTime() > now) return { label: 'Agendado', cls: 'bg-amber-100 text-amber-700' };
  if (c.ends_at && new Date(c.ends_at).getTime() <= now) return { label: 'Expirado', cls: 'bg-muted text-muted-foreground' };
  if (c.max_uses && c.used_count >= c.max_uses) return { label: 'Esgotado', cls: 'bg-muted text-muted-foreground' };
  return { label: 'Ativo', cls: 'bg-green-100 text-green-700' };
}

/** Cupons da loja: código digitado no checkout, valor fixo ou porcentagem, validade, limites e cupons só para clientes escolhidos. */
export default function CouponsAdmin() {
  const toast = useToast();
  const [list, setList] = useState<Coupon[] | null>(null); const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null); const [formError, setFormError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<Coupon | null>(null);

  const load = useCallback(async () => { try { setList((await get<{ coupons: Coupon[] }>('/v1/staff/coupons')).coupons); setError(null); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => { void load(); }, [load]);

  const edit = (c: Coupon) => setForm({ id: c.id, code: c.code, description: c.description, kind: c.kind, percent: c.percent ? String(c.percent) : '', amount: toReais(c.amount_cents), maxDiscount: toReais(c.max_discount_cents), minOrder: c.min_order_cents ? toReais(c.min_order_cents) : '', startsAt: toLocal(c.starts_at), endsAt: toLocal(c.ends_at), maxUses: c.max_uses ? String(c.max_uses) : '', maxUsesPerCustomer: c.max_uses_per_customer ? String(c.max_uses_per_customer) : '', audience: c.audience, active: c.active });

  async function save() {
    if (!form) return;
    setBusy(true); setFormError(null);
    const body = { code: form.code.trim().toUpperCase(), description: form.description.trim(), kind: form.kind, percent: form.kind === 'percent' ? intOrNull(form.percent) ?? undefined : undefined, amountCents: form.kind === 'fixed' ? cents(form.amount) ?? undefined : undefined,
      maxDiscountCents: cents(form.maxDiscount), minOrderCents: cents(form.minOrder) ?? 0, startsAt: toIso(form.startsAt), endsAt: toIso(form.endsAt), maxUses: intOrNull(form.maxUses), maxUsesPerCustomer: intOrNull(form.maxUsesPerCustomer), audience: form.audience, active: form.active };
    try {
      if (form.id) await put(`/v1/staff/coupons/${form.id}`, body); else await post('/v1/staff/coupons', body);
      toast(form.id ? 'Cupom salvo' : 'Cupom criado'); setForm(null); await load();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : 'Não foi possível salvar.'); } finally { setBusy(false); }
  }
  async function remove(c: Coupon) {
    if (!confirm(`Apagar o cupom ${c.code}?`)) return;
    try { await del(`/v1/staff/coupons/${c.id}`); toast('Cupom apagado'); await load(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível apagar.'); }
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  return (
    <>
      <PageHeader title="Cupons" subtitle="Descontos que o cliente digita no checkout (ou que ficam só na conta de clientes escolhidos)" actions={<button className="btn" onClick={() => { setForm(blank()); setFormError(null); }}><Plus size={14} /> Novo cupom</button>} />
      <ErrorBox>{error}</ErrorBox>
      {!list ? <Spinner /> : list.length === 0 ? <Empty>Nenhum cupom ainda. Crie o primeiro, por exemplo BEMVINDO10 com 10% de desconto.</Empty> : (
        <div className="card divide-y divide-border overflow-hidden">
          {list.map((c) => { const st = status(c); return (
            <div key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-base font-bold">{c.code}</span><span className={`badge ${st.cls}`}>{st.label}</span>{c.audience === 'selected' && <span className="badge bg-accent text-accent-foreground">exclusivo · {c.customers} cliente(s)</span>}</div>
                <div className="mt-0.5 text-foreground">{c.kind === 'percent' ? `${c.percent}% de desconto` : `${brl((c.amount_cents ?? 0) / 100)} de desconto`}{c.max_discount_cents ? ` (até ${brl(c.max_discount_cents / 100)})` : ''}{c.min_order_cents ? ` · pedido mínimo ${brl(c.min_order_cents / 100)}` : ''}</div>
                <div className="text-xs text-muted-foreground">
                  {c.description && <>{c.description} · </>}Usos: <b>{c.used_count}</b>{c.max_uses ? ` de ${c.max_uses}` : ''} · desconto dado: <b>{brl(c.discount_total_cents / 100)}</b>
                  {c.max_uses_per_customer ? ` · ${c.max_uses_per_customer} por cliente` : ''}{c.starts_at ? ` · de ${fmt(c.starts_at)}` : ''}{c.ends_at ? ` · até ${fmt(c.ends_at)}` : ''}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                {c.audience === 'selected' && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setPick(c)}><Users size={14} /> Clientes</button>}
                <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => edit(c)}><Pencil size={14} /> Editar</button>
                <button className="btn-ghost !px-2 !py-1 text-xs" aria-label={`Apagar ${c.code}`} onClick={() => void remove(c)}><Trash2 size={14} /></button>
              </div>
            </div>); })}
        </div>)}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Editar cupom' : 'Novo cupom'}
        footer={<><button className="btn-ghost" onClick={() => setForm(null)}><X size={14} /> Cancelar</button><button className="btn" disabled={busy || !form || form.code.trim().length < 3} onClick={() => void save()}><Save size={14} /> Salvar</button></>}>
        {form && <div className="space-y-3 text-sm">
          <ErrorBox>{formError}</ErrorBox>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Código" hint="3 a 20 letras ou números. O cliente digita no checkout."><input className="input font-mono uppercase" value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="BEMVINDO10" /></Field>
            <Field label="Descrição (aparece para o cliente)"><input className="input" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="10% na primeira compra" /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Tipo"><select className="input" value={form.kind} onChange={(e) => set('kind', e.target.value as Form['kind'])}><option value="percent">Porcentagem (%)</option><option value="fixed">Valor fixo (R$)</option></select></Field>
            {form.kind === 'percent' ? <Field label="Porcentagem"><input className="input" inputMode="numeric" value={form.percent} onChange={(e) => set('percent', e.target.value)} placeholder="10" /></Field>
              : <Field label="Valor do desconto (R$)"><input className="input" inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="10,00" /></Field>}
            <Field label="Desconto máximo (R$)" hint="Opcional. Teto do desconto."><input className="input" inputMode="decimal" value={form.maxDiscount} onChange={(e) => set('maxDiscount', e.target.value)} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Pedido mínimo (R$)" hint="Sobre os itens, sem a entrega."><input className="input" inputMode="decimal" value={form.minOrder} onChange={(e) => set('minOrder', e.target.value)} /></Field>
            <Field label="Máximo de usos no total"><input className="input" inputMode="numeric" value={form.maxUses} onChange={(e) => set('maxUses', e.target.value)} placeholder="sem limite" /></Field>
            <Field label="Máximo de usos por cliente"><input className="input" inputMode="numeric" value={form.maxUsesPerCustomer} onChange={(e) => set('maxUsesPerCustomer', e.target.value)} placeholder="sem limite" /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Começa em" hint="Opcional."><input className="input" type="datetime-local" value={form.startsAt} onChange={(e) => set('startsAt', e.target.value)} /></Field>
            <Field label="Termina em" hint="Opcional."><input className="input" type="datetime-local" value={form.endsAt} onChange={(e) => set('endsAt', e.target.value)} /></Field>
          </div>
          <Field label="Quem pode usar"><select className="input" value={form.audience} onChange={(e) => set('audience', e.target.value as Form['audience'])}><option value="all">Qualquer cliente que souber o código</option><option value="selected">Só clientes escolhidos (aparece na conta deles)</option></select></Field>
          {form.audience === 'selected' && <p className="text-xs text-muted-foreground">Depois de salvar, use o botão <b>Clientes</b> do cupom para escolher quem recebe. O cliente precisa estar logado na conta para usar.</p>}
          <Toggle checked={form.active} onChange={(v) => set('active', v)} label="Cupom ativo" />
          <p className="text-xs text-muted-foreground">O desconto vale só sobre os itens (não sobre a taxa de entrega). Pedido cancelado devolve o uso do cupom.</p>
        </div>}
      </Modal>

      {pick && <CustomerPicker coupon={pick} onClose={() => { setPick(null); void load(); }} />}
    </>
  );
}

/** Escolhe os clientes de um cupom exclusivo (busca pelos clientes com conta na loja). */
function CustomerPicker({ coupon, onClose }: { coupon: Coupon; onClose: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState(''); const [found, setFound] = useState<Cust[]>([]); const [chosen, setChosen] = useState<Record<string, Cust>>({});
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { get<{ customers: Cust[] }>(`/v1/staff/coupons/${coupon.id}/customers`).then((r) => setChosen(Object.fromEntries(r.customers.map((c) => [c.id, c])))).catch((e) => setError((e as Error).message)); }, [coupon.id]);
  useEffect(() => { const t = setTimeout(() => { get<{ customers: Cust[] }>(`/v1/staff/customers?limit=20&q=${encodeURIComponent(q.trim())}`).then((r) => setFound(r.customers)).catch(() => setFound([])); }, 250); return () => clearTimeout(t); }, [q]);
  const toggle = (c: Cust) => setChosen((m) => { const n = { ...m }; if (n[c.id]) delete n[c.id]; else n[c.id] = c; return n; });
  async function save() {
    setBusy(true); setError(null);
    try { await put(`/v1/staff/coupons/${coupon.id}/customers`, { customerIds: Object.keys(chosen) }); toast('Clientes do cupom salvos'); onClose(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível salvar.'); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={`Clientes do cupom ${coupon.code}`} footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn" disabled={busy} onClick={() => void save()}><Save size={14} /> Salvar ({Object.keys(chosen).length})</button></>}>
      <div className="space-y-3 text-sm">
        <ErrorBox>{error}</ErrorBox>
        <input className="input" placeholder="Buscar cliente por nome, e-mail ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-64 divide-y divide-border overflow-y-auto rounded-ui-sm border border-border">
          {found.length === 0 ? <p className="p-3 text-muted-foreground">Nenhum cliente encontrado.</p> : found.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted"><input type="checkbox" checked={!!chosen[c.id]} onChange={() => toggle(c)} /><span className="min-w-0"><b>{c.name || 'Sem nome'}</b><span className="block truncate text-xs text-muted-foreground">{c.email}</span></span></label>))}
        </div>
        {Object.keys(chosen).length > 0 && <div className="flex flex-wrap gap-1.5">{Object.values(chosen).map((c) => <button key={c.id} type="button" className="badge bg-accent text-accent-foreground" onClick={() => toggle(c)}>{c.name || c.email} ✕</button>)}</div>}
      </div>
    </Modal>
  );
}
