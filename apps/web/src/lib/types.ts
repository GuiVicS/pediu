// Tipos da interface. Mesmo desenho da demo, com ids em texto (uuid) e dinheiro em reais nas telas de cadastro.
export interface Theme {
  primary: string; primaryFg: string; secondary: string; secondaryFg: string; accent: string; accentFg: string;
  background: string; foreground: string; card: string; muted: string; mutedFg: string; border: string; danger: string;
  radius: number; fontFamily: string;
  logoUrl: string; faviconUrl: string; profileUrl: string; backgroundImageUrl: string;
  welcomeMessage: string; footerText: string; aboutUs: string; ctaButtonText: string; thanksMessage: string; emptyCartMessage: string;
  productGridColumns: 2 | 3 | 4; whatsapp: string; metaPixelId: string; googleAnalyticsId: string; seoTitle: string; seoDescription: string; customCss: string;
}
export const THEME_DEFAULTS: Theme = {
  primary: '#c62828', primaryFg: '#ffffff', secondary: '#ffb300', secondaryFg: '#2b1b14', accent: '#2e7d32', accentFg: '#ffffff',
  background: '#fff8f0', foreground: '#2b1b14', card: '#ffffff', muted: '#f3e9df', mutedFg: '#7a6a5f', border: '#eadfd3', danger: '#d32f2f',
  radius: 16, fontFamily: 'Poppins', logoUrl: '', faviconUrl: '', profileUrl: '', backgroundImageUrl: '',
  welcomeMessage: 'Faça seu pedido e receba em casa!', footerText: 'Todos os direitos reservados.', aboutUs: '', ctaButtonText: 'Adicionar',
  thanksMessage: 'Pedido recebido! Já estamos preparando.', emptyCartMessage: 'Sua sacola está vazia.', productGridColumns: 3,
  whatsapp: '', metaPixelId: '', googleAnalyticsId: '', seoTitle: '', seoDescription: '', customCss: '',
};

export interface DayHours { day: number; label?: string; closed: boolean; open: string; close: string }
export interface Store {
  name: string; slogan: string; phone: string; address: string; city: string; state: string;
  mode: 'auto' | 'open' | 'closed'; closedMessage: string; minOrder: number; prepTime: number; hours: DayHours[];
  /** mesas do salão (mapa do garçom) */
  tables?: number;
}
export const STORE_DEFAULTS: Store = { name: '', slogan: '', phone: '', address: '', city: '', state: '', mode: 'auto', closedMessage: 'Estamos fechados no momento. Volte no nosso horário de funcionamento!', minOrder: 0, prepTime: 30, hours: [] };
export const DAY_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export type ImageFit = 'cover' | 'contain';
export interface Category { id: string; name: string; imageUrl: string; imageFit?: ImageFit; order: number; active: boolean; printZoneId: string | null }
export interface Product { id: string; categoryId: string; name: string; description: string; notes: string; price: number; imageUrl: string; imageFit?: ImageFit; prepTime: number; active: boolean; available: boolean; order: number; groupIds: string[] }
export type PricingMode = 'sum' | 'highest' | 'lowest' | 'average';
export interface AddonGroup { id: string; name: string; description: string; min: number; max: number; required: boolean; pricing: PricingMode; order: number; active: boolean }
export interface Addon { id: string; groupId: string; name: string; price: number; order: number; active: boolean }
export interface Banner { id: string; title: string; description: string; imageUrl: string; order: number; active: boolean }
export interface Featured { id: string; productId: string; order: number; active: boolean }
export interface PaymentMethod { id: string; name: string; type: 'pix' | 'cash' | 'credit' | 'debit' | 'voucher'; note: string; order: number; active: boolean; online: boolean; gateway: 'mercadopago' | 'sicoob' | null }
export interface PrintZone { id: string; name: string; description: string; paper: '58mm' | '80mm'; copies: number; autoPrint: boolean; showPrices: boolean; active: boolean; isDefault: boolean; events: string[] }
export interface DeliveryZone { id: string; name: string; fee: number; eta: number; active: boolean }

export type OrderStatus = 'aguardando' | 'novo' | 'preparo' | 'pronto' | 'saiu' | 'entregue' | 'cancelado';
export type OrderType = 'delivery' | 'retirada' | 'mesa';
export interface ApiOrderItem { order_id: string; name: string; qty: number; unit_cents: number; total_cents: number; note: string; addons: { group: string; name: string; priceCents: number }[]; created_at?: string }
export interface ApiOrder {
  id: string; number: number; channel: 'loja' | 'pdv' | 'garcom' | 'ifood'; type: OrderType; status: OrderStatus;
  customer_name: string; customer_phone: string; address: string; table_number: number | null; note: string;
  subtotal_cents: number; fee_cents: number; discount_cents: number; total_cents: number; payment_method: string; change_for_cents: number | null;
  paid: boolean; paid_at: string | null; paid_type?: 'pix' | 'cash' | 'credit' | 'debit' | 'voucher' | null; payment_mode?: 'tela' | 'externo' | null;
  cash_received_cents?: number | null; change_cents?: number | null; payment_ref?: string | null; courier_id: string | null; created_at: string; accepted_at: string | null; ready_at: string | null; dispatched_at: string | null; delivered_at: string | null;
  cancelled_at: string | null; cancel_reason: string | null; items: ApiOrderItem[];
  /** mesa: pessoas e quando o garçom pediu a conta */
  guests?: number | null; bill_requested_at?: string | null;
  /** mesa: quem abriu a comanda e todos que mexeram nela (garçons e caixa) */
  opened_by_name?: string | null; staff_names?: string[];
  /** entrega: rota do entregador (mesma saída) e a posição da parada */
  route_id?: string | null; route_stop?: number | null;
}

export interface CartLine {
  key: string; productId: string; name: string; categoryId: string; imageUrl: string; imageFit?: ImageFit;
  qty: number; unitPrice: number; addons: { groupId: string; addonId: string; group: string; name: string; price: number }[]; note: string;
}
