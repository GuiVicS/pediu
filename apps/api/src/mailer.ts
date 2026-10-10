import nodemailer from 'nodemailer';

export interface Mail { to: string; subject: string; html: string; text: string }
/** Envio de e-mail. Em produção é o Resend (configurado no super admin) ou, na falta dele, SMTP (qualquer provedor); os testes injetam um falso. */
export interface Mailer { send(m: Mail): Promise<void>; /** Há um provedor configurado agora? (ausente = sempre sim) */ ready?(): Promise<boolean> }

export interface SmtpConfig { host: string; port: number; secure: boolean; user?: string; pass?: string; from: string }

export function smtpMailer(c: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: c.user ? { user: c.user, pass: c.pass ?? '' } : undefined, connectionTimeout: 10_000, socketTimeout: 15_000 });
  return { send: async (m) => { await transport.sendMail({ from: c.from, to: m.to, subject: m.subject, html: m.html, text: m.text }); } };
}

/** Pronto para enviar? Mailers de teste não têm `ready`: contam como prontos. */
export const mailReady = async (m?: Mailer) => !!m && (m.ready ? await m.ready() : true);

export interface ResendConfig { apiKey: string; from: string }
/** Resend (https://resend.com): um POST com a chave de API. `from` precisa ser de um domínio verificado lá. */
export function resendMailer(c: ResendConfig, fetchImpl: typeof fetch = fetch): Mailer {
  return {
    send: async (m) => {
      const r = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST', headers: { authorization: `Bearer ${c.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: c.from, to: [m.to], subject: m.subject, html: m.html, text: m.text }), signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { message?: string };
        throw new Error(`Resend ${r.status}: ${body.message ?? 'falha ao enviar'}`);
      }
    },
  };
}
