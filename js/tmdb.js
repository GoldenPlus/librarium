// TMDB: búsqueda de películas, series y documentales en español, con saga y temporadas.

const API = 'https://api.themoviedb.org/3';
const IMAGENES = 'https://image.tmdb.org/t/p';
const GENERO_DOCUMENTAL = 99;

const anioDe = (fecha) => (/^\d{4}/.test(fecha ?? '') ? Number(fecha.slice(0, 4)) : null);
const imagen = (ruta, ancho) => (ruta ? `${IMAGENES}/${ancho}${ruta}` : '');
const esDocumental = (generos = []) => generos.some((g) => (g?.id ?? g) === GENERO_DOCUMENTAL);

export function resultadoDeBusqueda(r) {
  return {
    media: r.media_type,
    id: r.id,
    titulo: r.title ?? r.name ?? '',
    anio: anioDe(r.release_date ?? r.first_air_date),
    miniatura: imagen(r.poster_path, 'w92'),
    documental: esDocumental(r.genre_ids),
  };
}

export function desdePelicula(p) {
  return {
    media: 'movie',
    id: p.id,
    titulo: p.title,
    anio: anioDe(p.release_date),
    portada: imagen(p.poster_path, 'w185'),
    documental: esDocumental(p.genres),
    coleccion: p.belongs_to_collection ? { id: p.belongs_to_collection.id, nombre: p.belongs_to_collection.name } : null,
    temporadas_total: null,
  };
}

export function desdeSerie(s) {
  return {
    media: 'tv',
    id: s.id,
    titulo: s.name,
    anio: anioDe(s.first_air_date),
    portada: imagen(s.poster_path, 'w185'),
    documental: esDocumental(s.genres),
    coleccion: null,
    temporadas_total: s.number_of_seasons || null,
  };
}

/** «Matrix - Colección» → «Matrix». */
export function limpiarNombreColeccion(nombre) {
  const limpio = String(nombre ?? '')
    .replace(/\s*[-–:]\s*colecci[oó]n\s*$/i, '')
    .replace(/\s*\(colecci[oó]n\)\s*$/i, '')
    .replace(/^colecci[oó]n\s+(de\s+)?/i, '')
    .trim();
  return limpio || String(nombre ?? '').trim();
}

/** Nombre, número (por fecha de estreno) y total de la saga de una película. */
export function sagaDeColeccion(coleccion, idPelicula) {
  const partes = [...(coleccion?.parts ?? [])].sort((a, b) => {
    if (!a.release_date) return 1;
    if (!b.release_date) return -1;
    return a.release_date.localeCompare(b.release_date);
  });
  const posicion = partes.findIndex((p) => p.id === idPelicula);
  return {
    nombre: limpiarNombreColeccion(coleccion?.name),
    orden: posicion >= 0 ? posicion + 1 : null,
    total: partes.length || null,
  };
}

export function crearTmdb(clave, { fetch: fetchImpl = (...a) => globalThis.fetch(...a) } = {}) {
  // TMDB da dos claves: la «API Key» (v3, corta) y el «token de lectura» (v4, empieza por eyJ). Valen las dos.
  const esToken = /^eyJ/.test(clave);

  async function pedir(ruta, parametros = {}) {
    const url = new URL(`${API}${ruta}`);
    for (const [k, v] of Object.entries({ language: 'es-ES', ...parametros })) url.searchParams.set(k, v);
    if (!esToken) url.searchParams.set('api_key', clave);
    let res;
    try {
      res = await fetchImpl(url.toString(), esToken ? { headers: { Authorization: `Bearer ${clave}` } } : {});
    } catch {
      throw new Error('No se puede conectar con TMDB. ¿Hay conexión?');
    }
    if (res.status === 401) throw new Error('La clave de TMDB no es válida. Avisa a quien administra la app.');
    if (!res.ok) throw new Error(`TMDB ha respondido con un error (${res.status}).`);
    return res.json();
  }

  return {
    async buscar(texto) {
      const json = await pedir('/search/multi', { query: texto, include_adult: 'false' });
      return (json.results ?? []).filter((r) => r.media_type === 'movie' || r.media_type === 'tv').map(resultadoDeBusqueda);
    },
    async detalles(media, id) {
      if (media === 'movie') return desdePelicula(await pedir(`/movie/${id}`));
      return desdeSerie(await pedir(`/tv/${id}`));
    },
    async saga(coleccion, idPelicula) {
      return sagaDeColeccion(await pedir(`/collection/${coleccion.id}`), idPelicula);
    },
  };
}
