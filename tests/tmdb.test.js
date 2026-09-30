import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearTmdb, desdePelicula, desdeSerie, limpiarNombreColeccion, sagaDeColeccion, resultadoDeBusqueda } from '../js/tmdb.js';
import { construirItem, anadirTemporadas, textoTemporadas, ValidacionError } from '../js/modelo.js';
import { prepararAlta, idSegunFormato, DuplicadoError, SerieExistenteError } from '../js/duplicados.js';

// Formas de respuesta según la documentación de TMDB v3.
const matrix = {
  id: 603, title: 'Matrix', release_date: '1999-03-30', poster_path: '/m.jpg', genres: [{ id: 28, name: 'Acción' }],
  belongs_to_collection: { id: 2344, name: 'Matrix - Colección' },
  credits: { crew: [{ job: 'Director', name: 'Lana Wachowski' }, { job: 'Director', name: 'Lilly Wachowski' }, { job: 'Producer', name: 'Joel Silver' }] },
};
const coleccion = { id: 2344, name: 'Matrix - Colección', parts: [
  { id: 605, release_date: '2003-11-05' }, { id: 603, release_date: '1999-03-30' }, { id: 624860, release_date: '2021-12-16' }, { id: 604, release_date: '2003-05-15' },
] };
const breakingBad = { id: 1396, name: 'Breaking Bad', first_air_date: '2008-01-20', poster_path: '/bb.jpg', number_of_seasons: 5, created_by: [{ name: 'Vince Gilligan' }], genres: [{ id: 18 }] };
const cosmos = { id: 1, name: 'Cosmos', first_air_date: '1980-09-28', number_of_seasons: 1, genres: [{ id: 99 }] };

test('película: directores, año, portada y colección', () => {
  const d = desdePelicula(matrix);
  assert.equal(d.autor, 'Lana Wachowski, Lilly Wachowski');
  assert.equal(d.anio, 1999);
  assert.equal(d.portada, 'https://image.tmdb.org/t/p/w185/m.jpg');
  assert.deepEqual(d.coleccion, { id: 2344, nombre: 'Matrix - Colección' });
  assert.equal(d.documental, false);
});

test('serie: creadores y número de temporadas; documental por género', () => {
  const d = desdeSerie(breakingBad);
  assert.equal(d.autor, 'Vince Gilligan');
  assert.equal(d.temporadas_total, 5);
  assert.equal(desdeSerie(cosmos).documental, true);
  assert.equal(resultadoDeBusqueda({ media_type: 'movie', id: 1, title: 'X', genre_ids: [99] }).documental, true);
});

test('saga de una película: orden por fecha de estreno y total', () => {
  assert.deepEqual(sagaDeColeccion(coleccion, 604), { nombre: 'Matrix', orden: 2, total: 4 });
  assert.equal(limpiarNombreColeccion('El Señor de los Anillos - Colección'), 'El Señor de los Anillos');
  assert.equal(limpiarNombreColeccion('Colección de Harry Potter'), 'Harry Potter');
});

test('clave v3 va en la URL; token v4 en la cabecera; 401 da mensaje claro', async () => {
  const pedidas = [];
  const fetch = async (url, opciones) => {
    pedidas.push({ url, auth: opciones?.headers?.Authorization });
    return { ok: true, status: 200, json: async () => ({ results: [{ media_type: 'person', id: 9 }, { media_type: 'movie', id: 603, title: 'Matrix', release_date: '1999-03-30' }] }) };
  };
  const resultados = await crearTmdb('abc123', { fetch }).buscar('matrix');
  assert.deepEqual(resultados.map((r) => r.id), [603], 'descarta personas');
  assert.match(pedidas[0].url, /api_key=abc123/);
  assert.match(pedidas[0].url, /language=es-ES/);
  await crearTmdb('eyJhbGciOi', { fetch }).buscar('matrix');
  assert.equal(pedidas[1].auth, 'Bearer eyJhbGciOi');
  assert.doesNotMatch(pedidas[1].url, /api_key/);
  const f401 = async () => ({ ok: false, status: 401 });
  await assert.rejects(crearTmdb('mala', { fetch: f401 }).buscar('x'), /clave de TMDB/);
});

const opciones = { nombre: 'Marta', fecha: '2026-10-04', generarId: () => 'manual:x' };

test('el id de TMDB solo se usa en audiovisual', () => {
  assert.equal(construirItem('peliculas', { titulo: 'Matrix', ubicacion: 'A', tmdb: 'movie:603' }, opciones).id, 'tmdb:movie:603');
  assert.equal(construirItem('libros', { titulo: 'X', ubicacion: 'A', tmdb: 'movie:603' }, opciones).id, 'manual:x');
  const serie = construirItem('series', { titulo: 'BB', ubicacion: 'A', tmdb: 'tv:1396', temporadas: '1-2', temporadas_total: '5' }, opciones);
  assert.equal(serie.temporadas_total, 5);
  assert.equal(textoTemporadas(serie), '1–2 (2 de 5)');
});

test('misma película en otro formato: se admite con el formato en el id', () => {
  const dvd = { id: 'tmdb:movie:603', titulo: 'Matrix', formato: 'DVD', ubicacion: 'A' };
  const bluray = idSegunFormato([dvd], { ...dvd, formato: 'Blu-ray' });
  assert.equal(bluray.id, 'tmdb:movie:603:blu-ray');
  assert.throws(() => idSegunFormato([dvd, bluray], { ...dvd, formato: 'blu-ray' }), DuplicadoError);
  assert.throws(() => idSegunFormato([dvd], { ...dvd, formato: '' }), /otra edición/);
  // El aviso de título parecido no salta entre formatos de la misma película.
  assert.equal(prepararAlta([dvd], { ...dvd, formato: 'Blu-ray' }).id, 'tmdb:movie:603:blu-ray');
  // Ni el de número de saga repetido: es otra edición seguro.
  const saga = { id: 'saga:peliculas:matrix', orden: 1 };
  assert.equal(prepararAlta([{ ...dvd, saga }], { ...dvd, formato: 'Blu-ray', saga }).id, 'tmdb:movie:603:blu-ray');
});

test('serie existente: se ofrece añadir temporadas; las repetidas avisan', () => {
  const existente = { id: 'tmdb:tv:1396', titulo: 'Breaking Bad', temporadas: [{ num: 1 }, { num: 2 }], temporadas_total: null };
  assert.throws(() => prepararAlta([existente], { ...existente, temporadas: [{ num: 3 }] }), SerieExistenteError);
  const { item, anadidas, repetidas } = anadirTemporadas(existente, [{ num: 2 }, { num: 3, formato: 'DVD', ubicacion: 'B' }], { nombre: 'X', fecha: 'f', total: 5 });
  assert.deepEqual(item.temporadas.map((t) => t.num), [1, 2, 3]);
  assert.deepEqual([anadidas, repetidas], [[3], [2]]);
  assert.equal(item.temporadas_total, 5);
  assert.throws(() => anadirTemporadas(existente, [{ num: 2 }], { nombre: 'X' }), (e) => e instanceof ValidacionError && /temporada 2/.test(e.message));
});
