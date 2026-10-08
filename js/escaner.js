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
// Errores con los que ZXing sigue intentándolo: «no hay código en este fotograma». Cualquier otro apaga la cámara.
const FALLOS_NORMALES = new Set(['NotFoundException', 'ChecksumException', 'FormatException']);

/**
 * Lee con ZXing: solo EAN-13 y revisando todas las líneas del fotograma. Devuelve la función que lo para.
 * Con «esforzarse», ZXing también prueba la imagen girada, pero girar falla en el navegador
 * («Could not create a Canvas element») y el error apaga la cámara; por eso se desactiva el giro.
 * Si aun así ZXing se detiene por un error, `alFallar(error)` lo avisa en vez de dejar el visor en negro.
 */
async function leerConZXing(ZX, stream, video, alLeer, alFallar) {
  ZX.HTMLCanvasElementLuminanceSource.prototype.isRotateSupported = () => false;
  const pistas = new Map([[PISTA_FORMATOS, [ZX.BarcodeFormat.EAN_13]], [PISTA_ESFORZARSE, true]]);
  const lector = new ZX.BrowserMultiFormatOneDReader(pistas, { delayBetweenScanAttempts: 100 });
  const controles = await lector.decodeFromStream(stream, video, (lectura, error) => {
    if (lectura) alLeer(lectura.getText());
    else if (error && !FALLOS_NORMALES.has(error.getKind?.())) alFallar(error);
  });
  return () => controles.stop();
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
      parar = await leerConZXing(ZX, flujo, video, alLeer, (error) =>
        fallar(new Error(`El lector de códigos se ha detenido (${error.message || error.name}). Cierra y vuelve a abrir la cámara, o teclea el ISBN.`)),
      ).catch(errorDeCamara);
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
