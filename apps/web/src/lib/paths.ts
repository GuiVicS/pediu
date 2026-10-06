import type { Perm } from '@pediu/shared/browser';

// Permissão exigida por cada caminho (o login volta para a página pedida só se o perfil puder abri-la).
const TABLE: [string, Perm][] = [
  ['/pdv', 'pdv'], ['/garcom', 'garcom'], ['/entregador', 'motoboy'], ['/painel/usuarios', 'admin.usuarios'], ['/painel/pedidos', 'admin.pedidos'],
  ['/painel/produtos', 'admin.cardapio'], ['/painel/categorias', 'admin.cardapio'], ['/painel/adicionais', 'admin.cardapio'], ['/painel/destaques', 'admin.cardapio'],
  ['/painel', 'admin.dashboard'],
];
export const permForPath = (p: string): Perm | undefined => TABLE.find(([x]) => p === x || p.startsWith(`${x}/`))?.[1];
