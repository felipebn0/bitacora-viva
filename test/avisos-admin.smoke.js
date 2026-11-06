// A los admins les suena el celular cuando alguien se registra y cuando una cuenta nueva empieza su primera charla (una sola vez).
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
  1: { id: 1, username: 'admin', name: 'Felipe', password_hash: HASH, token_version: 0, owner_user_id: null, is_admin: true, primer_uso_avisado: true, email: 'admin@x.co' },
};
let siguienteId = 10;
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
  if (text.includes('SELECT id FROM users WHERE email =')) {
    return Promise.resolve(Object.values(users).filter((u) => u.email === values[0]).map((u) => ({ id: u.id })));
  }
  if (text.includes('INSERT INTO users (username, name, email')) {
    const [username, name, email, , password_hash, owner_user_id] = values;
    const u = { id: siguienteId++, username, name, email, password_hash, token_version: 0, owner_user_id, is_admin: false, primer_uso_avisado: values[8] };
    users[u.id] = u;
    return Promise.resolve([{ id: u.id, username: u.username, token_version: 0 }]);
  }
  if (text.includes('SELECT id FROM users WHERE is_admin = true')) return Promise.resolve(Object.values(users).filter((u) => u.is_admin).map((u) => ({ id: u.id })));
  if (text.includes('UPDATE users SET primer_uso_avisado = true')) {
    const u = users[values[0]];
    if (!u || u.primer_uso_avisado) return Promise.resolve([]);
    u.primer_uso_avisado = true;
    return Promise.resolve([{ n: u.name || u.username }]);
  }
  if (text.includes('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id')) {
    return Promise.resolve(suscripciones.filter((s) => s.user_id === values[0]).map((s) => ({ ...s })));
  }
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);

require.cache[require.resolve('@neondatabase/serverless')] = { id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true, exports: { neon: () => fakeSql } };
require.cache[require.resolve('@vercel/blob')] = { id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true, exports: { put: async () => ({ url: 'x' }), del: async () => {}, get: async () => null } };
require.cache[require.resolve('@anthropic-ai/sdk')] = {
  id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true,
  exports: class { constructor() {} get messages() { return { create: async () => ({ content: [{ type: 'text', text: 'Hola, ¿cómo te llamas?' }] }) }; } },
};
require.cache[require.resolve('web-push')] = {
  id: require.resolve('web-push'), filename: require.resolve('web-push'), loaded: true,
  exports: { setVapidDetails() {}, async sendNotification(sub, carga) { enviados.push({ endpoint: sub.endpoint, carga: JSON.parse(carga) }); } },
};
const app = require(serverPath);

let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.log('FAIL - ' + m); } };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

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

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const registro = { name: 'maria perez', email: 'maria@x.co', phone: '+57 300 123 4567', password: 'miclave123', acceptTerms: true };
    let r = await request(server, { path: '/api/signup', method: 'POST', body: registro });
    ok(r.status === 200, 'el registro funciona (200)');
    ok(enviados.length === 1 && enviados[0].endpoint === 'https://push.example/admin-1', 'al admin le llega la notificación de la cuenta nueva');
    ok(/Maria Perez/.test(enviados[0].carga.body) && enviados[0].carga.title === 'Eco · nueva cuenta' && enviados[0].carga.url === '/admin.html', 'dice quién se registró y lleva al panel');
    ok(!/maria@x\.co|300/.test(JSON.stringify(enviados[0].carga)), 'sin correo ni teléfono en la notificación');

    r = await request(server, { path: '/api/signup', method: 'POST', body: registro });
    ok(r.status === 409 && enviados.length === 1, 'un registro repetido no avisa de nuevo');

    const cookieMaria = r2cookie(await request(server, { path: '/api/login', method: 'POST', body: { username: 'maria@x.co', password: 'miclave123' } }));
    enviados.length = 0;
    r = await request(server, { path: '/api/next', method: 'POST', body: { history: [], mode: 'historia' } }, cookieMaria);
    await dormir(100);
    ok(r.status === 200, 'la primera charla funciona (200)');
    ok(enviados.length === 1 && /Maria Perez/.test(enviados[0].carga.body) && enviados[0].carga.title === 'Eco · empezó a usar la app', 'al admin le llega que empezó a usar la app');

    enviados.length = 0;
    r = await request(server, { path: '/api/next', method: 'POST', body: { history: [], mode: 'historia' } }, cookieMaria);
    await dormir(100);
    ok(enviados.length === 0, 'la segunda charla no vuelve a avisar');

    const cookieAdmin = r2cookie(await request(server, { path: '/api/login', method: 'POST', body: { username: 'admin', password: 'miclave123' } }));
    r = await request(server, { path: '/api/next', method: 'POST', body: { history: [], mode: 'historia' } }, cookieAdmin);
    await dormir(100);
    ok(enviados.length === 0, 'una cuenta que ya existía no avisa al hablar');
  } catch (e) {
    fallaron++;
    console.log('FAIL - error inesperado:', e && e.stack ? e.stack : e);
  } finally {
    server.close();
  }
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();

function r2cookie(resp) {
  if (resp.status !== 200) throw new Error(`login falló: ${resp.status}`);
  return resp.headers['set-cookie'][0].split(';')[0];
}
