import nodemailer from 'nodemailer';

export interface Mail { to: string; subject: string; html: string; text: string }
/** Envio de e-mail. Em produção é SMTP (qualquer provedor, inclusive o SMTP configurado no Supabase); os testes injetam um falso. */
export interface Mailer { send(m: Mail): Promise<void> }

export interface SmtpConfig { host: string; port: number; secure: boolean; user?: string; pass?: string; from: string }

export function smtpMailer(c: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: c.user ? { user: c.user, pass: c.pass ?? '' } : undefined, connectionTimeout: 10_000, socketTimeout: 15_000 });
  return { send: async (m) => { await transport.sendMail({ from: c.from, to: m.to, subject: m.subject, html: m.html, text: m.text }); } };
}
