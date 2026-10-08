import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { get, post } from './api';

/** Cliente da loja (login com e-mail e senha; o código por e-mail serve para "esqueci a senha"). A sessão fica no cookie. */
export interface Customer { id: string; email: string; name: string; phone: string; hasPassword?: boolean; via?: 'code' | 'password' }
interface Ctx { customer: Customer | null; ready: boolean; setCustomer: (c: Customer | null) => void; logout: () => Promise<void> }
const CustomerCtx = createContext<Ctx | null>(null);

export function CustomerProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    // sem login a API responde 200 com customer null; qualquer erro (rede, loja fora do ar) só deixa o visitante como anônimo
    get<{ customer: Customer | null }>(`/v1/store/${slug}/customer/me`).then((r) => alive && setCustomer(r.customer)).catch(() => undefined).finally(() => alive && setReady(true));
    return () => { alive = false; };
  }, [slug]);
  const logout = useCallback(async () => { try { await post(`/v1/store/${slug}/customer/logout`); } finally { setCustomer(null); } }, [slug]);
  const value = useMemo(() => ({ customer, ready, setCustomer, logout }), [customer, ready, logout]);
  return <CustomerCtx.Provider value={value}>{children}</CustomerCtx.Provider>;
}

export const useCustomer = () => {
  const c = useContext(CustomerCtx);
  if (!c) throw new Error('CustomerProvider ausente');
  return c;
};
