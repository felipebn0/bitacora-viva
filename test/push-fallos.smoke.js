// Aviso de fallas de notificaciones: si en una hora fallan 5 o más (activar o mandar avisos), a los admins les llega
// UN correo (como mucho uno cada 12 horas). Nace del 10-nov-2026: Chrome/Android rechazado un día sin que nadie lo notara.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';
process.env.VAPID_PUBLIC_KEY = 'BPublicaDePrueba';
process.env.VAPID_PRIVATE_KEY = 'privadaDePrueba';
process.env.RESEND_API_KEY = 're_prueba';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const HASH = bcrypt.hashSync('miclave123', 4);
const users = { 1: { id: 1, username: 'duena', password_hash: HASH, token_version: 0, owner_user_id: null } };
let suscripciones = [];
let fallos = [];
let fallarEnvio = false;
const correos = [];

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
  if (text.includes("SELECT 'alerta'")) {
    if (fallos.some((f) => f.tipo === 'alerta')) return Promise.resolve([]);
    fallos.push({ tipo: 'alerta', detalle: values[0] });
    return Promise.resolve([{ id: fallos.length }]);
  }
  if (text.includes('INSERT INTO push_fallos')) { fallos.push({ tipo: values[0], detalle: values[1] }); return Promise.resolve([]); }
  if (text.includes('DELETE FROM push_fallos')) return Promise.resolve([]);
  if (text.includes('SELECT count(*)::int AS n FROM push_fallos')) return Promise.resolve([{ n: fallos.filter((f) => f.tipo !== 'alerta').length }]);
  if (text.includes('SELECT tipo, detalle, count(*)::int AS n FROM push_fallos')) {
    const g = {};
    for (const f of fallos.filter((x) => x.tipo !== 'alerta')) { const k = f.tipo + '|' + f.detalle; g[k] = g[k] || { tipo: f.tipo, detalle: f.detalle, n: 0 }; g[k].n++; }
    return Promise.resolve(Object.values(g).sort((a, b) => b.n - a.n));
  }
  if (text.includes('SELECT email FROM users WHERE is_admin')) return Promise.resolve([{ email: 'admin@example.com' }, { email: 'admin2@example.com' }]);
  if (text.includes('INSERT INTO push_subscriptions')) { suscripciones.push({ id: suscripciones.length + 1, user_id: values[0], endpoint: values[1], p256dh: values[2], auth: values[3] }); return Promise.resolve([]); }
  if (text.includes('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id')) return Promise.resolve(suscripciones.filter((s) => s.user_id === values[0]));
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);

const mod = (name, exports) => { require.cache[require.resolve(name)] = { id: require.resolve(name), filename: require.resolve(name), loaded: true, exports }; };
mod('@neondatabase/serverless', { neon: () => fakeSql });
mod('@vercel/blob', { put: async () => ({ url: 'x' }), del: async () => {}, get: async () => null });
mod('@anthropic-ai/sdk', class { constructor() {} });
mod('web-push', { setVapidDetails() {}, async sendNotification() { if (fallarEnvio) { const e = new Error('servidor caído'); e.statusCode = 500; throw e; } } });
const fetchReal = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).startsWith('https://api.resend.com/')) { correos.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ id: 'x' }) }; }
  return fetchReal(url, opts);
};
const app = require(path.resolve(__dirname, '..', 'server.js'));

let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.log('FAIL - ' + m); } };
function request(server, opts, cookie) {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : null;
    const headers = {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    if (cookie) headers.Cookie = cookie;
    headers.Origin = `http://127.0.0.1:${server.address().port}`;
    const r = http.request({ hostname: '127.0.0.1', port: server.address().port, path: opts.path, method: opts.method || 'GET', headers }, (res) => {
      let b = ''; res.on('data', (c) => (b += c));
      res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch (e) { /* no json */ } resolve({ status: res.statusCode, headers: res.headers, body: b, json }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const suscribir = (server, cookie, endpoint) => request(server, { path: '/api/push/suscribir', method: 'POST', body: { subscription: { endpoint, keys: { p256dh: 'a', auth: 'b' } } } }, cookie);

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const login = await request(server, { path: '/api/login', method: 'POST', body: { username: 'duena', password: 'miclave123' } });
    const cookie = login.headers['set-cookie'][0].split(';')[0];

    for (let i = 0; i < 4; i++) {
      const r = await suscribir(server, cookie, 'https://evil.example.com/' + i);
      ok(r.status === 400, `intento rechazado ${i + 1} sigue respondiendo 400`);
    }
    ok(correos.length === 0, 'con 4 fallos en la hora todavía no llega correo');
    await suscribir(server, cookie, 'https://evil.example.com/5');
    ok(correos.length === 2, `al 5.º fallo llega un correo a cada admin (${correos.length})`);
    const c = correos[0] || {};
    ok(c.subject === 'Eco: están fallando las notificaciones', 'asunto claro');
    ok(/5/.test(c.text || '') && /activar avisos — rechazada: evil\.example\.com/.test(c.text || ''), 'el correo dice cuántos y de qué servicio');
    ok(!/keys|p256dh|auth=/.test(c.text || '') && !/\/5/.test(c.text || ''), 'no incluye la dirección completa ni las llaves del celular');

    for (let i = 0; i < 3; i++) await suscribir(server, cookie, 'https://evil.example.com/x' + i);
    ok(correos.length === 2, 'siguen fallando pero no llega otro correo (uno cada 12 horas)');

    fallos = fallos.filter((f) => f.tipo === 'alerta');
    let r = await suscribir(server, cookie, 'https://fcm.googleapis.com/fcm/send/abc');
    ok(r.status === 200, 'un Chrome/Android real se activa bien (200)');
    fallarEnvio = true;
    r = await request(server, { path: '/api/push/prueba', method: 'POST', body: {} }, cookie);
    ok(r.status === 200 && r.json.enviados === 0, 'si mandar el aviso falla, la respuesta no se rompe');
    ok(fallos.some((f) => f.tipo === 'envio' && f.detalle === 'fcm.googleapis.com: 500'), 'el envío fallido queda anotado con servicio y código');
  } catch (e) {
    fallaron++; console.error(e);
  } finally {
    server.close();
    console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
    process.exit(fallaron ? 1 : 0);
  }
})();
