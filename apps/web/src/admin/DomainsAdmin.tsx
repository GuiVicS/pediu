import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Copy, Globe, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { del, get, post } from '@/lib/api';
import { Field } from '@/ui/kit';
import { ErrorBox, Spinner, useAction } from '@/ui/misc';
import { PageHeader, useToast } from './AdminUI';

interface Dom { id: string; hostname: string; kind: 'subdomain' | 'custom'; verified: boolean; verifyError: string | null; instructions: { cname: { name: string; value: string }; txt: { name: string; value: string } } | null }

export default function DomainsAdmin() {
  const [list, setList] = useState<Dom[] | null>(null);
  const [host, setHost] = useState('');
  const toast = useToast();
  const act = useAction();
  const load = useCallback(async () => setList((await get<{ domains: Dom[] }>('/v1/staff/domains')).domains), []);
  useEffect(() => { void load(); }, [load]);
  if (!list) return <Spinner />;
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast('Copiado'));

  return (
    <>
      <PageHeader title="Domínios" subtitle="O endereço da sua loja. Use o seu próprio domínio (ex.: pedidos.sualoja.com.br)" />
      <ErrorBox>{act.error}</ErrorBox>
      <div className="space-y-3">
        {list.map((d) => (
          <div key={d.id} className="card p-4 text-sm">
            <div className="flex items-center gap-2"><Globe size={16} className="text-muted-foreground" /><b className="flex-1">{d.hostname}</b>
              {d.verified ? <span className="badge bg-green-100 text-green-700"><CheckCircle2 size={11} className="mr-1" />{d.kind === 'subdomain' ? 'padrão' : 'verificado'}</span> : <span className="badge bg-amber-100 text-amber-700">aguardando DNS</span>}
              {d.kind === 'custom' && <button className="btn-danger !p-1.5" aria-label="Remover" onClick={() => confirm(`Remover ${d.hostname}?`) && act.run(async () => { await del(`/v1/staff/domains/${d.id}`); await load(); })}><Trash2 size={13} /></button>}</div>
            {d.instructions && (
              <div className="mt-3 space-y-2 rounded-ui-sm bg-muted/60 p-3 text-xs">
                <p>No painel do seu provedor de DNS, crie <b>os dois registros</b> abaixo e clique em "Verificar". A propagação pode levar de alguns minutos a algumas horas.</p>
                {([['CNAME', d.instructions.cname.name, d.instructions.cname.value], ['TXT', d.instructions.txt.name, d.instructions.txt.value]] as const).map(([t, name, value]) => (
                  <div key={t} className="grid grid-cols-[56px_1fr_auto] items-center gap-2"><b>{t}</b><div className="min-w-0"><div className="truncate">Nome: <code>{name}</code></div><div className="truncate">Valor: <code>{value}</code></div></div><button className="btn-ghost !p-1.5" aria-label="Copiar valor" onClick={() => copy(value)}><Copy size={12} /></button></div>
                ))}
                {d.verifyError && <p className="text-destructive">{d.verifyError}</p>}
                <button className="btn" disabled={act.busy} onClick={() => act.run(async () => { await post(`/v1/staff/domains/${d.id}/verify`); toast('Domínio verificado!'); await load(); })}><RefreshCw size={14} /> Verificar agora</button>
                <p className="text-muted-foreground">Depois de verificado, o certificado HTTPS é emitido automaticamente no primeiro acesso.</p>
              </div>
            )}
          </div>
        ))}
      </div>
      <section className="card mt-5 p-4">
        <h2 className="mb-2 font-semibold">Adicionar domínio próprio</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[260px] flex-1"><Field label="Domínio"><input className="input" placeholder="pedidos.sualoja.com.br" value={host} onChange={(e) => setHost(e.target.value.toLowerCase())} /></Field></div>
          <button className="btn" disabled={!host.includes('.') || act.busy} onClick={() => act.run(async () => { await post('/v1/staff/domains', { hostname: host.trim() }); setHost(''); await load(); })}><Plus size={14} /> Adicionar</button>
        </div>
      </section>
    </>
  );
}
