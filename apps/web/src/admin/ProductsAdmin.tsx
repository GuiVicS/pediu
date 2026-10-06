import { useMemo, useState } from 'react';
import { Copy, Pencil, Plus, Save, Search, Trash2, X } from 'lucide-react';
import type { AddonGroup, Category, Product } from '@/lib/types';
import { byOrder, useCollection } from '@/lib/data';
import { brl } from '@/lib/format';
import { Field, ImageInput, Modal, Toggle } from '@/ui/kit';
import { Empty, PageHeader, StatusBadge, useToast } from './AdminUI';

type Draft = Omit<Product, 'id'> & { id?: string };
const blank = (categoryId: string, order: number): Draft => ({
  categoryId, name: '', description: '', notes: '', price: 0, imageUrl: '', prepTime: 20, active: true, available: true, order, groupIds: [],
});

export default function ProductsAdmin() {
  const prods = useCollection<Product>('products');
  const cats = useCollection<Category>('categories');
  const groups = useCollection<AddonGroup>('groups');
  const toast = useToast();
  const [q, setQ] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [draft, setDraft] = useState<Draft | null>(null);

  const catName = (id: string) => cats.items.find((c) => c.id === id)?.name ?? '—';
  const list = useMemo(() => prods.items.filter((p) =>
    (!q || p.name.toLowerCase().includes(q.toLowerCase())) &&
    (catFilter === 'all' || p.categoryId === catFilter) &&
    (statusFilter === 'all' || (statusFilter === 'active' ? p.active : !p.active)),
  ).sort((a, b) => a.categoryId.localeCompare(b.categoryId) || byOrder(a, b)), [prods.items, q, catFilter, statusFilter]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const valid = draft && draft.name.trim() && draft.price >= 0 && draft.categoryId;

  async function save() {
    if (!draft || !valid) return;
    await prods.save({ ...draft, name: draft.name.trim() });
    toast(draft.id ? 'Produto atualizado' : 'Produto criado');
    setDraft(null);
  }

  return (
    <>
      <PageHeader title="Produtos" subtitle="Tudo que aparece no cardápio da loja" actions={
        <button className="btn" disabled={!cats.items.length} onClick={() => setDraft(blank([...cats.items].sort(byOrder)[0]?.id ?? '', prods.items.length + 1))}><Plus size={16} /> Novo produto</button>
      } />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input className="input pl-9" placeholder="Buscar por nome" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="input !w-auto" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}><option value="all">Todas as categorias</option>{[...cats.items].sort(byOrder).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select className="input !w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">Todos</option><option value="active">Ativos</option><option value="inactive">Inativos</option></select>
      </div>

      {list.length === 0 ? <Empty>Nenhum produto encontrado.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground"><tr><th className="p-3">Produto</th><th className="p-3">Categoria</th><th className="p-3">Preço</th><th className="p-3">Adicionais</th><th className="p-3">Status</th><th className="p-3 text-right">Ações</th></tr></thead>
            <tbody className="divide-y divide-border">
              {list.map((p) => (
                <tr key={p.id}>
                  <td className="p-3"><div className="flex items-center gap-3">
                    {p.imageUrl ? <img src={p.imageUrl} alt="" className="h-11 w-11 rounded-ui-sm object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /> : <div className="h-11 w-11 rounded-ui-sm bg-muted" />}
                    <div><div className="font-medium">{p.name}</div><div className="line-clamp-1 max-w-xs text-xs text-muted-foreground">{p.description}</div></div></div></td>
                  <td className="p-3">{catName(p.categoryId)}</td>
                  <td className="p-3 font-medium">{brl(p.price)}</td>
                  <td className="p-3 text-muted-foreground">{p.groupIds.length} grupo(s)</td>
                  <td className="p-3"><div className="flex flex-col gap-1"><StatusBadge on={p.active} onLabel="Visível" offLabel="Oculto" />{p.active && !p.available && <span className="badge bg-amber-100 text-amber-700">Esgotado</span>}</div></td>
                  <td className="p-3"><div className="flex justify-end gap-1.5">
                    <button className="btn-ghost !px-2" title="Editar" onClick={() => setDraft({ ...p })}><Pencil size={14} /></button>
                    <button className="btn-ghost !px-2" title="Duplicar" onClick={async () => { const { id: _id, ...rest } = p; await prods.save({ ...rest, name: `${p.name} (cópia)`, order: prods.items.length + 1 }); toast('Produto duplicado'); }}><Copy size={14} /></button>
                    <button className="btn-danger !px-2" title="Excluir" onClick={async () => { if (confirm(`Excluir "${p.name}"?`)) { await prods.remove(p.id); toast('Produto excluído'); } }}><Trash2 size={14} /></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!draft} onClose={() => setDraft(null)} wide title={draft?.id ? 'Editar produto' : 'Novo produto'}
        footer={<><button className="btn-ghost" onClick={() => setDraft(null)}><X size={14} /> Cancelar</button><button className="btn" disabled={!valid} onClick={save}><Save size={14} /> Salvar</button></>}>
        {draft && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <ImageInput label="Foto do produto" value={draft.imageUrl} onChange={(v) => set('imageUrl', v)} />
              <Field label="Ajuste da imagem" hint="“Recorte” é para fotos de fundo transparente">
                <select className="input" value={draft.imageFit ?? 'cover'} onChange={(e) => set('imageFit', e.target.value as 'cover' | 'contain')}>
                  <option value="cover">Preencher (foto)</option><option value="contain">Recorte (inteira)</option>
                </select>
              </Field>
            </div>
            <Field label="Nome"><input className="input" value={draft.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Categoria"><select className="input" value={draft.categoryId} onChange={(e) => set('categoryId', e.target.value)}>{[...cats.items].sort(byOrder).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              <Field label="Preço base (R$)"><input type="number" min={0} step="0.5" className="input" value={draft.price} onChange={(e) => set('price', Number(e.target.value))} /></Field>
              <Field label="Preparo (min)"><input type="number" min={0} className="input" value={draft.prepTime} onChange={(e) => set('prepTime', Number(e.target.value))} /></Field>
            </div>
            <Field label="Descrição (visível ao cliente)"><textarea className="input" rows={2} value={draft.description} onChange={(e) => set('description', e.target.value)} /></Field>
            <Field label="Observações internas" hint="Alérgenos, preparo especial… não aparece na loja."><input className="input" value={draft.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Grupos de adicionais</div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {[...groups.items].sort(byOrder).map((g) => (
                  <label key={g.id} className="flex items-center gap-2 rounded-ui-sm border border-border px-3 py-2 text-sm">
                    <input type="checkbox" checked={draft.groupIds.includes(g.id)} onChange={(e) => set('groupIds', e.target.checked ? [...draft.groupIds, g.id] : draft.groupIds.filter((x) => x !== g.id))} />
                    {g.name}{g.required && <span className="badge bg-accent text-accent-foreground">obrigatório</span>}
                  </label>
                ))}
                {groups.items.length === 0 && <span className="text-sm text-muted-foreground">Crie grupos em “Adicionais”.</span>}
              </div>
            </div>
            <div className="flex gap-6"><Toggle checked={draft.active} onChange={(v) => set('active', v)} label="Visível na loja" /><Toggle checked={draft.available} onChange={(v) => set('available', v)} label="Disponível (em estoque)" /></div>
          </div>
        )}
      </Modal>
    </>
  );
}
