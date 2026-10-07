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
  // agente de atendimento (WhatsApp). Escolha o provedor na tela do super admin (Inteligência artificial) ou aqui: LLM_PROVIDER = anthropic | openai | groq | gemini |
  // mistral | deepseek | xai | openrouter | together | ollama | custom, com a chave do provedor (ANTHROPIC_API_KEY, OPENAI_API_KEY, GROQ_API_KEY, GEMINI_API_KEY,
  // MISTRAL_API_KEY, DEEPSEEK_API_KEY, XAI_API_KEY, OPENROUTER_API_KEY, TOGETHER_API_KEY ou LLM_API_KEY). Sem LLM_PROVIDER vale a primeira chave encontrada.
  // AGENT_MODEL e LLM_BASE_URL sobrescrevem o modelo e o endereço padrão. Sem nada configurado o agente responde 503.
  ANTHROPIC_API_KEY: z.string().optional(),
  AGENT_MODEL: z.string().optional(),
  // Whisper: API da OpenAI (informe só a chave) ou servidor próprio/Groq compatível com /audio/transcriptions (informe a URL; a chave é opcional)
  TRANSCRIBE_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  TRANSCRIBE_API_KEY: z.string().optional(),
  TRANSCRIBE_MODEL: z.string().optional(),            // padrão por provedor (whisper-1 na OpenAI, whisper-large-v3-turbo na Groq)
  TRANSCRIBE_PROVIDER: z.enum(['openai', 'groq', 'custom']).optional(),
  MAIL_FROM: z.string().default('PediuLanchou <nao-responda@pediulanchou.com.br>'),
});

export function loadEnv(source: NodeJS.ProcessEnv = process.env) {
  const e = Env.parse(source);
  return { ...e, ring: parseKeyring(e.SECRETS_KEYS), cookieSecure: e.COOKIE_SECURE === 'true', trustProxy: e.TRUST_PROXY === 'true' };
}
