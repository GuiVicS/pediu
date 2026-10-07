import { useCallback, useEffect, useState } from 'react';
import { Link2, Trash2 } from 'lucide-react';
import { del, get, post } from '@/lib/api';
import { ErrorBox, Spinner } from '@/ui/misc';
import { Empty, PageHeader } from './AdminUI';

interface Device { id: string; name: string; created_at: string; last_seen_at: string; staff_name: string }
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR');

/** Conecta a extensão do Chrome (WhatsApp Web) a esta loja por um código de uso único e lista os dispositivos conectados. */
export default function WhatsappAdmin() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const f = await get<{ enabled: string[] }>('/v1/staff/features');
      const on = f.enabled.includes('whatsapp_support');
      setEnabled(on);
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
        </div>)}
    </>
  );
}
