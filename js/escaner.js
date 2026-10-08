// Escáner de códigos de barras con la cámara trasera (ZXing, cargado solo al usarlo). Pensado para Android.

import { isbnDeCodigo } from './isbn.js';

const URL_ZXING = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/umd/zxing-browser.min.js';
const INTEGRIDAD = 'sha384-HRtzk9lZgkbSgvUyQrnfC/GxiXZgwaNyD7hC9wcXlsBpDhkS80ISl73juef2FRuf';

let carga = null;
function cargarZXing() {
  carga ??= new Promise((resolver, rechazar) => {
    const script = document.createElement('script');
    script.src = URL_ZXING;
    script.integrity = INTEGRIDAD;
    script.crossOrigin = 'anonymous';
    script.onload = () => resolver(globalThis.ZXingBrowser);
    script.onerror = () => {
      carga = null;
      script.remove();
      rechazar(new Error('No se pudo cargar el lector de códigos. ¿Hay conexión?'));
    };
    document.head.append(script);
  });
  return carga;
}

function mensajeCamara(error) {
  switch (error?.name) {
    case 'NotAllowedError':
      return 'No hay permiso para usar la cámara. Actívalo en los ajustes del navegador o teclea el ISBN.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No se encuentra ninguna cámara.';
    case 'NotReadableError':
      return 'La cámara está ocupada por otra app.';
    default:
      return 'No se pudo abrir la cámara. Teclea el ISBN a mano.';
  }
}

const errorDeCamara = (e) => {
  throw new Error(mensajeCamara(e));
};

const pistaDe = (video) => video.srcObject?.getVideoTracks?.()[0];

/** Rango de zoom de la cámara, o null si no lo admite. */
function rangoZoom(video) {
  const zoom = pistaDe(video)?.getCapabilities?.().zoom;
  return zoom?.max > zoom?.min ? zoom : null;
}

/** Zoom x2 real de la cámara (Chrome en Android), respecto al zoom con el que arrancó. Devuelve false si no se pudo. */
async function zoomCamara(video, activar) {
  const zoom = rangoZoom(video);
  if (!zoom) return false;
  const pista = pistaDe(video);
  video.dataset.zoomNormal ??= String(pista.getSettings().zoom ?? zoom.min);
  const normal = Number(video.dataset.zoomNormal);
  return pista.applyConstraints({ advanced: [{ zoom: activar ? Math.min(normal * 2, zoom.max) : normal }] }).then(() => true, () => false);
}

/**
 * Zoom x2 solo dentro del visor: el de la cámara si lo tiene; si no, se amplía la imagen del vídeo
 * (el lector sigue analizando el fotograma completo, así que el código se lee igual).
 */
async function aplicarZoom(video, activar) {
  const camara = await zoomCamara(video, activar);
  video.classList.toggle('ampliado', activar && !camara);
}

const CAMARA = { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } };

// Claves de DecodeHintType de ZXing, que el paquete para navegador no exporta.
const PISTA_FORMATOS = 2;
const PISTA_ESFORZARSE = 3;
// Errores de ZXing que solo significan «no hay código legible en este fotograma».
const FALLOS_NORMALES = new Set(['NotFoundException', 'ChecksumException', 'FormatException']);

/**
 * Cada intento analiza el fotograma de una forma distinta, por turnos. Con más brillo y contraste las barras
 * engordadas por la tinta se afinan y se leen mucho mejor; la variante sin filtro queda para los códigos claros o apagados.
 */
const VARIANTES = [
  { escala: 1, filtro: 'brightness(1.25) contrast(1.4)' },
  { escala: 0.75, filtro: 'brightness(1.25) contrast(1.4)' },
  { escala: 1, filtro: 'none' },
];

/**
 * Busca códigos con ZXing cada 100 ms en una copia del fotograma: solo EAN-13 y revisando todas sus líneas.
 * Devuelve la función que lo para. `alFallar(error)` avisa si ZXing falla de verdad.
 * Con «esforzarse», ZXing también prueba la imagen girada, pero girar falla en el navegador
 * («Could not create a Canvas element»); por eso se desactiva el giro.
 */
function leerConZXing(ZX, video, alLeer, alFallar) {
  ZX.HTMLCanvasElementLuminanceSource.prototype.isRotateSupported = () => false;
  const lector = new ZX.BrowserMultiFormatOneDReader(new Map([[PISTA_FORMATOS, [ZX.BarcodeFormat.EAN_13]], [PISTA_ESFORZARSE, true]]));
  const lienzo = document.createElement('canvas');
  const contexto = lienzo.getContext('2d', { willReadFrequently: true });
  let activo = true;
  let intento = 0;
  let temporizador;
  const paso = () => {
    if (!activo) return;
    if (video.readyState >= 2 && video.videoWidth) {
      const { escala, filtro } = VARIANTES[intento++ % VARIANTES.length];
      const ancho = Math.round(video.videoWidth * escala);
      const alto = Math.round(video.videoHeight * escala);
      if (lienzo.width !== ancho) lienzo.width = ancho;
      if (lienzo.height !== alto) lienzo.height = alto;
      contexto.filter = filtro;
      contexto.drawImage(video, 0, 0, ancho, alto);
      try {
        alLeer(lector.decodeFromCanvas(lienzo).getText());
      } catch (e) {
        if (!FALLOS_NORMALES.has(e?.getKind?.())) return alFallar(e);
      }
    }
    temporizador = setTimeout(paso, 100);
  };
  paso();
  return () => {
    activo = false;
    clearTimeout(temporizador);
  };
}

/**
 * Empieza a leer códigos en `video`. `resultado` se resuelve con el ISBN-13 leído,
 * o con null si se llama a `detener` antes. `alIgnorar(codigo)` avisa de códigos que no son ISBN.
 * `lista` se resuelve cuando la cámara ya muestra imagen; `zoom(true | false)` lo pone en x2 o normal.
 */
export function escanearIsbn(video, { alIgnorar } = {}) {
  let terminado = false;
  let flujo = null;
  let parar = () => {};
  let resolverResultado = () => {};
  let rechazarResultado = () => {};
  let avisarCamara = () => {};
  const camaraLista = new Promise((resolver) => (avisarCamara = resolver));
  delete video.dataset.zoomNormal;
  video.classList.remove('ampliado');

  const apagar = () => {
    parar();
    flujo?.getTracks().forEach((pista) => pista.stop());
    video.srcObject = null;
  };
  const terminar = (valor) => {
    if (terminado) return;
    terminado = true;
    apagar();
    resolverResultado(valor);
  };
  const fallar = (e) => {
    if (terminado) return;
    terminado = true;
    apagar();
    rechazarResultado(e);
  };
  const alLeer = (texto) => {
    if (terminado) return;
    const isbn = isbnDeCodigo(texto);
    if (isbn) terminar(isbn);
    else alIgnorar?.(texto);
  };

  const resultado = new Promise((resolver, rechazar) => {
    resolverResultado = resolver;
    rechazarResultado = rechazar;
    if (!navigator.mediaDevices?.getUserMedia) {
      rechazar(new Error('Este navegador no permite usar la cámara aquí. Teclea el ISBN a mano.'));
      return;
    }
    (async () => {
      const ZX = await cargarZXing();
      const nuevo = await navigator.mediaDevices.getUserMedia(CAMARA).catch(errorDeCamara);
      if (terminado) return nuevo.getTracks().forEach((pista) => pista.stop());
      flujo = nuevo;
      video.srcObject = flujo;
      await video.play().catch(errorDeCamara);
      parar = leerConZXing(ZX, video, alLeer, (error) =>
        fallar(new Error(`El lector de códigos se ha detenido (${error.message || error.name}). Cierra y vuelve a abrir la cámara, o teclea el ISBN.`)),
      );
      if (terminado) return apagar();
      avisarCamara();
    })().catch(fallar);
  });

  return {
    resultado,
    detener: () => terminar(null),
    lista: camaraLista,
    zoom: (activar) => camaraLista.then(() => aplicarZoom(video, activar)),
  };
}
