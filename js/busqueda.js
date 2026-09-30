// Búsqueda local sin tildes ni mayúsculas en título, autor y ubicación.

import { normalizar } from './texto.js';

export function terminosDe(consulta) {
  return normalizar(consulta).split(' ').filter(Boolean);
}

function textoBuscable(item, extra) {
  return normalizar(
    [item.titulo, item.autor, item.ubicacion, ...(item.temporadas ?? []).map((t) => t.ubicacion), extra].join(' '),
  );
}

/** Todos los términos deben aparecer en el título, el autor, la ubicación o `extra` (el nombre de su saga). */
export function coincide(item, terminos, extra = '') {
  if (!terminos.length) return true;
  const texto = textoBuscable(item, extra);
  return terminos.every((t) => texto.includes(t));
}
