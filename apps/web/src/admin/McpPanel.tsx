import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Loader2, Plug, ShieldAlert, Trash2 } from 'lucide-react';
import { del, get, post } from '@/lib/api';
import { cx } from '@/ui/kit';
import { ErrorBox, useAction } from '@/ui/misc';
import { useToast } from './AdminUI';

interface Tok { id: string; name: string; scopes: string[]; created_at: string; last_used_at: string | null; revoked_at: string | null; expires_at: string | null }
interface Info { tokens: Tok[]; tools: { name: string; description: string; scope: Scope }[]; maxActive: number }
type Scope = 'orders' | 'customers' | 'payments';
const SCOPE: Record<Scope, string> = { orders: 'pedidos', customers: 'clientes', payments: 'pagamentos' };
/** Permissões opcionais: o token só ganha se o lojista marcar ao gerar. */
const EXTRA: { scope: Exclude<Scope, 'orders'>; label: string; hint: string }[] = [
  { scope: 'customers', label: 'Clientes', hint: 'listar, criar, editar e excluir contatos de clientes' },
  { scope: 'payments', label: 'Pagamentos', hint: 'gerar o Pix do pedido e o link de pagamento' },
];
const dt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const state = (t: Tok) => (t.revoked_at ? 'revogado' : t.expires_at && new Date(t.expires_at) <= new Date() ? 'vencido' : 'ativo');

/** Loja › Avançado › MCP da loja: gera o token para um assistente de IA gerenciar os PEDIDOS da loja; clientes e pagamentos só se o lojista marcar. */
export function McpPanel() {
  const toast = useToast(); const act = useAction();
  const [info, setInfo] = useState<Info | null>(null);
  const [name, setName] = useState(''); const [days, setDays] = useState<string>(''); const [extra, setExtra] = useState<Scope[]>([]);
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const load = useCallback(async () => setInfo(await get<Info>('/v1/staff/mcp')), []);
  useEffect(() => { void load(); }, [load]);
  const url = `${location.origin}/v1/store-mcp`;
  const copy = (key: string, text: string) => navigator.clipboard.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 1500); });
  const active = info?.tokens.filter((t) => state(t) === 'ativo').length ?? 0;
  const cmd = created ? `claude mcp add --transport http pedidos-da-loja ${url} --header "Authorization: Bearer ${created.token}"` : '';

  return (
    <div className="space-y-4 text-sm">
      <p>Conecte um assistente de IA (Claude, ChatGPT e outros que aceitam MCP) para <b>consultar o seu cardápio e lançar pedidos por conversa</b>: “quais pizzas vocês têm?”, “lance 2 calabresas para o João, telefone (16) 99999-0000, retirada”, “aceite o pedido 1005”, “cancele o 1007, o cliente desistiu”.</p>
      <div className="flex items-start gap-2 rounded-ui-sm bg-amber-500/10 p-3 text-amber-900 dark:text-amber-200"><ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
        <span>Quem tiver o token consegue <b>criar, avançar e cancelar pedidos</b> da sua loja. Guarde como uma senha e revogue se perder. O assistente <b>só lê o cardápio</b> (produtos e coleções); ele <b>não lê pedidos</b> e não altera cardápio, equipe nem configurações. Para criar um pedido ele precisa informar <b>nome e telefone</b> do cliente. Os pedidos ficam <b>a receber</b>. Só se você marcar ao gerar o token, ele também <b>vê e altera os contatos dos seus clientes</b> (dados pessoais: libere só para um assistente em que você confia) e <b>gera o Pix e o link de pagamento</b> dos pedidos.</span></div>

      <div><div className="mb-1 font-medium">O que o assistente pode fazer</div>
        <ul className="grid gap-1.5 sm:grid-cols-2">{info?.tools.map((t) => <li key={t.name} className="rounded-ui-xs bg-muted/50 px-2.5 py-1.5"><code className="text-xs font-semibold">{t.name}</code>{t.scope !== 'orders' && <span className="badge ml-1.5 bg-muted text-muted-foreground">{SCOPE[t.scope]}</span>}<span className="block text-xs text-muted-foreground">{t.description}</span></li>)}</ul></div>

      <div><div className="mb-1 font-medium">Endereço do MCP</div>
        <div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded-ui-xs bg-muted px-3 py-2 text-xs">{url}</code>
          <button className="btn-ghost !px-3" onClick={() => void copy('url', url)}>{copied === 'url' ? <Check size={14} /> : <Copy size={14} />} Copiar</button></div></div>

      <ErrorBox>{act.error}</ErrorBox>
      {created && (
        <div className="space-y-2 rounded-ui border-2 border-primary bg-primary/5 p-3" role="status">
          <div className="font-semibold">Token “{created.name}” criado. Copie agora: ele não aparece de novo.</div>
          <div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all rounded-ui-xs bg-card px-3 py-2 text-xs">{created.token}</code>
            <button className="btn !px-3" onClick={() => void copy('tok', created.token)}>{copied === 'tok' ? <Check size={14} /> : <Copy size={14} />} Copiar</button></div>
          <div><div className="mb-1 text-xs font-medium">No Claude Code, rode:</div>
            <div className="flex items-start gap-2"><pre className="min-w-0 flex-1 overflow-x-auto rounded-ui-xs bg-slate-900 p-2.5 text-xs text-slate-100">{cmd}</pre>
              <button className="btn-ghost !px-2.5" aria-label="Copiar comando" onClick={() => void copy('cmd', cmd)}>{copied === 'cmd' ? <Check size={14} /> : <Copy size={14} />}</button></div>
            <p className="mt-1 text-xs text-muted-foreground">Em outros aplicativos, cadastre um servidor MCP “HTTP” com o endereço acima e o cabeçalho <code>Authorization: Bearer &lt;token&gt;</code>.</p></div>
          <button className="btn-ghost !py-1.5 text-xs" onClick={() => setCreated(null)}>Já copiei, fechar</button>
        </div>)}

      <form className="flex flex-wrap items-end gap-2 border-t border-border pt-3" onSubmit={(e) => { e.preventDefault(); if (!name.trim() || act.busy) return; void act.run(async () => { const r = await post<{ token: string; name: string }>('/v1/staff/mcp/tokens', { name: name.trim(), expiresInDays: days ? Number(days) : null, scopes: extra }); setCreated({ name: r.name, token: r.token }); setName(''); setExtra([]); await load(); }); }}>
        <label className="min-w-[200px] flex-1"><span className="mb-1 block text-xs font-medium opacity-70">Nome do token</span><input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Claude da loja" /></label>
        <label><span className="mb-1 block text-xs font-medium opacity-70">Validade</span><select className="input" value={days} onChange={(e) => setDays(e.target.value)}><option value="">Sem vencimento</option><option value="30">30 dias</option><option value="90">90 dias</option><option value="365">1 ano</option></select></label>
        <fieldset className="w-full"><legend className="mb-1 text-xs font-medium opacity-70">Permissões extras (opcional)</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">{EXTRA.map((x) => <label key={x.scope} className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={extra.includes(x.scope)} onChange={(e) => setExtra(e.target.checked ? [...extra, x.scope] : extra.filter((s) => s !== x.scope))} /><span><b>{x.label}</b><span className="block text-xs text-muted-foreground">{x.hint}</span></span></label>)}</div></fieldset>
        <button className="btn" disabled={!name.trim() || act.busy || active >= (info?.maxActive ?? 5)}>{act.busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Gerar token</button>
      </form>
      {info && active >= info.maxActive && <p className="text-xs text-muted-foreground">Limite de {info.maxActive} tokens ativos. Revogue algum para criar outro.</p>}

      <div><div className="mb-1 font-medium">Tokens desta loja</div>
        {!info ? <p className="text-muted-foreground">Carregando…</p> : info.tokens.length === 0 ? <p className="text-muted-foreground">Nenhum token criado ainda.</p> : (
          <div className="divide-y divide-border rounded-ui-sm border border-border">{info.tokens.map((t) => { const st = state(t); return (
            <div key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2"><Plug size={14} className="text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1"><b>{t.name}</b><span className="block text-xs text-muted-foreground">criado {dt(t.created_at)} · {t.last_used_at ? `último uso ${dt(t.last_used_at)}` : 'nunca usado'}{t.expires_at && st === 'ativo' ? ` · vence ${dt(t.expires_at)}` : ''} · acesso: {t.scopes.map((s) => SCOPE[s as Scope] ?? s).join(', ')}</span></div>
              <span className={cx('badge', st === 'ativo' ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600')}>{st}</span>
              {st === 'ativo' && <button className="btn-danger !p-1.5" aria-label={`Revogar ${t.name}`} disabled={act.busy} onClick={() => confirm(`Revogar “${t.name}”? Quem usa esse token perde o acesso na hora.`) && void act.run(async () => { await del(`/v1/staff/mcp/tokens/${t.id}`); toast('Token revogado'); await load(); })}><Trash2 size={13} /></button>}
            </div>); })}</div>)}</div>
    </div>
  );
}
