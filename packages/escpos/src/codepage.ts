export type Codepage = 'cp860' | 'cp850' | 'cp437';

/** Byte da página de códigos para o comando ESC t n (Epson e compatíveis: Elgin, Bematech, Daruma, Tanca). */
export const CODEPAGE_ID: Record<Codepage, number> = { cp437: 0, cp850: 2, cp860: 3 };

// Caracteres acima de 0x7F que usamos em português. CP860 é a página portuguesa; CP850 é a multilíngue mais comum.
const CP860: Record<string, number> = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ã': 0x84, 'à': 0x85, 'Á': 0x86, 'ç': 0x87, 'ê': 0x88, 'Ê': 0x89, 'è': 0x8a, 'Í': 0x8b, 'Ô': 0x8c, 'ì': 0x8d, 'Ã': 0x8e, 'Â': 0x8f,
  'É': 0x90, 'À': 0x91, 'È': 0x92, 'ô': 0x93, 'õ': 0x94, 'ò': 0x95, 'Ú': 0x96, 'ù': 0x97, 'Ì': 0x98, 'Õ': 0x99, 'Ü': 0x9a, '¢': 0x9b, '£': 0x9c, 'Ù': 0x9d, '₧': 0x9e, 'Ó': 0x9f,
  'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ª': 0xa6, 'º': 0xa7, '¿': 0xa8, 'Ò': 0xa9, '¬': 0xaa, '½': 0xab, '¼': 0xac, '¡': 0xad, '«': 0xae, '»': 0xaf,
  '°': 0xf8, '·': 0xfa, '±': 0xf1, '²': 0xfd,
};
const CP850: Record<string, number> = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'å': 0x86, 'ç': 0x87, 'ê': 0x88, 'ë': 0x89, 'è': 0x8a, 'ï': 0x8b, 'î': 0x8c, 'ì': 0x8d, 'Ä': 0x8e, 'Å': 0x8f,
  'É': 0x90, 'æ': 0x91, 'Æ': 0x92, 'ô': 0x93, 'ö': 0x94, 'ò': 0x95, 'û': 0x96, 'ù': 0x97, 'ÿ': 0x98, 'Ö': 0x99, 'Ü': 0x9a, 'ø': 0x9b, '£': 0x9c, 'Ø': 0x9d, '×': 0x9e,
  'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ª': 0xa6, 'º': 0xa7, '¿': 0xa8, '¬': 0xaa, '½': 0xab, '¼': 0xac, '¡': 0xad, '«': 0xae, '»': 0xaf,
  'Á': 0xb5, 'Â': 0xb6, 'À': 0xb7, 'ã': 0xc6, 'Ã': 0xc7, 'ð': 0xd0, 'Ê': 0xd2, 'Ë': 0xd3, 'È': 0xd4, 'Í': 0xd6, 'Î': 0xd7, 'Ï': 0xd8, 'Ì': 0xde, 'Ó': 0xe0, 'Ô': 0xe2, 'Ò': 0xe3, 'õ': 0xe4, 'Õ': 0xe5, 'Ú': 0xe9, 'Û': 0xea, 'Ù': 0xeb,
  '°': 0xf8, '·': 0xfa, '±': 0xf1,
};
// Impressoras sem acento (CP437) recebem a letra sem o sinal: melhor "Pao" do que lixo no papel.
const STRIP: Record<string, string> = {};
for (const [a, b] of [['áàâãä', 'a'], ['ÁÀÂÃÄ', 'A'], ['éèêë', 'e'], ['ÉÈÊË', 'E'], ['íìîï', 'i'], ['ÍÌÎÏ', 'I'], ['óòôõö', 'o'], ['ÓÒÔÕÖ', 'O'], ['úùûü', 'u'], ['ÚÙÛÜ', 'U'], ['ç', 'c'], ['Ç', 'C'], ['ñ', 'n'], ['Ñ', 'N']] as const) for (const ch of a) STRIP[ch] = b;
const CP437_OK = new Set('çÇüéâäàåêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥ƒáíóúñÑªº¿¬½¼¡«»°·±²'.split(''));
const PUNCT: Record<string, string> = { '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '•': '*', '€': 'EUR', 'R$': 'R$', ' ': ' ', '×': 'x' };

/** Converte texto Unicode para bytes da página de códigos. Caracteres sem equivalente viram '?'. */
export function encodeText(text: string, cp: Codepage): Uint8Array {
  const out: number[] = [];
  for (const raw of text) {
    const ch = PUNCT[raw] ?? raw;
    for (const c of ch) {
      const code = c.codePointAt(0)!;
      if (code === 0x0a) { out.push(0x0a); continue; }
      if (code >= 0x20 && code < 0x7f) { out.push(code); continue; }
      const table = cp === 'cp860' ? CP860 : cp === 'cp850' ? CP850 : null;
      if (table && table[c] !== undefined) { out.push(table[c]!); continue; }
      if (cp === 'cp437' && CP437_OK.has(c)) { out.push(...encodeCp437Char(c)); continue; }
      const s = STRIP[c];
      out.push(s ? s.charCodeAt(0) : 0x3f);
    }
  }
  return Uint8Array.from(out);
}
const CP437_MAP: Record<string, number> = { 'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'å': 0x86, 'ç': 0x87, 'ê': 0x88, 'ë': 0x89, 'è': 0x8a, 'ï': 0x8b, 'î': 0x8c, 'ì': 0x8d, 'Ä': 0x8e, 'Å': 0x8f, 'É': 0x90, 'æ': 0x91, 'Æ': 0x92, 'ô': 0x93, 'ö': 0x94, 'ò': 0x95, 'û': 0x96, 'ù': 0x97, 'ÿ': 0x98, 'Ö': 0x99, 'Ü': 0x9a, '¢': 0x9b, '£': 0x9c, '¥': 0x9d, 'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ª': 0xa6, 'º': 0xa7, '¿': 0xa8, '¬': 0xaa, '½': 0xab, '¼': 0xac, '¡': 0xad, '«': 0xae, '»': 0xaf, '°': 0xf8, '·': 0xfa, '±': 0xf1, '²': 0xfd };
const encodeCp437Char = (c: string) => [CP437_MAP[c] ?? 0x3f];

/** Largura do texto no papel (cada caractere ocupa uma coluna). */
export const width = (s: string) => [...s].length;
