// Recorte de la foto de una portada: detectar el libro, enderezar la perspectiva.
// Funciones puras sobre píxeles RGBA (como los de ImageData), sin depender del navegador.

/** Esquinas en orden: arriba-izquierda, arriba-derecha, abajo-derecha, abajo-izquierda. */

/** Recuadro centrado por defecto, cuando no se detecta el libro. */
export function recuadroPorDefecto(ancho, alto, margen = 0.12) {
  const mx = ancho * margen;
  const my = alto * margen;
  return [
    { x: mx, y: my },
    { x: ancho - mx, y: my },
    { x: ancho - mx, y: alto - my },
    { x: mx, y: alto - my },
  ];
}

const mediana = (valores) => {
  const ordenados = Float64Array.from(valores).sort();
  return ordenados[ordenados.length >> 1];
};

/** Umbral de Otsu sobre un histograma: separa «fondo» de «libro» maximizando la varianza entre clases. */
function otsu(histograma, total) {
  let suma = 0;
  for (let i = 0; i < histograma.length; i++) suma += i * histograma[i];
  let sumaFondo = 0;
  let pesoFondo = 0;
  let mejor = 0;
  let umbral = 0;
  for (let i = 0; i < histograma.length; i++) {
    pesoFondo += histograma[i];
    if (!pesoFondo) continue;
    const pesoFrente = total - pesoFondo;
    if (!pesoFrente) break;
    sumaFondo += i * histograma[i];
    const mediaFondo = sumaFondo / pesoFondo;
    const mediaFrente = (suma - sumaFondo) / pesoFrente;
    const varianza = pesoFondo * pesoFrente * (mediaFondo - mediaFrente) ** 2;
    if (varianza > mejor) {
      mejor = varianza;
      umbral = i;
    }
  }
  return umbral;
}

/** Erosión (`minimo`) o dilatación de una máscara binaria con un cuadrado de 3×3. */
function morfologia(mascara, ancho, alto, minimo) {
  const salida = new Uint8Array(mascara.length);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      let valor = minimo ? 1 : 0;
      for (let dy = -1; dy <= 1 && valor === (minimo ? 1 : 0); dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          const v = xx < 0 || yy < 0 || xx >= ancho || yy >= alto ? 0 : mascara[yy * ancho + xx];
          if (minimo ? !v : v) {
            valor = minimo ? 0 : 1;
            break;
          }
        }
      }
      salida[y * ancho + x] = valor;
    }
  }
  return salida;
}

/** Índices de la mancha conectada más grande de la máscara. */
function manchaMayor(mascara, ancho, alto) {
  const etiqueta = new Int32Array(mascara.length);
  const pila = new Int32Array(mascara.length);
  let mejor = [];
  let actual = 0;
  for (let inicio = 0; inicio < mascara.length; inicio++) {
    if (!mascara[inicio] || etiqueta[inicio]) continue;
    actual++;
    const pixeles = [];
    let tope = 0;
    pila[tope++] = inicio;
    etiqueta[inicio] = actual;
    while (tope) {
      const i = pila[--tope];
      pixeles.push(i);
      const x = i % ancho;
      const vecinos = [x > 0 ? i - 1 : -1, x < ancho - 1 ? i + 1 : -1, i - ancho, i + ancho];
      for (const v of vecinos) {
        if (v < 0 || v >= mascara.length || !mascara[v] || etiqueta[v]) continue;
        etiqueta[v] = actual;
        pila[tope++] = v;
      }
    }
    if (pixeles.length > mejor.length) mejor = pixeles;
  }
  return mejor;
}

/**
 * Busca el libro en la foto: toma como fondo el color de los bordes, separa lo que se distingue de él
 * y se queda con la mancha más grande. Devuelve sus 4 esquinas o null si no está claro
 * (fondo muy cargado, libro que llena la foto o que apenas se ve).
 */
export function detectarLibro(rgba, ancho, alto) {
  const total = ancho * alto;
  const banda = Math.max(2, Math.round(Math.min(ancho, alto) * 0.04));
  const borde = { r: [], g: [], b: [] };
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      if (x >= banda && y >= banda && x < ancho - banda && y < alto - banda) continue;
      const i = (y * ancho + x) * 4;
      borde.r.push(rgba[i]);
      borde.g.push(rgba[i + 1]);
      borde.b.push(rgba[i + 2]);
    }
  }
  const fondo = { r: mediana(borde.r), g: mediana(borde.g), b: mediana(borde.b) };

  // Distancia de cada píxel al color del fondo, en 256 niveles.
  const distancia = new Uint8Array(total);
  const histograma = new Float64Array(256);
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    const d = Math.abs(rgba[i] - fondo.r) + Math.abs(rgba[i + 1] - fondo.g) + Math.abs(rgba[i + 2] - fondo.b);
    distancia[p] = Math.min(255, d / 3);
    histograma[distancia[p]]++;
  }
  // Si casi todo se parece al fondo, el umbral de Otsu solo separaría ruido.
  const umbral = Math.max(otsu(histograma, total), 18);

  let mascara = new Uint8Array(total);
  for (let p = 0; p < total; p++) mascara[p] = distancia[p] > umbral ? 1 : 0;
  // Apertura (quita motas sueltas) y cierre (tapa huecos del dibujo de la portada).
  mascara = morfologia(morfologia(mascara, ancho, alto, true), ancho, alto, false);
  mascara = morfologia(morfologia(mascara, ancho, alto, false), ancho, alto, true);

  const mancha = manchaMayor(mascara, ancho, alto);
  const proporcion = mancha.length / total;
  if (proporcion < 0.08 || proporcion > 0.92) return null;

  // Esquinas: los puntos extremos de x+y y de x−y.
  let tl, tr, br, bl;
  let minSuma = Infinity, maxSuma = -Infinity, minResta = Infinity, maxResta = -Infinity;
  for (const i of mancha) {
    const x = i % ancho;
    const y = (i - x) / ancho;
    const suma = x + y;
    const resta = x - y;
    if (suma < minSuma) { minSuma = suma; tl = { x, y }; }
    if (suma > maxSuma) { maxSuma = suma; br = { x: x + 1, y: y + 1 }; }
    if (resta > maxResta) { maxResta = resta; tr = { x: x + 1, y }; }
    if (resta < minResta) { minResta = resta; bl = { x, y: y + 1 }; }
  }
  const esquinas = [tl, tr, br, bl];
  // Si las esquinas no rodean la mayor parte de la mancha, no tiene forma de libro.
  if (areaCuadrilatero(esquinas) < mancha.length * 0.85) return null;
  return esquinas;
}

/** Área de un cuadrilátero (fórmula del zapatero). */
export function areaCuadrilatero(p) {
  let doble = 0;
  for (let i = 0; i < 4; i++) {
    const a = p[i];
    const b = p[(i + 1) % 4];
    doble += a.x * b.y - b.x * a.y;
  }
  return Math.abs(doble) / 2;
}

/** Ancho y alto de la portada enderezada, con el lado mayor como mucho `maximo` píxeles. */
export function tamanoSalida(esquinas, maximo = 640) {
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const [tl, tr, br, bl] = esquinas;
  const ancho = (d(tl, tr) + d(bl, br)) / 2;
  const alto = (d(tl, bl) + d(tr, br)) / 2;
  const escala = Math.min(1, maximo / Math.max(ancho, alto));
  return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)) };
}

/** Resuelve A·x = b por eliminación de Gauss con pivote parcial. */
function resolver(A, b) {
  const n = b.length;
  const M = A.map((fila, i) => [...fila, b[i]]);
  for (let c = 0; c < n; c++) {
    let pivote = c;
    for (let f = c + 1; f < n; f++) if (Math.abs(M[f][c]) > Math.abs(M[pivote][c])) pivote = f;
    [M[c], M[pivote]] = [M[pivote], M[c]];
    for (let f = c + 1; f < n; f++) {
      const k = M[f][c] / M[c][c];
      for (let j = c; j <= n; j++) M[f][j] -= k * M[c][j];
    }
  }
  const x = new Array(n);
  for (let f = n - 1; f >= 0; f--) {
    let s = M[f][n];
    for (let j = f + 1; j < n; j++) s -= M[f][j] * x[j];
    x[f] = s / M[f][f];
  }
  return x;
}

/** Homografía que lleva los 4 puntos `de` a los 4 puntos `a`. Devuelve los 9 coeficientes (h33 = 1). */
export function homografia(de, a) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = de[i];
    const { x: u, y: v } = a[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  return [...resolver(A, b), 1];
}

export function aplicarHomografia(h, x, y) {
  const w = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

/**
 * Endereza la zona de `esquinas` de la imagen origen a un rectángulo de `ancho`×`alto`.
 * Devuelve los píxeles RGBA de la salida (muestreo bilineal).
 */
export function enderezar(rgba, anchoOrigen, altoOrigen, esquinas, ancho, alto) {
  const destino = [{ x: 0, y: 0 }, { x: ancho, y: 0 }, { x: ancho, y: alto }, { x: 0, y: alto }];
  const h = homografia(destino, esquinas);
  const salida = new Uint8ClampedArray(ancho * alto * 4);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const p = aplicarHomografia(h, x + 0.5, y + 0.5);
      const sx = Math.min(Math.max(p.x - 0.5, 0), anchoOrigen - 1);
      const sy = Math.min(Math.max(p.y - 0.5, 0), altoOrigen - 1);
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, anchoOrigen - 1);
      const y1 = Math.min(y0 + 1, altoOrigen - 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const o = (y * ancho + x) * 4;
      for (let c = 0; c < 4; c++) {
        const v00 = rgba[(y0 * anchoOrigen + x0) * 4 + c];
        const v10 = rgba[(y0 * anchoOrigen + x1) * 4 + c];
        const v01 = rgba[(y1 * anchoOrigen + x0) * 4 + c];
        const v11 = rgba[(y1 * anchoOrigen + x1) * 4 + c];
        salida[o + c] = (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
      }
    }
  }
  return salida;
}
