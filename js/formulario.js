// Formulario de alta y edición: validación, duplicados, saga y guardado con reintento.

import { TIPOS, TIPO, construirItem, editarItem, sinCambios, aplicarCambios, anadirTemporadas, dondeEsta, FORMATOS, formatoPorDefecto, normalizarFormato, conAutor, hoy, llevaTemporadas, textoTemporadas, ubicacionesDe } from './modelo.js';
import { comprobarEdicion, prepararAlta, DuplicadoError, ParecidoError, SerieExistenteError } from './duplicados.js';
import { leerCamposSaga, asegurarSaga, idSaga } from './sagas.js';
import { normalizarIsbn } from './isbn.js';
import { buscarLibro, buscarPorTitulo } from './catalogo.js';
import { datosCamara, escanearIsbn, guardarFotograma } from './escaner.js';
import { crearTmdb } from './tmdb.js';
import { app, claveDe, sagaDe } from './estado.js';
import { normalizar } from './texto.js';
import { $, el, aviso } from './dom.js';

const form = () => $('#form-alta');

/** { edicion: false } para altas; { edicion: true, tipo, original } al editar. */
let modo = { edicion: false };
let alGuardar = () => {};

/** Las series y los documentales no llevan saga: en su lugar va la temporada. */
const CON_SAGA = ['libros', 'comics', 'peliculas'];

/** Ubicaciones ya usadas en cualquier tipo, en orden alfabético. */
let ubicaciones = [];

/** Sagas ya creadas del tipo actual, en orden alfabético. */
let sagas = [];

// ---------- Presentación

function tipoActual() {
  return modo.edicion ? modo.tipo : form().tipo.value;
}

function ajustar() {
  const f = form();
  const tipo = tipoActual();
  const subtipo = modo.edicion ? modo.original.subtipo : f.subtipo.value;
  const conTemporadas = llevaTemporadas(tipo, subtipo);
  const filasDeTemporadas = conTemporadas && modo.edicion;

  f.tipo.disabled = modo.edicion;
  f.subtipo.disabled = modo.edicion;
  $('#campo-isbn').hidden = !TIPO[tipo].isbn || modo.edicion;
  $('#campo-tmdb').hidden = TIPO[tipo].isbn || modo.edicion;
  $('#btn-todas').hidden = !(Number(f.temporadas_total.value) > 0);
  $('#campo-subtipo').hidden = tipo !== 'documentales';
  $('#campo-temporadas').hidden = !conTemporadas || modo.edicion;
  $('#campo-temporadas-edicion').hidden = !filasDeTemporadas;
  $('#campo-formato').hidden = filasDeTemporadas;
  $('#campo-ubicacion').hidden = filasDeTemporadas;
  $('#campo-autor').hidden = !conAutor(tipo);
  $('#etiqueta-autor').textContent = TIPO[tipo].autor ?? '';
  $('#campo-saga').hidden = !CON_SAGA.includes(tipo);

  ubicaciones = ubicacionesDe(TIPOS.flatMap((t) => app.almacen.items(t.clave)));
  sagas = app.almacen.items('sagas').filter((s) => s.tipo === tipo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
  for (const combo of document.querySelectorAll('#form-alta .combo')) combo.actualizar();
  sugerirTotal();
}

/** Rellena la saga encontrada en una búsqueda y despliega su recuadro; no pisa una saga ya escrita. Devuelve si la puso. */
function proponerSaga(saga) {
  const f = form();
  if (!saga?.nombre || !CON_SAGA.includes(tipoActual()) || f.saga.value.trim()) return false;
  $('#campo-saga').open = true;
  f.saga.value = saga.nombre;
  f.saga_orden.value = saga.orden ?? '';
  f.saga_total.value = saga.total ?? '';
  sugerirTotal();
  return true;
}

/** Si la saga escrita ya existe, su total aparece como sugerencia. */
function sugerirTotal() {
  const f = form();
  const nombre = f.saga.value.trim();
  const saga = nombre && app.almacen.items('sagas').find((s) => s.id === idSaga(tipoActual(), nombre));
  f.saga_total.placeholder = saga?.total ? String(saga.total) : '';
}

function limpiarMensajes() {
  $('#alta-error').textContent = '';
  $('#alta-parecidos').hidden = true;
}

function mostrarError(mensaje) {
  $('#alta-error').textContent = mensaje;
  $('#alta-error').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/** Lo que hace el botón del aviso: «Añadir igualmente» o «Añadir a esa ficha». */
let accionAviso = () => {};

function mostrarAviso(mensaje, elementos, textoBoton, accion) {
  $('#alta-parecidos p').textContent = mensaje;
  $('#alta-parecidos ul').replaceChildren(...elementos.map((texto) => el('li', {}, texto)));
  $('#alta-forzar').textContent = textoBoton;
  accionAviso = accion;
  $('#alta-parecidos').hidden = false;
  $('#alta-parecidos').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function mostrarParecidos(error) {
  const elementos = error.parecidos
    .slice(0, 5)
    .map((it) => [`«${it.titulo}»`, it.autor && ` — ${it.autor}`, dondeEsta(it) && ` (${dondeEsta(it)})`].filter(Boolean).join(''));
  mostrarAviso(error.message, elementos, 'Añadir igualmente', () => guardar(true));
}

/** La serie ya existe: se ofrece añadir las temporadas nuevas a su ficha. */
function ofrecerTemporadas(tipo, existente, item) {
  const ya = new Set((existente.temporadas ?? []).map((t) => t.num));
  const nuevas = item.temporadas.map((t) => t.num).filter((n) => !ya.has(n));
  const repetidas = item.temporadas.map((t) => t.num).filter((n) => ya.has(n));
  const tiene = textoTemporadas(existente);
  const mensaje = `Ya tenéis «${existente.titulo}»${tiene ? `: temporadas ${tiene}` : ''}.`;
  if (!nuevas.length) {
    mostrarError(`${mensaje} ${repetidas.length === 1 ? `La temporada ${repetidas[0]} ya está.` : `Las temporadas ${repetidas.join(', ')} ya están.`}`);
    return;
  }
  const plural = (nums, uno, varios) => (nums.length === 1 ? `${uno} ${nums[0]}` : `${varios} ${nums.join(', ')}`);
  mostrarAviso(
    mensaje,
    [
      `¿Añadir ${plural(nuevas, 'la temporada', 'las temporadas')} a esa ficha?`,
      repetidas.length ? `${plural(repetidas, 'La', 'Las')} ya ${repetidas.length === 1 ? 'está' : 'están'} y no se toca${repetidas.length === 1 ? '' : 'n'}.` : '',
    ].filter(Boolean),
    'Añadir a esa ficha',
    () => guardarTemporadas(tipo, existente, item),
  );
}

// ---------- Ubicación y saga: se escribe una nueva o se elige de las que ya hay

/**
 * Envuelve un campo con un botón ▾ que despliega los valores guardados (`valores()`, ya ordenados); al escribir, se filtran.
 * Al elegir uno se pone en el campo y se llama a `alElegir` con él.
 */
function selector(input, { valores, nombre, alElegir = () => {} }) {
  const lista = el('ul', { class: 'combo-lista', role: 'listbox', 'aria-label': `${nombre} guardadas`, hidden: true });
  const boton = el('button', { type: 'button', class: 'secundario', 'aria-label': `Elegir entre las ${nombre.toLowerCase()} guardadas` }, '▾');
  const combo = el('div', { class: 'combo' }, el('div', { class: 'fila-isbn' }, input, boton), lista);

  const cerrar = () => (lista.hidden = true);
  const mostrar = (filtro) => {
    const texto = normalizar(filtro);
    const opciones = texto ? valores().filter((v) => normalizar(v).includes(texto)) : valores();
    lista.replaceChildren(
      ...opciones.map((v) =>
        el('li', {}, el('button', { type: 'button', role: 'option', onclick: () => { input.value = v; cerrar(); alElegir(v); } }, v)),
      ),
    );
    lista.hidden = !opciones.length;
  };
  // Sin valores guardados no hay nada que desplegar.
  combo.actualizar = () => {
    boton.hidden = !valores().length;
    cerrar();
  };
  combo.actualizar();

  // El botón despliega la lista sin poner el foco en el campo, así no sale el teclado.
  boton.addEventListener('click', () => (lista.hidden ? mostrar('') : cerrar()));
  input.addEventListener('input', () => (input.value.trim() ? mostrar(input.value) : cerrar()));
  // Tocar una opción no debe quitar el foco al campo: si no, la lista se cerraría antes del clic.
  lista.addEventListener('mousedown', (e) => e.preventDefault());
  combo.addEventListener('focusout', (e) => {
    if (!combo.contains(e.relatedTarget)) cerrar();
  });
  return combo;
}

const selectorUbicacion = (input) => selector(input, { valores: () => ubicaciones, nombre: 'Ubicaciones' });

/** Al elegir una saga ya creada se rellena su total, y solo queda poner el número. */
function elegirSaga(nombre) {
  const f = form();
  const saga = sagas.find((s) => s.nombre === nombre);
  f.saga_total.value = saga?.total ?? '';
  sugerirTotal();
  f.saga_orden.focus();
}

const opcionesFormato = (elegido) => FORMATOS.map((v) => el('option', { value: v, selected: v === elegido }, v));

function filaTemporada({ num, formato = '', ubicacion = '' }) {
  return el('div', { class: 'fila-temporada' },
    el('input', { type: 'number', min: 1, max: 100, value: num, 'data-campo': 'num', 'aria-label': 'Número de temporada' }),
    el('select', { 'data-campo': 'formato', 'aria-label': 'Formato' }, opcionesFormato(normalizarFormato(formato) || formatoPorDefecto(tipoActual()))),
    selectorUbicacion(el('input', { 'data-campo': 'ubicacion', value: ubicacion, placeholder: 'Ubicación', 'aria-label': 'Ubicación', autocomplete: 'off' })),
    el('button', { type: 'button', class: 'icono', 'aria-label': `Quitar temporada`, onclick: (e) => e.currentTarget.parentElement.remove() }, '✕'),
  );
}

function leerFilasTemporadas() {
  return [...document.querySelectorAll('.fila-temporada')].map((fila) =>
    Object.fromEntries([...fila.querySelectorAll('input, select')].map((i) => [i.dataset.campo, i.value])),
  );
}

function anadirFilaTemporada() {
  const filas = leerFilasTemporadas();
  const ultima = filas.at(-1) ?? {};
  const siguiente = Math.max(0, ...filas.map((f) => Number(f.num) || 0)) + 1;
  $('#filas-temporadas').append(filaTemporada({ num: siguiente, formato: ultima.formato, ubicacion: ultima.ubicacion }));
}

/** Un resultado de búsqueda (libro o TMDB) para elegir. */
function filaResultado({ miniatura, icono, titulo, detalle, alElegir }) {
  return el('li', {},
    el('button', { type: 'button', class: 'resultado', onclick: alElegir },
      miniatura
        ? el('img', { src: miniatura, alt: '', loading: 'lazy', onerror: (e) => (e.currentTarget.style.visibility = 'hidden') })
        : el('span', { class: 'sin-imagen', 'aria-hidden': 'true' }, icono),
      el('span', {}, el('strong', {}, titulo), el('small', {}, detalle)),
    ),
  );
}

// ---------- ISBN: escáner y datos automáticos

function estadoIsbn(texto, esError = false) {
  const nodo = $('#isbn-estado');
  nodo.textContent = texto;
  nodo.classList.toggle('error', esError);
}

function ponerPortada(url) {
  const f = form();
  const img = $('#alta-portada');
  f.portada.value = url || '';
  img.hidden = !url;
  img.onerror = () => (img.hidden = true);
  if (url) img.src = url;
  else img.removeAttribute('src');
}

/** Título con este ISBN en libros o cómics, para avisar antes de buscar datos. */
function yaTenemos(isbn) {
  const id = `isbn:${isbn}`;
  for (const tipo of ['libros', 'comics']) {
    const item = app.almacen.items(tipo).find((it) => it.id === id);
    if (item) return item;
  }
  return null;
}

/**
 * Valida el ISBN, avisa si ya lo tenéis y rellena el formulario con los datos que se encuentren.
 * Con `enfocar: false` (al venir del escáner) no pone el foco en ningún campo, para que no salga el teclado.
 */
async function procesarIsbn(texto, { enfocar = true } = {}) {
  const f = form();
  limpiarMensajes();
  $('#isbn-resultados').replaceChildren();
  const isbn = normalizarIsbn(texto);
  if (!isbn) return estadoIsbn('No es un ISBN válido. Revisa los dígitos.', true);
  f.isbn.value = isbn;

  const existente = yaTenemos(isbn);
  if (existente) {
    estadoIsbn('');
    mostrarError(`Ya lo tenéis: «${existente.titulo}»${dondeEsta(existente) ? ` en ${dondeEsta(existente)}` : ''}.`);
    return;
  }
  if (!navigator.onLine) return estadoIsbn('Sin conexión: rellena los datos a mano. El ISBN se guarda igual.');

  estadoIsbn('Buscando datos…');
  const boton = $('#btn-buscar-isbn');
  boton.disabled = true;
  const { libro: datos, errorGoogle } = await buscarLibro(isbn, { claveGoogle: claveDe('google') });
  boton.disabled = false;
  if (normalizarIsbn(f.isbn.value) !== isbn) return; // Se cambió el ISBN mientras tanto.

  if (!datos) {
    estadoIsbn(
      errorGoogle
        ? `Open Library no tiene este ISBN y Google Books no ha respondido: ${errorGoogle}. Rellena el resto a mano; el ISBN se guarda igual.`
        : 'Ni Open Library ni Google Books tienen este ISBN. Rellena el resto a mano; el ISBN se guarda igual.',
    );
    if (enfocar) f.titulo.focus();
    return;
  }
  if (datos.titulo) f.titulo.value = datos.titulo;
  if (datos.autor) f.autor.value = datos.autor;
  if (datos.anio) f.anio.value = datos.anio;
  ponerPortada(datos.portada);
  const conSaga = proponerSaga(datos.saga) ? ', con la saga sacada del título' : '';
  estadoIsbn(`Datos de ${datos.fuente}${conSaga}. Revísalos, elige la ubicación y guarda.`);
  if (enfocar) f.ubicacion.focus();
}

/** Sin ISBN, «Buscar» busca por el título (y el autor, si está escrito) y deja elegir entre los resultados. */
async function buscarTitulo() {
  const f = form();
  limpiarMensajes();
  $('#isbn-resultados').replaceChildren();
  const titulo = f.titulo.value.trim();
  if (!titulo) return estadoIsbn('Escribe un ISBN o, si no lo tiene, el título del libro, y pulsa Buscar.', true);
  if (!navigator.onLine) return estadoIsbn('Sin conexión: rellena los datos a mano.');

  estadoIsbn(`Buscando «${titulo}»…`);
  const boton = $('#btn-buscar-isbn');
  boton.disabled = true;
  const { resultados, errorGoogle } = await buscarPorTitulo(titulo, { autor: conAutor(tipoActual()) ? f.autor.value.trim() : '', claveGoogle: claveDe('google') });
  boton.disabled = false;
  if (f.titulo.value.trim() !== titulo || f.isbn.value.trim()) return; // Se cambió mientras tanto.

  if (!resultados.length) {
    return estadoIsbn(
      errorGoogle
        ? `Open Library no encuentra ese título y Google Books no ha respondido: ${errorGoogle}. Rellena el resto a mano.`
        : 'No se encuentra ningún libro con ese título. Rellena el resto a mano.',
    );
  }
  estadoIsbn('Elige el correcto:');
  $('#isbn-resultados').replaceChildren(
    ...resultados.slice(0, 8).map((r) =>
      filaResultado({ miniatura: r.portada, icono: '📖', titulo: r.titulo, detalle: [r.autor, r.anio].filter(Boolean).join(' · '), alElegir: () => elegirLibro(r) }),
    ),
  );
}

function elegirLibro(libro) {
  const f = form();
  $('#isbn-resultados').replaceChildren();
  f.titulo.value = libro.titulo;
  if (libro.autor) f.autor.value = libro.autor;
  f.anio.value = libro.anio ?? '';
  ponerPortada(libro.portada);
  const conSaga = proponerSaga(libro.saga) ? ', con la saga sacada del título' : '';
  estadoIsbn(`Datos de ${libro.fuente}${conSaga}. Revísalos, elige la ubicación y guarda.`);
}

let escaneo = null;

function cerrarEscaner() {
  escaneo?.detener();
  escaneo = null;
  if ($('#dlg-escaner').open) $('#dlg-escaner').close();
}

/** Con zoom normal solo se ve «+»; con zoom x2, solo «−». null: ninguno (la cámara aún no está lista). */
function mostrarZoom(ampliado) {
  $('#escaner-zoom-mas').hidden = ampliado !== false;
  $('#escaner-zoom-menos').hidden = ampliado !== true;
}

function cambiarZoom(ampliado) {
  mostrarZoom(ampliado);
  escaneo?.zoom(ampliado);
}

// Con ?diagnostico en la dirección, el escáner muestra datos de la cámara y deja guardar el fotograma que analiza.
const DIAGNOSTICO = new URLSearchParams(location.search).has('diagnostico');

async function mostrarDiagnostico(actual) {
  const nodo = $('#escaner-diagnostico');
  $('#escaner-fotograma').hidden = false;
  nodo.hidden = false;
  // La resolución tarda un poco en asentarse: se actualiza mientras el escáner siga abierto.
  while (escaneo === actual) {
    nodo.textContent = await datosCamara($('#video-escaner'));
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export async function abrirEscaner() {
  const estado = $('#escaner-estado');
  estado.textContent = 'Abriendo la cámara…';
  mostrarZoom(null);
  // Al cerrarse, el diálogo devuelve el foco a donde estaba; si era un campo de texto, saldría el teclado.
  document.activeElement?.blur();
  $('#dlg-escaner').showModal();
  const actual = (escaneo = escanearIsbn($('#video-escaner'), {
    alIgnorar: (codigo) => (estado.textContent = `El código ${codigo} no es un ISBN. Busca el código que empieza por 978 o 979.`),
  }));
  actual.lista.then(() => {
    if (escaneo !== actual) return;
    mostrarZoom(false);
    if (DIAGNOSTICO) mostrarDiagnostico(actual);
  });
  setTimeout(() => {
    if (escaneo && estado.textContent === 'Abriendo la cámara…') estado.textContent = 'Apunta al código de barras del libro.';
  }, 1500);
  try {
    const isbn = await escaneo.resultado;
    cerrarEscaner();
    if (isbn) {
      navigator.vibrate?.(80);
      await procesarIsbn(isbn, { enfocar: false });
    }
  } catch (e) {
    escaneo = null;
    $('#dlg-escaner').close();
    estadoIsbn(e.message, true);
  }
}

// ---------- TMDB: búsqueda de películas, series y documentales

function estadoTmdb(texto, esError = false) {
  const nodo = $('#tmdb-estado');
  nodo.textContent = texto;
  nodo.classList.toggle('error', esError);
}

function limpiarTmdb() {
  const f = form();
  f.tmdb.value = '';
  f.temporadas_total.value = '';
  $('#tmdb-buscar').value = '';
  $('#tmdb-resultados').replaceChildren();
  estadoTmdb('');
}

function clienteTmdb() {
  if (!claveDe('tmdb')) throw new Error('No hay clave de TMDB configurada en el repositorio de datos. Rellena los datos a mano.');
  return crearTmdb(claveDe('tmdb'));
}

const NOMBRE_MEDIA = { movie: 'Película', tv: 'Serie' };

async function buscarTmdb() {
  const texto = $('#tmdb-buscar').value.trim();
  if (!texto) return;
  $('#tmdb-resultados').replaceChildren();
  const boton = $('#btn-tmdb');
  boton.disabled = true;
  estadoTmdb('Buscando…');
  try {
    const resultados = await clienteTmdb().buscar(texto);
    estadoTmdb(resultados.length ? 'Elige el correcto:' : 'TMDB no encuentra nada con ese título.');
    $('#tmdb-resultados').replaceChildren(
      ...resultados.slice(0, 8).map((r) =>
        filaResultado({
          miniatura: r.miniatura,
          icono: '🎬',
          titulo: r.titulo,
          detalle: [r.documental ? 'Documental' : NOMBRE_MEDIA[r.media], r.anio].filter(Boolean).join(' · '),
          alElegir: () => elegirTmdb(r),
        }),
      ),
    );
  } catch (e) {
    estadoTmdb(e.message, true);
  } finally {
    boton.disabled = false;
  }
}

async function elegirTmdb(resultado) {
  const f = form();
  $('#tmdb-resultados').replaceChildren();
  estadoTmdb('Cargando datos…');
  try {
    const tmdb = clienteTmdb();
    const d = await tmdb.detalles(resultado.media, resultado.id);
    const tipo = d.documental ? 'documentales' : d.media === 'movie' ? 'peliculas' : 'series';
    f.tipo.value = tipo;
    f.subtipo.value = d.media === 'tv' ? 'serie' : 'pelicula';
    f.titulo.value = d.titulo;
    f.anio.value = d.anio ?? '';
    f.tmdb.value = `${d.media}:${d.id}`;
    f.temporadas_total.value = d.temporadas_total ?? '';
    if (d.temporadas_total) f.temporadas.placeholder = `por ejemplo 1-${d.temporadas_total}`;
    ponerPortada(d.portada);
    ajustar();

    const notas = [];
    if (d.documental) notas.push('TMDB lo clasifica como documental: se guardará en Documentales (puedes cambiar el tipo).');
    if (d.temporadas_total) notas.push(`Tiene ${d.temporadas_total} ${d.temporadas_total === 1 ? 'temporada' : 'temporadas'}; indica cuáles tenéis o pulsa «Todas».`);
    const existente = app.almacen.items(tipo).find((it) => it.id === `tmdb:${d.media}:${d.id}` || it.id.startsWith(`tmdb:${d.media}:${d.id}:`));
    if (existente) {
      notas.push(d.media === 'tv'
        ? `Ya tenéis esta serie, temporadas ${textoTemporadas(existente)}: las nuevas se añadirán a su ficha.`
        : `Ya tenéis esta película${existente.formato ? ` en ${existente.formato}` : ''}. Solo se puede añadir otra edición con un formato distinto.`);
    }
    if (d.coleccion && !f.saga.value.trim()) {
      const saga = await tmdb.saga(d.coleccion, d.id).catch(() => null);
      if (proponerSaga(saga)) {
        notas.push(`Saga propuesta: ${saga.nombre}${saga.orden ? `, nº ${saga.orden}` : ''}${saga.total ? ` de ${saga.total}` : ''}.`);
      }
    }
    estadoTmdb(['Datos de TMDB.', ...notas].join(' '));
    (llevaTemporadas(tipo, f.subtipo.value) ? f.temporadas : f.formato).focus();
  } catch (e) {
    estadoTmdb(e.message, true);
  }
}

// ---------- Abrir

/** Se abre sin el foco en ningún campo de texto, para que no salga el teclado. */
export function abrirAlta(tipoPorDefecto) {
  const f = form();
  f.reset();
  modo = { edicion: false };
  $('#form-titulo').textContent = 'Añadir';
  f.tipo.value = tipoPorDefecto;
  f.formato.value = formatoPorDefecto(tipoPorDefecto);
  f.temporadas.placeholder = 'por ejemplo 1-3, 5';
  $('#campo-saga').open = false;
  $('#filas-temporadas').replaceChildren();
  limpiarTmdb();
  ponerPortada('');
  estadoIsbn('');
  $('#isbn-resultados').replaceChildren();
  limpiarMensajes();
  ajustar();
  $('#dlg-alta').showModal();
}

export function abrirEdicion(tipo, item) {
  const f = form();
  f.reset();
  modo = { edicion: true, tipo, original: item };
  $('#form-titulo').textContent = 'Editar';
  f.tipo.value = tipo;
  if (item.subtipo) f.subtipo.value = item.subtipo;
  for (const campo of ['titulo', 'autor', 'ubicacion', 'notas']) f[campo].value = item[campo] ?? '';
  f.formato.value = normalizarFormato(item.formato) || formatoPorDefecto(tipo);
  f.anio.value = item.anio ?? '';
  f.saga.value = sagaDe(item.saga)?.nombre ?? '';
  f.saga_orden.value = item.saga?.orden ?? '';
  $('#campo-saga').open = Boolean(f.saga.value);
  $('#filas-temporadas').replaceChildren(...(item.temporadas ?? []).map(filaTemporada));
  limpiarTmdb();
  ponerPortada('');
  estadoIsbn('');
  limpiarMensajes();
  ajustar();
  $('#dlg-alta').showModal();
}

// ---------- Guardar

/** Crea la saga en sagas.json, o actualiza su total, solo si hace falta. */
async function asegurarSagaRemota(tipo, saga) {
  if (!asegurarSaga({ items: app.almacen.items('sagas') }, tipo, saga)) return;
  const resultado = await app.cliente.actualizar(
    'sagas.json',
    (datos) => asegurarSaga(datos, tipo, saga),
    `Saga: ${saga.nombre} (por ${app.config.nombre})`,
  );
  app.almacen.fijar('sagas', resultado.datos);
}

async function guardar(forzar) {
  const f = form();
  const m = modo;
  const tipo = tipoActual();
  const campos = Object.fromEntries(new FormData(f));
  const opciones = { nombre: app.config.nombre, fecha: hoy() };
  limpiarMensajes();

  let item;
  let saga;
  try {
    saga = CON_SAGA.includes(tipo) ? leerCamposSaga(tipo, campos) : null;
    if (m.edicion) {
      item = editarItem(m.original, tipo, { ...campos, temporadasDetalle: leerFilasTemporadas() }, opciones);
    } else {
      item = construirItem(tipo, campos, opciones);
    }
    if (saga) item.saga = { id: saga.id, orden: saga.orden };
    else if (CON_SAGA.includes(tipo)) delete item.saga;

    if (m.edicion && sinCambios(m.original, item) && !(saga && asegurarSaga({ items: app.almacen.items('sagas') }, tipo, saga))) {
      $('#dlg-alta').close();
      aviso('No había cambios.');
      return;
    }
    // Comprobación rápida con la copia local, antes de ir a GitHub.
    if (m.edicion) comprobarEdicion(app.almacen.items(tipo), m.original, item, { forzar });
    else item = prepararAlta(app.almacen.items(tipo), item, { forzar });
  } catch (e) {
    if (e instanceof SerieExistenteError) ofrecerTemporadas(tipo, e.existente, item);
    else if (e instanceof ParecidoError) mostrarParecidos(e);
    else mostrarError(e.message);
    return;
  }

  if (!navigator.onLine) {
    mostrarError('Sin conexión: no se puede guardar ahora. Lo escrito se mantiene.');
    return;
  }

  const boton = $('#alta-guardar');
  boton.disabled = true;
  boton.textContent = 'Guardando…';
  try {
    if (saga) await asegurarSagaRemota(tipo, saga);
    // Segunda comprobación contra la versión más reciente del fichero, dentro del ciclo de reintento.
    const mutar = m.edicion
      ? (datos) => {
          const fresco = datos.items.find((it) => it.id === m.original.id);
          if (!fresco) throw new Error('Otra persona ha eliminado este título mientras lo editabas.');
          const resultado = aplicarCambios(fresco, m.original, item);
          comprobarEdicion(datos.items, m.original, resultado, { forzar });
          return { ...datos, items: datos.items.map((it) => (it.id === m.original.id ? resultado : it)) };
        }
      : (datos) => ({ ...datos, items: [...datos.items, prepararAlta(datos.items, item, { forzar })] });
    const accion = m.edicion ? 'Edición' : 'Alta';
    const resultado = await app.cliente.actualizar(`${tipo}.json`, mutar, `${accion}: ${item.titulo} (por ${app.config.nombre})`);
    app.almacen.fijar(tipo, resultado.datos);
    $('#dlg-alta').close();
    alGuardar();
    aviso(m.edicion ? `«${item.titulo}» guardado.` : `«${item.titulo}» añadido.`);
  } catch (e) {
    if (e instanceof SerieExistenteError) ofrecerTemporadas(tipo, e.existente, item);
    else if (e instanceof ParecidoError) mostrarParecidos(e);
    else mostrarError(e.message);
    // Otra persona pudo cambiar algo: refrescamos la copia local sin molestar.
    if (e instanceof DuplicadoError || e instanceof ParecidoError || e instanceof SerieExistenteError) {
      app.almacen.recargar(app.cliente).then(alGuardar, () => {});
    }
  } finally {
    boton.disabled = false;
    boton.textContent = 'Guardar';
  }
}

/** Añade las temporadas del formulario a la ficha de una serie que ya existe. */
async function guardarTemporadas(tipo, existente, item) {
  limpiarMensajes();
  if (!navigator.onLine) return mostrarError('Sin conexión: no se puede guardar ahora. Lo escrito se mantiene.');
  const boton = $('#alta-forzar');
  boton.disabled = true;
  let resumen;
  try {
    const opciones = { nombre: app.config.nombre, fecha: hoy(), total: item.temporadas_total };
    const resultado = await app.cliente.actualizar(
      `${tipo}.json`,
      (datos) => {
        const actual = datos.items.find((it) => it.id === existente.id);
        if (!actual) throw new Error('Otra persona ha eliminado esa serie mientras tanto. Pulsa Guardar para darla de alta.');
        resumen = anadirTemporadas(actual, item.temporadas, opciones);
        return { ...datos, items: datos.items.map((it) => (it.id === actual.id ? resumen.item : it)) };
      },
      `Temporadas: ${existente.titulo} (por ${app.config.nombre})`,
    );
    app.almacen.fijar(tipo, resultado.datos);
    $('#dlg-alta').close();
    alGuardar();
    const ya = resumen.repetidas.length ? `; ${resumen.repetidas.join(', ')} ya estaba${resumen.repetidas.length > 1 ? 'n' : ''}` : '';
    aviso(`Añadida${resumen.anadidas.length > 1 ? 's las temporadas' : ' la temporada'} ${resumen.anadidas.join(', ')} a «${existente.titulo}»${ya}.`);
  } catch (e) {
    mostrarError(e.message);
  } finally {
    boton.disabled = false;
  }
}

// ---------- Arranque

export function iniciarFormulario({ despuesDeGuardar }) {
  alGuardar = despuesDeGuardar;
  const f = form();
  $('#alta-tipo').replaceChildren(...TIPOS.map((t) => el('option', { value: t.clave }, t.singular)));
  $('#alta-formato').replaceChildren(...opcionesFormato());
  $('#campo-ubicacion').append(selectorUbicacion(f.ubicacion));
  $('#campo-saga-nombre').append(selector(f.saga, { valores: () => sagas.map((s) => s.nombre), nombre: 'Sagas', alElegir: elegirSaga }));
  f.tipo.addEventListener('change', () => {
    f.formato.value = formatoPorDefecto(f.tipo.value);
    ajustar();
  });
  f.subtipo.addEventListener('change', ajustar);
  f.saga.addEventListener('input', sugerirTotal);
  f.addEventListener('input', (e) => {
    if (e.target.name !== 'tipo') $('#alta-parecidos').hidden = true;
  });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    guardar(false);
  });
  $('#alta-forzar').addEventListener('click', () => accionAviso());
  $('#alta-cancelar').addEventListener('click', () => $('#dlg-alta').close());
  $('#alta-cerrar').addEventListener('click', () => $('#dlg-alta').close());
  $('#btn-temporada').addEventListener('click', anadirFilaTemporada);

  $('#btn-tmdb').addEventListener('click', buscarTmdb);
  $('#tmdb-buscar').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    buscarTmdb();
  });
  // «Añadir todas»: toda la serie con el mismo formato y ubicación.
  $('#btn-todas').addEventListener('click', () => {
    const total = Number(f.temporadas_total.value);
    if (total > 0) f.temporadas.value = total === 1 ? '1' : `1-${total}`;
  });
  const buscarLibroOTitulo = () => (f.isbn.value.trim() ? procesarIsbn(f.isbn.value) : buscarTitulo());
  $('#btn-buscar-isbn').addEventListener('click', buscarLibroOTitulo);
  $('#btn-escanear').addEventListener('click', abrirEscaner);
  f.isbn.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    buscarLibroOTitulo();
  });
  // Un ISBN distinto invalida la portada y los mensajes del anterior.
  f.isbn.addEventListener('input', () => {
    ponerPortada('');
    estadoIsbn('');
    $('#isbn-resultados').replaceChildren();
  });
  $('#escaner-cancelar').addEventListener('click', cerrarEscaner);
  $('#escaner-fotograma').addEventListener('click', () => guardarFotograma($('#video-escaner')));
  $('#escaner-zoom-mas').addEventListener('click', () => cambiarZoom(true));
  $('#escaner-zoom-menos').addEventListener('click', () => cambiarZoom(false));
  $('#dlg-escaner').addEventListener('cancel', (e) => {
    e.preventDefault();
    cerrarEscaner();
  });
  // Al cerrar el formulario no debe quedar la cámara encendida.
  $('#dlg-alta').addEventListener('close', cerrarEscaner);
}
