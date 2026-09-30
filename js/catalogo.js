// Datos de libros por ISBN: Open Library y, si falta algo, Google Books.

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

export function desdeGoogleBooks(json) {
  const info = json?.items?.[0]?.volumeInfo;
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

/** Devuelve { titulo, autor, anio, portada, fuente } o null si ninguna fuente lo conoce. */
export async function buscarLibro(isbn, { fetch: fetchImpl = (...a) => globalThis.fetch(...a), claveGoogle = '' } = {}) {
  const [edicion, busqueda] = await Promise.all([
    json(fetchImpl, `${OPEN_LIBRARY}/isbn/${isbn}.json`),
    json(fetchImpl, `${OPEN_LIBRARY}/search.json?isbn=${isbn}&fields=title,author_name,first_publish_year,cover_i&limit=1`),
  ]);
  const ol = desdeOpenLibrary(edicion, busqueda);
  if (ol?.autor && ol?.portada) return ol;

  const clave = claveGoogle ? `&key=${encodeURIComponent(claveGoogle)}` : '';
  const gb = desdeGoogleBooks(await json(fetchImpl, `${GOOGLE_BOOKS}?q=isbn:${isbn}${clave}`));
  return combinar(ol, gb);
}
