import { z } from 'zod';
import { parseKeyring } from '@pediu/shared';

const Env = z.object({
  PORT: z.coerce.number().default(3000),
  // três conexões, uma por role do Postgres (ver migrations). No Supabase: pooler em modo transação, porta 6543.
  APP_DATABASE_URL: z.string().url(),
  PLATFORM_DATABASE_URL: z.string().url(),
  MCP_DATABASE_URL: z.string().url(),
  SECRETS_KEYS: z.string().min(10),
  BASE_DOMAIN: z.string().default('pediulanchou.com.br'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('true'),
  TRUST_PROXY: z.enum(['true', 'false']).default('true'),
  // opcional: alertas chegam aqui (Slack e compatíveis recebem {text}; o corpo traz também o alerta completo)
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  // URL pública da API (https). Usada nos webhooks do Mercado Pago/Sicoob e nos links de pagamento.
  PUBLIC_API_URL: z.string().url().optional(),
  // pasta com o build do apps/platform (tela do super admin)
  PLATFORM_UI_DIR: z.string().optional(),
  // e-mail do código de acesso dos clientes (qualquer SMTP; ex.: o SMTP configurado no Supabase). Sem isso o login de clientes responde 503.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Pediu Lanchou <nao-responda@pediulanchou.com.br>'),
});

export function loadEnv(source: NodeJS.ProcessEnv = process.env) {
  const e = Env.parse(source);
  return { ...e, ring: parseKeyring(e.SECRETS_KEYS), cookieSecure: e.COOKIE_SECURE === 'true', trustProxy: e.TRUST_PROXY === 'true' };
}
