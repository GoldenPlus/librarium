// Estado compartido de la app: configuración, cliente de GitHub y colección.

import { leerConfig, configCompleta } from './config.js';
import { crearCliente } from './github.js';
import { crearAlmacen } from './almacen.js';

const config = leerConfig();

export const app = {
  almacen: crearAlmacen(),
  config,
  cliente: configCompleta(config) ? crearCliente(config) : null,
};

/** Clave de Google Books o TMDB, de claves.json del repo de datos (solo la cambia el administrador, a mano). */
export function claveDe(servicio) {
  return app.almacen.claves[servicio] || '';
}

/** Sagas por id; si un título apunta a una saga que no está, se deduce un nombre de su id. */
export function sagaDe(ref) {
  if (!ref?.id) return null;
  const saga = app.almacen.items('sagas').find((s) => s.id === ref.id);
  if (saga) return saga;
  const [, tipo, slug = ''] = ref.id.split(':');
  return { id: ref.id, tipo, nombre: slug.replace(/-/g, ' '), total: null };
}
