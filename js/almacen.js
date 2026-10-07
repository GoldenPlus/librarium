// Colección en memoria, con copia en localStorage para abrir sin esperar ni conexión.

import { TIPOS } from './modelo.js';

const CLAVE = 'librarium.cache';
export const FICHEROS = [...TIPOS.map((t) => t.clave), 'sagas'];
/** Claves de Google Books y TMDB para todos; el administrador las edita a mano en el repo de datos. */
export const CLAVES = 'claves.json';

const soloClaves = (datos) => ({ google: String(datos?.google ?? ''), tmdb: String(datos?.tmdb ?? '') });

export function crearAlmacen(almacenamiento = globalThis.localStorage) {
  let estado = { colecciones: {}, claves: {}, fecha: null };
  try {
    const copia = JSON.parse(almacenamiento?.getItem(CLAVE));
    if (copia?.colecciones) estado = { claves: {}, ...copia };
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
    get claves() {
      return estado.claves;
    },
    items(clave) {
      return estado.colecciones[clave]?.items ?? [];
    },
    /** Descarga los ficheros y las claves; solo sustituye la copia si todo ha ido bien. */
    async recargar(cliente) {
      await cliente.comprobarRepo();
      const [claves, ...leidos] = await Promise.all([
        cliente.leer(CLAVES, { lista: false }),
        ...FICHEROS.map((f) => cliente.leer(`${f}.json`)),
      ]);
      const colecciones = Object.fromEntries(FICHEROS.map((f, i) => [f, leidos[i].datos]));
      estado = { colecciones, claves: soloClaves(claves.datos), fecha: new Date().toISOString() };
      persistir();
    },
    fijar(clave, datos) {
      estado.colecciones[clave] = datos;
      persistir();
    },
  };
}
