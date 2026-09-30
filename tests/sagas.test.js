import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idSaga, leerCamposSaga, asegurarSaga, estadoSaga } from '../js/sagas.js';
import { comprobarDuplicados, ParecidoError } from '../js/duplicados.js';
import { ValidacionError } from '../js/modelo.js';

test('idSaga sin tildes ni espacios, con el tipo', () => {
  assert.equal(idSaga('libros', 'El Señor de los Anillos'), 'saga:libros:el-senor-de-los-anillos');
  assert.equal(idSaga('libros', '  el señor  de los ANILLOS'), idSaga('libros', 'El Señor de los Anillos'));
});

test('leerCamposSaga', () => {
  assert.equal(leerCamposSaga('libros', { saga: '', saga_orden: '', saga_total: '' }), null);
  assert.deepEqual(leerCamposSaga('libros', { saga: 'Dune', saga_orden: '2', saga_total: '6' }), { id: 'saga:libros:dune', nombre: 'Dune', orden: 2, total: 6 });
  assert.throws(() => leerCamposSaga('libros', { saga: 'Dune', saga_orden: '' }), /número/);
  assert.throws(() => leerCamposSaga('libros', { saga: '', saga_orden: '2' }), ValidacionError);
  assert.throws(() => leerCamposSaga('libros', { saga: 'Dune', saga_orden: '7', saga_total: '6' }), /mayor/);
});

test('asegurarSaga crea una vez y actualiza el total', () => {
  const vacio = { version: 1, items: [] };
  const creada = asegurarSaga(vacio, 'libros', { id: 'saga:libros:dune', nombre: 'Dune', total: null });
  assert.deepEqual(creada.items, [{ id: 'saga:libros:dune', nombre: 'Dune', tipo: 'libros', total: null }]);
  assert.equal(asegurarSaga(creada, 'libros', { id: 'saga:libros:dune', nombre: 'dune', total: null }), null);
  assert.equal(asegurarSaga(creada, 'libros', { id: 'saga:libros:dune', nombre: 'Dune', total: 6 }).items[0].total, 6);
});

test('estadoSaga: «2 de 3» y el que falta', () => {
  const saga = { id: 's', total: 3 };
  const miembros = [{ saga: { id: 's', orden: 1 } }, { saga: { id: 's', orden: 3 } }];
  assert.deepEqual(estadoSaga(saga, miembros), { ordenes: [1, 3], faltan: [2], texto: '2 de 3' });
  assert.deepEqual(estadoSaga({ id: 's', total: null }, miembros).faltan, [2], 'sin total, los huecos hasta el mayor');
});

test('número de orden repetido en una saga avisa y se puede forzar', () => {
  const items = [{ id: 'manual:1', titulo: 'Las dos torres', saga: { id: 'saga:libros:sda', orden: 2 } }];
  const candidato = { id: 'manual:2', titulo: 'Las Dos Torres (ed. ilustrada)', autor: '', saga: { id: 'saga:libros:sda', orden: 2 } };
  assert.throws(() => comprobarDuplicados(items, { ...candidato, titulo: 'Otra cosa' }), (e) => e instanceof ParecidoError && /número 2/.test(e.message));
  assert.doesNotThrow(() => comprobarDuplicados(items, candidato, { forzar: true }));
});
