// Detección de duplicados: bloqueo por id y aviso por título y autor parecidos.

import { normalizar, sinArticulo, similitud } from './texto.js';
import { dondeEsta } from './modelo.js';

const UMBRAL_TITULO = 0.85;
const UMBRAL_AUTOR = 0.8;

export class DuplicadoError extends Error {
  constructor(existente) {
    super(`Ya lo tenéis: «${existente.titulo}»${dondeEsta(existente) ? ` en ${dondeEsta(existente)}` : ''}.`);
    this.name = 'DuplicadoError';
    this.existente = existente;
  }
}

export class ParecidoError extends Error {
  constructor(parecidos) {
    super('Hay títulos parecidos en la colección.');
    this.name = 'ParecidoError';
    this.parecidos = parecidos;
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

/** Compara un título candidato con los existentes del mismo tipo. */
export function buscarDuplicados(items, candidato) {
  const mismoId = items.find((it) => it.id === candidato.id) ?? null;
  const parecidos = items.filter(
    (it) =>
      it.id !== candidato.id &&
      titulosParecidos(it.titulo, candidato.titulo) &&
      autoresCompatibles(it.autor, candidato.autor),
  );
  return { mismoId, parecidos };
}

/** Lanza DuplicadoError o, salvo que se fuerce, ParecidoError. */
export function comprobarDuplicados(items, candidato, { forzar = false } = {}) {
  const { mismoId, parecidos } = buscarDuplicados(items, candidato);
  if (mismoId) throw new DuplicadoError(mismoId);
  if (parecidos.length && !forzar) throw new ParecidoError(parecidos);
}
