// Lectura y escritura de los JSON del repo de datos con la Contents API de GitHub.
// Toda escritura envía el sha leído; si otra persona guardó antes, se relee y se reintenta.

const API = 'https://api.github.com';
export const VERSION_DATOS = 1;
const vacio = () => ({ version: VERSION_DATOS, items: [] });

export class GitHubError extends Error {
  constructor(mensaje, estado) {
    super(mensaje);
    this.name = 'GitHubError';
    this.estado = estado;
  }
}

export class ConflictoError extends Error {
  constructor() {
    super('Otra persona ha guardado a la vez varias veces seguidas. Pulsa Guardar de nuevo; no se ha perdido nada.');
    this.name = 'ConflictoError';
  }
}

export function codificarBase64(texto) {
  const bytes = new TextEncoder().encode(texto);
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}

export function decodificarBase64(b64) {
  const binario = atob(String(b64).replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binario, (c) => c.charCodeAt(0)));
}

function mensajeDeEstado(estado, que) {
  switch (estado) {
    case 401:
      return 'El token no es válido, ha caducado o se ha revocado. Revísalo en Ajustes.';
    case 403:
      return 'GitHub ha rechazado la petición: el token no tiene permiso suficiente o se ha superado el límite de peticiones.';
    case 404:
      return `No se encuentra ${que}. Revisa el nombre del repositorio y que el token tenga acceso a él.`;
    default:
      return `Error de GitHub (${estado}) con ${que}.`;
  }
}

function parsear(texto, fichero) {
  if (!texto.trim()) return vacio();
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch {
    throw new GitHubError(`${fichero} no es un JSON válido. Corrígelo en el repo de datos.`, 0);
  }
  if (!Array.isArray(datos?.items)) throw new GitHubError(`${fichero} no tiene la lista "items".`, 0);
  if (datos.version > VERSION_DATOS) throw new GitHubError('Los datos usan una versión más nueva de la app. Recarga la página.', 0);
  return datos;
}

export function crearCliente({ token, repo, fetch: fetchImpl = (...a) => globalThis.fetch(...a) }) {
  const base = `${API}/repos/${repo}`;

  async function peticion(ruta, opciones = {}) {
    try {
      return await fetchImpl(`${base}${ruta}`, {
        cache: 'no-store',
        ...opciones,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...opciones.headers,
        },
      });
    } catch {
      throw new GitHubError('No se puede conectar con GitHub. ¿Hay conexión a internet?', 0);
    }
  }

  /** Comprueba que el token es válido y da acceso al repo. */
  async function comprobarRepo() {
    const res = await peticion('');
    if (!res.ok) throw new GitHubError(mensajeDeEstado(res.status, `el repositorio ${repo}`), res.status);
  }

  /** Devuelve { datos, sha }. Un fichero que aún no existe se trata como vacío (sha null). */
  async function leer(fichero) {
    const res = await peticion(`/contents/${fichero}`);
    if (res.status === 404) return { datos: vacio(), sha: null };
    if (!res.ok) throw new GitHubError(mensajeDeEstado(res.status, fichero), res.status);
    const meta = await res.json();
    let texto;
    if (meta.encoding === 'none') {
      // Ficheros de más de 1 MB: la Contents API no incluye el contenido.
      const crudo = await peticion(`/git/blobs/${meta.sha}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
      if (!crudo.ok) throw new GitHubError(mensajeDeEstado(crudo.status, fichero), crudo.status);
      texto = await crudo.text();
    } else {
      texto = decodificarBase64(meta.content ?? '');
    }
    return { datos: parsear(texto, fichero), sha: meta.sha };
  }

  async function escribir(fichero, datos, sha, mensaje) {
    const cuerpo = { message: mensaje, content: codificarBase64(JSON.stringify(datos, null, 2) + '\n') };
    if (sha) cuerpo.sha = sha;
    const res = await peticion(`/contents/${fichero}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    // 409: el sha no coincide. 422 sin sha: otra persona creó el fichero antes.
    if (res.status === 409 || (res.status === 422 && !sha)) throw new ConflictoError();
    if (!res.ok) throw new GitHubError(mensajeDeEstado(res.status, fichero), res.status);
    return (await res.json()).content.sha;
  }

  /**
   * Lee la versión más reciente, aplica `mutar(datos)` (que puede lanzar, por ejemplo por duplicado)
   * y guarda. Si `mutar` devuelve null no hay nada que guardar. Ante un conflicto de sha vuelve
   * a empezar, hasta `intentos` veces.
   */
  async function actualizar(fichero, mutar, mensaje, intentos = 3) {
    for (let i = 0; i < intentos; i++) {
      const { datos, sha } = await leer(fichero);
      const nuevos = mutar(datos);
      if (nuevos === null) return { datos, sha };
      try {
        return { datos: nuevos, sha: await escribir(fichero, nuevos, sha, mensaje) };
      } catch (e) {
        if (!(e instanceof ConflictoError)) throw e;
      }
    }
    throw new ConflictoError();
  }

  return { comprobarRepo, leer, actualizar };
}
