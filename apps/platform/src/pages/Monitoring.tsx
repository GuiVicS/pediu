import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, CheckCheck, Play, RefreshCw, Save } from 'lucide-react';
import { del, get, post, put, qs, brl, dt, ago } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Field, Modal, Toggle } from '@/ui/kit';
import { Badge, Delta, Empty, PageHeader, SEVERITY, Stat, STORE_STATUS, STORE_STATUS_LABEL, Table, useLoad } from '@/ui/bits';
import { ErrorBox, Spinner, useAction } from '@/ui/misc';
import { useToast } from '@/ui/Toast';

// ---------------- publicações ----------------
export function Publications() {
  const l = useLoad(() => get('/v1/platform/publication-requests'), [], 30_000);
  const { stepUp } = useAuth(); const act = useAction(); const toast = useToast();
  const [waiver, setWaiver] = useState<Record<string, string>>({});
  if (!l.data) return <Spinner />;
  const decide = (id: string, approve: boolean) => act.run(async () => { await stepUp(() => post(`/v1/platform/publication-requests/${id}/decide`, { approve, waiverReason: waiver[id] || undefined })); toast(approve ? 'Loja publicada' : 'Pedido recusado'); await l.reload(); });
  return (
    <>
      <PageHeader title="Publicações" subtitle="Pedidos de publicação feitos pelo MCP. Só você aprova, com o autenticador." />
      <ErrorBox>{act.error ?? l.error}</ErrorBox>
      {l.data.requests.length === 0 ? <Empty>Nenhum pedido.</Empty> : <div className="space-y-3">{l.data.requests.map((r: any) => (
        <div key={r.id} className="card space-y-2 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2"><Link to={`/lojas/${r.store_id}`} className="font-semibold text-primary">{r.name}</Link><span className="text-xs text-muted-foreground">{r.slug}</span><Badge cls={r.status === 'pendente' ? 'bg-amber-100 text-amber-700' : r.status === 'aprovada' ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}>{r.status}</Badge><span className="ml-auto text-xs text-muted-foreground">{r.requested_by} · {dt(r.created_at)}</span></div>
          {r.note && <div className="italic text-muted-foreground">“{r.note}”</div>}
          {r.checklist?.issues?.length > 0 && <ul className="list-inside list-disc text-xs text-muted-foreground">{r.checklist.issues.map((i: any, k: number) => <li key={k}>{i.nivel === 'erro' ? '⛔' : '⚠️'} {i.mensagem}</li>)}</ul>}
          {r.status === 'pendente' && <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3"><div className="min-w-[240px] flex-1"><Field label="Cortesia (só se a conta não tem assinatura)"><input className="input" value={waiver[r.id] ?? ''} onChange={(e) => setWaiver({ ...waiver, [r.id]: e.target.value })} placeholder="motivo" /></Field></div>
            <button className="btn" disabled={act.busy} onClick={() => decide(r.id, true)}><Check size={14} /> Aprovar e publicar</button><button className="btn-danger" disabled={act.busy} onClick={() => decide(r.id, false)}>Recusar</button></div>}
        </div>))}</div>}
    </>
  );
}

// ---------------- desempenho (ranking) ----------------
export function Performance() {
  const [days, setDays] = useState(7); const nav = useNavigate();
  const l = useLoad(() => get(`/v1/platform/analytics/stores${qs({ days })}`), [days], 60_000);
  if (!l.data) return <Spinner />;
  return (
    <>
      <PageHeader title="Desempenho das lojas" subtitle="Ranking por faturamento, comparado com o período anterior" actions={<select className="input !w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[1, 7, 14, 30, 90].map((n) => <option key={n} value={n}>{n} dia(s)</option>)}</select>} />
      <Table head={['Loja', 'Status', 'Pedidos', 'Faturamento', 'Ticket', 'Cancel.', 'Preparo', 'Entrega', 'Alertas']}>
        {l.data.stores.map((s: any) => (
          <tr key={s.id} className="cursor-pointer hover:bg-muted/50" onClick={() => nav(`/lojas/${s.id}`)}>
            <td className="p-3 font-medium">{s.name}<div className="text-xs text-muted-foreground">{s.tenant}</div></td><td className="p-3"><Badge cls={STORE_STATUS[s.status]}>{STORE_STATUS_LABEL[s.status]}</Badge></td>
            <td className="p-3">{s.orders} <Delta v={s.change.orders} /></td><td className="p-3 font-semibold">{brl(s.revenueCents)} <Delta v={s.change.revenue} /></td><td className="p-3">{brl(s.avgTicketCents)}</td>
            <td className={`p-3 ${s.cancelRate > 0.2 ? 'font-bold text-destructive' : ''}`}>{Math.round(s.cancelRate * 100)}%</td><td className="p-3">{s.avgPrepMin ?? '—'}{s.avgPrepMin != null && ' min'}</td><td className="p-3">{s.avgDeliveryMin ?? '—'}{s.avgDeliveryMin != null && ' min'}</td>
            <td className="p-3">{s.openAlerts > 0 ? <Badge cls={SEVERITY.warn}>{s.openAlerts}</Badge> : <span className="text-muted-foreground">—</span>}</td>
          </tr>))}
      </Table>
    </>
  );
}

// ---------------- alertas ----------------
export function Alerts() {
  const [tab, setTab] = useState<'active' | 'resolved' | 'rules'>('active');
  const l = useLoad(() => (tab === 'rules' ? get('/v1/platform/alert-rules') : get(`/v1/platform/alerts${qs({ status: tab, limit: 100 })}`)), [tab], 20_000);
  const act = useAction(); const toast = useToast();
  const [edit, setEdit] = useState<any | null>(null);
  const run = (fn: () => Promise<unknown>, msg: string) => act.run(async () => { await fn(); toast(msg); await l.reload(); });
  return (
    <>
      <PageHeader title="Alertas" subtitle="Avaliados a cada minuto; resolvem sozinhos quando o problema passa" actions={<button className="btn-ghost" disabled={act.busy} onClick={() => run(async () => { const r = await post('/v1/platform/alerts/evaluate'); toast(`${r.opened} novo(s), ${r.resolved} resolvido(s)`); }, 'Avaliação executada')}><Play size={14} /> Avaliar agora</button>} />
      <div className="mb-4 flex gap-1.5">{([['active', 'Abertos'], ['resolved', 'Resolvidos'], ['rules', 'Regras']] as const).map(([k, v]) => <button key={k} onClick={() => setTab(k)} className={`rounded-full px-4 py-1.5 text-sm font-medium ${tab === k ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'}`}>{v}</button>)}</div>
      <ErrorBox>{act.error ?? l.error}</ErrorBox>
      {!l.data ? <Spinner /> : tab === 'rules' ? (
        <div className="space-y-2">{l.data.rules.map((r: any) => (
          <div key={r.key} className="card flex flex-wrap items-center gap-3 p-3 text-sm"><Badge cls={SEVERITY[r.severity]}>{r.severity}</Badge><div className="min-w-0 flex-1"><div className="font-medium">{r.title} <code className="text-xs text-muted-foreground">{r.key}</code></div><div className="text-xs text-muted-foreground">{r.description}</div><div className="text-xs text-muted-foreground">{Object.entries(r.params).map(([k, v]) => `${k}=${v}`).join(' · ')} · reavisa a cada {r.cooldown_min} min</div></div>
            <Toggle checked={r.enabled} onChange={(v) => run(() => put(`/v1/platform/alert-rules/${r.key}`, { enabled: v }), v ? 'Regra ativada' : 'Regra desativada')} /><button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setEdit({ ...r, paramsText: JSON.stringify(r.params) })}>Editar</button></div>))}</div>
      ) : l.data.alerts.length === 0 ? <Empty>{tab === 'active' ? 'Nenhum alerta aberto 🎉' : 'Nada resolvido ainda.'}</Empty> : (
        <div className="space-y-2">{l.data.alerts.map((a: any) => (
          <div key={a.id} className="card flex flex-wrap items-center gap-3 p-3 text-sm"><Badge cls={SEVERITY[a.severity]}>{a.severity}</Badge><div className="min-w-0 flex-1"><div className="font-medium">{a.title}</div><div className="text-xs text-muted-foreground">{a.store_name ? <Link className="text-primary" to={`/lojas/${a.store_id}`}>{a.store_name}</Link> : 'plataforma'} · desde {dt(a.first_seen)} · {a.occurrences}× · {a.status}{a.resolved_by ? ` (${a.resolved_by})` : ''}</div></div>
            {a.status !== 'resolved' && <div className="flex gap-1.5">{a.status === 'open' && <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => run(() => post(`/v1/platform/alerts/${a.id}/ack`), 'Reconhecido')}><Check size={13} /> Reconhecer</button>}<button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => run(() => post(`/v1/platform/alerts/${a.id}/resolve`), 'Resolvido')}><CheckCheck size={13} /> Resolver</button></div>}</div>))}</div>)}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Regra: ${edit?.title ?? ''}`} footer={<><button className="btn-ghost" onClick={() => setEdit(null)}>Cancelar</button><button className="btn" disabled={act.busy} onClick={() => run(async () => { await put(`/v1/platform/alert-rules/${edit.key}`, { params: JSON.parse(edit.paramsText), severity: edit.severity, cooldownMin: Number(edit.cooldown_min) }); setEdit(null); }, 'Regra salva')}><Save size={14} /> Salvar</button></>}>
        {edit && <div className="space-y-3 text-sm"><ErrorBox>{act.error}</ErrorBox><Field label="Parâmetros (JSON)" hint="Só os parâmetros que a regra já tem."><textarea className="input font-mono text-xs" rows={3} value={edit.paramsText} onChange={(e) => setEdit({ ...edit, paramsText: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Severidade"><select className="input" value={edit.severity} onChange={(e) => setEdit({ ...edit, severity: e.target.value })}><option value="info">info</option><option value="warn">warn</option><option value="critical">critical</option></select></Field><Field label="Reavisar a cada (min)"><input className="input" type="number" min={1} value={edit.cooldown_min} onChange={(e) => setEdit({ ...edit, cooldown_min: e.target.value })} /></Field></div></div>}
      </Modal>
    </>
  );
}

// ---------------- saúde ----------------
export function Health() {
  const [minutes, setMinutes] = useState(60);
  const l = useLoad(() => get(`/v1/platform/health?minutes=${minutes}`), [minutes], 15_000);
  if (!l.data) return <Spinner />;
  const h = l.data, max = Math.max(1, ...h.series.map((p: any) => p.requests));
  return (
    <>
      <PageHeader title="Saúde da API" subtitle="Requisições, erros 5xx e latência (p95 estimado por faixas)" actions={<><select className="input !w-auto" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>{[15, 60, 180, 360].map((n) => <option key={n} value={n}>Últimos {n} min</option>)}</select><button className="btn-ghost" onClick={l.reload}><RefreshCw size={14} /> Atualizar</button></>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Requisições" value={h.requests} /><Stat label="Erros 5xx" value={`${(h.errorRate * 100).toFixed(2)}%`} tone={h.errorRate > 0.02 ? 'bad' : 'ok'} sub={`${h.errors} erro(s)`} /><Stat label="p95" value={h.p95Ms == null ? '—' : `${h.p95Ms} ms`} tone={h.p95Ms != null && h.p95Ms > 1500 ? 'warn' : 'ok'} />
        <Stat label="Telemetria perdida" value={h.telemetryDropped} tone={h.telemetryDropped ? 'warn' : 'ok'} sub={h.webhooksStuck ? `${h.webhooksStuck} webhook(s) parado(s)` : 'webhooks em dia'} />
      </div>
      <section className="card mt-5 p-4"><h2 className="mb-3 font-semibold">Requisições por minuto</h2>
        {h.series.length === 0 ? <p className="text-sm text-muted-foreground">Sem dados no período.</p> : <div className="flex h-36 items-end gap-0.5">{h.series.map((p: any) => <div key={p.at} className="flex flex-1 flex-col justify-end" title={`${new Date(p.at).toLocaleTimeString('pt-BR')}: ${p.requests} req, ${p.errors} erro(s), p95 ${p.p95Ms ?? '—'} ms`}><div className={p.errors ? 'w-full rounded-t bg-destructive/80' : 'w-full rounded-t bg-primary/70'} style={{ height: `${(p.requests / max) * 100}%`, minHeight: 2 }} /></div>)}</div>}</section>
      <div className="mt-5"><Table head={['Rota', 'Método', 'Req.', 'Erros', 'Média', 'Máx.']}>{h.slowestRoutes.map((r: any) => <tr key={r.route + r.method}><td className="p-3"><code className="text-xs">{r.route}</code></td><td className="p-3">{r.method}</td><td className="p-3">{r.requests}</td><td className={`p-3 ${r.errors ? 'font-bold text-destructive' : ''}`}>{r.errors}</td><td className="p-3">{r.avg_ms} ms</td><td className="p-3">{r.max_ms} ms</td></tr>)}</Table></div>
    </>
  );
}

// ---------------- logs e auditoria ----------------
const LEVEL: Record<string, string> = { error: 'bg-red-100 text-red-700', warn: 'bg-amber-100 text-amber-700', info: 'bg-blue-100 text-blue-700', debug: 'bg-slate-100 text-slate-600' };
export function Logs() {
  const [f, setF] = useState({ level: '', service: '', q: '', store: '' });
  const [rows, setRows] = useState<any[]>([]); const [next, setNext] = useState<number | null>(null); const [loaded, setLoaded] = useState(false);
  const act = useAction();
  const stores = useLoad(() => get('/v1/platform/stores'), []);
  const search = (before?: number) => act.run(async () => { const r = await get(`/v1/platform/logs${qs({ ...f, before, limit: 50 })}`); setRows(before ? [...rows, ...r.logs] : r.logs); setNext(r.nextBefore); setLoaded(true); });
  return (
    <>
      <PageHeader title="Logs" subtitle="Erros e acessos negados da API, dos pagamentos, do iFood e da impressão" />
      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Loja"><select className="input" value={f.store} onChange={(e) => setF({ ...f, store: e.target.value })}><option value="">Todas</option>{stores.data?.stores.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Nível"><select className="input" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}><option value="">Todos</option><option value="error">erro</option><option value="warn">aviso</option><option value="info">info</option></select></Field>
        <Field label="Serviço"><select className="input" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })}><option value="">Todos</option>{['api', 'mcp', 'worker', 'print', 'payments'].map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Texto"><input className="input" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && void search()} /></Field>
        <div className="flex items-end"><button className="btn w-full" disabled={act.busy} onClick={() => search()}>Buscar</button></div>
      </div>
      <ErrorBox>{act.error}</ErrorBox>
      {!loaded ? <Empty>Use os filtros e clique em Buscar.</Empty> : rows.length === 0 ? <Empty>Nada encontrado.</Empty> : <>
        <div className="card divide-y divide-border">{rows.map((l) => <div key={l.id} className="p-3 text-sm"><div className="flex flex-wrap items-center gap-2"><Badge cls={LEVEL[l.level]}>{l.level}</Badge><Badge>{l.service}</Badge><b>{l.event}</b>{l.store_name && <span className="text-xs text-muted-foreground">{l.store_name}</span>}<span className="ml-auto text-xs text-muted-foreground">{dt(l.at)}</span></div><div className="mt-1 text-muted-foreground">{l.message}</div>{l.data && <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-[11px]">{JSON.stringify(l.data, null, 1)}</pre>}</div>)}</div>
        {next && <button className="btn-ghost mt-3 w-full" onClick={() => search(next)}>Carregar mais</button>}</>}
    </>
  );
}

export function Audit() {
  const [f, setF] = useState({ actor: '', action: '', store: '' });
  const [rows, setRows] = useState<any[]>([]); const [next, setNext] = useState<number | null>(null); const [loaded, setLoaded] = useState(false);
  const act = useAction();
  const search = (before?: number) => act.run(async () => { const r = await get(`/v1/platform/audit${qs({ ...f, before, limit: 50 })}`); setRows(before ? [...rows, ...r.entries] : r.entries); setNext(r.nextBefore); setLoaded(true); });
  return (
    <>
      <PageHeader title="Auditoria" subtitle="Quem fez o quê e quando: super admin, MCP, equipe das lojas e cobrança (nunca é apagada)" />
      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-3">
        <Field label="Quem"><select className="input" value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })}><option value="">Todos</option><option value="superadmin">Super admin</option><option value="mcp">MCP</option><option value="staff">Equipe das lojas</option><option value="billing">Cobrança</option><option value="system">Sistema</option></select></Field>
        <Field label="Ação começa com" hint="Ex.: auth. · store. · mcp. · release."><input className="input" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} /></Field>
        <div className="flex items-end"><button className="btn w-full" disabled={act.busy} onClick={() => search()}>Buscar</button></div>
      </div>
      <ErrorBox>{act.error}</ErrorBox>
      {!loaded ? <Empty>Clique em Buscar.</Empty> : rows.length === 0 ? <Empty>Nada encontrado.</Empty> : <>
        <Table head={['Quando', 'Quem', 'Ação', 'Loja', 'IP', 'Detalhe']}>{rows.map((e) => <tr key={e.id}><td className="whitespace-nowrap p-3 text-xs">{dt(e.at)}</td><td className="p-3 text-xs"><Badge>{e.actor_kind}</Badge> {e.admin_email ?? e.actor_id ?? ''}</td><td className="p-3 font-medium">{e.action}</td><td className="p-3 text-xs">{e.store_name ?? '—'}</td><td className="p-3 text-xs">{e.ip ?? '—'}</td><td className="max-w-xs p-3"><code className="block truncate text-[11px] text-muted-foreground" title={JSON.stringify({ before: e.before, after: e.after, meta: e.meta })}>{JSON.stringify(e.meta ?? e.after ?? e.before ?? {})}</code></td></tr>)}</Table>
        {next && <button className="btn-ghost mt-3 w-full" onClick={() => search(next)}>Carregar mais</button>}</>}
    </>
  );
}
void ago; void del;
