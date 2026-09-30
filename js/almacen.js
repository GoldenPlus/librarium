// Colección en memoria, con copia en localStorage para abrir sin esperar ni conexión.

import { TIPOS } from './modelo.js';

const CLAVE = 'librarium.cache';
export const FICHEROS = [...TIPOS.map((t) => t.clave), 'sagas'];

export function crearAlmacen(almacenamiento = globalThis.localStorage) {
  let estado = { colecciones: {}, fecha: null };
  try {
    const copia = JSON.parse(almacenamiento?.getItem(CLAVE));
    if (copia?.colecciones) estado = copia;
  } catch {
    // Sin copia local: se empieza vacío.
  }

  function persistir() {
    try {
      almacenamiento?.setItem(CLAVE, JSON.stringify(estado));
    } catch {
      // Si no cabe o no se puede guardar, la app sigue funcionando con conexión.
    }
  }

  return {
    get fecha() {
      return estado.fecha;
    },
    items(clave) {
      return estado.colecciones[clave]?.items ?? [];
    },
    /** Descarga los seis ficheros; solo sustituye la copia si todo ha ido bien. */
    async recargar(cliente) {
      await cliente.comprobarRepo();
      const leidos = await Promise.all(FICHEROS.map((f) => cliente.leer(`${f}.json`)));
      const colecciones = Object.fromEntries(FICHEROS.map((f, i) => [f, leidos[i].datos]));
      estado = { colecciones, fecha: new Date().toISOString() };
      persistir();
    },
    fijar(clave, datos) {
      estado.colecciones[clave] = datos;
      persistir();
    },
  };
}
