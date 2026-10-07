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

const pistaDe = (video) => video.srcObject?.getVideoTracks?.()[0];

/** Rango de zoom de la cámara, o null si no lo admite. */
function rangoZoom(video) {
  const zoom = pistaDe(video)?.getCapabilities?.().zoom;
  return zoom?.max > zoom?.min ? zoom : null;
}

/** Zoom x2 real de la cámara (Chrome en Android), respecto al zoom con el que arrancó. */
async function aplicarZoom(video, activar) {
  const zoom = rangoZoom(video);
  if (!zoom) return;
  const pista = pistaDe(video);
  video.dataset.zoomNormal ??= String(pista.getSettings().zoom ?? zoom.min);
  const normal = Number(video.dataset.zoomNormal);
  await pista.applyConstraints({ advanced: [{ zoom: activar ? Math.min(normal * 2, zoom.max) : normal }] }).catch(() => {});
}

/**
 * Empieza a leer códigos en `video`. `resultado` se resuelve con el ISBN-13 leído,
 * o con null si se llama a `detener` antes. `alIgnorar(codigo)` avisa de códigos que no son ISBN.
 * `admiteZoom` se resuelve con true si la cámara tiene zoom; `zoom(true | false)` lo pone en x2 o normal.
 */
export function escanearIsbn(video, { alIgnorar } = {}) {
  let controles = null;
  let terminar = () => {};
  let avisarCamara = () => {};
  const camaraLista = new Promise((resolver) => (avisarCamara = resolver));
  delete video.dataset.zoomNormal;
  const resultado = new Promise((resolver, rechazar) => {
    let terminado = false;
    terminar = (valor) => {
      if (terminado) return;
      terminado = true;
      controles?.stop();
      resolver(valor);
    };
    if (!navigator.mediaDevices?.getUserMedia) {
      rechazar(new Error('Este navegador no permite usar la cámara aquí. Teclea el ISBN a mano.'));
      return;
    }
    cargarZXing()
      .then((ZX) => {
        if (terminado) return null;
        const lector = new ZX.BrowserMultiFormatOneDReader();
        return lector
          .decodeFromConstraints({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } }, video, (lectura) => {
            if (!lectura || terminado) return;
            const isbn = isbnDeCodigo(lectura.getText());
            if (isbn) terminar(isbn);
            else alIgnorar?.(lectura.getText());
          })
          .then((c) => {
            controles = c;
            if (terminado) c.stop();
            else avisarCamara();
          }, (e) => {
            throw new Error(mensajeCamara(e));
          });
      })
      .catch((e) => {
        terminado = true;
        rechazar(e);
      });
  });
  return {
    resultado,
    detener: () => terminar(null),
    admiteZoom: camaraLista.then(() => Boolean(rangoZoom(video))),
    zoom: (activar) => camaraLista.then(() => aplicarZoom(video, activar)),
  };
}
