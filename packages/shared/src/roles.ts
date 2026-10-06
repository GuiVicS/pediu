/** Perfis da equipe de uma loja e o que cada um libera. Mesma matriz da demo (pediu-mvp/src/lib/auth.tsx), agora aplicada no servidor. */
export const ROLES = ['admin', 'gerente', 'suporte', 'balcao', 'garcom', 'entregador'] as const;
export type Role = (typeof ROLES)[number];

export const PERMS = [
  'pdv', 'garcom', 'motoboy', 'orders.cancel', 'pagamentos.estornar',
  'admin.dashboard', 'admin.pedidos', 'admin.cardapio', 'admin.loja', 'admin.usuarios',
] as const;
export type Perm = (typeof PERMS)[number];

export const ROLE_PERMS: Record<Role, readonly Perm[]> = {
  admin: PERMS,
  gerente: ['pdv', 'garcom', 'motoboy', 'orders.cancel', 'pagamentos.estornar', 'admin.dashboard', 'admin.pedidos', 'admin.cardapio', 'admin.loja'],
  suporte: ['pdv', 'garcom', 'motoboy', 'orders.cancel', 'admin.dashboard', 'admin.pedidos'],
  balcao: ['pdv'],
  garcom: ['garcom'],
  entregador: ['motoboy'],
};

export const can = (role: Role, perm: Perm) => ROLE_PERMS[role].includes(perm);
