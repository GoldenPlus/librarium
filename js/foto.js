// Foto de portada: cámara del móvil, detección del libro y recorte con 4 esquinas que se arrastran.

import { detectarLibro, recuadroPorDefecto, tamanoSalida, enderezar } from './recorte.js';
import { $ } from './dom.js';

/** La foto se reduce a este lado mayor para recortarla (de sobra para una miniatura). */
const LADO_TRABAJO = 1400;
/** Y a este para buscar el libro, que así es rápido. */
const LADO_DETECCION = 240;
/** Lado mayor de la portada guardada. */
const LADO_PORTADA = 640;
const SVG = 'http://www.w3.org/2000/svg';

/** Abre la cámara (o la galería) y devuelve el archivo elegido, o null si se cancela. */
function elegirArchivo() {
  return new Promise((resolver) => {
    const input = $('#foto-portada');
    input.value = '';
    input.onchange = () => resolver(input.files[0] ?? null);
    input.oncancel = () => resolver(null);
    input.click();
  });
}

function lienzo(ancho, alto) {
  const c = document.createElement('canvas');
  c.width = ancho;
  c.height = alto;
  return c;
}

/** Copia reducida de una imagen o lienzo con el lado mayor como mucho `maximo`. */
function reducir(origen, ancho, alto, maximo) {
  const escala = Math.min(1, maximo / Math.max(ancho, alto));
  const c = lienzo(Math.max(1, Math.round(ancho * escala)), Math.max(1, Math.round(alto * escala)));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(origen, 0, 0, c.width, c.height);
  return c;
}

/** Carga la foto ya girada según su orientación (el navegador aplica la de la cámara). */
async function cargarFoto(archivo) {
  const url = URL.createObjectURL(archivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return reducir(img, img.naturalWidth, img.naturalHeight, LADO_TRABAJO);
  } catch {
    throw new Error('No se ha podido abrir la foto. Prueba a sacarla de nuevo.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Esquinas propuestas: las del libro si se distingue; si no, un recuadro centrado. */
function proponerEsquinas(foto) {
  const pequena = reducir(foto, foto.width, foto.height, LADO_DETECCION);
  const { data } = pequena.getContext('2d').getImageData(0, 0, pequena.width, pequena.height);
  const encontradas = detectarLibro(data, pequena.width, pequena.height);
  if (!encontradas) return { esquinas: recuadroPorDefecto(foto.width, foto.height), detectado: false };
  const k = foto.width / pequena.width;
  return { esquinas: encontradas.map((p) => ({ x: p.x * k, y: p.y * k })), detectado: true };
}

function nodoSvg(etiqueta, atributos) {
  const nodo = document.createElementNS(SVG, etiqueta);
  for (const [clave, valor] of Object.entries(atributos)) nodo.setAttribute(clave, valor);
  return nodo;
}

/** Dibuja el marco sobre la foto y deja arrastrar sus esquinas (modifica `esquinas`). */
function prepararMarco(svg, ancho, alto, esquinas) {
  svg.setAttribute('viewBox', `0 0 ${ancho} ${alto}`);
  const radio = Math.max(ancho, alto) * 0.022;
  const sombra = nodoSvg('path', { class: 'sombra' });
  const borde = nodoSvg('polygon', { class: 'borde' });
  const puntos = esquinas.map(() => nodoSvg('circle', { class: 'esquina', r: radio }));
  // Zona de agarre más grande que el punto, para el dedo.
  const agarres = esquinas.map(() => nodoSvg('circle', { class: 'agarre', r: radio * 3 }));
  svg.replaceChildren(sombra, borde, ...puntos, ...agarres);

  const dibujar = () => {
    const contorno = esquinas.map((p) => `${p.x},${p.y}`).join(' ');
    sombra.setAttribute('d', `M0 0H${ancho}V${alto}H0Z M${contorno.replaceAll(' ', ' L')}Z`);
    borde.setAttribute('points', contorno);
    esquinas.forEach((p, i) => {
      for (const c of [puntos[i], agarres[i]]) {
        c.setAttribute('cx', p.x);
        c.setAttribute('cy', p.y);
      }
    });
  };

  agarres.forEach((agarre, i) => {
    let activo = false;
    agarre.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      agarre.setPointerCapture(e.pointerId);
      activo = true;
    });
    agarre.addEventListener('pointermove', (e) => {
      if (!activo) return;
      const caja = svg.getBoundingClientRect();
      esquinas[i] = {
        x: Math.min(Math.max(((e.clientX - caja.left) / caja.width) * ancho, 0), ancho),
        y: Math.min(Math.max(((e.clientY - caja.top) / caja.height) * alto, 0), alto),
      };
      dibujar();
    });
    const soltar = () => (activo = false);
    agarre.addEventListener('pointerup', soltar);
    agarre.addEventListener('pointercancel', soltar);
  });
  dibujar();
}

/** Endereza la zona marcada y la devuelve como JPEG. */
function recortar(foto, esquinas) {
  const { ancho, alto } = tamanoSalida(esquinas, LADO_PORTADA);
  const origen = foto.getContext('2d').getImageData(0, 0, foto.width, foto.height);
  const salida = lienzo(ancho, alto);
  salida.getContext('2d').putImageData(new ImageData(enderezar(origen.data, foto.width, foto.height, esquinas, ancho, alto), ancho, alto), 0, 0);
  return new Promise((resolver, rechazar) =>
    salida.toBlob((blob) => (blob ? resolver(blob) : rechazar(new Error('No se ha podido guardar la foto.'))), 'image/jpeg', 0.82),
  );
}

/** Muestra el recorte y espera: 'usar', 'repetir' o null si se cierra. */
function esperarDecision() {
  const dlg = $('#dlg-recorte');
  return new Promise((resolver) => {
    const terminar = (decision) => {
      $('#recorte-usar').onclick = $('#recorte-repetir').onclick = $('#recorte-cerrar').onclick = dlg.oncancel = null;
      dlg.close();
      resolver(decision);
    };
    $('#recorte-usar').onclick = () => terminar('usar');
    $('#recorte-repetir').onclick = () => terminar('repetir');
    $('#recorte-cerrar').onclick = () => terminar(null);
    dlg.oncancel = (e) => {
      e.preventDefault();
      terminar(null);
    };
  });
}

/**
 * Saca una foto de la portada, propone el recorte y deja ajustarlo.
 * Devuelve el JPEG recortado y enderezado, o null si se cancela.
 */
export async function sacarFotoPortada() {
  for (;;) {
    const archivo = await elegirArchivo();
    if (!archivo) return null;
    const foto = await cargarFoto(archivo);
    const { esquinas, detectado } = proponerEsquinas(foto);

    const visor = $('#recorte-lienzo');
    visor.width = foto.width;
    visor.height = foto.height;
    visor.getContext('2d').drawImage(foto, 0, 0);
    prepararMarco($('#recorte-marco'), foto.width, foto.height, esquinas);
    $('#recorte-estado').textContent = detectado
      ? 'Revisa que las esquinas coincidan con las del libro; si no, arrástralas.'
      : 'No distingo bien el libro del fondo: arrastra las esquinas a las del libro.';
    $('#dlg-recorte').showModal();

    const decision = await esperarDecision();
    if (decision === 'usar') return recortar(foto, esquinas);
    if (decision !== 'repetir') return null;
  }
}
