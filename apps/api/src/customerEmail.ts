/** E-mail do código de acesso do cliente: usa a marca da loja (cor, logo, nome) e traz no rodapé a assinatura da PediuLanchou. */
export interface LoginCodeEmail {
  storeName: string; storeUrl: string; logoUrl?: string; primary?: string; primaryFg?: string;
  code: string; minutes: number;
  /** URL da landing page (campo configurável no super admin) e da logo preta da PediuLanchou (arquivo servido pela própria loja). */
  landingUrl: string; poweredByLogoUrl: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hex = (v: string | undefined, fallback: string) => (v && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : fallback);
const safeUrl = (u: string | undefined) => (u && /^https?:\/\//i.test(u) ? u : '');

export function loginCodeEmail(a: LoginCodeEmail): { subject: string; html: string; text: string } {
  const primary = hex(a.primary, '#E53935'), fg = hex(a.primaryFg, '#FFFFFF');
  const store = esc(a.storeName), logo = safeUrl(a.logoUrl), site = safeUrl(a.storeUrl), landing = safeUrl(a.landingUrl), pLogo = safeUrl(a.poweredByLogoUrl);
  const digits = a.code.replace(/\D/g, '');
  const subject = `${digits} é o seu código de acesso — ${a.storeName}`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5;padding:24px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#ffffff;border-radius:14px;overflow:hidden">
    <tr><td align="center" style="background:${primary};color:${fg};padding:24px 16px">
      ${logo ? `<img src="${esc(logo)}" alt="${store}" width="64" height="64" style="display:block;margin:0 auto 10px;border-radius:50%;object-fit:cover;background:#ffffff">` : ''}
      <div style="font-size:20px;font-weight:700">${store}</div>
    </td></tr>
    <tr><td style="padding:28px 24px;text-align:center">
      <p style="margin:0 0 6px;font-size:16px">Use o código abaixo para entrar na sua conta:</p>
      <div style="margin:18px auto;padding:14px 10px;max-width:260px;background:#f4f4f5;border-radius:10px;font-size:34px;letter-spacing:10px;font-weight:700;color:${primary}">${esc(digits)}</div>
      <p style="margin:0;font-size:13px;color:#52525b">O código vale por ${a.minutes} minutos e só pode ser usado uma vez.<br>Se você não pediu este código, ignore este e-mail.</p>
      ${site ? `<p style="margin:20px 0 0"><a href="${esc(site)}" style="display:inline-block;background:${primary};color:${fg};text-decoration:none;font-weight:700;padding:10px 22px;border-radius:999px;font-size:14px">Ir para a loja</a></p>` : ''}
    </td></tr>
    <tr><td align="center" style="border-top:1px solid #e4e4e7;padding:18px 16px;background:#ffffff">
      ${landing && pLogo ? `<a href="${esc(landing)}" style="text-decoration:none;color:#52525b;font-size:12px"><span style="display:block;margin-bottom:6px">Desenvolvido com muita fome</span><img src="${esc(pLogo)}" alt="PediuLanchou" width="140" style="display:inline-block;height:auto;border:0"></a>`
        : `<span style="color:#52525b;font-size:12px">Desenvolvido com muita fome — PediuLanchou</span>`}
    </td></tr>
  </table>
</td></tr></table></body></html>`;
  const text = `${a.storeName}\n\nSeu código de acesso: ${digits}\nValido por ${a.minutes} minutos. Se você não pediu, ignore este e-mail.\n${site ? `\nLoja: ${site}\n` : ''}\nDesenvolvido com muita fome — PediuLanchou${landing ? ` (${landing})` : ''}\n`;
  return { subject, html, text };
}
