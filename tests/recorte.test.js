import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectarLibro, homografia, aplicarHomografia, enderezar, tamanoSalida, areaCuadrilatero } from '../js/recorte.js';

/** Imagen sintética: fondo de mesa con algo de ruido y un «libro» dentro del cuadrilátero dado. */
function foto(ancho, alto, esquinas, { fondo = [150, 110, 70], libro = [30, 60, 160], ruido = 12 } = {}) {
  const rgba = new Uint8ClampedArray(ancho * alto * 4);
  const dentro = (x, y) => {
    // Punto dentro de un cuadrilátero convexo: mismo lado de las 4 aristas.
    let signo = 0;
    for (let i = 0; i < 4; i++) {
      const a = esquinas[i];
      const b = esquinas[(i + 1) % 4];
      const c = Math.sign((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x));
      if (c && signo && c !== signo) return false;
      if (c) signo = c;
    }
    return true;
  };
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2 ** 31) / 2 ** 31 - 0.5) * 2 * ruido;
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const color = dentro(x + 0.5, y + 0.5) ? libro : fondo;
      const i = (y * ancho + x) * 4;
      for (let c = 0; c < 3; c++) rgba[i + c] = color[c] + azar();
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

const cerca = (a, b, tolerancia) => Math.hypot(a.x - b.x, a.y - b.y) <= tolerancia;

test('detecta un libro recto sobre la mesa', () => {
  const esquinas = [{ x: 50, y: 40 }, { x: 150, y: 40 }, { x: 150, y: 190 }, { x: 50, y: 190 }];
  const r = detectarLibro(foto(200, 240, esquinas), 200, 240);
  assert.ok(r, 'lo encuentra');
  r.forEach((p, i) => assert.ok(cerca(p, esquinas[i], 4), `esquina ${i}: ${JSON.stringify(p)}`));
});

test('detecta un libro algo girado y en perspectiva', () => {
  const esquinas = [{ x: 60, y: 30 }, { x: 160, y: 45 }, { x: 150, y: 200 }, { x: 40, y: 185 }];
  const r = detectarLibro(foto(200, 240, esquinas, { libro: [230, 225, 210] }), 200, 240);
  assert.ok(r, 'lo encuentra');
  r.forEach((p, i) => assert.ok(cerca(p, esquinas[i], 5), `esquina ${i}: ${JSON.stringify(p)}`));
});

test('sin libro claro devuelve null', () => {
  assert.equal(detectarLibro(foto(120, 160, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]), 120, 160), null, 'solo mesa');
  const lleno = [{ x: -5, y: -5 }, { x: 125, y: -5 }, { x: 125, y: 165 }, { x: -5, y: 165 }];
  assert.equal(detectarLibro(foto(120, 160, lleno), 120, 160), null, 'el libro llena la foto');
});

test('la homografía lleva cada esquina a su sitio', () => {
  const de = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 150 }, { x: 0, y: 150 }];
  const a = [{ x: 60, y: 30 }, { x: 160, y: 45 }, { x: 150, y: 200 }, { x: 40, y: 185 }];
  const h = homografia(de, a);
  de.forEach((p, i) => assert.ok(cerca(aplicarHomografia(h, p.x, p.y), a[i], 1e-6)));
});

test('enderezar saca solo el libro, sin la mesa', () => {
  const esquinas = [{ x: 60, y: 30 }, { x: 160, y: 45 }, { x: 150, y: 200 }, { x: 40, y: 185 }];
  const rgba = foto(200, 240, esquinas, { ruido: 0 });
  const { ancho, alto } = tamanoSalida(esquinas);
  assert.ok(alto > ancho, 'sale vertical, como un libro');
  const salida = enderezar(rgba, 200, 240, esquinas, ancho, alto);
  // Lejos de los bordes (que mezclan algo de mesa), todo es del color del libro.
  for (let y = 3; y < alto - 3; y += 7) {
    for (let x = 3; x < ancho - 3; x += 7) {
      const i = (y * ancho + x) * 4;
      assert.deepEqual([salida[i], salida[i + 1], salida[i + 2]], [30, 60, 160], `píxel ${x},${y}`);
    }
  }
});

test('área y tamaño de salida limitado', () => {
  const rect = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1500 }, { x: 0, y: 1500 }];
  assert.equal(areaCuadrilatero(rect), 1_500_000);
  assert.deepEqual(tamanoSalida(rect, 600), { ancho: 400, alto: 600 });
});
