import type { Pools } from '@pediu/db';
import type { Keyring } from '@pediu/shared';

export interface Clock { now(): Date }
export const systemClock: Clock = { now: () => new Date() };

export interface Ctx {
  pools: Pools;
  ring: { keys: Keyring; current: string };
  clock: Clock;
  baseDomain: string;
  /** URL pública da API (https), usada nos webhooks dos gateways. Vazio = sem webhook (só conciliação por consulta). */
  publicUrl?: string;
  cookieSecure: boolean;
  stripe?: import('./stripe.js').StripeClient;
  telemetry?: import('./telemetry.js').Telemetry;
  notifier?: import('./alerts.js').Notifier;
  /** Fábricas dos clientes de gateway (os testes injetam falsos). */
  /** Fábrica do cliente iFood (os testes injetam um falso). */
  ifood?: (c: import('./ifood.js').IfoodCreds) => import('./ifood.js').IfoodApi;
  gateways?: { mercadoPago(c: import('./gateways.js').MpCreds): import('./gateways.js').MercadoPagoApi; sicoob(c: import('./gateways.js').SicoobCreds): import('./gateways.js').SicoobApi };
}

export const SESSION_COOKIE = 'pediu_sa';
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const STEPUP_TTL_MS = 5 * 60 * 1000;
export const MAX_FAILED = 5;
export const LOCK_MS = 15 * 60 * 1000;
