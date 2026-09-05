// Smoke test para GET /api/media-file — la única puerta de entrada para
// reproducir audio/fotos/video. La intención es que se suban con
// access:'private' a Vercel Blob (cualquiera con el link exacto podía
// abrirlos sin sesión si son públicos) — hoy están TEMPORALMENTE vueltos a
// 'public' porque el store de Blob conectado no soporta 'private' todavía
// (ver BACKLOG.md). Esta ruta sirve para los dos casos por diseño (con
// respaldo a fetch() directo si get({access:'private'}) no encuentra el
// archivo), así que estos tests siguen siendo válidos para cuando se
// vuelva a activar 'private'.
//
// Cubre: requiere sesión, rechaza rutas mal formadas o con "..", el dueño
// puede ver su propio archivo, una cuenta sin relación NO puede ver el
// archivo de otra (403 — el corazón de este arreglo), una cuenta
// colaboradora (fija o por "colaborar con otra historia") SÍ puede ver el
// archivo de la bitácora a la que pertenece, y el respaldo para archivos
// viejos que todavía están marcados como públicos en Blob.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
// BLOB_READ_WRITE_TOKEN se lee una sola vez al cargar server.js (arma
// BLOB_STORE_ID/BLOB_HOST_EXACTO como constantes de arranque, ver el
// comentario ahí) — si la máquina donde corre este test tiene un token
// real en su .env (para "npm run dev"), pinearía el host exacto a ESE
// store real en vez del host de prueba de este archivo, y el respaldo de
// "archivo legado" de más abajo se rechazaría por error. Lo dejamos vacío
// (no "delete": dotenv no pisa una variable que YA está presente, aunque
// esté vacía) para que este test sea determinista sin importar en qué
// máquina corra (el pineo del host exacto en sí se cubre aparte en
// test/blob-host-exacto.smoke.js, con un token de prueba controlado).
process.env.BLOB_READ_WRITE_TOKEN = '';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const PASSWORD_HASH = bcrypt.hashSync('miclave123', 4);

// A: dueña con un audio guardado. B: cuenta sin ninguna relación con A.
// C: cuenta colaboradora FIJA de A (owner_user_id=1, como quien se registró
// con el código de familia de A). D: cuenta con bitácora propia que además
// se sumó a colaborar con la historia de A (tabla collaborations).
const users = {
  1: { id: 1, username: 'usuarioa', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null },
  2: { id: 2, username: 'usuariob', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null },
  3: { id: 3, username: 'colabfija', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: 1 },
  4: { id: 4, username: 'colabsuma', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null },
};
// D colabora con la historia de A.
const collaborationsRows = [{ collaborator_user_id: 4, owner_user_id: 1 }];

function fakeSql(strings, ...values) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = Object.values(users).find((x) => x.username === values[0]);
    return Promise.resolve(u ? [{ id: u.id, username: u.username, password_hash: u.password_hash, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ owner_user_id: u.owner_user_id, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT 1 FROM collaborations')) {
    const [collaboratorId, ownerId] = values;
    const hit = collaborationsRows.some((c) => c.collaborator_user_id === collaboratorId && c.owner_user_id === ownerId);
    return Promise.resolve(hit ? [{ '?column?': 1 }] : []);
  }
  return Promise.resolve([]);
}
fakeSql.transaction = (queries) => Promise.all(queries);

// Un solo archivo "en Blob": lo que /api/save-audio hubiera guardado para A.
const AUDIO_PATHNAME = 'audio/1/sesion1/user-0-abc123.webm';
const AUDIO_CONTENIDO = Buffer.from('contenido-de-audio-de-A');
// Un archivo "viejo", subido antes de este arreglo — get() no lo encuentra
// (nunca fue privado) pero SÍ es una URL pública real que todavía sirve.
const LEGACY_URL = 'https://fake.public.blob.vercel-storage.com/audio/1/viejo/user-0-legacy.webm';
const LEGACY_CONTENIDO = Buffer.from('contenido-legado-publico');

function streamDesdeBuffer(buf) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buf));
      controller.close();
    },
  });
}

require.cache[require.resolve('@neondatabase/serverless')] = {
  id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true,
  exports: { neon: () => fakeSql },
};
// Recorta AUDIO_CONTENIDO según un header Range tipo "bytes=A-B", igual que
// haría el store real — usado para probar que /api/media-file relaya
// 206/Content-Range cuando el reproductor (Safari/iOS, en particular) lo pide.
function recortarPorRange(buf, rangeHeader) {
  if (!rangeHeader) return { slice: buf, range: null };
  const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
  if (!m) return { slice: buf, range: null };
  const total = buf.length;
  let start = m[1] ? parseInt(m[1], 10) : 0;
  let end = m[2] ? parseInt(m[2], 10) : total - 1;
  if (Number.isNaN(start)) start = 0;
  if (Number.isNaN(end) || end >= total) end = total - 1;
  return { slice: buf.slice(start, end + 1), range: `bytes ${start}-${end}/${total}` };
}

require.cache[require.resolve('@vercel/blob')] = {
  id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true,
  exports: {
    put: async () => ({ url: 'https://fake.public.blob.vercel-storage.com/x' }),
    del: async () => {},
    get: async (pathname, opts) => {
      if (pathname !== AUDIO_PATHNAME) return null; // ni el legado ni nada más "existe" para get()
      const rangeHeader = opts && opts.headers && opts.headers.Range;
      const { slice, range } = recortarPorRange(AUDIO_CONTENIDO, rangeHeader);
      const headers = new Headers();
      if (range) {
        headers.set('content-range', range);
        headers.set('content-length', String(slice.length));
      }
      return {
        statusCode: 200,
        stream: streamDesdeBuffer(slice),
        headers,
        blob: { contentType: 'audio/webm', size: slice.length },
      };
    },
  },
};
require.cache[require.resolve('@anthropic-ai/sdk')] = {
  id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true,
  exports: class FakeAnthropic { constructor() {} },
};

// fetch de respaldo para el archivo "legado" — server.js lo usa cuando
// get() no encuentra nada y el valor guardado es una URL http(s) completa.
const fetchOriginal = global.fetch;
global.fetch = async (url, opts) => {
  if (url === LEGACY_URL) {
    const rangeHeader = opts && opts.headers && (opts.headers.Range || opts.headers.range);
    const { slice, range } = recortarPorRange(LEGACY_CONTENIDO, rangeHeader);
    const headersMap = {
      'content-type': 'audio/webm',
      ...(range ? { 'content-range': range, 'content-length': String(slice.length) } : {}),
    };
    return {
      ok: true,
      status: range ? 206 : 200,
      headers: { get: (k) => headersMap[k.toLowerCase()] || null },
      body: streamDesdeBuffer(slice),
    };
  }
  return fetchOriginal(url, opts);
};

const app = require(serverPath);

function request(server, opts, cookie) {
  return new Promise((resolve, reject) => {
    const headers = Object.assign({}, opts.headers || {});
    if (cookie) headers['Cookie'] = cookie;
    const host = `127.0.0.1:${server.address().port}`;
    if (!headers['Origin']) headers['Origin'] = `http://${host}`;
    const r = http.request({ hostname: '127.0.0.1', port: server.address().port, path: opts.path, method: opts.method || 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bodyBuffer: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.end();
  });
}

async function login(server, username) {
  const data = JSON.stringify({ username, password: 'miclave123' });
  const resp = await new Promise((resolve, reject) => {
    const host = `127.0.0.1:${server.address().port}`;
    const r = http.request(
      { hostname: '127.0.0.1', port: server.address().port, path: '/api/login', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Origin: `http://${host}` } },
      (res) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() })); }
    );
    r.on('error', reject);
    r.write(data);
    r.end();
  });
  if (resp.status !== 200) throw new Error(`login falló para ${username}: ${resp.status} ${resp.body}`);
  return resp.headers['set-cookie'][0].split(';')[0];
}

let pasaron = 0;
let fallaron = 0;
function check(nombre, cond) {
  if (cond) { pasaron++; console.log('OK  -', nombre); }
  else { fallaron++; console.log('FAIL -', nombre); }
}

(async () => {
  const server = app.listen(0);
  try {
    const cookieA = await login(server, 'usuarioa');
    const cookieB = await login(server, 'usuariob');
    const cookieColabFija = await login(server, 'colabfija');
    const cookieColabSuma = await login(server, 'colabsuma');

    const u = (valor) => '/api/media-file?u=' + encodeURIComponent(valor);

    // --- Sin sesión ---
    const sinCookie = await request(server, { path: u(AUDIO_PATHNAME) });
    check('sin cookie -> 401', sinCookie.status === 401);

    // --- Rutas inválidas ---
    const conPuntos = await request(server, { path: u('audio/1/../../etc/passwd') }, cookieA);
    check('ruta con ".." -> 400', conPuntos.status === 400);

    const prefijoRaro = await request(server, { path: u('otracosa/1/archivo.webm') }, cookieA);
    check('ruta que no arranca con audio/ ni media/ -> 400', prefijoRaro.status === 400);

    const sinOwner = await request(server, { path: u('audio/noesunnumero/x.webm') }, cookieA);
    check('ruta sin ownerId numérico -> 400', sinOwner.status === 400);

    // --- Dueño ve su propio archivo ---
    const comoDuena = await request(server, { path: u(AUDIO_PATHNAME) }, cookieA);
    check('la dueña puede ver su propio archivo -> 200', comoDuena.status === 200);
    check('el contenido es el real', comoDuena.bodyBuffer.equals(AUDIO_CONTENIDO));
    check('Content-Type audio/webm', comoDuena.headers['content-type'] === 'audio/webm');
    check('trae Accept-Ranges: bytes aun sin pedir Range (lo necesita Safari/iOS)', comoDuena.headers['accept-ranges'] === 'bytes');

    // --- Pedido con header Range (lo que hace el <audio> de Safari/iOS antes
    //     de reproducir) — sin esto, iOS falla con "Error" al reproducir. ---
    const conRange = await request(server, { path: u(AUDIO_PATHNAME), headers: { Range: 'bytes=0-3' } }, cookieA);
    check('con Range -> 206 Partial Content', conRange.status === 206);
    check('Content-Range correcto', conRange.headers['content-range'] === `bytes 0-3/${AUDIO_CONTENIDO.length}`);
    check('el cuerpo trae solo los 4 bytes pedidos', conRange.bodyBuffer.length === 4 && conRange.bodyBuffer.equals(AUDIO_CONTENIDO.slice(0, 4)));

    // --- Cuenta sin relación: NO puede verlo (el arreglo central) ---
    const comoAjena = await request(server, { path: u(AUDIO_PATHNAME) }, cookieB);
    check('una cuenta sin relación con A NO puede ver su archivo -> 403', comoAjena.status === 403);

    // --- Colaboradora fija de A: sí puede ---
    const comoColabFija = await request(server, { path: u(AUDIO_PATHNAME) }, cookieColabFija);
    check('la colaboradora fija de A sí puede ver su archivo -> 200', comoColabFija.status === 200);

    // --- Cuenta que se sumó a colaborar con A (tabla collaborations): sí puede ---
    const comoColabSuma = await request(server, { path: u(AUDIO_PATHNAME) }, cookieColabSuma);
    check('la cuenta que colabora con A (collaborations) sí puede ver su archivo -> 200', comoColabSuma.status === 200);

    // --- Archivo "legado" (todavía público en Blob, get() no lo encuentra) ---
    const legado = await request(server, { path: u(LEGACY_URL) }, cookieA);
    check('archivo legado (get() vacío, URL pública real) se sirve por respaldo -> 200', legado.status === 200);
    check('el contenido del legado es el real', legado.bodyBuffer.equals(LEGACY_CONTENIDO));
    check('el respaldo también trae Accept-Ranges: bytes', legado.headers['accept-ranges'] === 'bytes');

    // --- El respaldo también debe soportar Range (mismo motivo: iOS Safari) ---
    const legadoConRange = await request(server, { path: u(LEGACY_URL), headers: { Range: 'bytes=2-5' } }, cookieA);
    check('respaldo con Range -> 206 Partial Content', legadoConRange.status === 206);
    check('respaldo con Range: Content-Range correcto', legadoConRange.headers['content-range'] === `bytes 2-5/${LEGACY_CONTENIDO.length}`);
    check('respaldo con Range: el cuerpo trae solo los 4 bytes pedidos', legadoConRange.bodyBuffer.equals(LEGACY_CONTENIDO.slice(2, 6)));

    // --- Un archivo legado de OTRA cuenta sigue sin poder verlo B ---
    const legadoAjeno = await request(server, { path: u(LEGACY_URL) }, cookieB);
    check('el respaldo de legado también respeta el aislamiento -> 403', legadoAjeno.status === 403);
  } finally {
    server.close();
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
