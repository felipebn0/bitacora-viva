// Recordatorio diario por push con prueba de mensajes: reparte las cuentas en tipos A a E, no manda si ya usó Eco hoy ni
// más de uno al día, respeta el apagado, mide aperturas y no deja que cualquiera mire los resultados.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';
process.env.VAPID_PUBLIC_KEY = 'BPublicaDePrueba';
process.env.VAPID_PRIVATE_KEY = 'privadaDePrueba';
process.env.CRON_SECRET = 'cron-de-prueba';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const HASH = bcrypt.hashSync('miclave123', 4);
const users = {
  1: { id: 1, username: 'ana', password_hash: HASH, token_version: 0, owner_user_id: null, is_admin: true },
  2: { id: 2, username: 'beto', password_hash: HASH, token_version: 0, owner_user_id: null, is_admin: false },
};
// Cuentas que el cron encuentra (lo que devolvería la consulta grande).
let candidatas = [];
let tiposGuardados = {};
let envios = [];
let siguienteEnvio = 1;
let activoGuardado = null;
const enviados = [];
const sinCelular = new Set();

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
  if (text.includes('SELECT is_admin FROM users WHERE id')) return Promise.resolve([{ is_admin: !!(users[values[0]] || {}).is_admin }]);
  if (text.includes('FROM (SELECT DISTINCT user_id FROM push_subscriptions) s')) {
    return Promise.resolve(candidatas.map((c) => ({ ...c, tipo: tiposGuardados[c.user_id] || null })));
  }
  if (text.includes('SELECT tipo, count(*)::int AS total FROM push_recordatorio_cuentas')) {
    const cuenta = {};
    Object.values(tiposGuardados).forEach((t) => { cuenta[t] = (cuenta[t] || 0) + 1; });
    return Promise.resolve(Object.entries(cuenta).map(([tipo, total]) => ({ tipo, total })));
  }
  if (text.includes('INSERT INTO push_recordatorio_cuentas (user_id, tipo)')) {
    if (!tiposGuardados[values[0]]) tiposGuardados[values[0]] = values[1];
    return Promise.resolve([]);
  }
  if (text.includes('INSERT INTO push_recordatorio_cuentas (user_id, activo)')) { activoGuardado = values[1]; return Promise.resolve([]); }
  if (text.includes('SELECT activo FROM push_recordatorio_cuentas')) return Promise.resolve(activoGuardado === null ? [] : [{ activo: activoGuardado }]);
  if (text.includes('INSERT INTO push_recordatorio_envios')) {
    const [user_id, tipo_asignado, tipo_enviado, variante, token] = values;
    const fila = { id: siguienteEnvio++, user_id, tipo_asignado, tipo_enviado, variante, token, abierto_at: null };
    envios.push(fila);
    return Promise.resolve([{ id: fila.id }]);
  }
  if (text.includes('DELETE FROM push_recordatorio_envios WHERE id')) { envios = envios.filter((e) => e.id !== values[0]); return Promise.resolve([]); }
  if (text.includes('UPDATE push_recordatorio_envios SET abierto_at')) {
    const e = envios.find((x) => x.token === values[0] && !x.abierto_at);
    if (e) e.abierto_at = new Date();
    return Promise.resolve([]);
  }
  if (text.includes('GROUP BY e.tipo_asignado')) {
    const por = {};
    envios.forEach((e) => { const t = por[e.tipo_asignado] || (por[e.tipo_asignado] = { tipo: e.tipo_asignado, enviados: 0, abiertos: 0, cuentas: 0, charlas: 0 }); t.enviados++; if (e.abierto_at) t.abiertos++; });
    return Promise.resolve(Object.values(por));
  }
  if (text.includes('GROUP BY e.tipo_enviado, e.variante')) {
    const por = {};
    envios.forEach((e) => { const k = e.tipo_enviado + e.variante; const t = por[k] || (por[k] = { tipo: e.tipo_enviado, variante: e.variante, enviados: 0, abiertos: 0 }); t.enviados++; if (e.abierto_at) t.abiertos++; });
    return Promise.resolve(Object.values(por));
  }
  if (text.includes('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id')) {
    return Promise.resolve(sinCelular.has(values[0]) ? [] : [{ id: values[0], endpoint: 'https://push.example/c' + values[0], p256dh: 'p', auth: 'a' }]);
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
const { MENSAJES, armarMensaje, inicioDelDiaColombia } = require('../push-recordatorios-routes');

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
const cron = (server, auth) => request(server, { path: '/api/cron/recordatorio-push', headers: auth === false ? {} : { authorization: 'Bearer ' + (auth || 'cron-de-prueba') } });

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    // Mensajes
    ok(Object.keys(MENSAJES).join('') === 'ABCDE' && Object.values(MENSAJES).every((v) => v.length === 3), 'hay 5 tipos con 3 variantes cada uno');
    const todos = [];
    for (const t of 'ABCDE') for (let v = 0; v < 3; v++) { const m = armarMensaje(t, v, 12); todos.push(m.title, m.body); }
    ok(todos.every((x) => x && !/[!¡]/.test(x) && !/undefined|\{n\}/.test(x)), 'ningún mensaje tiene exclamaciones ni huecos sin llenar');
    ok(armarMensaje('D', 0, 12).body === 'Ya tiene 12 historias. ¿Sumamos una hoy?' && armarMensaje('D', 1, 1).title === '1 historia y contando', 'el tipo D usa el número real de historias (singular y plural)');
    ok(armarMensaje('D', 2, 7).body.includes('historia 7'), 'la variante 3 del tipo D dice por cuál historia va');
    ok(inicioDelDiaColombia(new Date('2026-11-01T03:00:00Z')).toISOString() === '2026-10-31T05:00:00.000Z', 'el día de Colombia empieza a las 5 am UTC');

    // Cron: seguridad
    let r = await cron(server, false);
    ok(r.status === 401, 'sin la clave del cron no corre (401)');
    r = await cron(server, 'otra');
    ok(r.status === 401, 'con una clave equivocada tampoco');

    // Cron: reparto y reglas
    candidatas = [
      { user_id: 11, ya_envio: false, uso_hoy: false, historias: 5 },
      { user_id: 12, ya_envio: false, uso_hoy: false, historias: 0 },
      { user_id: 13, ya_envio: false, uso_hoy: false, historias: 3 },
      { user_id: 14, ya_envio: false, uso_hoy: false, historias: 1 },
      { user_id: 15, ya_envio: false, uso_hoy: false, historias: 8 },
      { user_id: 16, ya_envio: false, uso_hoy: true, historias: 4 },
      { user_id: 17, ya_envio: true, uso_hoy: false, historias: 4 },
    ];
    r = await cron(server);
    ok(r.status === 200 && r.json.enviados === 5, 'manda a las 5 cuentas que le tocan');
    ok(r.json.yaUsaron === 1 && r.json.yaTenianAviso === 1, 'salta a quien ya usó Eco hoy y a quien ya recibió uno hoy');
    ok(!enviados.some((e) => e.endpoint === 'https://push.example/c16' || e.endpoint === 'https://push.example/c17'), 'a esas dos no les llega nada');
    ok(new Set(Object.values(tiposGuardados)).size === 5, 'las 5 cuentas quedan repartidas en los 5 tipos (uno cada uno)');
    ok(envios.length === 5 && envios.every((e) => /^[a-f0-9]{24}$/.test(e.token)), 'cada envío queda registrado con su marca');
    const sinHistorias = envios.find((e) => e.user_id === 12);
    ok(sinHistorias.tipo_enviado !== 'D' || sinHistorias.tipo_asignado !== 'D', 'quien no tiene historias nunca recibe el mensaje de progreso');
    ok(enviados.every((e) => e.carga.url.startsWith('/app.html?av=') && e.carga.tag === 'eco-recordatorio'), 'el aviso abre Eco con la marca de medición');
    const antes = JSON.stringify(tiposGuardados);

    // Repetir el cron el mismo día: el tipo se conserva
    enviados.length = 0; envios = [];
    candidatas = candidatas.slice(0, 5).map((c) => ({ ...c, ya_envio: false, uso_hoy: false }));
    await cron(server);
    ok(JSON.stringify(tiposGuardados) === antes, 'cada cuenta se queda en su tipo');

    // Cuenta sin celular: no queda un envío fantasma
    enviados.length = 0; envios = [];
    sinCelular.add(11);
    candidatas = [{ user_id: 11, ya_envio: false, uso_hoy: false, historias: 5 }];
    r = await cron(server);
    ok(r.json.enviados === 0 && envios.length === 0, 'si no se pudo entregar a ningún celular, no se cuenta como enviado');
    sinCelular.clear();

    // Apertura
    envios = []; enviados.length = 0;
    candidatas = [{ user_id: 13, ya_envio: false, uso_hoy: false, historias: 3 }];
    await cron(server);
    const token = envios[0].token;
    r = await request(server, { path: '/api/push/abierto', method: 'POST', body: { token: 'raro' } });
    ok(r.status === 400, 'una marca inventada se rechaza (400)');
    r = await request(server, { path: '/api/push/abierto', method: 'POST', body: { token } });
    ok(r.status === 200 && envios[0].abierto_at, 'abrir tocando el aviso queda registrado');

    // Preferencia
    const ana = await login(server, 'ana');
    const beto = await login(server, 'beto');
    r = await request(server, { path: '/api/push/recordatorio' });
    ok(r.status === 401, 'sin sesión no se ve la preferencia');
    r = await request(server, { path: '/api/push/recordatorio', headers: {} }, ana);
    ok(r.status === 200 && r.json.activo === true, 'por defecto el recordatorio diario está encendido');
    r = await request(server, { path: '/api/push/recordatorio', method: 'POST', body: { activo: false } }, ana);
    ok(r.status === 200 && activoGuardado === false, 'se puede apagar');

    // Resultados solo para admin
    r = await request(server, { path: '/api/admin/push-recordatorios' }, beto);
    ok(r.status === 403, 'una cuenta normal no ve los resultados (403)');
    r = await request(server, { path: '/api/admin/push-recordatorios' }, ana);
    ok(r.status === 200 && r.json.tipos.length === 5 && r.json.tipos.find((t) => t.abiertos === 1) && r.json.variantes[0].titulo, 'la administradora ve los 5 tipos con envíos y aperturas');
  } catch (e) {
    fallaron++;
    console.log('FAIL - error inesperado:', e && e.stack ? e.stack : e);
  } finally {
    server.close();
  }
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
