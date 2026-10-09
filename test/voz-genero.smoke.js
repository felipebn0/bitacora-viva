// Dos voces para la entrevistadora (2026-10-09): cada persona elige "Femenina" o
// "Masculina" en Opciones avanzadas > Voz. Cubre: /api/speak usa el voice ID de la
// voz elegida (femenina = ELEVENLABS_VOICE_ID, masculina = la otra, por defecto
// 57D8YIbQSuE3REDPO6Vm), valores raros caen a la femenina, el respaldo de modelo
// conserva la voz, GET/POST /api/voz (guardar en la cuenta o en el subperfil, valida,
// colaboradores no), el prompt cambia el género de la IA, y la pantalla.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';
process.env.ELEVENLABS_API_KEY = 'clave-de-prueba';
process.env.ELEVENLABS_VOICE_ID = 'VOZFEMENINA123';
delete process.env.ELEVENLABS_VOICE_ID_MASCULINA;
delete process.env.ELEVENLABS_MODEL_ID;

const fs = require('fs');
const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const HASH = bcrypt.hashSync('miclave123', 4);
const users = {
  1: { id: 1, username: 'duena', password_hash: HASH, token_version: 0, owner_user_id: null, voz: null },
  2: { id: 2, username: 'colab', password_hash: HASH, token_version: 0, owner_user_id: 1, voz: null },
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
  if (text.includes('SELECT name AS nombre, fecha_nacimiento, created_at, tratamiento, voz FROM users WHERE id')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ nombre: u.username, fecha_nacimiento: null, created_at: null, tratamiento: null, voz: u.voz }] : []);
  }
  if (text.includes('UPDATE users SET voz')) {
    const [voz, id] = values;
    if (!users[id]) return Promise.resolve([]);
    users[id].voz = voz;
    return Promise.resolve([{ id }]);
  }
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);

const pedidos = [];
const fetchOriginal = global.fetch;
let fallaMasculinaTurbo = false;
global.fetch = async (url, opts = {}) => {
  const u = typeof url === 'string' ? url : (url && url.url) || String(url);
  if (u.startsWith('https://api.elevenlabs.io/v1/text-to-speech/')) {
    const body = JSON.parse(opts.body);
    pedidos.push({ voiceId: u.split('/').pop(), model: body.model_id });
    if (fallaMasculinaTurbo && u.endsWith('57D8YIbQSuE3REDPO6Vm') && body.model_id === 'eleven_v4_turbo') return new Response('caída', { status: 500 });
    return new Response(Buffer.from('audio-falso'), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
  }
  return fetchOriginal(url, opts);
};

require.cache[require.resolve('@neondatabase/serverless')] = { id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true, exports: { neon: () => fakeSql } };
require.cache[require.resolve('@vercel/blob')] = { id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true, exports: { put: async () => ({ url: 'x' }), del: async () => {}, get: async () => null, list: async () => ({ blobs: [], hasMore: false }) } };
require.cache[require.resolve('@anthropic-ai/sdk')] = { id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true, exports: class { constructor() {} } };

const app = require(serverPath);

function pedir(server, opts, cookie) {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : null;
    const host = '127.0.0.1:' + server.address().port;
    const headers = { Origin: 'http://' + host };
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    if (cookie) headers.Cookie = cookie;
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path: opts.path, method: opts.method || 'GET', headers }, (res) => {
      const ch = []; res.on('data', (c) => ch.push(c)); res.on('end', () => { const b = Buffer.concat(ch).toString(); let json = null; try { json = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, json, body: b, headers: res.headers }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
async function login(server, username) {
  const r = await pedir(server, { path: '/api/login', method: 'POST', body: { username, password: 'miclave123' } });
  return r.headers['set-cookie'][0].split(';')[0];
}

let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  const cookie = await login(server, 'duena');
  const cookieColab = await login(server, 'colab');

  // --- /api/speak elige el voice ID ---
  const hablar = async (body) => { pedidos.length = 0; const r = await pedir(server, { path: '/api/speak', method: 'POST', body }, cookie); return r; };
  let r = await hablar({ text: 'Hola.' });
  ok(r.status === 200 && pedidos[0].voiceId === 'VOZFEMENINA123', 'sin "voz": usa la voz femenina de siempre');
  r = await hablar({ text: 'Hola.', voz: 'femenina' });
  ok(pedidos[0].voiceId === 'VOZFEMENINA123', 'voz femenina -> ELEVENLABS_VOICE_ID');
  r = await hablar({ text: 'Hola.', voz: 'masculina' });
  ok(r.status === 200 && pedidos[0].voiceId === '57D8YIbQSuE3REDPO6Vm', 'voz masculina -> 57D8YIbQSuE3REDPO6Vm');
  r = await hablar({ text: 'Hola.', voz: 'robot' });
  ok(pedidos[0].voiceId === 'VOZFEMENINA123', 'un valor raro cae a la voz femenina');
  fallaMasculinaTurbo = true;
  r = await hablar({ text: 'Hola.', voz: 'masculina' });
  ok(r.status === 200 && pedidos.map((p) => p.model + '@' + p.voiceId.slice(-3)).join(',') === 'eleven_v4_turbo@6Vm,eleven_flash_v2_5@6Vm', 'si falla v4 Turbo, el respaldo (Flash) sigue con la MISMA voz masculina');
  fallaMasculinaTurbo = false;

  // --- GET/POST /api/voz ---
  r = await pedir(server, { path: '/api/voz' }, cookie);
  ok(r.status === 200 && r.json.voz === 'femenina', 'GET /api/voz: sin elegir -> femenina');
  r = await pedir(server, { path: '/api/voz', method: 'POST', body: { voz: 'masculina' } }, cookie);
  ok(r.status === 200 && r.json.voz === 'masculina' && users[1].voz === 'masculina', 'POST /api/voz masculina -> se guarda en la cuenta');
  r = await pedir(server, { path: '/api/voz' }, cookie);
  ok(r.json.voz === 'masculina', 'GET /api/voz devuelve lo guardado');
  r = await pedir(server, { path: '/api/voz', method: 'POST', body: { voz: 'otra' } }, cookie);
  ok(r.status === 400 && users[1].voz === 'masculina', 'POST /api/voz con un valor inválido -> 400 y no cambia nada');
  r = await pedir(server, { path: '/api/voz', method: 'POST', body: { voz: 'femenina' } }, cookieColab);
  ok(r.status === 403 && users[1].voz === 'masculina', 'una cuenta colaboradora no cambia la voz de la bitácora -> 403');
  r = await pedir(server, { path: '/api/voz', method: 'POST', body: { voz: 'femenina' } });
  ok(r.status === 401, 'sin sesión -> 401');

  // --- el género de la IA sigue a la voz ---
  const src = fs.readFileSync(serverPath, 'utf8');
  const bloque = src.slice(src.indexOf('function vozValida'), src.indexOf('function instruccionEntrevistador'));
  const fn = new Function(bloque + src.slice(src.indexOf('function instruccionEntrevistador'), src.indexOf('\n}\n', src.indexOf('function instruccionEntrevistador')) + 3) + '; return instruccionEntrevistador;')();
  ok(/entrevistador \(hombre\)/.test(fn('masculina')) && !/entrevistadora \(mujer\)/.test(fn('masculina')), 'voz masculina: la IA habla de sí misma en masculino');
  ok(/entrevistadora \(mujer\)/.test(fn('femenina')) && /entrevistadora \(mujer\)/.test(fn(null)), 'voz femenina (o sin elegir): en femenino, como siempre');
  ok(/instruccionEntrevistador\(perfil && perfil\.voz\)/.test(src) && /instruccionEntrevistador\(familiaCtx && familiaCtx\.voz\)/.test(src), 'la charla normal y la del árbol llevan esa instrucción');

  // --- la pantalla ---
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'app.html'), 'utf8');
  ok(/id="vozGeneroSelect"/.test(html) && /<option value="femenina">Femenina<\/option>/.test(html) && /<option value="masculina">Masculina<\/option>/.test(html), 'Opciones avanzadas > Voz: solo Femenina y Masculina');
  ok(!/id="voiceSelect"/.test(html), 'ya no está el selector de voces del navegador');
  ok(/body: JSON\.stringify\(\{ text: texto, voz: vozElegida \}\)/.test(html) && /fetch\('\/api\/voz'/.test(html), 'la app manda la voz elegida con cada audio y la guarda en la cuenta');

  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
