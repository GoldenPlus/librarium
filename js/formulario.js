// Formulario de alta y edición: validación, duplicados, saga y guardado con reintento.

import { TIPOS, TIPO, construirItem, editarItem, sinCambios, aplicarCambios, dondeEsta, formatosDe, hoy, llevaTemporadas, ubicacionesDe } from './modelo.js';
import { comprobarDuplicados, comprobarEdicion, DuplicadoError, ParecidoError } from './duplicados.js';
import { leerCamposSaga, asegurarSaga, idSaga } from './sagas.js';
import { normalizarIsbn } from './isbn.js';
import { buscarLibro } from './catalogo.js';
import { escanearIsbn } from './escaner.js';
import { app, sagaDe } from './estado.js';
import { $, el, aviso } from './dom.js';

const form = () => $('#form-alta');

/** { edicion: false } para altas; { edicion: true, tipo, original } al editar. */
let modo = { edicion: false };
let alGuardar = () => {};

// ---------- Presentación

function rellenarDatalist(selector, valores) {
  $(selector).replaceChildren(...valores.map((v) => el('option', { value: v })));
}

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
  $('#campo-subtipo').hidden = tipo !== 'documentales';
  $('#campo-temporadas').hidden = !conTemporadas || modo.edicion;
  $('#campo-temporadas-edicion').hidden = !filasDeTemporadas;
  $('#campo-formato').hidden = filasDeTemporadas;
  $('#campo-ubicacion').hidden = filasDeTemporadas;
  $('#etiqueta-autor').textContent = TIPO[tipo].autor;

  rellenarDatalist('#dl-formatos', formatosDe(tipo, app.almacen.items(tipo)));
  rellenarDatalist('#dl-ubicaciones', ubicacionesDe(TIPOS.flatMap((t) => app.almacen.items(t.clave))));
  rellenarDatalist('#dl-sagas', app.almacen.items('sagas').filter((s) => s.tipo === tipo).map((s) => s.nombre));
  sugerirTotal();
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

function mostrarParecidos(error) {
  $('#alta-parecidos p').textContent = error.message;
  $('#alta-parecidos ul').replaceChildren(
    ...error.parecidos.slice(0, 5).map((it) =>
      el('li', {}, `«${it.titulo}»`, it.autor && ` — ${it.autor}`, dondeEsta(it) && ` (${dondeEsta(it)})`),
    ),
  );
  $('#alta-parecidos').hidden = false;
  $('#alta-parecidos').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function filaTemporada({ num, formato = '', ubicacion = '' }) {
  return el('div', { class: 'fila-temporada' },
    el('input', { type: 'number', min: 1, max: 100, value: num, 'data-campo': 'num', 'aria-label': 'Número de temporada' }),
    el('input', { 'data-campo': 'formato', list: 'dl-formatos', value: formato, placeholder: 'Formato', 'aria-label': 'Formato' }),
    el('input', { 'data-campo': 'ubicacion', list: 'dl-ubicaciones', value: ubicacion, placeholder: 'Ubicación', 'aria-label': 'Ubicación' }),
    el('button', { type: 'button', class: 'icono', 'aria-label': `Quitar temporada`, onclick: (e) => e.currentTarget.parentElement.remove() }, '✕'),
  );
}

function leerFilasTemporadas() {
  return [...document.querySelectorAll('.fila-temporada')].map((fila) =>
    Object.fromEntries([...fila.querySelectorAll('input')].map((i) => [i.dataset.campo, i.value])),
  );
}

function anadirFilaTemporada() {
  const filas = leerFilasTemporadas();
  const ultima = filas.at(-1) ?? {};
  const siguiente = Math.max(0, ...filas.map((f) => Number(f.num) || 0)) + 1;
  $('#filas-temporadas').append(filaTemporada({ num: siguiente, formato: ultima.formato, ubicacion: ultima.ubicacion }));
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

/** Valida el ISBN, avisa si ya lo tenéis y rellena el formulario con los datos que se encuentren. */
async function procesarIsbn(texto) {
  const f = form();
  limpiarMensajes();
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
  const datos = await buscarLibro(isbn, { claveGoogle: app.config.google });
  boton.disabled = false;
  if (normalizarIsbn(f.isbn.value) !== isbn) return; // Se cambió el ISBN mientras tanto.

  if (!datos) {
    estadoIsbn('No hay datos de este ISBN en Open Library ni Google Books. Rellena el resto a mano; el ISBN se guarda igual.');
    f.titulo.focus();
    return;
  }
  if (datos.titulo) f.titulo.value = datos.titulo;
  if (datos.autor) f.autor.value = datos.autor;
  if (datos.anio) f.anio.value = datos.anio;
  ponerPortada(datos.portada);
  estadoIsbn(`Datos de ${datos.fuente}. Revísalos, elige la ubicación y guarda.`);
  f.ubicacion.focus();
}

let escaneo = null;

function cerrarEscaner() {
  escaneo?.detener();
  escaneo = null;
  if ($('#dlg-escaner').open) $('#dlg-escaner').close();
}

export async function abrirEscaner() {
  const estado = $('#escaner-estado');
  estado.textContent = 'Abriendo la cámara…';
  $('#dlg-escaner').showModal();
  escaneo = escanearIsbn($('#video-escaner'), {
    alIgnorar: (codigo) => (estado.textContent = `El código ${codigo} no es un ISBN. Busca el código que empieza por 978 o 979.`),
  });
  setTimeout(() => {
    if (escaneo && estado.textContent === 'Abriendo la cámara…') estado.textContent = 'Apunta al código de barras del libro.';
  }, 1500);
  try {
    const isbn = await escaneo.resultado;
    cerrarEscaner();
    if (isbn) {
      navigator.vibrate?.(80);
      await procesarIsbn(isbn);
    }
  } catch (e) {
    escaneo = null;
    $('#dlg-escaner').close();
    estadoIsbn(e.message, true);
    form().isbn.focus();
  }
}

// ---------- Abrir

export function abrirAlta(tipoPorDefecto) {
  const f = form();
  f.reset();
  modo = { edicion: false };
  $('#form-titulo').textContent = 'Añadir';
  f.tipo.value = tipoPorDefecto;
  $('#filas-temporadas').replaceChildren();
  ponerPortada('');
  estadoIsbn('');
  limpiarMensajes();
  ajustar();
  $('#dlg-alta').showModal();
  f.titulo.focus();
}

export function abrirEdicion(tipo, item) {
  const f = form();
  f.reset();
  modo = { edicion: true, tipo, original: item };
  $('#form-titulo').textContent = 'Editar';
  f.tipo.value = tipo;
  if (item.subtipo) f.subtipo.value = item.subtipo;
  for (const campo of ['titulo', 'autor', 'formato', 'ubicacion', 'notas']) f[campo].value = item[campo] ?? '';
  f.anio.value = item.anio ?? '';
  f.saga.value = sagaDe(item.saga)?.nombre ?? '';
  f.saga_orden.value = item.saga?.orden ?? '';
  $('#filas-temporadas').replaceChildren(...(item.temporadas ?? []).map(filaTemporada));
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
    saga = leerCamposSaga(tipo, campos);
    if (m.edicion) {
      item = editarItem(m.original, tipo, { ...campos, temporadasDetalle: leerFilasTemporadas() }, opciones);
    } else {
      item = construirItem(tipo, campos, opciones);
    }
    if (saga) item.saga = { id: saga.id, orden: saga.orden };
    else delete item.saga;

    if (m.edicion && sinCambios(m.original, item) && !(saga && asegurarSaga({ items: app.almacen.items('sagas') }, tipo, saga))) {
      $('#dlg-alta').close();
      aviso('No había cambios.');
      return;
    }
    // Comprobación rápida con la copia local, antes de ir a GitHub.
    if (m.edicion) comprobarEdicion(app.almacen.items(tipo), m.original, item, { forzar });
    else comprobarDuplicados(app.almacen.items(tipo), item, { forzar });
  } catch (e) {
    if (e instanceof ParecidoError) mostrarParecidos(e);
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
      : (datos) => {
          comprobarDuplicados(datos.items, item, { forzar });
          return { ...datos, items: [...datos.items, item] };
        };
    const accion = m.edicion ? 'Edición' : 'Alta';
    const resultado = await app.cliente.actualizar(`${tipo}.json`, mutar, `${accion}: ${item.titulo} (por ${app.config.nombre})`);
    app.almacen.fijar(tipo, resultado.datos);
    $('#dlg-alta').close();
    alGuardar();
    aviso(m.edicion ? `«${item.titulo}» guardado.` : `«${item.titulo}» añadido.`);
  } catch (e) {
    if (e instanceof ParecidoError) mostrarParecidos(e);
    else mostrarError(e.message);
    // Otra persona pudo cambiar algo: refrescamos la copia local sin molestar.
    if (e instanceof DuplicadoError || e instanceof ParecidoError) app.almacen.recargar(app.cliente).then(alGuardar, () => {});
  } finally {
    boton.disabled = false;
    boton.textContent = 'Guardar';
  }
}

// ---------- Arranque

export function iniciarFormulario({ despuesDeGuardar }) {
  alGuardar = despuesDeGuardar;
  const f = form();
  $('#alta-tipo').replaceChildren(...TIPOS.map((t) => el('option', { value: t.clave }, t.singular)));
  f.tipo.addEventListener('change', ajustar);
  f.subtipo.addEventListener('change', ajustar);
  f.saga.addEventListener('input', sugerirTotal);
  f.addEventListener('input', (e) => {
    if (e.target.name !== 'tipo') $('#alta-parecidos').hidden = true;
  });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    guardar(false);
  });
  $('#alta-forzar').addEventListener('click', () => guardar(true));
  $('#alta-cancelar').addEventListener('click', () => $('#dlg-alta').close());
  $('#btn-temporada').addEventListener('click', anadirFilaTemporada);

  $('#btn-buscar-isbn').addEventListener('click', () => procesarIsbn(f.isbn.value));
  $('#btn-escanear').addEventListener('click', abrirEscaner);
  f.isbn.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    procesarIsbn(f.isbn.value);
  });
  // Un ISBN distinto invalida la portada y los mensajes del anterior.
  f.isbn.addEventListener('input', () => {
    ponerPortada('');
    estadoIsbn('');
  });
  $('#escaner-cancelar').addEventListener('click', cerrarEscaner);
  $('#dlg-escaner').addEventListener('cancel', (e) => {
    e.preventDefault();
    cerrarEscaner();
  });
  // Al cerrar el formulario no debe quedar la cámara encendida.
  $('#dlg-alta').addEventListener('close', cerrarEscaner);
}
