// El recorrido con focos sobre los botones se recuerda por usuario en el servidor: cada cuenta ve su lista, solo se
// aceptan las páginas que tienen recorrido, marcar dos veces no repite y una cuenta no toca la lista de otra.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const HASH = bcrypt.hashSync('miclave123', 4);
const users = {
  1: { id: 1, username: 'ana', password_hash: HASH, token_version: 0, owner_user_id: null, tours_vistos: [] },
  2: { id: 2, username: 'beto', password_hash: HASH, token_version: 0, owner_user_id: null, tours_vistos: [] },
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
  if (text.includes('SELECT tours_vistos FROM users WHERE id')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ tours_vistos: u.tours_vistos }] : []);
  }
  if (text.includes('UPDATE users SET tours_vistos')) {
    const u = users[values[2]];
    u.tours_vistos = u.tours_vistos.filter((p) => p !== values[0]).concat(values[1]);
    return Promise.resolve([]);
  }
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);

require.cache[require.resolve('@neondatabase/serverless')] = { id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true, exports: { neon: () => fakeSql } };
require.cache[require.resolve('@vercel/blob')] = { id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true, exports: { put: async () => ({ url: 'x' }), del: async () => {}, get: async () => null } };
require.cache[require.resolve('@anthropic-ai/sdk')] = { id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true, exports: class { constructor() {} } };
const app = require(serverPath);

let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.log('FAIL - ' + m); } };

function request(server, opts, cookie) {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : null;
    const headers = Object.assign({}, opts.headers || {});
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    if (cookie) headers.Cookie = cookie;
    const host = `127.0.0.1:${server.address().port}`;
    headers.Origin = headers.Origin || `http://${host}`;
    const r = http.request({ hostname: '127.0.0.1', port: server.address().port, path: opts.path, method: opts.method || 'GET', headers }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch (e) { /* no json */ } resolve({ status: res.statusCode, headers: res.headers, body: b, json }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
async function login(server, username) {
  const resp = await request(server, { path: '/api/login', method: 'POST', body: { username, password: 'miclave123' } });
  if (resp.status !== 200) throw new Error(`login falló: ${resp.status}`);
  return resp.headers['set-cookie'][0].split(';')[0];
}

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    let r = await request(server, { path: '/api/tour' });
    ok(r.status === 401, 'sin sesión no se ve la lista (401)');
    r = await request(server, { path: '/api/tour/visto', method: 'POST', body: { pagina: '/app.html' } });
    ok(r.status === 401, 'sin sesión no se puede marcar (401)');

    const ana = await login(server, 'ana');
    const beto = await login(server, 'beto');

    r = await request(server, { path: '/api/tour' }, ana);
    ok(r.status === 200 && r.json.aplica === true && r.json.vistos.length === 0, 'una cuenta nueva no tiene recorridos vistos');

    r = await request(server, { path: '/api/tour/visto', method: 'POST', body: { pagina: '/otra-cosa.html' } }, ana);
    ok(r.status === 400, 'una página sin recorrido se rechaza (400)');
    r = await request(server, { path: '/api/tour/visto', method: 'POST', body: {} }, ana);
    ok(r.status === 400, 'sin página se rechaza (400)');

    r = await request(server, { path: '/api/tour/visto', method: 'POST', body: { pagina: '/app.html' } }, ana);
    ok(r.status === 200, 'marcar el recorrido de la app como visto');
    r = await request(server, { path: '/api/tour/visto', method: 'POST', body: { pagina: '/app.html' } }, ana);
    r = await request(server, { path: '/api/tour/visto', method: 'POST', body: { pagina: '/capitulos.html' } }, ana);
    r = await request(server, { path: '/api/tour' }, ana);
    ok(JSON.stringify(r.json.vistos) === JSON.stringify(['/app.html', '/capitulos.html']), 'marcar dos veces no repite y se guardan las dos páginas');

    r = await request(server, { path: '/api/tour' }, beto);
    ok(r.json.vistos.length === 0, 'la lista de otra cuenta no se ve afectada');
  } catch (e) {
    fallaron++;
    console.log('FAIL - error inesperado:', e && e.stack ? e.stack : e);
  } finally {
    server.close();
  }
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
