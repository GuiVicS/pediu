import { useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import type { Banner } from '@/lib/types';
import { byOrder, moveItem, useCollection } from '@/lib/data';
import { Field, ImageInput, Modal, Toggle } from '@/ui/kit';
import { Empty, PageHeader, StatusBadge, useToast } from './AdminUI';

type Draft = Omit<Banner, 'id'> & { id?: string };

export default function BannersAdmin() {
  const banners = useCollection<Banner>('banners');
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const sorted = [...banners.items].sort(byOrder);

  return (
    <>
      <PageHeader title="Banners" subtitle="Carrossel no topo da loja. Use imagens largas (proporção 5:2)." actions={
        <button className="btn" onClick={() => setDraft({ title: '', description: '', imageUrl: '', order: sorted.length + 1, active: true })}><Plus size={16} /> Novo banner</button>
      } />
      {sorted.length === 0 ? <Empty>Nenhum banner.</Empty> : (
        <div className="space-y-3">
          {sorted.map((b, i) => (
            <div key={b.id} className="card flex items-center gap-3 p-3">
              <div className="flex flex-col"><button className="p-0.5 text-muted-foreground disabled:opacity-30" disabled={i === 0} onClick={() => moveItem(sorted, b.id, -1, banners.save)}><ArrowUp size={14} /></button><button className="p-0.5 text-muted-foreground disabled:opacity-30" disabled={i === sorted.length - 1} onClick={() => moveItem(sorted, b.id, 1, banners.save)}><ArrowDown size={14} /></button></div>
              {b.imageUrl ? <img src={b.imageUrl} alt="" className="h-16 w-40 rounded-ui-sm object-cover" /> : <div className="h-16 w-40 rounded-ui-sm bg-muted" />}
              <div className="min-w-0 flex-1"><div className="font-medium">{b.title || '(sem título)'}</div><div className="truncate text-xs text-muted-foreground">{b.description}</div></div>
              <StatusBadge on={b.active} />
              <button className="btn-ghost !px-2" onClick={() => setDraft({ ...b })}><Pencil size={14} /></button>
              <button className="btn-danger !px-2" onClick={async () => { if (confirm('Excluir este banner?')) { await banners.remove(b.id); toast('Banner excluído'); } }}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Editar banner' : 'Novo banner'}
        footer={<><button className="btn-ghost" onClick={() => setDraft(null)}><X size={14} /> Cancelar</button><button className="btn" disabled={!draft?.imageUrl} onClick={async () => { if (draft) { await banners.save(draft); toast('Banner salvo'); setDraft(null); } }}><Save size={14} /> Salvar</button></>}>
        {draft && (
          <div className="space-y-4">
            <ImageInput wide label="Imagem do banner" value={draft.imageUrl} onChange={(v) => setDraft({ ...draft, imageUrl: v })} />
            <Field label="Título"><input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
            <Field label="Descrição"><input className="input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
            <Toggle checked={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} label="Ativo" />
          </div>
        )}
      </Modal>
    </>
  );
}
