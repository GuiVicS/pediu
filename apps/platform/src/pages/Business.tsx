import { useState } from 'react';
import { Check, Copy, KeyRound, Link2, Plus, Rocket, Save, Trash2 } from 'lucide-react';
import { del, get, post, put, brl, dt } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Field, Modal, Toggle } from '@/ui/kit';
import { Badge, Empty, PageHeader, Stat, Table, useLoad } from '@/ui/bits';
import { ErrorBox, Spinner, useAction } from '@/ui/misc';
import { useToast } from '@/ui/Toast';

// ---------------- assinaturas (Stripe) ----------------
const SUB: Record<string, string> = { active: 'bg-green-100 text-green-700', trialing: 'bg-blue-100 text-blue-700', past_due: 'bg-amber-100 text-amber-700', unpaid: 'bg-red-100 text-red-700', canceled: 'bg-slate-200 text-slate-600', incomplete: 'bg-slate-100 text-slate-600', paused: 'bg-slate-100 text-slate-600' };

export function Subscriptions() {
  const subs = useLoad(() => get('/v1/platform/subscriptions'), [], 60_000);
  const plans = useLoad(() => get('/v1/platform/plans'), []);
  const cfg = useLoad(() => get('/v1/platform/stripe/config'), []);
  const tenants = useLoad(() => get('/v1/platform/stores'), []);
  const { stepUp } = useAuth(); const act = useAction(); const toast = useToast();
  const [plan, setPlan] = useState<any | null>(null);
  const [stripe, setStripe] = useState<{ secretKey: string; webhookSecret: string } | null>(null);
  const [checkout, setCheckout] = useState<{ tenantId: string; planCode: string; interval: 'month' | 'year'; email: string } | null>(null);
  const [link, setLink] = useState('');
  if (!subs.data || !plans.data || !cfg.data) return <Spinner />;
  const s = subs.data.summary;
  const tenantList = Array.from(new Map((tenants.data?.stores ?? []).map((x: any) => [x.tenant_id, x.tenant_name])).entries());
  const savePlan = () => act.run(async () => {
    const p = plan; const nul = (v: string) => v.trim() || null;
    await stepUp(() => put(`/v1/platform/plans/${p.code}`, { name: p.name, description: p.description, modules: p.modulesText.split(',').map((x: string) => x.trim()).filter(Boolean), stripeProductId: nul(p.stripeProductId), priceMonthly: nul(p.priceMonthly), priceYearly: nul(p.priceYearly), priceSetup: nul(p.priceSetup), trialDays: Number(p.trialDays), active: p.active, sort: Number(p.sort) }));
    toast('Plano salvo (preços conferidos no Stripe)'); setPlan(null); await plans.reload();
  });
  return (
    <>
      <PageHeader title="Assinaturas" subtitle="Planos, preços do Stripe, checkout e cobrança dos lojistas" actions={<button className="btn" onClick={() => setCheckout({ tenantId: '', planCode: plans.data.plans[0]?.code ?? '', interval: 'month', email: '' })}><Link2 size={14} /> Gerar link de checkout</button>} />
      <ErrorBox>{act.error}</ErrorBox>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="MRR" value={brl(s.mrrCents)} /><Stat label="Ativas" value={s.active} tone="ok" /><Stat label="Em teste" value={s.trialing} sub={`${s.trialsEndingIn7Days} vencem em 7 dias`} /><Stat label="Em atraso" value={s.pastDue} tone={s.pastDue ? 'warn' : 'ok'} /><Stat label="Canceladas" value={s.canceled} />
      </div>

      <section className="card mt-5 p-4">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Stripe</h2><button className="btn-ghost" onClick={() => setStripe({ secretKey: '', webhookSecret: '' })}><KeyRound size={14} /> {cfg.data.configured ? 'Trocar chaves' : 'Configurar chaves'}</button></div>
        <p className="text-sm text-muted-foreground">{cfg.data.configured ? <>Chave {cfg.data.secretHint} · modo <b>{cfg.data.mode === 'live' ? 'PRODUÇÃO' : 'teste'}</b> · webhook {cfg.data.webhookConfigured ? 'configurado' : 'faltando'}</> : 'Ainda não configurado. Use a chave restrita (rk_…) ou a secret key de teste e o segredo do webhook (whsec_…).'}</p>
        <p className="mt-1 text-xs text-muted-foreground">Endpoint do webhook no Stripe: <code>{location.origin}/v1/webhooks/stripe</code> — eventos: checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid, invoice.payment_failed.</p>
      </section>

      <section className="mt-5"><div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">Planos</h2><button className="btn-ghost" onClick={() => setPlan({ code: '', name: '', description: '', modulesText: '', stripeProductId: '', priceMonthly: '', priceYearly: '', priceSetup: '', trialDays: 0, active: true, sort: plans.data.plans.length + 1, isNew: true })}><Plus size={14} /> Novo plano</button></div>
        {plans.data.plans.length === 0 ? <Empty>Nenhum plano. Crie os produtos e preços no Stripe e cadastre aqui os IDs (price_…).</Empty> : (
          <Table head={['Plano', 'Mensal', 'Anual', 'Implantação', 'Teste', 'Módulos', '']}>{plans.data.plans.map((p: any) => (
            <tr key={p.code}><td className="p-3 font-medium">{p.name} <code className="text-xs text-muted-foreground">{p.code}</code>{!p.active && <Badge> inativo</Badge>}</td><td className="p-3 text-xs">{p.stripe_price_monthly ?? '—'}</td><td className="p-3 text-xs">{p.stripe_price_yearly ?? '—'}</td><td className="p-3 text-xs">{p.stripe_price_setup ?? '—'}</td><td className="p-3">{p.trial_days} d</td><td className="p-3 text-xs">{p.modules.join(', ')}</td>
              <td className="p-3"><button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setPlan({ code: p.code, name: p.name, description: p.description, modulesText: p.modules.join(', '), stripeProductId: p.stripe_product_id ?? '', priceMonthly: p.stripe_price_monthly ?? '', priceYearly: p.stripe_price_yearly ?? '', priceSetup: p.stripe_price_setup ?? '', trialDays: p.trial_days, active: p.active, sort: p.sort })}>Editar</button></td></tr>))}</Table>)}
      </section>

      <section className="mt-5"><h2 className="mb-2 font-semibold">Assinaturas</h2>
        {subs.data.subscriptions.length === 0 ? <Empty>Nenhuma assinatura ainda.</Empty> : <Table head={['Conta', 'Plano', 'Situação', 'Valor', 'Próxima cobrança', 'Atraso desde']}>{subs.data.subscriptions.map((x: any) => <tr key={x.id}><td className="p-3 font-medium">{x.tenant_name}</td><td className="p-3">{x.plan_name ?? '—'}</td><td className="p-3"><Badge cls={SUB[x.status]}>{x.status}</Badge>{x.cancel_at_period_end && <Badge> cancela no fim</Badge>}</td><td className="p-3">{x.amount_cents != null ? `${brl(x.amount_cents)}/${x.interval === 'year' ? 'ano' : 'mês'}` : '—'}</td><td className="p-3 text-xs">{dt(x.current_period_end)}</td><td className="p-3 text-xs">{dt(x.past_due_since)}</td></tr>)}</Table>}
      </section>

      <Modal open={!!stripe} onClose={() => setStripe(null)} title="Chaves do Stripe" footer={<><button className="btn-ghost" onClick={() => setStripe(null)}>Cancelar</button><button className="btn" disabled={act.busy || !stripe?.secretKey || !stripe?.webhookSecret} onClick={() => act.run(async () => { const r = await stepUp(() => put('/v1/platform/stripe/config', stripe)); toast(`Salvo (modo ${r.mode === 'live' ? 'produção' : 'teste'})`); setStripe(null); await cfg.reload(); })}><Save size={14} /> Salvar</button></>}>
        {stripe && <div className="space-y-3 text-sm"><ErrorBox>{act.error}</ErrorBox><Field label="Secret key (sk_… ou rk_…)"><input className="input" type="password" autoComplete="off" value={stripe.secretKey} onChange={(e) => setStripe({ ...stripe, secretKey: e.target.value })} /></Field><Field label="Segredo do webhook (whsec_…)"><input className="input" type="password" autoComplete="off" value={stripe.webhookSecret} onChange={(e) => setStripe({ ...stripe, webhookSecret: e.target.value })} /></Field><p className="text-xs text-muted-foreground">Ficam cifradas e nunca voltam para a tela. O modo (teste/produção) vem da chave, e o sistema recusa price de outro modo.</p></div>}
      </Modal>

      <Modal open={!!plan} onClose={() => setPlan(null)} wide title={plan?.isNew ? 'Novo plano' : `Plano ${plan?.name ?? ''}`} footer={<><button className="btn-ghost" onClick={() => setPlan(null)}>Cancelar</button><button className="btn" disabled={act.busy || !plan?.code || !plan?.name} onClick={savePlan}><Save size={14} /> Salvar e conferir no Stripe</button></>}>
        {plan && <div className="space-y-3 text-sm"><ErrorBox>{act.error}</ErrorBox>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Código (único)"><input className="input" disabled={!plan.isNew} value={plan.code} onChange={(e) => setPlan({ ...plan, code: e.target.value.toLowerCase() })} /></Field><Field label="Nome"><input className="input" value={plan.name} onChange={(e) => setPlan({ ...plan, name: e.target.value })} /></Field></div>
          <Field label="Descrição"><input className="input" value={plan.description} onChange={(e) => setPlan({ ...plan, description: e.target.value })} /></Field>
          <Field label="Módulos liberados (separados por vírgula)" hint="Ex.: pdv, garcom, ifood, fiscal"><input className="input" value={plan.modulesText} onChange={(e) => setPlan({ ...plan, modulesText: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Product ID (prod_…)"><input className="input" value={plan.stripeProductId} onChange={(e) => setPlan({ ...plan, stripeProductId: e.target.value })} /></Field><Field label="Price mensal (price_…)"><input className="input" value={plan.priceMonthly} onChange={(e) => setPlan({ ...plan, priceMonthly: e.target.value })} /></Field><Field label="Price anual (price_…)"><input className="input" value={plan.priceYearly} onChange={(e) => setPlan({ ...plan, priceYearly: e.target.value })} /></Field><Field label="Price da implantação, único (price_…)"><input className="input" value={plan.priceSetup} onChange={(e) => setPlan({ ...plan, priceSetup: e.target.value })} /></Field></div>
          <div className="flex flex-wrap items-end gap-4"><Field label="Dias de teste"><input className="input !w-24" type="number" min={0} max={90} value={plan.trialDays} onChange={(e) => setPlan({ ...plan, trialDays: e.target.value })} /></Field><Toggle checked={plan.active} onChange={(v) => setPlan({ ...plan, active: v })} label="Ativo" /></div></div>}
      </Modal>

      <Modal open={!!checkout} onClose={() => { setCheckout(null); setLink(''); }} title="Link de checkout" footer={<><button className="btn-ghost" onClick={() => { setCheckout(null); setLink(''); }}>Fechar</button><button className="btn" disabled={act.busy || !checkout?.tenantId || !checkout?.planCode} onClick={() => act.run(async () => { const r = await post('/v1/platform/subscriptions/checkout', { ...checkout, email: checkout!.email || undefined }); setLink(r.url); })}>Gerar</button></>}>
        {checkout && <div className="space-y-3 text-sm"><ErrorBox>{act.error}</ErrorBox>
          <Field label="Conta"><select className="input" value={checkout.tenantId} onChange={(e) => setCheckout({ ...checkout, tenantId: e.target.value })}><option value="">— escolha —</option>{tenantList.map(([id, name]) => <option key={id as string} value={id as string}>{name as string}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Plano"><select className="input" value={checkout.planCode} onChange={(e) => setCheckout({ ...checkout, planCode: e.target.value })}>{plans.data.plans.filter((p: any) => p.active).map((p: any) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></Field><Field label="Cobrança"><select className="input" value={checkout.interval} onChange={(e) => setCheckout({ ...checkout, interval: e.target.value as 'month' | 'year' })}><option value="month">Mensal</option><option value="year">Anual</option></select></Field></div>
          <Field label="E-mail do cliente (opcional)"><input className="input" type="email" value={checkout.email} onChange={(e) => setCheckout({ ...checkout, email: e.target.value })} /></Field>
          {link && <div className="rounded-ui-sm bg-muted p-3"><div className="mb-1 text-xs text-muted-foreground">Envie este link ao cliente:</div><code className="break-all text-xs">{link}</code><button className="btn-ghost mt-2 w-full" onClick={() => navigator.clipboard.writeText(link).then(() => toast('Copiado'))}><Copy size={14} /> Copiar</button></div>}</div>}
      </Modal>
    </>
  );
}

// ---------------- versões por loja ----------------
export function Releases() {
  const rel = useLoad(() => get('/v1/platform/releases'), [], 60_000);
  const ended = useLoad(() => get('/v1/platform/releases/support-ended'), []);
  const { stepUp } = useAuth(); const act = useAction(); const toast = useToast();
  const [form, setForm] = useState<any | null>(null); const [roll, setRoll] = useState<any | null>(null);
  if (!rel.data) return <Spinner />;
  return (
    <>
      <PageHeader title="Versões por loja" subtitle="Cada loja pode rodar uma versão diferente. O rollout é gradual e o rollback é uma linha." actions={<button className="btn" onClick={() => setForm({ app: 'web', version: '', channel: 'beta', changelog: '' })}><Plus size={14} /> Nova versão</button>} />
      <ErrorBox>{act.error ?? rel.error}</ErrorBox>
      {ended.data?.stores.length > 0 && <div className="mb-4 rounded-ui-sm bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"><b>{ended.data.stores.length} loja(s)</b> em versão com suporte encerrado: {ended.data.stores.map((s: any) => `${s.name} (${s.version})`).join(', ')}.</div>}
      {rel.data.releases.length === 0 ? <Empty>Nenhuma versão publicada. Lojas sem versão fixa usam o app embutido na imagem.</Empty> : (
        <Table head={['App', 'Versão', 'Canal', 'Lojas fixadas', 'Fim do suporte', 'Criada', '']}>{rel.data.releases.map((r: any) => (
          <tr key={r.id}><td className="p-3">{r.app}</td><td className="p-3 font-semibold">{r.version}</td><td className="p-3"><Badge cls={r.channel === 'estavel' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}>{r.channel}</Badge></td><td className="p-3">{r.pinned_stores}</td><td className="p-3 text-xs">{dt(r.support_ends_at)}</td><td className="p-3 text-xs">{dt(r.created_at)}</td>
            <td className="space-x-1.5 whitespace-nowrap p-3">{r.channel === 'beta' && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => act.run(async () => { await stepUp(() => put(`/v1/platform/releases/${r.app}/${r.version}`, { channel: 'estavel' })); toast('Promovida a estável'); await rel.reload(); })}><Check size={12} /> Promover</button>}{r.app === 'web' && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setRoll({ app: r.app, version: r.version, percent: 10, result: null })}><Rocket size={12} /> Rollout</button>}</td></tr>))}</Table>)}
      <p className="mt-3 text-xs text-muted-foreground">Para fixar ou voltar a versão de uma loja específica, abra a loja em <b>Lojas</b> e use o botão "Versão".</p>

      <Modal open={!!form} onClose={() => setForm(null)} title="Nova versão" footer={<><button className="btn-ghost" onClick={() => setForm(null)}>Cancelar</button><button className="btn" disabled={act.busy || !form?.version} onClick={() => act.run(async () => { await stepUp(() => post('/v1/platform/releases', { ...form, changelog: form.changelog || undefined })); toast('Versão registrada'); setForm(null); await rel.reload(); })}><Save size={14} /> Registrar</button></>}>
        {form && <div className="space-y-3 text-sm"><ErrorBox>{act.error}</ErrorBox><p className="text-xs text-muted-foreground">Registre aqui a versão cujo build você já publicou no armazenamento (<code>web/VERSÃO/…</code>).</p>
          <div className="grid grid-cols-3 gap-3"><Field label="App"><select className="input" value={form.app} onChange={(e) => setForm({ ...form, app: e.target.value })}><option value="web">web</option><option value="print-agent">print-agent</option></select></Field><Field label="Versão"><input className="input" placeholder="1.4.0" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} /></Field><Field label="Canal"><select className="input" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}><option value="beta">Beta</option><option value="estavel">Estável</option></select></Field></div>
          <Field label="Mudanças"><textarea className="input" rows={3} value={form.changelog} onChange={(e) => setForm({ ...form, changelog: e.target.value })} /></Field></div>}
      </Modal>
      <Modal open={!!roll} onClose={() => setRoll(null)} title={`Rollout de ${roll?.version ?? ''}`} footer={<><button className="btn-ghost" onClick={() => setRoll(null)}>Fechar</button><button className="btn-ghost" disabled={act.busy} onClick={() => act.run(async () => { const r = await stepUp(() => post(`/v1/platform/releases/${roll.app}/${roll.version}/rollout`, { percent: Number(roll.percent), dryRun: true })); setRoll({ ...roll, result: `Simulação: ${r.affected} de ${r.total} loja(s) receberiam.` }); })}>Simular</button><button className="btn" disabled={act.busy} onClick={() => act.run(async () => { const r = await stepUp(() => post(`/v1/platform/releases/${roll.app}/${roll.version}/rollout`, { percent: Number(roll.percent) })); toast(`${r.affected} loja(s) atualizada(s)`); setRoll(null); await rel.reload(); })}>Aplicar</button></>}>
        {roll && <div className="space-y-3 text-sm"><ErrorBox>{act.error}</ErrorBox><Field label={`Percentual de lojas: ${roll.percent}%`} hint="A mesma loja cai sempre no mesmo anel. Lojas já em versão igual ou mais nova não são rebaixadas."><input type="range" min={0} max={100} step={5} value={roll.percent} onChange={(e) => setRoll({ ...roll, percent: e.target.value, result: null })} className="w-full" /></Field>{roll.result && <p className="rounded-ui-sm bg-muted p-2">{roll.result}</p>}</div>}
      </Modal>
    </>
  );
}

// ---------------- iFood (credenciais do aplicativo) ----------------
export function IfoodPlatform() {
  const cfg = useLoad(() => get('/v1/platform/ifood/config'), []);
  const { stepUp } = useAuth(); const act = useAction(); const toast = useToast();
  const [f, setF] = useState({ clientId: '', clientSecret: '' });
  if (!cfg.data) return <Spinner />;
  return (
    <>
      <PageHeader title="iFood — aplicativo da plataforma" subtitle="Credenciais do seu aplicativo de desenvolvedor (uma só para todas as lojas)" />
      <ErrorBox>{act.error}</ErrorBox>
      <section className="card max-w-xl space-y-3 p-4 text-sm">
        <p>{cfg.data.configured ? <>Configurado (…{cfg.data.clientIdHint?.slice(-4)}) · <b>{cfg.data.linkedStores}</b> loja(s) vinculada(s).</> : 'Ainda não configurado. Cadastre-se no iFood Developer, crie um aplicativo centralizado e cole o Client ID e o Secret.'}</p>
        <Field label="Client ID"><input className="input" value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })} /></Field>
        <Field label="Client Secret"><input className="input" type="password" autoComplete="off" value={f.clientSecret} onChange={(e) => setF({ ...f, clientSecret: e.target.value })} /></Field>
        <button className="btn" disabled={act.busy || !f.clientId || !f.clientSecret} onClick={() => act.run(async () => { await stepUp(() => put('/v1/platform/ifood/config', f)); toast('iFood configurado (credenciais conferidas)'); setF({ clientId: '', clientSecret: '' }); await cfg.reload(); })}><Save size={14} /> Validar e salvar</button>
        <p className="text-xs text-muted-foreground">Sem a homologação oficial do iFood, só a loja de teste dele funciona. Os pedidos são consultados a cada 30 s.</p>
      </section>
    </>
  );
}

// ---------------- tokens do MCP ----------------
export function McpTokens() {
  const l = useLoad(() => get('/v1/platform/mcp-tokens'), [], 60_000);
  const { stepUp } = useAuth(); const act = useAction(); const toast = useToast();
  const [form, setForm] = useState<{ name: string; days: number } | null>(null); const [made, setMade] = useState<{ token: string; expiresAt: string } | null>(null);
  if (!l.data) return <Spinner />;
  return (
    <>
      <PageHeader title="Tokens do MCP" subtitle="Quem pode criar e personalizar lojas por agente de IA. O token aparece uma única vez." actions={<button className="btn" onClick={() => setForm({ name: '', days: 90 })}><Plus size={14} /> Novo token</button>} />
      <ErrorBox>{act.error ?? l.error}</ErrorBox>
      <div className="mb-4 rounded-ui-sm bg-muted/60 p-3 text-xs text-muted-foreground">O MCP só altera lojas em <b>desenvolvimento</b>; em produção só lê. Ele nunca publica: pede, e você aprova em <b>Publicações</b>. Endereço do servidor MCP: configure no seu domínio (ex.: <code>https://mcp.seudominio.com/mcp</code>).</div>
      {l.data.tokens.length === 0 ? <Empty>Nenhum token.</Empty> : <Table head={['Nome', 'Final', 'Validade', 'Último uso', 'Situação', '']}>{l.data.tokens.map((t: any) => { const expired = new Date(t.expires_at) < new Date(); return (
        <tr key={t.id}><td className="p-3 font-medium">{t.name}{t.store_limit && <Badge> {t.store_limit.length} loja(s)</Badge>}</td><td className="p-3 font-mono text-xs">…{t.hint}</td><td className="p-3 text-xs">{dt(t.expires_at)}</td><td className="p-3 text-xs">{t.last_used_at ? `${dt(t.last_used_at)} · ${t.last_ip ?? ''}` : 'nunca'}</td>
          <td className="p-3">{t.revoked_at ? <Badge cls="bg-slate-200 text-slate-600">revogado</Badge> : expired ? <Badge cls="bg-amber-100 text-amber-700">vencido</Badge> : <Badge cls="bg-green-100 text-green-700">ativo</Badge>}</td>
          <td className="p-3">{!t.revoked_at && <button className="btn-danger !px-2 !py-1 text-xs" onClick={() => confirm(`Revogar "${t.name}"? Vale na hora.`) && act.run(async () => { await stepUp(() => del(`/v1/platform/mcp-tokens/${t.id}`)); toast('Token revogado'); await l.reload(); })}><Trash2 size={12} /> Revogar</button>}</td></tr>); })}</Table>}
      <Modal open={!!form} onClose={() => setForm(null)} title="Novo token do MCP" footer={<><button className="btn-ghost" onClick={() => setForm(null)}>Cancelar</button><button className="btn" disabled={act.busy || !form?.name.trim()} onClick={() => act.run(async () => { const r = await stepUp(() => post('/v1/platform/mcp-tokens', { name: form!.name, expiresInDays: form!.days })); setMade(r); setForm(null); await l.reload(); })}>Criar</button></>}>
        {form && <div className="space-y-3 text-sm"><ErrorBox>{act.error}</ErrorBox><Field label="Nome (onde será usado)"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Claude Desktop" /></Field><Field label="Validade (dias)"><input className="input" type="number" min={1} max={365} value={form.days} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })} /></Field></div>}
      </Modal>
      <Modal open={!!made} onClose={() => setMade(null)} title="Copie o token agora" footer={<button className="btn" onClick={() => setMade(null)}>Já copiei</button>}>
        {made && <div className="space-y-3 text-sm"><p className="rounded-ui-sm bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-300">Este token <b>não aparece de novo</b>. Quem tiver o token cria e edita lojas em desenvolvimento.</p><code className="block break-all rounded-ui-sm bg-muted p-3 text-xs">{made.token}</code><button className="btn-ghost w-full" onClick={() => navigator.clipboard.writeText(made.token).then(() => toast('Copiado'))}><Copy size={14} /> Copiar</button><p className="text-xs text-muted-foreground">Vence em {dt(made.expiresAt)}.</p></div>}
      </Modal>
    </>
  );
}

// ---------------- rodapé das lojas (link da landing page) ----------------
export function StoreFooter() {
  const l = useLoad(() => get('/v1/platform/public-settings'), []);
  const { stepUp } = useAuth(); const act = useAction(); const toast = useToast();
  const [url, setUrl] = useState<string | null>(null);
  if (!l.data) return <Spinner />;
  const current: string = l.data.settings.landing_url ?? '';
  const value = url ?? current;
  return (
    <>
      <PageHeader title="Rodapé das lojas" subtitle="Todas as lojas mostram “Desenvolvido com muita fome” com a logo da Pediu Lanchou, ligada a este endereço." />
      <ErrorBox>{act.error ?? l.error}</ErrorBox>
      <div className="card max-w-xl space-y-3 p-4 text-sm">
        <Field label="Link da landing page" hint="Abre em outra aba quando o cliente toca na logo. Também vai no rodapé dos e-mails de código de acesso.">
          <input className="input" type="url" value={value} onChange={(e) => setUrl(e.target.value)} placeholder="https://pediulanchou.com.br" />
        </Field>
        <div className="flex items-center gap-3 rounded-ui-sm bg-muted/60 p-3">
          <span className="text-xs text-muted-foreground">Prévia</span>
          <span className="flex flex-col items-center gap-1 text-[11px] text-muted-foreground"><span>Desenvolvido com muita fome</span><span className="rounded-md bg-white px-2.5 py-1.5"><img src="/brand/logo-allblack.png" alt="Pediu Lanchou" className="h-5 w-auto" /></span></span>
        </div>
        <button className="btn" disabled={act.busy || !/^https?:\/\/\S+$/i.test(value) || value === current}
          onClick={() => act.run(async () => { await stepUp(() => put('/v1/platform/public-settings', { landingUrl: value.trim() })); toast('Link salvo'); setUrl(null); l.reload(); })}><Save size={14} /> Salvar</button>
      </div>
    </>
  );
}
