import type { Role } from '@pediu/shared/browser';
export const ROLE_LABEL: Record<Role, string> = { admin: 'Administrador', gerente: 'Gerente', suporte: 'Suporte', balcao: 'Balcão', garcom: 'Garçom', entregador: 'Entregador' };
export const ROLE_DESC: Record<Role, string> = {
  admin: 'Acesso total, inclusive equipe.', gerente: 'Opera tudo e configura a loja, sem mexer na equipe.', suporte: 'Acompanha pedidos e ajuda a equipe.',
  balcao: 'Vende e recebe no PDV.', garcom: 'Atende mesas e comandas.', entregador: 'Vê e conclui as entregas.',
};
