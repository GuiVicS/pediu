import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CreditCard, KeyRound, Pencil, Plus, QrCode, Save, Trash2, X } from 'lucide-react';
import type { PaymentMethod } from '@/lib/types';
import { del, get, put, post } from '@/lib/api';
import { byOrder, useCollection } from '@/lib/data';
import { Field, Modal, Toggle } from '@/ui/kit';
import { ErrorBox, useAction } from '@/ui/misc';
import { PageHeader, useToast } from './AdminUI';

type Draft = Omit<PaymentMethod, 'id'> & { id?: string };
interface Gateway { provider: 'mercadopago' | 'sicoob'; status: string; meta: Record<string, unknown>; updated_at: string }
const TYPES: Record<PaymentMethod['type'], string> = { pix: 'Pix', cash: 'Dinheiro', credit: 'Crédito', debit: 'Débito', voucher: 'Vale-refeição' };
const GW: Record<string, string> = { mercadopago: 'Mercado Pago', sicoob: 'Sicoob' };

export default function PaymentsAdmin() {
  const pays = useCollection<PaymentMethod>('payments');
  const toast = useToast();
  const act = useAction();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [gws, setGws] = useState<Gateway[]>([]);
  const [cfg, setCfg] = useState<'mercadopago' | 'sicoob' | null>(null);
  const [mp, setMp] = useState({ accessToken: '', webhookSecret: '' });
  const [sb, setSb] = useState({ clientId: '', clientSecret: '', pixKey: '', pfxB64: '', pfxPass: '' });
  const loadGw = useCallback(async () => setGws((await get<{ gateways: Gateway[] }>('/v1/staff/gateways')).gateways), []);
  useEffect(() => { void loadGw(); }, [loadGw]);
  const sorted = [...pays.items].sort(byOrder);
  const has = (p: string) => gws.some((g) => g.provider === p && g.status === 'ativo');
  const readCert = (f: File) => { const r = new FileReader(); r.onload = () => setSb((s) => ({ ...s, pfxB64: String(r.result).split(',')[1] ?? '' })); r.readAsDataURL(f); };

  return (
    <>
      <PageHeader title="Formas de pagamento" subtitle="Opções do checkout e a cobrança online (Pix e cartão) direto na sua conta" actions={
        <button className="btn" onClick={() => setDraft({ name: '', type: 'pix', note: '', order: sorted.length + 1, active: true, online: false, gateway: null })}><Plus size={16} /> Nova forma</button>
      } />
      <ErrorBox>{act.error ?? pays.error}</ErrorBox>

      <section className="card mb-5 p-4">
        <h2 className="mb-1 flex items-center gap-2 font-semibold"><KeyRound size={16} /> Cobrança online</h2>
        <p className="mb-3 text-xs text-muted-foreground">O dinheiro cai <b>direto na sua conta</b> do Mercado Pago ou do Sicoob; a plataforma não passa por ele. As credenciais ficam criptografadas e nunca voltam para a tela.</p>
        <div className="grid gap-3 md:grid-cols-2">
          {(['mercadopago', 'sicoob'] as const).map((p) => {
            const g = gws.find((x) => x.provider === p);
            return (
              <div key={p} className="rounded-ui-sm border border-border p-3 text-sm">
                <div className="flex items-center gap-2"><b className="flex-1">{GW[p]}</b>{g ? <span className="badge bg-green-100 text-green-700"><CheckCircle2 size={11} className="mr-1" />conectado</span> : <span className="badge bg-muted text-muted-foreground">não configurado</span>}</div>
                <div className="mt-1 text-xs text-muted-foreground">{p === 'mercadopago' ? 'Pix e cartão de crédito (Checkout Pro).' : 'Pix com conta Sicoob (exige certificado digital A1 e o app no Portal Developers).'}{g?.meta && (g.meta.account || g.meta.pixKey) ? ` Conta: ${g.meta.account ?? g.meta.pixKey}` : ''}</div>
                <div className="mt-2 flex gap-2">
                  <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setCfg(p)}>{g ? 'Atualizar credenciais' : 'Conectar'}</button>
                  {g && p === 'sicoob' && <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => act.run(async () => { await post('/v1/staff/gateways/sicoob/webhook'); toast('Webhook do Sicoob registrado'); })}>Registrar webhook</button>}
                  {g && <button className="btn-danger !px-2.5 !py-1 text-xs" onClick={() => confirm(`Desconectar o ${GW[p]}? As formas de pagamento online dele serão desligadas.`) && act.run(async () => { await del(`/v1/staff/gateways/${p}`); await loadGw(); await pays.reload(); })}>Desconectar</button>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="space-y-2">
        {sorted.map((p) => (
          <div key={p.id} className="card flex items-center gap-3 p-3">
            <div className="flex-1"><div className="font-medium">{p.name} <span className="badge bg-muted text-muted-foreground">{TYPES[p.type]}</span>{p.online && <span className="ml-1 badge bg-blue-100 text-blue-700"><QrCode size={10} className="mr-1" />online · {GW[p.gateway ?? '']}{p.gateway && !has(p.gateway) ? ' (gateway desconectado)' : ''}</span>}</div><div className="text-xs text-muted-foreground">{p.note}</div></div>
            <Toggle checked={p.active} onChange={(v) => act.run(() => pays.save({ ...p, active: v }))} />
            <button className="btn-ghost !px-2" onClick={() => setDraft({ ...p })}><Pencil size={14} /></button>
            <button className="btn-danger !px-2" onClick={async () => { if (confirm(`Excluir "${p.name}"?`)) { await pays.remove(p.id); toast('Forma excluída'); } }}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Editar forma de pagamento' : 'Nova forma de pagamento'}
        footer={<><button className="btn-ghost" onClick={() => setDraft(null)}><X size={14} /> Cancelar</button><button className="btn" disabled={!draft?.name.trim() || act.busy} onClick={() => act.run(async () => { await pays.save(draft!); toast('Forma salva'); setDraft(null); })}><Save size={14} /> Salvar</button></>}>
        {draft && (
          <div className="space-y-4">
            <ErrorBox>{act.error}</ErrorBox>
            <Field label="Nome"><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="Tipo"><select className="input" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as PaymentMethod['type'], online: false, gateway: null })}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            {(draft.type === 'pix' || draft.type === 'credit') && (
              <div className="rounded-ui-sm border border-border p-3">
                <Toggle checked={draft.online} onChange={(v) => setDraft({ ...draft, online: v, gateway: v ? (draft.type === 'credit' ? 'mercadopago' : has('mercadopago') ? 'mercadopago' : 'sicoob') : null })} label="Cobrar online (o pedido só vai para a cozinha depois de pago)" />
                {draft.online && (
                  <div className="mt-3"><Field label="Gateway">
                    <select className="input" value={draft.gateway ?? ''} onChange={(e) => setDraft({ ...draft, gateway: e.target.value as 'mercadopago' | 'sicoob' })}>
                      <option value="mercadopago">Mercado Pago{has('mercadopago') ? '' : ' (não conectado)'}</option>{draft.type === 'pix' && <option value="sicoob">Sicoob{has('sicoob') ? '' : ' (não conectado)'}</option>}
                    </select></Field>
                    {draft.gateway && !has(draft.gateway) && <p className="mt-2 text-xs text-amber-600">Conecte o {GW[draft.gateway]} acima, senão o checkout mostrará "pagamento online indisponível".</p>}</div>
                )}
              </div>
            )}
            <Field label="Observação para o cliente"><input className="input" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></Field>
            <Toggle checked={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} label="Ativa" />
          </div>
        )}
      </Modal>

      <Modal open={cfg === 'mercadopago'} onClose={() => setCfg(null)} title="Conectar Mercado Pago"
        footer={<><button className="btn-ghost" onClick={() => setCfg(null)}>Cancelar</button><button className="btn" disabled={!mp.accessToken || act.busy} onClick={() => act.run(async () => { const r = await put<{ account: string }>('/v1/staff/gateways/mercadopago', { accessToken: mp.accessToken.trim(), webhookSecret: mp.webhookSecret.trim() || undefined }); toast(`Conectado: ${r.account}`); setMp({ accessToken: '', webhookSecret: '' }); setCfg(null); await loadGw(); })}><Save size={14} /> Validar e salvar</button></>}>
        <div className="space-y-3 text-sm">
          <ErrorBox>{act.error}</ErrorBox>
          <p className="text-xs text-muted-foreground">No painel do Mercado Pago: <b>Seu negócio → Configurações → Credenciais</b>. Use o <b>Access Token de produção</b> (começa com <code>APP_USR-</code>) — para testar, o de teste (<code>TEST-</code>).</p>
          <Field label="Access Token"><input className="input" type="password" autoComplete="off" value={mp.accessToken} onChange={(e) => setMp({ ...mp, accessToken: e.target.value })} /></Field>
          <Field label="Assinatura secreta do webhook (recomendado)" hint={`Em Webhooks, cadastre ${location.origin}/v1/webhooks/mercadopago?store=SEU_ID_DA_LOJA com o evento "Pagamentos" e cole aqui a chave secreta.`}><input className="input" type="password" autoComplete="off" value={mp.webhookSecret} onChange={(e) => setMp({ ...mp, webhookSecret: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal open={cfg === 'sicoob'} onClose={() => setCfg(null)} wide title="Conectar Sicoob (Pix)"
        footer={<><button className="btn-ghost" onClick={() => setCfg(null)}>Cancelar</button><button className="btn" disabled={!sb.clientId || !sb.pixKey || !sb.pfxB64 || act.busy} onClick={() => act.run(async () => { await put('/v1/staff/gateways/sicoob', { clientId: sb.clientId.trim(), clientSecret: sb.clientSecret.trim() || undefined, pixKey: sb.pixKey.trim(), pfxB64: sb.pfxB64, pfxPass: sb.pfxPass || undefined }); toast('Sicoob conectado'); setSb({ clientId: '', clientSecret: '', pixKey: '', pfxB64: '', pfxPass: '' }); setCfg(null); await loadGw(); })}><Save size={14} /> Validar e salvar</button></>}>
        <div className="space-y-3 text-sm">
          <ErrorBox>{act.error}</ErrorBox>
          <p className="text-xs text-muted-foreground">Precisa de: conta PJ no Sicoob, aplicativo criado no Portal Developers (APIs Pix) e o certificado digital <b>A1 (.pfx)</b>. O sistema testa a autenticação antes de salvar.</p>
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
      <span className="hidden"><CreditCard /></span>
    </>
  );
}
