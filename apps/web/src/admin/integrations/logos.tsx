/**
 * Ícones dos apps do hub de Integrações (SVG, 48×48, cantos arredondados).
 * Os de marcas de terceiros usam as cores e o nome da marca; troque pelos arquivos oficiais de cada parceiro se quiser.
 * O PediuPay é a marca própria da plataforma.
 */
type P = { size?: number; className?: string };
const Tile = ({ size = 48, className, bg, children, label }: P & { bg: string; children: React.ReactNode; label: string }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={label} className={className}>
    <rect width="48" height="48" rx="12" fill={bg} />
    {children}
  </svg>
);

export const MercadoPagoLogo = (p: P) => (
  <Tile {...p} bg="#009EE3" label="Mercado Pago">
    <text x="24" y="22" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="11" fontWeight="700" fill="#fff">mercado</text>
    <text x="24" y="34" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="11" fontWeight="700" fill="#fff">pago</text>
  </Tile>
);

export const SicoobLogo = (p: P) => (
  <Tile {...p} bg="#003641" label="Sicoob">
    <circle cx="24" cy="18" r="7.5" fill="#7DB61C" />
    <circle cx="24" cy="18" r="3.2" fill="#003641" />
    <text x="24" y="37" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="10" fontWeight="700" fill="#fff" letterSpacing="-.2">sicoob</text>
  </Tile>
);

export const IfoodLogo = (p: P) => (
  <Tile {...p} bg="#EA1D2C" label="iFood">
    <text x="24" y="30" textAnchor="middle" fontFamily="Arial Black, Arial, Helvetica, sans-serif" fontSize="15" fontWeight="900" fontStyle="italic" fill="#fff" letterSpacing="-.6">iFood</text>
  </Tile>
);

export const WhatsappLogo = (p: P) => (
  <Tile {...p} bg="#25D366" label="WhatsApp">
    <path d="M24 10.5c-7.5 0-13.5 6-13.5 13.4 0 2.4.6 4.6 1.8 6.6L10.5 37.5l7.2-1.8c1.9 1 4.1 1.6 6.3 1.6 7.5 0 13.5-6 13.5-13.4S31.5 10.5 24 10.5Z" fill="#fff" />
    <path d="M19.2 17.6c-.3-.7-.6-.7-.9-.7h-.8c-.3 0-.7.1-1 .5-.4.4-1.3 1.3-1.3 3.2s1.4 3.7 1.6 4c.2.3 2.7 4.3 6.6 5.8 3.3 1.3 3.9 1 4.6 1 .7-.1 2.3-.9 2.6-1.8.3-.9.3-1.7.2-1.8-.1-.2-.4-.3-.8-.5l-2.7-1.3c-.4-.1-.6-.2-.9.2l-1.2 1.5c-.2.3-.4.3-.8.1-.4-.2-1.7-.6-3.2-2-1.2-1-2-2.3-2.2-2.7-.2-.4 0-.6.2-.8l.6-.7c.2-.2.3-.4.4-.7.1-.3.1-.5 0-.7l-1.2-2.9Z" fill="#25D366" />
  </Tile>
);

/** PediuPay: marca própria — "P" com seta de pagamento instantâneo sobre o azul da plataforma. */
export const PediuPayLogo = (p: P) => (
  <svg width={p.size ?? 48} height={p.size ?? 48} viewBox="0 0 48 48" role="img" aria-label="PediuPay" className={p.className}>
    <defs>
      <linearGradient id="pp-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0091FF" /><stop offset="1" stopColor="#5B2EFF" /></linearGradient>
    </defs>
    <rect width="48" height="48" rx="12" fill="url(#pp-bg)" />
    <path d="M16 35V13h9.5c4.7 0 7.8 2.9 7.8 7.1s-3.1 7.1-7.8 7.1H21.4V35H16Zm5.4-12.3h3.7c2 0 3.2-1 3.2-2.6s-1.2-2.6-3.2-2.6h-3.7v5.2Z" fill="#fff" />
    <path d="M30 31.5h7.5m0 0-3-3m3 3-3 3" fill="none" stroke="#7CF5C8" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const NfceLogo = (p: P) => (
  <Tile {...p} bg="#0F766E" label="Nota Fiscal (NFC-e)">
    <path d="M15 10.5h14l5 5v21.5l-2.4-1.6-2.3 1.6-2.4-1.6-2.3 1.6-2.4-1.6-2.3 1.6-2.4-1.6L15 37V10.5Z" fill="#fff" />
    <path d="M29 10.5v5h5" fill="#CCFBF1" />
    <text x="24.5" y="27" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="7.5" fontWeight="800" fill="#0F766E">NFC-e</text>
    <path d="M19 31h11" stroke="#0F766E" strokeWidth="1.4" strokeLinecap="round" />
  </Tile>
);

export const MaquininhaLogo = (p: P) => (
  <Tile {...p} bg="#1E293B" label="Maquininha integrada">
    <rect x="15" y="8.5" width="18" height="31" rx="3.5" fill="#fff" />
    <rect x="18" y="12" width="12" height="7.5" rx="1.2" fill="#38BDF8" />
    {[0, 1, 2].map((r) => [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={18.5 + c * 4} y={23 + r * 4} width="2.6" height="2.4" rx=".6" fill="#1E293B" />))}
    <path d="M33 16c2 1.3 3 3.2 3 5.4s-1 4.1-3 5.4m2.4-14c3.2 2 4.8 5 4.8 8.6s-1.6 6.6-4.8 8.6" fill="none" stroke="#38BDF8" strokeWidth="1.6" strokeLinecap="round" />
  </Tile>
);
