// Tipos de la colección y construcción de títulos según el modelo de datos.

import { limpiar } from './texto.js';
import { normalizarIsbn } from './isbn.js';

export const TIPOS = [
  { clave: 'libros', nombre: 'Libros', singular: 'Libro', icono: '📚', isbn: true, autor: 'Autor' },
  { clave: 'comics', nombre: 'Cómics', singular: 'Cómic', icono: '💥', isbn: true, autor: 'Autor' },
  { clave: 'peliculas', nombre: 'Películas', singular: 'Película', icono: '🎬' },
  { clave: 'series', nombre: 'Series', singular: 'Serie', icono: '📺' },
  { clave: 'documentales', nombre: 'Documentales', singular: 'Documental', icono: '🎥' },
];

export const TIPO = Object.fromEntries(TIPOS.map((t) => [t.clave, t]));

/** Solo libros y cómics guardan autor; películas, series y documentales no guardan director. */
export const conAutor = (tipo) => Boolean(TIPO[tipo]?.autor);

export const FORMATOS = ['Físico', 'Digital'];

/** Físico en libros y cómics; Digital en películas, series y documentales. */
export const formatoPorDefecto = (tipo) => (TIPO[tipo]?.isbn ? 'Físico' : 'Digital');

/** Lleva los formatos antiguos (DVD, Tapa blanda…) a Físico o Digital. Vacío sigue vacío. */
export function normalizarFormato(valor) {
  const texto = limpiar(valor);
  if (!texto) return '';
  return texto.toLocaleLowerCase('es') === 'digital' ? 'Digital' : 'Físico';
}

/** Portada válida: una dirección https (Open Library, Google Books, TMDB) o una foto del repo de datos. */
export const esPortada = (valor) => /^https:\/\//.test(valor ?? '') || /^repo:portadas\/[a-z0-9-]+\.jpg$/.test(valor ?? '');

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

/** «1–2 de 5» con el total de TMDB, o solo «1–2». */
export function textoTemporadas(item) {
  if (!item.temporadas?.length) return '';
  const resumen = resumirTemporadas(item.temporadas);
  return item.temporadas_total ? `${resumen} (${item.temporadas.length} de ${item.temporadas_total})` : resumen;
}

/**
 * Añade temporadas a una serie existente. Las que ya estaban se ignoran y se devuelven en `repetidas`;
 * si todas estaban, lanza ValidacionError.
 */
export function anadirTemporadas(existente, nuevas, { nombre, fecha = hoy(), total = null }) {
  const ya = new Set((existente.temporadas ?? []).map((t) => t.num));
  const repetidas = nuevas.filter((t) => ya.has(t.num)).map((t) => t.num);
  const anadidas = nuevas.filter((t) => !ya.has(t.num));
  if (!anadidas.length) {
    throw new ValidacionError(repetidas.length === 1 ? `Ya tenéis la temporada ${repetidas[0]}.` : `Ya tenéis las temporadas ${repetidas.join(', ')}.`);
  }
  const item = {
    ...existente,
    temporadas: [...(existente.temporadas ?? []), ...anadidas].sort((a, b) => a.num - b.num),
    temporadas_total: existente.temporadas_total ?? total,
    mod_por: nombre,
    mod_fecha: fecha,
  };
  return { item, anadidas: anadidas.map((t) => t.num), repetidas };
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

function leerAnio(texto) {
  if (!limpiar(texto)) return null;
  const anio = Number(texto);
  if (!Number.isInteger(anio) || anio < 0 || anio > 3000) throw new ValidacionError('El año no es válido.');
  return anio;
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
  if (!TIPO[tipo].isbn && /^(movie|tv):\d+$/.test(campos.tmdb ?? '')) {
    id = `tmdb:${campos.tmdb}`;
  } else if (TIPO[tipo].isbn && limpiar(campos.isbn)) {
    const isbn = normalizarIsbn(campos.isbn);
    if (!isbn) throw new ValidacionError('El ISBN no es válido. Revisa los dígitos o déjalo vacío.');
    id = `isbn:${isbn}`;
  } else {
    id = generarId();
  }

  const formato = normalizarFormato(campos.formato) || formatoPorDefecto(tipo);
  const item = { id, titulo };
  if (tipo === 'documentales') item.subtipo = campos.subtipo === 'serie' ? 'serie' : 'pelicula';
  if (conAutor(tipo)) item.autor = limpiar(campos.autor);
  Object.assign(item, {
    anio: leerAnio(campos.anio),
    formato,
    ubicacion,
    portada: esPortada(campos.portada) ? campos.portada : '',
    notas: String(campos.notas ?? '').trim(),
    alta_por: nombre,
    alta_fecha: fecha,
    mod_por: null,
    mod_fecha: null,
  });

  if (llevaTemporadas(tipo, item.subtipo)) {
    const nums = parsearTemporadas(campos.temporadas);
    if (!nums.length) throw new ValidacionError('Indica qué temporadas tenéis, por ejemplo «1-3».');
    item.temporadas_total = Number(campos.temporadas_total) || null;
    item.temporadas = nums.map((num) => ({ num, formato, ubicacion }));
    item.formato = '';
    item.ubicacion = '';
  }
  return item;
}

/** Valida las filas de temporadas del formulario de edición y las ordena por número. */
export function validarTemporadas(filas = []) {
  const vistas = new Set();
  const temporadas = filas.map((fila) => {
    const num = Number(fila.num);
    if (!Number.isInteger(num) || num < 1 || num > 100) throw new ValidacionError(`El número de temporada «${fila.num}» no es válido.`);
    if (vistas.has(num)) throw new ValidacionError(`La temporada ${num} está repetida.`);
    vistas.add(num);
    const ubicacion = limpiar(fila.ubicacion);
    if (!ubicacion) throw new ValidacionError(`Falta la ubicación de la temporada ${num}.`);
    return { num, formato: normalizarFormato(fila.formato), ubicacion };
  });
  if (!temporadas.length) throw new ValidacionError('Una serie necesita al menos una temporada.');
  return temporadas.sort((a, b) => a.num - b.num);
}

/**
 * Aplica los campos del formulario de edición sobre una copia del título.
 * El tipo, el subtipo y el id no cambian. Las series reciben `campos.temporadasDetalle`.
 */
export function editarItem(original, tipo, campos, { nombre, fecha = hoy() }) {
  const item = structuredClone(original);
  item.titulo = limpiar(campos.titulo);
  if (!item.titulo) throw new ValidacionError('El título es obligatorio.');
  // Las películas, series y documentales ya no guardan director: al editarlas se limpia.
  if (conAutor(tipo)) item.autor = limpiar(campos.autor);
  else delete item.autor;
  item.anio = leerAnio(campos.anio);
  item.notas = String(campos.notas ?? '').trim();
  // Una portada nueva (por ejemplo una foto) sustituye a la anterior; sin portada se conserva la que hubiera.
  if (esPortada(campos.portada)) item.portada = campos.portada;
  if (llevaTemporadas(tipo, original.subtipo)) {
    item.temporadas = validarTemporadas(campos.temporadasDetalle);
  } else {
    item.formato = normalizarFormato(campos.formato);
    item.ubicacion = limpiar(campos.ubicacion);
    if (!item.ubicacion) throw new ValidacionError('La ubicación es obligatoria.');
  }
  item.mod_por = nombre;
  item.mod_fecha = fecha;
  return item;
}

const sinMarcas = ({ mod_por, mod_fecha, ...resto }) => JSON.stringify(resto);

/** true si la edición no cambia nada salvo quién y cuándo. */
export function sinCambios(original, editado) {
  return sinMarcas(original) === sinMarcas(editado);
}

/**
 * Lleva a la versión más reciente (`fresco`) solo los campos que esta edición ha cambiado,
 * para no pisar lo que otra persona haya cambiado a la vez en otros campos.
 */
export function aplicarCambios(fresco, original, editado) {
  const resultado = { ...fresco };
  for (const clave of new Set([...Object.keys(original), ...Object.keys(editado)])) {
    if (JSON.stringify(original[clave]) === JSON.stringify(editado[clave])) continue;
    if (editado[clave] === undefined) delete resultado[clave];
    else resultado[clave] = editado[clave];
  }
  return resultado;
}
