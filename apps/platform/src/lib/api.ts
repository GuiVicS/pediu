export class ApiError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } }

export async function api<T = any>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try { res = await fetch(path, { method, credentials: 'same-origin', headers: body !== undefined ? { 'content-type': 'application/json' } : undefined, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new ApiError(0, 'network', 'Sem conexão com o servidor.'); }
  const text = await res.text(); let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { /* não-JSON */ }
  if (!res.ok) {
    const e = data?.error;
    if (res.status === 401 && !path.includes('/auth/login')) window.dispatchEvent(new Event('pediu:unauthenticated'));
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? `Erro ${res.status}`);
  }
  return data as T;
}
export const get = <T = any,>(p: string) => api<T>('GET', p);
export const post = <T = any,>(p: string, b?: unknown) => api<T>('POST', p, b ?? {});
export const put = <T = any,>(p: string, b: unknown) => api<T>('PUT', p, b);
export const del = <T = any,>(p: string) => api<T>('DELETE', p);
export const qs = (o: Record<string, string | number | undefined | null>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v)); const s = p.toString(); return s ? `?${s}` : ''; };
export const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const dt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');
export const ago = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return m < 1 ? 'agora' : m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`; };
