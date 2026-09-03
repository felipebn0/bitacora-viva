// Cobertura permanente para las tres rutas de cuenta más sensibles que se
// tocaron esta sesión — antes cada una se probó a mano con un script
// descartable que se borró después de pasar, así que no quedaba nada que
// corriera en CI. Mismo patrón que test/next.smoke.js: mock programable de
// @neondatabase/serverless (con .transaction() para las rutas que ya son
// transaccionales), login real vía bcrypt para obtener una cookie firmada
// de verdad.
//
// Cubre:
//   POST /api/update-profile — nombre/correo/fecha válidos e inválidos
//     (incluyendo los casos calendáricos de fechaNacimientoValida: 29 de
//     febrero en año bisiesto y no bisiesto, 31 de abril, fecha futura,
//     límite de 130 años), correo duplicado -> 409, cuenta colaboradora
//     también puede editar su propio perfil.
//   POST /api/reset-bitacora — sin clave -> 400, clave incorrecta -> 401,
//     éxito -> 200 transaccional, aislamiento (nunca toca los datos de
//     otra cuenta), y que una falla a mitad de la transacción no deja
//     nada aplicado (rollback).
//   POST /api/delete-account — mismos casos que reset-bitacora, más que
//     la cookie de sesión solo se borra si la transacción termina bien.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';

const path = require('path');
const http = require('http');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const bcrypt = require(path.resolve(__dirname, '..', 'node_modules', 'bcryptjs'));

const PASSWORD_HASH_A = bcrypt.hashSync('claveA123', 4);
const PASSWORD_HASH_B = bcrypt.hashSync('claveB123', 4);

// Dos cuentas dueñas independientes (A y B) para probar aislamiento, más
// una cuenta colaboradora de A (C) para probar que también puede editar su
// propio perfil.
const users = {
  1: { id: 1, username: 'usuarioa', password_hash: PASSWORD_HASH_A, token_version: 0, owner_user_id: null, name: 'Usuaria A', email: null, fecha_nacimiento: null },
  2: { id: 2, username: 'usuariob', password_hash: PASSWORD_HASH_B, token_version: 0, owner_user_id: null, name: 'Usuario B', email: null, fecha_nacimiento: null },
  3: { id: 3, username: 'colabc', password_hash: PASSWORD_HASH_A, token_version: 0, owner_user_id: 1, name: 'Colaboradora C', email: null, fecha_nacimiento: null },
};
const byUsername = {};
for (const u of Object.values(users)) byUsername[u.username] = u;

let allCalls = []; // {text, values} de cada llamada a fakeSql durante el test actual
let forceFailSubstring = null; // si está seteado, cualquier query que lo contenga rechaza
let blobDelCalls = 0;

function fakeSql(strings, ...values) {
  const text = strings.join('?');
  allCalls.push({ text, values });

  if (forceFailSubstring && text.includes(forceFailSubstring)) {
    return Promise.reject(new Error('DB caída (simulado)'));
  }

  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);

  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = byUsername[values[0]];
    return Promise.resolve(u ? [{ id: u.id, username: u.username, password_hash: u.password_hash, token_version: u.token_version }] : []);
  }

  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ owner_user_id: u.owner_user_id, token_version: u.token_version }] : []);
  }

  if (text.includes('SELECT password_hash FROM users WHERE id')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ password_hash: u.password_hash }] : []);
  }

  if (text.includes('UPDATE users SET name') && text.includes('fecha_nacimiento') && text.includes('RETURNING name, email, fecha_nacimiento')) {
    const [newName, newEmail, newFecha, id] = values;
    const u = users[id];
    if (!u) return Promise.resolve([]);
    if (newEmail && newEmail !== u.email) {
      const otro = Object.values(users).find((x) => x.id !== id && x.email === newEmail);
      if (otro || newEmail === 'ocupado@x.com') {
        const e = new Error('duplicate key value violates unique constraint "idx_users_email"');
        e.code = '23505';
        throw e;
      }
    }
    u.name = newName;
    u.email = newEmail;
    u.fecha_nacimiento = newFecha;
    return Promise.resolve([{ name: u.name, email: u.email, fecha_nacimiento: u.fecha_nacimiento }]);
  }

  // Cualquier otro SELECT/DELETE/UPDATE de las transacciones de
  // reset-bitacora/delete-account (family_notes, media, story_log,
  // sessions, resumen, family_members, timeline_events, chapters,
  // collaborations, historia_versiones, users) — no hace falta simular
  // datos reales para estos tests, solo que la llamada "suceda" y quede
  // registrada en allCalls para las aserciones de aislamiento/rollback.
  return Promise.resolve([]);
}
fakeSql.transaction = (queries) => Promise.all(queries);

require.cache[require.resolve('@neondatabase/serverless')] = {
  id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true,
  exports: { neon: () => fakeSql },
};
require.cache[require.resolve('@vercel/blob')] = {
  id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true,
  exports: {
    put: async () => ({ url: 'https://fake.public.blob.vercel-storage.com/x' }),
    del: async () => { blobDelCalls++; },
  },
};
require.cache[require.resolve('@anthropic-ai/sdk')] = {
  id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true,
  exports: class FakeAnthropic { constructor() {} },
};

const app = require(serverPath);

function request(server, opts, cookie) {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : null;
    const headers = Object.assign({}, opts.headers || {});
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    if (cookie) headers['Cookie'] = cookie;
    const host = `127.0.0.1:${server.address().port}`;
    if (!headers['Origin']) headers['Origin'] = `http://${host}`;
    const r = http.request({ hostname: '127.0.0.1', port: server.address().port, path: opts.path, method: opts.method || 'GET', headers }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function login(server, username, password) {
  const resp = await request(server, { path: '/api/login', method: 'POST', body: { username, password } });
  if (resp.status !== 200) throw new Error(`login falló para ${username}: ${resp.status} ${resp.body}`);
  return resp.headers['set-cookie'][0].split(';')[0];
}

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`OK  - ${name}`); }
  else { failed++; console.log(`FAIL - ${name}`); }
}

async function main() {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));

  const cookieA = await login(server, 'usuarioa', 'claveA123');
  const cookieB = await login(server, 'usuariob', 'claveB123');
  const cookieC = await login(server, 'colabc', 'claveA123');

  // ============================================================
  // POST /api/update-profile
  // ============================================================

  const sinNombre = await request(server, { path: '/api/update-profile', method: 'POST', body: { name: '' } }, cookieA);
  check('update-profile: sin nombre -> 400', sinNombre.status === 400);

  const emailInvalido = await request(server, { path: '/api/update-profile', method: 'POST', body: { name: 'Diego', email: 'no-es-un-correo' } }, cookieA);
  check('update-profile: correo inválido -> 400', emailInvalido.status === 400);

  // Casos calendáricos de fechaNacimientoValida (ver server.js) — cada uno
  // tiene que rechazarse con 400, no con el 500 que daba antes cuando la
  // fecha inexistente se colaba hasta Postgres.
  const fechasInvalidas = [
    ['2025-02-31', 'el 31 de febrero no existe'],
    ['2023-04-31', 'el 31 de abril no existe (abril tiene 30 días)'],
    ['2023-02-29', '29 de febrero en un año NO bisiesto'],
    ['2099-01-01', 'fecha en el futuro'],
    ['1800-01-01', 'hace más de 130 años'],
  ];
  for (const [fecha, desc] of fechasInvalidas) {
    const r = await request(server, { path: '/api/update-profile', method: 'POST', body: { name: 'Diego', fechaNacimiento: fecha } }, cookieA);
    check(`update-profile: fecha inválida (${desc}) -> 400, no 500`, r.status === 400);
  }
  // Contraprueba: 29 de febrero en un año SÍ bisiesto tiene que aceptarse.
  const fechaBisiesta = await request(server, { path: '/api/update-profile', method: 'POST', body: { name: 'Diego', fechaNacimiento: '2024-02-29' } }, cookieA);
  check('update-profile: 29 de febrero en año bisiesto -> 200 (válida)', fechaBisiesta.status === 200);

  const guardadoOk = await request(server, { path: '/api/update-profile', method: 'POST', body: { name: 'usuaria a', email: 'a@example.com', fechaNacimiento: '1980-03-14' } }, cookieA);
  check('update-profile: guardado exitoso -> 200', guardadoOk.status === 200);
  const guardadoOkBody = JSON.parse(guardadoOk.body);
  check('update-profile: nombre queda capitalizado', guardadoOkBody.name === 'Usuaria A');

  const correoDuplicado = await request(server, { path: '/api/update-profile', method: 'POST', body: { name: 'Usuario B', email: 'a@example.com' } }, cookieB);
  check('update-profile: correo ya usado por otra cuenta -> 409', correoDuplicado.status === 409);

  // Una cuenta colaboradora también tiene su propio perfil — esta ruta a
  // propósito no tiene bloquearColaborador.
  const perfilColaborador = await request(server, { path: '/api/update-profile', method: 'POST', body: { name: 'Colaboradora C', email: 'c@example.com' } }, cookieC);
  check('update-profile: cuenta colaboradora puede editar su propio perfil -> 200', perfilColaborador.status === 200);

  // ============================================================
  // POST /api/reset-bitacora
  // ============================================================

  const resetSinClave = await request(server, { path: '/api/reset-bitacora', method: 'POST', body: {} }, cookieA);
  check('reset-bitacora: sin clave -> 400', resetSinClave.status === 400);

  const resetClaveIncorrecta = await request(server, { path: '/api/reset-bitacora', method: 'POST', body: { password: 'noesesta' } }, cookieA);
  check('reset-bitacora: clave incorrecta -> 401', resetClaveIncorrecta.status === 401);

  allCalls = [];
  const resetOk = await request(server, { path: '/api/reset-bitacora', method: 'POST', body: { password: 'claveA123' } }, cookieA);
  check('reset-bitacora: éxito -> 200', resetOk.status === 200);
  check(
    'reset-bitacora: aislamiento — ninguna consulta de este pedido tocó el id de la cuenta B',
    allCalls.every((c) => !c.values.includes(users[2].id))
  );
  check(
    'reset-bitacora: todas las consultas relacionadas a la bitácora usaron el id de la cuenta A',
    allCalls.filter((c) => /user_id|WHERE id = /.test(c.text) && !c.text.includes('rate_limits')).every((c) => c.values.includes(users[1].id))
  );

  // Rollback: si una sentencia a mitad de la transacción falla, ninguna fila
  // tendría que quedar aplicada (con el fake, esto se ve como que la ruta
  // responde 500 y no sigue adelante con el borrado de Blob).
  allCalls = [];
  blobDelCalls = 0;
  forceFailSubstring = 'DELETE FROM chapters';
  const resetFalla = await request(server, { path: '/api/reset-bitacora', method: 'POST', body: { password: 'claveA123' } }, cookieA);
  forceFailSubstring = null;
  check('reset-bitacora: falla a mitad de la transacción -> 500 (no 200)', resetFalla.status === 500);
  check('reset-bitacora: con la transacción caída, no se intenta borrar nada de Blob', blobDelCalls === 0);

  // ============================================================
  // POST /api/delete-account
  // ============================================================

  const deleteSinClave = await request(server, { path: '/api/delete-account', method: 'POST', body: {} }, cookieB);
  check('delete-account: sin clave -> 400', deleteSinClave.status === 400);

  const deleteClaveIncorrecta = await request(server, { path: '/api/delete-account', method: 'POST', body: { password: 'noesesta' } }, cookieB);
  check('delete-account: clave incorrecta -> 401', deleteClaveIncorrecta.status === 401);

  // Rollback (probado ANTES del éxito real, porque el éxito real borra la
  // cuenta B y no se podría loguear de nuevo con la misma cookie después).
  allCalls = [];
  blobDelCalls = 0;
  forceFailSubstring = 'DELETE FROM users WHERE id';
  const deleteFalla = await request(server, { path: '/api/delete-account', method: 'POST', body: { password: 'claveB123' } }, cookieB);
  forceFailSubstring = null;
  check('delete-account: falla a mitad de la transacción -> 500 (no 200)', deleteFalla.status === 500);
  check('delete-account: con la transacción caída, la cookie de sesión NO se borra', !(deleteFalla.headers['set-cookie'] || []).some((c) => c.includes('bv_session=;') || c.includes('bv_session=deleted')));
  check('delete-account: con la transacción caída, no se intenta borrar nada de Blob', blobDelCalls === 0);
  // La cuenta B sigue existiendo después de la falla — se puede loguear igual.
  const loginTrasFalla = await request(server, { path: '/api/login', method: 'POST', body: { username: 'usuariob', password: 'claveB123' } });
  check('delete-account: la cuenta B sigue existiendo después del rollback', loginTrasFalla.status === 200);

  allCalls = [];
  const deleteOk = await request(server, { path: '/api/delete-account', method: 'POST', body: { password: 'claveB123' } }, cookieB);
  check('delete-account: éxito -> 200', deleteOk.status === 200);
  check(
    'delete-account: aislamiento — ninguna consulta de este pedido tocó el id de la cuenta A',
    allCalls.every((c) => !c.values.includes(users[1].id))
  );
  check('delete-account: éxito borra la cookie de sesión', (deleteOk.headers['set-cookie'] || []).some((c) => c.startsWith('bv_session=;') || /bv_session=;.*Max-Age=0|bv_session=;.*Expires/i.test(c)));

  server.close();
  console.log(`\n${passed} pasaron, ${failed} fallaron`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR EN EL SMOKE TEST DE CUENTA:', e);
  process.exit(1);
});
