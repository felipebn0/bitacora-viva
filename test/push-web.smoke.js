// Avisos push (Web Push): la dueña activa los avisos en su celular y, cuando una colaboradora termina un aporte,
// le llega la notificación SOLO a ella. Sin llaves VAPID todo queda apagado. Las suscripciones vencidas se borran.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';
process.env.VAPID_PUBLIC_KEY = 'BPublicaDePrueba';
process.env.VAPID_PRIVATE_KEY = 'privadaDePrueba';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const HASH = bcrypt.hashSync('miclave123', 4);
const users = {
  1: { id: 1, username: 'duena', password_hash: HASH, token_version: 0, owner_user_id: null },
  2: { id: 2, username: 'colab', password_hash: HASH, token_version: 0, owner_user_id: 1 },
  3: { id: 3, username: 'otra', password_hash: HASH, token_version: 0, owner_user_id: null },
};
let suscripciones = [];
let siguienteId = 1;
const enviados = [];
let fallarCon = null; // endpoint -> código HTTP con el que "falla"
const bitacoras = { 50: { id: 50, admin_user_id: 1, narrador_code: 'NARR1234', invite_code: null } };
const limpiezas = [];

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
  if (text.includes('INSERT INTO push_subscriptions')) {
    const [userId, endpoint, p256dh, auth] = values;
    const previa = suscripciones.find((s) => s.endpoint === endpoint);
    if (previa) Object.assign(previa, { user_id: userId, p256dh, auth });
    else suscripciones.push({ id: siguienteId++, user_id: userId, endpoint, p256dh, auth });
    return Promise.resolve([]);
  }
  if (text.includes('DELETE FROM push_subscriptions WHERE user_id') && text.includes('endpoint')) {
    suscripciones = suscripciones.filter((s) => !(s.user_id === values[0] && s.endpoint === values[1]));
    return Promise.resolve([]);
  }
  if (text.includes('DELETE FROM push_subscriptions WHERE user_id') && text.includes('NOT IN')) return Promise.resolve([]);
  if (text.includes('DELETE FROM push_subscriptions WHERE id')) {
    suscripciones = suscripciones.filter((s) => s.id !== values[0]);
    return Promise.resolve([]);
  }
  if (text.includes('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id')) {
    return Promise.resolve(suscripciones.filter((s) => s.user_id === values[0]).map((s) => ({ ...s })));
  }
  if (text.includes('SELECT id, narrador_code FROM bitacoras WHERE id') && text.includes('admin_user_id')) {
    const b = bitacoras[values[0]];
    return Promise.resolve(b && b.admin_user_id === values[1] ? [{ id: b.id, narrador_code: b.narrador_code }] : []);
  }
  if (text.includes('SELECT id, narrador_code FROM bitacoras WHERE id')) {
    const b = bitacoras[values[0]];
    return Promise.resolve(b ? [{ id: b.id, narrador_code: b.narrador_code }] : []);
  }
  if (text.includes('UPDATE bitacoras SET narrador_code = NULL WHERE id')) { bitacoras[values[0]].narrador_code = null; return Promise.resolve([]); }
  if (text.includes('DELETE FROM push_recordatorio_envios WHERE user_id') || text.includes('DELETE FROM push_recordatorio_cuentas WHERE user_id')) { limpiezas.push(values[0]); return Promise.resolve([]); }
  if (text.includes('DELETE FROM push_subscriptions WHERE user_id') && !text.includes('endpoint') && !text.includes('NOT IN')) {
    suscripciones = suscripciones.filter((x) => x.user_id !== values[0]);
    return Promise.resolve([]);
  }
  if (text.includes('SELECT id, invite_code FROM users WHERE id')) return Promise.resolve([{ id: values[0], invite_code: 'ABCD1234' }]);
  if (text.includes('FROM invitados WHERE id')) return Promise.resolve([{ '?column?': 1 }]);
  if (text.includes('SELECT aportes_pending_names FROM users WHERE id')) return Promise.resolve([{ aportes_pending_names: null }]);
  if (text.includes('UPDATE users SET aportes_pending_names')) return Promise.resolve([]);
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);

require.cache[require.resolve('@neondatabase/serverless')] = { id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true, exports: { neon: () => fakeSql } };
require.cache[require.resolve('@vercel/blob')] = { id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true, exports: { put: async () => ({ url: 'x' }), del: async () => {}, get: async () => null } };
require.cache[require.resolve('@anthropic-ai/sdk')] = { id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true, exports: class { constructor() {} } };
require.cache[require.resolve('web-push')] = {
  id: require.resolve('web-push'), filename: require.resolve('web-push'), loaded: true,
  exports: {
    setVapidDetails() {},
    async sendNotification(sub, carga) {
      if (fallarCon && fallarCon.endpoint === sub.endpoint) { const e = new Error('vencida'); e.statusCode = fallarCon.codigo; throw e; }
      enviados.push({ endpoint: sub.endpoint, carga: JSON.parse(carga) });
    },
  },
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
    let r = await request(server, { path: '/api/push/clave' });
    ok(r.status === 200 && r.json.habilitado === true && r.json.clave === 'BPublicaDePrueba', 'la llave pública se entrega (sin sesión) cuando hay llaves');
    ok(!/privad/i.test(r.body), 'la llave privada nunca sale');

    r = await request(server, { path: '/api/push/suscribir', method: 'POST', body: { subscription: {} } });
    ok(r.status === 401, 'sin sesión no se puede activar (401)');

    const duena = await login(server, 'duena');
    const colab = await login(server, 'colab');
    const otra = await login(server, 'otra');

    r = await request(server, { path: '/api/push/suscribir', method: 'POST', body: { subscription: { endpoint: 'http://inseguro', keys: { p256dh: 'a', auth: 'b' } } } }, duena);
    ok(r.status === 400, 'una dirección que no es https no se acepta (400)');
    // Solo servicios de push de navegadores: nada de direcciones internas ni de cualquier servidor (SEC-01).
    for (const malo of ['https://127.0.0.2/x', 'https://[::1]/x', 'https://10.0.0.5/x', 'https://evil.example.com/x', 'https://fcm.googleapis.com:8443/x', 'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.com/x', 'https://localhost/x']) {
      r = await request(server, { path: '/api/push/suscribir', method: 'POST', body: { subscription: { endpoint: malo, keys: { p256dh: 'a', auth: 'b' } } } }, duena);
      ok(r.status === 400, 'no se acepta un destino que no es un servicio de push: ' + malo);
    }
    for (const bueno of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://web.push.apple.com/abc', 'https://wns2-bl2p.notify.windows.com/w/?token=abc']) {
      r = await request(server, { path: '/api/push/suscribir', method: 'POST', body: { subscription: { endpoint: bueno, keys: { p256dh: 'a', auth: 'b' } } } }, duena);
      ok(r.status === 200, 'sí se acepta un servicio de push real: ' + new URL(bueno).hostname + ' (' + r.status + ' ' + r.body.slice(0, 80) + ')');
      await request(server, { path: '/api/push/baja', method: 'POST', body: { endpoint: bueno } }, duena);
    }
    r = await request(server, { path: '/api/push/suscribir', method: 'POST', body: { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/dueña-1', keys: { p256dh: 'p1', auth: 'a1' } } } }, duena);
    ok(r.status === 200 && suscripciones.length === 1 && suscripciones[0].user_id === 1, 'la dueña activa los avisos en su celular');
    r = await request(server, { path: '/api/push/suscribir', method: 'POST', body: { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/otra-1', keys: { p256dh: 'p2', auth: 'a2' } } } }, otra);
    ok(r.status === 200 && suscripciones.length === 2, 'otra cuenta activa los suyos');
    r = await request(server, { path: '/api/push/suscribir', method: 'POST', body: { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/colab-1', keys: { p256dh: 'p3', auth: 'a3' } } } }, colab);
    ok(r.status === 403 || r.status === 401, 'una colaboradora no puede activar avisos de la bitácora de otra persona');

    // Prueba
    r = await request(server, { path: '/api/push/prueba', method: 'POST', body: {} }, duena);
    ok(r.status === 200 && r.json.enviados === 1 && enviados.length === 1 && enviados[0].endpoint === 'https://fcm.googleapis.com/fcm/send/dueña-1', 'el aviso de prueba llega solo al celular de quien lo pide');

    // Aporte
    enviados.length = 0;
    r = await request(server, { path: '/api/contribute-story', method: 'POST', body: { contributor: 'Ana', parentesco: 'hija', text: 'Recuerdo la finca en Boyacá, donde pasábamos las vacaciones de diciembre con toda la familia reunida alrededor de la mesa.' } }, colab);
    ok(r.status === 200, 'la colaboradora aporta una historia (200)');
    ok(enviados.length === 1 && enviados[0].endpoint === 'https://fcm.googleapis.com/fcm/send/dueña-1', 'el aviso llega a la dueña y a nadie más');
    ok(enviados[0] && /Ana/.test(enviados[0].carga.body) && enviados[0].carga.url === '/app.html', 'el aviso dice quién aportó y lleva a la app principal');

    // Suscripción vencida
    fallarCon = { endpoint: 'https://fcm.googleapis.com/fcm/send/dueña-1', codigo: 410 };
    r = await request(server, { path: '/api/contribute-story', method: 'POST', body: { contributor: 'Luis', text: 'Otro recuerdo largo de la casa del pueblo y de las tardes de domingo cuando todos nos reuníamos a conversar sin prisa.' } }, colab);
    ok(r.status === 200, 'un aviso que falla no rompe el guardado del aporte');
    ok(suscripciones.every((s) => s.endpoint !== 'https://fcm.googleapis.com/fcm/send/dueña-1'), 'la suscripción vencida (410) se borra sola');
    fallarCon = null;

    // Apagar
    r = await request(server, { path: '/api/push/baja', method: 'POST', body: { endpoint: 'https://fcm.googleapis.com/fcm/send/otra-1' } }, otra);
    ok(r.status === 200 && suscripciones.length === 0, 'apagar los avisos borra el celular');

    // El narrador de un subperfil (sin cuenta) sí puede activar el recordatorio; el invitado clásico no
    const firmar = (payload) => {
      const b64 = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
      return `bv_session=${b64}.${crypto.createHmac('sha256', process.env.SESSION_SECRET).update(b64).digest('base64url')}`;
    };
    const narrador = firmar({ guest: true, narrador: true, bitacoraId: 50, guestName: 'Papá', code: 'NARR1234' });
    const clasico = firmar({ guest: true, ownerId: 1, guestName: 'Carlos', code: 'ABCD1234', guestId: 9 });
    r = await request(server, { path: '/api/push/suscribir', method: 'POST', body: { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/papa-1', keys: { p256dh: 'p4', auth: 'a4' } } } }, narrador);
    ok(r.status === 200 && suscripciones.some((x) => x.endpoint === 'https://fcm.googleapis.com/fcm/send/papa-1' && x.user_id === 50), 'el narrador activa los avisos y quedan a nombre de su subperfil (50)');
    r = await request(server, { path: '/api/push/suscribir', method: 'POST', body: { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/carlos-1', keys: { p256dh: 'p5', auth: 'a5' } } } }, clasico);
    ok(r.status === 403 && !suscripciones.some((x) => x.endpoint === 'https://fcm.googleapis.com/fcm/send/carlos-1'), 'un invitado clásico sigue sin poder activar avisos (403)');
    enviados.length = 0;
    r = await request(server, { path: '/api/push/prueba', method: 'POST', body: {} }, narrador);
    ok(r.status === 200 && r.json.enviados === 1 && enviados[0].endpoint === 'https://fcm.googleapis.com/fcm/send/papa-1' && enviados[0].carga.url === '/app.html', 'el aviso de prueba del narrador llega solo a su celular y abre su charla');
    r = await request(server, { path: '/api/push/recordatorio', method: 'POST', body: { activo: false } }, narrador);
    ok(r.status === 200 && r.json.activo === false, 'el narrador puede apagar su recordatorio diario');
    r = await request(server, { path: '/api/push/recordatorio', method: 'POST', body: { activo: true } }, clasico);
    ok(r.status === 403, 'el invitado clásico no toca el recordatorio diario (403)');
    r = await request(server, { path: '/api/push/baja', method: 'POST', body: { endpoint: 'https://fcm.googleapis.com/fcm/send/papa-1' } }, narrador);
    ok(r.status === 200 && !suscripciones.some((x) => x.endpoint === 'https://fcm.googleapis.com/fcm/send/papa-1'), 'el narrador apaga los avisos de su celular');

    // Cortar el enlace borra los avisos del subperfil
    await request(server, { path: '/api/push/suscribir', method: 'POST', body: { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/papa-2', keys: { p256dh: 'p6', auth: 'a6' } } } }, narrador);
    r = await request(server, { path: '/api/subprofiles/50/narrador-link/revoke', method: 'POST', body: {} }, duena);
    ok(r.status === 200 && !suscripciones.some((x) => x.user_id === 50) && limpiezas.includes(50), 'al cortar el enlace del narrador se borran sus avisos');
    r = await request(server, { path: '/api/push/suscribir', method: 'POST', body: { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/papa-3', keys: { p256dh: 'p7', auth: 'a7' } } } }, narrador);
    ok(r.status === 401 && !suscripciones.some((x) => x.user_id === 50), 'con el enlace cortado el narrador ya no puede activar avisos (401)');
  } catch (e) {
    fallaron++;
    console.log('FAIL - error inesperado:', e && e.stack ? e.stack : e);
  } finally {
    server.close();
  }
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
