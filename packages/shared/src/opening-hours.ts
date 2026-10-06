export interface DayHours { day: number; closed: boolean; open: string; close: string }
export interface HoursSettings { mode?: 'auto' | 'open' | 'closed'; hours?: DayHours[] }
export interface OpenStatus { open: boolean; label: string }

export const DEFAULT_TZ = 'America/Sao_Paulo';

/** Dia da semana (0=domingo) e minutos desde 00:00 no fuso da loja — o servidor pode estar em outro fuso. */
export function localParts(now: Date, tz = DEFAULT_TZ) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, mins: Number(get('hour')) * 60 + Number(get('minute')) };
}
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h! * 60 + m!; };

/** Aberta/fechada. O modo manual sobrepõe o horário; horário que passa da meia-noite continua valendo no dia seguinte. */
export function getOpenStatus(s: HoursSettings, now = new Date(), tz = DEFAULT_TZ): OpenStatus {
  if (s.mode === 'open') return { open: true, label: 'Aberto agora' };
  if (s.mode === 'closed') return { open: false, label: 'Fechado' };
  const { day, mins } = localParts(now, tz);
  const hours = s.hours ?? [];
  const today = hours.find((h) => h.day === day);
  const yesterday = hours.find((h) => h.day === (day + 6) % 7);
  if (yesterday && !yesterday.closed && toMin(yesterday.close) <= toMin(yesterday.open) && mins < toMin(yesterday.close)) {
    return { open: true, label: `Aberto até ${yesterday.close}` };
  }
  if (today && !today.closed) {
    const o = toMin(today.open); let c = toMin(today.close);
    if (c <= o) c += 24 * 60;
    if (mins >= o && mins < c) return { open: true, label: `Aberto até ${today.close}` };
    if (mins < o) return { open: false, label: `Abrimos hoje às ${today.open}` };
  }
  return { open: false, label: 'Fechado no momento' };
}
