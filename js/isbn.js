// Validación de ISBN y conversión de ISBN-10 a ISBN-13.

export function limpiarIsbn(texto) {
  return String(texto ?? '').toUpperCase().replace(/[^0-9X]/g, '');
}

function digitoControl13(doce) {
  let suma = 0;
  for (let i = 0; i < 12; i++) suma += Number(doce[i]) * (i % 2 ? 3 : 1);
  return (10 - (suma % 10)) % 10;
}

export function esIsbn13Valido(d) {
  return /^97[89]\d{10}$/.test(d) && digitoControl13(d) === Number(d[12]);
}

export function esIsbn10Valido(d) {
  if (!/^\d{9}[\dX]$/.test(d)) return false;
  let suma = 0;
  for (let i = 0; i < 10; i++) suma += (d[i] === 'X' ? 10 : Number(d[i])) * (10 - i);
  return suma % 11 === 0;
}

export function isbn10a13(d) {
  const base = '978' + d.slice(0, 9);
  return base + digitoControl13(base);
}

/** Devuelve el ISBN-13 sin guiones, o null si el texto no es un ISBN válido. */
export function normalizarIsbn(texto) {
  const d = limpiarIsbn(texto);
  if (d.length === 13 && esIsbn13Valido(d)) return d;
  if (d.length === 10 && esIsbn10Valido(d)) return isbn10a13(d);
  return null;
}
