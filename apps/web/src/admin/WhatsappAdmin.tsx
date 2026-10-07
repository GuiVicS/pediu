import { useCallback, useEffect, useState } from 'react';
import { Link2, Trash2 } from 'lucide-react';
import { del, get, post, put } from '@/lib/api';
import { ErrorBox, Spinner } from '@/ui/misc';
import { Empty, PageHeader } from './AdminUI';

interface Device { id: string; name: string; created_at: string; last_seen_at: string; staff_name: string }
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR');

/** Conecta a extensão do Chrome (WhatsApp Web) a esta loja por um código de uso único e lista os dispositivos conectados. */
export default function WhatsappAdmin() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [features, setFeatures] = useState<string[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const f = await get<{ enabled: string[] }>('/v1/staff/features');
      const on = f.enabled.includes('whatsapp_support');
      setEnabled(on); setFeatures(f.enabled);
      if (on) setDevices((await get<{ devices: Device[] }>('/v1/staff/extension/devices')).devices);
      setError(null);
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); setError(null); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };

  if (enabled === null) return error ? <ErrorBox>{error}</ErrorBox> : <Spinner />;
  return (
    <>
      <PageHeader title="Atendimento WhatsApp" subtitle="Conecte a extensão do Chrome ao WhatsApp Web desta loja" />
      <ErrorBox>{error}</ErrorBox>
      {!enabled ? <Empty>Este recurso ainda não foi liberado para a sua loja. Fale com o suporte da plataforma.</Empty> : (
        <div className="space-y-5">
          <section className="card p-4">
            <h2 className="mb-1 font-semibold">Conectar a extensão</h2>
            <p className="mb-3 text-sm text-muted-foreground">Instale a extensão, abra o WhatsApp Web no Chrome e informe o código abaixo na extensão. O código vale por 5 minutos e só pode ser usado uma vez.</p>
            <button className="btn" disabled={busy} onClick={() => run(async () => { setPairing(await post('/v1/staff/extension/pairing')); })}><Link2 size={14} /> Gerar código</button>
            {pairing && <div className="mt-3 rounded-ui border border-border p-3"><div className="text-xs text-muted-foreground">Código (vale até {new Date(pairing.expiresAt).toLocaleTimeString('pt-BR')})</div><div className="select-all font-mono text-2xl font-bold tracking-widest">{pairing.code}</div></div>}
          </section>
          <section className="card p-4">
            <h2 className="mb-2 font-semibold">Dispositivos conectados</h2>
            {devices.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum dispositivo conectado.</p> : (
              <div className="divide-y divide-border">{devices.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div><b>{d.name || 'Chrome'}</b> <span className="text-muted-foreground">· conectado por {d.staff_name}</span><div className="text-xs text-muted-foreground">Conectado em {when(d.created_at)} · último uso {when(d.last_seen_at)}</div></div>
                  <button className="btn-ghost !px-2.5 !py-1 text-xs" disabled={busy} onClick={() => run(async () => { await del(`/v1/staff/extension/devices/${d.id}`); await load(); })}><Trash2 size={14} /> Desconectar</button>
                </div>))}</div>)}
            <p className="mt-3 text-xs text-muted-foreground">A conexão também é encerrada ao sair do painel, se a sessão expirar ou se o recurso for desativado pela plataforma.</p>
          </section>
        {features.includes('quick_replies') && <QuickReplies />}
        {features.includes('broadcasts') && <Broadcasts />}
        </div>)}
    </>
  );
}

interface Reply { id: string; title: string; body: string; sort: number; active: boolean }
const VARS = '{{cliente}} {{loja}} {{horario}} {{status}} {{pedido_minimo}} {{taxas_entrega}} {{pagamentos}} {{link_loja}}';

function QuickReplies() {
  const [list, setList] = useState<Reply[]>([]);
  const [form, setForm] = useState<{ id?: string; title: string; body: string }>({ title: '', body: '' });
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { setList((await get<{ replies: Reply[] }>('/v1/staff/quick-replies')).replies); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => { void load(); }, [load]);
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); setError(null); await load(); } catch (e) { setError((e as Error).message); } };
  return (
    <section className="card p-4">
      <h2 className="mb-1 font-semibold">Respostas rápidas</h2>
      <p className="mb-3 text-xs text-muted-foreground">Variáveis disponíveis: <code>{VARS}</code></p>
      <ErrorBox>{error}</ErrorBox>
      <div className="divide-y divide-border">{list.map((r) => (
        <div key={r.id} className="flex items-start justify-between gap-3 py-2 text-sm">
          <div><b>{r.title}</b>{!r.active && <span className="badge ml-2 bg-muted text-muted-foreground">inativa</span>}<div className="whitespace-pre-wrap text-xs text-muted-foreground">{r.body}</div></div>
          <div className="flex shrink-0 gap-1">
            <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setForm({ id: r.id, title: r.title, body: r.body })}>Editar</button>
            <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => run(() => put(`/v1/staff/quick-replies/${r.id}`, { title: r.title, body: r.body, sort: r.sort, active: !r.active }))}>{r.active ? 'Desativar' : 'Ativar'}</button>
            <button className="btn-ghost !px-2 !py-1 text-xs" aria-label="Excluir" onClick={() => run(() => del(`/v1/staff/quick-replies/${r.id}`))}><Trash2 size={14} /></button>
          </div>
        </div>))}</div>
      <div className="mt-3 space-y-2">
        <input className="input" placeholder="Título (ex.: Horário de funcionamento)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <textarea className="input min-h-24" placeholder="Texto da resposta" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        <button className="btn" disabled={!form.title.trim() || !form.body.trim()} onClick={() => run(async () => { if (form.id) await put(`/v1/staff/quick-replies/${form.id}`, { title: form.title, body: form.body, sort: 0, active: true }); else await post('/v1/staff/quick-replies', { title: form.title, body: form.body }); setForm({ title: '', body: '' }); })}>{form.id ? 'Salvar alterações' : 'Adicionar resposta'}</button>
      </div>
    </section>
  );
}

interface Campaign { id: string; name: string; body: string; status: string; total: number; sent: number; failed: number; uncertain: number; pending: number }

function Broadcasts() {
  const [list, setList] = useState<Campaign[]>([]);
  const [form, setForm] = useState({ name: '', body: '' });
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { setList((await get<{ campaigns: Campaign[] }>('/v1/staff/broadcasts')).campaigns); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => { void load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, [load]);
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); setError(null); await load(); } catch (e) { setError((e as Error).message); } };
  const act = (id: string, action: 'start' | 'pause' | 'cancel') => run(() => post(`/v1/staff/broadcasts/${id}/status`, { action }));
  return (
    <section className="card p-4">
      <h2 className="mb-1 font-semibold">Disparos</h2>
      <p className="mb-3 text-xs text-muted-foreground">Vão só para clientes marcados como “aceitou receber mensagens” em Clientes. O envio sai pelo seu WhatsApp Web, em ritmo lento, e exige a extensão aberta. Use <code>{'{{cliente}}'}</code> para o primeiro nome.</p>
      <ErrorBox>{error}</ErrorBox>
      <div className="divide-y divide-border">{list.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
          <div><b>{c.name}</b> <span className="badge bg-muted text-muted-foreground">{c.status}</span>
            <div className="text-xs text-muted-foreground">{c.sent} enviadas · {c.pending} na fila · {c.failed} falharam · {c.uncertain} incertas (confira no WhatsApp; não são reenviadas) · {c.total} no total</div></div>
          <div className="flex gap-1">
            {c.status === 'pausada' && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => act(c.id, 'start')}>Iniciar</button>}
            {c.status === 'rodando' && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => act(c.id, 'pause')}>Pausar</button>}
            {(c.status === 'pausada' || c.status === 'rodando') && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => act(c.id, 'cancel')}>Cancelar</button>}
          </div>
        </div>))}</div>
      <div className="mt-3 space-y-2">
        <input className="input" placeholder="Nome da campanha" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <textarea className="input min-h-24" placeholder="Mensagem" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        <button className="btn" disabled={!form.name.trim() || !form.body.trim()} onClick={() => run(async () => { await post('/v1/staff/broadcasts', form); setForm({ name: '', body: '' }); })}>Criar campanha (começa pausada)</button>
      </div>
    </section>
  );
}
