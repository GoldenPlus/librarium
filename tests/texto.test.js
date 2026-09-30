import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizar, sinArticulo, limpiar, similitud } from '../js/texto.js';
import { terminosDe, coincide } from '../js/busqueda.js';

test('normalizar quita tildes, mayúsculas y signos', () => {
  assert.equal(normalizar('Pedro Páramo'), 'pedro paramo');
  assert.equal(normalizar('¡España, 1984!'), 'espana 1984');
});

test('sinArticulo quita solo el artículo inicial', () => {
  assert.equal(sinArticulo('El Señor de los Anillos'), 'senor de los anillos');
  assert.equal(sinArticulo('The Matrix'), 'matrix');
  assert.equal(sinArticulo('La'), 'la');
});

test('limpiar quita espacios sobrantes', () => {
  assert.equal(limpiar('  Estantería   2 '), 'Estantería 2');
});

test('similitud', () => {
  assert.equal(similitud('abc', 'abc'), 1);
  assert.ok(similitud('pedro paramo', 'pedro paramos') > 0.9);
});

test('la búsqueda de «paramo» encuentra «Pedro Páramo»', () => {
  const item = { titulo: 'Pedro Páramo', autor: 'Juan Rulfo', ubicacion: 'Estantería 2' };
  assert.ok(coincide(item, terminosDe('paramo')));
  assert.ok(coincide(item, terminosDe('RULFO estanteria')));
  assert.ok(!coincide(item, terminosDe('borges')));
});

test('la búsqueda mira las ubicaciones de las temporadas', () => {
  const serie = { titulo: 'Breaking Bad', temporadas: [{ num: 1, ubicacion: 'Disco duro 4' }] };
  assert.ok(coincide(serie, terminosDe('disco duro')));
});
