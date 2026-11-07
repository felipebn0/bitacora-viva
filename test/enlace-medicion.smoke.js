// Medición del enlace abierto: (1) el registro guarda de dónde llegó la persona (?desde=colaboracion) y descarta etiquetas raras;
// (2) el panel de admin recibe cuántos entraron por el enlace abierto, cuántos empezaron y cuántos terminaron un recuerdo.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';
delete process.env.RESEND_API_KEY;

const fs = require('fs');
const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const HASH = bcrypt.hashSync('miclave123', 4);
const origenes = [];
const consultas = [];
let siguiente = 10;
function fakeSql(strings, ...v) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) return Promise.resolve(v[0] === 'admin' ? [{ id: 1, username: 'admin', password_hash: HASH, token_version: 0 }] : []);
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) return Promise.resolve([{ owner_user_id: null, token_version: 0 }]);
  if (text.includes('SELECT is_admin FROM users WHERE id')) return Promise.resolve([{ is_admin: true }]);
  if (text.includes('SELECT id FROM users WHERE email =')) return Promise.resolve([]);
  if (text.includes('INSERT INTO users (username, name, email')) return Promise.resolve([{ id: siguiente++, username: v[0], token_version: 0 }]);
  if (text.includes('UPDATE users SET origen_registro')) { origenes.push(v[0]); return Promise.resolve([]); }
  if (text.includes('AS entraron')) { consultas.push(v); return Promise.resolve([{ entraron: 12, empezaron: 7, terminaron: 4, cuentas_nuevas: 2 }]); }
  if (text.includes('FROM invitados i') && text.includes('EXISTS')) {
    return Promise.resolve([
      { id: 'a', nombre: 'Ana Gómez', created_at: '2026-11-07T15:00:00Z', revocado_at: null, empezo: true, termino: true },
      { id: 'b', nombre: 'Luis Pérez', created_at: '2026-11-07T14:00:00Z', revocado_at: null, empezo: true, termino: false },
      { id: 'c', nombre: 'Sara Ruiz', created_at: '2026-11-07T13:00:00Z', revocado_at: '2026-11-07T16:00:00Z', empezo: false, termino: false },
    ]);
  }
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);
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
      res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(ch).toString()); } catch (e) { /* nada */ } resolve({ status: res.statusCode, headers: res.headers, json }); });
    });
    r.on('error', reject); if (datos) r.write(datos); r.end();
  });
}
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };
const registro = { name: 'maria perez', email: 'm@x.co', phone: '+57 300 123 4567', password: 'miclave123', acceptTerms: true };

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));

  let r = await pedir(server, 'POST', '/api/signup', { ...registro, origen: 'colaboracion' });
  ok(r.status === 200 && origenes.length === 1 && origenes[0] === 'colaboracion', 'el registro guarda de dónde llegó la persona («colaboracion»)');
  r = await pedir(server, 'POST', '/api/signup', { ...registro, email: 'n@x.co', origen: 'Colaboracion' });
  ok(origenes.length === 2 && origenes[1] === 'colaboracion', 'la etiqueta se guarda en minúsculas');
  r = await pedir(server, 'POST', '/api/signup', { ...registro, email: 'o@x.co', origen: '<script>alert(1)</script>' });
  ok(r.status === 200 && origenes.length === 2, 'una etiqueta con caracteres raros se descarta (el registro igual funciona)');
  r = await pedir(server, 'POST', '/api/signup', { ...registro, email: 'p@x.co' });
  ok(r.status === 200 && origenes.length === 2, 'sin etiqueta no se guarda nada');

  const login = await pedir(server, 'POST', '/api/login', { username: 'admin', password: 'miclave123' });
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  r = await pedir(server, 'GET', '/api/admin/enlace-abierto?start=2026-11-07&end=2026-11-07&tz=300', null, cookie);
  ok(r.status === 200 && r.json.entraron === 12 && r.json.empezaron === 7 && r.json.terminaron === 4 && r.json.cuentasNuevas === 2, 'el panel recibe cuántos entraron, empezaron y terminaron, y las cuentas nuevas');
  ok(r.json.ultimos.length === 3 && r.json.ultimos[0].termino === true && r.json.ultimos[1].empezo && !r.json.ultimos[1].termino && r.json.ultimos[2].cortado, 'y los últimos con su estado (terminó, empezó, acceso cortado)');
  ok(consultas[0] && consultas[0][0] === '2026-11-07T05:00:00.000Z' && consultas[0][1] === '2026-11-08T04:59:59.999Z', 'el día se cuenta con la hora de Colombia (tz=300)');
  r = await pedir(server, 'GET', '/api/admin/enlace-abierto', null, null);
  ok(r.status === 401, 'sin sesión no se ve (401)');

  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  ok(/id="enlaceWrap"/.test(html) && /cargarEnlace\(start, end\);/.test(html), 'el panel tiene la tarjeta del enlace abierto y se actualiza al cambiar el período');
  const landing = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  ok(/origen: \(window\.ecoOrigen && window\.ecoOrigen\(\)\) \|\| null/.test(landing) && /eco-origen\.js/.test(landing), 'la landing manda el origen al registrarse');
  const colab = fs.readFileSync(path.join(__dirname, '..', 'public', 'colaborar.html'), 'utf8');
  ok(/href="\/\?desde=colaboracion#registro"/.test(colab), 'el botón verde del cierre lleva la etiqueta desde=colaboracion');

  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
