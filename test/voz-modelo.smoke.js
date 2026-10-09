// Smoke test del modelo de voz de ElevenLabs en POST /api/speak: por defecto
// usa v4 Turbo; si ese modelo falla, reintenta UNA vez con Flash v2.5 (no
// cae a la voz robótica); si fallan los dos, responde 500. El valor se lee
// al cargar server.js, por eso las variables se fijan antes del require.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';
process.env.ELEVENLABS_API_KEY = '  clave-de-prueba \n'; // con espacios a propósito: se recortan
process.env.ELEVENLABS_VOICE_ID = ' voz123\n';
delete process.env.ELEVENLABS_MODEL_ID;

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const HASH = bcrypt.hashSync('miclave123', 4);
const users = {
  1: { id: 1, username: 'duena', password_hash: HASH, token_version: 0, owner_user_id: null, is_admin: true },
  2: { id: 2, username: 'normal', password_hash: HASH, token_version: 0, owner_user_id: null, is_admin: false },
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
  if (text.includes('SELECT is_admin FROM users')) return Promise.resolve([{ is_admin: users[values[0]].is_admin }]);
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);

// Qué modelos pidió el servidor, y cuáles hacemos fallar.
const modelosPedidos = [];
let fallan = new Set();
let urlPedida = null;
let llavePedida = null;
const fetchOriginal = global.fetch;
global.fetch = async (url, opts = {}) => {
  const u = typeof url === 'string' ? url : (url && url.url) || String(url);
  if (u.startsWith('https://api.elevenlabs.io/v1/text-to-speech/')) {
    const body = JSON.parse(opts.body);
    modelosPedidos.push(body.model_id);
    urlPedida = u;
    llavePedida = opts.headers && opts.headers['xi-api-key'];
    if (fallan.has(body.model_id)) return new Response('modelo caído', { status: 500 });
    return new Response(Buffer.from('audio-falso'), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
  }
  return fetchOriginal(url, opts);
};

require.cache[require.resolve('@neondatabase/serverless')] = { id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true, exports: { neon: () => fakeSql } };
require.cache[require.resolve('@vercel/blob')] = { id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true, exports: { put: async () => ({ url: 'x' }), del: async () => {}, get: async () => null, list: async () => ({ blobs: [], hasMore: false }) } };
require.cache[require.resolve('@anthropic-ai/sdk')] = { id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true, exports: class { constructor() {} } };

const app = require(serverPath);

function hablar(server, cookie, texto) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ text: texto });
    const host = '127.0.0.1:' + server.address().port;
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/speak', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Origin: 'http://' + host, Cookie: cookie } }, (res) => {
      const ch = []; res.on('data', (c) => ch.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(ch).toString(), type: res.headers['content-type'] }));
    });
    r.on('error', reject); r.write(data); r.end();
  });
}
async function login(server, username = 'duena') {
  const data = JSON.stringify({ username, password: 'miclave123' });
  return new Promise((resolve, reject) => {
    const host = '127.0.0.1:' + server.address().port;
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/login', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Origin: 'http://' + host } }, (res) => {
      const ch = []; res.on('data', (c) => ch.push(c)); res.on('end', () => resolve(res.headers['set-cookie'][0].split(';')[0]));
    });
    r.on('error', reject); r.write(data); r.end();
  });
}

function pedirJson(server, cookie, pth) {
  return new Promise((resolve, reject) => {
    const host = '127.0.0.1:' + server.address().port;
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path: pth, method: 'GET', headers: { Origin: 'http://' + host, Cookie: cookie } }, (res) => {
      const ch = []; res.on('data', (c) => ch.push(c)); res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(ch).toString()); } catch (e) {} resolve({ status: res.statusCode, json: j }); });
    });
    r.on('error', reject); r.end();
  });
}

let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  const cookie = await login(server);

  const r1 = await hablar(server, cookie, 'Hola, cuéntame más.');
  ok(r1.status === 200 && r1.type === 'audio/mpeg', 'por defecto responde audio');
  ok(modelosPedidos.length === 1 && modelosPedidos[0] === 'eleven_v4_turbo', 'el modelo por defecto es eleven_v4_turbo');
  ok(urlPedida.endsWith('/voz123') && llavePedida === 'clave-de-prueba', 'la llave y el voice ID se recortan (sin espacios ni saltos de línea)');

  modelosPedidos.length = 0;
  fallan = new Set(['eleven_v4_turbo']);
  const r2 = await hablar(server, cookie, 'Otra frase.');
  ok(r2.status === 200 && r2.type === 'audio/mpeg', 'si v4 Turbo falla, igual responde audio de ElevenLabs');
  ok(modelosPedidos.join(',') === 'eleven_v4_turbo,eleven_flash_v2_5', 'reintenta una sola vez, y con Flash v2.5');

  modelosPedidos.length = 0;
  fallan = new Set(['eleven_v4_turbo', 'eleven_flash_v2_5']);
  const r3 = await hablar(server, cookie, 'Una más.');
  ok(r3.status === 500, 'si fallan los dos modelos -> 500 (no se queda colgado)');
  ok(modelosPedidos.length === 2, 'no reintenta más de una vez');

  // --- Diagnóstico de la voz (solo admin) ---
  const normal = await login(server, 'normal');
  const d0 = await pedirJson(server, normal, '/api/admin/voz-debug');
  ok(d0.status === 403, 'voz-debug: una cuenta que no es admin -> 403');

  modelosPedidos.length = 0;
  fallan = new Set(['eleven_v4_turbo']);
  const d1 = await pedirJson(server, cookie, '/api/admin/voz-debug');
  ok(d1.status === 200 && d1.json.proveedorQueSeUsa === 'elevenlabs' && d1.json.modelo === 'eleven_v4_turbo', 'voz-debug: dice qué proveedor y modelo se usan');
  ok(d1.json.pruebas.length === 4 && d1.json.pruebas[0].voz === 'femenina' && d1.json.pruebas[0].ok === false && /500/.test(d1.json.pruebas[0].error) && d1.json.pruebas[1].ok === true && d1.json.pruebas[2].voz === 'masculina' && d1.json.pruebas[3].ok === true, 'voz-debug: prueba los dos modelos con cada voz (femenina y masculina) y devuelve el error exacto del que falla');
  ok(!JSON.stringify(d1.json).includes('clave-de-prueba') && d1.json.voiceIdTerminaEn === 'z123', 'voz-debug: nunca devuelve la llave; solo las últimas 4 letras del voice ID');

  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
