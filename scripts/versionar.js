// Pone en index.html una marca de versión (hash del contenido) en el CSS y en cada módulo JS.
// Así, cuando un archivo cambia, cambia su dirección y el navegador no puede usar la copia vieja de su caché.
// Uso: npm run versionar (y el test de versiones avisa si se olvida).

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const INICIO = '<!-- versiones: generado por npm run versionar -->';
const FIN = '<!-- /versiones -->';

const marca = (ruta) => createHash('sha256').update(readFileSync(RAIZ + ruta)).digest('hex').slice(0, 10);

/** Bloque de index.html con el CSS, el mapa de módulos y el script principal, cada uno con su marca. */
export function bloqueVersiones() {
  const modulos = readdirSync(RAIZ + 'js').filter((f) => f.endsWith('.js')).sort();
  const mapa = modulos.map((f) => `      "./js/${f}": "./js/${f}?v=${marca(`js/${f}`)}"`).join(',\n');
  return [
    INICIO,
    `  <link rel="stylesheet" href="css/app.css?v=${marca('css/app.css')}">`,
    '  <script type="importmap">',
    `  { "imports": {\n${mapa}\n  } }`,
    '  </script>',
    `  <script type="module" src="js/main.js?v=${marca('js/main.js')}"></script>`,
    `  ${FIN}`,
  ].join('\n');
}

/** index.html con el bloque de versiones al día. */
export function indexVersionado() {
  const html = readFileSync(RAIZ + 'index.html', 'utf8');
  const i = html.indexOf(INICIO);
  const j = html.indexOf(FIN);
  if (i < 0 || j < 0) throw new Error('index.html no tiene el bloque de versiones');
  return html.slice(0, i) + bloqueVersiones() + html.slice(j + FIN.length);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(RAIZ + 'index.html', indexVersionado());
  console.log('index.html actualizado');
}
