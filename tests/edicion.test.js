import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editarItem, sinCambios, aplicarCambios, ValidacionError } from '../js/modelo.js';
import { comprobarEdicion, ParecidoError } from '../js/duplicados.js';

const libro = {
  id: 'isbn:9780306406157', titulo: 'Pedro Páramo', autor: 'Juan Rulfo', anio: 1955, formato: 'Físico',
  ubicacion: 'Estantería 2', portada: '', notas: '', alta_por: 'Marta', alta_fecha: '2026-10-04', mod_por: null, mod_fecha: null,
};
const opciones = { nombre: 'Xabier', fecha: '2026-10-10' };
const campos = (cambios = {}) => ({ titulo: libro.titulo, autor: libro.autor, anio: '1955', formato: libro.formato, ubicacion: libro.ubicacion, notas: '', ...cambios });

test('editar la ubicación conserva id y alta y marca la modificación', () => {
  const editado = editarItem(libro, 'libros', campos({ ubicacion: ' Salón  ' }), opciones);
  assert.equal(editado.ubicacion, 'Salón');
  assert.equal(editado.id, libro.id);
  assert.equal(editado.alta_por, 'Marta');
  assert.equal(editado.mod_por, 'Xabier');
  assert.equal(editado.mod_fecha, '2026-10-10');
  assert.equal(libro.ubicacion, 'Estantería 2', 'no modifica el original');
});

test('sinCambios ignora quién y cuándo', () => {
  assert.ok(sinCambios(libro, editarItem(libro, 'libros', campos(), opciones)));
  assert.ok(!sinCambios(libro, editarItem(libro, 'libros', campos({ notas: 'firmado' }), opciones)));
});

test('formatos antiguos pasan a Físico o Digital al editar', () => {
  assert.equal(editarItem({ ...libro, formato: 'Tapa blanda' }, 'libros', campos({ formato: 'Tapa blanda' }), opciones).formato, 'Físico');
  assert.equal(editarItem(libro, 'libros', campos({ formato: 'digital' }), opciones).formato, 'Digital');
});

test('editar una película quita el director antiguo y conserva el año', () => {
  const peli = { id: 'tmdb:movie:603', titulo: 'Matrix', autor: 'Lana Wachowski', anio: 1999, formato: 'DVD', ubicacion: 'A', notas: '' };
  const editada = editarItem(peli, 'peliculas', { titulo: 'Matrix', autor: 'X', anio: '2000', formato: 'Físico', ubicacion: 'A' }, opciones);
  assert.equal('autor' in editada, false);
  assert.equal(editada.anio, 2000);
  assert.equal(editada.formato, 'Físico');
});

test('editar una serie valida sus temporadas', () => {
  const serie = { id: 'tmdb:tv:1', titulo: 'The Wire', formato: '', ubicacion: '', notas: '', temporadas: [{ num: 1, formato: 'DVD', ubicacion: 'A' }] };
  const filas = [{ num: '2', formato: 'Digital', ubicacion: 'B' }, { num: '1', formato: 'DVD', ubicacion: 'A' }];
  const editada = editarItem(serie, 'series', { titulo: 'The Wire', temporadasDetalle: filas }, opciones);
  assert.deepEqual(editada.temporadas.map((t) => [t.num, t.formato]), [[1, 'Físico'], [2, 'Digital']]);
  assert.throws(() => editarItem(serie, 'series', { titulo: 'X', temporadasDetalle: [{ num: '1', ubicacion: '' }] }, opciones), /ubicación de la temporada 1/);
  assert.throws(() => editarItem(serie, 'series', { titulo: 'X', temporadasDetalle: [{ num: '1', ubicacion: 'A' }, { num: '1', ubicacion: 'B' }] }, opciones), /repetida/);
  assert.throws(() => editarItem(serie, 'series', { titulo: 'X', temporadasDetalle: [] }, opciones), ValidacionError);
});

test('aplicarCambios no pisa lo que otra persona cambió en otro campo', () => {
  const mio = editarItem(libro, 'libros', campos({ ubicacion: 'Salón' }), opciones);
  const fresco = { ...libro, notas: 'Dedicado', mod_por: 'Marta' };
  const resultado = aplicarCambios(fresco, libro, mio);
  assert.equal(resultado.ubicacion, 'Salón');
  assert.equal(resultado.notas, 'Dedicado');
  assert.equal(resultado.mod_por, 'Xabier');
});

test('aplicarCambios quita la saga si la edición la quita', () => {
  const conSaga = { ...libro, saga: { id: 'saga:libros:x', orden: 1 } };
  const { saga, ...sinSaga } = conSaga;
  assert.equal('saga' in aplicarCambios(conSaga, conSaga, sinSaga), false);
});

test('comprobarEdicion solo avisa si cambia el título o la saga', () => {
  const otro = { id: 'manual:1', titulo: 'Pedro Paramo', autor: 'J. Rulfo', saga: { id: 'saga:libros:x', orden: 1 } };
  const items = [libro, otro];
  assert.doesNotThrow(() => comprobarEdicion(items, libro, { ...libro, ubicacion: 'Salón' }), 'cambiar la ubicación no avisa aunque haya otro parecido');
  assert.throws(() => comprobarEdicion(items, libro, { ...libro, titulo: 'Pedro Páramo.' }), ParecidoError);
  assert.throws(() => comprobarEdicion(items, libro, { ...libro, saga: { id: 'saga:libros:x', orden: 1 } }), /número 1/);
  assert.doesNotThrow(() => comprobarEdicion(items, libro, { ...libro, saga: { id: 'saga:libros:x', orden: 1 } }, { forzar: true }));
});

test('al editar, una foto nueva sustituye la portada y sin portada se conserva', () => {
  const conFoto = editarItem({ ...libro, portada: 'https://covers.openlibrary.org/b/id/1-M.jpg' }, 'libros', campos({ portada: 'repo:portadas/abc123.jpg' }), opciones);
  assert.equal(conFoto.portada, 'repo:portadas/abc123.jpg');
  const sin = editarItem({ ...libro, portada: 'https://covers.openlibrary.org/b/id/1-M.jpg' }, 'libros', campos({ portada: '' }), opciones);
  assert.equal(sin.portada, 'https://covers.openlibrary.org/b/id/1-M.jpg');
  assert.equal(editarItem(libro, 'libros', campos({ portada: 'javascript:alert(1)' }), opciones).portada, libro.portada);
});
