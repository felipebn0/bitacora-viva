// Restablecer la clave CON remitente propio verificado: llega un enlace de un solo uso al correo y solo con ese
// enlace se puede cambiar la clave. Sin el enlace, nadie puede.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';
process.env.RESEND_API_KEY = 're_prueba';
process.env.RESEND_FROM = 'Eco <hola@mieco.app>';
// Un valor mal pegado en Vercel (con el nombre de la variable adentro) no debe romper el enlace del correo.
process.env.PUBLIC_BASE_URL = 'PUBLIC_BASE_URL=https://bitacora-viva.vercel.app';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const users = {
  1: { id: 1, username: 'paula@ejemplo.com', email: 'paula@ejemplo.com', name: 'Paula', password_hash: bcrypt.hashSync('claveVieja1', 4), token_version: 0 },
};
let resets = [];
const correos = [];
const contadores = {};
function fakeSql(strings, ...v) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('INSERT INTO rate_limits')) { contadores[v[0]] = (contadores[v[0]] || 0) + 1; return Promise.resolve([{ count: String(v[0]).startsWith('olvide:') ? contadores[v[0]] : 1 }]); }
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = Object.values(users).find((x) => x.username === v[0]);
    return Promise.resolve(u ? [{ id: u.id, username: u.username, password_hash: u.password_hash, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT id, email, name FROM users WHERE')) {
    const u = Object.values(users).find((x) => x.email === v[0] || x.username === v[1]);
    return Promise.resolve(u ? [{ id: u.id, email: u.email, name: u.name }] : []);
  }
  if (text.includes('DELETE FROM password_resets WHERE user_id')) { resets = resets.filter((x) => x.user_id !== v[0]); return Promise.resolve([]); }
  if (text.includes('INSERT INTO password_resets')) { resets.push({ token_hash: v[0], user_id: v[1], usado: false, vence: Date.now() + 30 * 60 * 1000 }); return Promise.resolve([]); }
  if (text.includes('SELECT 1 FROM password_resets WHERE token_hash')) {
    return Promise.resolve(resets.filter((x) => x.token_hash === v[0] && !x.usado && x.vence > Date.now()).map(() => ({ '?column?': 1 })));
  }
  if (text.includes('UPDATE password_resets SET used_at')) {
    const x = resets.find((y) => y.token_hash === v[0] && !y.usado && y.vence > Date.now());
    if (!x) return Promise.resolve([]);
    x.usado = true;
    return Promise.resolve([{ user_id: x.user_id }]);
  }
  if (text.includes('UPDATE users SET password_hash')) { const u = users[v[1]]; u.password_hash = v[0]; u.token_version += 1; return Promise.resolve([]); }
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);
const cache = (mod, exports) => { require.cache[require.resolve(mod)] = { id: require.resolve(mod), filename: require.resolve(mod), loaded: true, exports }; };
cache('@neondatabase/serverless', { neon: () => fakeSql });
cache('@vercel/blob', { put: async () => ({ url: 'x' }), del: async () => {}, list: async () => ({ blobs: [], hasMore: false }), get: async () => null });
cache('@anthropic-ai/sdk', class { constructor() {} });
const fetchReal = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).startsWith('https://api.resend.com/')) { correos.push(JSON.parse(opts.body)); return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) }; }
  return fetchReal(url, opts);
};
const app = require(serverPath);

function pedir(server, metodo, path_, body) {
  return new Promise((resolve, reject) => {
    const host = '127.0.0.1:' + server.address().port;
    const cuerpo = body ? JSON.stringify(body) : null;
    const headers = { Origin: 'http://' + host };
    if (cuerpo) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(cuerpo); }
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path: path_, method: metodo, headers }, (res) => {
      const ch = []; res.on('data', (x) => ch.push(x));
      res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(ch).toString()); } catch (e) { /* nada */ } resolve({ status: res.statusCode, json }); });
    });
    r.on('error', reject); if (cuerpo) r.write(cuerpo); r.end();
  });
}
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));

  let r = await pedir(server, 'GET', '/api/clave/estado');
  ok(r.status === 200 && r.json.porCorreo === true, 'con remitente propio, el cambio de clave por correo queda encendido');

  r = await pedir(server, 'POST', '/api/clave/restablecer', { token: 'a'.repeat(64), clave: 'claveNueva9', claveConfirmar: 'claveNueva9' });
  ok(r.status === 400 && bcrypt.compareSync('claveVieja1', users[1].password_hash), 'sin un enlace de verdad no se cambia ninguna clave');
  r = await pedir(server, 'POST', '/api/clave/restablecer', { usuario: 'paula@ejemplo.com', clave: 'claveNueva9', claveConfirmar: 'claveNueva9' });
  ok(r.status === 400 && bcrypt.compareSync('claveVieja1', users[1].password_hash), 'saber el correo de alguien no alcanza');

  r = await pedir(server, 'POST', '/api/clave/olvide', { correo: 'nadie@ejemplo.com' });
  ok(r.status === 200 && correos.length === 0, 'un correo sin cuenta recibe la misma respuesta y no se manda nada');
  r = await pedir(server, 'POST', '/api/clave/olvide', { correo: ' Paula@Ejemplo.com ' });
  ok(r.status === 200 && correos.length === 1 && correos[0].to[0] === 'paula@ejemplo.com' && correos[0].from === 'Eco <hola@mieco.app>', 'se envía el enlace al correo de la cuenta');
  const m = correos[0].html.match(/restablecer\.html\?t=([a-f0-9]{64})/);
  ok(!!m && /^https:\/\/mieco\.app\/restablecer\.html\?t=/.test(correos[0].html.match(/href="([^"]+)"/)[1]), 'el enlace es una dirección web completa que apunta a mieco.app aunque PUBLIC_BASE_URL venga mal pegada');
  const token = m && m[1];
  ok(/bgcolor="#4F5D3A"/.test(correos[0].html) && correos[0].html.split(m[0]).length >= 4, 'el botón tiene fondo que Outlook respeta y el enlace también aparece como texto de respaldo');
  ok(resets.length === 1 && resets[0].token_hash !== token, 'en la base solo se guarda el hash del código, no el código');

  r = await pedir(server, 'GET', '/api/clave/verificar?t=' + token);
  ok(r.json && r.json.valido === true, 'el enlace es válido');
  r = await pedir(server, 'POST', '/api/clave/restablecer', { token, clave: 'claveNueva9', claveConfirmar: 'otra' });
  ok(r.status === 400, 'si las dos claves no coinciden no cambia');
  r = await pedir(server, 'POST', '/api/clave/restablecer', { token, clave: 'claveNueva9', claveConfirmar: 'claveNueva9' });
  ok(r.status === 200 && bcrypt.compareSync('claveNueva9', users[1].password_hash) && users[1].token_version === 1, 'con el enlace la clave cambia y se cierran las sesiones viejas');
  r = await pedir(server, 'POST', '/api/clave/restablecer', { token, clave: 'robada1234', claveConfirmar: 'robada1234' });
  ok(r.status === 400 && bcrypt.compareSync('claveNueva9', users[1].password_hash), 'el enlace solo sirve una vez');
  r = await pedir(server, 'GET', '/api/clave/verificar?t=' + token);
  ok(r.json && r.json.valido === false, 'y ya no aparece como válido');

  await pedir(server, 'POST', '/api/clave/olvide', { correo: 'paula@ejemplo.com' });
  await pedir(server, 'POST', '/api/clave/olvide', { correo: 'paula@ejemplo.com' });
  r = await pedir(server, 'POST', '/api/clave/olvide', { correo: 'paula@ejemplo.com' });
  ok(r.status === 429, 'pedir muchos enlaces seguidos se frena (429)');

  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
