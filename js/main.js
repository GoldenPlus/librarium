// Interfaz: pestañas, listado, búsqueda, ficha, ajustes y alta manual.

import { TIPOS, TIPO, construirItem, dondeEsta, formatosDe, hoy, llevaTemporadas, resumirTemporadas, ubicacionesDe } from './modelo.js';
import { leerConfig, guardarConfig, configCompleta, normalizarRepo } from './config.js';
import { crearCliente } from './github.js';
import { crearAlmacen } from './almacen.js';
import { terminosDe, coincide } from './busqueda.js';
import { buscarDuplicados, comprobarDuplicados, DuplicadoError, ParecidoError } from './duplicados.js';
import { compararTitulos, limpiar } from './texto.js';

const $ = (selector) => document.querySelector(selector);

function el(etiqueta, props = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(props)) {
    if (valor == null || valor === false) continue;
    if (clave === 'class') nodo.className = valor;
    else if (clave.startsWith('on')) nodo.addEventListener(clave.slice(2), valor);
    else nodo.setAttribute(clave, valor === true ? '' : valor);
  }
  nodo.append(...hijos.flat().filter((h) => h != null && h !== false && h !== ''));
  return nodo;
}

const almacen = crearAlmacen();
let config = leerConfig();
let cliente = configCompleta(config) ? crearCliente(config) : null;
let pestana = 'todo';
let terminos = [];

// ---------- Mensajes

let temporizadorAviso;
function aviso(texto) {
  const nodo = $('#aviso');
  nodo.textContent = texto;
  nodo.classList.add('visible');
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => nodo.classList.remove('visible'), 3000);
}

function mostrarEstado(texto, esError = false) {
  const nodo = $('#estado');
  nodo.textContent = texto;
  nodo.classList.toggle('error', esError);
}

function fechaLegible(iso) {
  return iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '';
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
  if (/^https:\/\//.test(item.portada ?? '')) return el('img', { class: 'portada', src: item.portada, alt: '', loading: 'lazy' });
  return el('div', { class: 'portada vacia', 'aria-hidden': 'true' }, TIPO[tipo].icono);
}

function lineaSecundaria(item) {
  const partes = [item.autor, item.anio];
  if (item.temporadas?.length) partes.push(`T. ${resumirTemporadas(item.temporadas)}`);
  return partes.filter(Boolean).join(' · ');
}

function entradasVisibles() {
  const tipos = pestana === 'todo' ? TIPOS.map((t) => t.clave) : [pestana];
  return tipos
    .flatMap((tipo) => almacen.items(tipo).map((item) => ({ tipo, item })))
    .filter(({ item }) => coincide(item, terminos))
    .sort((a, b) => compararTitulos(a.item.titulo, b.item.titulo));
}

function render() {
  const entradas = entradasVisibles();
  $('#lista').replaceChildren(
    ...entradas.map(({ tipo, item }) =>
      el('li', {},
        el('button', { class: 'tarjeta', type: 'button', onclick: () => abrirDetalle(tipo, item) },
          portada(item, tipo),
          el('div', { class: 'info' },
            el('strong', {}, item.titulo),
            el('span', { class: 'linea' }, lineaSecundaria(item)),
            el('span', { class: 'ubic' }, dondeEsta(item) && `📍 ${dondeEsta(item)}`),
          ),
          pestana === 'todo' && el('span', { class: 'chip' }, TIPO[tipo].singular),
        ),
      ),
    ),
  );

  const n = entradas.length;
  $('#contador').textContent = n ? `${n} ${n === 1 ? 'título' : 'títulos'}` : '';
  const vacio = $('#vacio');
  vacio.hidden = n > 0 || !almacen.fecha;
  vacio.textContent = terminos.length ? 'Nada coincide con la búsqueda.' : 'Todavía no hay nada aquí. Pulsa «Añadir».';
}

async function recargar() {
  if (!cliente) return;
  if (!navigator.onLine) {
    mostrarEstado(almacen.fecha ? `Sin conexión. Mostrando la copia del ${fechaLegible(almacen.fecha)}.` : 'Sin conexión.');
    return;
  }
  const boton = $('#btn-recargar');
  boton.disabled = true;
  mostrarEstado('Cargando…');
  try {
    await almacen.recargar(cliente);
    mostrarEstado('');
    render();
  } catch (e) {
    const copia = almacen.fecha ? ` Mostrando la copia del ${fechaLegible(almacen.fecha)}.` : '';
    mostrarEstado(e.message + copia, true);
  } finally {
    boton.disabled = false;
  }
}

// ---------- Ficha de detalle

function abrirDetalle(tipo, item) {
  const filas = [
    ['Tipo', item.subtipo === 'serie' ? 'Docuserie' : TIPO[tipo].singular],
    [TIPO[tipo].autor, item.autor],
    ['Año', item.anio],
    ['Formato', item.formato],
    ['Ubicación', item.ubicacion],
    ['Temporadas', item.temporadas?.length &&
      el('ul', {}, item.temporadas.map((t) => el('li', {}, [`T${t.num}`, t.formato, t.ubicacion].filter(Boolean).join(' · '))))],
    ['Notas', item.notas],
    ['Alta', [item.alta_por, item.alta_fecha].filter(Boolean).join(', ')],
    ['Modificado', [item.mod_por, item.mod_fecha].filter(Boolean).join(', ')],
    ['Identificador', item.id],
  ].filter(([, valor]) => valor != null && valor !== '' && valor !== 0 && valor !== false);

  $('#detalle-contenido').replaceChildren(
    el('div', { class: 'cabeza' }, portada(item, tipo), el('h2', {}, item.titulo)),
    el('dl', {}, filas.flatMap(([etiqueta, valor]) => [el('dt', {}, etiqueta), el('dd', {}, valor)])),
  );
  $('#dlg-detalle').showModal();
}

// ---------- Ajustes

function abrirAjustes() {
  const f = $('#form-ajustes');
  f.nombre.value = config.nombre;
  f.repo.value = config.repo;
  f.token.value = config.token;
  f.tmdb.value = config.tmdb;
  $('#ajustes-error').textContent = '';
  $('#ajustes-cancelar').hidden = !cliente;
  $('#dlg-ajustes').showModal();
}

async function guardarAjustes(evento) {
  evento.preventDefault();
  const f = evento.target;
  const error = $('#ajustes-error');
  const repo = normalizarRepo(f.repo.value);
  const nueva = { nombre: limpiar(f.nombre.value), repo, token: f.token.value.trim(), tmdb: f.tmdb.value.trim() };
  if (!nueva.nombre || !nueva.token) return void (error.textContent = 'Rellena tu nombre y el token.');
  if (!repo) return void (error.textContent = 'El repositorio debe tener la forma usuario/nombre.');

  const boton = $('#ajustes-guardar');
  boton.disabled = true;
  boton.textContent = 'Comprobando…';
  error.textContent = '';
  try {
    const nuevoCliente = crearCliente(nueva);
    await almacen.recargar(nuevoCliente);
    guardarConfig(nueva);
    config = nueva;
    cliente = nuevoCliente;
    $('#dlg-ajustes').close();
    mostrarEstado('');
    render();
    aviso(`Conectado. Hola, ${config.nombre}.`);
  } catch (e) {
    error.textContent = e.message;
  } finally {
    boton.disabled = false;
    boton.textContent = 'Guardar y conectar';
  }
}

// ---------- Alta manual

const formAlta = () => $('#form-alta');

function rellenarDatalist(selector, valores) {
  $(selector).replaceChildren(...valores.map((v) => el('option', { value: v })));
}

function ajustarFormularioAlta() {
  const f = formAlta();
  const tipo = f.tipo.value;
  $('#campo-isbn').hidden = !TIPO[tipo].isbn;
  $('#campo-subtipo').hidden = tipo !== 'documentales';
  $('#campo-temporadas').hidden = !llevaTemporadas(tipo, f.subtipo.value);
  $('#etiqueta-autor').textContent = TIPO[tipo].autor;
  rellenarDatalist('#dl-formatos', formatosDe(tipo, almacen.items(tipo)));
  rellenarDatalist('#dl-ubicaciones', ubicacionesDe(TIPOS.flatMap((t) => almacen.items(t.clave))));
}

function limpiarMensajesAlta() {
  $('#alta-error').textContent = '';
  $('#alta-parecidos').hidden = true;
}

function mostrarParecidos(parecidos) {
  $('#alta-parecidos ul').replaceChildren(
    ...parecidos.slice(0, 5).map((it) =>
      el('li', {}, `«${it.titulo}»`, it.autor && ` — ${it.autor}`, dondeEsta(it) && ` (${dondeEsta(it)})`),
    ),
  );
  $('#alta-parecidos').hidden = false;
  $('#alta-parecidos').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function mostrarErrorAlta(mensaje) {
  $('#alta-error').textContent = mensaje;
  $('#alta-error').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function abrirAlta() {
  if (!cliente) return abrirAjustes();
  const f = formAlta();
  f.reset();
  f.tipo.value = pestana === 'todo' ? 'libros' : pestana;
  limpiarMensajesAlta();
  ajustarFormularioAlta();
  $('#dlg-alta').showModal();
  f.titulo.focus();
}

async function guardarAlta(forzar) {
  const f = formAlta();
  const tipo = f.tipo.value;
  const campos = Object.fromEntries(new FormData(f));
  limpiarMensajesAlta();

  let item;
  try {
    item = construirItem(tipo, campos, { nombre: config.nombre, fecha: hoy() });
    // Comprobación rápida con la copia local, antes de ir a GitHub.
    comprobarDuplicados(almacen.items(tipo), item, { forzar });
  } catch (e) {
    if (e instanceof ParecidoError) mostrarParecidos(e.parecidos);
    else mostrarErrorAlta(e.message);
    return;
  }

  if (!navigator.onLine) {
    mostrarErrorAlta('Sin conexión: no se puede guardar ahora. Lo escrito se mantiene.');
    return;
  }

  const boton = $('#alta-guardar');
  boton.disabled = true;
  boton.textContent = 'Guardando…';
  try {
    // Segunda comprobación contra la versión más reciente del fichero, dentro del ciclo de reintento.
    const resultado = await cliente.actualizar(
      `${tipo}.json`,
      (datos) => {
        comprobarDuplicados(datos.items, item, { forzar });
        return { ...datos, items: [...datos.items, item] };
      },
      `Alta: ${item.titulo} (por ${config.nombre})`,
    );
    almacen.fijar(tipo, resultado.datos);
    $('#dlg-alta').close();
    render();
    aviso(`«${item.titulo}» añadido.`);
  } catch (e) {
    if (e instanceof ParecidoError) mostrarParecidos(e.parecidos);
    else mostrarErrorAlta(e.message);
    // Otra persona pudo añadir algo: refrescamos la copia local sin molestar.
    if (e instanceof DuplicadoError || e instanceof ParecidoError) recargar();
  } finally {
    boton.disabled = false;
    boton.textContent = 'Guardar';
  }
}

// ---------- Arranque

function iniciar() {
  pintarPestanas();
  $('#alta-tipo').replaceChildren(...TIPOS.map((t) => el('option', { value: t.clave }, t.singular)));

  $('#buscar').addEventListener('input', (e) => {
    terminos = terminosDe(e.target.value);
    render();
  });
  $('#btn-recargar').addEventListener('click', recargar);
  $('#btn-ajustes').addEventListener('click', abrirAjustes);
  $('#btn-alta').addEventListener('click', abrirAlta);

  $('#form-ajustes').addEventListener('submit', guardarAjustes);
  $('#ajustes-cancelar').addEventListener('click', () => $('#dlg-ajustes').close());
  // Sin configuración no se puede cerrar el diálogo de ajustes.
  $('#dlg-ajustes').addEventListener('cancel', (e) => {
    if (!cliente) e.preventDefault();
  });

  const f = formAlta();
  f.tipo.addEventListener('change', ajustarFormularioAlta);
  f.subtipo.addEventListener('change', ajustarFormularioAlta);
  f.addEventListener('input', (e) => {
    if (e.target.name !== 'tipo') $('#alta-parecidos').hidden = true;
  });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    guardarAlta(false);
  });
  $('#alta-forzar').addEventListener('click', () => guardarAlta(true));
  $('#alta-cancelar').addEventListener('click', () => $('#dlg-alta').close());

  // Cerrar la ficha pulsando fuera.
  $('#dlg-detalle').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });

  window.addEventListener('online', recargar);
  window.addEventListener('offline', () => mostrarEstado('Sin conexión. Puedes consultar, pero no añadir.'));

  render();
  if (cliente) recargar();
  else abrirAjustes();
}

iniciar();
