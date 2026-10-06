import { useState } from 'react';
import { Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import type { Addon, AddonGroup, PricingMode, Product } from '@/lib/types';
import { byOrder, useCollection } from '@/lib/data';
import { brl } from '@/lib/format';
import { Field, Modal, Toggle } from '@/ui/kit';
import { Empty, PageHeader, StatusBadge, useToast } from './AdminUI';

type GDraft = Omit<AddonGroup, 'id'> & { id?: string };
const PRICING: Record<PricingMode, string> = {
  sum: 'Somar tudo que o cliente escolher', highest: 'Cobrar só o mais caro', lowest: 'Cobrar só o mais barato', average: 'Cobrar a média',
};

export default function AddonsAdmin() {
  const groups = useCollection<AddonGroup>('groups');
  const addons = useCollection<Addon>('addons');
  const prods = useCollection<Product>('products');
  const toast = useToast();
  const [draft, setDraft] = useState<GDraft | null>(null);
  const [newAddon, setNewAddon] = useState<Record<string, { name: string; price: string }>>({});
  const sorted = [...groups.items].sort(byOrder);

  async function saveGroup() {
    if (!draft?.name.trim()) return;
    const max = Math.max(1, draft.max);
    await groups.save({ ...draft, name: draft.name.trim(), max, min: Math.min(draft.min, max) });
    toast('Grupo salvo'); setDraft(null);
  }
  async function addAddon(g: AddonGroup) {
    const f = newAddon[g.id];
    if (!f?.name.trim()) return;
    const mine = addons.items.filter((a) => a.groupId === g.id);
    await addons.save({ groupId: g.id, name: f.name.trim(), price: Number(f.price.replace(',', '.')) || 0, order: mine.length + 1, active: true });
    setNewAddon((n) => ({ ...n, [g.id]: { name: '', price: '' } }));
  }

  return (
    <>
      <PageHeader title="Adicionais" subtitle="Grupos de opções que o cliente escolhe ao pedir (tamanho, bordas, molhos, acompanhamentos…)" actions={
        <button className="btn" onClick={() => setDraft({ name: '', description: '', min: 0, max: 1, required: false, pricing: 'sum', order: sorted.length + 1, active: true })}><Plus size={16} /> Novo grupo</button>
      } />
      {sorted.length === 0 ? <Empty>Nenhum grupo de adicionais.</Empty> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sorted.map((g) => {
            const list = addons.items.filter((a) => a.groupId === g.id).sort(byOrder);
            const f = newAddon[g.id] ?? { name: '', price: '' };
            return (
              <section key={g.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 font-semibold">{g.name}<StatusBadge on={g.active} /></div>
                    <div className="text-xs text-muted-foreground">{g.required ? 'Obrigatório' : 'Opcional'} · escolher {g.min === g.max ? g.max : `${g.min} a ${g.max}`} · {PRICING[g.pricing]}</div>
                    <div className="text-xs text-muted-foreground">Usado em {prods.items.filter((p) => p.groupIds.includes(g.id)).length} produto(s)</div>
                  </div>
                  <div className="flex gap-1.5">
                    <button className="btn-ghost !px-2" onClick={() => setDraft({ ...g })}><Pencil size={14} /></button>
                    <button className="btn-danger !px-2" onClick={async () => {
                      if (!confirm(`Excluir o grupo "${g.name}" e suas opções?`)) return;
                      await Promise.all(list.map((a) => addons.remove(a.id)));
                      await Promise.all(prods.items.filter((p) => p.groupIds.includes(g.id)).map((p) => prods.save({ ...p, groupIds: p.groupIds.filter((x) => x !== g.id) })));
                      await groups.remove(g.id); toast('Grupo excluído');
                    }}><Trash2 size={14} /></button>
                  </div>
                </div>
                <div className="mt-3 divide-y divide-border">
                  {list.map((a) => (
                    <div key={a.id} className="flex items-center gap-2 py-1.5 text-sm">
                      <span className={`flex-1 ${a.active ? '' : 'text-muted-foreground line-through'}`}>{a.name}</span>
                      <span className="w-20 text-right text-muted-foreground">{a.price > 0 ? `+ ${brl(a.price)}` : 'grátis'}</span>
                      <Toggle checked={a.active} onChange={(v) => addons.save({ ...a, active: v })} />
                      <button className="p-1 text-muted-foreground hover:text-destructive" onClick={() => addons.remove(a.id)}><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <input className="input" placeholder="Nova opção" value={f.name} onChange={(e) => setNewAddon((n) => ({ ...n, [g.id]: { ...f, name: e.target.value } }))} onKeyDown={(e) => e.key === 'Enter' && addAddon(g)} />
                  <input className="input !w-24" placeholder="R$ 0,00" value={f.price} onChange={(e) => setNewAddon((n) => ({ ...n, [g.id]: { ...f, price: e.target.value } }))} onKeyDown={(e) => e.key === 'Enter' && addAddon(g)} />
                  <button className="btn" onClick={() => addAddon(g)}><Plus size={16} /></button>
                </div>
              </section>
            );
          })}
        </div>
      )}
      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Editar grupo' : 'Novo grupo'}
        footer={<><button className="btn-ghost" onClick={() => setDraft(null)}><X size={14} /> Cancelar</button><button className="btn" disabled={!draft?.name.trim()} onClick={saveGroup}><Save size={14} /> Salvar</button></>}>
        {draft && (
          <div className="space-y-4">
            <Field label="Nome do grupo"><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="Texto de apoio"><input className="input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Ex.: escolha até 3" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Mínimo de escolhas"><input type="number" min={0} className="input" value={draft.min} onChange={(e) => setDraft({ ...draft, min: Number(e.target.value) })} /></Field>
              <Field label="Máximo de escolhas"><input type="number" min={1} className="input" value={draft.max} onChange={(e) => setDraft({ ...draft, max: Number(e.target.value) })} /></Field>
            </div>
            <Field label="Como cobrar"><select className="input" value={draft.pricing} onChange={(e) => setDraft({ ...draft, pricing: e.target.value as PricingMode })}>{Object.entries(PRICING).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <div className="flex gap-6"><Toggle checked={draft.required} onChange={(v) => setDraft({ ...draft, required: v, min: v ? Math.max(1, draft.min) : draft.min })} label="Obrigatório" /><Toggle checked={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} label="Ativo" /></div>
          </div>
        )}
      </Modal>
    </>
  );
}
