export const onlyDigits = (s: string) => s.replace(/\D/g, '');

export const maskPhone = (s: string) => {
  const d = onlyDigits(s).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};
export const maskCep = (s: string) => { const d = onlyDigits(s).slice(0, 8); return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; };
export const maskCpf = (s: string) => {
  const d = onlyDigits(s).slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2');
};

export const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
export const validPhone = (s: string) => { const d = onlyDigits(s); return d.length === 10 || d.length === 11; };
export const validCep = (s: string) => onlyDigits(s).length === 8;

/** CPF com dígitos verificadores (rejeita sequências como 111.111.111-11). */
export function validCpf(s: string): boolean {
  const d = onlyDigits(s);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (len: number) => { let sum = 0; for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i); const r = (sum * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

export interface AddressFields { cep: string; street: string; number: string; complement: string; district: string; city: string; uf: string }
export const blankAddress = (): AddressFields => ({ cep: '', street: '', number: '', complement: '', district: '', city: '', uf: '' });

/** Uma linha para cupom, cozinha e entregador: "Rua X, 125 - apto 3, Bairro, Cidade-UF, CEP 14402-151". */
export function composeAddress(a: AddressFields): string {
  const rua = [a.street.trim(), a.number.trim()].filter(Boolean).join(', ') + (a.complement.trim() ? ` - ${a.complement.trim()}` : '');
  const cidade = [a.city.trim(), a.uf.trim().toUpperCase()].filter(Boolean).join('-');
  return [rua, a.district.trim(), cidade, a.cep ? `CEP ${maskCep(a.cep)}` : ''].filter(Boolean).join(', ').slice(0, 170);
}

export type CepResult = { ok: true; street: string; district: string; city: string; uf: string } | { ok: false; reason: 'not_found' | 'unavailable' };
/** ViaCEP direto do navegador (sem custo no servidor). Se cair ou o CEP não existir, o cliente digita o endereço à mão. */
export async function lookupCep(cep: string, signal?: AbortSignal): Promise<CepResult> {
  const d = onlyDigits(cep);
  if (d.length !== 8) return { ok: false, reason: 'not_found' };
  const timeout = AbortSignal.timeout(6000);
  try {
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!r.ok) return { ok: false, reason: 'unavailable' };
    const j = await r.json() as { erro?: boolean | string; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
    if (j.erro) return { ok: false, reason: 'not_found' };
    return { ok: true, street: j.logradouro ?? '', district: j.bairro ?? '', city: j.localidade ?? '', uf: j.uf ?? '' };
  } catch { return { ok: false, reason: 'unavailable' }; }
}
