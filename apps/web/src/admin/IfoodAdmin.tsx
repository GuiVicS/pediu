import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Link2, Plus, Save, Trash2, Unlink } from 'lucide-react';
import { del, get, put } from '@/lib/api';
import type { Product } from '@/lib/types';
import { useCollection } from '@/lib/data';
import { Field } from '@/ui/kit';
import { ErrorBox, Spinner, useAction } from '@/ui/misc';
import { PageHeader, useToast } from './AdminUI';

interface State { link: { merchant_id: string; active: boolean; last_event_at: string | null; last_error: string | null } | null; map: { external_code: string; product_id: string; product_name: string }[]; platformConfigured: boolean }

export default function IfoodAdmin() {
  const [st, setSt] = useState<State | null>(null);
  const products = useCollection<Product>('products');
  const [merchant, setMerchant] = useState('');
  const [row, setRow] = useState({ code: '', productId: '' });
  const toast = useToast();
  const act = useAction();
  const load = useCallback(async () => setSt(await get<State>('/v1/staff/ifood')), []);
  useEffect(() => { void load(); }, [load]);
  if (!st) return <Spinner />;

  return (
    <>
      <PageHeader title="iFood" subtitle="Receba os pedidos do iFood no mesmo painel, com impressão por zonas e status sincronizado" />
      <ErrorBox>{act.error}</ErrorBox>
      {!st.platformConfigured && <div className="mb-4 rounded-ui-sm bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">A integração com o iFood ainda não foi habilitada pela plataforma (falta o cadastro do aplicativo de desenvolvedor). Você já pode preparar o vínculo e o mapeamento abaixo.</div>}

      <section className="card mb-5 space-y-3 p-4">
        <h2 className="flex items-center gap-2 font-semibold"><Link2 size={16} /> Vínculo com a sua loja no iFood</h2>
        {st.link ? (
          <div className="text-sm">
            <div className="flex items-center gap-2"><span className="badge bg-green-100 text-green-700"><CheckCircle2 size={11} className="mr-1" />vinculada</span><code>{st.link.merchant_id}</code>
              <button className="btn-danger ml-auto !px-2.5 !py-1 text-xs" onClick={() => confirm('Desvincular a loja do iFood? Pedidos novos deixam de chegar.') && act.run(async () => { await del('/v1/staff/ifood/link'); await load(); })}><Unlink size={13} /> Desvincular</button></div>
            <p className="mt-1 text-xs text-muted-foreground">{st.link.last_event_at ? `Último evento: ${new Date(st.link.last_event_at).toLocaleString('pt-BR')}` : 'Nenhum evento recebido ainda.'}{st.link.last_error ? ` · Erro: ${st.link.last_error}` : ''}</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[260px] flex-1"><Field label="ID da loja no iFood (Merchant ID)" hint="No Portal do Parceiro do iFood: Minha loja → Dados da loja."><input className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)} /></Field></div>
            <button className="btn" disabled={merchant.trim().length < 8 || act.busy} onClick={() => act.run(async () => { await put('/v1/staff/ifood/link', { merchantId: merchant.trim() }); toast('Loja vinculada'); await load(); })}><Save size={14} /> Vincular</button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Os pedidos chegam por consulta a cada 30 s. Aceitar, ficar pronto, sair para entrega e cancelar aqui também atualiza o iFood.</p>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Mapeamento de itens</h2>
        <p className="text-xs text-muted-foreground">Ligue o <b>código externo</b> de cada item do iFood a um produto seu. É isso que faz o item sair na <b>zona de impressão certa</b> (cozinha, bar…). Item sem mapeamento é impresso na zona padrão e avisa no log.</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-48"><Field label="Código externo (iFood)"><input className="input" value={row.code} onChange={(e) => setRow({ ...row, code: e.target.value })} /></Field></div>
          <div className="min-w-[220px] flex-1"><Field label="Produto"><select className="input" value={row.productId} onChange={(e) => setRow({ ...row, productId: e.target.value })}><option value="">— escolha —</option>{[...products.items].sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field></div>
          <button className="btn" disabled={!row.code.trim() || !row.productId || act.busy} onClick={() => act.run(async () => { await put('/v1/staff/ifood/map', { items: [{ externalCode: row.code.trim(), productId: row.productId }] }); setRow({ code: '', productId: '' }); await load(); })}><Plus size={14} /> Adicionar</button>
        </div>
        <div className="divide-y divide-border">
          {st.map.length === 0 && <p className="py-2 text-sm text-muted-foreground">Nenhum item mapeado.</p>}
          {st.map.map((m) => (
            <div key={m.external_code} className="flex items-center gap-3 py-2 text-sm"><code className="rounded bg-muted px-1.5">{m.external_code}</code><span className="flex-1">→ {m.product_name}</span>
              <button className="btn-danger !p-1.5" aria-label="Remover" onClick={() => act.run(async () => { await del(`/v1/staff/ifood/map/${encodeURIComponent(m.external_code)}`); await load(); })}><Trash2 size={13} /></button></div>
          ))}
        </div>
      </section>
    </>
  );
}
