import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construirItem, parsearTemporadas, resumirTemporadas, ubicacionesDe, ValidacionError } from '../js/modelo.js';

const opciones = { nombre: 'Marta', fecha: '2026-10-04', generarId: () => 'manual:abc123' };

test('libro con ISBN-10 usa id isbn de 13 dígitos', () => {
  const item = construirItem('libros', { titulo: ' Pedro  Páramo ', autor: 'Juan Rulfo', anio: '1955', ubicacion: 'Estantería 2', isbn: '0-306-40615-2' }, opciones);
  assert.equal(item.id, 'isbn:9780306406157');
  assert.equal(item.titulo, 'Pedro Páramo');
  assert.equal(item.anio, 1955);
  assert.equal(item.alta_por, 'Marta');
  assert.equal(item.alta_fecha, '2026-10-04');
  assert.equal(item.mod_por, null);
});

test('sin ISBN el id es manual', () => {
  const item = construirItem('peliculas', { titulo: 'Alien', ubicacion: 'Mueble TV' }, opciones);
  assert.equal(item.id, 'manual:abc123');
});

test('películas, series y documentales guardan año pero no director', () => {
  const item = construirItem('peliculas', { titulo: 'Alien', autor: 'Ridley Scott', anio: '1979', ubicacion: 'Mueble TV' }, opciones);
  assert.equal('autor' in item, false);
  assert.equal(item.anio, 1979);
});

test('formato por defecto: Físico en libros y cómics, Digital en audiovisual', () => {
  assert.equal(construirItem('libros', { titulo: 'X', ubicacion: 'A' }, opciones).formato, 'Físico');
  assert.equal(construirItem('comics', { titulo: 'X', ubicacion: 'A' }, opciones).formato, 'Físico');
  assert.equal(construirItem('peliculas', { titulo: 'X', ubicacion: 'A' }, opciones).formato, 'Digital');
  assert.equal(construirItem('documentales', { titulo: 'X', ubicacion: 'A' }, opciones).formato, 'Digital');
  assert.equal(construirItem('libros', { titulo: 'X', ubicacion: 'A', formato: 'Digital' }, opciones).formato, 'Digital');
});

test('título y ubicación son obligatorios', () => {
  assert.throws(() => construirItem('libros', { titulo: '', ubicacion: 'X' }, opciones), ValidacionError);
  assert.throws(() => construirItem('libros', { titulo: 'X', ubicacion: '  ' }, opciones), ValidacionError);
  assert.throws(() => construirItem('libros', { titulo: 'X', ubicacion: 'Y', isbn: '123' }, opciones), /ISBN/);
});

test('las series guardan formato y ubicación en cada temporada', () => {
  const item = construirItem('series', { titulo: 'Breaking Bad', formato: 'Físico', ubicacion: 'Estantería 3', temporadas: '1-2' }, opciones);
  assert.deepEqual(item.temporadas, [
    { num: 1, formato: 'Físico', ubicacion: 'Estantería 3' },
    { num: 2, formato: 'Físico', ubicacion: 'Estantería 3' },
  ]);
  assert.equal(item.formato, '');
  assert.equal(item.ubicacion, '');
  assert.throws(() => construirItem('series', { titulo: 'X', ubicacion: 'Y', temporadas: '' }, opciones), /temporadas/);
});

test('documentales: película sin temporadas, docuserie con temporadas', () => {
  const peli = construirItem('documentales', { titulo: 'Planeta', ubicacion: 'A', subtipo: 'pelicula' }, opciones);
  assert.equal(peli.subtipo, 'pelicula');
  assert.equal(peli.temporadas, undefined);
  const serie = construirItem('documentales', { titulo: 'Cosmos', ubicacion: 'A', subtipo: 'serie', temporadas: '1' }, opciones);
  assert.equal(serie.temporadas.length, 1);
});

test('parsear y resumir temporadas', () => {
  assert.deepEqual(parsearTemporadas('1-3, 5 3'), [1, 2, 3, 5]);
  assert.throws(() => parsearTemporadas('uno'), ValidacionError);
  assert.throws(() => parsearTemporadas('3-1'), ValidacionError);
  assert.equal(resumirTemporadas([1, 2, 3, 5].map((num) => ({ num }))), '1–3, 5');
});

test('ubicaciones únicas sin distinguir mayúsculas', () => {
  const items = [{ ubicacion: 'Estantería 2' }, { ubicacion: 'estantería 2' }, { temporadas: [{ ubicacion: 'Disco duro' }] }];
  assert.deepEqual(ubicacionesDe(items), ['Disco duro', 'Estantería 2']);
});

test('la portada puede ser una foto del repo, pero no cualquier cosa', () => {
  assert.equal(construirItem('libros', { titulo: 'X', ubicacion: 'A', portada: 'repo:portadas/abc-123.jpg' }, opciones).portada, 'repo:portadas/abc-123.jpg');
  assert.equal(construirItem('libros', { titulo: 'X', ubicacion: 'A', portada: 'repo:../claves.json' }, opciones).portada, '');
  assert.equal(construirItem('libros', { titulo: 'X', ubicacion: 'A', portada: 'http://x/y.jpg' }, opciones).portada, '');
});
