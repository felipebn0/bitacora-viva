// Intro de la primera vez y mensaje de regalo (BACKLOG #21): quién la ve, cuándo está
// pendiente, que se marque como vista, y las rutas con las que quien administra un
// subperfil graba, oye y quita el mensaje con su voz.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = 'token-falso';
delete process.env.R2_ENDPOINT;

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const HASH = bcrypt.hashSync('miclave123', 4);
const VIGENTE = '2026-10-14';

const users = {
  1: { id: 1, username: 'felipe', password_hash: HASH, token_version: 0, owner_user_id: null, name: 'Felipe Bernal', terms_version: VIGENTE, intro_vista_at: null, tieneSesiones: false },
  2: { id: 2, username: 'veterana', password_hash: HASH, token_version: 0, owner_user_id: null, name: 'Veterana', terms_version: VIGENTE, intro_vista_at: null, tieneSesiones: true },
  3: { id: 3, username: 'otra', password_hash: HASH, token_version: 0, owner_user_id: null, name: 'Otra', terms_version: VIGENTE, intro_vista_at: null, tieneSesiones: false },
  4: { id: 4, username: 'colab', password_hash: HASH, token_version: 0, owner_user_id: 1, name: 'Colaboradora', terms_version: VIGENTE, intro_vista_at: null, tieneSesiones: false },
};
const bitacoras = {
  10: { id: 10, admin_user_id: 1, nombre: 'Papá', narrador_code: 'CODIGO10', pin_hash: null, narrador_terms_version: null, mensaje_regalo_url: null, mensaje_regalo_de: null, mensaje_regalo_at: null, intro_vista_at: null, tieneSesiones: false },
};
const borrados = [];
const subidos = [];

function fakeSql(strings, ...values) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('INSERT INTO consentimientos')) return Promise.resolve([]);
  if (text.includes('UPDATE bitacoras SET narrador_terms_accepted_at')) { bitacoras[values[1]].narrador_terms_version = values[0]; return Promise.resolve([]); }
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = Object.values(users).find((x) => x.username === values[0]);
    return Promise.resolve(u ? [{ id: u.id, username: u.username, password_hash: u.password_hash, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) { const u = users[values[0]]; return Promise.resolve(u ? [{ owner_user_id: u.owner_user_id, token_version: u.token_version }] : []); }
  if (text.includes('SELECT terms_version FROM users WHERE id')) { const u = users[values[0]]; return Promise.resolve(u ? [{ terms_version: u.terms_version }] : []); }
  if (text.includes('SELECT narrador_terms_version FROM bitacoras WHERE id')) { const b = bitacoras[values[0]]; return Promise.resolve(b ? [{ narrador_terms_version: b.narrador_terms_version }] : []); }
  if (text.includes('SELECT id, narrador_code FROM bitacoras WHERE id') && !text.includes('admin_user_id')) { const b = bitacoras[values[0]]; return Promise.resolve(b ? [{ id: b.id, narrador_code: b.narrador_code }] : []); }
  if (text.includes('SELECT id, narrador_code FROM bitacoras WHERE id') && text.includes('admin_user_id')) {
    const b = bitacoras[values[0]];
    return Promise.resolve(b && b.admin_user_id === values[1] ? [{ id: b.id, narrador_code: b.narrador_code }] : []);
  }
  if (text.includes('SELECT id, nombre, pin_hash, narrador_terms_version FROM bitacoras WHERE narrador_code')) {
    const b = Object.values(bitacoras).find((x) => x.narrador_code === values[0]);
    return Promise.resolve(b ? [{ id: b.id, nombre: b.nombre, pin_hash: b.pin_hash, narrador_terms_version: b.narrador_terms_version }] : []);
  }
  if (text.includes('UPDATE bitacoras SET pin_hash')) { bitacoras[values[1]].pin_hash = values[0]; return Promise.resolve([]); }
  if (text.includes('SELECT 1 FROM bitacoras WHERE id') && text.includes('admin_user_id')) { const b = bitacoras[values[0]]; return Promise.resolve(b && b.admin_user_id === values[1] ? [{ '?column?': 1 }] : []); }
  // intro
  if (text.includes('SELECT mensaje_regalo_url, mensaje_regalo_de, intro_vista_at FROM bitacoras WHERE id')) {
    const b = bitacoras[values[0]]; return Promise.resolve(b ? [{ mensaje_regalo_url: b.mensaje_regalo_url, mensaje_regalo_de: b.mensaje_regalo_de, intro_vista_at: b.intro_vista_at }] : []);
  }
  if (text.includes('SELECT intro_vista_at FROM users WHERE id')) { const u = users[values[0]]; return Promise.resolve(u ? [{ intro_vista_at: u.intro_vista_at }] : []); }
  if (text.includes('SELECT 1 FROM sessions WHERE user_id')) {
    const dueno = bitacoras[values[0]] || users[values[0]];
    return Promise.resolve(dueno && dueno.tieneSesiones ? [{ '?column?': 1 }] : []);
  }
  if (text.includes('UPDATE bitacoras SET intro_vista_at = now()')) { bitacoras[values[0]].intro_vista_at = new Date(); return Promise.resolve([]); }
  if (text.includes('UPDATE users SET intro_vista_at = now()')) { users[values[0]].intro_vista_at = new Date(); return Promise.resolve([]); }
  // mensaje de regalo
  if (text.includes('SELECT mensaje_regalo_url, mensaje_regalo_de, mensaje_regalo_at FROM bitacoras WHERE id')) {
    const b = bitacoras[values[0]]; return Promise.resolve(b ? [{ mensaje_regalo_url: b.mensaje_regalo_url, mensaje_regalo_de: b.mensaje_regalo_de, mensaje_regalo_at: b.mensaje_regalo_at }] : []);
  }
  if (text.includes('SELECT mensaje_regalo_url FROM bitacoras WHERE id')) { const b = bitacoras[values[0]]; return Promise.resolve(b ? [{ mensaje_regalo_url: b.mensaje_regalo_url }] : []); }
  if (text.includes('SELECT name, username FROM users WHERE id')) { const u = users[values[0]]; return Promise.resolve(u ? [{ name: u.name, username: u.username }] : []); }
  if (text.includes('UPDATE bitacoras SET mensaje_regalo_url = NULL')) { const b = bitacoras[values[0]]; Object.assign(b, { mensaje_regalo_url: null, mensaje_regalo_de: null, mensaje_regalo_at: null }); return Promise.resolve([]); }
  if (text.includes('UPDATE bitacoras SET mensaje_regalo_url =')) {
    const [url, de, id] = values; Object.assign(bitacoras[id], { mensaje_regalo_url: url, mensaje_regalo_de: de, mensaje_regalo_at: new Date(), intro_vista_at: null }); return Promise.resolve([]);
  }
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);

require.cache[require.resolve('@neondatabase/serverless')] = { id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true, exports: { neon: () => fakeSql } };
require.cache[require.resolve('@vercel/blob')] = { id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true, exports: {
  put: async (nombre) => { subidos.push(nombre); return { url: `https://fake.public.blob.vercel-storage.com/${nombre}` }; },
  del: async (url) => { borrados.push(url); }, get: async () => null, list: async () => ({ blobs: [], hasMore: false }) } };
require.cache[require.resolve('@anthropic-ai/sdk')] = { id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true, exports: class { constructor() {} } };
const app = require(serverPath);

const fetchOriginal = global.fetch;
global.fetch = async (url, opts) => (String(url).startsWith('https://fake.public.blob.vercel-storage.com/') ? new Response(WAV, { status: 200, headers: { 'Content-Type': 'audio/wav' } }) : fetchOriginal(url, opts));
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.from([36, 0, 0, 0]), Buffer.from('WAVEfmt '), Buffer.from([16, 0, 0, 0, 1, 0, 1, 0, 0x40, 0x1f, 0, 0, 0x80, 0x3e, 0, 0, 2, 0, 16, 0]), Buffer.from('data'), Buffer.from([0, 0, 0, 0])]);

function request(server, opts, cookie) {
  return new Promise((resolve, reject) => {
    const host = '127.0.0.1:' + server.address().port;
    const cuerpo = opts.raw || (opts.body ? JSON.stringify(opts.body) : null);
    const headers = { Origin: 'http://' + host };
    if (cuerpo) { headers['Content-Type'] = opts.raw ? 'audio/wav' : 'application/json'; headers['Content-Length'] = Buffer.byteLength(cuerpo); }
    if (cookie) headers.Cookie = cookie;
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path: opts.path, method: opts.method || 'GET', headers }, (res) => {
      const ch = []; res.on('data', (x) => ch.push(x));
      res.on('end', () => { const body = Buffer.concat(ch).toString(); let json = null; try { json = JSON.parse(body); } catch (e) { /* no es JSON */ } resolve({ status: res.statusCode, headers: res.headers, json }); });
    });
    r.on('error', reject); if (cuerpo) r.write(cuerpo); r.end();
  });
}
const entrar = async (server, username) => (await request(server, { path: '/api/login', method: 'POST', body: { username, password: 'miclave123' } })).headers['set-cookie'][0].split(';')[0];

let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  const felipe = await entrar(server, 'felipe');
  const veterana = await entrar(server, 'veterana');
  const otra = await entrar(server, 'otra');
  const colab = await entrar(server, 'colab');

  // --- Cuenta nueva: intro sin mensaje ---
  let r = await request(server, { path: '/api/intro' }, felipe);
  ok(r.status === 200 && r.json.aplica === true && r.json.pendiente === true && r.json.mensaje === null, 'cuenta nueva (sin charlas): la intro está pendiente y sin mensaje de regalo');
  r = await request(server, { path: '/api/intro' }, veterana);
  ok(r.json.aplica === true && r.json.pendiente === false, 'quien ya tiene charlas no ve de pronto un tutorial');
  r = await request(server, { path: '/api/intro?repetir=1' }, veterana);
  ok(r.json.pendiente === true, 'pero puede repetirla a pedido (?repetir=1)');
  r = await request(server, { path: '/api/intro' }, colab);
  ok(r.json.aplica === false && r.json.pendiente === false, 'una cuenta colaboradora no la ve');
  r = await request(server, { path: '/api/intro' });
  ok(r.status === 401, 'sin sesión -> 401');
  await request(server, { path: '/api/intro/visto', method: 'POST' }, felipe);
  ok(users[1].intro_vista_at instanceof Date, 'al terminar se marca como vista en la cuenta (users.intro_vista_at)');
  r = await request(server, { path: '/api/intro' }, felipe);
  ok(r.json.pendiente === false, 'y ya no vuelve a salir sola');

  // --- Mensaje de regalo: solo lo gestiona quien administra el subperfil ---
  r = await request(server, { path: '/api/subprofiles/10/mensaje-regalo' }, felipe);
  ok(r.status === 200 && r.json.existe === false, 'GET sin mensaje: existe=false');
  r = await request(server, { path: '/api/subprofiles/10/mensaje-regalo', method: 'POST', raw: WAV }, otra);
  ok(r.status === 404 && !bitacoras[10].mensaje_regalo_url, 'otra cuenta no puede grabar el mensaje de un subperfil ajeno -> 404');
  r = await request(server, { path: '/api/subprofiles/10/mensaje-regalo', method: 'POST', raw: WAV }, colab);
  ok(r.status === 403, 'una colaboradora tampoco -> 403');
  r = await request(server, { path: '/api/subprofiles/10/mensaje-regalo', method: 'POST', raw: Buffer.from('esto no es audio, es texto') }, felipe);
  ok(r.status === 400, 'un archivo que no es audio de verdad se rechaza -> 400');
  r = await request(server, { path: '/api/subprofiles/10/mensaje-regalo', method: 'POST', raw: Buffer.alloc(3 * 1024 * 1024 + 10, 1) }, felipe);
  ok(r.status === 413, 'un mensaje demasiado largo -> 413');
  r = await request(server, { path: '/api/subprofiles/10/mensaje-regalo', method: 'POST', raw: WAV }, felipe);
  ok(r.status === 200 && /^\/api\/media-file\?u=/.test(r.json.url), 'quien administra lo graba -> 200 con la ruta para oírlo');
  ok(bitacoras[10].mensaje_regalo_de === 'Felipe', 'queda el nombre de pila de quien lo regala');
  ok(subidos.length === 1 && /^audio\/10\/regalo\/mensaje-\d+\.wav$/.test(subidos[0]), 'el archivo queda en audio/<id del subperfil>/regalo/: ' + subidos[0]);
  r = await request(server, { path: '/api/subprofiles/10/mensaje-regalo' }, felipe);
  ok(r.json.existe === true && r.json.de === 'Felipe', 'GET ahora lo muestra');

  // --- La persona del subperfil (entra por su enlace) ---
  const entra = await request(server, { path: '/api/narrador-start', method: 'POST', body: { codigo: 'CODIGO10', pin: '1234', acceptTerms: true } });
  const narrador = entra.headers['set-cookie'][0].split(';')[0];
  const rutaMensaje = (await request(server, { path: '/api/subprofiles/10/mensaje-regalo' }, felipe)).json.url;
  const oir = (cookie) => request(server, { path: rutaMensaje }, cookie);
  ok((await oir(narrador)).status === 200, 'la persona del subperfil puede oír el mensaje (/api/media-file)');
  ok((await oir(felipe)).status === 200, 'quien lo administra también');
  ok((await oir(otra)).status === 403, 'una cuenta de otra familia no puede oírlo -> 403');
  r = await request(server, { path: '/api/intro' }, narrador);
  ok(r.json.aplica === true && r.json.pendiente === true && r.json.mensaje && r.json.mensaje.de === 'Felipe' && /^\/api\/media-file\?u=/.test(r.json.mensaje.url), 'la persona ve la intro con el mensaje de quien se lo regaló');
  bitacoras[10].tieneSesiones = true;
  r = await request(server, { path: '/api/intro' }, narrador);
  ok(r.json.pendiente === true, 'aunque ya hubiera charlado, un mensaje de regalo sin escuchar sigue pendiente');
  await request(server, { path: '/api/intro/visto', method: 'POST' }, narrador);
  ok(bitacoras[10].intro_vista_at instanceof Date, 'al terminar se marca en el subperfil (bitacoras.intro_vista_at)');
  r = await request(server, { path: '/api/intro' }, narrador);
  ok(r.json.pendiente === false, 'y no vuelve a salir');
  r = await request(server, { path: '/api/subprofiles/10/mensaje-regalo', method: 'DELETE' }, narrador);
  ok(r.status === 403, 'la persona del subperfil no puede quitar ni cambiar el mensaje -> 403');

  // --- Cambiar o quitar el mensaje ---
  const anterior = bitacoras[10].mensaje_regalo_url;
  r = await request(server, { path: '/api/subprofiles/10/mensaje-regalo', method: 'POST', raw: WAV }, felipe);
  ok(r.status === 200 && bitacoras[10].intro_vista_at === null, 'un mensaje nuevo vuelve a dejar la intro pendiente');
  ok(borrados.includes(anterior), 'y el archivo del mensaje anterior se borra del almacenamiento');
  const actual = bitacoras[10].mensaje_regalo_url;
  r = await request(server, { path: '/api/subprofiles/10/mensaje-regalo', method: 'DELETE' }, otra);
  ok(r.status === 404 && bitacoras[10].mensaje_regalo_url === actual, 'otra cuenta no puede quitarlo');
  r = await request(server, { path: '/api/subprofiles/10/mensaje-regalo', method: 'DELETE' }, felipe);
  ok(r.status === 200 && bitacoras[10].mensaje_regalo_url === null && borrados.includes(actual), 'quien administra lo quita: se borra de la base y del almacenamiento');
  r = await request(server, { path: '/api/intro' }, narrador);
  ok(r.json.mensaje === null, 'sin mensaje, la intro no lo menciona');

  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
