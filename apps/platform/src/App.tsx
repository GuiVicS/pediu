import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/auth';
import Layout from './Layout';
import Login from '@/pages/Login';
import Overview from '@/pages/Overview';
import { StoresList, StoreDetail } from '@/pages/Stores';
import { Alerts, Audit, Health, Logs, Performance, Publications } from '@/pages/Monitoring';
import { Banners } from '@/pages/Banners';
import { AiSettings, IfoodPlatform, MailSettings, McpTokens, Releases, StoreFooter, Subscriptions } from '@/pages/Business';

function Gate() {
  const { me, ready } = useAuth();
  if (!ready) return <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>;
  if (!me || !me.totpVerified) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="lojas" element={<StoresList />} /><Route path="lojas/:id" element={<StoreDetail />} />
        <Route path="publicacoes" element={<Publications />} /><Route path="desempenho" element={<Performance />} />
        <Route path="alertas" element={<Alerts />} /><Route path="saude" element={<Health />} /><Route path="logs" element={<Logs />} /><Route path="auditoria" element={<Audit />} />
        <Route path="assinaturas" element={<Subscriptions />} /><Route path="versoes" element={<Releases />} /><Route path="ifood" element={<IfoodPlatform />} /><Route path="rodape" element={<StoreFooter />} /><Route path="ia" element={<AiSettings />} /><Route path="email" element={<MailSettings />} /><Route path="banners" element={<Banners />} /><Route path="mcp" element={<McpTokens />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
export default function App() { return <AuthProvider><Gate /></AuthProvider>; }
