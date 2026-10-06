import { useCallback, useEffect, useRef, useState } from 'react';
import { del, get, put } from './api';
import { useStream } from './realtime';

/**
 * Lista de uma coleção do painel (categorias, produtos, adicionais…), carregada da API e mantida em dia por eventos em tempo real.
 * Mesma interface da demo: `items`, `ready`, `save` (cria sem id / atualiza com id) e `remove`.
 */
export function useCollection<T extends { id: string }>(name: string) {
  const [items, setItems] = useState<T[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const load = useCallback(async () => {
    try { const r = await get<{ items: T[] }>(`/v1/staff/c/${name}`); if (alive.current) { setItems(r.items); setError(null); setReady(true); } }
    catch (e) { if (alive.current) { setError((e as Error).message); setReady(true); } }
  }, [name]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);
  useStream((e) => { if (e.type === 'menu' && e.collection === name) void load(); }, load, 60_000);

  const save = useCallback(async (item: Omit<T, 'id'> & { id?: string }) => {
    const r = await put<{ item: T }>(`/v1/staff/c/${name}`, item);
    await load();
    return r.item;
  }, [name, load]);
  const remove = useCallback(async (id: string) => { await del(`/v1/staff/c/${name}/${id}`); await load(); }, [name, load]);
  return { items, ready, error, save, remove, reload: load };
}

/** Registro único (tema ou dados da loja). */
export function useKV<T>(key: 'theme' | 'store') {
  const [value, setValue] = useState<T | undefined>();
  const load = useCallback(async () => { try { setValue((await get<{ value: T }>(`/v1/staff/kv/${key}`)).value); } catch { /* sem sessão: a rota de login cuida */ } }, [key]);
  useEffect(() => { void load(); }, [load]);
  useStream((e) => { if (e.type === 'menu' && e.collection === key) void load(); }, load, 120_000);
  const save = useCallback(async (v: T) => { await put(`/v1/staff/kv/${key}`, v); setValue(v); }, [key]);
  return [value, save] as const;
}

export const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;

/** Troca a posição de um item com o vizinho (up/down) na lista já ordenada. */
export async function moveItem<T extends { id: string; order: number }>(sorted: T[], id: string, dir: -1 | 1, save: (item: T) => Promise<unknown>) {
  const i = sorted.findIndex((x) => x.id === id); const j = i + dir;
  if (i < 0 || j < 0 || j >= sorted.length) return;
  await save({ ...sorted[i]!, order: sorted[j]!.order });
  await save({ ...sorted[j]!, order: sorted[i]!.order });
}
