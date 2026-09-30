// Configuración de cada dispositivo, guardada en localStorage.

const CLAVE = 'librarium.config';
const VACIA = { nombre: '', repo: '', token: '', tmdb: '' };

export function leerConfig() {
  try {
    return { ...VACIA, ...JSON.parse(localStorage.getItem(CLAVE)) };
  } catch {
    return { ...VACIA };
  }
}

export function guardarConfig(config) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(config));
  } catch {
    throw new Error('Este navegador no deja guardar la configuración (¿modo privado?).');
  }
}

export function configCompleta(config) {
  return Boolean(config.nombre && config.repo && config.token);
}

/** Acepta «usuario/repo» o la URL del repo; devuelve «usuario/repo» o null. */
export function normalizarRepo(texto) {
  const limpio = String(texto ?? '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  return /^[\w.-]+\/[\w.-]+$/.test(limpio) ? limpio : null;
}
