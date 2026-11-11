// Arreglos de la auditoría del 11 de noviembre de 2026:
// PRI-02  borrar un capítulo retira su QR y su audio público.
// AUTH-01 el feedback solo se asocia a una charla de la propia bitácora (y no revela si una charla ajena existe).
// OPS     el diagnóstico del esquema (GET) es de solo lectura; aplicarlo es un POST aparte, solo para admins.
// UI-01   el libro compartido deja cargar sus propias fuentes (font-src 'self').
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const HASH = bcrypt.hashSync('miclave123', 4);
const users = {
  1: { id: 1, username: 'ana', is_admin: false },
  2: { id: 2, username: 'beto', is_admin: false },
  3: { id: 3, username: 'admin', is_admin: true },
};
const sesiones = [{ id: 501, user_id: 1 }, { id: 777, user_id: 2 }];
const capitulos = [{ id: 10, user_id: 1 }, { id: 20, user_id: 2 }];
const enlacesQR = [{ token: 'qr-ana-10', owner_id: 1, chapter_id: 10, revoked: false }, { token: 'qr-beto-20', owner_id: 2, chapter_id: 20, revoked: false }];
const feedback = [];
let transacciones = 0;
function fakeSql(strings, ...v) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = Object.values(users).find((x) => x.username === v[0]);
    return Promise.resolve(u ? [{ id: u.id, username: u.username, password_hash: HASH, token_version: 0 }] : []);
  }
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) return Promise.resolve(users[v[0]] ? [{ owner_user_id: null, token_version: 0 }] : []);
  if (text.includes('SELECT is_admin FROM users WHERE id')) return Promise.resolve(users[v[0]] ? [{ is_admin: users[v[0]].is_admin }] : []);
  if (text.includes('SELECT version FROM schema_meta')) return Promise.resolve([{ version: 'otra' }]);
  if (text.includes('DELETE FROM chapters WHERE id =')) {
    const i = capitulos.findIndex((c) => c.id === v[0] && c.user_id === v[1]);
    if (i < 0) return Promise.resolve([]);
    capitulos.splice(i, 1);
    return Promise.resolve([{ id: v[0] }]);
  }
  if (text.includes('UPDATE book_audio_links SET revoked_at')) {
    enlacesQR.filter((e) => e.owner_id === v[0] && e.chapter_id === v[1]).forEach((e) => { e.revoked = true; });
    return Promise.resolve([]);
  }
  if (text.includes('SELECT id FROM sessions WHERE id =')) return Promise.resolve(sesiones.filter((s) => s.id === v[0] && s.user_id === v[1]).map((s) => ({ id: s.id })));
  if (text.includes('INSERT INTO session_feedback')) { feedback.push({ user_id: v[0], session_id: v[1], rating: v[2] }); return Promise.resolve([]); }
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => { transacciones++; return Promise.resolve(q.map(() => [])); };
const cache = (mod, exports) => { require.cache[require.resolve(mod)] = { id: require.resolve(mod), filename: require.resolve(mod), loaded: true, exports }; };
cache('@neondatabase/serverless', { neon: () => fakeSql });
cache('@vercel/blob', { put: async () => ({ url: 'x' }), del: async () => {}, list: async () => ({ blobs: [], hasMore: false }), get: async () => null });
cache('@anthropic-ai/sdk', class { constructor() {} });
const app = require(path.resolve(__dirname, '..', 'server.js'));

function pedir(server, metodo, ruta, cuerpo, cookie) {
  return new Promise((resolve, reject) => {
    const host = '127.0.0.1:' + server.address().port;
    const datos = cuerpo ? JSON.stringify(cuerpo) : null;
    const headers = { Origin: 'http://' + host };
    if (datos) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(datos); }
    if (cookie) headers.Cookie = cookie;
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path: ruta, method: metodo, headers }, (res) => {
      const ch = []; res.on('data', (x) => ch.push(x));
      res.on('end', () => { let json = null; const body = Buffer.concat(ch).toString(); try { json = JSON.parse(body); } catch (e) { /* nada */ } resolve({ status: res.statusCode, headers: res.headers, json, body }); });
    });
    r.on('error', reject); if (datos) r.write(datos); r.end();
  });
}
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  const entrar = async (u) => (await pedir(server, 'POST', '/api/login', { username: u, password: 'miclave123' })).headers['set-cookie'][0].split(';')[0];
  const ana = await entrar('ana');
  const beto = await entrar('beto');
  const admin = await entrar('admin');

  console.log('--- PRI-02: borrar capítulo retira su QR y audio ---');
  let r = await pedir(server, 'DELETE', '/api/chapters/10', null, ana);
  ok(r.status === 200 && !capitulos.some((c) => c.id === 10), 'Ana borra su capítulo');
  ok(enlacesQR.find((e) => e.token === 'qr-ana-10').revoked, 'y su QR/audio queda retirado: el enlace ya no abre');
  ok(!enlacesQR.find((e) => e.token === 'qr-beto-20').revoked, 'el QR de otra cuenta no se toca');
  r = await pedir(server, 'DELETE', '/api/chapters/20', null, ana);
  ok(r.status === 404 && capitulos.some((c) => c.id === 20) && !enlacesQR.find((e) => e.token === 'qr-beto-20').revoked, 'Ana no puede borrar ni retirar el capítulo de Beto (404)');

  console.log('--- AUTH-01: feedback solo de una charla propia ---');
  r = await pedir(server, 'POST', '/api/session-feedback', { rating: 'bien', sessionDbId: 501 }, ana);
  ok(r.status === 200 && feedback.at(-1).session_id === 501, 'Ana califica su propia charla');
  const antes = feedback.length;
  r = await pedir(server, 'POST', '/api/session-feedback', { rating: 'mal', sessionDbId: 777 }, ana);
  const ajena = r;
  ok(r.status === 400 && feedback.length === antes, 'Ana no puede calificar la charla de Beto (400) y no se guarda nada');
  r = await pedir(server, 'POST', '/api/session-feedback', { rating: 'mal', sessionDbId: 999999 }, ana);
  ok(r.status === 400 && feedback.length === antes, 'una charla que no existe tampoco (400)');
  ok(ajena.body === r.body, 'la respuesta es idéntica: no revela si la charla ajena existe');
  r = await pedir(server, 'POST', '/api/session-feedback', { rating: 'regular', sessionDbId: 'abc' }, ana);
  ok(r.status === 400 && feedback.length === antes, 'un id que no es número se rechaza');
  r = await pedir(server, 'POST', '/api/session-feedback', { rating: 'regular' }, ana);
  ok(r.status === 200 && feedback.at(-1).session_id === null, 'sin id de charla se guarda sin asociar (como antes)');

  console.log('--- diagnóstico del esquema ---');
  const t0 = transacciones;
  r = await pedir(server, 'GET', '/api/admin/esquema', null, admin);
  ok(r.status === 200 && r.json.alDia === false && typeof r.json.msRevision === 'number' && !('msCompleto' in r.json), 'el GET responde el estado');
  ok(transacciones === t0, 'y NO aplica el esquema (solo lectura)');
  r = await pedir(server, 'GET', '/api/admin/esquema?medir=1', null, admin);
  ok(transacciones === t0, 'ni siquiera con ?medir=1');
  r = await pedir(server, 'POST', '/api/admin/esquema/aplicar', {}, admin);
  ok(r.status === 200 && transacciones === t0 + 1 && typeof r.json.msCompleto === 'number', 'aplicarlo es un POST aparte, solo para admins');
  r = await pedir(server, 'POST', '/api/admin/esquema/aplicar', {}, beto);
  ok(r.status === 403 && transacciones === t0 + 1, 'un usuario común no puede aplicarlo (403)');

  console.log('--- UI-01: fuentes del libro compartido ---');
  r = await pedir(server, 'GET', '/libro/' + 'a'.repeat(48), null, null);
  const csp = r.headers['content-security-policy'] || '';
  ok(/font-src 'self'/.test(csp), 'la política del libro compartido permite sus propias fuentes (' + (csp.match(/font-src[^;]*/) || [''])[0] + ')');

  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
