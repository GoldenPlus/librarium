import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buscarLibro, desdeOpenLibrary, desdeGoogleBooks } from '../js/catalogo.js';
import { isbnDeCodigo } from '../js/isbn.js';

// Respuestas reales recortadas (Open Library, sep 2026).
const edicion = { title: 'Viajes con Heródoto', publish_date: '2008', covers: [15162534], authors: [{ key: '/authors/OL4847283A' }] };
const busqueda = { docs: [{ title: 'Podróże z Herodotem', author_name: ['Ryszard Kapuściński'], first_publish_year: 2004, cover_i: 9323816 }] };
const google = { items: [{ volumeInfo: { title: 'Escrito en el agua', authors: ['Paula Hawkins'], publishedDate: '2017-05-04', imageLinks: { thumbnail: 'http://books.google.com/x?id=1&edge=curl' } } }] };

test('isbnDeCodigo solo acepta EAN-13 de libro válido', () => {
  assert.equal(isbnDeCodigo('9780306406157'), '9780306406157');
  assert.equal(isbnDeCodigo('9770306406157'), null, 'ISSN de revista');
  assert.equal(isbnDeCodigo('8412345678905'), null, 'producto normal');
  assert.equal(isbnDeCodigo('9780306406158'), null, 'dígito de control');
});

test('Open Library: título de la edición, autor de la obra', () => {
  assert.deepEqual(desdeOpenLibrary(edicion, busqueda), {
    titulo: 'Viajes con Heródoto',
    autor: 'Ryszard Kapuściński',
    anio: 2008,
    portada: 'https://covers.openlibrary.org/b/id/15162534-M.jpg',
    fuente: 'Open Library',
  });
  assert.equal(desdeOpenLibrary(null, { docs: [] }), null);
});

test('Google Books: portada por https y año', () => {
  const r = desdeGoogleBooks(google);
  assert.equal(r.portada, 'https://books.google.com/x?id=1');
  assert.equal(r.anio, 2017);
  assert.equal(desdeGoogleBooks({ totalItems: 0 }), null);
});

function fetchFalso(rutas) {
  const pedidas = [];
  const fetch = async (url) => {
    pedidas.push(url);
    const [, cuerpo] = Object.entries(rutas).find(([clave]) => url.includes(clave)) ?? [];
    if (cuerpo === undefined) return { ok: false, status: 404 };
    if (cuerpo instanceof Error) throw cuerpo;
    if (typeof cuerpo === 'number') return { ok: false, status: cuerpo };
    return { ok: true, status: 200, json: async () => cuerpo };
  };
  return { fetch, pedidas };
}

test('con Open Library completo no se consulta Google Books', async () => {
  const f = fetchFalso({ '/isbn/': edicion, 'search.json': busqueda });
  const r = await buscarLibro('9788433973306', { fetch: f.fetch });
  assert.equal(r.titulo, 'Viajes con Heródoto');
  assert.ok(!f.pedidas.some((u) => u.includes('googleapis')));
});

test('sin datos en Open Library se usa Google Books, con clave si la hay', async () => {
  const f = fetchFalso({ googleapis: google });
  const r = await buscarLibro('9788408172178', { fetch: f.fetch, claveGoogle: 'abc' });
  assert.equal(r.titulo, 'Escrito en el agua');
  assert.equal(r.fuente, 'Google Books');
  assert.ok(f.pedidas.some((u) => u.includes('&key=abc')));
});

test('Google Books completa lo que falta en Open Library', async () => {
  const f = fetchFalso({ '/isbn/': { title: 'Escrito en el agua', publish_date: '2017' }, 'search.json': { docs: [] }, googleapis: google });
  const r = await buscarLibro('9788408172178', { fetch: f.fetch });
  assert.equal(r.autor, 'Paula Hawkins');
  assert.equal(r.fuente, 'Open Library y Google Books');
});

test('cuota agotada o sin red: null, sin lanzar', async () => {
  const f = fetchFalso({ openlibrary: new TypeError('Failed to fetch'), googleapis: 429 });
  assert.equal(await buscarLibro('9788408172178', { fetch: f.fetch }), null);
});
