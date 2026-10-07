import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearAlmacen } from '../js/almacen.js';

const memoria = () => {
  const datos = new Map();
  return { getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => datos.set(k, v) };
};

test('recargar trae las claves compartidas y se conservan en la copia local', async () => {
  const cliente = {
    comprobarRepo: async () => {},
    leer: async (fichero) => ({ datos: fichero === 'claves.json' ? { version: 1, tmdb: 'abc' } : { version: 1, items: [] } }),
  };
  const almacenamiento = memoria();
  await crearAlmacen(almacenamiento).recargar(cliente);
  assert.deepEqual(crearAlmacen(almacenamiento).claves, { google: '', tmdb: 'abc' });
});

test('una copia local antigua, sin claves, no rompe', () => {
  const almacenamiento = memoria();
  almacenamiento.setItem('librarium.cache', JSON.stringify({ colecciones: {}, fecha: null }));
  assert.deepEqual(crearAlmacen(almacenamiento).claves, {});
});
