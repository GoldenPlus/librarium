import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarIsbn } from '../js/isbn.js';

test('acepta ISBN-13 con guiones', () => {
  assert.equal(normalizarIsbn('978-0-306-40615-7'), '9780306406157');
});

test('convierte ISBN-10 a 13', () => {
  assert.equal(normalizarIsbn('0-306-40615-2'), '9780306406157');
  assert.equal(normalizarIsbn('080442957X'), '9780804429573');
});

test('rechaza dígitos de control erróneos y códigos que no son ISBN', () => {
  assert.equal(normalizarIsbn('9780306406158'), null);
  assert.equal(normalizarIsbn('0306406153'), null);
  assert.equal(normalizarIsbn('8412345678905'), null);
  assert.equal(normalizarIsbn(''), null);
});
