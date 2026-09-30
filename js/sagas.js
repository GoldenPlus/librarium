// Sagas: títulos del mismo tipo agrupados en orden (sagas.json).

import { limpiar, normalizar } from './texto.js';
import { ValidacionError } from './modelo.js';

/** El id lleva el tipo y el nombre sin tildes ni espacios, así la misma saga no se crea dos veces. */
export function idSaga(tipo, nombre) {
  return `saga:${tipo}:${normalizar(nombre).replace(/ /g, '-')}`;
}

function entero(texto, etiqueta, max) {
  if (!limpiar(texto)) return null;
  const n = Number(texto);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new ValidacionError(`${etiqueta} no es válido.`);
  return n;
}

/** Lee los campos de saga del formulario: null si no hay saga, o { id, nombre, orden, total }. */
export function leerCamposSaga(tipo, campos) {
  const nombre = limpiar(campos.saga);
  const orden = entero(campos.saga_orden, 'El número dentro de la saga', 999);
  const total = entero(campos.saga_total, 'El total de la saga', 999);
  if (!nombre) {
    if (orden || total) throw new ValidacionError('Indica el nombre de la saga o deja vacío su número.');
    return null;
  }
  if (!normalizar(nombre)) throw new ValidacionError('El nombre de la saga no es válido.');
  if (!orden) throw new ValidacionError('Indica qué número ocupa en la saga.');
  if (total && orden > total) throw new ValidacionError(`El número ${orden} es mayor que el total de la saga (${total}).`);
  return { id: idSaga(tipo, nombre), nombre, orden, total };
}

/**
 * Devuelve los datos de sagas.json con la saga creada (o con su total actualizado),
 * o null si no hace falta cambiar nada.
 */
export function asegurarSaga(datos, tipo, { id, nombre, total }) {
  const existente = datos.items.find((s) => s.id === id);
  if (!existente) return { ...datos, items: [...datos.items, { id, nombre, tipo, total: total ?? null }] };
  if (total && existente.total !== total) {
    return { ...datos, items: datos.items.map((s) => (s.id === id ? { ...s, total } : s)) };
  }
  return null;
}

/** «2 de 3» y los números que faltan (hasta el total, o huecos hasta el mayor que tenéis). */
export function estadoSaga(saga, miembros) {
  const ordenes = [...new Set(miembros.map((m) => m.saga?.orden).filter(Number.isInteger))].sort((a, b) => a - b);
  const hasta = saga?.total ?? ordenes.at(-1) ?? 0;
  const faltan = [];
  for (let n = 1; n <= hasta; n++) if (!ordenes.includes(n)) faltan.push(n);
  const texto = saga?.total ? `${ordenes.length} de ${saga.total}` : `${miembros.length} ${miembros.length === 1 ? 'título' : 'títulos'}`;
  return { ordenes, faltan, texto };
}
