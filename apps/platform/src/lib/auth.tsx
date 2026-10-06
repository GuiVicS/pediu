import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { ApiError, get, post } from './api';
import { Modal } from '@/ui/kit';

export interface Me { email: string; name: string; totpEnabled: boolean; totpVerified: boolean; stepUpUntil: string | null }
interface Ctx { me: Me | null; ready: boolean; refresh: () => Promise<void>; logout: () => Promise<void>; stepUp: <T>(fn: () => Promise<T>) => Promise<T> }
const AuthCtx = createContext<Ctx | null>(null);
export const useAuth = () => { const c = useContext(AuthCtx); if (!c) throw new Error('AuthProvider ausente'); return c; };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [asking, setAsking] = useState(false);
  const waiter = useRef<{ ok: () => void; no: (e: Error) => void } | null>(null);
  const refresh = useCallback(async () => { try { setMe(await get<Me>('/v1/platform/auth/me')); } catch { setMe(null); } finally { setReady(true); } }, []);
  useEffect(() => { void refresh(); const off = () => setMe(null); window.addEventListener('pediu:unauthenticated', off); return () => window.removeEventListener('pediu:unauthenticated', off); }, [refresh]);

  /** Executa `fn`; se a API pedir a confirmação extra, mostra o pedido do código e tenta de novo. */
  const stepUp = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); } catch (e) {
      if (!(e instanceof ApiError) || e.code !== 'stepup_required') throw e;
      await new Promise<void>((ok, no) => { waiter.current = { ok, no }; setAsking(true); });
      return fn();
    }
  }, []);
  const value = useMemo<Ctx>(() => ({ me, ready, refresh, stepUp, logout: async () => { try { await post('/v1/platform/auth/logout'); } finally { setMe(null); } } }), [me, ready, refresh, stepUp]);
  return (
    <AuthCtx.Provider value={value}>
      {children}
      {asking && <StepUpModal onDone={() => { setAsking(false); waiter.current?.ok(); }} onCancel={() => { setAsking(false); waiter.current?.no(new ApiError(0, 'cancelled', 'Confirmação cancelada.')); }} />}
    </AuthCtx.Provider>
  );
}

function StepUpModal({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [code, setCode] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const send = async () => { setBusy(true); setErr(null); try { await post('/v1/platform/auth/stepup', { code }); onDone(); } catch (e) { setErr((e as Error).message); setCode(''); } finally { setBusy(false); } };
  return (
    <Modal open onClose={onCancel} title="Confirme com o autenticador"
      footer={<><button className="btn-ghost" onClick={onCancel}>Cancelar</button><button className="btn" disabled={code.length !== 6 || busy} onClick={send}>{busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Confirmar</button></>}>
      <div className="space-y-3 text-sm">
        <p>Esta ação é sensível. Digite o código de 6 dígitos do seu app autenticador.</p>
        {err && <div className="rounded-ui-sm bg-destructive/10 px-3 py-2 text-destructive">{err}</div>}
        <input autoFocus className="input text-center text-2xl tracking-[0.4em]" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && void send()} />
        <p className="text-xs text-muted-foreground">Se você acabou de entrar com este mesmo código, espere o app trocar de código (30 s): o mesmo código não vale duas vezes.</p>
      </div>
    </Modal>
  );
}
