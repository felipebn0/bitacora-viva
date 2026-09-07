// Smoke test para POST /api/contribute-media — subir una foto o video que
// acompaña una historia (BACKLOG #1: el backend ya existía pero no había
// ningún botón para usarlo desde la interfaz; se agregó en colaborar.html).
//
// Esta ruta solo sube el archivo a Blob y devuelve su URL/tipo — YA NO
// inserta ninguna fila en la tabla "media" genérica (ver el comentario en
// server.js junto a este endpoint): la foto/video queda atada a la
// historia puntual que se está contando en ese momento, guardada por el
// CLIENTE (colaborar.html, mediaUrlsLocal) y persistida recién cuando esa
// historia se guarda (family_notes.media_urls, ver test/contribute-draft.smoke.js).
// Insertarla acá TAMBIÉN como pendiente suelto competía con la historia por
// ser lo primero que se le mostraba al dueño en su próxima charla.
//
// Cubre: el dueño puede subir una foto para su propia bitácora, una
// colaboradora fija puede subir para la bitácora de su dueña (no la propia),
// una cuenta sin relación no puede, y un archivo que no es una imagen/video
// de verdad se rechaza (chequeo por bytes reales, no por Content-Type).
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const PASSWORD_HASH = bcrypt.hashSync('miclave123', 4);

// A: dueña. B: cuenta sin ninguna relación con A. C: colaboradora fija de A.
const users = {
  1: { id: 1, username: 'duena', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null },
  2: { id: 2, username: 'ajena', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null },
  3: { id: 3, username: 'colabfija', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: 1 },
};

let mediaInserts = []; // se espera que quede siempre vacío — ver el comentario de arriba

function fakeSql(strings, ...values) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = Object.values(users).find((x) => x.username === values[0]);
    return Promise.resolve(u ? [{ id: u.id, username: u.username, password_hash: u.password_hash, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ owner_user_id: u.owner_user_id, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT 1 FROM collaborations')) return Promise.resolve([]);
  if (text.includes('INSERT INTO media')) {
    mediaInserts.push(values);
    return Promise.resolve([]);
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
  exports: {
    put: async (filename, buf, opts) => ({ url: `https://fake.public.blob.vercel-storage.com/${filename}` }),
    del: async () => {},
    get: async () => null,
  },
};
require.cache[require.resolve('@anthropic-ai/sdk')] = {
  id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true,
  exports: class FakeAnthropic { constructor() {} },
};

const app = require(serverPath);

// PNG de 1x1 transparente, real (pasa la detección por bytes de file-type).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const TEXTO_NO_ES_IMAGEN = Buffer.from('esto no es una imagen, solo texto plano');

function request(server, opts, cookie) {
  return new Promise((resolve, reject) => {
    const headers = Object.assign({}, opts.headers || {});
    if (cookie) headers['Cookie'] = cookie;
    const host = `127.0.0.1:${server.address().port}`;
    if (!headers['Origin']) headers['Origin'] = `http://${host}`;
    const r = http.request({ hostname: '127.0.0.1', port: server.address().port, path: opts.path, method: opts.method || 'GET', headers }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

async function login(server, username) {
  const data = JSON.stringify({ username, password: 'miclave123' });
  const resp = await new Promise((resolve, reject) => {
    const host = `127.0.0.1:${server.address().port}`;
    const r = http.request(
      { hostname: '127.0.0.1', port: server.address().port, path: '/api/login', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Origin: `http://${host}` } },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); }
    );
    r.on('error', reject);
    r.write(data);
    r.end();
  });
  if (resp.status !== 200) throw new Error(`login falló para ${username}: ${resp.status} ${resp.body}`);
  return resp.headers['set-cookie'][0].split(';')[0];
}

let pasaron = 0;
let fallaron = 0;
function check(nombre, cond) {
  if (cond) { pasaron++; console.log('OK  -', nombre); }
  else { fallaron++; console.log('FAIL -', nombre); }
}

(async () => {
  const server = app.listen(0);
  try {
    const cookieA = await login(server, 'duena');
    const cookieB = await login(server, 'ajena');
    const cookieC = await login(server, 'colabfija');

    // --- Sin cuerpo ---
    const sinCuerpo = await request(server, { path: '/api/contribute-media', method: 'POST', headers: { 'Content-Type': 'image/png' } }, cookieA);
    check('sin archivo -> 400', sinCuerpo.status === 400);

    // --- Archivo que no es una imagen/video de verdad ---
    const noEsImagen = await request(server, { path: '/api/contribute-media', method: 'POST', headers: { 'Content-Type': 'image/png', 'Content-Length': TEXTO_NO_ES_IMAGEN.length }, body: TEXTO_NO_ES_IMAGEN }, cookieA);
    check('texto plano disfrazado de imagen -> 400 (chequeo por bytes reales)', noEsImagen.status === 400);

    // --- Cuenta sin relación con A: no puede subir para la bitácora de A ---
    const comoAjena = await request(server, { path: '/api/contribute-media?owner=1', method: 'POST', headers: { 'Content-Type': 'image/png', 'Content-Length': PNG_1X1.length }, body: PNG_1X1 }, cookieB);
    check('cuenta sin relación con A -> 403', comoAjena.status === 403);

    // --- La dueña sube una foto real para su propia bitácora ---
    const comoDuena = await request(server, {
      path: '/api/contribute-media',
      method: 'POST',
      headers: { 'Content-Type': 'image/png', 'Content-Length': PNG_1X1.length },
      body: PNG_1X1,
    }, cookieA);
    check('la dueña sube una foto real -> 200', comoDuena.status === 200);
    const dataDuena = JSON.parse(comoDuena.body);
    check('la respuesta trae ok:true y una url', dataDuena.ok === true && typeof dataDuena.url === 'string' && dataDuena.url.length > 0);
    check('la respuesta identifica el tipo como foto', dataDuena.type === 'foto');
    check('la url apunta a la carpeta de la dueña (user_id=1)', dataDuena.url.includes('/media/1/'));

    // --- La colaboradora fija de A sube para la bitácora de A (no la propia) ---
    const comoColabFija = await request(server, {
      path: '/api/contribute-media',
      method: 'POST',
      headers: { 'Content-Type': 'image/png', 'Content-Length': PNG_1X1.length },
      body: PNG_1X1,
    }, cookieC);
    check('la colaboradora fija de A sube una foto -> 200', comoColabFija.status === 200);
    const dataColabFija = JSON.parse(comoColabFija.body);
    check('la url queda en la carpeta de la bitácora de A (user_id=1), no de la colaboradora (id=3)', dataColabFija.url.includes('/media/1/'));

    // --- Nada de esto debería haber tocado la tabla "media" genérica ---
    check('ningún caso insertó una fila en la tabla "media" (ver el comentario de arriba)', mediaInserts.length === 0);
  } finally {
    server.close();
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
