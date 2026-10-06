import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Plus, Rocket, Save, UserPlus } from 'lucide-react';
import { get, post, put, qs, brl, dt, ago } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Field, Modal } from '@/ui/kit';
import { Badge, Delta, Empty, PageHeader, SEVERITY, Stat, STORE_STATUS, STORE_STATUS_LABEL, Table, useLoad } from '@/ui/bits';
import { ErrorBox, Spinner, useAction } from '@/ui/misc';
import { useToast } from '@/ui/Toast';

export function StoresList() {
  const [status, setStatus] = useState('');
  const l = useLoad(() => get(`/v1/platform/stores${qs({ status })}`), [status], 60_000);
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ slug: '', name: '', tenantName: '' });
  const act = useAction(); const toast = useToast();
  return (
    <>
      <PageHeader title="Lojas" subtitle="Todas as lojas, em qualquer status" actions={<>
        <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todas</option>{Object.entries(STORE_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="btn" onClick={() => setOpen(true)}><Plus size={14} /> Nova loja</button></>} />
      <ErrorBox>{l.error}</ErrorBox>
      {!l.data ? <Spinner /> : l.data.stores.length === 0 ? <Empty>Nenhuma loja.</Empty> : (
        <Table head={['Loja', 'Conta', 'Status', 'Domínio', 'Assinatura', 'Criada']}>
          {l.data.stores.map((s: any) => (
            <tr key={s.id} className="cursor-pointer hover:bg-muted/50" onClick={() => nav(`/lojas/${s.id}`)}>
              <td className="p-3 font-medium">{s.name}<div className="text-xs text-muted-foreground">{s.slug}</div></td><td className="p-3">{s.tenant_name}</td>
              <td className="p-3"><Badge cls={STORE_STATUS[s.status]}>{STORE_STATUS_LABEL[s.status]}</Badge></td><td className="p-3 text-xs">{s.domain}</td><td className="p-3">{s.subscription ?? '—'}</td><td className="p-3 text-xs">{dt(s.created_at)}</td>
            </tr>))}
        </Table>)}
      <Modal open={open} onClose={() => setOpen(false)} title="Nova loja" footer={<><button className="btn-ghost" onClick={() => setOpen(false)}>Cancelar</button><button className="btn" disabled={act.busy || f.slug.length < 3 || f.name.length < 2 || f.tenantName.length < 2} onClick={() => act.run(async () => { const r = await post('/v1/platform/stores', f); toast('Loja criada em desenvolvimento'); setOpen(false); nav(`/lojas/${r.id}`); })}><Save size={14} /> Criar</button></>}>
        <div className="space-y-3"><ErrorBox>{act.error}</ErrorBox>
          <Field label="Nome da loja"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Endereço (slug)" hint="Letras minúsculas, números e hífen. Vira slug.dominio-base."><input className="input" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} /></Field>
          <Field label="Nome da conta (cliente)"><input className="input" value={f.tenantName} onChange={(e) => setF({ ...f, tenantName: e.target.value })} /></Field></div>
      </Modal>
    </>
  );
}

export function StoreDetail() {
  const { id } = useParams();
  const { stepUp } = useAuth(); const toast = useToast(); const act = useAction();
  const [days, setDays] = useState(7);
  const a = useLoad(() => get(`/v1/platform/analytics/stores/${id}${qs({ days })}`), [id, days], 60_000);
  const act2 = useLoad(() => get(`/v1/platform/stores/${id}/activity?limit=60`), [id], 30_000);
  const rel = useLoad(() => get('/v1/platform/releases?app=web'), []);
  const [statusModal, setStatusModal] = useState<string | null>(null); const [reason, setReason] = useState(''); const [waiver, setWaiver] = useState('');
  const [adminModal, setAdminModal] = useState(false); const [adm, setAdm] = useState({ name: '', email: '', password: '' });
  const [pinModal, setPinModal] = useState(false); const [pin, setPin] = useState({ version: '', channel: 'estavel' });
  if (a.error) return <ErrorBox>{a.error}</ErrorBox>;
  if (!a.data) return <Spinner />;
  const d = a.data, s = d.store;
  const change = (to: string) => act.run(async () => { await stepUp(() => post(`/v1/platform/stores/${id}/status`, { to, reason: reason || undefined, waiverReason: waiver || undefined })); toast(`Status: ${STORE_STATUS_LABEL[to]}`); setStatusModal(null); setReason(''); setWaiver(''); await a.reload(); });
  const allowed = s.status === 'desenvolvimento' ? ['producao', 'arquivada'] : s.status === 'producao' ? ['desenvolvimento', 'suspensa', 'arquivada'] : s.status === 'suspensa' ? ['producao', 'arquivada'] : [];
  const maxDay = Math.max(1, ...d.byDay.map((x: any) => x.orders)), maxHour = Math.max(1, ...d.byHour.map((x: any) => x.orders));
  return (
    <>
      <Link to="/lojas" className="mb-3 inline-flex items-center gap-1 text-sm text-primary"><ArrowLeft size={14} /> Lojas</Link>
      <PageHeader title={s.name} subtitle={`${s.tenant_name} · ${s.slug}`} actions={<>
        <Badge cls={STORE_STATUS[s.status]}>{STORE_STATUS_LABEL[s.status]}</Badge>
        <select className="input !w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[1, 7, 14, 30, 90].map((n) => <option key={n} value={n}>{n} dia(s)</option>)}</select>
        <button className="btn-ghost" onClick={() => setAdminModal(true)}><UserPlus size={14} /> Administrador</button>
        <button className="btn-ghost" onClick={() => setPinModal(true)}><Rocket size={14} /> Versão</button>
        {allowed.map((t) => <button key={t} className={t === 'arquivada' ? 'btn-danger' : 'btn'} onClick={() => setStatusModal(t)}>{t === 'producao' ? 'Publicar' : t === 'desenvolvimento' ? 'Voltar p/ desenvolvimento' : t === 'suspensa' ? 'Suspender' : 'Arquivar'}</button>)}</>} />
      <ErrorBox>{act.error}</ErrorBox>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pedidos" value={d.orders} sub={<>vs. período anterior <Delta v={d.change.orders} /></>} />
        <Stat label="Faturamento" value={brl(d.revenueCents)} sub={<>vs. anterior <Delta v={d.change.revenue} /></>} />
        <Stat label="Ticket médio" value={brl(d.avgTicketCents)} />
        <Stat label="Cancelamento" value={`${Math.round(d.cancelRate * 100)}%`} tone={d.cancelRate > 0.2 ? 'bad' : undefined} sub={`${d.cancelled} cancelado(s)`} />
        <Stat label="Aceite" value={d.avgAcceptMin == null ? '—' : `${d.avgAcceptMin} min`} /><Stat label="Preparo" value={d.avgPrepMin == null ? '—' : `${d.avgPrepMin} min`} /><Stat label="Entrega" value={d.avgDeliveryMin == null ? '—' : `${d.avgDeliveryMin} min`} />
        <Stat label="API da loja" value={`${(d.api.errorRate * 100).toFixed(2)}% erros`} sub={`${d.api.requests} req · p95 ${d.api.p95Ms ?? '—'} ms`} tone={d.api.errorRate > 0.02 ? 'bad' : 'ok'} />
      </div>
      {d.openAlerts.length > 0 && <div className="mt-4 space-y-1.5">{d.openAlerts.map((x: any) => <div key={x.id} className="flex items-center gap-2 rounded-ui-sm bg-card p-2.5 text-sm"><span className={`badge ${SEVERITY[x.severity]}`}>{x.severity}</span>{x.title}</div>)}</div>}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="card p-4"><h2 className="mb-3 font-semibold">Pedidos por dia</h2>
          {d.byDay.length === 0 ? <p className="text-sm text-muted-foreground">Sem pedidos no período.</p> : <div className="flex h-32 items-end gap-1">{d.byDay.map((x: any) => <div key={x.day} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${x.day}: ${x.orders} pedidos · ${brl(x.revenue_cents)}`}><div className="w-full rounded-t bg-primary/80" style={{ height: `${(x.orders / maxDay) * 100}%`, minHeight: 3 }} /><span className="text-[9px] text-muted-foreground">{x.day.slice(8)}</span></div>)}</div>}</section>
        <section className="card p-4"><h2 className="mb-3 font-semibold">Pedidos por hora</h2>
          <div className="flex h-32 items-end gap-0.5">{Array.from({ length: 24 }, (_, h) => d.byHour.find((x: any) => x.hour === h)?.orders ?? 0).map((n, h) => <div key={h} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${h}h: ${n}`}><div className="w-full rounded-t bg-primary/80" style={{ height: `${(n / maxHour) * 100}%`, minHeight: n ? 3 : 0 }} /><span className="text-[9px] text-muted-foreground">{h % 3 === 0 ? h : ''}</span></div>)}</div></section>
        <section className="card p-4"><h2 className="mb-2 font-semibold">Mais vendidos</h2>{d.topProducts.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : d.topProducts.map((p: any) => <div key={p.name} className="flex justify-between py-1 text-sm"><span>{p.name}</span><span><b>{p.qty}</b> · {brl(p.revenue_cents)}</span></div>)}
          <h3 className="mb-1 mt-4 text-sm font-semibold">Canais e pagamentos</h3>{d.byChannel.map((c: any) => <div key={c.channel + c.type} className="flex justify-between py-0.5 text-sm"><span>{c.channel} · {c.type}</span><span><b>{c.orders}</b> · {brl(c.revenue_cents)}</span></div>)}{d.byPayment.map((p: any) => <div key={p.method} className="flex justify-between py-0.5 text-sm text-muted-foreground"><span>{p.method}</span><span>{p.orders} · {brl(p.revenue_cents)}</span></div>)}
          {d.cancelReasons.length > 0 && <><h3 className="mb-1 mt-4 text-sm font-semibold">Motivos de cancelamento</h3>{d.cancelReasons.map((c: any) => <div key={c.reason} className="flex justify-between py-0.5 text-sm"><span>{c.reason}</span><b>{c.n}</b></div>)}</>}</section>
        <section className="card p-4"><h2 className="mb-2 font-semibold">Atividade recente</h2>
          <div className="max-h-96 divide-y divide-border overflow-y-auto">{act2.data?.items.map((i: any, k: number) => <div key={k} className="py-1.5 text-xs"><div className="flex items-center gap-2"><Badge cls={i.severity === 'error' ? 'bg-red-100 text-red-700' : i.severity === 'warn' ? 'bg-amber-100 text-amber-700' : undefined}>{i.source}</Badge><b>{i.event}</b><span className="ml-auto text-muted-foreground">{ago(i.at)}</span></div><div className="text-muted-foreground">{i.message}</div></div>)}{act2.data?.items.length === 0 && <p className="py-2 text-sm text-muted-foreground">Sem atividade.</p>}</div></section>
      </div>

      <Modal open={!!statusModal} onClose={() => setStatusModal(null)} title={`Mudar para ${STORE_STATUS_LABEL[statusModal ?? ''] ?? ''}`} footer={<><button className="btn-ghost" onClick={() => setStatusModal(null)}>Cancelar</button><button className="btn" disabled={act.busy} onClick={() => change(statusModal!)}>Confirmar (pede o autenticador)</button></>}>
        <div className="space-y-3 text-sm"><ErrorBox>{act.error}</ErrorBox>
          {statusModal === 'producao' && <Field label="Cortesia (só se a conta NÃO tem assinatura ativa ou em teste)" hint="Informe o motivo para publicar sem assinatura."><input className="input" value={waiver} onChange={(e) => setWaiver(e.target.value)} placeholder="Ex.: parceiro piloto" /></Field>}
          {statusModal !== 'producao' && <Field label="Justificativa" hint={statusModal === 'desenvolvimento' ? 'Obrigatória para tirar uma loja do ar.' : undefined}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}</div>
      </Modal>
      <Modal open={adminModal} onClose={() => setAdminModal(false)} title="Administrador da loja" footer={<><button className="btn-ghost" onClick={() => setAdminModal(false)}>Cancelar</button><button className="btn" disabled={act.busy || adm.password.length < 10} onClick={() => act.run(async () => { const r = await stepUp(() => post(`/v1/platform/stores/${id}/admin-user`, adm)); toast(r.created ? 'Administrador criado' : 'Senha redefinida'); setAdminModal(false); setAdm({ name: '', email: '', password: '' }); })}>Salvar</button></>}>
        <div className="space-y-3 text-sm"><ErrorBox>{act.error}</ErrorBox><p className="text-xs text-muted-foreground">Cria o primeiro administrador. Se o e-mail já existir, a senha é <b>redefinida</b> e as sessões dele são encerradas.</p>
          <Field label="Nome"><input className="input" value={adm.name} onChange={(e) => setAdm({ ...adm, name: e.target.value })} /></Field><Field label="E-mail"><input className="input" type="email" value={adm.email} onChange={(e) => setAdm({ ...adm, email: e.target.value })} /></Field><Field label="Senha (mín. 10)"><input className="input" type="password" autoComplete="new-password" value={adm.password} onChange={(e) => setAdm({ ...adm, password: e.target.value })} /></Field></div>
      </Modal>
      <Modal open={pinModal} onClose={() => setPinModal(false)} title="Versão do app desta loja" footer={<><button className="btn-ghost" onClick={() => setPinModal(false)}>Cancelar</button><button className="btn" disabled={act.busy} onClick={() => act.run(async () => { await stepUp(() => put(`/v1/platform/stores/${id}/pin`, { version: pin.version || null, channel: pin.channel })); toast('Versão atualizada'); setPinModal(false); })}>Salvar</button></>}>
        <div className="space-y-3 text-sm"><ErrorBox>{act.error}</ErrorBox><Field label="Versão fixa" hint="Vazio = segue o canal. Para voltar uma versão (rollback), escolha a anterior."><select className="input" value={pin.version} onChange={(e) => setPin({ ...pin, version: e.target.value })}><option value="">Seguir o canal</option>{rel.data?.releases.map((r: any) => <option key={r.version} value={r.version}>{r.version} ({r.channel})</option>)}</select></Field>
          <Field label="Canal"><select className="input" value={pin.channel} onChange={(e) => setPin({ ...pin, channel: e.target.value })}><option value="estavel">Estável</option><option value="beta">Beta</option></select></Field></div>
      </Modal>
      <span className="hidden"><ExternalLink /></span>
    </>
  );
}
