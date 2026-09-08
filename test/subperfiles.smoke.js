// Smoke test para subperfiles (BACKLOG #12): varias bitácoras administradas
// desde un solo login, estilo selector de perfiles de Netflix.
//
// Cubre: crear/listar/cambiar de perfil, aislamiento entre familias (el
// login de una familia nunca ve/administra los subperfiles de otra), que
// cambiar a un subperfil corta la narración (403 en /api/next) pero deja
// ver/exportar su contenido, revalidación en cada request (si el subperfil
// desaparece entre un cambio de perfil y el siguiente pedido, se corta con
// 401 en vez de caer en silencio a la bitácora propia), y el ciclo de vida
// completo del link permanente de narrador (generar, narrar de verdad,
// regenerar corta la sesión vieja, revocar corta el código).
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const PASSWORD_HASH = bcrypt.hashSync('miclave123', 4);

const users = {
  1: { id: 1, username: 'felipe', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null, name: 'Felipe' },
  // Cuenta de OTRA familia — para probar que nunca puede ver/tocar los
  // subperfiles administrados por la cuenta 1.
  2: { id: 2, username: 'otrafamilia', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null, name: 'Otra Familia' },
};

let bitacoras = {}; // id -> { id, admin_user_id, nombre, fecha_nacimiento, narrador_code, created_at }
// Arranca en 1000 (bien por encima de cualquier id de "users" del fixture)
// para simular que la secuencia real nunca entregaría un id ya usado por una
// cuenta — ver el comentario largo en ensureSchema sobre por qué "bitacoras.id"
// toma su valor de la MISMA secuencia que users.id.
let nextBitacoraId = 1000;

let storyLog = {}; // profileUserId -> [{ id, texto, audio_url, media_urls }]
let nextStoryLogId = 1;

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
  if (text.includes('SELECT token_version FROM users WHERE id')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT name FROM users WHERE id')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ name: u.name }] : []);
  }

  // --- requireAuth: revalidación del subperfil activo en cada request ---
  if (text.includes('SELECT id, admin_user_id FROM bitacoras WHERE id')) {
    const bit = bitacoras[values[0]];
    return Promise.resolve(bit ? [{ id: bit.id, admin_user_id: bit.admin_user_id }] : []);
  }

  // --- /api/subprofiles ---
  if (text.includes('INSERT INTO bitacoras (admin_user_id, nombre, fecha_nacimiento)')) {
    const [adminUserId, nombre, fechaNacimiento] = values;
    const id = nextBitacoraId++;
    bitacoras[id] = { id, admin_user_id: adminUserId, nombre, fecha_nacimiento: fechaNacimiento, narrador_code: null };
    return Promise.resolve([{ id }]);
  }
  if (text.includes('SELECT id, nombre FROM bitacoras WHERE admin_user_id')) {
    const lista = Object.values(bitacoras).filter((b) => b.admin_user_id === values[0]);
    return Promise.resolve(lista.map((b) => ({ id: b.id, nombre: b.nombre })));
  }
  if (text.includes('SELECT id FROM bitacoras WHERE id') && text.includes('admin_user_id')) {
    const bit = bitacoras[values[0]];
    return Promise.resolve(bit && bit.admin_user_id === values[1] ? [{ id: bit.id }] : []);
  }

  // --- narrador-link: bitacoraDelAdmin (ownership) vs. lookup público ---
  if (text.includes('SELECT id, narrador_code FROM bitacoras WHERE id') && text.includes('admin_user_id')) {
    const bit = bitacoras[values[0]];
    return Promise.resolve(bit && bit.admin_user_id === values[1] ? [{ id: bit.id, narrador_code: bit.narrador_code }] : []);
  }
  if (text.includes('SELECT id, narrador_code FROM bitacoras WHERE id')) {
    const bit = bitacoras[values[0]];
    return Promise.resolve(bit ? [{ id: bit.id, narrador_code: bit.narrador_code }] : []);
  }
  if (text.includes('UPDATE bitacoras SET narrador_code = NULL WHERE id')) {
    // Revocar: NULL va como literal en el SQL, no como parámetro -> 1 solo value (el id).
    const [id] = values;
    if (bitacoras[id]) bitacoras[id].narrador_code = null;
    return Promise.resolve([]);
  }
  if (text.includes('UPDATE bitacoras SET narrador_code')) {
    // Asignar/regenerar (asignarNuevoNarradorCode): 2 values, [code, id].
    const [code, id] = values;
    if (bitacoras[id]) bitacoras[id].narrador_code = code || null;
    return Promise.resolve([]);
  }
  if (text.includes('SELECT nombre FROM bitacoras WHERE narrador_code')) {
    const bit = Object.values(bitacoras).find((b) => b.narrador_code && b.narrador_code === values[0]);
    return Promise.resolve(bit ? [{ nombre: bit.nombre }] : []);
  }
  if (text.includes('SELECT id, nombre FROM bitacoras WHERE narrador_code')) {
    const bit = Object.values(bitacoras).find((b) => b.narrador_code && b.narrador_code === values[0]);
    return Promise.resolve(bit ? [{ id: bit.id, nombre: bit.nombre }] : []);
  }

  // --- Contenido genérico (loadMemorySummary, loadPendingFamilyNote,
  // loadPendingMedia, loadFamilyContext, loadKnownFamilyMembers, /api/tree,
  // /api/chapters, leerPerfilBitacora para un subperfil): vacío alcanza acá,
  // no son el foco de este test.
  if (text.includes('SELECT texto FROM resumen')) return Promise.resolve([]);
  if (text.includes('SELECT id, contributor, parentesco, texto, media_urls FROM family_notes')) return Promise.resolve([]);
  if (text.includes('SELECT contributor, parentesco, texto FROM family_notes')) return Promise.resolve([]);
  if (text.includes('SELECT id, type, caption, contributor, url FROM media')) return Promise.resolve([]);
  if (text.includes('nombre, fecha_nacimiento, created_at FROM bitacoras WHERE id')) return Promise.resolve([]);
  if (text.includes('SELECT id, nombre, relacion, detalles, padres, es_principal FROM family_members')) return Promise.resolve([]);
  if (text.includes('SELECT descripcion, anio, edad_aprox, categoria FROM timeline_events')) return Promise.resolve([]);
  if (text.includes('SELECT id, title, theme, generated_text, story_ids, persona, created_at FROM chapters')) return Promise.resolve([]);
  if (text.includes('SELECT id, audio_url FROM story_log') && text.includes('audio_url IS NOT NULL')) return Promise.resolve([]);

  // --- story_log: el destino real de /api/next, para verificar a qué
  // bitácora quedó atada cada historia narrada ---
  if (text.includes('SELECT id, audio_url, media_urls FROM story_log WHERE user_id')) {
    return Promise.resolve([]); // sin duplicados en estos tests
  }
  if (text.includes('SELECT id, texto, audio_url, media_urls, created_at FROM story_log WHERE user_id')) {
    const filas = storyLog[values[0]] || [];
    return Promise.resolve(filas.map((f) => ({ ...f })));
  }
  if (text.includes('INSERT INTO story_log (user_id, texto, audio_url, media_urls)')) {
    const [userId, texto, audioUrl, mediaUrls] = values;
    const id = nextStoryLogId++;
    if (!storyLog[userId]) storyLog[userId] = [];
    storyLog[userId].push({ id, texto, audio_url: audioUrl, media_urls: mediaUrls });
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
  exports: { put: async () => ({ url: 'https://fake.public.blob.vercel-storage.com/x' }), del: async () => {}, get: async () => null },
};

// Mismo patrón que test/next.smoke.js: un fake PROGRAMABLE de Anthropic, en
// vez de la clase vacía del smoke original, para poder ejercitar /api/next
// de verdad (narrar como el subperfil).
let responseQueue = [];
function pushAnthropicResponse(text) { responseQueue.push(text); }
require.cache[require.resolve('@anthropic-ai/sdk')] = {
  id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true,
  exports: class FakeAnthropic {
    constructor() {}
    get messages() {
      return {
        create: async () => {
          if (!responseQueue.length) throw new Error('FakeAnthropic: sin respuesta programada.');
          return { content: [{ type: 'text', text: responseQueue.shift() }] };
        },
      };
    }
  },
};

const app = require(serverPath);

function request(server, opts, cookie) {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : null;
    const headers = Object.assign({}, opts.headers || {});
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
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

async function login(server, username) {
  const resp = await request(server, { path: '/api/login', method: 'POST', body: { username, password: 'miclave123' } });
  if (resp.status !== 200) throw new Error(`login falló: ${resp.status} ${resp.body}`);
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
    const cookieFelipe = await login(server, 'felipe');
    const cookieOtra = await login(server, 'otrafamilia');

    // --- Crear ---
    const crear = await request(server, { path: '/api/subprofiles', method: 'POST', body: { nombre: 'papá' } }, cookieFelipe);
    check('crear subperfil -> 200', crear.status === 200);
    const { id: papaId } = JSON.parse(crear.body);
    check('el id del subperfil es disjunto de cualquier id de "users" del fixture', papaId !== 1 && papaId !== 2);
    check('el subperfil quedó administrado por Felipe', bitacoras[papaId].admin_user_id === 1);

    // --- Listar: solo lo mío, nunca lo de otra familia ---
    const listaFelipe = await request(server, { path: '/api/subprofiles' }, cookieFelipe);
    const perfilesFelipe = JSON.parse(listaFelipe.body).perfiles;
    check('la lista de Felipe incluye "vos" + el subperfil de papá', perfilesFelipe.some((p) => p.esPropia) && perfilesFelipe.some((p) => p.id === papaId));

    const listaOtra = await request(server, { path: '/api/subprofiles' }, cookieOtra);
    const perfilesOtra = JSON.parse(listaOtra.body).perfiles;
    check('la lista de otra familia NO incluye el subperfil de Felipe (aislamiento)', !perfilesOtra.some((p) => p.id === papaId));

    // --- Otra familia no puede cambiarse al subperfil de Felipe ---
    const switchAjeno = await request(server, { path: '/api/subprofiles/switch', method: 'POST', body: { id: papaId } }, cookieOtra);
    check('otra familia no puede cambiarse al subperfil de Felipe -> 404', switchAjeno.status === 404);

    // --- Felipe cambia al subperfil de papá ---
    const switchOk = await request(server, { path: '/api/subprofiles/switch', method: 'POST', body: { id: papaId } }, cookieFelipe);
    check('Felipe se cambia a su subperfil -> 200', switchOk.status === 200);
    const cookieComoPapa = switchOk.headers['set-cookie'][0].split(';')[0];

    // --- Con el subperfil activo: no puede narrar, pero sí ver ---
    const nextBloqueado = await request(server, { path: '/api/next', method: 'POST', body: { history: [], mode: 'historia' } }, cookieComoPapa);
    check('con el subperfil activo, /api/next -> 403 (no puede narrar)', nextBloqueado.status === 403);

    const treeComoPapa = await request(server, { path: '/api/tree' }, cookieComoPapa);
    check('con el subperfil activo, /api/tree sigue disponible (ver sí, narrar no)', treeComoPapa.status === 200);

    const storyLogComoPapa = await request(server, { path: '/api/story-log' }, cookieComoPapa);
    check('con el subperfil activo, /api/story-log -> 200 (ver el contenido del subperfil)', storyLogComoPapa.status === 200);

    // --- Revalidación en cada request: si el subperfil "desaparece" entre
    // el cambio de perfil y el siguiente pedido, se corta con 401 --------
    delete bitacoras[papaId];
    const treeTrasBorrar = await request(server, { path: '/api/tree' }, cookieComoPapa);
    check('si el subperfil ya no existe, el siguiente pedido -> 401 (no cae en silencio a la propia)', treeTrasBorrar.status === 401);
    // Se restaura para el resto de los tests.
    bitacoras[papaId] = { id: papaId, admin_user_id: 1, nombre: 'papá', fecha_nacimiento: null, narrador_code: null };

    // --- Link permanente de narrador: generar, narrar de verdad ---------
    const linkGet = await request(server, { path: `/api/subprofiles/${papaId}/narrador-link` }, cookieFelipe);
    check('generar el link de narrador -> 200 con un código', linkGet.status === 200 && typeof JSON.parse(linkGet.body).code === 'string');
    const codigoNarrador = JSON.parse(linkGet.body).code;

    const infoOk = await request(server, { path: `/api/narrador-code-info?codigo=${codigoNarrador}` });
    check('el código del narrador resuelve al nombre del subperfil -> 200', infoOk.status === 200 && JSON.parse(infoOk.body).bitacoraNombre === 'Papá');

    const narradorStart = await request(server, { path: '/api/narrador-start', method: 'POST', body: { codigo: codigoNarrador, name: 'Papá' } });
    check('entrar como narrador con el código -> 200', narradorStart.status === 200);
    const cookieNarrador = narradorStart.headers['set-cookie'][0].split(';')[0];

    pushAnthropicResponse('¿Y cómo era tu barrio de niño?');
    const nextComoNarrador = await request(server, {
      path: '/api/next', method: 'POST',
      body: { history: [{ role: 'user', content: 'Me acuerdo clarito de mi barrio, de las calles destapadas y de los juegos con mis hermanos en las tardes después del colegio, casi todos los días del año, hasta que oscurecía y mi mamá nos llamaba a gritos desde la puerta de la casa para que entráramos a comer.' }], mode: 'historia' },
    }, cookieNarrador);
    check('el narrador SÍ puede narrar -> 200', nextComoNarrador.status === 200);
    check('la historia quedó guardada en la bitácora del SUBPERFIL, no en la de Felipe', (storyLog[papaId] || []).length === 1 && !(storyLog[1] || []).length);

    // --- El narrador no puede tocar nada de la cuenta que loguea --------
    const billingComoNarrador = await request(server, { path: '/api/billing/status' }, cookieNarrador);
    check('el narrador no puede ver facturación -> 403', billingComoNarrador.status === 403);

    // --- Regenerar corta la sesión de narrador vieja ---------------------
    const regenerar = await request(server, { path: `/api/subprofiles/${papaId}/narrador-link/regenerate`, method: 'POST' }, cookieFelipe);
    check('regenerar el link -> 200 con un código nuevo', regenerar.status === 200 && JSON.parse(regenerar.body).code !== codigoNarrador);

    const nextConCodigoViejo = await request(server, { path: '/api/next', method: 'POST', body: { history: [], mode: 'historia' } }, cookieNarrador);
    check('la sesión de narrador con el código viejo queda cortada -> 401', nextConCodigoViejo.status === 401);

    // --- Revocar corta el código sin generar uno nuevo -------------------
    const codigoNuevo = JSON.parse(regenerar.body).code;
    const revocar = await request(server, { path: `/api/subprofiles/${papaId}/narrador-link/revoke`, method: 'POST' }, cookieFelipe);
    check('revocar -> 200', revocar.status === 200);
    const infoTrasRevocar = await request(server, { path: `/api/narrador-code-info?codigo=${codigoNuevo}` });
    check('tras revocar, ese código ya no resuelve a nada -> 404', infoTrasRevocar.status === 404);
  } finally {
    server.close();
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
