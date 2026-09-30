// Interfaz: pestañas, listado, búsqueda, ficha, sagas, ajustes y arranque.

import { TIPOS, TIPO, dondeEsta, resumirTemporadas } from './modelo.js';
import { guardarConfig, normalizarRepo } from './config.js';
import { crearCliente } from './github.js';
import { terminosDe, coincide } from './busqueda.js';
import { estadoSaga } from './sagas.js';
import { compararTitulos, limpiar } from './texto.js';
import { app, sagaDe } from './estado.js';
import { $, el, aviso, fechaLegible } from './dom.js';
import { abrirAlta, abrirEdicion, abrirEscaner, iniciarFormulario } from './formulario.js';

const CLAVE_AGRUPAR = 'librarium.agrupar';

let pestana = 'todo';
let terminos = [];
let agrupar = false;
try {
  agrupar = localStorage.getItem(CLAVE_AGRUPAR) === '1';
} catch {
  // Sin almacenamiento: se empieza sin agrupar.
}
/** Lo que muestra ahora la ficha: { tipo, item } o null si muestra una saga. */
let fichaActual = null;

function mostrarEstado(texto, esError = false) {
  const nodo = $('#estado');
  nodo.textContent = texto;
  nodo.classList.toggle('error', esError);
}

// ---------- Listado

function pintarPestanas() {
  const opciones = [{ clave: 'todo', nombre: 'Todo' }, ...TIPOS];
  $('#pestanas').replaceChildren(
    ...opciones.map(({ clave, nombre }) =>
      el('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': String(clave === pestana),
        onclick: () => {
          pestana = clave;
          pintarPestanas();
          render();
        },
      }, nombre),
    ),
  );
}

function portada(item, tipo) {
  if (/^https:\/\//.test(item?.portada ?? '')) return el('img', { class: 'portada', src: item.portada, alt: '', loading: 'lazy' });
  return el('div', { class: 'portada vacia', 'aria-hidden': 'true' }, TIPO[tipo].icono);
}

function lineaSecundaria(item) {
  const partes = [item.autor, item.anio];
  if (item.temporadas?.length) partes.push(`T. ${resumirTemporadas(item.temporadas)}`);
  if (item.saga) partes.push(`${sagaDe(item.saga).nombre} #${item.saga.orden}`);
  return partes.filter(Boolean).join(' · ');
}

function miembrosDe(saga) {
  return app.almacen
    .items(saga.tipo)
    .filter((it) => it.saga?.id === saga.id)
    .sort((a, b) => a.saga.orden - b.saga.orden || compararTitulos(a.titulo, b.titulo));
}

/** Tarjetas a mostrar: títulos sueltos y, si se agrupa, una tarjeta por saga. */
function tarjetasVisibles() {
  const tipos = pestana === 'todo' ? TIPOS.map((t) => t.clave) : [pestana];
  const titulos = tipos
    .flatMap((tipo) => app.almacen.items(tipo).map((item) => ({ tipo, item })))
    .filter(({ item }) => coincide(item, terminos, sagaDe(item.saga)?.nombre));

  const tarjetas = [];
  const sagas = new Map();
  for (const entrada of titulos) {
    if (agrupar && entrada.item.saga) {
      const saga = sagaDe(entrada.item.saga);
      if (!sagas.has(saga.id)) {
        const tarjeta = { saga, tipo: entrada.tipo, nombre: saga.nombre };
        sagas.set(saga.id, tarjeta);
        tarjetas.push(tarjeta);
      }
    } else {
      tarjetas.push({ ...entrada, nombre: entrada.item.titulo });
    }
  }
  return tarjetas.sort((a, b) => compararTitulos(a.nombre, b.nombre));
}

function tarjetaTitulo({ tipo, item }) {
  return el('button', { class: 'tarjeta', type: 'button', onclick: () => abrirDetalle(tipo, item) },
    portada(item, tipo),
    el('div', { class: 'info' },
      el('strong', {}, item.titulo),
      el('span', { class: 'linea' }, lineaSecundaria(item)),
      el('span', { class: 'ubic' }, dondeEsta(item) && `📍 ${dondeEsta(item)}`),
    ),
    pestana === 'todo' && el('span', { class: 'chip' }, TIPO[tipo].singular),
  );
}

function tarjetaSaga({ tipo, saga }) {
  const miembros = miembrosDe(saga);
  const ubicaciones = [...new Set(miembros.map(dondeEsta).filter(Boolean))].join(', ');
  return el('button', { class: 'tarjeta', type: 'button', onclick: () => abrirSaga(saga) },
    portada(miembros.find((m) => m.portada), tipo),
    el('div', { class: 'info' },
      el('strong', {}, saga.nombre),
      el('span', { class: 'linea' }, `Saga · ${estadoSaga(saga, miembros).texto}`),
      el('span', { class: 'ubic' }, ubicaciones && `📍 ${ubicaciones}`),
    ),
    el('span', { class: 'chip' }, pestana === 'todo' ? `Saga · ${TIPO[tipo].singular}` : 'Saga'),
  );
}

function render() {
  const tarjetas = tarjetasVisibles();
  $('#lista').replaceChildren(...tarjetas.map((t) => el('li', {}, t.saga ? tarjetaSaga(t) : tarjetaTitulo(t))));

  const n = tarjetas.length;
  const unidad = agrupar ? (n === 1 ? 'elemento' : 'elementos') : n === 1 ? 'título' : 'títulos';
  $('#contador').textContent = n ? `${n} ${unidad}` : '';
  const vacio = $('#vacio');
  vacio.hidden = n > 0 || !app.almacen.fecha;
  vacio.textContent = terminos.length ? 'Nada coincide con la búsqueda.' : 'Todavía no hay nada aquí. Pulsa «Añadir».';
}

async function recargar() {
  if (!app.cliente) return;
  if (!navigator.onLine) {
    const fecha = app.almacen.fecha;
    mostrarEstado(fecha ? `Sin conexión. Mostrando la copia del ${fechaLegible(fecha)}.` : 'Sin conexión.');
    return;
  }
  const boton = $('#btn-recargar');
  boton.disabled = true;
  mostrarEstado('Cargando…');
  try {
    await app.almacen.recargar(app.cliente);
    mostrarEstado('');
    render();
  } catch (e) {
    const fecha = app.almacen.fecha;
    mostrarEstado(e.message + (fecha ? ` Mostrando la copia del ${fechaLegible(fecha)}.` : ''), true);
  } finally {
    boton.disabled = false;
  }
}

// ---------- Ficha de detalle y de saga

function prepararFicha(actual) {
  fichaActual = actual;
  $('#detalle-error').textContent = '';
  $('#detalle-editar').hidden = !actual;
  $('#detalle-borrar').hidden = !actual;
  const dialogo = $('#dlg-detalle');
  if (!dialogo.open) dialogo.showModal();
  dialogo.scrollTop = 0;
}

function abrirDetalle(tipo, item) {
  const saga = sagaDe(item.saga);
  const filas = [
    ['Tipo', item.subtipo === 'serie' ? 'Docuserie' : TIPO[tipo].singular],
    [TIPO[tipo].autor, item.autor],
    ['Año', item.anio],
    ['Formato', item.formato],
    ['Ubicación', item.ubicacion],
    ['Temporadas', item.temporadas?.length &&
      el('ul', {}, item.temporadas.map((t) => el('li', {}, [`T${t.num}`, t.formato, t.ubicacion].filter(Boolean).join(' · '))))],
    ['Saga', saga &&
      el('button', { type: 'button', class: 'enlace', onclick: () => abrirSaga(saga) },
        `${saga.nombre} · nº ${item.saga.orden} (${estadoSaga(saga, miembrosDe(saga)).texto})`)],
    ['Notas', item.notas],
    ['Alta', [item.alta_por, item.alta_fecha].filter(Boolean).join(', ')],
    ['Modificado', [item.mod_por, item.mod_fecha].filter(Boolean).join(', ')],
    ['Identificador', item.id],
  ].filter(([, valor]) => valor != null && valor !== '' && valor !== 0 && valor !== false);

  $('#detalle-contenido').replaceChildren(
    el('div', { class: 'cabeza' }, portada(item, tipo), el('h2', {}, item.titulo)),
    el('dl', {}, filas.flatMap(([etiqueta, valor]) => [el('dt', {}, etiqueta), el('dd', {}, valor)])),
  );
  prepararFicha({ tipo, item });
}

function abrirSaga(saga) {
  const miembros = miembrosDe(saga);
  const estado = estadoSaga(saga, miembros);
  $('#detalle-contenido').replaceChildren(
    el('div', {},
      el('h2', {}, saga.nombre),
      el('p', { class: 'subtitulo' }, `Saga de ${TIPO[saga.tipo].nombre.toLowerCase()} · tenéis ${estado.texto}`),
    ),
    estado.faltan.length > 0 && el('p', {}, `Faltan: ${estado.faltan.join(', ')}`),
    el('ol', {},
      miembros.map((item) =>
        el('li', { value: item.saga.orden },
          el('button', { type: 'button', class: 'enlace', onclick: () => abrirDetalle(saga.tipo, item) }, item.titulo),
          dondeEsta(item) && ` — ${dondeEsta(item)}`,
        ),
      ),
    ),
  );
  prepararFicha(null);
}

async function borrar() {
  const { tipo, item } = fichaActual;
  if (!confirm(`¿Eliminar «${item.titulo}»?\nSe podría recuperar desde el historial del repo de datos.`)) return;
  if (!navigator.onLine) {
    $('#detalle-error').textContent = 'Sin conexión: no se puede eliminar ahora.';
    return;
  }
  const boton = $('#detalle-borrar');
  boton.disabled = true;
  try {
    const resultado = await app.cliente.actualizar(
      `${tipo}.json`,
      (datos) => (datos.items.some((it) => it.id === item.id) ? { ...datos, items: datos.items.filter((it) => it.id !== item.id) } : null),
      `Baja: ${item.titulo} (por ${app.config.nombre})`,
    );
    app.almacen.fijar(tipo, resultado.datos);
    $('#dlg-detalle').close();
    render();
    aviso(`«${item.titulo}» eliminado.`);
  } catch (e) {
    $('#detalle-error').textContent = e.message;
  } finally {
    boton.disabled = false;
  }
}

// ---------- Ajustes

function abrirAjustes() {
  const f = $('#form-ajustes');
  for (const campo of ['nombre', 'repo', 'token', 'google', 'tmdb']) f[campo].value = app.config[campo];
  $('#ajustes-error').textContent = '';
  $('#ajustes-cancelar').hidden = !app.cliente;
  $('#dlg-ajustes').showModal();
}

async function guardarAjustes(evento) {
  evento.preventDefault();
  const f = evento.target;
  const error = $('#ajustes-error');
  const repo = normalizarRepo(f.repo.value);
  const nueva = { nombre: limpiar(f.nombre.value), repo, token: f.token.value.trim(), google: f.google.value.trim(), tmdb: f.tmdb.value.trim() };
  if (!nueva.nombre || !nueva.token) return void (error.textContent = 'Rellena tu nombre y el token.');
  if (!repo) return void (error.textContent = 'El repositorio debe tener la forma usuario/nombre.');

  const boton = $('#ajustes-guardar');
  boton.disabled = true;
  boton.textContent = 'Comprobando…';
  error.textContent = '';
  try {
    const cliente = crearCliente(nueva);
    await app.almacen.recargar(cliente);
    guardarConfig(nueva);
    app.config = nueva;
    app.cliente = cliente;
    $('#dlg-ajustes').close();
    mostrarEstado('');
    render();
    aviso(`Conectado. Hola, ${nueva.nombre}.`);
  } catch (e) {
    error.textContent = e.message;
  } finally {
    boton.disabled = false;
    boton.textContent = 'Guardar y conectar';
  }
}

// ---------- Arranque

function iniciar() {
  pintarPestanas();
  iniciarFormulario({ despuesDeGuardar: render });

  $('#buscar').addEventListener('input', (e) => {
    terminos = terminosDe(e.target.value);
    render();
  });
  const casilla = $('#agrupar');
  casilla.checked = agrupar;
  casilla.addEventListener('change', () => {
    agrupar = casilla.checked;
    try {
      localStorage.setItem(CLAVE_AGRUPAR, agrupar ? '1' : '0');
    } catch {
      // Preferencia solo para esta sesión.
    }
    render();
  });

  $('#btn-recargar').addEventListener('click', recargar);
  $('#btn-ajustes').addEventListener('click', abrirAjustes);
  $('#btn-alta').addEventListener('click', () => {
    if (!app.cliente) return abrirAjustes();
    abrirAlta(pestana === 'todo' ? 'libros' : pestana);
  });
  // Escanear directamente: abre el alta (libro, o cómic si se está en esa pestaña) con la cámara.
  $('#btn-escanear-rapido').addEventListener('click', () => {
    if (!app.cliente) return abrirAjustes();
    abrirAlta(pestana === 'comics' ? 'comics' : 'libros');
    abrirEscaner();
  });

  $('#form-ajustes').addEventListener('submit', guardarAjustes);
  $('#ajustes-cancelar').addEventListener('click', () => $('#dlg-ajustes').close());
  // Sin configuración no se puede cerrar el diálogo de ajustes.
  $('#dlg-ajustes').addEventListener('cancel', (e) => {
    if (!app.cliente) e.preventDefault();
  });

  $('#detalle-cerrar').addEventListener('click', () => $('#dlg-detalle').close());
  $('#detalle-editar').addEventListener('click', () => {
    const { tipo, item } = fichaActual;
    $('#dlg-detalle').close();
    abrirEdicion(tipo, item);
  });
  $('#detalle-borrar').addEventListener('click', borrar);
  // Cerrar la ficha pulsando fuera.
  $('#dlg-detalle').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });

  window.addEventListener('online', recargar);
  window.addEventListener('offline', () => mostrarEstado('Sin conexión. Puedes consultar, pero no guardar cambios.'));

  render();
  if (app.cliente) recargar();
  else abrirAjustes();
}

iniciar();
