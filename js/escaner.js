// Escáner de códigos de barras con la cámara trasera: lector nativo de Chrome en Android o, si no hay, ZXing (cargado solo al usarlo).

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

/** Lector de códigos del propio Chrome en Android (el de Google, más fiable que ZXing), o null si no hay. */
async function detectorNativo() {
  if (!('BarcodeDetector' in globalThis)) return null;
  try {
    const formatos = await globalThis.BarcodeDetector.getSupportedFormats();
    return formatos.includes('ean_13') ? new globalThis.BarcodeDetector({ formats: ['ean_13'] }) : null;
  } catch {
    return null;
  }
}

/**
 * Busca códigos con el lector nativo cada 100 ms. Devuelve la función que lo para.
 * Analiza una copia del fotograma en un lienzo: pasarle el <video> directamente lo deja en negro en algunos Android.
 */
function leerConNativo(detector, video, alLeer) {
  let activo = true;
  const lienzo = document.createElement('canvas');
  const contexto = lienzo.getContext('2d');
  (async () => {
    while (activo) {
      if (video.readyState >= 2 && video.videoWidth) {
        if (lienzo.width !== video.videoWidth) lienzo.width = video.videoWidth;
        if (lienzo.height !== video.videoHeight) lienzo.height = video.videoHeight;
        contexto.drawImage(video, 0, 0);
        const codigos = await detector.detect(lienzo).catch(() => []);
        for (const codigo of codigos) if (activo) alLeer(codigo.rawValue);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
  return () => (activo = false);
}

/** Respaldo con ZXing: solo EAN-13 y revisando todo el fotograma. Devuelve la función que lo para. */
async function leerConZXing(ZX, stream, video, alLeer) {
  const pistas = new Map([[PISTA_FORMATOS, [ZX.BarcodeFormat.EAN_13]], [PISTA_ESFORZARSE, true]]);
  const lector = new ZX.BrowserMultiFormatOneDReader(pistas, { delayBetweenScanAttempts: 100 });
  const controles = await lector.decodeFromStream(stream, video, (lectura) => lectura && alLeer(lectura.getText()));
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
  const alLeer = (texto) => {
    if (terminado) return;
    const isbn = isbnDeCodigo(texto);
    if (isbn) terminar(isbn);
    else alIgnorar?.(texto);
  };

  const resultado = new Promise((resolver, rechazar) => {
    resolverResultado = resolver;
    if (!navigator.mediaDevices?.getUserMedia) {
      rechazar(new Error('Este navegador no permite usar la cámara aquí. Teclea el ISBN a mano.'));
      return;
    }
    (async () => {
      const detector = await detectorNativo();
      const ZX = detector ? null : await cargarZXing();
      const nuevo = await navigator.mediaDevices.getUserMedia(CAMARA).catch(errorDeCamara);
      if (terminado) return nuevo.getTracks().forEach((pista) => pista.stop());
      flujo = nuevo;
      if (detector) {
        video.srcObject = flujo;
        await video.play().catch(errorDeCamara);
        parar = leerConNativo(detector, video, alLeer);
      } else {
        parar = await leerConZXing(ZX, flujo, video, alLeer).catch(errorDeCamara);
      }
      if (terminado) return apagar();
      avisarCamara();
    })().catch((e) => {
      if (terminado) return;
      terminado = true;
      apagar();
      rechazar(e);
    });
  });

  return {
    resultado,
    detener: () => terminar(null),
    lista: camaraLista,
    zoom: (activar) => camaraLista.then(() => aplicarZoom(video, activar)),
  };
}
