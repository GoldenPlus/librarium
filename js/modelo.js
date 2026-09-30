// Tipos de la colección y construcción de títulos según el modelo de datos.

import { limpiar } from './texto.js';
import { normalizarIsbn } from './isbn.js';

export const TIPOS = [
  { clave: 'libros', nombre: 'Libros', singular: 'Libro', icono: '📚', isbn: true, autor: 'Autor' },
  { clave: 'comics', nombre: 'Cómics', singular: 'Cómic', icono: '💥', isbn: true, autor: 'Autor' },
  { clave: 'peliculas', nombre: 'Películas', singular: 'Película', icono: '🎬', autor: 'Director' },
  { clave: 'series', nombre: 'Series', singular: 'Serie', icono: '📺', autor: 'Creador' },
  { clave: 'documentales', nombre: 'Documentales', singular: 'Documental', icono: '🎥', autor: 'Director' },
];

export const TIPO = Object.fromEntries(TIPOS.map((t) => [t.clave, t]));

const FORMATOS_VIDEO = ['DVD', 'Blu-ray', '4K UHD', 'Digital', 'Disco duro'];
export const FORMATOS_BASE = {
  libros: ['Tapa dura', 'Tapa blanda', 'Bolsillo', 'Digital'],
  comics: ['Grapa', 'Tomo', 'Integral', 'Digital'],
  peliculas: FORMATOS_VIDEO,
  series: FORMATOS_VIDEO,
  documentales: FORMATOS_VIDEO,
};

export class ValidacionError extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ValidacionError';
  }
}

export function llevaTemporadas(tipo, subtipo) {
  return tipo === 'series' || (tipo === 'documentales' && subtipo === 'serie');
}

export function idManual() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return 'manual:' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hoy(fecha = new Date()) {
  const dos = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
}

/** «1-3, 5» → [1, 2, 3, 5]. Lanza ValidacionError si el texto no se entiende. */
export function parsearTemporadas(texto) {
  const numeros = new Set();
  for (const trozo of String(texto ?? '').split(/[,;\s]+/).filter(Boolean)) {
    const rango = trozo.match(/^(\d+)(?:-(\d+))?$/);
    if (!rango) throw new ValidacionError(`No entiendo «${trozo}» en las temporadas. Usa por ejemplo «1-3, 5».`);
    const desde = Number(rango[1]);
    const hasta = Number(rango[2] ?? rango[1]);
    if (desde < 1 || hasta < desde || hasta > 100) throw new ValidacionError(`El rango de temporadas «${trozo}» no es válido.`);
    for (let n = desde; n <= hasta; n++) numeros.add(n);
  }
  return [...numeros].sort((a, b) => a - b);
}

/** [1, 2, 3, 5] → «1–3, 5». */
export function resumirTemporadas(temporadas = []) {
  const nums = [...new Set(temporadas.map((t) => t.num))].sort((a, b) => a - b);
  const tramos = [];
  for (const n of nums) {
    const ultimo = tramos.at(-1);
    if (ultimo && n === ultimo[1] + 1) ultimo[1] = n;
    else tramos.push([n, n]);
  }
  return tramos.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ');
}

/** Dónde está un título: su ubicación o, en series, las de sus temporadas. */
export function dondeEsta(item) {
  if (item.temporadas?.length) return [...new Set(item.temporadas.map((t) => t.ubicacion).filter(Boolean))].join(', ');
  return item.ubicacion ?? '';
}

function unicosOrdenados(valores) {
  const vistos = new Map();
  for (const v of valores.map(limpiar).filter(Boolean)) {
    const clave = v.toLocaleLowerCase('es');
    if (!vistos.has(clave)) vistos.set(clave, v);
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
}

export function ubicacionesDe(items) {
  return unicosOrdenados(items.flatMap((it) => [it.ubicacion, ...(it.temporadas ?? []).map((t) => t.ubicacion)]));
}

export function formatosDe(tipo, items) {
  return unicosOrdenados([
    ...FORMATOS_BASE[tipo],
    ...items.flatMap((it) => [it.formato, ...(it.temporadas ?? []).map((t) => t.formato)]),
  ]);
}

/**
 * Crea un título nuevo a partir de los campos del formulario.
 * Lanza ValidacionError con un mensaje para mostrar si falta algo.
 */
export function construirItem(tipo, campos, { nombre, fecha = hoy(), generarId = idManual }) {
  if (!TIPO[tipo]) throw new ValidacionError('Elige un tipo.');
  const titulo = limpiar(campos.titulo);
  if (!titulo) throw new ValidacionError('El título es obligatorio.');
  const ubicacion = limpiar(campos.ubicacion);
  if (!ubicacion) throw new ValidacionError('La ubicación es obligatoria.');

  let id;
  if (TIPO[tipo].isbn && limpiar(campos.isbn)) {
    const isbn = normalizarIsbn(campos.isbn);
    if (!isbn) throw new ValidacionError('El ISBN no es válido. Revisa los dígitos o déjalo vacío.');
    id = `isbn:${isbn}`;
  } else {
    id = generarId();
  }

  let anio = null;
  if (limpiar(campos.anio)) {
    anio = Number(campos.anio);
    if (!Number.isInteger(anio) || anio < 0 || anio > 3000) throw new ValidacionError('El año no es válido.');
  }

  const formato = limpiar(campos.formato);
  const item = { id, titulo };
  if (tipo === 'documentales') item.subtipo = campos.subtipo === 'serie' ? 'serie' : 'pelicula';
  Object.assign(item, {
    autor: limpiar(campos.autor),
    anio,
    formato,
    ubicacion,
    portada: '',
    notas: String(campos.notas ?? '').trim(),
    alta_por: nombre,
    alta_fecha: fecha,
    mod_por: null,
    mod_fecha: null,
  });

  if (llevaTemporadas(tipo, item.subtipo)) {
    const nums = parsearTemporadas(campos.temporadas);
    if (!nums.length) throw new ValidacionError('Indica qué temporadas tenéis, por ejemplo «1-3».');
    item.temporadas_total = null;
    item.temporadas = nums.map((num) => ({ num, formato, ubicacion }));
    item.formato = '';
    item.ubicacion = '';
  }
  return item;
}
