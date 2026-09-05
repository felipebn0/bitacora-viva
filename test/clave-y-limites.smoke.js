// Dos cosas chicas del mismo audit de seguridad (2026-09-05), juntas en un
// solo archivo porque las dos tocan rutas de autenticación/rate limit:
//
// 1) Tope de 72 bytes en la clave, en las tres rutas que hashean con
//    bcrypt (/api/register, /api/signup, /api/change-password). bcrypt
//    corta en silencio cualquier byte después del 72 — sin este chequeo,
//    dos claves que coincidan en esos primeros 72 bytes hashean igual. Se
//    mide en BYTES (Buffer.byteLength), no en .length: con tildes o "ñ" un
//    carácter ocupa 2 bytes en UTF-8 aunque cuente como 1 en .length, así
//    que una clave de 37 "ñ" (37 en .length, bien por debajo de 72) en
//    realidad son 74 bytes — el caso que prueba que medir por .length
//    hubiera sido un error.
//
// 2) El 429 de "demasiados pedidos" ahora manda el header Retry-After, en
//    las dos rutas que pueden devolverlo: el límite por IP (rateLimit,
//    todas las rutas) y el límite por cuenta que ya estaba activo en
//    /api/change-password (el de /api/login existe pero sigue apagado a
//    propósito, no se toca).
//
//   node test/clave-y-limites.smoke.js   (o parte de: npm test)

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.SETUP_KEY = process.env.SETUP_KEY || 'clave-de-configuracion-de-prueba';

const path = require('path');
const http = require('http');
const bcrypt = require(path.resolve(__dirname, '..', 'node_modules', 'bcryptjs'));

const serverPath = path.resolve(__dirname, '..', 'server.js');

const PASSWORD_HASH = bcrypt.hashSync('claveDePrueba123', 4);
const usersTable = [
  { id: 1, username: 'personadeprueba', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null },
];
let nextId = 2;

// Simula la tabla rate_limits de verdad (ventanas + contador), no un
// "siempre count:1" — si no, ninguna de las pruebas de Retry-After podría
// llegar nunca a un 429.
const rateLimitsStore = new Map();
function insertarORenovar(key, windowStart) {
  const existing = rateLimitsStore.get(key);
  const count = existing && existing.windowStart === windowStart ? existing.count + 1 : 1;
  rateLimitsStore.set(key, { windowStart, count });
  return count;
}

function fakeSql(strings, ...values) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('DELETE FROM rate_limits')) return Promise.resolve([]);
  if (text.includes('INSERT INTO rate_limits')) {
    const [key, windowStart] = values;
    return Promise.resolve([{ count: insertarORenovar(key, windowStart) }]);
  }
  if (text.includes('SELECT id FROM users WHERE username')) {
    const found = usersTable.find((u) => u.username === values[0]);
    return Promise.resolve(found ? [{ id: found.id }] : []);
  }
  if (text.includes('INSERT INTO users')) {
    const [username, passwordHash] = values;
    const row = { id: nextId++, username, password_hash: passwordHash, token_version: 0, owner_user_id: null };
    usersTable.push(row);
    return Promise.resolve([{ id: row.id }]);
  }
  if (text.includes('SELECT id FROM users WHERE email') && text.includes('OR username')) {
    return Promise.resolve([]);
  }
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = usersTable.find((x) => x.username === values[0]);
    return Promise.resolve(u ? [{ id: u.id, username: u.username, password_hash: u.password_hash, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) {
    const u = usersTable.find((x) => x.id === values[0]);
    return Promise.resolve(u ? [{ owner_user_id: u.owner_user_id, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT password_hash FROM users WHERE id')) {
    const u = usersTable.find((x) => x.id === values[0]);
    return Promise.resolve(u ? [{ password_hash: u.password_hash }] : []);
  }
  return Promise.resolve([]);
}
fakeSql.transaction = (queries) => Promise.all(queries);

require.cache[require.resolve('@neondatabase/serverless')] = { id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true, exports: { neon: () => fakeSql } };
require.cache[require.resolve('@vercel/blob')] = { id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true, exports: { put: async () => ({ url: 'https://fake.public.blob.vercel-storage.com/x' }), del: async () => {}, get: async () => null } };
require.cache[require.resolve('@anthropic-ai/sdk')] = { id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true, exports: class FakeAnthropic { constructor() {} } };

const app = require(serverPath);

function request(server, opts) {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : null;
    const headers = Object.assign({}, opts.headers || {});
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const host = `127.0.0.1:${server.address().port}`;
    if (!headers['Origin']) headers['Origin'] = `http://${host}`;
    if (opts.ip) headers['X-Forwarded-For'] = opts.ip;
    const r = http.request({ hostname: '127.0.0.1', port: server.address().port, path: opts.path, method: opts.method || 'GET', headers }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`OK  - ${name}`); }
  else { failed++; console.log(`FAIL - ${name}`); }
}

async function main() {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));

  // --- 1) Tope de 72 bytes ---

  // /api/register: 73 bytes ASCII -> rechazado.
  const rLarga = await request(server, { path: '/api/register', method: 'POST', body: {
    username: 'usuariolargo', password: 'a'.repeat(73), setupKey: process.env.SETUP_KEY,
  } });
  check('register: clave de 73 bytes ASCII -> 400 (demasiado larga)', rLarga.status === 400 && /larga/.test(JSON.parse(rLarga.body).error));

  // /api/register: exactamente 72 bytes ASCII -> se acepta.
  const r72 = await request(server, { path: '/api/register', method: 'POST', body: {
    username: 'usuario72bytes', password: 'a'.repeat(72), setupKey: process.env.SETUP_KEY,
  } });
  check('register: clave de exactamente 72 bytes -> se acepta (200)', r72.status === 200);

  // /api/signup: 37 "ñ" -> .length=37 (pasaría un chequeo por .length), pero
  // en bytes UTF-8 son 74 (ñ = 2 bytes) -> tiene que rechazarse igual.
  const claveConTildes = 'ñ'.repeat(37);
  check('la clave de prueba tiene .length=37 pero 74 bytes en UTF-8 (así se arma el caso)', claveConTildes.length === 37 && Buffer.byteLength(claveConTildes, 'utf8') === 74);
  const rTildes = await request(server, { path: '/api/signup', method: 'POST', body: {
    name: 'Alguien', email: 'alguien@example.com', password: claveConTildes, accountType: 'owner',
  } });
  check('signup: clave de 37 "ñ" (74 bytes, no 37) -> 400 — medir por .length la hubiera dejado pasar', rTildes.status === 400 && /larga/.test(JSON.parse(rTildes.body).error));

  // /api/change-password: mismo tope.
  const loginResp = await request(server, { path: '/api/login', method: 'POST', body: { username: 'personadeprueba', password: 'claveDePrueba123' }, ip: '10.0.0.1' });
  const raw = loginResp.headers['set-cookie'][0].split(';')[0];
  const idx = raw.indexOf('=');
  const cookie = `${raw.slice(0, idx)}=${raw.slice(idx + 1)}`;
  const rCambioLarga = await request(server, { path: '/api/change-password', method: 'POST', headers: { Cookie: cookie }, ip: '10.0.0.2', body: {
    currentPassword: 'claveDePrueba123', newPassword: 'b'.repeat(80),
  } });
  check('change-password: clave nueva de 80 bytes -> 400 (demasiado larga)', rCambioLarga.status === 400 && /larga/.test(JSON.parse(rCambioLarga.body).error));

  // --- 2) Retry-After en el 429 ---

  // Límite por IP (30/minuto): una IP dedicada para no interferir con las
  // requests de arriba, 31 pedidos seguidos a un endpoint liviano que sí
  // tiene rateLimit en su cadena (/api/logout NO lo tiene, por eso no sirve
  // para esta prueba — el 429 lo pone el middleware, antes de que la ruta
  // en sí haga nada, así que no importa que el código no exista).
  const ipDedicada = '10.0.0.99';
  let ultimo;
  for (let i = 0; i < 31; i++) {
    ultimo = await request(server, { path: '/api/guest-code-info?codigo=LOTEST', method: 'GET', ip: ipDedicada });
  }
  check('al pasar el límite por IP, el pedido 31 es 429', ultimo.status === 429);
  check('ese 429 trae el header Retry-After, con un número de segundos positivo', !!ultimo.headers['retry-after'] && Number(ultimo.headers['retry-after']) > 0);

  // Límite por cuenta en /api/change-password (10 cada 15 min): 11 intentos
  // con la clave actual mal puesta (para no gastar el tope de 72 bytes ni
  // cambiar la clave de verdad) desde una IP dedicada distinta.
  let ultimoCambio;
  for (let i = 0; i < 11; i++) {
    ultimoCambio = await request(server, { path: '/api/change-password', method: 'POST', headers: { Cookie: cookie }, ip: '10.0.0.100', body: {
      currentPassword: 'claveIncorrecta', newPassword: 'unaClaveNuevaOk',
    } });
  }
  check('al pasar el límite por cuenta en change-password, el intento 11 es 429', ultimoCambio.status === 429);
  check('ese 429 también trae Retry-After', !!ultimoCambio.headers['retry-after'] && Number(ultimoCambio.headers['retry-after']) > 0);

  server.close();
  console.log(`\n${passed} pasaron, ${failed} fallaron`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
