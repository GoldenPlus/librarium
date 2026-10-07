// Detección de duplicados: bloqueo por id y aviso por título y autor parecidos.

import { normalizar, sinArticulo, similitud } from './texto.js';
import { dondeEsta, normalizarFormato } from './modelo.js';

const UMBRAL_TITULO = 0.85;
const UMBRAL_AUTOR = 0.8;

export class DuplicadoError extends Error {
  constructor(existente, extra = '') {
    const formato = existente.formato ? ` (${existente.formato})` : '';
    super(`Ya lo tenéis: «${existente.titulo}»${formato}${dondeEsta(existente) ? ` en ${dondeEsta(existente)}` : ''}.${extra}`);
    this.name = 'DuplicadoError';
    this.existente = existente;
  }
}

export class ParecidoError extends Error {
  constructor(parecidos, mensaje = 'Se parece a lo que ya tenéis:') {
    super(mensaje);
    this.name = 'ParecidoError';
    this.parecidos = parecidos;
  }
}

/** La serie ya existe: se ofrece añadir las temporadas a su ficha. */
export class SerieExistenteError extends Error {
  constructor(existente) {
    super(`Ya tenéis «${existente.titulo}».`);
    this.name = 'SerieExistenteError';
    this.existente = existente;
  }
}

function titulosParecidos(a, b) {
  const x = sinArticulo(a);
  const y = sinArticulo(b);
  return x === y || similitud(x, y) >= UMBRAL_TITULO;
}

const PARTICULAS = new Set(['del', 'los', 'las', 'van', 'von', 'der']);
const palabrasDeAutor = (n) => n.split(' ').filter((p) => p.length >= 3 && !PARTICULAS.has(p));

/** Sin autor en alguno, cuenta como compatible. Si no, basta un apellido común («J. Rulfo» y «Juan Rulfo»). */
function autoresCompatibles(a, b) {
  const x = normalizar(a);
  const y = normalizar(b);
  if (!x || !y) return true;
  const palabrasY = new Set(palabrasDeAutor(y));
  if (palabrasDeAutor(x).some((p) => palabrasY.has(p))) return true;
  return similitud(x, y) >= UMBRAL_AUTOR;
}

/** tmdb:movie:603:digital → tmdb:movie:603: los formatos de una misma película comparten base. */
const idBase = (id) => (id.startsWith('tmdb:movie:') ? id.split(':').slice(0, 3).join(':') : id);

function parecidosA(items, candidato) {
  return items.filter(
    (it) =>
      idBase(it.id) !== idBase(candidato.id) &&
      titulosParecidos(it.titulo, candidato.titulo) &&
      autoresCompatibles(it.autor, candidato.autor),
  );
}

/** Otro título que ya ocupa el mismo número en la misma saga, o null. */
export function mismoOrden(items, candidato) {
  if (!candidato.saga) return null;
  return (
    items.find(
      (it) =>
        idBase(it.id) !== idBase(candidato.id) &&
        it.saga?.id === candidato.saga.id &&
        it.saga.orden === candidato.saga.orden,
    ) ?? null
  );
}

/** Compara un título candidato con los existentes del mismo tipo. */
export function buscarDuplicados(items, candidato) {
  const mismoId = items.find((it) => it.id === candidato.id) ?? null;
  return { mismoId, parecidos: parecidosA(items, candidato) };
}

function avisoDeOrden(items, candidato) {
  const otro = mismoOrden(items, candidato);
  if (otro) throw new ParecidoError([otro], `Ya tenéis el número ${candidato.saga.orden} de esta saga:`);
}

/** Alta: lanza DuplicadoError o, salvo que se fuerce, ParecidoError (título parecido o número de saga ocupado). */
export function comprobarDuplicados(items, candidato, { forzar = false } = {}) {
  const { mismoId, parecidos } = buscarDuplicados(items, candidato);
  if (mismoId) throw new DuplicadoError(mismoId);
  if (forzar) return;
  if (parecidos.length) throw new ParecidoError(parecidos);
  avisoDeOrden(items, candidato);
}

/** Edición: solo avisa de lo que la edición cambia (título o autor, y saga). */
export function comprobarEdicion(items, original, editado, { forzar = false } = {}) {
  if (forzar) return;
  const otros = items.filter((it) => it.id !== original.id);
  if (original.titulo !== editado.titulo || original.autor !== editado.autor) {
    const parecidos = parecidosA(otros, editado);
    if (parecidos.length) throw new ParecidoError(parecidos);
  }
  if (JSON.stringify(original.saga) !== JSON.stringify(editado.saga)) avisoDeOrden(otros, editado);
}

/**
 * Películas y documentales de TMDB: el mismo título en otro formato (físico y digital) se admite
 * añadiendo el formato al id, p. ej. tmdb:movie:603:digital. Mismo formato, o sin formato: duplicado.
 * Los formatos antiguos (DVD, Blu-ray…) cuentan como físico.
 */
export function idSegunFormato(items, candidato) {
  if (!candidato.id.startsWith('tmdb:movie:')) return candidato;
  const base = candidato.id.split(':').slice(0, 3).join(':');
  const variantes = items.filter((it) => it.id === base || it.id.startsWith(`${base}:`));
  if (!variantes.length) return { ...candidato, id: base };
  const formato = normalizarFormato(candidato.formato);
  if (!formato) throw new DuplicadoError(variantes[0], ' Si es otra edición, indica su formato.');
  const igual = variantes.find((v) => normalizarFormato(v.formato) === formato);
  if (igual) throw new DuplicadoError(igual);
  return { ...candidato, id: `${base}:${normalizar(formato)}` };
}

/** Alta completa: id según formato, serie existente y duplicados. Devuelve el título con su id definitivo. */
export function prepararAlta(items, candidato, opciones = {}) {
  if (candidato.temporadas) {
    const existente = items.find((it) => it.id === candidato.id);
    if (existente) throw new SerieExistenteError(existente);
  }
  const item = idSegunFormato(items, candidato);
  comprobarDuplicados(items, item, opciones);
  return item;
}
