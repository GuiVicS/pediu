import { CODEPAGE_ID, encodeText, width, type Codepage } from './codepage.js';

const ESC = 0x1b, GS = 0x1d, LF = 0x0a;

/** Monta a sequência de bytes ESC/POS e, ao mesmo tempo, o mesmo cupom em texto (para pré-visualizar na tela). */
export class EscPos {
  private bytes: number[] = [];
  private lines: string[] = [];
  private cur = '';
  private size = 1;
  constructor(readonly columns = 48, readonly codepage: Codepage = 'cp860') {
    this.raw(ESC, 0x40);                                          // inicializa
    this.raw(ESC, 0x74, CODEPAGE_ID[codepage]);                   // página de códigos
  }
  private raw(...b: number[]) { this.bytes.push(...b); return this; }
  private push(u: Uint8Array) { for (const x of u) this.bytes.push(x); }
  /** Colunas efetivas: em fonte dupla cabe metade. */
  private get cols() { return Math.floor(this.columns / this.size); }

  align(a: 'left' | 'center' | 'right') { return this.raw(ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2); }
  bold(on: boolean) { return this.raw(ESC, 0x45, on ? 1 : 0); }
  /** 1 = normal, 2 = largura e altura dobradas. */
  big(n: 1 | 2) { this.size = n; return this.raw(GS, 0x21, n === 2 ? 0x11 : 0x00); }
  invert(on: boolean) { return this.raw(GS, 0x42, on ? 1 : 0); }

  text(s: string) { this.push(encodeText(s, this.codepage)); this.cur += s; return this; }
  nl() { this.raw(LF); this.lines.push(this.cur); this.cur = ''; return this; }
  line(s = '') { return this.text(s).nl(); }

  /** Quebra o texto em linhas da largura do papel, sem partir palavras (exceto palavras maiores que a linha). */
  wrap(s: string, indent = 0) {
    const max = Math.max(8, this.cols - indent);
    const pad = ' '.repeat(indent);
    for (const para of s.split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        let w = word;
        while (width(w) > max) { if (line) { this.line(pad + line); line = ''; } this.line(pad + [...w].slice(0, max).join('')); w = [...w].slice(max).join(''); }
        if (!line) line = w; else if (width(line) + 1 + width(w) <= max) line += ' ' + w; else { this.line(pad + line); line = w; }
      }
      this.line(pad + line);
    }
    return this;
  }

  /** "esquerda ........ direita" na largura do papel. Se não couber, a esquerda é quebrada e a direita fica na última linha. */
  row(left: string, right: string) {
    const cols = this.cols;
    const r = right ? ' ' + right : '';
    const room = cols - width(r);
    if (width(left) <= room) return this.line(left + ' '.repeat(room - width(left)) + r);
    const chunks: string[] = []; let rest = [...left];
    while (rest.length > room) { chunks.push(rest.slice(0, room).join('')); rest = rest.slice(room); }
    for (const c of chunks) this.line(c);
    return this.line(rest.join('') + ' '.repeat(Math.max(0, room - rest.length)) + r);
  }
  rule(ch = '-') { return this.line(ch.repeat(this.cols)); }
  feed(n = 1) { for (let i = 0; i < n; i++) this.nl(); return this; }

  /** QR Code nativo (GS ( k). O texto do QR deve ser ASCII (URL, copia-e-cola do Pix). */
  qr(data: string, moduleSize = 6) {
    const d = new TextEncoder().encode(data);
    const len = d.length + 3;
    this.raw(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0);                          // modelo 2
    this.raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, Math.min(16, Math.max(1, moduleSize)));
    this.raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31);                              // correção L? 0x31 = M
    this.raw(GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30, ...d);
    this.raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30);                              // imprime
    this.lines.push(`[QR: ${data.length > 40 ? data.slice(0, 37) + '...' : data}]`);
    return this;
  }
  beep(times = 2) { return this.raw(ESC, 0x42, Math.min(9, times), 2); }           // ESC B n t (nem toda impressora tem buzzer)
  cut(partial = true) { return this.raw(GS, 0x56, partial ? 66 : 65, 3); }
  openDrawer() { return this.raw(ESC, 0x70, 0, 25, 250); }

  build(): Uint8Array { return Uint8Array.from(this.bytes); }
  preview(): string { return [...this.lines, ...(this.cur ? [this.cur] : [])].join('\n'); }
}

export const toBase64 = (u: Uint8Array) => (typeof Buffer !== 'undefined' ? Buffer.from(u).toString('base64') : btoa(String.fromCharCode(...u)));
export const fromBase64 = (s: string) => (typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(s, 'base64')) : Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
