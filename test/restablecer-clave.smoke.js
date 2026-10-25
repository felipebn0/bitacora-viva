// Restablecer la clave (versión simple, sin verificar la dueña: BACKLOG #22). Lo que SÍ protege:
// cuentas de administrador excluidas, tope de intentos, sesiones viejas cerradas.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const users = {
  1: { id: 1, username: 'paula@ejemplo.com', email: 'paula@ejemplo.com', password_hash: bcrypt.hashSync('claveVieja1', 4), token_version: 0, is_admin: false, owner_user_id: null },
  2: { id: 2, username: 'felipe', email: 'felipe@ejemplo.com', password_hash: bcrypt.hashSync('claveAdmin1', 4), token_version: 0, is_admin: true, owner_user_id: null },
};
const contadores = {};
function fakeSql(strings, ...v) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('INSERT INTO rate_limits')) { contadores[v[0]] = (contadores[v[0]] || 0) + 1; return Promise.resolve([{ count: String(v[0]).startsWith('restablecer:') ? contadores[v[0]] : 1 }]); }
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = Object.values(users).find((x) => x.username === v[0]);
    return Promise.resolve(u ? [{ id: u.id, username: u.username, password_hash: u.password_hash, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) { const u = users[v[0]]; return Promise.resolve(u ? [{ owner_user_id: null, token_version: u.token_version }] : []); }
  if (text.includes('SELECT id, is_admin FROM users WHERE username')) {
    const u = Object.values(users).find((x) => x.username === v[0] || (x.email && x.email.toLowerCase() === v[1]));
    return Promise.resolve(u ? [{ id: u.id, is_admin: u.is_admin }] : []);
  }
  if (text.includes('UPDATE users SET password_hash')) { const u = users[v[1]]; u.password_hash = v[0]; u.token_version += 1; return Promise.resolve([]); }
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);
const cache = (mod, exports) => { require.cache[require.resolve(mod)] = { id: require.resolve(mod), filename: require.resolve(mod), loaded: true, exports }; };
cache('@neondatabase/serverless', { neon: () => fakeSql });
cache('@vercel/blob', { put: async () => ({ url: 'x' }), del: async () => {}, list: async () => ({ blobs: [], hasMore: false }), get: async () => null });
cache('@anthropic-ai/sdk', class { constructor() {} });
const app = require(serverPath);

function pedir(server, path_, body) {
  return new Promise((resolve, reject) => {
    const host = '127.0.0.1:' + server.address().port;
    const cuerpo = JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path: path_, method: 'POST', headers: { Origin: 'http://' + host, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(cuerpo) } }, (res) => {
      const ch = []; res.on('data', (x) => ch.push(x));
      res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(ch).toString()); } catch (e) { /* nada */ } resolve({ status: res.statusCode, json }); });
    });
    r.on('error', reject); r.write(cuerpo); r.end();
  });
}
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  const ir = (extra) => pedir(server, '/api/clave/restablecer', Object.assign({ usuario: 'paula@ejemplo.com', clave: 'claveNueva9', claveConfirmar: 'claveNueva9' }, extra));

  let r = await ir({ claveConfirmar: 'otraDistinta' });
  ok(r.status === 400 && /no coinciden/.test(r.json.error), 'si las dos claves no coinciden no cambia nada');
  r = await ir({ clave: '123', claveConfirmar: '123' });
  ok(r.status === 400 && /6 caracteres/.test(r.json.error), 'menos de 6 caracteres se rechaza');
  r = await ir({ clave: 'x'.repeat(80), claveConfirmar: 'x'.repeat(80) });
  ok(r.status === 400, 'una clave demasiado larga se rechaza');
  r = await ir({ usuario: '' });
  ok(r.status === 400, 'sin correo o usuario se rechaza');
  r = await ir({ usuario: 'nadie@ejemplo.com' });
  ok(r.status === 404, 'una cuenta que no existe da error claro (404)');
  ok(bcrypt.compareSync('claveVieja1', users[1].password_hash), 'hasta aquí la clave de Paula sigue siendo la vieja');

  r = await ir({ usuario: ' Paula@Ejemplo.com ' });
  ok(r.status === 200 && bcrypt.compareSync('claveNueva9', users[1].password_hash), 'con el correo (sin importar mayúsculas) y dos claves iguales, la clave cambia');
  ok(users[1].token_version === 1, 'y se cierran las sesiones abiertas con la clave vieja');
  r = await pedir(server, '/api/login', { username: 'paula@ejemplo.com', password: 'claveNueva9' });
  ok(r.status === 200, 'puede entrar con la clave nueva');
  r = await pedir(server, '/api/login', { username: 'paula@ejemplo.com', password: 'claveVieja1' });
  ok(r.status === 401, 'y la vieja ya no entra');

  r = await ir({ usuario: 'felipe', clave: 'hackeada99', claveConfirmar: 'hackeada99' });
  ok(r.status === 403 && bcrypt.compareSync('claveAdmin1', users[2].password_hash), 'la cuenta de administrador NO se puede restablecer así (403)');
  r = await ir({ usuario: 'felipe@ejemplo.com', clave: 'hackeada99', claveConfirmar: 'hackeada99' });
  ok(r.status === 403 && bcrypt.compareSync('claveAdmin1', users[2].password_hash), 'ni usando su correo');

  for (let i = 0; i < 4; i++) await ir({ usuario: 'paula@ejemplo.com' });
  r = await ir({ usuario: 'paula@ejemplo.com' });
  ok(r.status === 429, 'después de varios intentos seguidos con la misma cuenta se frena (429)');

  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
