// Smoke test del almacenamiento en Cloudflare R2 (cuando están las 5
// variables R2_*). Cubre: /api/media-file lee un archivo de R2 y lo
// sirve; si el archivo dice ser text/html se sirve como descarga
// genérica (nunca ejecutable); una URL vieja de Vercel Blob se sigue
// leyendo por el camino de Blob aunque R2 esté activo; sin sesión, 401/403.
//
// R2_* se leen al cargar server.js, así que se fijan ANTES del require.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';
process.env.R2_ACCOUNT_ID = 'cuenta123';
process.env.R2_BUCKET = 'bitacora-test';
process.env.R2_ACCESS_KEY_ID = 'ak-test';
process.env.R2_SECRET_ACCESS_KEY = 'sk-test';
process.env.R2_PUBLIC_URL = 'https://pub-abc123.r2.dev';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const PASSWORD_HASH = bcrypt.hashSync('miclave123', 4);
const users = { 1: { id: 1, username: 'duena', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null } };

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
  if (text.includes('FROM collaborations')) return Promise.resolve([]);
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);

const CONTENIDO = Buffer.from('audio-de-prueba-r2');
const fetchOriginal = global.fetch;
global.fetch = async (url, opts = {}) => {
  // aws4fetch pasa un objeto Request (no string+init).
  const esRequest = url && typeof url === 'object' && typeof url.url === 'string';
  const u = esRequest ? url.url : String(url);
  const metodo = (esRequest ? url.method : opts.method) || 'GET';
  if (u.includes('r2.cloudflarestorage.com')) {
    if (metodo === 'GET') {
      const esHtml = u.includes('/media/1/mal-');
      return new Response(esHtml ? Buffer.from('<script>x</script>') : CONTENIDO, {
        status: 200, headers: { 'Content-Type': esHtml ? 'text/html' : 'audio/webm' },
      });
    }
    return new Response('', { status: 204 });
  }
  if (u.includes('.blob.vercel-storage.com')) {
    return new Response(Buffer.from('viejo-en-blob'), { status: 200, headers: { 'Content-Type': 'audio/webm' } });
  }
  return fetchOriginal(url, opts);
};

require.cache[require.resolve('@neondatabase/serverless')] = { id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true, exports: { neon: () => fakeSql } };
require.cache[require.resolve('@vercel/blob')] = { id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true, exports: { put: async () => ({ url: 'x' }), del: async () => {}, get: async () => null, list: async () => ({ blobs: [], hasMore: false }) } };
require.cache[require.resolve('@anthropic-ai/sdk')] = { id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true, exports: class { constructor() {} } };

const app = require(serverPath);

function req(server, pth, cookie) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path: pth, method: 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.setTimeout(8000, () => { r.destroy(new Error('timeout')); });
    r.end();
  });
}
async function login(server) {
  const data = JSON.stringify({ username: 'duena', password: 'miclave123' });
  return new Promise((resolve, reject) => {
    const host = '127.0.0.1:' + server.address().port;
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/login', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Origin: 'http://' + host } }, (res) => {
      const ch = []; res.on('data', (c) => ch.push(c)); res.on('end', () => resolve(res.headers['set-cookie'][0].split(';')[0]));
    });
    r.on('error', reject); r.write(data); r.end();
  });
}

let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  const cookie = await login(server);
  const mf = (v) => '/api/media-file?u=' + encodeURIComponent(v);

  const r1 = await req(server, mf('https://pub-abc123.r2.dev/audio/aportes/1/nota-abc.webm'), cookie);
  ok(r1.status === 200, 'lee un audio de R2 -> 200');
  ok(r1.headers['content-type'] === 'audio/webm', 'reenvía el content-type audio/webm de R2');
  ok(r1.body.toString() === CONTENIDO.toString(), 'el cuerpo es el archivo de R2');
  ok(r1.headers['cache-control'] === 'private, max-age=86400', 'deja que el navegador lo cachee 1 día');

  const r2 = await req(server, mf('https://pub-abc123.r2.dev/media/1/mal-xyz.png'), cookie);
  ok(r2.status === 200, 'archivo de R2 que miente text/html -> 200');
  ok(r2.headers['content-type'] === 'application/octet-stream', '...pero se sirve como descarga genérica, no como HTML');
  ok(r2.headers['x-content-type-options'] === 'nosniff', '...con X-Content-Type-Options: nosniff');

  const r3 = await req(server, mf('https://viejo.public.blob.vercel-storage.com/audio/aportes/1/legado.webm'), cookie);
  ok(r3.status === 200, 'una URL vieja de Vercel Blob se sigue leyendo aunque R2 esté activo');
  ok(r3.body.toString() === 'viejo-en-blob', '...trae el contenido del archivo viejo');

  const r4 = await req(server, mf('https://pub-abc123.r2.dev/audio/aportes/1/x.webm'));
  ok(r4.status === 401 || r4.status === 403, 'sin sesión -> 401/403');

  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
