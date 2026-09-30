// Formulario de alta y edición: validación, duplicados, saga y guardado con reintento.

import { TIPOS, TIPO, construirItem, editarItem, sinCambios, aplicarCambios, anadirTemporadas, dondeEsta, formatosDe, hoy, llevaTemporadas, textoTemporadas, ubicacionesDe } from './modelo.js';
import { comprobarEdicion, prepararAlta, DuplicadoError, ParecidoError, SerieExistenteError } from './duplicados.js';
import { leerCamposSaga, asegurarSaga, idSaga } from './sagas.js';
import { normalizarIsbn } from './isbn.js';
import { buscarLibro } from './catalogo.js';
import { escanearIsbn } from './escaner.js';
import { crearTmdb } from './tmdb.js';
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
  $('#campo-tmdb').hidden = TIPO[tipo].isbn || modo.edicion;
  $('#btn-todas').hidden = !(Number(f.temporadas_total.value) > 0);
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
  if (!app.config.tmdb) throw new Error('Para buscar en TMDB, pon su clave en Ajustes (⚙). Mientras, rellena los datos a mano.');
  return crearTmdb(app.config.tmdb);
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
        el('li', {},
          el('button', { type: 'button', class: 'resultado', onclick: () => elegirTmdb(r) },
            r.miniatura
              ? el('img', { src: r.miniatura, alt: '', loading: 'lazy', onerror: (e) => (e.currentTarget.style.visibility = 'hidden') })
              : el('span', { class: 'sin-imagen', 'aria-hidden': 'true' }, '🎬'),
            el('span', {}, el('strong', {}, r.titulo), el('small', {}, [r.documental ? 'Documental' : NOMBRE_MEDIA[r.media], r.anio].filter(Boolean).join(' · '))),
          ),
        ),
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
    f.autor.value = d.autor;
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
      if (saga?.nombre) {
        f.saga.value = saga.nombre;
        f.saga_orden.value = saga.orden ?? '';
        f.saga_total.value = saga.total ?? '';
        sugerirTotal();
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

export function abrirAlta(tipoPorDefecto) {
  const f = form();
  f.reset();
  modo = { edicion: false };
  $('#form-titulo').textContent = 'Añadir';
  f.tipo.value = tipoPorDefecto;
  f.temporadas.placeholder = 'por ejemplo 1-3, 5';
  $('#filas-temporadas').replaceChildren();
  limpiarTmdb();
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
  $('#alta-forzar').addEventListener('click', () => accionAviso());
  $('#alta-cancelar').addEventListener('click', () => $('#dlg-alta').close());
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
