import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, Download, Settings2, ShieldCheck, Trash2 } from 'lucide-react';
import type { IntegrationApp } from '@pediu/shared/browser';
import { del, get, post, put } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Field, Modal, Toggle } from '@/ui/kit';
import { ErrorBox, Spinner, useAction } from '@/ui/misc';
import { PageHeader, useToast } from './AdminUI';
import { IfoodLogo, MaquininhaLogo, MercadoPagoLogo, NfceLogo, PediuPayLogo, SicoobLogo, WhatsappLogo } from './integrations/logos';

interface AppState { id: IntegrationApp; installed: boolean; installedAt: string | null; account?: Record<string, any> | null; methods?: { pix: boolean; card?: boolean }; cardReady?: boolean; webhookUrl?: string | null }
type Logo = (p: { size?: number }) => JSX.Element;
interface CatalogItem { id: string; name: string; tagline: string; category: 'Pagamentos' | 'Vendas' | 'Atendimento' | 'Fiscal'; Logo: Logo; soon?: boolean; configPath?: string }

/** Catálogo do hub: os instaláveis vêm do servidor (@pediu/shared INTEGRATION_APPS); os "Em breve" só aparecem aqui. */
const CATALOG: CatalogItem[] = [
  { id: 'mercadopago', name: 'Mercado Pago', tagline: 'Pix e cartão de crédito com checkout transparente: o cliente paga sem sair da sua loja.', category: 'Pagamentos', Logo: MercadoPagoLogo },
  { id: 'sicoob', name: 'Sicoob Pix', tagline: 'Pix direto na sua conta PJ Sicoob, com confirmação automática.', category: 'Pagamentos', Logo: SicoobLogo },
  { id: 'ifood', name: 'iFood', tagline: 'Receba os pedidos do iFood no mesmo painel, cozinha e impressão.', category: 'Vendas', Logo: IfoodLogo, configPath: '/painel/ifood' },
  { id: 'whatsapp', name: 'WhatsApp e IA', tagline: 'Atendimento pelo WhatsApp com respostas rápidas, agente de IA e disparos.', category: 'Atendimento', Logo: WhatsappLogo, configPath: '/painel/whatsapp' },
  { id: 'pediupay', name: 'PediuPay', tagline: 'A conta de pagamentos da PediuLanchou: Pix e cartão sem configurar nada, com repasse automático.', category: 'Pagamentos', Logo: PediuPayLogo, soon: true },
  { id: 'nfce', name: 'Nota Fiscal (NFC-e)', tagline: 'Emissão automática da nota do consumidor a cada pedido.', category: 'Fiscal', Logo: NfceLogo, soon: true },
  { id: 'maquininha', name: 'Maquininha integrada', tagline: 'O valor vai do PDV direto para a maquininha, sem digitar.', category: 'Pagamentos', Logo: MaquininhaLogo, soon: true },
];

export default function IntegrationsAdmin() {
  const { can } = useSession();
  const toast = useToast(); const act = useAction();
  const [apps, setApps] = useState<AppState[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => setApps((await get<{ apps: AppState[] }>('/v1/staff/apps')).apps), []);
  useEffect(() => { void load(); }, [load]);
  // o menu lateral escuta este evento para mostrar/esconder iFood e WhatsApp
  const changed = async () => { await load(); window.dispatchEvent(new Event('pediu:apps-changed')); };
  if (!apps) return <Spinner />;
  const st = (id: string) => apps.find((a) => a.id === id);
  const manage = can('admin.loja');

  const install = (c: CatalogItem) => act.run(async () => {
    if (c.id === 'mercadopago' || c.id === 'sicoob') { setOpen(c.id); return; }   // pagamento: instalar = conectar a conta
    await post(`/v1/staff/apps/${c.id}/install`); await changed(); toast(`${c.name} instalado`);
  });
  const uninstall = (c: CatalogItem) => confirm(c.id === 'mercadopago' || c.id === 'sicoob'
    ? `Desinstalar ${c.name}? As credenciais serão apagadas e o Pix/cartão online dele sai do checkout.`
    : `Desinstalar ${c.name}? ${c.id === 'ifood' ? 'A loja para de receber pedidos do iFood.' : 'O item some do menu (os dados ficam guardados).'}`)
    && act.run(async () => { await del(`/v1/staff/apps/${c.id}`); setOpen(null); await changed(); toast(`${c.name} desinstalado`); });

  const groups = ['Pagamentos', 'Vendas', 'Atendimento', 'Fiscal'] as const;
  return (
    <>
      <PageHeader title="Integrações" subtitle="Instale os apps que a sua loja usa. Só o que estiver instalado aparece no menu e no checkout." />
      <ErrorBox>{act.error}</ErrorBox>
      {groups.map((g) => {
        const items = CATALOG.filter((c) => c.category === g); if (!items.length) return null;
        return (
          <section key={g} className="mb-6">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{g}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((c) => {
                const s = st(c.id); const installed = !!s?.installed;
                return (
                  <div key={c.id} className={`card flex flex-col p-4 ${c.soon ? 'opacity-80' : ''}`}>
                    <div className="flex items-start gap-3">
                      <c.Logo size={52} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5"><b>{c.name}</b>
                          {c.soon ? <span className="badge bg-amber-100 text-amber-700"><Clock size={11} className="mr-1" />Em breve</span>
                            : installed ? <span className="badge bg-green-100 text-green-700"><CheckCircle2 size={11} className="mr-1" />Instalado</span> : null}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{c.tagline}</p>
                        {installed && s?.account?.account && <p className="mt-1 text-xs">Conta: <b>{s.account.account}</b>{s.account.test ? ' · modo teste' : ''}</p>}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 pt-1">
                      {c.soon ? <button className="btn-ghost !px-2.5 !py-1 text-xs" disabled>Em breve</button>
                        : !manage ? null
                        : installed ? <>
                            {c.configPath ? <Link to={c.configPath} className="btn !px-2.5 !py-1 text-xs"><Settings2 size={13} /> Abrir</Link>
                              : <button className="btn !px-2.5 !py-1 text-xs" onClick={() => setOpen(c.id)}><Settings2 size={13} /> Configurar</button>}
                            <button className="btn-danger !px-2.5 !py-1 text-xs" onClick={() => uninstall(c)}><Trash2 size={13} /> Desinstalar</button></>
                        : <button className="btn !px-2.5 !py-1 text-xs" disabled={act.busy} onClick={() => install(c)}><Download size={13} /> Instalar</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      <MercadoPagoModal open={open === 'mercadopago'} state={st('mercadopago')} onClose={() => setOpen(null)} onSaved={changed} />
      <SicoobModal open={open === 'sicoob'} state={st('sicoob')} onClose={() => setOpen(null)} onSaved={changed} />
    </>
  );
}

/** Liga/desliga Pix e cartão online do app (cria a forma de pagamento no checkout quando liga). */
function MethodToggles({ app, state, onSaved }: { app: 'mercadopago' | 'sicoob'; state?: AppState; onSaved: () => Promise<void> }) {
  const act = useAction(); const toast = useToast();
  if (!state?.installed) return null;
  const set = (k: 'pix' | 'card', v: boolean) => act.run(async () => { await put(`/v1/staff/apps/${app}/methods`, { [k]: v }); await onSaved(); toast(v ? 'Ativado no checkout' : 'Removido do checkout'); });
  return (
    <div className="space-y-2 rounded-ui-sm border border-border p-3">
      <p className="text-sm font-semibold">No checkout da loja</p>
      <ErrorBox>{act.error}</ErrorBox>
      <Toggle checked={!!state.methods?.pix} onChange={(v) => set('pix', v)} label="Pix online (QR Code e copia-e-cola, aprovação automática)" />
      {app === 'mercadopago' && <Toggle checked={!!state.methods?.card} onChange={(v) => set('card', v)} label="Cartão de crédito (checkout transparente, sem sair da loja)" />}
      {app === 'mercadopago' && !state.cardReady && <p className="text-xs text-amber-600">Para o cartão, informe a Public Key abaixo.</p>}
      <p className="text-xs text-muted-foreground">Ajuste nomes e textos em Loja e entrega → Formas de pagamento.</p>
    </div>
  );
}

function MercadoPagoModal({ open, state, onClose, onSaved }: { open: boolean; state?: AppState; onClose: () => void; onSaved: () => Promise<void> }) {
  const act = useAction(); const toast = useToast();
  const [f, setF] = useState({ accessToken: '', publicKey: '', webhookSecret: '' });
  useEffect(() => { if (open) setF({ accessToken: '', publicKey: state?.account?.publicKey ?? '', webhookSecret: '' }); }, [open, state?.account?.publicKey]);
  const save = () => act.run(async () => {
    const r = await put<{ account: string }>('/v1/staff/gateways/mercadopago', { accessToken: f.accessToken.trim(), publicKey: f.publicKey.trim() || undefined, webhookSecret: f.webhookSecret.trim() || undefined });
    toast(`Mercado Pago conectado: ${r.account}`); setF((x) => ({ ...x, accessToken: '', webhookSecret: '' })); await onSaved();
  });
  return (
    <Modal open={open} onClose={onClose} wide title={state?.installed ? 'Mercado Pago' : 'Instalar Mercado Pago'}
      footer={<><button className="btn-ghost" onClick={onClose}>Fechar</button><button className="btn" disabled={!f.accessToken || act.busy} onClick={save}><ShieldCheck size={14} /> {state?.installed ? 'Atualizar credenciais' : 'Validar e instalar'}</button></>}>
      <div className="space-y-4 text-sm">
        <ErrorBox>{act.error}</ErrorBox>
        <div className="flex items-center gap-3"><MercadoPagoLogo size={44} /><p className="text-xs text-muted-foreground">O dinheiro cai <b>direto na sua conta</b> do Mercado Pago. O cliente paga Pix ou cartão <b>dentro da sua loja</b> (checkout transparente): os dados do cartão vão do navegador direto para o Mercado Pago e nunca passam pelo nosso servidor.</p></div>
        <MethodToggles app="mercadopago" state={state} onSaved={onSaved} />
        <p className="text-xs text-muted-foreground">No Mercado Pago: <b>Seu negócio → Configurações → Credenciais</b> (ou Mercado Pago Developers → Suas integrações). Use as credenciais <b>de produção</b> (<code>APP_USR-</code>); para testar, as de teste (<code>TEST-</code>). As duas chaves precisam ser do mesmo ambiente.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`Access Token${state?.installed ? ' (para atualizar)' : ''}`}><input className="input" type="password" autoComplete="off" value={f.accessToken} onChange={(e) => setF({ ...f, accessToken: e.target.value })} /></Field>
          <Field label="Public Key (necessária para cartão)"><input className="input" autoComplete="off" value={f.publicKey} onChange={(e) => setF({ ...f, publicKey: e.target.value })} placeholder="APP_USR-…" /></Field>
        </div>
        {state?.webhookUrl && <div className="rounded-ui-sm bg-muted p-2.5 text-xs"><p className="mb-1">Em <b>Webhooks</b> no Mercado Pago, cadastre este endereço com o evento <b>Pagamentos</b>:</p><code className="block break-all">{state.webhookUrl}</code></div>}
        <Field label="Assinatura secreta do webhook (recomendado)" hint="A chave secreta que o Mercado Pago mostra ao salvar o webhook. Sem webhook, a confirmação chega pela conferência automática (a cada 30 s).">
          <input className="input" type="password" autoComplete="off" value={f.webhookSecret} onChange={(e) => setF({ ...f, webhookSecret: e.target.value })} /></Field>
        <p className="text-xs text-muted-foreground">O token é conferido no Mercado Pago antes de salvar e fica criptografado; ele nunca volta para a tela.</p>
      </div>
    </Modal>
  );
}

function SicoobModal({ open, state, onClose, onSaved }: { open: boolean; state?: AppState; onClose: () => void; onSaved: () => Promise<void> }) {
  const act = useAction(); const toast = useToast();
  const [sb, setSb] = useState({ clientId: '', clientSecret: '', pixKey: '', pfxB64: '', pfxPass: '' });
  const readCert = (file: File) => { const r = new FileReader(); r.onload = () => setSb((s) => ({ ...s, pfxB64: String(r.result).split(',')[1] ?? '' })); r.readAsDataURL(file); };
  const save = () => act.run(async () => {
    await put('/v1/staff/gateways/sicoob', { clientId: sb.clientId.trim(), clientSecret: sb.clientSecret.trim() || undefined, pixKey: sb.pixKey.trim(), pfxB64: sb.pfxB64, pfxPass: sb.pfxPass || undefined });
    toast('Sicoob conectado'); setSb({ clientId: '', clientSecret: '', pixKey: '', pfxB64: '', pfxPass: '' }); await onSaved();
  });
  return (
    <Modal open={open} onClose={onClose} wide title={state?.installed ? 'Sicoob Pix' : 'Instalar Sicoob Pix'}
      footer={<><button className="btn-ghost" onClick={onClose}>Fechar</button>
        {state?.installed && <button className="btn-ghost" disabled={act.busy} onClick={() => act.run(async () => { await post('/v1/staff/gateways/sicoob/webhook'); toast('Webhook do Sicoob registrado'); })}>Registrar webhook</button>}
        <button className="btn" disabled={!sb.clientId || !sb.pixKey || !sb.pfxB64 || act.busy} onClick={save}><ShieldCheck size={14} /> {state?.installed ? 'Atualizar credenciais' : 'Validar e instalar'}</button></>}>
      <div className="space-y-3 text-sm">
        <ErrorBox>{act.error}</ErrorBox>
        <div className="flex items-center gap-3"><SicoobLogo size={44} /><p className="text-xs text-muted-foreground">Precisa de: conta PJ no Sicoob, aplicativo criado no Portal Developers (APIs Pix) e o certificado digital <b>A1 (.pfx)</b>. O sistema testa a autenticação antes de salvar.</p></div>
        <MethodToggles app="sicoob" state={state} onSaved={onSaved} />
        {state?.installed && state.account?.pixKey && <p className="text-xs">Chave Pix atual: <b>{state.account.pixKey}</b>. Preencha abaixo só para trocar as credenciais.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Client ID"><input className="input" value={sb.clientId} onChange={(e) => setSb({ ...sb, clientId: e.target.value })} /></Field>
          <Field label="Client Secret (se houver)"><input className="input" type="password" autoComplete="off" value={sb.clientSecret} onChange={(e) => setSb({ ...sb, clientSecret: e.target.value })} /></Field>
        </div>
        <Field label="Chave Pix que recebe"><input className="input" value={sb.pixKey} onChange={(e) => setSb({ ...sb, pixKey: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Certificado A1 (.pfx)" hint={sb.pfxB64 ? 'Arquivo carregado ✓' : undefined}><input className="input" type="file" accept=".pfx,.p12" onChange={(e) => e.target.files?.[0] && readCert(e.target.files[0])} /></Field>
          <Field label="Senha do certificado"><input className="input" type="password" autoComplete="off" value={sb.pfxPass} onChange={(e) => setSb({ ...sb, pfxPass: e.target.value })} /></Field>
        </div>
      </div>
    </Modal>
  );
}
