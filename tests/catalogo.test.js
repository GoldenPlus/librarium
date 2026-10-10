import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buscarLibro, buscarPorTitulo, resultadosGoogle, sagaDelTitulo, desdeOpenLibrary, desdeGoogleBooks, motivoFalloGoogle } from '../js/catalogo.js';
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
    saga: null,
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
  const { libro: r, errorGoogle } = await buscarLibro('9788433973306', { fetch: f.fetch });
  assert.equal(errorGoogle, null);
  assert.equal(r.titulo, 'Viajes con Heródoto');
  assert.ok(!f.pedidas.some((u) => u.includes('googleapis')));
});

test('sin datos en Open Library se usa Google Books, con clave si la hay', async () => {
  const f = fetchFalso({ googleapis: google });
  const { libro: r } = await buscarLibro('9788408172178', { fetch: f.fetch, claveGoogle: 'abc' });
  assert.equal(r.titulo, 'Escrito en el agua');
  assert.equal(r.fuente, 'Google Books');
  assert.ok(f.pedidas.some((u) => u.includes('&key=abc')));
});

test('Google Books completa lo que falta en Open Library', async () => {
  const f = fetchFalso({ '/isbn/': { title: 'Escrito en el agua', publish_date: '2017' }, 'search.json': { docs: [] }, googleapis: google });
  const { libro: r } = await buscarLibro('9788408172178', { fetch: f.fetch });
  assert.equal(r.autor, 'Paula Hawkins');
  assert.equal(r.fuente, 'Open Library y Google Books');
});

test('cuota agotada o sin red: sin libro y con el motivo, sin lanzar', async () => {
  const f = fetchFalso({ openlibrary: new TypeError('Failed to fetch'), googleapis: 429 });
  assert.deepEqual(await buscarLibro('9788408172178', { fetch: f.fetch }), { libro: null, errorGoogle: 'se ha agotado la cuota diaria de consultas' });
  const sinRed = fetchFalso({ openlibrary: new TypeError('Failed to fetch'), googleapis: new TypeError('Failed to fetch') });
  assert.equal((await buscarLibro('9788408172178', { fetch: sinRed.fetch })).errorGoogle, 'no hay conexión');
});

test('Google Books sin el libro no es un error', async () => {
  const f = fetchFalso({ googleapis: { kind: 'books#volumes', totalItems: 0 } });
  assert.deepEqual(await buscarLibro('9788408172178', { fetch: f.fetch }), { libro: null, errorGoogle: null });
});

test('motivo del fallo de Google Books', () => {
  assert.equal(motivoFalloGoogle(400, 'API key not valid. Please pass a valid API key.'), 'la clave de Google Books no es válida');
  assert.equal(motivoFalloGoogle(403, "Quota exceeded for quota metric 'Queries'"), 'se ha agotado la cuota diaria de consultas');
  assert.equal(motivoFalloGoogle(500), 'error 500');
});

test('si «isbn:» no lo encuentra, se busca el número suelto y solo vale un resultado con ese ISBN', async () => {
  const pedidas = [];
  const conIsbn = { items: [
    { volumeInfo: { title: 'Otro libro', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780306406157' }] } },
    { volumeInfo: { title: 'Morte', authors: ['Autor'], industryIdentifiers: [{ type: 'ISBN_10', identifier: '8499954634' }] } },
  ] };
  const fetch = async (url) => {
    pedidas.push(url);
    if (url.includes('openlibrary')) return { ok: false, status: 404 };
    const cuerpo = url.includes('q=isbn:') ? { totalItems: 0 } : conIsbn;
    return { ok: true, status: 200, json: async () => cuerpo };
  };
  const { libro, errorGoogle } = await buscarLibro('9788499954639', { fetch, claveGoogle: 'abc' });
  assert.equal(errorGoogle, null);
  assert.equal(libro.titulo, 'Morte');
  assert.ok(pedidas.some((u) => u.endsWith('?q=9788499954639&key=abc')));
  assert.equal(desdeGoogleBooks({ items: conIsbn.items.slice(0, 1) }, '9788499954639'), null, 'un resultado sin ese ISBN no vale');
});

test('por título: Google Books primero, con autor si lo hay', async () => {
  const f = fetchFalso({ googleapis: google });
  const { resultados, errorGoogle } = await buscarPorTitulo('Escrito en el agua', { autor: 'Hawkins', fetch: f.fetch });
  assert.equal(errorGoogle, null);
  assert.deepEqual(resultados.map((r) => r.titulo), ['Escrito en el agua']);
  assert.ok(f.pedidas[0].includes(encodeURIComponent('intitle:Escrito en el agua inauthor:Hawkins')));
  assert.ok(!f.pedidas.some((u) => u.includes('openlibrary')));
});

test('por título: sin nada en Google Books se usa Open Library, y se avisa si Google falló', async () => {
  const f = fetchFalso({ googleapis: 429, 'search.json': busqueda });
  const { resultados, errorGoogle } = await buscarPorTitulo('Podróże', { fetch: f.fetch });
  assert.equal(resultados[0].autor, 'Ryszard Kapuściński');
  assert.equal(resultados[0].fuente, 'Open Library');
  assert.equal(errorGoogle, 'se ha agotado la cuota diaria de consultas');
});

test('saga escrita en el título o el subtítulo', () => {
  assert.deepEqual(sagaDelTitulo('La vieja guardia nº 01/06'), { nombre: 'La vieja guardia', orden: 1, total: 6 });
  assert.deepEqual(sagaDelTitulo('La vieja guardia 01 de 06'), { nombre: 'La vieja guardia', orden: 1, total: 6 });
  assert.deepEqual(sagaDelTitulo('La vieja guardia', '01 de 06'), { nombre: 'La vieja guardia', orden: 1, total: 6 });
  assert.deepEqual(sagaDelTitulo('Saga - Tomo 3/9'), { nombre: 'Saga', orden: 3, total: 9 });
  assert.deepEqual(sagaDelTitulo('El nombre del viento (Crónica del asesino de reyes, #1)'), { nombre: 'Crónica del asesino de reyes', orden: 1, total: null });
  assert.equal(sagaDelTitulo('1984'), null);
  assert.equal(sagaDelTitulo('Cien años de soledad'), null);
  assert.equal(sagaDelTitulo('Algo 7 de 3'), null, 'el número no puede pasar del total');
});

test('Google Books trae la saga del título', () => {
  const r = desdeGoogleBooks({ items: [{ volumeInfo: { title: 'La vieja guardia nº 01/06', authors: ['Greg Rucka'] } }] });
  assert.deepEqual(r.saga, { nombre: 'La vieja guardia', orden: 1, total: 6 });
});

test('por título, Google Books trae el ISBN de esa edición', () => {
  const json = { items: [
    { volumeInfo: { title: 'La sombra del viento', industryIdentifiers: [{ type: 'ISBN_10', identifier: '8408043641' }, { type: 'ISBN_13', identifier: '9788408043645' }] } },
    { volumeInfo: { title: 'Sin ISBN', industryIdentifiers: [{ type: 'OTHER', identifier: 'UOM:39015' }] } },
  ] };
  assert.deepEqual(resultadosGoogle(json).map((r) => r.isbn), ['9788408043645', '']);
});
