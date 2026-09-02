// Smoke test de regresión — corre en CI (ver .github/workflows/ci.yml) y
// también se puede correr a mano con `npm test`.
//
// No pega contra una base de datos real: mockea @neondatabase/serverless,
// @vercel/blob y @anthropic-ai/sdk para poder levantar el server.js real y
// pegarle pedidos HTTP de verdad, sin depender de credenciales ni de que
// haya una base Postgres disponible. La idea no es cubrir cada endpoint —
// es agarrar rápido una regresión obvia (el server no levanta, una ruta
// rompe, un header de seguridad desapareció) antes de mergear.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';

const path = require('path');
const http = require('http');

const serverPath = path.resolve(__dirname, '..', 'server.js');

function fakeSql(strings) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('SELECT owner_user_id, token_version FROM users')) return Promise.resolve([{ owner_user_id: null, token_version: 0 }]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  return Promise.resolve([]);
}
require.cache[require.resolve('@neondatabase/serverless')] = {
  id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true,
  exports: { neon: () => fakeSql },
};
require.cache[require.resolve('@vercel/blob')] = {
  id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true,
  exports: { put: async () => ({ url: 'https://fake.public.blob.vercel-storage.com/x' }), del: async () => {} },
};
require.cache[require.resolve('@anthropic-ai/sdk')] = {
  id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true,
  exports: class FakeAnthropic { constructor() {} },
};

const app = require(serverPath);

function request(server, opts) {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : null;
    const headers = Object.assign({}, opts.headers || {});
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    const r = http.request({ hostname: '127.0.0.1', port: server.address().port, path: opts.path, method: opts.method || 'GET', headers }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  let ok = true;
  const check = (cond, label) => {
    console.log((cond ? 'OK  ' : 'FAIL'), label);
    if (!cond) ok = false;
  };

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;

  // Páginas estáticas sirven.
  for (const p of ['/index.html', '/app.html', '/arbol.html', '/capitulos.html', '/colaborar.html']) {
    const r = await request(server, { path: p });
    check(r.status === 200 && r.body.includes('<html'), `${p} sirve 200 con HTML`);
  }

  // Cabeceras de seguridad presentes en toda respuesta.
  const home = await request(server, { path: '/index.html' });
  check(home.headers['x-frame-options'] === 'DENY', 'X-Frame-Options: DENY presente');
  check(home.headers['x-content-type-options'] === 'nosniff', 'X-Content-Type-Options: nosniff presente');
  check(!!home.headers['content-security-policy-report-only'], 'CSP Report-Only presente');
  check(!home.headers['content-security-policy'], 'CSP enforce todavía apagada (a propósito)');

  // Auth: rutas protegidas rechazan sin sesión.
  const me = await request(server, { path: '/api/me' });
  check(me.status === 401, '/api/me sin cookie -> 401');

  // /api/ no se cachea.
  check(me.headers['cache-control'] === 'no-store', '/api/me responde Cache-Control: no-store');

  // Login con credenciales inválidas -> 401 (no 500, no filtra si el user existe o no de forma distinguible más allá del mensaje genérico).
  const badLogin = await request(server, { path: '/api/login', method: 'POST', body: { username: 'nadie', password: 'loquesea' }, headers: { Origin: `http://127.0.0.1:${port}` } });
  check(badLogin.status === 401, '/api/login con credenciales inválidas -> 401');

  // CSRF: POST mutante sin Origin/Referer -> 403.
  const noOrigin = await request(server, { path: '/api/logout', method: 'POST' });
  check(noOrigin.status === 403, 'POST mutante sin Origin/Referer -> 403 (CSRF)');

  // CSRF: POST mutante con Origin propio -> pasa la capa CSRF (no 403).
  const sameOrigin = await request(server, { path: '/api/logout', method: 'POST', headers: { Origin: `http://127.0.0.1:${port}` } });
  check(sameOrigin.status !== 403, 'POST mutante con Origin propio -> no lo bloquea el CSRF');

  server.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('ERROR EN EL SMOKE TEST:', e);
  process.exit(1);
});
