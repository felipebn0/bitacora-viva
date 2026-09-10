// Smoke test de los recordatorios por WhatsApp (envío manual asistido).
//
// Cubre: el cron se niega a correr sin CRON_SECRET; con el secreto arma el
// resumen y separa quién va por correo de quién entra en la lista de
// WhatsApp; un candidato con opt-in + teléfono entra en la lista y NO
// recibe correo; sin CallMeBot ni correo configurados no se registra en
// whatsapp_reminder_log (para reintentar mañana); las rutas de /admin
// exigen sesión.
//
// No pega contra una base real: mockea @neondatabase/serverless, @vercel/blob
// y @anthropic-ai/sdk igual que el resto de los smoke tests.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.CRON_SECRET = 'secreto-de-prueba';
// A propósito SIN CallMeBot ni correo: así probamos que el resumen no se
// registra cuando no hay ningún canal por el que mandarlo.
delete process.env.CALLMEBOT_PHONE;
delete process.env.CALLMEBOT_APIKEY;
delete process.env.WHATSAPP_DIGEST_EMAIL;
delete process.env.RESEND_API_KEY;

const path = require('path');
const http = require('http');

const serverPath = path.resolve(__dirname, '..', 'server.js');

let logInserts = [];
let correoEnviado = [];

// Un candidato que SÍ está pendiente: nunca tuvo charla (usamos created_at
// viejo), marcó WhatsApp y tiene teléfono. Debe entrar en la lista de
// WhatsApp y no en la de correo.
const HACE_MUCHO = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

function fakeSql(strings, ...values) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT owner_user_id, token_version FROM users')) return Promise.resolve([{ owner_user_id: null, token_version: 0 }]);

  // calcularRecordatoriosPendientes(): cuentas dueñas
  if (text.includes('FROM users u') && text.includes('LEFT JOIN notification_preferences')) {
    return Promise.resolve([
      { id: 10, email: 'con-wa@example.com', name: 'María', username: 'maria', created_at: HACE_MUCHO, phone: '+57 300 111 2233', whatsapp_opt_in: true, ultima_charla: null, ultimo_correo: null, ultimo_whatsapp: null, recordatorios_activos: true, frecuencia_dias: 14 },
      { id: 11, email: 'solo-correo@example.com', name: 'Jorge', username: 'jorge', created_at: HACE_MUCHO, phone: null, whatsapp_opt_in: false, ultima_charla: null, ultimo_correo: null, ultimo_whatsapp: null, recordatorios_activos: true, frecuencia_dias: 14 },
    ]);
  }
  // calcularRecordatoriosPendientes(): subperfiles
  if (text.includes('FROM bitacoras b') && text.includes('archived_at IS NULL')) {
    return Promise.resolve([]);
  }
  if (text.includes('INSERT INTO whatsapp_reminder_log')) {
    logInserts.push(values);
    return Promise.resolve([]);
  }
  if (text.includes('INSERT INTO reminder_deliveries')) {
    correoEnviado.push(values);
    return Promise.resolve([]);
  }
  return Promise.resolve([]);
}
fakeSql.transaction = (queries) => Promise.all(queries);

require.cache[require.resolve('@neondatabase/serverless')] = {
  id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true,
  exports: { neon: () => fakeSql },
};
require.cache[require.resolve('@vercel/blob')] = {
  id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true,
  exports: { put: async () => ({ url: 'https://fake.public.blob.vercel-storage.com/x' }), del: async () => {}, list: async () => ({ blobs: [], hasMore: false }), get: async () => null },
};
require.cache[require.resolve('@anthropic-ai/sdk')] = {
  id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true,
  exports: class FakeAnthropic { constructor() {} },
};

const app = require(serverPath);

function request(server, opts) {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : null;
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method: opts.method || 'GET', path: opts.path, headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch (e) { /* deja json en null */ }
        resolve({ status: res.statusCode, json, body });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

let pasaron = 0;
let fallaron = 0;
function ok(cond, msg) {
  if (cond) { console.log('OK  - ' + msg); pasaron++; }
  else { console.error('FAIL - ' + msg); fallaron++; }
}

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));

  // 1) el cron se niega sin el secreto
  let r = await request(server, { path: '/api/cron/reminders' });
  ok(r.status === 401, 'GET /api/cron/reminders sin CRON_SECRET -> 401');

  // 2) con el secreto: arma el resumen, separa canales
  r = await request(server, { path: '/api/cron/reminders', headers: { Authorization: 'Bearer secreto-de-prueba' } });
  ok(r.status === 200, 'GET /api/cron/reminders con el secreto -> 200');
  ok(r.json && r.json.ok === true, 'la respuesta trae ok:true');
  ok(r.json && r.json.whatsapp && r.json.whatsapp.incluidos === 1, 'un candidato con opt-in + teléfono entra en la lista de WhatsApp');
  ok(r.json && r.json.correo && r.json.correo.candidatos === 1, 'el otro candidato (sin WhatsApp) queda para el correo');
  ok(r.json && r.json.correo && r.json.correo.saltado === true, 'sin RESEND_API_KEY el envío de correo queda saltado');

  // 3) sin ningún canal configurado, el resumen NO se registra (para reintentar)
  ok(logInserts.length === 0, 'sin CallMeBot ni correo, no se inserta en whatsapp_reminder_log');
  ok(r.json.whatsapp.callmebot === 'sin-config', 'callmebot reportado como sin-config');

  // 4) las rutas de /admin exigen sesión
  r = await request(server, { path: '/api/admin/whatsapp-reminders' });
  ok(r.status === 401 || r.status === 403, 'GET /api/admin/whatsapp-reminders sin sesión -> 401/403');
  r = await request(server, { method: 'POST', path: '/api/admin/set-phone', body: { scope: 'user', id: 1, phone: '+57 300 000 0000', optIn: true } });
  ok(r.status === 401 || r.status === 403, 'POST /api/admin/set-phone sin sesión -> 401/403');
  r = await request(server, { method: 'POST', path: '/api/admin/whatsapp-reminders/run', body: { dry: true } });
  ok(r.status === 401 || r.status === 403, 'POST /api/admin/whatsapp-reminders/run sin sesión -> 401/403');

  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
