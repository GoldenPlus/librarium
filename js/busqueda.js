// Búsqueda local sin tildes ni mayúsculas en título, autor y ubicación.

import { normalizar } from './texto.js';

export function terminosDe(consulta) {
  return normalizar(consulta).split(' ').filter(Boolean);
}

function textoBuscable(item) {
  return normalizar(
    [item.titulo, item.autor, item.ubicacion, ...(item.temporadas ?? []).map((t) => t.ubicacion)].join(' '),
  );
}

/** Todos los términos deben aparecer en el título, el autor o la ubicación. */
export function coincide(item, terminos) {
  if (!terminos.length) return true;
  const texto = textoBuscable(item);
  return terminos.every((t) => texto.includes(t));
}
