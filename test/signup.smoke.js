// Smoke test para /api/signup — sin cobertura hasta ahora (nada llamaba a
// esta ruta desde ningún test).
//
// Nace de un bug reportado (P1): el modo "colaborador vs. dueño" se
// inferría solo mirando si vino un código de familia no vacío — así que si
// alguien elegía "Unirme con un código" en index.html pero el campo
// quedaba vacío al mandar el formulario, el pedido llegaba sin código y el
// servidor lo interpretaba como una cuenta DUEÑA nueva (con su propia
// bitácora vacía, sin ninguna relación con la familia a la que quería
// sumarse) — sin ningún error, la cuenta se creaba igual, mal.
//
// El arreglo: el front ahora manda accountType ('owner' | 'collaborator')
// explícito, y el servidor exige el código SOLO Y SIEMPRE que
// accountType==='collaborator', sin importar qué (o nada) haya mandado el
// navegador en inviteCode. Estos tests cubren las cuatro combinaciones.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';

const path = require('path');
const http = require('http');

const serverPath = path.resolve(__dirname, '..', 'server.js');

let usersTable = [
  // Cuenta dueña ya existente, con código de familia — para probar
  // "unirme con código" contra un código real.
  { id: 1, username: 'mama@example.com', name: 'Mamá', email: 'mama@example.com', password_hash: 'x', owner_user_id: null, token_version: 0, invite_code: 'B46NWEC7' },
];
let nextId = 2;

function fakeSql(strings, ...values) {
  const text = strings.join('?');

  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);

  if (text.includes('SELECT id FROM users WHERE email') && text.includes('OR username')) {
    const [email1, email2] = values;
    const found = usersTable.find((u) => u.email === email1 || u.username === email2);
    return Promise.resolve(found ? [{ id: found.id }] : []);
  }
  if (text.includes('SELECT id FROM users WHERE invite_code')) {
    const found = usersTable.find((u) => u.invite_code === values[0]);
    return Promise.resolve(found ? [{ id: found.id }] : []);
  }
  if (text.includes('INSERT INTO users')) {
    const [username, name, email, phone, passwordHash, ownerUserId, signupVariant, termsVersion] = values;
    const row = { id: nextId++, username, name, email, phone, password_hash: passwordHash, owner_user_id: ownerUserId, signup_variant: signupVariant ?? null, terms_version: termsVersion ?? null, token_version: 0, invite_code: null };
    usersTable.push(row);
    return Promise.resolve([{ id: row.id, username: row.username, token_version: row.token_version }]);
  }

  return Promise.resolve([]);
}
fakeSql.transaction = (queries) => Promise.all(queries);

require.cache[require.resolve('@neondatabase/serverless')] = {
  id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true,
  exports: { neon: () => fakeSql },
};
require.cache[require.resolve('@vercel/blob')] = {
  id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true,
  exports: { put: async () => ({ url: 'https://fake.public.blob.vercel-storage.com/x' }), del: async () => {}, get: async () => null },
};
require.cache[require.resolve('@anthropic-ai/sdk')] = {
  id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true,
  exports: class FakeAnthropic { constructor() {} get messages() { return { create: async () => { throw new Error('no debería llamarse a la IA en /api/signup'); } }; } },
};

const app = require(serverPath);

function request(server, opts) {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : null;
    const headers = Object.assign({}, opts.headers || {});
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
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

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`OK  - ${name}`); }
  else { failed++; console.log(`FAIL - ${name}`); }
}

async function main() {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));

  // --- 1) El bug reportado: modo colaborador, código vacío -> ya NO crea una cuenta dueña suelta ---
  const antesDeIntentar = usersTable.length;
  const r1 = await request(server, { path: '/api/signup', method: 'POST', body: {
    name: 'Diego', email: 'diego1@example.com', password: 'miclave123', inviteCode: '', accountType: 'collaborator', acceptTerms: true,
  } });
  check('colaborador sin código -> 400 (antes: 200 y creaba cuenta dueña)', r1.status === 400);
  check('colaborador sin código -> no se creó ninguna cuenta', usersTable.length === antesDeIntentar);

  // --- 2) Modo colaborador con un código que no existe -> 400, tampoco crea nada ---
  const r2 = await request(server, { path: '/api/signup', method: 'POST', body: {
    name: 'Diego', email: 'diego2@example.com', password: 'miclave123', inviteCode: 'ZZZZZZZZ', accountType: 'collaborator', acceptTerms: true,
  } });
  check('colaborador con código inexistente -> 400', r2.status === 400);
  check('colaborador con código inexistente -> no se creó ninguna cuenta', usersTable.length === antesDeIntentar);

  // --- 3) Modo colaborador con el código real -> crea colaborador, bien atado a la cuenta dueña ---
  const r3 = await request(server, { path: '/api/signup', method: 'POST', body: {
    name: 'Diego', email: 'diego3@example.com', phone: '+57 300 111 2233', password: 'miclave123', inviteCode: 'b46nwec7', accountType: 'collaborator', acceptTerms: true,
  } });
  const data3 = JSON.parse(r3.body || '{}');
  check('colaborador con código real (minúsculas incluido) -> 200', r3.status === 200);
  check('la respuesta marca isCollaborator', data3.isCollaborator === true);
  const nuevoColaborador = usersTable.find((u) => u.email === 'diego3@example.com');
  check('la cuenta nueva quedó con owner_user_id = 1 (la dueña del código)', !!nuevoColaborador && nuevoColaborador.owner_user_id === 1);

  // --- 4) Modo owner (o sin accountType) sin código -> sigue funcionando igual que siempre ---
  const r4 = await request(server, { path: '/api/signup', method: 'POST', body: {
    name: 'Nueva Dueña', email: 'nuevadueña@example.com', phone: '+57 300 111 2233', password: 'miclave123', accountType: 'owner', acceptTerms: true,
  } });
  const data4 = JSON.parse(r4.body || '{}');
  check('owner sin código -> 200 (comportamiento normal intacto)', r4.status === 200);
  check('la respuesta NO marca isCollaborator', data4.isCollaborator === false);
  const nuevaDueña = usersTable.find((u) => u.email === 'nuevadueña@example.com');
  check('la cuenta nueva quedó SIN owner_user_id (dueña de su propia bitácora)', !!nuevaDueña && nuevaDueña.owner_user_id === null);

  // --- 5) Un código real "colado" en modo owner se ignora (no convierte en colaborador por accidente) ---
  const r5 = await request(server, { path: '/api/signup', method: 'POST', body: {
    name: 'Otra Dueña', email: 'otradueña@example.com', phone: '+57 300 111 2233', password: 'miclave123', inviteCode: 'B46NWEC7', accountType: 'owner', acceptTerms: true,
  } });
  const data5 = JSON.parse(r5.body || '{}');
  check('owner con un código colado igual -> 200, se ignora el código', r5.status === 200 && data5.isCollaborator === false);
  const otraDueña = usersTable.find((u) => u.email === 'otradueña@example.com');
  check('esa cuenta quedó sin owner_user_id (el código no la ató a nadie)', !!otraDueña && otraDueña.owner_user_id === null);

  // --- 6) Prueba A/B de la landing: signup_variant sale de la cookie que pone "/" ---
  const r6 = await request(server, {
    path: '/api/signup', method: 'POST', headers: { Cookie: 'bv_ab_landing=v2' },
    body: { name: 'Con Variante', email: 'convariante@example.com', phone: '+57 300 111 2233', password: 'miclave123', accountType: 'owner', acceptTerms: true },
  });
  check('signup con cookie bv_ab_landing=v2 -> 200', r6.status === 200);
  const conVariante = usersTable.find((u) => u.email === 'convariante@example.com');
  check('esa cuenta quedó con signup_variant = "v2"', !!conVariante && conVariante.signup_variant === 'v2');

  const r7 = await request(server, { path: '/api/signup', method: 'POST', body: {
    name: 'Sin Variante', email: 'sinvariante@example.com', phone: '+57 300 111 2233', password: 'miclave123', accountType: 'owner', acceptTerms: true,
  } });
  check('signup sin esa cookie -> 200', r7.status === 200);
  const sinVariante = usersTable.find((u) => u.email === 'sinvariante@example.com');
  check('esa cuenta quedó con signup_variant = null', !!sinVariante && sinVariante.signup_variant === null);

  // --- 7) Términos y Política de Privacidad: sin aceptar no se crea la cuenta ---
  const antesDeTerminos = usersTable.length;
  const base = { name: 'Sin Aceptar', email: 'sinaceptar@example.com', phone: '+57 300 111 2233', password: 'miclave123', accountType: 'owner' };
  const rt1 = await request(server, { path: '/api/signup', method: 'POST', body: base });
  check('sin acceptTerms -> 400', rt1.status === 400 && /Términos/.test(JSON.parse(rt1.body).error));
  const rt2 = await request(server, { path: '/api/signup', method: 'POST', body: { ...base, acceptTerms: 'true' } });
  check('acceptTerms que no es el booleano true (ej. el texto "true") -> 400', rt2.status === 400);
  const rt3 = await request(server, { path: '/api/signup', method: 'POST', body: { ...base, acceptTerms: false } });
  check('acceptTerms false -> 400', rt3.status === 400);
  check('ninguno de esos intentos creó una cuenta', usersTable.length === antesDeTerminos);
  const rt4 = await request(server, { path: '/api/signup', method: 'POST', body: { ...base, acceptTerms: true } });
  check('acceptTerms true -> 200', rt4.status === 200);
  const conTerminos = usersTable.find((u) => u.email === 'sinaceptar@example.com');
  check('la cuenta guarda la versión de los términos que aceptó', !!conTerminos && conTerminos.terms_version === '2026-10-07');

  server.close();
  console.log(`\n${passed} pasaron, ${failed} fallaron`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
