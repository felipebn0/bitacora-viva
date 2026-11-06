// Cuando a alguien le sale el popup de ayuda, los admins reciben una notificación en el celular y queda el registro
// en el panel (sin lo que la persona dijo). Una misma persona y tipo no se repite en 30 minutos.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';
process.env.VAPID_PUBLIC_KEY = 'BPublicaDePrueba';
process.env.VAPID_PRIVATE_KEY = 'privadaDePrueba';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const HASH = bcrypt.hashSync('miclave123', 4);
const users = {
  1: { id: 1, username: 'admin', name: 'Felipe', password_hash: HASH, token_version: 0, owner_user_id: null, is_admin: true },
  2: { id: 2, username: 'ana', name: 'Ana', password_hash: HASH, token_version: 0, owner_user_id: null, is_admin: false },
};
const avisos = [];
let siguienteId = 1;
const suscripciones = [{ id: 1, user_id: 1, endpoint: 'https://push.example/admin-1', p256dh: 'p', auth: 'a' }];
const enviados = [];

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
  if (text.includes('SELECT is_admin FROM users WHERE id')) return Promise.resolve(users[values[0]] ? [{ is_admin: users[values[0]].is_admin }] : []);
  if (text.includes('SELECT id FROM users WHERE is_admin = true')) return Promise.resolve(Object.values(users).filter((u) => u.is_admin).map((u) => ({ id: u.id })));
  if (text.includes('AS n FROM users WHERE id')) return Promise.resolve(users[values[0]] ? [{ n: users[values[0]].name }] : []);
  if (text.includes('SELECT 1 FROM crisis_avisos WHERE cuenta_id =')) {
    return Promise.resolve(avisos.filter((a) => a.cuenta_id === values[0] && a.tipo === values[1]).length ? [{ '?column?': 1 }] : []);
  }
  if (text.includes('SELECT 1 FROM crisis_avisos WHERE cuenta_id IS NULL')) {
    return Promise.resolve(avisos.filter((a) => a.cuenta_id === null && a.quien === values[0] && a.tipo === values[2]).length ? [{ '?column?': 1 }] : []);
  }
  if (text.includes('INSERT INTO crisis_avisos')) {
    const [tipo, cuenta_id, quien, perfil_nombre] = values;
    avisos.push({ id: siguienteId++, created_at: new Date().toISOString(), tipo, cuenta_id, quien, perfil_nombre, atendido_at: null, atendido_por: null, nota: null });
    return Promise.resolve([]);
  }
  if (text.includes('FROM crisis_avisos ORDER BY')) return Promise.resolve(avisos.slice().reverse());
  if (text.includes('UPDATE crisis_avisos SET atendido_at')) {
    const a = avisos.find((x) => x.id === values[2]);
    if (!a) return Promise.resolve([]);
    Object.assign(a, { atendido_at: new Date().toISOString(), atendido_por: values[0], nota: values[1] });
    return Promise.resolve([{ id: a.id }]);
  }
  if (text.includes('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id')) {
    return Promise.resolve(suscripciones.filter((s) => s.user_id === values[0]).map((s) => ({ ...s })));
  }
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);

require.cache[require.resolve('@neondatabase/serverless')] = { id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true, exports: { neon: () => fakeSql } };
require.cache[require.resolve('@vercel/blob')] = { id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true, exports: { put: async () => ({ url: 'x' }), del: async () => {}, get: async () => null } };
require.cache[require.resolve('@anthropic-ai/sdk')] = { id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true, exports: class { constructor() {} } };
require.cache[require.resolve('web-push')] = {
  id: require.resolve('web-push'), filename: require.resolve('web-push'), loaded: true,
  exports: { setVapidDetails() {}, async sendNotification(sub, carga) { enviados.push({ endpoint: sub.endpoint, carga: JSON.parse(carga) }); } },
};
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
    let r = await request(server, { path: '/api/crisis-aviso', method: 'POST', body: { tipo: 'suicide' } });
    ok(r.status === 401, 'sin sesión no se registra nada (401)');

    const admin = await login(server, 'admin');
    const ana = await login(server, 'ana');

    r = await request(server, { path: '/api/crisis-aviso', method: 'POST', body: { tipo: 'otra-cosa' } }, ana);
    ok(r.status === 400 && avisos.length === 0, 'un tipo que no existe se rechaza (400)');

    r = await request(server, { path: '/api/crisis-aviso', method: 'POST', body: { tipo: 'suicide', texto: 'lo que dijo' } }, ana);
    ok(r.status === 200 && avisos.length === 1, 'cuando sale el popup queda el registro');
    ok(avisos[0].quien === 'Ana' && avisos[0].tipo === 'suicide' && avisos[0].cuenta_id === 2, 'el registro dice quién y de qué tipo');
    ok(!JSON.stringify(avisos[0]).includes('lo que dijo'), 'lo que la persona dijo nunca se guarda');
    ok(enviados.length === 1 && enviados[0].endpoint === 'https://push.example/admin-1', 'la notificación le llega al celular del admin');
    ok(/Ana/.test(enviados[0].carga.body) && enviados[0].carga.url === '/admin.html' && !/lo que dijo/.test(enviados[0].carga.body), 'la notificación dice quién y lleva al panel, sin el texto');

    r = await request(server, { path: '/api/crisis-aviso', method: 'POST', body: { tipo: 'suicide' } }, ana);
    ok(r.status === 200 && r.json.repetido === true && avisos.length === 1 && enviados.length === 1, 'el mismo tipo en 30 minutos no se repite ni vuelve a sonar');
    r = await request(server, { path: '/api/crisis-aviso', method: 'POST', body: { tipo: 'violence' } }, ana);
    ok(r.status === 200 && avisos.length === 2 && enviados.length === 2, 'otro tipo sí cuenta como aviso nuevo');

    r = await request(server, { path: '/api/admin/crisis-avisos' }, ana);
    ok(r.status === 403, 'quien no es admin no ve la lista (403)');
    r = await request(server, { path: '/api/admin/crisis-avisos' }, admin);
    ok(r.status === 200 && r.json.avisos.length === 2, 'el admin ve la lista');

    r = await request(server, { path: '/api/admin/crisis-avisos/1/atendido', method: 'POST', body: { nota: 'Hablé con ella' } }, ana);
    ok(r.status === 403 && !avisos[0].atendido_at, 'quien no es admin no puede marcar un aviso como atendido (403)');
    r = await request(server, { path: '/api/admin/crisis-avisos/1/atendido', method: 'POST', body: { nota: 'Hablé con ella' } }, admin);
    ok(r.status === 200 && avisos[0].atendido_at && avisos[0].atendido_por === 'Felipe' && avisos[0].nota === 'Hablé con ella', 'el admin deja constancia del seguimiento');
    r = await request(server, { path: '/api/admin/crisis-avisos/999/atendido', method: 'POST', body: {} }, admin);
    ok(r.status === 404, 'un aviso que no existe devuelve 404');
    r = await request(server, { path: '/api/admin/crisis-avisos/abc/atendido', method: 'POST', body: {} }, admin);
    ok(r.status === 400, 'un número de aviso no válido devuelve 400');
  } catch (e) {
    fallaron++;
    console.log('FAIL - error inesperado:', e && e.stack ? e.stack : e);
  } finally {
    server.close();
  }
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
