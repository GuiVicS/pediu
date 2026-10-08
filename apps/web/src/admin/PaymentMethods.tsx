import { useCallback, useEffect, useState } from 'react';
import { Blocks, Pencil, Plus, QrCode, Save, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { PaymentMethod } from '@/lib/types';
import { get } from '@/lib/api';
import { byOrder, useCollection } from '@/lib/data';
import { Field, Modal, Toggle } from '@/ui/kit';
import { ErrorBox, useAction } from '@/ui/misc';
import { useToast } from './AdminUI';

type Draft = Omit<PaymentMethod, 'id'> & { id?: string };
interface AppState { id: string; installed: boolean; cardReady?: boolean }
const TYPES: Record<PaymentMethod['type'], string> = { pix: 'Pix', cash: 'Dinheiro', credit: 'Crédito', debit: 'Débito', voucher: 'Vale-refeição' };
const GW: Record<string, string> = { mercadopago: 'Mercado Pago', sicoob: 'Sicoob' };

/** Formas de pagamento do checkout (dinheiro, maquininha, vale, Pix e cartão). A conexão com Mercado Pago/Sicoob fica no hub de Integrações. */
export function PaymentMethodsSection() {
  const pays = useCollection<PaymentMethod>('payments');
  const toast = useToast();
  const act = useAction();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [apps, setApps] = useState<AppState[]>([]);
  const loadApps = useCallback(async () => setApps((await get<{ apps: AppState[] }>('/v1/staff/apps')).apps), []);
  useEffect(() => { void loadApps(); }, [loadApps]);
  const sorted = [...pays.items].sort(byOrder);
  const has = (p: string) => apps.some((a) => a.id === p && a.installed);

  return (
    <section className="card mt-5 p-4">
      <div className="mb-1 flex items-center justify-between gap-2"><h2 className="font-semibold">Formas de pagamento</h2>
        <button className="btn" onClick={() => setDraft({ name: '', type: 'pix', note: '', order: sorted.length + 1, active: true, online: false, gateway: null })}><Plus size={16} /> Nova forma</button></div>
      <p className="mb-3 text-xs text-muted-foreground">O que aparece no checkout. Para cobrar online (Pix e cartão sem sair da loja), instale o Mercado Pago ou o Sicoob em <Link to="/painel/integracoes" className="font-medium text-primary"><Blocks size={12} className="inline" /> Integrações</Link>.</p>
      <ErrorBox>{act.error ?? pays.error}</ErrorBox>

      <div className="space-y-2">
        {sorted.map((p) => (
          <div key={p.id} className="card flex items-center gap-3 p-3">
            <div className="flex-1"><div className="font-medium">{p.name} <span className="badge bg-muted text-muted-foreground">{TYPES[p.type]}</span>{p.online && <span className="ml-1 badge bg-blue-100 text-blue-700"><QrCode size={10} className="mr-1" />online · {GW[p.gateway ?? '']}{p.gateway && !has(p.gateway) ? ' (gateway desconectado)' : ''}</span>}</div><div className="text-xs text-muted-foreground">{p.note}</div></div>
            <Toggle checked={p.active} onChange={(v) => act.run(() => pays.save({ ...p, active: v }))} />
            <button className="btn-ghost !px-2" onClick={() => setDraft({ ...p })}><Pencil size={14} /></button>
            <button className="btn-danger !px-2" onClick={async () => { if (confirm(`Excluir "${p.name}"?`)) { await pays.remove(p.id); toast('Forma excluída'); } }}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Editar forma de pagamento' : 'Nova forma de pagamento'}
        footer={<><button className="btn-ghost" onClick={() => setDraft(null)}><X size={14} /> Cancelar</button><button className="btn" disabled={!draft?.name.trim() || act.busy} onClick={() => act.run(async () => { await pays.save(draft!); toast('Forma salva'); setDraft(null); })}><Save size={14} /> Salvar</button></>}>
        {draft && (
          <div className="space-y-4">
            <ErrorBox>{act.error}</ErrorBox>
            <Field label="Nome"><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="Tipo"><select className="input" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as PaymentMethod['type'], online: false, gateway: null })}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            {(draft.type === 'pix' || draft.type === 'credit') && (
              <div className="rounded-ui-sm border border-border p-3">
                <Toggle checked={draft.online} onChange={(v) => setDraft({ ...draft, online: v, gateway: v ? (draft.type === 'credit' ? 'mercadopago' : has('mercadopago') ? 'mercadopago' : 'sicoob') : null })} label="Cobrar online (o pedido só vai para a cozinha depois de pago)" />
                {draft.online && (
                  <div className="mt-3"><Field label="Gateway">
                    <select className="input" value={draft.gateway ?? ''} onChange={(e) => setDraft({ ...draft, gateway: e.target.value as 'mercadopago' | 'sicoob' })}>
                      <option value="mercadopago">Mercado Pago{has('mercadopago') ? '' : ' (não conectado)'}</option>{draft.type === 'pix' && <option value="sicoob">Sicoob{has('sicoob') ? '' : ' (não conectado)'}</option>}
                    </select></Field>
                    {draft.gateway && !has(draft.gateway) && <p className="mt-2 text-xs text-amber-600">Instale o {GW[draft.gateway]} em Integrações, senão o checkout mostrará "pagamento online indisponível".</p>}
                    {draft.gateway === 'mercadopago' && draft.type === 'credit' && has('mercadopago') && !apps.find((a) => a.id === 'mercadopago')?.cardReady && <p className="mt-2 text-xs text-amber-600">Falta a Public Key do Mercado Pago (Integrações → Mercado Pago) para o cartão aparecer no checkout.</p>}</div>
                )}
              </div>
            )}
            <Field label="Observação para o cliente"><input className="input" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></Field>
            <Toggle checked={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} label="Ativa" />
          </div>
        )}
      </Modal>

    </section>
  );
}
