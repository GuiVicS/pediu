import { useRef, useState } from 'react';
import { ExternalLink, ImagePlus, Loader2, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { del, get, post, put, dt } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Field, Modal, Toggle } from '@/ui/kit';
import { Badge, Empty, PageHeader, useLoad } from '@/ui/bits';
import { ErrorBox, Spinner, useAction } from '@/ui/misc';
import { useToast } from '@/ui/Toast';

interface Banner { id: string; placement: 'login' | 'dashboard'; title: string; imageUrl: string; linkUrl: string; active: boolean; sort: number; startsAt: string | null; endsAt: string | null }
interface Draft { id?: string; placement: Banner['placement']; title: string; imageUrl: string; linkUrl: string; active: boolean; sort: number; startsAt: string; endsAt: string }

const AREAS: { id: Banner['placement']; label: string; where: string; size: string; ratio: string }[] = [
  { id: 'login', label: 'Tela de login', where: 'Metade direita da tela de login do lojista (só em telas grandes).', size: '1080 × 1350 px (vertical, 4:5)', ratio: 'aspect-[4/5]' },
  { id: 'dashboard', label: 'Faixa do dashboard', where: 'Faixa fina acima do dashboard do painel do lojista.', size: '1600 × 200 px (bem larga, 8:1)', ratio: 'aspect-[8/1]' },
];
const blank = (placement: Banner['placement']): Draft => ({ placement, title: '', imageUrl: '', linkUrl: '', active: true, sort: 0, startsAt: '', endsAt: '' });
// o campo datetime-local trabalha no fuso do navegador; o servidor guarda ISO
const toLocal = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);
const fileToBase64 = (f: File) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => no(new Error('Não consegui ler o arquivo.')); r.readAsDataURL(f); });

function status(b: Banner): { label: string; cls: string } {
  const now = Date.now();
  if (!b.active) return { label: 'desligado', cls: 'bg-slate-200 text-slate-600' };
  if (b.startsAt && new Date(b.startsAt).getTime() > now) return { label: 'agendado', cls: 'bg-blue-100 text-blue-700' };
  if (b.endsAt && new Date(b.endsAt).getTime() <= now) return { label: 'encerrado', cls: 'bg-amber-100 text-amber-700' };
  return { label: 'no ar', cls: 'bg-green-100 text-green-700' };
}

/** Banners que aparecem para todos os lojistas: na tela de login e na faixa acima do dashboard. */
export function Banners() {
  const l = useLoad(() => get<{ banners: Banner[] }>('/v1/platform/banners'), []);
  const { stepUp } = useAuth(); const act = useAction(); const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  if (!l.data) return <Spinner />;
  const all = l.data.banners;
  const area = draft ? AREAS.find((a) => a.id === draft.placement)! : AREAS[0]!;
  const valid = !!draft && /^https?:\/\/\S+$/i.test(draft.imageUrl) && (draft.linkUrl === '' || /^https?:\/\/\S+$/i.test(draft.linkUrl) || /^\/\S*$/.test(draft.linkUrl)) && (!draft.startsAt || !draft.endsAt || draft.endsAt > draft.startsAt);

  const upload = async (f: File) => {
    setUploading(true);
    const r = await act.run(async () => (await post<{ url: string }>('/v1/platform/uploads', { contentType: f.type, dataBase64: await fileToBase64(f) })).url);
    setUploading(false);
    if (r) setDraft((d) => (d ? { ...d, imageUrl: r } : d));
  };
  const save = () => act.run(async () => {
    const body = { placement: draft!.placement, title: draft!.title.trim(), imageUrl: draft!.imageUrl.trim(), linkUrl: draft!.linkUrl.trim(), active: draft!.active, sort: Number(draft!.sort) || 0, startsAt: toIso(draft!.startsAt), endsAt: toIso(draft!.endsAt) };
    await stepUp(() => (draft!.id ? put(`/v1/platform/banners/${draft!.id}`, body) : post('/v1/platform/banners', body)));
    toast('Banner salvo'); setDraft(null); l.reload();
  });
  const remove = (b: Banner) => confirm(`Apagar o banner “${b.title || 'sem título'}”?`) && act.run(async () => { await stepUp(() => del(`/v1/platform/banners/${b.id}`)); toast('Banner apagado'); l.reload(); });

  return (
    <>
      <PageHeader title="Banners" subtitle="Avisos e campanhas que todos os lojistas veem: no login e acima do dashboard. Cada banner pode abrir um link." />
      <ErrorBox>{act.error ?? l.error}</ErrorBox>
      <div className="space-y-6">
        {AREAS.map((a) => {
          const list = all.filter((b) => b.placement === a.id);
          return (
            <section key={a.id} className="card p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div><h2 className="text-base font-semibold">{a.label}</h2><p className="text-xs text-muted-foreground">{a.where} Tamanho recomendado: <b>{a.size}</b>. Vários banners passam em sequência.</p></div>
                <button className="btn" onClick={() => setDraft(blank(a.id))}><Plus size={14} /> Novo banner</button>
              </div>
              {list.length === 0 ? <Empty>Nenhum banner nesta área.</Empty> : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {list.map((b) => { const s = status(b); return (
                    <div key={b.id} className="overflow-hidden rounded-ui border border-border bg-card">
                      <div className={`${a.id === 'login' ? 'aspect-[4/3]' : 'aspect-[8/1]'} w-full overflow-hidden bg-muted`}><img src={b.imageUrl} alt={b.title} className="h-full w-full object-cover" /></div>
                      <div className="space-y-1.5 p-3 text-sm">
                        <div className="flex items-center gap-2"><b className="min-w-0 flex-1 truncate">{b.title || 'Sem título'}</b><Badge cls={s.cls}>{s.label}</Badge></div>
                        <div className="truncate text-xs text-muted-foreground">{b.linkUrl ? <span className="inline-flex items-center gap-1"><ExternalLink size={11} /> {b.linkUrl}</span> : 'Sem link'}</div>
                        <div className="text-[11px] text-muted-foreground">Ordem {b.sort}{b.startsAt ? ` · de ${dt(b.startsAt)}` : ''}{b.endsAt ? ` · até ${dt(b.endsAt)}` : ''}</div>
                        <div className="flex gap-2 pt-1"><button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setDraft({ id: b.id, placement: b.placement, title: b.title, imageUrl: b.imageUrl, linkUrl: b.linkUrl, active: b.active, sort: b.sort, startsAt: toLocal(b.startsAt), endsAt: toLocal(b.endsAt) })}><Pencil size={12} /> Editar</button>
                          <button className="btn-danger !px-2.5 !py-1 text-xs" onClick={() => remove(b)}><Trash2 size={12} /> Apagar</button></div>
                      </div>
                    </div>
                  ); })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Editar banner' : 'Novo banner'} wide
        footer={<><button className="btn-ghost" onClick={() => setDraft(null)}>Cancelar</button><button className="btn" disabled={!valid || act.busy} onClick={save}>{act.busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar</button></>}>
        {draft && (
          <div className="space-y-3 text-sm">
            <ErrorBox>{act.error}</ErrorBox>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Onde aparece"><select className="input" value={draft.placement} onChange={(e) => setDraft({ ...draft, placement: e.target.value as Banner['placement'] })}>{AREAS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></Field>
              <Field label="Título (acessibilidade)" hint="Descreve a imagem para leitores de tela."><input className="input" maxLength={120} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
            </div>
            <Field label="Imagem" hint={`Recomendado ${area.size}. PNG, JPEG, WebP ou GIF até 5 MB. A imagem é cortada para preencher o espaço.`}>
              <div className="flex gap-2">
                <input className="input flex-1" placeholder="https://… (ou envie um arquivo)" value={draft.imageUrl} onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })} />
                <button className="btn-ghost whitespace-nowrap" disabled={uploading} onClick={() => file.current?.click()}>{uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />} Enviar</button>
                <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
              </div>
            </Field>
            {draft.imageUrl && <div className={`${area.ratio} ${draft.placement === 'login' ? 'max-w-[16rem]' : 'w-full'} overflow-hidden rounded-ui border border-border bg-muted`}><img src={draft.imageUrl} alt="Prévia" className="h-full w-full object-cover" /></div>}
            <Field label="Link ao clicar (opcional)" hint="Endereço completo (https://…) ou um caminho do painel, como /painel/cupons."><input className="input" placeholder="https://… ou /painel/…" value={draft.linkUrl} onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Ordem" hint="Menor aparece primeiro."><input className="input" type="number" min={0} max={9999} value={draft.sort} onChange={(e) => setDraft({ ...draft, sort: Number(e.target.value) })} /></Field>
              <Field label="Começa em (opcional)"><input className="input" type="datetime-local" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} /></Field>
              <Field label="Termina em (opcional)"><input className="input" type="datetime-local" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} /></Field>
            </div>
            <Toggle checked={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} label="Banner ligado" />
          </div>
        )}
      </Modal>
    </>
  );
}
