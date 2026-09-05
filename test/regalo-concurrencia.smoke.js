// Cubre la carrera en /api/billing/redeem-gift (P1 de seguridad, 2026-09-05):
// antes, el chequeo de "¿está usado?" era un SELECT separado del UPDATE
// final que lo marcaba como usado, con la actualización de subscriptions en
// el medio — dos pedidos con el MISMO código de regalo, en simultáneo,
// podían pasar el SELECT los dos antes de que cualquiera llegara al UPDATE,
// y las dos cuentas terminaban con 12 meses gratis por un solo código
// comprado una vez.
//
// El arreglo: el UPDATE que marca "usado" va primero y solo, con el filtro
// (WHERE redeemed_by_user_id IS NULL) adentro de la misma sentencia — de
// dos pedidos simultáneos, como mucho uno la gana.
//
// Node es de un solo hilo, así que no hay forma de reproducir una carrera
// de verdad contra una base real desde acá — pero si el fake de sql()
// resuelve la sentencia crítica con un `await` de por medio ANTES de leer y
// modificar el estado en memoria (en vez de hacerlo todo de un tirón,
// sincrónico), dos llamados en simultáneo (Promise.all) sí llegan a
// interleavearse en el orden equivocado si el código de la ruta no lo evita
// — que es exactamente la garantía que se espera de un solo UPDATE con
// WHERE en Postgres real. Este test verifica el resultado (nunca los dos
// ganan), no la mecánica interna del fake.
//
//   node test/regalo-concurrencia.smoke.js   (o parte de: npm test)

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';

const path = require('path');
const http = require('http');
const bcrypt = require(path.resolve(__dirname, '..', 'node_modules', 'bcryptjs'));

const serverPath = path.resolve(__dirname, '..', 'server.js');

const PASSWORD_HASH = bcrypt.hashSync('claveDePrueba123', 4);
const usersTable = [
  { id: 1, username: 'dueño@example.com', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null },
];
let gift = { id: 1, code: 'REGALO01', plan_id: 'regalo', redeemed_by_user_id: null };
const subscriptions = [];
let nextSubId = 1;

function esperarUnTurno() {
  // Un `await` real (no solo un Promise.resolve() ya resuelto) para forzar
  // que las dos llamadas en simultáneo lleguen efectivamente entrelazadas al
  // punto crítico, en vez de que la primera termine de punta a punta antes
  // de que la segunda arranque siquiera.
  return new Promise((resolve) => setImmediate(resolve));
}

async function fakeSql(strings, ...values) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return [];
  if (text.includes('rate_limits')) return [{ count: 1 }];
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) {
    const u = usersTable.find((x) => x.id === values[0]);
    return u ? [{ owner_user_id: u.owner_user_id, token_version: u.token_version }] : [];
  }
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = usersTable.find((x) => x.username === values[0]);
    return u ? [{ id: u.id, username: u.username, password_hash: u.password_hash, token_version: u.token_version }] : [];
  }

  // --- La sentencia crítica: el claim atómico ---
  if (text.includes('UPDATE gift_redemptions') && text.includes('redeemed_by_user_id = ') && text.includes('IS NULL')) {
    const [userId, code] = values;
    await esperarUnTurno(); // deja que la otra request también llegue hasta acá antes de decidir
    if (gift.code !== code || gift.redeemed_by_user_id !== null) return [];
    gift = { ...gift, redeemed_by_user_id: userId };
    return [{ id: gift.id, plan_id: gift.plan_id }];
  }
  if (text.includes('SELECT redeemed_by_user_id FROM gift_redemptions WHERE code')) {
    return gift.code === values[0] ? [{ redeemed_by_user_id: gift.redeemed_by_user_id }] : [];
  }
  if (text.includes('SELECT id FROM subscriptions WHERE user_id')) {
    const s = subscriptions.find((x) => x.user_id === values[0]);
    return s ? [{ id: s.id }] : [];
  }
  if (text.includes('INSERT INTO subscriptions')) {
    const [userId, planId] = values;
    subscriptions.push({ id: nextSubId++, user_id: userId, plan_id: planId });
    return [];
  }
  if (text.includes('UPDATE subscriptions SET plan_id')) {
    return [];
  }
  return [];
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

async function loginComo(server, username) {
  const resp = await request(server, { path: '/api/login', method: 'POST', body: { username, password: 'claveDePrueba123' } });
  if (resp.status !== 200) throw new Error(`No se pudo loguear ${username}: ${resp.status} ${resp.body}`);
  const raw = resp.headers['set-cookie'][0].split(';')[0];
  const idx = raw.indexOf('=');
  return `${raw.slice(0, idx)}=${raw.slice(idx + 1)}`;
}

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`OK  - ${name}`); }
  else { failed++; console.log(`FAIL - ${name}`); }
}

async function main() {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));

  // Dos cuentas DISTINTAS, mismo código de regalo — el escenario más grave:
  // dos personas se llevan el regalo con un solo código comprado una vez.
  usersTable.push({ id: 2, username: 'persona2@example.com', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null });
  const cookie1 = await loginComo(server, 'dueño@example.com');
  const cookie2 = await loginComo(server, 'persona2@example.com');

  const [r1, r2] = await Promise.all([
    request(server, { path: '/api/billing/redeem-gift', method: 'POST', headers: { Cookie: cookie1 }, body: { code: 'regalo01' } }),
    request(server, { path: '/api/billing/redeem-gift', method: 'POST', headers: { Cookie: cookie2 }, body: { code: 'regalo01' } }),
  ]);

  const exitosos = [r1, r2].filter((r) => r.status === 200);
  const rechazados = [r1, r2].filter((r) => r.status === 400);
  check('de dos canjes simultáneos con el mismo código, gana exactamente uno (antes: podían ganar los dos)', exitosos.length === 1);
  check('el otro se rechaza con "ya se usó" (400), no con un error 500 ni un 200 falso', rechazados.length === 1 && JSON.parse(rechazados[0].body).error === 'Ese código ya se usó.');
  check('solo se creó UNA suscripción (no dos cuentas con el mismo regalo)', subscriptions.length === 1);
  check('el código quedó marcado como usado por una de las dos cuentas (1 ó 2), no sigue libre', gift.redeemed_by_user_id === 1 || gift.redeemed_by_user_id === 2);
  check('la cuenta que ganó es la misma que quedó con la suscripción', subscriptions.length === 1 && subscriptions[0].user_id === gift.redeemed_by_user_id);

  // Un tercer intento con el mismo código, ya usado -> 400 normal, sin carrera de por medio.
  const cookie3 = await (async () => {
    usersTable.push({ id: 3, username: 'persona3@example.com', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null });
    return loginComo(server, 'persona3@example.com');
  })();
  const r3 = await request(server, { path: '/api/billing/redeem-gift', method: 'POST', headers: { Cookie: cookie3 }, body: { code: 'regalo01' } });
  check('un tercer intento con el código ya usado -> 400, no revive la carrera', r3.status === 400 && JSON.parse(r3.body).error === 'Ese código ya se usó.');

  // Código que no existe -> 404, sin tocar nada.
  const r4 = await request(server, { path: '/api/billing/redeem-gift', method: 'POST', headers: { Cookie: cookie3 }, body: { code: 'NOEXISTE' } });
  check('código inexistente -> 404', r4.status === 404);

  server.close();
  console.log(`\n${passed} pasaron, ${failed} fallaron`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
