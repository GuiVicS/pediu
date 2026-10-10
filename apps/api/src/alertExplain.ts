/**
 * Explicação em português simples de cada alerta: o que aconteceu, por que importa e o que fazer.
 * Função pura (sem banco): usa só o que o alerta já traz (título, detalhes, parâmetros da regra) para poder ser testada.
 */
export interface Explain { what: string; why: string; steps: string[] }
export interface ExplainInput { ruleKey: string; detail: Record<string, any> | null; params: Record<string, number> | null; storeName?: string | null; now: Date }

const n = (v: unknown) => Number(v ?? 0);
const plural = (c: number, one: string, many: string) => `${c} ${c === 1 ? one : many}`;
/** 95 → "1h35", 40 → "40 min", 0 → "menos de 1 min". */
export const fmtMinutes = (m: number) => (m < 1 ? 'menos de 1 min' : m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, '0')}`);
const since = (iso: unknown, now: Date) => { const t = new Date(String(iso ?? '')).getTime(); return Number.isFinite(t) ? Math.max(0, (now.getTime() - t) / 60_000) : null; };

export function explainAlert(i: ExplainInput): Explain {
  const d = i.detail ?? {}; const p = i.params ?? {}; const loja = i.storeName ?? 'A loja';
  switch (i.ruleKey) {
    case 'store.order_stuck': {
      const age = since(d.oldest, i.now); const count = n(d.orders);
      return {
        what: `${loja} tem ${plural(count, 'pedido novo', 'pedidos novos')} que ninguém aceitou${p.max_minutes ? ` há mais de ${p.max_minutes} min` : ''}${age != null ? `. O mais antigo está esperando há ${fmtMinutes(age)}` : ''}.`,
        why: 'O cliente já fez o pedido (e muitas vezes já pagou) e está sem resposta. Quanto mais demora, maior a chance de cancelar, pedir estorno ou reclamar. A cozinha só começa o preparo depois que o pedido é aceito.',
        steps: ['Veja nos "Detalhes" abaixo quais pedidos estão parados e há quanto tempo.', 'Ligue para a loja: normalmente é a tela do painel/PDV fechada, sem som, ou a internet do local caída.', 'Peça para aceitarem os pedidos agora e, se a loja não vai atender, que cancelem avisando o cliente.', 'Em "Logs relacionados" confira se houve erro de impressão ou do sistema nesse período; se não houver, o problema é da operação da loja, não da plataforma.'],
      };
    }
    case 'store.no_orders':
      return {
        what: `${loja} está sem receber pedidos há ${d.hours ?? p.hours ?? '?'} horas, mas costumava receber (${plural(n(d.ordersBefore), 'pedido', 'pedidos')} no período anterior de comparação).`,
        why: 'Uma queda brusca pode ser só movimento fraco, mas também pode ser a loja fechada sem querer, o cardápio fora do ar, um problema de pagamento ou o link do Instagram/WhatsApp quebrado.',
        steps: ['Abra a loja do cliente como se fosse comprar e veja se o cardápio carrega e se aparece "aberta".', 'Confira em Loja se o horário e o status estão certos e se há formas de pagamento ativas.', 'Veja os logs abaixo: erros de pagamento ou de API para essa loja explicam a queda.', 'Se estiver tudo normal, fale com o dono da loja: pode ser apenas um horário parado.'],
      };
    case 'store.cancel_rate': {
      const pct = Math.round(n(d.rate) * 100);
      return {
        what: `${loja} cancelou ${pct}% dos pedidos recentes (${n(d.cancelled)} de ${n(d.orders)})${p.window_hours ? ` nas últimas ${p.window_hours}h` : ''}.`,
        why: 'Cancelamento alto significa venda perdida e cliente insatisfeito. As causas mais comuns são produto em falta, loja demorando para aceitar, taxa de entrega que assusta o cliente ou falha no pagamento.',
        steps: ['Veja nos "Detalhes" os motivos de cancelamento mais comuns.', 'Se for falta de produto, peça para a loja pausar os itens indisponíveis no cardápio.', 'Se for demora para aceitar, veja se há alertas de "pedidos sem aceite" para a mesma loja.', 'Se forem pedidos online não pagos (Pix expirado), confira se o Mercado Pago/Sicoob está funcionando nos logs.'],
      };
    }
    case 'store.slow_prep':
      return {
        what: `${loja} está levando em média ${Math.round(n(d.avgMinutes))} min para deixar o pedido pronto${p.max_avg_minutes ? ` (o limite configurado é ${p.max_avg_minutes} min)` : ''}, considerando ${plural(n(d.orders), 'pedido', 'pedidos')}.`,
        why: 'Preparo lento atrasa a entrega, esfria o pedido e aumenta reclamações. Pode ser pico de movimento, pouca equipe na cozinha ou pedidos esquecidos sem marcar como "pronto".',
        steps: ['Pergunte à loja se está num pico ou com a cozinha reduzida.', 'Lembre a equipe de marcar o pedido como "pronto" assim que sai: se esquecem, o tempo parece maior do que é.', 'Se for recorrente, sugira aumentar o tempo de preparo informado ao cliente em Loja.'],
      };
    case 'platform.api_errors':
      return {
        what: `A plataforma respondeu com erro interno (5xx) em ${n(d.errors)} de ${n(d.requests)} chamadas${p.window_min ? ` nos últimos ${p.window_min} min` : ''}.`,
        why: 'Erro 5xx é falha do nosso lado, não do cliente. Pode derrubar pedidos, pagamentos e telas de várias lojas ao mesmo tempo.',
        steps: ['Veja os "Logs relacionados": as mensagens de erro mais recentes dizem qual parte está falhando (banco, pagamento, impressão).', 'Se apareceu logo depois de uma atualização, considere voltar a versão anterior.', 'Confira em Saúde se o banco de dados e os serviços estão respondendo.', 'Se o erro é de um provedor externo (Mercado Pago, iFood), aguarde e acompanhe: costuma voltar sozinho.'],
      };
    case 'platform.api_latency':
      return {
        what: `A plataforma está lenta: 95% das chamadas respondem em até ${n(d.p95Ms)} ms${p.max_p95_ms ? `, acima do limite de ${p.max_p95_ms} ms` : ''} (${n(d.requests)} chamadas analisadas).`,
        why: 'Tudo funciona, mas devagar: telas demoram, o PDV trava na hora de lançar o pedido e o cliente desiste do checkout.',
        steps: ['Veja em Desempenho se a lentidão é geral ou de uma loja só.', 'Procure nos logs consultas ou chamadas externas demorando.', 'Se o servidor está com pouca memória ou CPU, vale reiniciar o serviço ou aumentar o plano.'],
      };
    case 'platform.webhook_stuck': {
      const age = since(d.oldest, i.now);
      return {
        what: `${plural(n(d.count), 'aviso', 'avisos')} do ${d.provider ?? 'provedor'} chegou e ainda não foi processado${age != null ? ` (o mais antigo há ${fmtMinutes(age)})` : ''}.`,
        why: 'Webhook é o aviso que o provedor manda quando algo acontece (pagamento aprovado, pedido novo no iFood). Parado, o pagamento fica "aguardando" mesmo já pago e o pedido não chega para a loja.',
        steps: ['Veja os logs abaixo: o erro de processamento costuma estar registrado.', 'Confira se as credenciais do provedor (Mercado Pago, Sicoob, iFood) da loja ainda são válidas.', 'Se foi uma falha momentânea, o sistema tenta de novo; se continuar, avise o suporte técnico.'],
      };
    }
    case 'security.auth_failures':
      return {
        what: `${plural(n(d.failures), 'tentativa de login falhou', 'tentativas de login falharam')}${p.window_min ? ` em ${p.window_min} min` : ''}, vindas de ${plural(n(d.distinctIps), 'endereço (IP)', 'endereços (IPs)')} diferente(s).`,
        why: 'Muitas falhas seguidas podem ser alguém errando a senha — ou um ataque tentando adivinhar senhas. Vários IPs diferentes aumentam a suspeita.',
        steps: ['Veja em "Logs relacionados" de onde vieram as tentativas e a que horas.', 'Se for um funcionário que esqueceu a senha, resolva em Equipe e pode marcar como resolvido.', 'Se parecer ataque (muitos IPs, horários estranhos), o bloqueio automático por tentativas já protege as contas, mas troque as senhas das contas visadas e avise o suporte.'],
      };
    case 'billing.past_due': {
      const age = since(d.since, i.now);
      return {
        what: `${loja} está com a assinatura em atraso${age != null ? ` há ${age >= 1440 ? plural(Math.floor(age / 1440), 'dia', 'dias') : fmtMinutes(age)}` : ''}.`,
        why: 'Se o pagamento continuar pendente, a loja pode ser suspensa e parar de vender.',
        steps: ['Entre em Assinaturas e veja o estado da cobrança no Stripe.', 'Avise o responsável da loja para atualizar o cartão.', 'Defina até quando você tolera antes de suspender.'],
      };
    }
    case 'mcp.token_expiring':
      return {
        what: 'Um token de acesso do MCP (a ferramenta que cria e edita lojas) vai vencer em breve.',
        why: 'Quando vence, quem usa esse token (um assistente de IA, por exemplo) perde o acesso e as automações param.',
        steps: ['Abra Tokens do MCP e gere um token novo.', 'Troque o token antigo onde ele está configurado e revogue o antigo.'],
      };
    default:
      return { what: 'Este alerta foi gerado automaticamente por uma regra de monitoramento.', why: 'A condição configurada na regra foi atingida e merece uma olhada.', steps: ['Veja os detalhes e os logs relacionados abaixo.', 'Quando o problema passar, o alerta se resolve sozinho.'] };
  }
}
