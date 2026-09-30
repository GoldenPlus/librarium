import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buscarDuplicados, comprobarDuplicados, DuplicadoError, ParecidoError } from '../js/duplicados.js';

const existentes = [
  { id: 'isbn:9780306406157', titulo: 'Pedro Páramo', autor: 'Juan Rulfo', ubicacion: 'Estantería 2' },
  { id: 'manual:1', titulo: 'El nombre de la rosa', autor: 'Umberto Eco', ubicacion: 'Salón' },
];

test('mismo id bloquea e indica dónde está', () => {
  assert.throws(
    () => comprobarDuplicados(existentes, { id: 'isbn:9780306406157', titulo: 'Otro' }),
    (e) => e instanceof DuplicadoError && /Estantería 2/.test(e.message),
  );
  // Ni siquiera forzando.
  assert.throws(() => comprobarDuplicados(existentes, { id: 'isbn:9780306406157', titulo: 'Otro' }, { forzar: true }), DuplicadoError);
});

test('título parecido sin tildes ni artículo avisa, y se puede forzar', () => {
  const candidato = { id: 'manual:2', titulo: 'nombre de la Rosa', autor: 'Eco' };
  assert.throws(() => comprobarDuplicados(existentes, candidato), ParecidoError);
  assert.doesNotThrow(() => comprobarDuplicados(existentes, candidato, { forzar: true }));
});

test('pequeñas erratas cuentan como parecido', () => {
  const { parecidos } = buscarDuplicados(existentes, { id: 'manual:3', titulo: 'Pedro Paramo.', autor: 'J. Rulfo' });
  assert.equal(parecidos.length, 1);
});

test('mismo título con autor distinto no avisa', () => {
  const { parecidos } = buscarDuplicados(existentes, { id: 'manual:4', titulo: 'Pedro Páramo', autor: 'Gabriel García Márquez' });
  assert.equal(parecidos.length, 0);
});

test('títulos distintos no avisan', () => {
  const { mismoId, parecidos } = buscarDuplicados(existentes, { id: 'manual:5', titulo: 'Ficciones', autor: 'Borges' });
  assert.equal(mismoId, null);
  assert.equal(parecidos.length, 0);
});
