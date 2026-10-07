import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearCliente, codificarBase64, decodificarBase64, ConflictoError, GitHubError } from '../js/github.js';
import { comprobarDuplicados, DuplicadoError } from '../js/duplicados.js';

test('base64 conserva tildes y emojis', () => {
  const texto = '{"titulo":"Pedro Páramo 📚"}';
  assert.equal(decodificarBase64(codificarBase64(texto)), texto);
});

/** Repo simulado: un fichero con sha; `antesDeEscribir` permite simular a otra persona guardando. */
function githubFalso({ items = [], antesDeEscribir } = {}) {
  let version = 1;
  let datos = { version: 1, items };
  const escrituras = [];
  const responder = (estado, cuerpo) => ({ ok: estado < 300, status: estado, json: async () => cuerpo, text: async () => JSON.stringify(cuerpo) });
  const fetch = async (url, opciones = {}) => {
    if (!opciones.method) {
      return responder(200, { sha: `sha${version}`, encoding: 'base64', content: codificarBase64(JSON.stringify(datos)) });
    }
    antesDeEscribir?.({ empujar: (item) => { datos = { ...datos, items: [...datos.items, item] }; version++; } });
    const cuerpo = JSON.parse(opciones.body);
    if (cuerpo.sha !== `sha${version}`) return responder(409, { message: 'conflict' });
    datos = JSON.parse(decodificarBase64(cuerpo.content));
    version++;
    escrituras.push(cuerpo.message);
    return responder(200, { content: { sha: `sha${version}` } });
  };
  return { fetch, escrituras, get datos() { return datos; } };
}

const anadir = (item) => (d) => {
  comprobarDuplicados(d.items, item);
  return { ...d, items: [...d.items, item] };
};

test('alta sin conflicto', async () => {
  const gh = githubFalso();
  const cliente = crearCliente({ token: 't', repo: 'a/b', fetch: gh.fetch });
  const res = await cliente.actualizar('libros.json', anadir({ id: 'manual:1', titulo: 'A' }), 'Alta: A (por Marta)');
  assert.equal(res.datos.items.length, 1);
  assert.deepEqual(gh.escrituras, ['Alta: A (por Marta)']);
});

test('dos altas distintas a la vez: se reintenta y entran las dos', async () => {
  let primera = true;
  const gh = githubFalso({
    antesDeEscribir: ({ empujar }) => {
      if (primera) { primera = false; empujar({ id: 'manual:otro', titulo: 'De otra persona' }); }
    },
  });
  const cliente = crearCliente({ token: 't', repo: 'a/b', fetch: gh.fetch });
  await cliente.actualizar('libros.json', anadir({ id: 'manual:1', titulo: 'Mío' }), 'Alta');
  assert.deepEqual(gh.datos.items.map((i) => i.id), ['manual:otro', 'manual:1']);
});

test('mismo ISBN a la vez: el segundo recibe el aviso de duplicado', async () => {
  let primera = true;
  const libro = { id: 'isbn:9780306406157', titulo: 'Pedro Páramo', ubicacion: 'Estantería 2' };
  const gh = githubFalso({
    antesDeEscribir: ({ empujar }) => {
      if (primera) { primera = false; empujar(libro); }
    },
  });
  const cliente = crearCliente({ token: 't', repo: 'a/b', fetch: gh.fetch });
  await assert.rejects(cliente.actualizar('libros.json', anadir({ ...libro }), 'Alta'), DuplicadoError);
  assert.equal(gh.datos.items.length, 1);
});

test('tras 3 conflictos seguidos se rinde con ConflictoError', async () => {
  let n = 0;
  const gh = githubFalso({ antesDeEscribir: ({ empujar }) => empujar({ id: `manual:x${n++}`, titulo: `X${n}` }) });
  const cliente = crearCliente({ token: 't', repo: 'a/b', fetch: gh.fetch });
  await assert.rejects(cliente.actualizar('libros.json', anadir({ id: 'manual:1', titulo: 'Mío' }), 'Alta'), ConflictoError);
});

test('fichero inexistente se lee vacío; token erróneo da mensaje claro', async () => {
  const f404 = async () => ({ ok: false, status: 404 });
  assert.deepEqual((await crearCliente({ token: 't', repo: 'a/b', fetch: f404 }).leer('sagas.json')).datos, { version: 1, items: [] });

  const f401 = async () => ({ ok: false, status: 401 });
  await assert.rejects(crearCliente({ token: 'malo', repo: 'a/b', fetch: f401 }).comprobarRepo(), (e) => e instanceof GitHubError && /token/.test(e.message));
});

test('si mutar devuelve null no se escribe nada', async () => {
  const gh = githubFalso({ items: [{ id: 'manual:1', titulo: 'A' }] });
  const cliente = crearCliente({ token: 't', repo: 'a/b', fetch: gh.fetch });
  const res = await cliente.actualizar('libros.json', () => null, 'Nada');
  assert.equal(res.datos.items.length, 1);
  assert.deepEqual(gh.escrituras, []);
});

test('claves.json se lee sin lista "items"', async () => {
  const contenido = codificarBase64(JSON.stringify({ version: 1, google: 'g', tmdb: 't' }));
  const f = async () => ({ ok: true, status: 200, json: async () => ({ sha: 's', encoding: 'base64', content: contenido }) });
  const cliente = crearCliente({ token: 't', repo: 'a/b', fetch: f });
  assert.equal((await cliente.leer('claves.json', { lista: false })).datos.tmdb, 't');
  await assert.rejects(cliente.leer('claves.json'), /items/);
});
