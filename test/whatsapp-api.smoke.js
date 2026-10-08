// Recordatorios por la API oficial de WhatsApp (Meta): con WHATSAPP_TOKEN y
// WHATSAPP_PHONE_NUMBER_ID el cron manda la plantilla directo a cada persona
// con opt-in + teléfono; lo que Meta rechaza cae en el resumen manual de
// siempre (y se reintenta mañana si no hay ningún canal); solo se registra lo
// que Meta aceptó. El fetch a graph.facebook.com está simulado.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.CRON_SECRET = 'secreto-de-prueba';
process.env.WHATSAPP_TOKEN = '  token-de-prueba \n';
process.env.WHATSAPP_PHONE_NUMBER_ID = ' 123456789 ';
delete process.env.WHATSAPP_TEMPLATE_NAME;
delete process.env.WHATSAPP_TEMPLATE_LANG;
delete process.env.CALLMEBOT_PHONE;
delete process.env.CALLMEBOT_APIKEY;
delete process.env.WHATSAPP_DIGEST_EMAIL;
delete process.env.RESEND_API_KEY;

const path = require('path');
const http = require('http');
const fs = require('fs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const HACE_MUCHO = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
let logInserts = [];

function fakeSql(strings, ...values) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('FROM users u') && text.includes('LEFT JOIN notification_preferences')) {
    const base = { created_at: HACE_MUCHO, whatsapp_opt_in: true, ultima_charla: null, ultimo_correo: null, ultimo_whatsapp: null, recordatorios_activos: true, frecuencia_dias: 14 };
    return Promise.resolve([
      Object.assign({ id: 10, email: 'a@example.com', name: 'María', username: 'maria', phone: '+57 300 111 2233' }, base),
      Object.assign({ id: 11, email: 'b@example.com', name: 'Jorge', username: 'jorge', phone: '3009998877' }, base), // sin código: se completa con 57
      Object.assign({ id: 12, email: 'c@example.com', name: 'Rota', username: 'rota', phone: '12345678' }, base), // sin código de país: inválido
      Object.assign({ id: 13, email: 'd@example.com', name: 'Rechazada', username: 'rechazada', phone: '+57 310 000 0000' }, base), // Meta la rechaza
    ]);
  }
  if (text.includes('FROM bitacoras b') && text.includes('archived_at IS NULL')) return Promise.resolve([]);
  if (text.includes('INSERT INTO whatsapp_reminder_log')) { logInserts.push(values); return Promise.resolve([]); }
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);

const pedidosAMeta = [];
const fetchOriginal = global.fetch;
global.fetch = async (url, opts = {}) => {
  const u = typeof url === 'string' ? url : (url && url.url) || String(url);
  if (u.startsWith('https://graph.facebook.com/')) {
    const body = JSON.parse(opts.body);
    pedidosAMeta.push({ url: u, auth: opts.headers && opts.headers.Authorization, body });
    if (body.to === '573100000000') {
      return new Response(JSON.stringify({ error: { code: 131026, message: 'Message undeliverable' } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.' + body.to }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return fetchOriginal(url, opts);
};

require.cache[require.resolve('@neondatabase/serverless')] = { id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true, exports: { neon: () => fakeSql } };
require.cache[require.resolve('@vercel/blob')] = { id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true, exports: { put: async () => ({ url: 'x' }), del: async () => {}, list: async () => ({ blobs: [], hasMore: false }), get: async () => null } };
require.cache[require.resolve('@anthropic-ai/sdk')] = { id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true, exports: class { constructor() {} } };

const app = require(serverPath);

function pedir(server, pth, headers) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path: pth, method: 'GET', headers: headers || {} }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, json }); });
    });
    r.on('error', reject); r.end();
  });
}

let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

(async () => {
  // El normalizador de números, tal cual está en server.js
  const src = fs.readFileSync(serverPath, 'utf8');
  const tel = new Function(src.slice(src.indexOf('function telefonoParaWhatsApp'), src.indexOf('async function enviarPlantillaWhatsApp')) + '; return telefonoParaWhatsApp;')();
  ok(tel('+57 300 111 2233') === '573001112233', 'número con +57 -> solo dígitos');
  ok(tel('300 111 2233') === '573001112233', 'celular colombiano sin código -> se completa con 57');
  ok(tel('0057 300 111 2233') === '573001112233', 'prefijo 00 -> se quita');
  ok(tel('12345678') === null && tel('') === null && tel(null) === null, 'sin código de país o vacío -> inválido');

  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));

  const r = await pedir(server, '/api/cron/reminders', { Authorization: 'Bearer secreto-de-prueba' });
  ok(r.status === 200 && r.json.ok === true, 'el cron corre -> 200');
  ok(pedidosAMeta.length === 3, 'se le pide a Meta enviar a los 3 números válidos (el inválido ni se intenta)');
  const maria = pedidosAMeta.find((p) => p.body.to === '573001112233');
  ok(!!maria && maria.url === 'https://graph.facebook.com/v21.0/123456789/messages', 'URL con el ID del número, recortado');
  ok(maria.auth === 'Bearer token-de-prueba', 'el token va como Bearer, recortado');
  ok(maria.body.type === 'template' && maria.body.template.name === 'recordatorio_bitacora' && maria.body.template.language.code === 'es_CO', 'usa la plantilla y el idioma por defecto');
  ok(maria.body.template.components[0].parameters[0].text === 'María', 'la plantilla lleva el nombre de la persona');
  ok(pedidosAMeta.some((p) => p.body.to === '573009998877'), 'el celular sin código se mandó con 57');
  ok(r.json.whatsappApi && r.json.whatsappApi.candidatos === 4 && r.json.whatsappApi.enviados === 2 && r.json.whatsappApi.fallidos === 2, 'resumen: 2 enviados, 2 fallidos (1 inválido, 1 rechazado)');
  ok(r.json.whatsappApi.motivos.some((m) => /Rechazada: HTTP 400 \(131026\)/.test(m)), 'el motivo del rechazo de Meta queda en la respuesta');
  ok(logInserts.length === 2 && logInserts.map((v) => v[0]).sort().join() === '10,11', 'solo se registran los que Meta aceptó (para que esperen su frecuencia)');
  ok(r.json.whatsapp.incluidos === 2, 'los 2 fallidos pasan al resumen manual de siempre');
  ok(r.json.correo.candidatos === 0, 'quien tiene WhatsApp activo no recibe correo');

  const sinSesion = await pedir(server, '/api/admin/whatsapp-reminders');
  ok(sinSesion.status === 401 || sinSesion.status === 403, 'el estado de admin sigue pidiendo sesión');
  ok(/api: WHATSAPP_API_ACTIVA/.test(src), 'admin informa si el envío automático está activo');

  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
