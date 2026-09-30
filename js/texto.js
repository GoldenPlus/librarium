// Utilidades de texto: comparación sin tildes, mayúsculas ni artículos.

const ARTICULO_INICIAL = /^(el|la|los|las|lo|un|una|unos|unas|the|a|an|l)\s+/;

/** Minúsculas, sin tildes y con cualquier signo convertido en un espacio. */
export function normalizar(texto = '') {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Como normalizar, quitando además el artículo inicial («El», «The»…). */
export function sinArticulo(texto) {
  const n = normalizar(texto);
  return n.replace(ARTICULO_INICIAL, '') || n;
}

/** Quita espacios sobrantes al principio, al final y entre palabras. */
export function limpiar(texto = '') {
  return String(texto ?? '').trim().replace(/\s+/g, ' ');
}

/** Distancia de Levenshtein. */
export function distancia(a, b) {
  if (a === b) return 0;
  let previa = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const actual = [i];
    for (let j = 1; j <= b.length; j++) {
      const coste = a[i - 1] === b[j - 1] ? 0 : 1;
      actual[j] = Math.min(previa[j] + 1, actual[j - 1] + 1, previa[j - 1] + coste);
    }
    previa = actual;
  }
  return previa[b.length];
}

/** Parecido entre 0 (nada) y 1 (idénticos). */
export function similitud(a, b) {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - distancia(a, b) / max;
}

export function compararTitulos(a, b) {
  return String(a).localeCompare(String(b), 'es', { sensitivity: 'base', numeric: true });
}
