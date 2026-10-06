import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
const Ctx = createContext<(m: string) => void>(() => {});
export const useToast = () => useContext(Ctx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<{ id: number; msg: string }[]>([]);
  const push = useCallback((msg: string) => { const id = Date.now() + Math.random(); setList((l) => [...l, { id, msg }]); setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 4000); }, []);
  return <Ctx.Provider value={push}>{children}<div className="pointer-events-none fixed bottom-4 right-4 z-[200] space-y-2">{list.map((t) => <div key={t.id} className="pointer-events-auto rounded-ui-sm bg-foreground px-4 py-2.5 text-sm text-background shadow-ui-lg">{t.msg}</div>)}</div></Ctx.Provider>;
}
