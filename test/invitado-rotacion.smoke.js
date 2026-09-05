// Cubre el segundo P1 de seguridad (2026-09-05): rotar el código de
// invitación (/api/invite-code/regenerate) no expulsaba a quien ya había
// entrado como invitado sin cuenta (/api/guest-start) con el código viejo
// — esa sesión de invitado (hasta 30 días) seguía funcionando intacta,
// justo lo contrario de lo que la rotación dice que hace ("cerrar esa
// puerta" para un código que se filtró).
//
// El arreglo: el código queda firmado DENTRO del token de invitado (no solo
// se usa para encontrar al dueño y olvidarse de él), y requireAuth lo
// compara contra el invite_code ACTUAL del dueño en cada pedido — no contra
// si la cuenta dueña sigue existiendo nomás, que es lo único que se
// chequeaba antes.
//
// Importante: esto es solo para el modo invitado sin cuenta. Una cuenta
// colaboradora de verdad (con clave, registrada vía /api/signup) NO debe
// verse afectada por rotar el código — su acceso depende de la fila en
// "collaborations"/owner_user_id, no del código en sí (eso es a propósito,
// ver el comentario en /api/invite-code/regenerate). Este test cubre las
// dos cosas: que el invitado SÍ se corta, y que la cuenta colaboradora NO.
//
//   node test/invitado-rotacion.smoke.js   (o parte de: npm test)

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';

const path = require('path');
const http = require('http');
const bcrypt = require(path.resolve(__dirname, '..', 'node_modules', 'bcryptjs'));

const serverPath = path.resolve(__dirname, '..', 'server.js');

const PASSWORD_HASH = bcrypt.hashSync('claveDePrueba123', 4);
const usersTable = [
  // El dueño, con su código de familia inicial.
  { id: 1, username: 'dueño@example.com', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null, invite_code: 'CODIGO01', name: 'Dueño' },
  // Una cuenta colaboradora YA registrada con ese código — no debería
  // verse afectada por la rotación.
  { id: 2, username: 'colaboradora@example.com', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: 1, name: 'Colaboradora' },
];

function fakeSql(strings, ...values) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = usersTable.find((x) => x.username === values[0]);
    return Promise.resolve(u ? [{ id: u.id, username: u.username, password_hash: u.password_hash, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) {
    const u = usersTable.find((x) => x.id === values[0]);
    return Promise.resolve(u ? [{ owner_user_id: u.owner_user_id, token_version: u.token_version }] : []);
  }
  // resolveProfileUserId(), rama de cuenta colaboradora fija (no invitado):
  // consulta aparte, sin token_version.
  if (text.includes('SELECT owner_user_id FROM users WHERE id') && !text.includes('token_version')) {
    const u = usersTable.find((x) => x.id === values[0]);
    return Promise.resolve(u ? [{ owner_user_id: u.owner_user_id }] : []);
  }
  // /api/collaboration-info: nombre a mostrar del dueño.
  if (text.includes('SELECT name, username FROM users WHERE id')) {
    const u = usersTable.find((x) => x.id === values[0]);
    return Promise.resolve(u ? [{ name: u.name, username: u.username }] : []);
  }
  // Chequeo de sesión de invitado en requireAuth: ahora también trae invite_code.
  if (text.includes('SELECT id, invite_code FROM users WHERE id') && text.includes('owner_user_id IS NULL')) {
    const u = usersTable.find((x) => x.id === values[0] && x.owner_user_id === null);
    return Promise.resolve(u ? [{ id: u.id, invite_code: u.invite_code }] : []);
  }
  // /api/guest-code-info y /api/guest-start miran esto para encontrar al dueño por código.
  if (text.includes('SELECT id, name, username FROM users WHERE invite_code') && text.includes('owner_user_id IS NULL')) {
    const u = usersTable.find((x) => x.invite_code === values[0] && x.owner_user_id === null);
    return Promise.resolve(u ? [{ id: u.id, name: u.name, username: u.username }] : []);
  }
  if (text.includes('UPDATE users SET invite_code')) {
    const [code, userId] = values;
    const u = usersTable.find((x) => x.id === userId);
    if (u) u.invite_code = code;
    return Promise.resolve([]);
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
    const r = http.request({ hostname: '127.0.0.1', port: server.address().port, path: opts.path, method: opts.method || 'GET', headers }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

function cookieDe(resp) {
  const raw = resp.headers['set-cookie'][0].split(';')[0];
  const idx = raw.indexOf('=');
  return `${raw.slice(0, idx)}=${raw.slice(idx + 1)}`;
}

async function loginComo(server, username) {
  const resp = await request(server, { path: '/api/login', method: 'POST', body: { username, password: 'claveDePrueba123' } });
  if (resp.status !== 200) throw new Error(`No se pudo loguear ${username}: ${resp.status} ${resp.body}`);
  return cookieDe(resp);
}

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`OK  - ${name}`); }
  else { failed++; console.log(`FAIL - ${name}`); }
}

async function main() {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));

  // --- Invitado sin cuenta, entra con el código original ---
  const guestStart = await request(server, { path: '/api/guest-start', method: 'POST', body: { codigo: 'CODIGO01', name: 'Invitado' } });
  check('el invitado puede entrar con el código vigente', guestStart.status === 200);
  const guestCookie = cookieDe(guestStart);

  // Confirma que el acceso funciona ANTES de rotar (para no probar solo el
  // caso negativo — si esto fallara, el resto del test no probaría nada real).
  const antesDeRotar = await request(server, { path: '/api/collaboration-info?owner=1', method: 'GET', headers: { Cookie: guestCookie } });
  check('antes de rotar el código, el invitado accede normalmente', antesDeRotar.status === 200);

  // --- El dueño rota el código ---
  const dueñoCookie = await loginComo(server, 'dueño@example.com');
  const rotar = await request(server, { path: '/api/invite-code/regenerate', method: 'POST', headers: { Cookie: dueñoCookie } });
  check('el dueño puede rotar su código', rotar.status === 200);
  const nuevoCodigo = JSON.parse(rotar.body).code;
  check('el código nuevo es distinto del viejo', nuevoCodigo !== 'CODIGO01');

  // --- La sesión de invitado vieja tiene que caer ---
  const despuesDeRotar = await request(server, { path: '/api/collaboration-info?owner=1', method: 'GET', headers: { Cookie: guestCookie } });
  check('después de rotar, la sesión de invitado con el código viejo queda cortada (401) — antes: seguía funcionando 30 días más', despuesDeRotar.status === 401);

  // --- Un invitado nuevo, con el código nuevo, sí puede entrar ---
  const guestStart2 = await request(server, { path: '/api/guest-start', method: 'POST', body: { codigo: nuevoCodigo, name: 'Invitado Nuevo' } });
  check('un invitado que entra con el código NUEVO sí funciona', guestStart2.status === 200);
  const guestCookie2 = cookieDe(guestStart2);
  const accesoNuevo = await request(server, { path: '/api/collaboration-info?owner=1', method: 'GET', headers: { Cookie: guestCookie2 } });
  check('y ese invitado nuevo accede normalmente', accesoNuevo.status === 200);

  // --- Control: una cuenta colaboradora YA registrada (no invitado sin
  // cuenta) NO se ve afectada por rotar el código — eso es a propósito. ---
  const colabCookie = await loginComo(server, 'colaboradora@example.com');
  const accesoColaboradora = await request(server, { path: '/api/collaboration-info?owner=1', method: 'GET', headers: { Cookie: colabCookie } });
  check('una cuenta colaboradora YA registrada sigue accediendo tras rotar el código (a propósito, no es un invitado)', accesoColaboradora.status === 200);

  server.close();
  console.log(`\n${passed} pasaron, ${failed} fallaron`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
