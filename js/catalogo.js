// Datos de libros por ISBN (Open Library y, si falta algo, Google Books) y búsqueda por título.

import { normalizarIsbn } from './isbn.js';

const OPEN_LIBRARY = 'https://openlibrary.org';
const GOOGLE_BOOKS = 'https://www.googleapis.com/books/v1/volumes';

const anioDe = (texto) => {
  const m = String(texto ?? '').match(/\b(\d{4})\b/);
  return m ? Number(m[1]) : null;
};

const nombres = (lista) => (Array.isArray(lista) ? lista.filter(Boolean).join(', ') : '');

/**
 * `edicion`: /isbn/{isbn}.json (título y año de esa edición concreta, portada).
 * `busqueda`: /search.json?isbn= (nombre del autor de la obra).
 */
export function desdeOpenLibrary(edicion, busqueda) {
  const doc = busqueda?.docs?.[0];
  const titulo = edicion?.title ?? doc?.title;
  if (!titulo) return null;
  const idPortada = edicion?.covers?.find((c) => c > 0) ?? doc?.cover_i;
  return {
    titulo,
    autor: nombres(doc?.author_name),
    anio: anioDe(edicion?.publish_date) ?? doc?.first_publish_year ?? null,
    portada: idPortada ? `https://covers.openlibrary.org/b/id/${idPortada}-M.jpg` : '',
    fuente: 'Open Library',
  };
}

/** Si se pasa `isbn`, solo vale un resultado que tenga ese ISBN (en 13 o en 10 cifras) entre sus identificadores. */
export function desdeGoogleBooks(json, isbn = null) {
  const tieneIsbn = (item) => item.volumeInfo?.industryIdentifiers?.some((id) => normalizarIsbn(id.identifier) === isbn);
  const items = json?.items ?? [];
  const info = (isbn ? items.find(tieneIsbn) : items[0])?.volumeInfo;
  if (!info?.title) return null;
  const imagen = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? '';
  return {
    titulo: info.title,
    autor: nombres(info.authors),
    anio: anioDe(info.publishedDate),
    portada: imagen.replace(/^http:/, 'https:').replace(/&edge=curl/, ''),
    fuente: 'Google Books',
  };
}

/** Rellena los huecos de `a` con `b`. */
export function combinar(a, b) {
  if (!a) return b;
  if (!b) return a;
  const r = { ...a };
  for (const campo of ['titulo', 'autor', 'anio', 'portada']) if (!r[campo] && b[campo]) r[campo] = b[campo];
  if (r.autor !== a.autor || r.portada !== a.portada) r.fuente = `${a.fuente} y ${b.fuente}`;
  return r;
}

/** Descarga JSON; cualquier fallo (404, cuota, red) cuenta como «sin datos». */
async function json(fetchImpl, url) {
  try {
    const res = await fetchImpl(url);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Explica por qué ha fallado Google Books, para distinguirlo de «no tiene ese libro». */
export function motivoFalloGoogle(estado, mensaje = '') {
  if (estado === 429 || /quota/i.test(mensaje)) return 'se ha agotado la cuota diaria de consultas';
  if (/API key/i.test(mensaje)) return 'la clave de Google Books no es válida';
  return `error ${estado}`;
}

/** Como `json`, pero si Google Books falla devuelve también el motivo en `error`. */
async function consultarGoogle(fetchImpl, url) {
  try {
    const res = await fetchImpl(url);
    if (res.ok) return { json: await res.json() };
    const cuerpo = await Promise.resolve().then(() => res.json()).catch(() => null);
    return { error: motivoFalloGoogle(res.status, cuerpo?.error?.message) };
  } catch {
    return { error: 'no hay conexión' };
  }
}

/**
 * Devuelve { libro, errorGoogle }. `libro` es { titulo, autor, anio, portada, fuente } o null si ninguna fuente lo conoce;
 * `errorGoogle` explica por qué falló Google Books (o null si respondió o no hizo falta consultarlo).
 */
export async function buscarLibro(isbn, { fetch: fetchImpl = (...a) => globalThis.fetch(...a), claveGoogle = '' } = {}) {
  const [edicion, busqueda] = await Promise.all([
    json(fetchImpl, `${OPEN_LIBRARY}/isbn/${isbn}.json`),
    json(fetchImpl, `${OPEN_LIBRARY}/search.json?isbn=${isbn}&fields=title,author_name,first_publish_year,cover_i&limit=1`),
  ]);
  const ol = desdeOpenLibrary(edicion, busqueda);
  if (ol?.autor && ol?.portada) return { libro: ol, errorGoogle: null };

  const clave = claveGoogle ? `&key=${encodeURIComponent(claveGoogle)}` : '';
  const google = await consultarGoogle(fetchImpl, `${GOOGLE_BOOKS}?q=isbn:${isbn}${clave}`);
  let deGoogle = desdeGoogleBooks(google.json);
  if (google.error) return { libro: ol, errorGoogle: google.error };
  if (!deGoogle) {
    // Algunos libros están mal indexados y «isbn:» no los encuentra, pero buscando el número suelto sí.
    const suelto = await consultarGoogle(fetchImpl, `${GOOGLE_BOOKS}?q=${isbn}${clave}`);
    if (suelto.error) return { libro: ol, errorGoogle: suelto.error };
    deGoogle = desdeGoogleBooks(suelto.json, isbn);
  }
  return { libro: combinar(ol, deGoogle), errorGoogle: null };
}

// ---------- Búsqueda por título, cuando no hay ISBN

/**
 * Resultados de Google Books como fichas para elegir: { titulo, autor, anio, portada, fuente }.
 * Sin ISBN: por título no se sabe qué edición tenéis, y un ISBN equivocado acabaría siendo el identificador.
 */
export function resultadosGoogle(json) {
  return (json?.items ?? []).map((item) => desdeGoogleBooks({ items: [item] })).filter(Boolean);
}

/** Resultados de /search.json de Open Library con el mismo formato. */
export function resultadosOpenLibrary(json) {
  return (json?.docs ?? [])
    .filter((doc) => doc.title)
    .map((doc) => ({
      titulo: doc.title,
      autor: nombres(doc.author_name),
      anio: doc.first_publish_year ?? null,
      portada: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : '',
      fuente: 'Open Library',
    }));
}

/**
 * Busca libros por título (y autor, si se da). Devuelve { resultados, errorGoogle }:
 * primero Google Books, que conoce mejor las ediciones en español; si no da nada, Open Library.
 */
export async function buscarPorTitulo(titulo, { autor = '', fetch: fetchImpl = (...a) => globalThis.fetch(...a), claveGoogle = '' } = {}) {
  const consulta = [`intitle:${titulo}`, autor && `inauthor:${autor}`].filter(Boolean).join(' ');
  const clave = claveGoogle ? `&key=${encodeURIComponent(claveGoogle)}` : '';
  const google = await consultarGoogle(fetchImpl, `${GOOGLE_BOOKS}?q=${encodeURIComponent(consulta)}&printType=books&maxResults=10${clave}`);
  const deGoogle = resultadosGoogle(google.json);
  if (deGoogle.length) return { resultados: deGoogle, errorGoogle: null };

  const parametros = new URLSearchParams({ title: titulo, fields: 'title,author_name,first_publish_year,cover_i', limit: '10' });
  if (autor) parametros.set('author', autor);
  const ol = await json(fetchImpl, `${OPEN_LIBRARY}/search.json?${parametros}`);
  return { resultados: resultadosOpenLibrary(ol), errorGoogle: google.error ?? null };
}
