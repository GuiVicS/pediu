/**
 * Sugestão de ordem das paradas de uma rota, SEM serviço de mapas: usa o que o pedido já traz no endereço
 * (região de entrega, CEP, rua e número). CEPs próximos costumam ser ruas próximas dentro da mesma cidade, então
 * ordenar por região › CEP › rua › número agrupa os pedidos do mesmo bairro e reduz idas e vindas.
 * É uma sugestão: o entregador pode reordenar. Com um geocodificador no futuro, só a chave de ordenação muda.
 */
export interface StopIn { id: string; number: number; address: string }
export interface Stop extends StopIn { zone: string; cep: string | null; group: string }

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** "Rua A, 125 - apto 3, Bairro, Cidade-UF, CEP 14402-151 — Região" → partes úteis (endereços digitados à mão também funcionam). */
export function parseAddress(address: string): { zone: string; cep: string | null; district: string; street: string; num: number } {
  const [main = '', ...zoneParts] = address.split(' — ');
  const zone = zoneParts.join(' — ').trim();
  const cepM = /(\d{5})-?(\d{3})\b/.exec(main);
  const cep = cepM ? `${cepM[1]}${cepM[2]}` : null;
  const parts = main.replace(/,?\s*CEP\s*\d{5}-?\d{3}/i, '').split(',').map((p) => p.trim()).filter(Boolean);
  const street = parts[0] ?? main;
  const num = Number(/\b(\d{1,5})\b/.exec(parts[1] ?? '')?.[1] ?? /\b(\d{1,5})\b/.exec(street)?.[1] ?? 0);
  // bairro: o 3º pedaço quando o endereço veio do checkout (rua, nº, bairro, cidade-UF); senão fica sem bairro
  const district = parts.length >= 4 ? parts[2]! : '';
  return { zone, cep, district, street: strip(street.replace(/\s*\d+\s*$/, '')), num };
}

export function planStops(stops: StopIn[]): Stop[] {
  const rows = stops.map((s) => { const p = parseAddress(s.address); return { s, p, label: p.district || p.zone || 'Sem região' }; });
  rows.sort((a, b) => (strip(a.p.zone) < strip(b.p.zone) ? -1 : strip(a.p.zone) > strip(b.p.zone) ? 1 : 0)
    || (a.p.cep ?? '99999999').localeCompare(b.p.cep ?? '99999999')
    || a.p.street.localeCompare(b.p.street, 'pt-BR')
    || a.p.num - b.p.num
    || a.s.number - b.s.number);
  return rows.map(({ s, p, label }) => ({ ...s, zone: p.zone, cep: p.cep, group: label }));
}

/** Google Maps com todas as paradas na ordem dada (o app abre já com a rota montada). O Maps aceita até 9 pontos intermediários: o resto fica para a próxima. */
export function mapsRouteUrl(addresses: string[]): string | null {
  const list = addresses.map((a) => a.split(' — ')[0]!.trim()).filter(Boolean).slice(0, 10);
  if (list.length === 0) return null;
  const q = (s: string) => encodeURIComponent(s);
  const dest = list[list.length - 1]!;
  const way = list.slice(0, -1);
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${q(dest)}${way.length ? `&waypoints=${way.map(q).join('%7C')}` : ''}`;
}
