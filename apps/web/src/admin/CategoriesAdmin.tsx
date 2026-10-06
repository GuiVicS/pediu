import { useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Printer, Save, Trash2, X } from 'lucide-react';
import type { Category, PrintZone, Product } from '@/lib/types';
import { byOrder, moveItem, useCollection } from '@/lib/data';
import { Field, ImageInput, Modal, Toggle } from '@/ui/kit';
import { Empty, PageHeader, StatusBadge, useToast } from './AdminUI';

type Draft = Omit<Category, 'id'> & { id?: string };

export default function CategoriesAdmin() {
  const cats = useCollection<Category>('categories');
  const prods = useCollection<Product>('products');
  const zones = useCollection<PrintZone>('printZones');
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const sorted = [...cats.items].sort(byOrder);
  const zoneName = (id: string | null) => zones.items.find((z) => z.id === id)?.name;

  async function save() {
    if (!draft?.name.trim()) return;
    await cats.save({ ...draft, name: draft.name.trim() });
    toast(draft.id ? 'Categoria atualizada' : 'Categoria criada');
    setDraft(null);
  }

  return (
    <>
      <PageHeader title="Categorias" subtitle="Organize o cardápio e defina em qual zona de impressão cada categoria sai" actions={
        <button className="btn" onClick={() => setDraft({ name: '', imageUrl: '', order: sorted.length + 1, active: true, printZoneId: zones.items[0]?.id ?? null })}><Plus size={16} /> Nova categoria</button>
      } />
      {sorted.length === 0 ? <Empty>Nenhuma categoria.</Empty> : (
        <div className="space-y-2">
          {sorted.map((c, i) => (
            <div key={c.id} className="card flex items-center gap-3 p-3">
              <div className="flex flex-col"><button className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={i === 0} onClick={() => moveItem(sorted, c.id, -1, cats.save)}><ArrowUp size={14} /></button><button className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={i === sorted.length - 1} onClick={() => moveItem(sorted, c.id, 1, cats.save)}><ArrowDown size={14} /></button></div>
              {c.imageUrl ? <img src={c.imageUrl} alt="" className="h-12 w-12 rounded-ui-sm object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /> : <div className="h-12 w-12 rounded-ui-sm bg-muted" />}
              <div className="min-w-0 flex-1">
                <div className="font-medium">{c.name}</div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{prods.items.filter((p) => p.categoryId === c.id).length} produtos{zoneName(c.printZoneId) && <span className="flex items-center gap-1"><Printer size={11} />{zoneName(c.printZoneId)}</span>}</div>
              </div>
              <StatusBadge on={c.active} onLabel="Visível" offLabel="Oculta" />
              <button className="btn-ghost !px-2" onClick={() => setDraft({ ...c })}><Pencil size={14} /></button>
              <button className="btn-danger !px-2" onClick={async () => {
                const n = prods.items.filter((p) => p.categoryId === c.id).length;
                if (n > 0) return toast(`Mova ou exclua os ${n} produtos antes de excluir a categoria.`);
                if (confirm(`Excluir "${c.name}"?`)) { await cats.remove(c.id); toast('Categoria excluída'); }
              }}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Editar categoria' : 'Nova categoria'}
        footer={<><button className="btn-ghost" onClick={() => setDraft(null)}><X size={14} /> Cancelar</button><button className="btn" disabled={!draft?.name.trim()} onClick={save}><Save size={14} /> Salvar</button></>}>
        {draft && (
          <div className="space-y-4">
            <ImageInput label="Imagem" value={draft.imageUrl} onChange={(v) => setDraft({ ...draft, imageUrl: v })} />
            <Field label="Nome"><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="Zona de impressão" hint="Os itens desta categoria saem impressos nessa zona (cozinha, bar…).">
              <select className="input" value={draft.printZoneId ?? ''} onChange={(e) => setDraft({ ...draft, printZoneId: e.target.value || null })}>
                <option value="">Nenhuma</option>{zones.items.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </Field>
            <Toggle checked={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} label="Visível na loja" />
          </div>
        )}
      </Modal>
    </>
  );
}
