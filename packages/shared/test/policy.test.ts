import test from 'node:test';
import assert from 'node:assert/strict';
import { can, checkTransition, mcpCanRead, mcpCanWrite, ROLE_PERMS, STORE_STATUS, ThemeInput, ProductInput, Slug } from '../src/index.js';

test('perfis: o mesmo que a demo libera', () => {
  assert.equal(can('balcao', 'pdv'), true);
  assert.equal(can('balcao', 'orders.cancel'), false);
  assert.equal(can('garcom', 'motoboy'), false);
  assert.equal(can('suporte', 'admin.cardapio'), false);
  assert.equal(can('suporte', 'admin.usuarios'), false);
  assert.equal(can('gerente', 'admin.usuarios'), false);
  assert.equal(can('gerente', 'pagamentos.estornar'), true);
  assert.equal(can('admin', 'admin.usuarios'), true);
  assert.ok(ROLE_PERMS.entregador.length === 1);
});

test('MCP: escreve só em desenvolvimento e lê tudo menos arquivada', () => {
  for (const s of STORE_STATUS) assert.equal(mcpCanWrite(s), s === 'desenvolvimento');
  // token com permissão de produção: também produção; suspensa e arquivada continuam travadas
  for (const s of STORE_STATUS) assert.equal(mcpCanWrite(s, true), s === 'desenvolvimento' || s === 'producao');
  assert.equal(mcpCanRead('producao'), true);
  assert.equal(mcpCanRead('suspensa'), true);
  assert.equal(mcpCanRead('arquivada'), false);
});

test('transição: o MCP nunca muda status', () => {
  for (const to of STORE_STATUS) assert.equal(checkTransition('desenvolvimento', to, { actor: { kind: 'mcp' } }).ok, false);
});

test('transição: publicar exige step-up e (assinatura ou cortesia)', () => {
  const sa = (stepUp: boolean) => ({ kind: 'superadmin' as const, stepUp });
  assert.equal(checkTransition('desenvolvimento', 'producao', { actor: sa(false), hasActiveSubscription: true }).ok, false);
  assert.equal(checkTransition('desenvolvimento', 'producao', { actor: sa(true) }).ok, false);
  assert.equal(checkTransition('desenvolvimento', 'producao', { actor: sa(true), hasActiveSubscription: true }).ok, true);
  assert.equal(checkTransition('desenvolvimento', 'producao', { actor: sa(true), waiverReason: 'parceiro' }).ok, true);
  assert.equal(checkTransition('desenvolvimento', 'producao', { actor: sa(true), waiverReason: '   ' }).ok, false);
});

test('transição: voltar de produção exige justificativa; arquivada é terminal; cobrança só suspende/reativa', () => {
  const sa = { kind: 'superadmin' as const, stepUp: true };
  assert.equal(checkTransition('producao', 'desenvolvimento', { actor: sa }).ok, false);
  assert.equal(checkTransition('producao', 'desenvolvimento', { actor: sa, reason: 'cliente pediu ajuste' }).ok, true);
  assert.equal(checkTransition('arquivada', 'desenvolvimento', { actor: sa }).ok, false);
  const b = { kind: 'billing' as const };
  assert.equal(checkTransition('producao', 'suspensa', { actor: b }).ok, true);
  assert.equal(checkTransition('suspensa', 'producao', { actor: b }).ok, true);
  assert.equal(checkTransition('desenvolvimento', 'producao', { actor: b }).ok, false);
});

test('schemas: tema aceita parcial e recusa cor/URL inválidas', () => {
  assert.equal(ThemeInput.safeParse({ primary: '#0091FF' }).success, true);
  assert.equal(ThemeInput.safeParse({ primary: 'azul' }).success, false);
  assert.equal(ThemeInput.safeParse({ logoUrl: 'javascript:alert(1)' }).success, false);
  assert.equal(ThemeInput.safeParse({ productGridColumns: 5 }).success, false);
  assert.equal(ProductInput.safeParse({ categoryId: crypto.randomUUID(), name: 'Pizza', price: -1 }).success, false);
  assert.equal(Slug.safeParse('forno-e-fogo').success, true);
  assert.equal(Slug.safeParse('Forno_E_Fogo').success, false);
});
