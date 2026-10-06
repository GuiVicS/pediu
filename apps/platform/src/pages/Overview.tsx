import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { brl, dt, get } from '@/lib/api';
import { Delta, PageHeader, SEVERITY, Stat, STORE_STATUS_LABEL, useLoad } from '@/ui/bits';
import { Spinner, ErrorBox } from '@/ui/misc';

export default function Overview() {
  const ov = useLoad(() => get('/v1/platform/analytics/overview?days=1'), [], 30_000);
  const health = useLoad(() => get('/v1/platform/health?minutes=60'), [], 30_000);
  const alerts = useLoad(() => get('/v1/platform/alerts?status=active&limit=6'), [], 30_000);
  if (ov.error) return <ErrorBox>{ov.error}</ErrorBox>;
  if (!ov.data || !health.data) return <Spinner />;
  const o = ov.data, h = health.data;
  return (
    <>
      <PageHeader title="Painel" subtitle="Resumo da plataforma nas últimas 24 horas" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pedidos (24 h)" value={o.orders} sub={<>vs. dia anterior <Delta v={o.change.orders} /></>} />
        <Stat label="Faturamento (24 h)" value={brl(o.revenueCents)} sub={<>vs. dia anterior <Delta v={o.change.revenue} /></>} />
        <Stat label="MRR" value={brl(o.subscriptions.mrrCents)} sub={`${o.subscriptions.active} ativas · ${o.subscriptions.trialing} em teste`} />
        <Stat label="Em atraso" value={o.subscriptions.pastDue} tone={o.subscriptions.pastDue ? 'warn' : 'ok'} sub="assinaturas" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Lojas no ar" value={o.stores.producao ?? 0} sub={`${o.stores.desenvolvimento ?? 0} em desenvolvimento · ${o.stores.suspensa ?? 0} suspensas`} />
        <Stat label="Lojas que venderam" value={o.storesWithOrders} sub="nas últimas 24 h" />
        <Stat label="Erros 5xx (1 h)" value={`${(h.errorRate * 100).toFixed(2)}%`} tone={h.errorRate > 0.02 ? 'bad' : 'ok'} sub={`${h.requests} requisições · p95 ${h.p95Ms ?? '—'} ms`} />
        <Stat label="Publicações pendentes" value={o.pendingPublications} tone={o.pendingPublications ? 'warn' : undefined} sub={<Link className="text-primary" to="/publicacoes">ver pedidos</Link>} />
      </div>
      <section className="card mt-5 p-4">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Alertas abertos</h2><Link className="text-sm text-primary" to="/alertas">ver todos</Link></div>
        {alerts.data?.alerts.length === 0 && <p className="flex items-center gap-2 text-sm text-green-600"><CheckCircle2 size={16} /> Tudo certo: nenhum alerta aberto.</p>}
        <div className="divide-y divide-border">{alerts.data?.alerts.map((a: any) => (
          <div key={a.id} className="flex items-center gap-3 py-2 text-sm"><span className={`badge ${SEVERITY[a.severity]}`}><AlertTriangle size={11} className="mr-1" />{a.severity}</span><span className="flex-1">{a.title}</span><span className="text-xs text-muted-foreground">{dt(a.last_seen)}</span></div>
        ))}</div>
        <p className="mt-3 text-xs text-muted-foreground">Lojas: {Object.entries(o.stores).map(([k, v]) => `${STORE_STATUS_LABEL[k] ?? k}: ${v}`).join(' · ')}</p>
      </section>
    </>
  );
}
