import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFeatureChanges, FEATURES } from '../src/features.js';

test('não ativa funcionalidade indisponível nem desconhecida', () => {
  assert.equal(applyFeatureChanges({}, { ai_agent: true }).ok, false);
  assert.equal(applyFeatureChanges({}, { nada: true }).ok, false);
});

test('ativa disponível; desativar a base derruba dependentes', () => {
  const on = applyFeatureChanges({}, { whatsapp_support: true });
  assert.ok(on.ok && on.state.whatsapp_support);
  const cur = { whatsapp_support: true, ai_agent: true, auto_reply: true };
  const off = applyFeatureChanges(cur, { ai_agent: false });
  assert.ok(off.ok && !off.state.ai_agent && !off.state.auto_reply && off.state.whatsapp_support);
  const base = applyFeatureChanges(cur, { whatsapp_support: false });
  assert.ok(base.ok && FEATURES.every((f) => !base.state[f.key]));
});

test('exige dependência ao ativar', () => {
  const r = applyFeatureChanges({ whatsapp_support: true }, { auto_reply: true });
  assert.equal(r.ok, false);
});
