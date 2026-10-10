// Portadas: las de internet se muestran tal cual; las fotos del repo de datos (privado) se descargan
// con el token y se guardan en la caché del navegador para no volver a pedirlas.

import { TIPOS } from './modelo.js';
import { app } from './estado.js';
import { el } from './dom.js';

const CACHE = 'librarium-portadas';
const PREFIJO = 'repo:';

/** Direcciones ya preparadas en esta sesión, por valor de portada. */
const enMemoria = new Map();

/** Clave de la caché del navegador para una foto del repo (tiene que ser una dirección). */
const claveCache = (ruta) => new URL(`./__portadas/${ruta}`, location.href).href;

async function abrirCache() {
  try {
    return await caches.open(CACHE);
  } catch {
    return null; // Sin Cache Storage (modo privado, http): se descarga cada vez.
  }
}

// Como mucho unas pocas descargas a la vez, para no saturar la API de GitHub con una lista larga.
let activas = 0;
const esperando = [];
async function turno(tarea) {
  if (activas >= 4) await new Promise((r) => esperando.push(r));
  activas++;
  try {
    return await tarea();
  } finally {
    activas--;
    esperando.shift()?.();
  }
}

async function descargar(ruta) {
  const cache = await abrirCache();
  const guardada = await cache?.match(claveCache(ruta));
  if (guardada) return guardada.blob();
  if (!app.cliente) throw new Error('Sin conexión con el repo de datos.');
  const blob = await turno(() => app.cliente.leerArchivo(ruta));
  await cache?.put(claveCache(ruta), new Response(blob, { headers: { 'Content-Type': 'image/jpeg' } }));
  return blob;
}

/** Dirección mostrable de una portada, o null si no se puede (sin conexión y sin copia en caché). */
export function urlPortada(valor) {
  if (!valor) return Promise.resolve(null);
  if (!valor.startsWith(PREFIJO)) return Promise.resolve(valor);
  if (!enMemoria.has(valor)) {
    const promesa = descargar(valor.slice(PREFIJO.length)).then(
      (blob) => URL.createObjectURL(blob),
      () => {
        enMemoria.delete(valor); // Que se reintente la próxima vez.
        return null;
      },
    );
    enMemoria.set(valor, promesa);
  }
  return enMemoria.get(valor);
}

/** Guarda en la caché una foto recién subida, para mostrarla sin volver a descargarla. */
export async function recordarPortada(valor, blob) {
  enMemoria.set(valor, Promise.resolve(URL.createObjectURL(blob)));
  const cache = await abrirCache();
  await cache?.put(claveCache(valor.slice(PREFIJO.length)), new Response(blob, { headers: { 'Content-Type': 'image/jpeg' } })).catch(() => {});
}

/**
 * Borra del repo una foto que ya no usa ningún título (al eliminar el título o cambiarle la foto).
 * Si falla, la foto se queda huérfana en el repo sin más: no estorba y no debe impedir lo demás.
 */
export async function borrarFotoSinUso(valor, mensaje) {
  if (!valor?.startsWith(PREFIJO) || !app.cliente) return;
  if (TIPOS.some((t) => app.almacen.items(t.clave).some((it) => it.portada === valor))) return;
  const ruta = valor.slice(PREFIJO.length);
  try {
    await app.cliente.borrarArchivo(ruta, mensaje);
    enMemoria.delete(valor);
    await (await abrirCache())?.delete(claveCache(ruta));
  } catch (e) {
    console.warn(`No se ha podido borrar ${ruta}:`, e);
  }
}

/** Imagen de portada; si es una foto del repo, se rellena cuando está lista. */
export function imagenPortada(valor, props = {}) {
  if (!valor?.startsWith(PREFIJO)) return el('img', { ...props, src: valor, alt: '', loading: 'lazy' });
  const img = el('img', { ...props, alt: '' });
  urlPortada(valor).then((url) => {
    if (url) img.src = url;
    else img.style.visibility = 'hidden';
  });
  return img;
}
