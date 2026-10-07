// Disparos: um destinatário por vez, no ritmo ditado pelo servidor. Envio sem resultado conhecido NUNCA é repetido
// (o servidor marca como "incerto"); só falhas definitivas do WhatsApp são reportadas como falha.
export class BridgeError extends Error { constructor(message: string, public uncertain: boolean) { super(message); } }

export interface BroadcastDeps {
  features: () => Set<string>;
  api: {
    nextBroadcast(): Promise<{ none: true; waitSeconds: number } | { none: false; recipientId: string; phone: string; text: string }>;
    broadcastResult(id: string, status: 'enviada' | 'falhou', error?: string): Promise<unknown>;
  };
  send(chatId: string, text: string, newChat: boolean): Promise<string>;
}

/** Retorna true se enviou alguém neste ciclo. */
export async function tickBroadcast(d: BroadcastDeps): Promise<boolean> {
  if (!d.features().has('broadcasts')) return false;
  const n = await d.api.nextBroadcast();
  if (n.none) return false;
  try {
    await d.send(`${n.phone}@c.us`, n.text, true);
  } catch (e) {
    // dúvida se saiu (ex.: tempo esgotado): não reporta, para o servidor marcar como incerto em vez de reenviar
    if (e instanceof BridgeError && e.uncertain) return false;
    await d.api.broadcastResult(n.recipientId, 'falhou', (e as Error).message.slice(0, 200)).catch(() => {});
    return false;
  }
  // se o relato do resultado falhar, o envio fica "incerto" no servidor — o que é o correto: nunca reenviar
  await d.api.broadcastResult(n.recipientId, 'enviada').catch(() => {});
  return true;
}
