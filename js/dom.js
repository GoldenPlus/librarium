// Ayudantes de interfaz compartidos.

export const $ = (selector, raiz = document) => raiz.querySelector(selector);

export function el(etiqueta, props = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(props)) {
    if (valor == null || valor === false) continue;
    if (clave === 'class') nodo.className = valor;
    else if (clave.startsWith('on')) nodo.addEventListener(clave.slice(2), valor);
    else nodo.setAttribute(clave, valor === true ? '' : valor);
  }
  nodo.append(...hijos.flat().filter((h) => h != null && h !== false && h !== ''));
  return nodo;
}

let temporizadorAviso;
export function aviso(texto) {
  const nodo = $('#aviso');
  nodo.textContent = texto;
  nodo.classList.add('visible');
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => nodo.classList.remove('visible'), 3000);
}

export function fechaLegible(iso) {
  return iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '';
}
