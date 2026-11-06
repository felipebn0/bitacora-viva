// Restablecer la clave SIN remitente propio de correo: queda apagado. Antes bastaba con saber el correo de alguien
// para cambiarle la clave y quedarse con su cuenta; ahora nadie puede cambiar ninguna clave desde la web.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';
delete process.env.RESEND_API_KEY;
delete process.env.RESEND_FROM;

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const users = {
  1: { id: 1, username: 'paula@ejemplo.com', email: 'paula@ejemplo.com', password_hash: bcrypt.hashSync('claveVieja1', 4), token_version: 0, is_admin: false },
};
let cambiosDeClave = 0;
function fakeSql(strings, ...v) {
  const text = strings.join('?');
  if (text.includes('UPDATE users SET password_hash')) { cambiosDeClave++; return Promise.resolve([]); }
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = Object.values(users).find((x) => x.username === v[0]);
    return Promise.resolve(u ? [{ id: u.id, username: u.username, password_hash: u.password_hash, token_version: u.token_version }] : []);
  }
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);
const cache = (mod, exports) => { require.cache[require.resolve(mod)] = { id: require.resolve(mod), filename: require.resolve(mod), loaded: true, exports }; };
cache('@neondatabase/serverless', { neon: () => fakeSql });
cache('@vercel/blob', { put: async () => ({ url: 'x' }), del: async () => {}, list: async () => ({ blobs: [], hasMore: false }), get: async () => null });
cache('@anthropic-ai/sdk', class { constructor() {} });
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
  ok(r.status === 200 && r.json.porCorreo === false && /felipebnisperuza@hotmail\.com/.test(r.json.mensaje), 'sin remitente propio, la página sabe que debe pedir ayuda y dice a qué correo escribir');

  r = await pedir(server, 'POST', '/api/clave/restablecer', { usuario: 'paula@ejemplo.com', clave: 'claveNueva9', claveConfirmar: 'claveNueva9' });
  ok(r.status === 503 && /Escríbenos/.test(r.json.error), 'saber el correo de alguien ya no sirve para cambiarle la clave (503)');
  ok(cambiosDeClave === 0 && bcrypt.compareSync('claveVieja1', users[1].password_hash), 'la clave de Paula no cambió');

  r = await pedir(server, 'POST', '/api/clave/olvide', { correo: 'paula@ejemplo.com' });
  ok(r.status === 503, 'pedir el enlace tampoco funciona todavía (no hay correo propio)');
  r = await pedir(server, 'POST', '/api/clave/restablecer', { token: 'a'.repeat(64), clave: 'claveNueva9', claveConfirmar: 'claveNueva9' });
  ok(r.status === 503 && cambiosDeClave === 0, 'un token inventado tampoco cambia nada');

  r = await pedir(server, 'POST', '/api/login', { username: 'paula@ejemplo.com', password: 'claveVieja1' });
  ok(r.status === 200, 'entrar con la clave de siempre sigue funcionando');

  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
