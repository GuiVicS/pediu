import { Navigate, Route, Routes } from 'react-router-dom';
import CheckoutPage from '@/store/checkout/CheckoutPage';
import { RequirePerm, SessionProvider, HOME, useSession } from '@/lib/session';
import Login from '@/pages/Login';
import StoreLayout from '@/store/StoreLayout';
import HomePage from '@/store/HomePage';
import CategoryPage from '@/store/CategoryPage';
import OrdersPage from '@/store/OrdersPage';
import AccountPage from '@/store/AccountPage';
import AboutPage from '@/store/AboutPage';
import AdminLayout from '@/admin/AdminLayout';
import Dashboard from '@/admin/Dashboard';
import OrdersAdmin from '@/admin/OrdersAdmin';
import ProductsAdmin from '@/admin/ProductsAdmin';
import CategoriesAdmin from '@/admin/CategoriesAdmin';
import AddonsAdmin from '@/admin/AddonsAdmin';
import FeaturedAdmin from '@/admin/FeaturedAdmin';
import BannersAdmin from '@/admin/BannersAdmin';
import ThemeEditor from '@/admin/ThemeEditor';
import IntegrationsAdmin from '@/admin/IntegrationsAdmin';
import PrintAdmin from '@/admin/PrintAdmin';
import StoreAdmin from '@/admin/StoreAdmin';
import UsersAdmin from '@/admin/UsersAdmin';
import CustomersAdmin from '@/admin/CustomersAdmin';
import WhatsappAdmin from '@/admin/WhatsappAdmin';
import CouponsAdmin from '@/admin/CouponsAdmin';
import IfoodAdmin from '@/admin/IfoodAdmin';
import DomainsAdmin from '@/admin/DomainsAdmin';
import PdvApp from '@/apps/PdvApp';
import WaiterApp from '@/apps/WaiterApp';
import CourierApp from '@/apps/CourierApp';
import TotemApp from '@/apps/TotemApp';

/** Quem já está logado e abre /painel sem permissão vai para a própria área. */
function PanelHome() { const { me } = useSession(); return me && HOME[me.role] !== '/painel' ? <Navigate to={HOME[me.role]} replace /> : <Dashboard />; }

export default function App() {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/entrar" element={<Login />} />
        {/* login dentro do escopo de cada PWA (o app instalado não "sai" para /entrar) */}
        {['painel', 'pdv', 'garcom', 'entregador'].map((a) => <Route key={a} path={`/${a}/entrar`} element={<Login />} />)}

        <Route path="/pdv" element={<RequirePerm perm="pdv"><PdvApp /></RequirePerm>} />
        <Route path="/garcom" element={<RequirePerm perm="garcom"><WaiterApp /></RequirePerm>} />
        <Route path="/entregador" element={<RequirePerm perm="motoboy"><CourierApp /></RequirePerm>} />
        {/* totem de mesa: o aparelho usa o próprio token (pareado no painel), sem login de funcionário */}
        <Route path="/totem" element={<TotemApp />} />

        <Route path="/painel" element={<RequirePerm perm="admin.dashboard"><AdminLayout /></RequirePerm>}>
          <Route index element={<PanelHome />} />
          <Route path="pedidos" element={<RequirePerm perm="admin.pedidos"><OrdersAdmin /></RequirePerm>} />
          <Route path="cupons" element={<RequirePerm perm="admin.loja"><CouponsAdmin /></RequirePerm>} />
          <Route path="whatsapp" element={<RequirePerm perm="admin.pedidos"><WhatsappAdmin /></RequirePerm>} />
          <Route path="clientes" element={<RequirePerm perm="admin.pedidos"><CustomersAdmin /></RequirePerm>} />
          <Route path="produtos" element={<RequirePerm perm="admin.cardapio"><ProductsAdmin /></RequirePerm>} />
          <Route path="categorias" element={<RequirePerm perm="admin.cardapio"><CategoriesAdmin /></RequirePerm>} />
          <Route path="adicionais" element={<RequirePerm perm="admin.cardapio"><AddonsAdmin /></RequirePerm>} />
          <Route path="destaques" element={<RequirePerm perm="admin.cardapio"><FeaturedAdmin /></RequirePerm>} />
          <Route path="banners" element={<RequirePerm perm="admin.loja"><BannersAdmin /></RequirePerm>} />
          <Route path="aparencia" element={<RequirePerm perm="admin.loja"><ThemeEditor /></RequirePerm>} />
          <Route path="integracoes" element={<RequirePerm perm="admin.loja"><IntegrationsAdmin /></RequirePerm>} />
          <Route path="pagamentos" element={<Navigate to="/painel/integracoes" replace />} />
          <Route path="impressao" element={<RequirePerm perm="admin.loja"><PrintAdmin /></RequirePerm>} />
          <Route path="loja" element={<RequirePerm perm="admin.loja"><StoreAdmin /></RequirePerm>} />
          <Route path="ifood" element={<RequirePerm perm="admin.loja"><IfoodAdmin /></RequirePerm>} />
          <Route path="dominios" element={<RequirePerm perm="admin.loja"><DomainsAdmin /></RequirePerm>} />
          <Route path="usuarios" element={<RequirePerm perm="admin.usuarios"><UsersAdmin /></RequirePerm>} />
        </Route>

        <Route element={<StoreLayout />}>
          <Route index element={<HomePage />} />
          <Route path="categoria/:id" element={<CategoryPage />} />
          <Route path="pedidos" element={<OrdersPage />} />
          <Route path="finalizar" element={<CheckoutPage />} />
          <Route path="conta" element={<AccountPage />} />
          <Route path="empresa" element={<AboutPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionProvider>
  );
}
