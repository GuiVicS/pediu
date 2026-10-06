/** Cliente da API. Mesma origem (o web-edge ou o proxy do Vite repassa /v1), cookie de sessão enviado automaticamente. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method, credentials: 'same-origin', headers: body !== undefined ? { 'content-type': 'application/json' } : undefined, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new ApiError(0, 'network', 'Sem conexão com o servidor. Confira a internet e tente de novo.'); }
  const text = await res.text();
  let data: unknown = null; try { data = text ? JSON.parse(text) : null; } catch { /* resposta não-JSON */ }
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string } } | null)?.error;
    if (res.status === 401 && !path.includes('/login')) window.dispatchEvent(new Event('pediu:unauthenticated'));
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? `Erro ${res.status}`);
  }
  return data as T;
}
export const get = <T,>(p: string) => api<T>('GET', p);
export const post = <T,>(p: string, b?: unknown) => api<T>('POST', p, b ?? {});
export const put = <T,>(p: string, b: unknown) => api<T>('PUT', p, b);
export const del = <T,>(p: string) => api<T>('DELETE', p);

/** Envia uma imagem (arquivo) e devolve a URL pública. */
export async function uploadImage(file: File): Promise<string> {
  if (file.size > 5 * 1024 * 1024) throw new ApiError(0, 'too_large', 'A imagem passa de 5 MB.');
  const dataBase64 = await new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => no(new Error('Não consegui ler o arquivo.')); r.readAsDataURL(file); });
  return (await post<{ url: string }>('/v1/staff/uploads', { contentType: file.type, dataBase64 })).url;
}
