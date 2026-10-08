import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, Tablet, Trash2 } from 'lucide-react';
import { del, get, post } from '@/lib/api';
import { Field, Modal } from '@/ui/kit';
import { ErrorBox, useAction } from '@/ui/misc';
import { useToast } from './AdminUI';

interface Totem { id: string; table_number: number; name: string; paired_at: string | null; last_seen_at: string | null; pair_expires_at: string | null }

/** Totens de mesa (liberados por loja no super admin): parear um tablet a uma mesa com código de 6 dígitos. */
export function TotemsSection() {
  const act = useAction(); const toast = useToast();
  const [data, setData] = useState<{ enabled: boolean; totems: Totem[] } | null>(null);
  const [form, setForm] = useState<{ id?: string; table: number; name: string } | null>(null);
  const [code, setCode] = useState<{ code: string; table: number; expiresAt: string } | null>(null);
  const load = useCallback(async () => setData(await get<{ enabled: boolean; totems: Totem[] }>('/v1/staff/totems')), []);
  useEffect(() => { void load(); }, [load]);
  if (!data) return null;
  const online = (t: Totem) => t.last_seen_at && Date.now() - new Date(t.last_seen_at).getTime() < 5 * 60_000;
  const gen = () => form && act.run(async () => {
    const r = await post<{ code: string; expiresAt: string }>('/v1/staff/totems', { table: form.table, name: form.name.trim(), id: form.id });
    setCode({ code: r.code, table: form.table, expiresAt: r.expiresAt }); setForm(null); await load();
  });

  return (
    <section className="card mt-5 p-4">
      <div className="mb-1 flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 font-semibold"><Tablet size={18} /> Totens de mesa</h2>
        {data.enabled && <button className="btn" onClick={() => setForm({ table: 1, name: '' })}><Plus size={16} /> Novo totem</button>}</div>
      {!data.enabled ? <p className="text-sm text-muted-foreground">O totem de mesa (tablet em que o cliente pede sozinho) não está liberado para esta loja. Fale com o suporte para ativar.</p> : (
        <>
          <p className="mb-3 text-xs text-muted-foreground">Tablet na mesa: o cliente vê o cardápio com fotos, pede (vai direto para a comanda da mesa e para a cozinha), chama o garçom e pede a conta. No tablet, abra <b>{location.origin}/totem</b> e digite o código gerado aqui.</p>
          <ErrorBox>{act.error}</ErrorBox>
          {data.totems.length === 0 ? <p className="rounded-ui-sm border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nenhum totem pareado.</p> : (
            <div className="divide-y divide-border">{data.totems.map((t) => (
              <div key={t.id} className="flex items-center gap-3 py-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-ui-sm bg-red-600 text-lg font-black text-white">{t.table_number}</div>
                <div className="min-w-0 flex-1"><div className="font-medium">Mesa {t.table_number}{t.name ? ` · ${t.name}` : ''}</div>
                  <div className="text-xs text-muted-foreground">{t.paired_at ? (online(t) ? '● online' : `visto ${t.last_seen_at ? new Date(t.last_seen_at).toLocaleString('pt-BR') : '—'}`) : 'aguardando pareamento'}</div></div>
                <button className="btn-ghost !px-2.5 text-xs" onClick={() => setForm({ id: t.id, table: t.table_number, name: t.name })}><KeyRound size={14} /> Novo código</button>
                <button className="btn-danger !px-2" aria-label="Remover totem" onClick={() => confirm(`Remover o totem da mesa ${t.table_number}? O tablet deixa de funcionar na hora.`) && act.run(async () => { await del(`/v1/staff/totems/${t.id}`); toast('Totem removido'); await load(); })}><Trash2 size={14} /></button>
              </div>))}</div>)}
        </>)}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Novo código para o totem' : 'Novo totem de mesa'}
        footer={<><button className="btn-ghost" onClick={() => setForm(null)}>Cancelar</button><button className="btn" disabled={!form || form.table < 1 || act.busy} onClick={gen}>Gerar código</button></>}>
        {form && <div className="space-y-3"><ErrorBox>{act.error}</ErrorBox>
          <Field label="Mesa"><input className="input" type="number" min={1} max={500} value={form.table} onChange={(e) => setForm({ ...form, table: Number(e.target.value) })} /></Field>
          <Field label="Apelido (opcional)"><input className="input" value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Tablet varanda" /></Field>
          {form.id && <p className="text-xs text-amber-600">O tablet atual deste totem deixa de funcionar até ser pareado com o novo código.</p>}</div>}
      </Modal>
      <Modal open={!!code} onClose={() => setCode(null)} title={`Código do totem da mesa ${code?.table ?? ''}`} footer={<button className="btn" onClick={() => setCode(null)}>Pronto</button>}>
        {code && <div className="space-y-3 text-center">
          <p className="text-sm text-muted-foreground">No tablet, abra <b>{location.origin}/totem</b> e digite:</p>
          <div className="rounded-ui bg-muted py-5 font-mono text-5xl font-black tracking-[0.3em]">{code.code}</div>
          <p className="text-xs text-muted-foreground">Vale por 15 minutos (até {new Date(code.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}) e uma única vez.</p></div>}
      </Modal>
    </section>
  );
}
