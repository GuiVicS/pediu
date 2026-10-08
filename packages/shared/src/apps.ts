/** Apps do hub de Integrações que a loja pode instalar (o "Em breve" fica só na tela, sem instalação). */
export const INTEGRATION_APPS = ['mercadopago', 'sicoob', 'ifood', 'whatsapp'] as const;
export type IntegrationApp = (typeof INTEGRATION_APPS)[number];
/** Apps de pagamento: instalar = conectar a conta (credenciais); desinstalar apaga as credenciais. */
export const PAYMENT_APPS = ['mercadopago', 'sicoob'] as const satisfies readonly IntegrationApp[];
