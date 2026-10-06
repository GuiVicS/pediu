import { useCallback, useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { useStream } from '@/lib/realtime';
import { normalizeMenu, type Menu } from '@/store/StoreContext';

/** Cardápio da equipe (qualquer status da loja), mantido em dia pelo tempo real. */
export function useStaffMenu() {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { setMenu(normalizeMenu(await get('/v1/staff/menu'))); setError(null); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => { void load(); }, [load]);
  useStream((e) => { if (e.type === 'menu') void load(); }, load, 60_000);
  return { menu, error, reload: load };
}
