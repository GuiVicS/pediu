import test from 'node:test';
import assert from 'node:assert/strict';
import { composeAddress, maskCep, maskCpf, maskPhone, onlyDigits, validCep, validCpf, validEmail, validPhone } from '../src/store/checkout/format.js';

test('máscaras: telefone, CEP e CPF aceitam digitação parcial e ignoram letras', () => {
  assert.equal(maskPhone('1'), '1'); assert.equal(maskPhone('16'), '16'); assert.equal(maskPhone('169'), '(16) 9');
  assert.equal(maskPhone('1632221111'), '(16) 3222-1111'); assert.equal(maskPhone('16999990000'), '(16) 99999-0000');
  assert.equal(maskPhone('(16) 99999-0000 99'), '(16) 99999-0000');           // passou do limite: corta
  assert.equal(maskCep('14402151'), '14402-151'); assert.equal(maskCep('1440'), '1440'); assert.equal(maskCep('14a40b2-151'), '14402-151');
  assert.equal(maskCpf('12345678909'), '123.456.789-09'); assert.equal(maskCpf('1234'), '123.4');
  assert.equal(onlyDigits('(16) 9-9999'), '1699999');
});

test('CPF: confere os dígitos verificadores e rejeita sequências repetidas', () => {
  assert.equal(validCpf('529.982.247-25'), true); assert.equal(validCpf('52998224725'), true);
  assert.equal(validCpf('529.982.247-24'), false);
  assert.equal(validCpf('111.111.111-11'), false); assert.equal(validCpf('123'), false); assert.equal(validCpf(''), false);
});

test('validações de e-mail, telefone e CEP', () => {
  assert.equal(validEmail('maria@gmail.com'), true); assert.equal(validEmail(' maria@gmail.com '), true);
  assert.equal(validEmail('maria@gmail'), false); assert.equal(validEmail('gv671930gmail.com'), false); assert.equal(validEmail('a b@c.com'), false);
  assert.equal(validPhone('(16) 99999-0000'), true); assert.equal(validPhone('(16) 3222-1111'), true); assert.equal(validPhone('99999-0000'), false);
  assert.equal(validCep('14402-151'), true); assert.equal(validCep('14402'), false);
});

test('composeAddress: uma linha para cozinha e entregador, sem vírgulas sobrando', () => {
  const base = { cep: '14402151', street: 'Rua Eurípedes Barcaroli', number: '125', complement: '', district: 'Jardim Palma', city: 'Franca', uf: 'sp' };
  assert.equal(composeAddress(base), 'Rua Eurípedes Barcaroli, 125, Jardim Palma, Franca-SP, CEP 14402-151');
  assert.equal(composeAddress({ ...base, complement: 'apto 3' }), 'Rua Eurípedes Barcaroli, 125 - apto 3, Jardim Palma, Franca-SP, CEP 14402-151');
  assert.equal(composeAddress({ cep: '', street: 'Rua A', number: '', complement: '', district: '', city: '', uf: '' }), 'Rua A');
  assert.ok(composeAddress({ ...base, street: 'x'.repeat(300) }).length <= 170);
});
