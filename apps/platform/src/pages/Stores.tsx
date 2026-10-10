import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, Eye, ExternalLink, Globe, Plus, RefreshCw, Rocket, Save, Trash2, UserPlus } from 'lucide-react';
import { del, get, post, put, qs, brl, dt, ago } from '@/lib/api';
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
  const [f, setF] = useState({ slug: '', name: '', tenantName: '', adminName: '', adminEmail: '', adminPassword: '' });
  const adminOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.adminEmail) && f.adminPassword.length >= 10;
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
      <Modal open={open} onClose={() => setOpen(false)} title="Nova loja" footer={<><button className="btn-ghost" onClick={() => setOpen(false)}>Cancelar</button><button className="btn" disabled={act.busy || f.slug.length < 3 || f.name.length < 2 || f.tenantName.length < 2 || !adminOk} onClick={() => act.run(async () => { const r = await post('/v1/platform/stores', { ...f, adminName: f.adminName.trim() || undefined }); toast(`Loja criada em desenvolvimento. Painel: ${r.domain}/entrar`); setF({ slug: '', name: '', tenantName: '', adminName: '', adminEmail: '', adminPassword: '' }); setOpen(false); nav(`/lojas/${r.id}`); })}><Save size={14} /> Criar</button></>}>
        <div className="space-y-3"><ErrorBox>{act.error}</ErrorBox>
          <Field label="Nome da loja"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Endereço (slug)" hint="Letras minúsculas, números e hífen. Vira slug.dominio-base."><input className="input" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} /></Field>
          <Field label="Nome da conta (cliente)"><input className="input" value={f.tenantName} onChange={(e) => setF({ ...f, tenantName: e.target.value })} /></Field>
          <div className="border-t border-border pt-3"><p className="mb-2 text-sm font-semibold">Administrador da loja</p><p className="mb-3 text-xs text-muted-foreground">Entra no painel da loja (/entrar) já em desenvolvimento, para montar cardápio, aparência e equipe.</p>
            <div className="space-y-3">
              <Field label="Nome (opcional)"><input className="input" value={f.adminName} onChange={(e) => setF({ ...f, adminName: e.target.value })} placeholder="Administrador" /></Field>
              <Field label="E-mail *"><input className="input" type="email" autoComplete="off" value={f.adminEmail} onChange={(e) => setF({ ...f, adminEmail: e.target.value.trim() })} /></Field>
              <Field label="Senha *" hint="Mínimo de 10 caracteres."><input className="input" type="password" autoComplete="new-password" value={f.adminPassword} onChange={(e) => setF({ ...f, adminPassword: e.target.value })} /></Field>
            </div></div></div>
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
  const feat = useLoad(() => get(`/v1/platform/stores/${id}/features`), [id]);
  const [statusModal, setStatusModal] = useState<string | null>(null); const [reason, setReason] = useState(''); const [waiver, setWaiver] = useState('');
  const [adminModal, setAdminModal] = useState(false); const [adm, setAdm] = useState({ name: '', email: '', password: '' });
  const [pinModal, setPinModal] = useState(false); const [pin, setPin] = useState({ version: '', channel: 'estavel' });
  const prev = useLoad(() => get(`/v1/platform/stores/${id}/preview`), [id]); const [prevModal, setPrevModal] = useState(false);
  // abre a aba já no clique (bloqueadores de pop-up barram janelas abertas depois de um await) e só então aponta para o link
  const openPreview = () => { const w = window.open('about:blank', '_blank'); if (w) w.opener = null;
    act.run(async () => { try { const link = prev.data?.link ?? (await post(`/v1/platform/stores/${id}/preview`)).link; await prev.reload(); if (w) w.location.href = link; else window.location.assign(link); } catch (e) { w?.close(); throw e; } }); };
  const newPreview = () => confirm('Trocar o link? O link atual para de funcionar na hora.') && act.run(async () => { await post(`/v1/platform/stores/${id}/preview`); await prev.reload(); toast('Novo link de prévia criado'); });
  const offPreview = () => act.run(async () => { await del(`/v1/platform/stores/${id}/preview`); await prev.reload(); toast('Link de prévia desligado'); });
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
        {s.status === 'desenvolvimento' && <><button className="btn" onClick={openPreview} disabled={act.busy}><Eye size={14} /> Pré-visualizar</button><button className="btn-ghost" onClick={() => setPrevModal(true)}><ExternalLink size={14} /> Link de prévia</button></>}
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

      <StoreDomains storeId={id!} />

      <section className="card mt-5 p-4"><h2 className="mb-1 font-semibold">Funcionalidades disponíveis</h2>
        <p className="mb-3 text-xs text-muted-foreground">Libera o uso por loja (atendimento WhatsApp e agente). Função ainda não construída aparece indisponível. Cada alteração pede o autenticador.</p>
        <ErrorBox>{feat.error}</ErrorBox>
        {!feat.data ? <Spinner /> : <div className="divide-y divide-border">{feat.data.features.map((f: any) => (
          <label key={f.key} className={`flex items-start gap-3 py-2 text-sm ${f.available ? 'cursor-pointer' : 'opacity-60'}`}>
            <input type="checkbox" className="mt-1" checked={f.enabled} disabled={act.busy || (!f.available && !f.enabled)}
              onChange={(e) => act.run(async () => { await stepUp(() => put(`/v1/platform/stores/${id}/features`, { changes: { [f.key]: e.target.checked } })); toast(`${f.label}: ${e.target.checked ? 'liberada' : 'desativada'}`); await feat.reload(); })} />
            <span><b>{f.label}</b>{!f.available && <Badge> indisponível</Badge>}<span className="block text-xs text-muted-foreground">{f.description}{f.requires.length > 0 && ` Requer: ${f.requires.map((r: string) => feat.data.features.find((x: any) => x.key === r)?.label).join(', ')}.`}</span></span>
          </label>))}</div>}</section>

      <Modal open={!!statusModal} onClose={() => setStatusModal(null)} title={`Mudar para ${STORE_STATUS_LABEL[statusModal ?? ''] ?? ''}`} footer={<><button className="btn-ghost" onClick={() => setStatusModal(null)}>Cancelar</button><button className="btn" disabled={act.busy} onClick={() => change(statusModal!)}>Confirmar (pede o autenticador)</button></>}>
        <div className="space-y-3 text-sm"><ErrorBox>{act.error}</ErrorBox>
          {statusModal === 'producao' && <Field label="Cortesia (só se a conta NÃO tem assinatura ativa ou em teste)" hint="Informe o motivo para publicar sem assinatura."><input className="input" value={waiver} onChange={(e) => setWaiver(e.target.value)} placeholder="Ex.: parceiro piloto" /></Field>}
          {statusModal !== 'producao' && <Field label="Justificativa" hint={statusModal === 'desenvolvimento' ? 'Obrigatória para tirar uma loja do ar.' : undefined}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}</div>
      </Modal>
      <Modal open={prevModal} onClose={() => setPrevModal(false)} title="Link de prévia" footer={<button className="btn" onClick={() => setPrevModal(false)}>Fechar</button>}>
        <div className="space-y-3 text-sm"><ErrorBox>{act.error}</ErrorBox>
          <p className="text-muted-foreground">Quem abrir o link vê a vitrine desta loja em desenvolvimento (ótimo para mostrar ao cliente). Pedidos continuam bloqueados até publicar.</p>
          {prev.data?.link ? <>
            <code className="block break-all rounded-ui-sm bg-muted p-3 text-xs">{prev.data.link}</code>
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(prev.data.link).then(() => toast('Copiado'))}><Copy size={14} /> Copiar</button>
              <button className="btn-ghost" onClick={newPreview} disabled={act.busy}><RefreshCw size={14} /> Trocar link</button>
              <button className="btn-danger" onClick={offPreview} disabled={act.busy}>Desligar</button>
            </div></>
            : <button className="btn" onClick={() => act.run(async () => { await post(`/v1/platform/stores/${id}/preview`); await prev.reload(); })} disabled={act.busy}><Plus size={14} /> Criar link de prévia</button>}
        </div>
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

/** Domínios da loja: o super admin adiciona, verifica (DNS) e remove, sem depender do lojista. */
function StoreDomains({ storeId }: { storeId: string }) {
  const { stepUp } = useAuth(); const toast = useToast(); const act = useAction();
  const l = useLoad(() => get(`/v1/platform/stores/${storeId}/domains`), [storeId]);
  const [host, setHost] = useState(''); const [forced, setForced] = useState(false);
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast('Copiado'));
  const base = `/v1/platform/stores/${storeId}/domains`;
  return (
    <section className="card mt-5 p-4"><h2 className="mb-1 font-semibold">Domínios</h2>
      <p className="mb-3 text-xs text-muted-foreground">O endereço da loja. O domínio próprio precisa de dois registros no DNS (CNAME e TXT) antes de ser verificado. Adicionar e remover pede o autenticador.</p>
      <ErrorBox>{act.error ?? l.error}</ErrorBox>
      {!l.data ? <Spinner /> : (
        <div className="space-y-2">
          {l.data.domains.length === 0 && <p className="text-sm text-muted-foreground">Nenhum domínio cadastrado.</p>}
          {l.data.domains.map((d: any) => (
            <div key={d.id} className="rounded-ui-sm border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><Globe size={15} className="text-muted-foreground" /><b className="flex-1 break-all">{d.hostname}</b>
                {d.verified ? <Badge cls="bg-green-100 text-green-700">{d.kind === 'subdomain' ? 'padrão' : 'verificado'}</Badge> : <Badge cls="bg-amber-100 text-amber-700">aguardando DNS</Badge>}
                {d.kind === 'custom' && <button className="btn-danger !p-1.5" aria-label={`Remover ${d.hostname}`} disabled={act.busy} onClick={() => confirm(`Remover ${d.hostname}? A loja deixa de abrir por esse endereço.`) && act.run(async () => { await stepUp(() => del(`${base}/${d.id}`)); toast('Domínio removido'); await l.reload(); })}><Trash2 size={13} /></button>}</div>
              {d.instructions && (
                <div className="mt-2 space-y-1.5 rounded-ui-sm bg-muted/60 p-3 text-xs">
                  <p>No provedor de DNS do domínio, crie <b>os dois registros</b> abaixo e clique em Verificar (pode levar de minutos a horas para propagar).</p>
                  {([['CNAME', d.instructions.cname.name, d.instructions.cname.value], ['TXT', d.instructions.txt.name, d.instructions.txt.value]] as const).map(([t, name, value]) => (
                    <div key={t} className="grid grid-cols-[48px_1fr_auto] items-center gap-2"><b>{t}</b><div className="min-w-0"><div className="truncate">Nome: <code>{name}</code></div><div className="truncate">Valor: <code>{value}</code></div></div><button className="btn-ghost !p-1.5" aria-label={`Copiar valor do ${t}`} onClick={() => copy(value)}><Copy size={12} /></button></div>))}
                  {d.verifyError && <p className="text-destructive">{d.verifyError}</p>}
                  <button className="btn !px-3 !py-1.5 text-xs" disabled={act.busy} onClick={() => act.run(async () => { try { await post(`${base}/${d.id}/verify`); toast('Domínio verificado!'); } finally { await l.reload(); } })}><RefreshCw size={13} /> Verificar agora</button>
                </div>)}
            </div>))}
          <div className="flex flex-wrap items-end gap-2 pt-1">
            <div className="min-w-[240px] flex-1"><Field label="Adicionar domínio próprio"><input className="input" placeholder="pedidos.sualoja.com.br" value={host} onChange={(e) => setHost(e.target.value.toLowerCase().trim())} /></Field></div>
            <button className="btn" disabled={act.busy || !host.includes('.')} onClick={() => act.run(async () => { await stepUp(() => post(base, { hostname: host, markVerified: forced })); setHost(''); setForced(false); toast('Domínio adicionado'); await l.reload(); })}><Plus size={14} /> Adicionar</button>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={forced} onChange={(e) => setForced(e.target.checked)} /> Já está apontado corretamente: marcar como verificado sem checar o DNS</label>
        </div>)}
    </section>
  );
}
