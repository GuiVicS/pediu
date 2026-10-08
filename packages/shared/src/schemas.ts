import { z } from 'zod';

/** Esquemas de personalização de loja (usados pela API e pelo MCP). Espelham o contrato de tema do pediu-mvp/src/lib/types.ts. */
const hex = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Use uma cor hex, ex.: #0091FF');
const url = z.string().max(2048).refine((v) => v === '' || /^https?:\/\//.test(v) || v.startsWith('/'), 'URL inválida');
const money = z.number().min(0).max(100000);

export const ThemeInput = z.object({
  primary: hex, primaryFg: hex, secondary: hex, secondaryFg: hex, accent: hex, accentFg: hex,
  background: hex, foreground: hex, card: hex, muted: hex, mutedFg: hex, border: hex, danger: hex,
  radius: z.number().int().min(0).max(40),
  fontFamily: z.string().max(120),
  logoUrl: url, faviconUrl: url, profileUrl: url, backgroundImageUrl: url,
  welcomeMessage: z.string().max(300), footerText: z.string().max(300), aboutUs: z.string().max(2000),
  ctaButtonText: z.string().max(60), thanksMessage: z.string().max(300), emptyCartMessage: z.string().max(200),
  productGridColumns: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  whatsapp: z.string().max(30), metaPixelId: z.string().max(40), googleAnalyticsId: z.string().max(40),
  seoTitle: z.string().max(120), seoDescription: z.string().max(300),
  customCss: z.string().max(20000),
}).partial();
export type ThemeInput = z.infer<typeof ThemeInput>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const StoreInput = z.object({
  name: z.string().min(2).max(80), slogan: z.string().max(160), phone: z.string().max(30),
  address: z.string().max(200), city: z.string().max(80), state: z.string().length(2),
  mode: z.enum(['auto', 'open', 'closed']), closedMessage: z.string().max(300),
  minOrder: money, prepTime: z.number().int().min(0).max(300),
  timezone: z.string().max(60).refine((tz) => { try { new Intl.DateTimeFormat('pt-BR', { timeZone: tz }); return true; } catch { return false; } }, 'Fuso horário inválido (ex.: America/Sao_Paulo)'),
  hours: z.array(z.object({ day: z.number().int().min(0).max(6), closed: z.boolean(), open: hhmm, close: hhmm })).max(7),
  /** Quantidade de mesas do salão (mapa do app do garçom). */
  tables: z.number().int().min(0).max(300),
}).partial();
export type StoreInput = z.infer<typeof StoreInput>;

export const Slug = z.string().min(3).max(40).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/, 'Use letras minúsculas, números e hífen');

export const CategoryInput = z.object({
  id: z.string().uuid().optional(), name: z.string().min(1).max(80), imageUrl: url.default(''),
  imageFit: z.enum(['cover', 'contain']).default('cover'), order: z.number().int().default(0), active: z.boolean().default(true),
  printZoneId: z.string().uuid().nullable().default(null),
});
export type CategoryInput = z.infer<typeof CategoryInput>;

export const ProductInput = z.object({
  id: z.string().uuid().optional(), categoryId: z.string().uuid(), name: z.string().min(1).max(120),
  description: z.string().max(1000).default(''), notes: z.string().max(500).default(''),
  price: money, imageUrl: url.default(''), imageFit: z.enum(['cover', 'contain']).default('cover'),
  prepTime: z.number().int().min(0).max(300).default(0), active: z.boolean().default(true), available: z.boolean().default(true),
  order: z.number().int().default(0), groupIds: z.array(z.string().uuid()).default([]),
});
export type ProductInput = z.infer<typeof ProductInput>;

export const AddonGroupInput = z.object({
  id: z.string().uuid().optional(), name: z.string().min(1).max(80), description: z.string().max(300).default(''),
  min: z.number().int().min(0).default(0), max: z.number().int().min(1).default(1), required: z.boolean().default(false),
  pricing: z.enum(['sum', 'highest', 'lowest', 'average']).default('sum'), order: z.number().int().default(0), active: z.boolean().default(true),
  addons: z.array(z.object({ id: z.string().uuid().optional(), name: z.string().min(1).max(80), price: money.default(0), order: z.number().int().default(0), active: z.boolean().default(true) })).max(100).default([]),
});
export type AddonGroupInput = z.infer<typeof AddonGroupInput>;

export const BannerInput = z.object({
  id: z.string().uuid().optional(), title: z.string().max(120).default(''), description: z.string().max(300).default(''),
  imageUrl: url, order: z.number().int().default(0), active: z.boolean().default(true),
});
export type BannerInput = z.infer<typeof BannerInput>;

export const DeliveryZoneInput = z.object({
  id: z.string().uuid().optional(), name: z.string().min(1).max(80), fee: money, eta: z.number().int().min(0).max(300), active: z.boolean().default(true),
});
export type DeliveryZoneInput = z.infer<typeof DeliveryZoneInput>;

export const PRINT_EVENTS = ['novo', 'preparo', 'items_added', 'pronto', 'cancelado'] as const;
export const PrintZoneInput = z.object({
  id: z.string().uuid().optional(), name: z.string().min(1).max(60), description: z.string().max(200).default(''),
  paper: z.enum(['58mm', '80mm']).default('80mm'), copies: z.number().int().min(1).max(5).default(1),
  autoPrint: z.boolean().default(true), showPrices: z.boolean().default(false), active: z.boolean().default(true),
  isDefault: z.boolean().default(false), events: z.array(z.enum(PRINT_EVENTS)).max(5).default(['novo', 'items_added', 'cancelado']),
});
export type PrintZoneInput = z.infer<typeof PrintZoneInput>;

export const PaymentMethodShape = z.object({
  id: z.string().uuid().optional(), name: z.string().min(1).max(60), type: z.enum(['pix', 'cash', 'credit', 'debit', 'voucher']),
  note: z.string().max(200).default(''), order: z.number().int().default(0), active: z.boolean().default(true),
  online: z.boolean().default(false), gateway: z.enum(['mercadopago', 'sicoob']).nullable().default(null),
});
export const PaymentMethodInput = PaymentMethodShape.superRefine((v, c) => {
  if (v.online && !v.gateway) c.addIssue({ code: 'custom', path: ['gateway'], message: 'Escolha o gateway para cobrar online.' });
  if (v.online && v.type !== 'pix' && v.type !== 'credit') c.addIssue({ code: 'custom', path: ['type'], message: 'Online só vale para Pix ou cartão de crédito.' });
  if (v.online && v.type === 'credit' && v.gateway === 'sicoob') c.addIssue({ code: 'custom', path: ['gateway'], message: 'Cartão online é pelo Mercado Pago.' });
});
export type PaymentMethodInput = z.infer<typeof PaymentMethodInput>;

export const AddonInput = z.object({
  id: z.string().uuid().optional(), groupId: z.string().uuid(), name: z.string().min(1).max(80), price: money.default(0), order: z.number().int().default(0), active: z.boolean().default(true),
});
export type AddonInput = z.infer<typeof AddonInput>;

export const FeaturedInput = z.object({ id: z.string().uuid().optional(), productId: z.string().uuid(), order: z.number().int().default(0), active: z.boolean().default(true) });
export type FeaturedInput = z.infer<typeof FeaturedInput>;
