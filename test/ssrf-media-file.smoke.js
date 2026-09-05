// Smoke test para el arreglo de SSRF en GET /api/media-file (P1 de seguridad
// 2026-09-05). Antes de este arreglo, cuando get({access:'private'}) no
// encontraba el archivo, el respaldo hacía `fetch(valorGuardado)` con la URL
// COMPLETA que mandó el cliente, sin verificar el host — y la autorización
// solo compara el ownerId que se saca del PATH de esa misma URL contra la
// cuenta que pide (ver estaAutorizadoParaVerArchivo: `profileUserId ===
// ownerId`). Entonces cualquier usuario autenticado podía mandar
// `?u=https://loquesea.com/audio/<su-propio-id>/x` — pasaba la autorización
// trivialmente (es "su" archivo, según el path) y el server igual hacía el
// fetch hacia loquesea.com y relayaba la respuesta: SSRF + proxy abierto
// autenticado.
//
// El arreglo: el fetch de respaldo ahora usa urlHttpValida(valorGuardado),
// que exige https Y que el host sea nuestro propio storage de Vercel Blob
// (esHostDeNuestroBlob), y además pasa redirect:'manual' tratando cualquier
// 3xx como fallo (para que un host de Blob no pueda redirigir a otro lado).
//
// Cubre: URL con host ajeno -> 404 (no se sigue el fetch), URL http (no
// https) hacia un host que de otra forma sería válido -> 404, URL con host
// de Blob que redirige a otro lado -> 404 (no se sigue la redirección), y
// que el caso legítimo (URL pública real de nuestro propio Blob, sin
// redirección) sigue funcionando igual que antes.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
// Igual que en test/media-file.smoke.js: si la máquina tiene un
// BLOB_READ_WRITE_TOKEN real en su .env, server.js pinearía el host EXACTO
// a ESE store real (ver BLOB_HOST_EXACTO ahí) en vez del sufijo genérico
// que usa el host de prueba de este archivo (fake.public.blob.vercel-
// storage.com), y el caso "legítimo" de abajo se rechazaría por error.
process.env.BLOB_READ_WRITE_TOKEN = '';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const PASSWORD_HASH = bcrypt.hashSync('miclave123', 4);

// B es la atacante: cuenta autenticada normal, sin ninguna relación con
// otras historias, que intenta usar su PROPIO id en el path de una URL
// ajena para pasar la autorización.
const users = {
  2: { id: 2, username: 'usuariob', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null },
};

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
  if (text.includes('SELECT 1 FROM collaborations')) return Promise.resolve([]);
  return Promise.resolve([]);
}
fakeSql.transaction = (queries) => Promise.all(queries);

require.cache[require.resolve('@neondatabase/serverless')] = {
  id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true,
  exports: { neon: () => fakeSql },
};
require.cache[require.resolve('@vercel/blob')] = {
  id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true,
  exports: {
    put: async () => ({ url: 'https://fake.public.blob.vercel-storage.com/x' }),
    del: async () => {},
    get: async () => null, // nada "existe" en el Blob privado: siempre cae al respaldo
  },
};
require.cache[require.resolve('@anthropic-ai/sdk')] = {
  id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true,
  exports: class FakeAnthropic { constructor() {} },
};

function streamDesdeBuffer(buf) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buf));
      controller.close();
    },
  });
}

// URLs usadas en los casos:
// - un "host del atacante" (no es blob.vercel-storage.com) con el id propio
//   de B en el path — el ataque clásico.
const ATACANTE_URL = 'https://atacante-cualquiera.com/audio/2/x/file.webm';
// - un archivo interno que el atacante quiere leer via SSRF, para confirmar
//   que si el fetch se llegara a hacer, el contenido sería visible (así el
//   test realmente prueba que NO se filtra, no solo que responde 404).
const CONTENIDO_INTERNO_SECRETO = Buffer.from('secreto-interno-que-no-deberia-salir');
// - mismo path/ownerId pero por http (no https) hacia un host que de otra
//   forma matchea nuestro sufijo de Blob.
const HTTP_URL = 'http://fake.public.blob.vercel-storage.com/audio/2/x/file.webm';
// - una URL de Blob legítima que redirige hacia el host del atacante.
const REDIRECT_URL = 'https://fake.public.blob.vercel-storage.com/audio/2/redir/file.webm';
// - el caso legítimo: URL pública real de nuestro propio Blob, sin redirección.
const LEGIT_URL = 'https://fake.public.blob.vercel-storage.com/audio/2/legit/file.webm';
const LEGIT_CONTENIDO = Buffer.from('contenido-legitimo-de-blob');

let fetchATacanteLlamado = false;
const fetchOriginal = global.fetch;
global.fetch = async (url, opts) => {
  if (url === ATACANTE_URL || (typeof url === 'string' && url.startsWith('https://atacante-cualquiera.com'))) {
    fetchATacanteLlamado = true;
    return {
      ok: true, status: 200,
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/plain' : null) },
      body: streamDesdeBuffer(CONTENIDO_INTERNO_SECRETO),
    };
  }
  if (url === HTTP_URL) {
    // Si esto se llegara a fetchear, sería un fallo de la validación https-only.
    return {
      ok: true, status: 200,
      headers: { get: () => null },
      body: streamDesdeBuffer(CONTENIDO_INTERNO_SECRETO),
    };
  }
  if (url === REDIRECT_URL) {
    // Igual que fetch({redirect:'manual'}) real contra un 302: status 3xx,
    // ok:false, sin seguir la redirección (verificado empíricamente contra
    // Node/undici — no produce type:'opaqueredirect' como en el navegador).
    return { ok: false, status: 302, type: 'basic', headers: { get: (k) => (k.toLowerCase() === 'location' ? 'https://atacante-cualquiera.com/robado' : null) }, body: null };
  }
  if (url === LEGIT_URL) {
    return {
      ok: true, status: 200,
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'audio/webm' : null) },
      body: streamDesdeBuffer(LEGIT_CONTENIDO),
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
    const cookieB = await login(server, 'usuariob');
    const u = (valor) => '/api/media-file?u=' + encodeURIComponent(valor);

    // --- El ataque clásico: host ajeno, id propio en el path ---
    const ataque = await request(server, { path: u(ATACANTE_URL) }, cookieB);
    check('SSRF: URL con host ajeno -> 404 (no 200 con contenido ajeno)', ataque.status === 404);
    check('SSRF: nunca se llegó a hacer el fetch hacia el host del atacante', !fetchATacanteLlamado);
    check('SSRF: el cuerpo de la respuesta no filtra el contenido "interno"', !ataque.bodyBuffer.includes(CONTENIDO_INTERNO_SECRETO));

    // --- http (no https) hacia un host que de otra forma sería válido ---
    const porHttp = await request(server, { path: u(HTTP_URL) }, cookieB);
    check('SSRF: URL http (no https) hacia host de Blob -> 404 (https-only)', porHttp.status === 404);

    // --- URL de Blob legítima que redirige hacia otro lado ---
    const redirigida = await request(server, { path: u(REDIRECT_URL) }, cookieB);
    check('SSRF: URL de Blob que redirige (3xx) -> 404 (no se sigue la redirección)', redirigida.status === 404);

    // --- Caso legítimo: sigue funcionando ---
    const legitimo = await request(server, { path: u(LEGIT_URL) }, cookieB);
    check('caso legítimo (URL pública real de nuestro Blob, sin redirección) -> 200', legitimo.status === 200);
    check('caso legítimo: el contenido es el real', legitimo.bodyBuffer.equals(LEGIT_CONTENIDO));
  } finally {
    server.close();
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
