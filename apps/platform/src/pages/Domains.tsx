import { useState } from 'react';
import { Copy, ExternalLink, Globe, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { del, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, PageHeader, useLoad } from '@/ui/bits';
import { ErrorBox, Spinner, useAction } from '@/ui/misc';
import { useToast } from '@/ui/Toast';

type Role = 'admin' | 'stores' | 'api' | 'mcp';
interface Row { id: string; role: Role; hostname: string; verified: boolean; verifyError: string | null; inUse: boolean; dns: { type: string; name: string; values: string[] } }
interface Data { domains: Row[]; server: { role: Role; hostname: string }[]; serverIps: string[]; current: string }

const ROLES: { role: Role; title: string; help: string; placeholder: string }[] = [
  { role: 'admin', title: 'Super admin', help: 'Onde você entra para administrar a plataforma (esta tela).', placeholder: 'admin.seudominio.com.br' },
  { role: 'stores', title: 'Lojas', help: 'Domínio-base das lojas: cada loja abre em nome-da-loja.dominio, com o painel do lojista junto.', placeholder: 'seudominio.delivery' },
  { role: 'api', title: 'API', help: 'Endereço que recebe os avisos do Mercado Pago, iFood e Stripe.', placeholder: 'api.seudominio.com.br' },
  { role: 'mcp', title: 'MCP', help: 'Endereço onde os assistentes de IA da plataforma se conectam.', placeholder: 'mcp.seudominio.com.br' },
];

/** Endereços da plataforma: o super admin cadastra, aponta o DNS e verifica; o certificado (cadeado) sai sozinho no primeiro acesso. */
export function PlatformDomains() {
  const { stepUp } = useAuth(); const toast = useToast(); const act = useAction();
  const l = useLoad(() => get<Data>('/v1/platform/domains'), []);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast('Copiado'));
  const P = '/v1/platform/domains';
  const add = (role: Role) => act.run(async () => { await stepUp(() => post(P, { role, hostname: draft[role] })); setDraft({ ...draft, [role]: '' }); toast('Endereço cadastrado. Agora aponte o DNS e clique em Verificar.'); await l.reload(); });
  const verify = (d: Row) => act.run(async () => { try { await post(`${P}/${d.id}/verify`); toast('DNS conferido: endereço no ar!'); } finally { await l.reload(); } });
  const remove = (d: Row) => confirm(`Remover ${d.hostname}? Quem usa este endereço deixa de conseguir abrir.`) && act.run(async () => { await stepUp(() => del(`${P}/${d.id}`)); toast('Endereço removido'); await l.reload(); });

  return (
    <>
      <PageHeader title="Domínios da plataforma" subtitle="Escolha por qual endereço abrem o super admin, as lojas, a API e o MCP. Dá para ter mais de um endereço por item: o antigo continua valendo." />
      <ErrorBox>{act.error ?? l.error}</ErrorBox>
      {!l.data ? <Spinner /> : (
        <div className="space-y-5">
          <div className="rounded-ui-sm bg-muted/60 p-3 text-sm">
            <b>Como funciona:</b> 1) cadastre o endereço aqui; 2) no provedor do domínio, crie o registro de DNS que aparece abaixo dele; 3) clique em <b>Verificar</b>. O cadeado (certificado) sai sozinho no primeiro acesso.
            {l.data.serverIps.length > 0 && <> IP deste servidor: <code>{l.data.serverIps.join(', ')}</code>.</>}
          </div>
          {ROLES.map(({ role, title, help, placeholder }) => {
            const rows = l.data!.domains.filter((d) => d.role === role); const fixed = l.data!.server.filter((s) => s.role === role);
            return (
              <section key={role} className="card p-4">
                <h2 className="font-semibold">{title}</h2><p className="mb-3 text-xs text-muted-foreground">{help}</p>
                <div className="space-y-2">
                  {fixed.map((s) => (
                    <div key={s.hostname} className="flex flex-wrap items-center gap-2 rounded-ui-sm border border-dashed border-border p-3 text-sm"><Globe size={15} className="text-muted-foreground" /><b className="flex-1 break-all">{role === 'stores' ? `nome-da-loja.${s.hostname}` : s.hostname}</b><Badge cls="bg-muted text-muted-foreground">configurado no servidor</Badge></div>))}
                  {rows.length === 0 && fixed.length === 0 && <p className="text-sm text-muted-foreground">Nenhum endereço cadastrado.</p>}
                  {rows.map((d) => (
                    <div key={d.id} className="rounded-ui-sm border border-border p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2"><Globe size={15} className="text-muted-foreground" /><b className="flex-1 break-all">{role === 'stores' ? `nome-da-loja.${d.hostname}` : d.hostname}</b>
                        {d.inUse && <Badge cls="bg-blue-100 text-blue-700">você está aqui</Badge>}
                        {d.verified ? <Badge cls="bg-green-100 text-green-700">no ar</Badge> : <Badge cls="bg-amber-100 text-amber-700">aguardando DNS</Badge>}
                        {d.verified && role !== 'stores' && role !== 'mcp' && <a className="btn-ghost !p-1.5" href={`https://${d.hostname}`} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${d.hostname}`}><ExternalLink size={13} /></a>}
                        <button className="btn-ghost !p-1.5" aria-label={`Conferir o DNS de ${d.hostname}`} title="Conferir o DNS de novo" disabled={act.busy} onClick={() => verify(d)}><RefreshCw size={13} /></button>
                        <button className="btn-danger !p-1.5" aria-label={`Remover ${d.hostname}`} disabled={act.busy || d.inUse} title={d.inUse ? 'Você está usando este endereço agora' : 'Remover'} onClick={() => remove(d)}><Trash2 size={13} /></button></div>
                      {(!d.verified || d.verifyError) && (
                        <div className="mt-2 space-y-1.5 rounded-ui-sm bg-muted/60 p-3 text-xs">
                          {!d.verified && <p>No provedor do domínio, crie este registro e clique em Verificar (a propagação pode levar de minutos a horas).</p>}
                          {!d.verified && (d.dns.values.length ? d.dns.values : ['IP do servidor']).map((ip) => (
                            <div key={ip} className="grid grid-cols-[32px_1fr_auto] items-center gap-2"><b>{d.dns.type}</b><div className="min-w-0"><div className="truncate">Nome: <code>{d.dns.name}</code></div><div className="truncate">Valor: <code>{ip}</code></div></div><button className="btn-ghost !p-1.5" aria-label="Copiar o valor" onClick={() => copy(ip)}><Copy size={12} /></button></div>))}
                          {d.verifyError && <p className="text-destructive">{d.verified ? 'Aviso (o endereço continua no ar): ' : ''}{d.verifyError}</p>}
                          {!d.verified && <button className="btn !px-3 !py-1.5 text-xs" disabled={act.busy} onClick={() => verify(d)}><RefreshCw size={13} /> Verificar agora</button>}
                        </div>)}
                    </div>))}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <input className="input min-w-[240px] flex-1" aria-label={`Novo endereço: ${title}`} placeholder={placeholder} value={draft[role] ?? ''} onChange={(e) => setDraft({ ...draft, [role]: e.target.value.toLowerCase().trim() })} />
                    <button className="btn" disabled={act.busy || !(draft[role] ?? '').includes('.')} onClick={() => add(role)}><Plus size={14} /> Adicionar</button>
                  </div>
                </div>
              </section>);
          })}
          <p className="text-xs text-muted-foreground">Adicionar e remover pedem o código do autenticador e ficam registrados na auditoria. O domínio próprio de cada loja continua em Lojas › loja › Domínios.</p>
        </div>)}
    </>
  );
}
