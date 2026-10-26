// Diario de un bebé: la dueña lo crea y sube fotos/notas; sus familiares invitados lo VEN pero no lo
// editan; una cuenta ajena no ve nada. Las fotos solo se entregan por el diario, nunca por la ruta del archivo.
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
const users = {
  1: { id: 1, username: 'paula', password_hash: HASH, token_version: 0, owner_user_id: null },
  2: { id: 2, username: 'ajena', password_hash: HASH, token_version: 0, owner_user_id: null },
  3: { id: 3, username: 'abuela', password_hash: HASH, token_version: 0, owner_user_id: null },
};
const colaboraciones = [{ collaborator_user_id: 3, owner_user_id: 1 }];
let diarios = [];
let entradas = [];
let siguienteId = 1;
const borrados = [];
const subidos = {};
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function fakeSql(strings, ...v) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = Object.values(users).find((x) => x.username === v[0]);
    return Promise.resolve(u ? [{ id: u.id, username: u.username, password_hash: u.password_hash, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) { const u = users[v[0]]; return Promise.resolve(u ? [{ owner_user_id: null, token_version: u.token_version }] : []); }
  if (text.includes('SELECT owner_user_id FROM users WHERE id')) return Promise.resolve([{ owner_user_id: null }]);
  if (text.includes('SELECT 1 FROM collaborations WHERE collaborator_user_id')) {
    return Promise.resolve(colaboraciones.some((c) => c.collaborator_user_id === v[0] && c.owner_user_id === v[1]) ? [{ x: 1 }] : []);
  }
  if (text.includes('UPDATE diario_bebe SET archived_at')) {
    const d = diarios.find((x) => x.profile_user_id === v[0] && !x.archivado);
    if (d) d.archivado = true;
    return Promise.resolve(d ? [{ profile_user_id: d.profile_user_id }] : []);
  }
  if (text.includes('FROM diario_bebe WHERE profile_user_id')) { const d = diarios.find((x) => x.profile_user_id === v[0] && !x.archivado); return Promise.resolve(d ? [d] : []); }
  if (text.includes('INSERT INTO diario_bebe (')) {
    const fila = { profile_user_id: v[0], nombre: v[1], genero: v[2], nacio_en: v[3] };
    diarios = diarios.filter((x) => x.profile_user_id !== v[0]).concat(fila);
    return Promise.resolve([]);
  }
  if (text.includes('INSERT INTO diario_bebe_entradas')) {
    const fila = { id: siguienteId++, profile_user_id: v[0], texto: v[1], media_url: v[2], audio_urls: v[3], created_at: new Date().toISOString() };
    entradas.push(fila);
    return Promise.resolve([Object.assign({}, fila)]);
  }
  if (text.includes('SELECT id, texto, media_url, audio_urls, origen, created_at FROM diario_bebe_entradas WHERE profile_user_id')) return Promise.resolve(entradas.filter((e) => e.profile_user_id === v[0]).slice().reverse());
  if (text.includes('SELECT id, texto, media_url, audio_urls, origen, created_at FROM diario_bebe_entradas WHERE id')) return Promise.resolve(entradas.filter((e) => e.id === v[0] && e.profile_user_id === v[1]));
  if (text.includes('UPDATE diario_bebe_entradas SET texto')) {
    const f = entradas.find((e) => e.id === v[2] && e.profile_user_id === v[3]);
    if (!f) return Promise.resolve([]);
    f.texto = v[0]; f.audio_urls = v[1];
    return Promise.resolve([Object.assign({}, f)]);
  }
  if (text.includes('SELECT media_url FROM diario_bebe_entradas WHERE id')) return Promise.resolve(entradas.filter((e) => e.id === v[0] && e.profile_user_id === v[1]));
  if (text.includes('SELECT audio_urls FROM diario_bebe_entradas WHERE id')) return Promise.resolve(entradas.filter((e) => e.id === v[0] && e.profile_user_id === v[1]));
  if (text.includes('DELETE FROM diario_bebe_entradas WHERE id')) {
    const f = entradas.filter((e) => e.id === v[0] && e.profile_user_id === v[1]);
    entradas = entradas.filter((e) => !f.includes(e));
    return Promise.resolve(f.map((e) => ({ media_url: e.media_url, audio_urls: e.audio_urls })));
  }
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);

function streamDe(buf) { return new ReadableStream({ start(c) { c.enqueue(new Uint8Array(buf)); c.close(); } }); }
const cache = (mod, exports) => { require.cache[require.resolve(mod)] = { id: require.resolve(mod), filename: require.resolve(mod), loaded: true, exports }; };
cache('@neondatabase/serverless', { neon: () => fakeSql });
cache('@vercel/blob', {
  put: async (pathname, cuerpo) => { subidos[pathname] = cuerpo; return { url: 'https://fake.public.blob.vercel-storage.com/' + pathname }; },
  del: async (u) => { borrados.push(u); },
  list: async () => ({ blobs: [], hasMore: false }),
  get: async (clave) => {
    if (!subidos[clave]) return null;
    return { statusCode: 200, stream: streamDe(subidos[clave]), headers: new Headers(), blob: { contentType: 'image/png', size: subidos[clave].length } };
  },
});
cache('@anthropic-ai/sdk', class { constructor() {} });
const app = require(serverPath);

function request(server, opts, cookie) {
  return new Promise((resolve, reject) => {
    const host = '127.0.0.1:' + server.address().port;
    const cuerpo = opts.raw || (opts.body ? JSON.stringify(opts.body) : null);
    const headers = Object.assign({ Origin: 'http://' + host }, opts.headers || {});
    if (cuerpo) { headers['Content-Type'] = opts.contentType || 'application/json'; headers['Content-Length'] = Buffer.byteLength(cuerpo); }
    if (cookie) headers.Cookie = cookie;
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path: opts.path, method: opts.method || 'GET', headers }, (res) => {
      const ch = []; res.on('data', (x) => ch.push(x));
      res.on('end', () => { const body = Buffer.concat(ch); let json = null; try { json = JSON.parse(body.toString()); } catch (e) { /* no es JSON */ } resolve({ status: res.statusCode, headers: res.headers, body, json }); });
    });
    r.on('error', reject); if (cuerpo) r.write(cuerpo); r.end();
  });
}
const entrar = async (server, u) => (await request(server, { path: '/api/login', method: 'POST', body: { username: u, password: 'miclave123' } })).headers['set-cookie'][0].split(';')[0];

let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  const paula = await entrar(server, 'paula');
  const ajena = await entrar(server, 'ajena');
  const abuela = await entrar(server, 'abuela');

  let r = await request(server, { path: '/api/bebe' });
  ok(r.status === 401, 'sin sesión no se abre el diario (401)');
  r = await request(server, { path: '/api/bebe' }, paula);
  ok(r.status === 200 && r.json.config === null && r.json.puedeEditar === true, 'antes de crearlo: no hay diario y ella puede crearlo');

  r = await request(server, { path: '/api/bebe', method: 'PUT', body: { nombre: '   ' } }, paula);
  ok(r.status === 400, 'sin nombre no se crea (400)');
  r = await request(server, { path: '/api/bebe', method: 'PUT', body: { nombre: 'Rafaela', nacioEn: '2099-01-01' } }, paula);
  ok(r.status === 400, 'una fecha de nacimiento muy en el futuro no es válida (400)');
  r = await request(server, { path: '/api/bebe', method: 'PUT', body: { nombre: 'Rafaela', genero: 'femenino' } }, paula);
  ok(r.status === 200 && r.json.config.nombre === 'Rafaela' && r.json.config.estado === 'en_camino', 'crea el diario: Rafaela, en camino');

  r = await request(server, { path: '/api/bebe/entradas', method: 'POST', body: {} }, paula);
  ok(r.status === 400, 'una entrada vacía no se guarda (400)');
  r = await request(server, { path: '/api/bebe/entradas', method: 'POST', body: { texto: 'Hoy pateó por primera vez' } }, paula);
  ok(r.status === 200 && r.json.entrada.texto === 'Hoy pateó por primera vez', 'guarda una nota del día');

  r = await request(server, { path: '/api/bebe/foto', method: 'POST', raw: Buffer.from('esto no es una foto'), contentType: 'image/png' }, paula);
  ok(r.status === 400, 'un archivo que no es foto no se sube (400)');
  r = await request(server, { path: '/api/bebe/foto', method: 'POST', raw: PNG_1X1, contentType: 'image/png' }, paula);
  ok(r.status === 200 && r.json.url.includes('media/1/bebe/'), 'sube una foto a la carpeta del diario de su cuenta');
  const fotoUrl = r.json.url;
  r = await request(server, { path: '/api/bebe/entradas', method: 'POST', body: { texto: 'La ecografía', fotoUrl: 'https://fake.public.blob.vercel-storage.com/media/2/bebe/foto-1.png' } }, paula);
  ok(r.status === 400, 'no acepta una foto que está en la carpeta de otra cuenta (400)');
  r = await request(server, { path: '/api/bebe/entradas', method: 'POST', body: { fotoUrl: 'https://fake.public.blob.vercel-storage.com/audio/1/charla/user-0.webm' } }, paula);
  ok(r.status === 400, 'tampoco un archivo de su cuenta que no sea del diario (400)');
  r = await request(server, { path: '/api/bebe/entradas', method: 'POST', body: { texto: 'La ecografía', fotoUrl } }, paula);
  ok(r.status === 200 && /^\/api\/bebe\/foto\/\d+\?owner=1$/.test(r.json.entrada.fotoUrl), 'guarda la foto con su nota; la foto se pide por el diario, no por la ruta del archivo');
  const entradaFoto = r.json.entrada;

  // --- Notas de voz: se guarda el audio original junto a su transcripción ---
  // WAV mínimo pero real (cabecera RIFF/WAVE + 100 muestras en silencio), para pasar la verificación de bytes.
  const WEBM = (() => {
    const datos = Buffer.alloc(200);
    const h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + datos.length, 4); h.write('WAVE', 8);
    h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
    h.writeUInt32LE(8000, 24); h.writeUInt32LE(16000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
    h.write('data', 36); h.writeUInt32LE(datos.length, 40);
    return Buffer.concat([h, datos]);
  })();
  r = await request(server, { path: '/api/bebe/audio', method: 'POST', raw: Buffer.from('esto no es audio'), contentType: 'audio/webm' }, paula);
  ok(r.status === 400, 'un archivo que no es audio no se sube como nota de voz (400)');
  r = await request(server, { path: '/api/bebe/audio', method: 'POST', raw: WEBM, contentType: 'audio/wav' }, paula);
  ok(r.status === 200 && /media\/1\/bebe\/voz-.+\.wav$/.test(r.json.url), 'sube la nota de voz original a la carpeta del diario');
  const voz1 = r.json.url;
  r = await request(server, { path: '/api/bebe/audio', method: 'POST', raw: WEBM, contentType: 'audio/wav' }, paula);
  const voz2 = r.json.url;
  r = await request(server, { path: `/api/bebe/entradas/${entradaFoto.id}`, method: 'PATCH', body: { texto: 'Se rió con la canción', agregarAudio: voz1 } }, paula);
  ok(r.status === 200 && r.json.entrada.texto === 'Se rió con la canción' && r.json.entrada.audios.length === 1 && /^\/api\/bebe\/audio\/\d+\/0\?owner=1$/.test(r.json.entrada.audios[0]), 'la foto ya guardada se completa sola con lo dicho y su audio');
  r = await request(server, { path: `/api/bebe/entradas/${entradaFoto.id}`, method: 'PATCH', body: { texto: 'Se rió con la canción. Y después se durmió', agregarAudio: voz2 } }, paula);
  ok(r.status === 200 && r.json.entrada.audios.length === 2 && r.json.entrada.texto.endsWith('se durmió'), '"contar más" suma otra grabación a la misma nota');
  r = await request(server, { path: `/api/bebe/entradas/${entradaFoto.id}`, method: 'PATCH', body: { agregarAudio: 'https://fake.public.blob.vercel-storage.com/media/2/bebe/voz-1.webm' } }, paula);
  ok(r.status === 400, 'no acepta una nota de voz de otra cuenta (400)');
  r = await request(server, { path: `/api/bebe/entradas/${entradaFoto.id}`, method: 'PATCH', body: { texto: 'hackeo' } }, ajena);
  ok(r.status === 404 && entradas.find((e) => e.id === entradaFoto.id).texto !== 'hackeo', 'otra cuenta no puede cambiar la nota (404)');
  r = await request(server, { path: `/api/bebe/audio/${entradaFoto.id}/0` }, paula);
  ok(r.status === 200 && r.body.equals(WEBM), 'la nota de voz original se puede escuchar');
  r = await request(server, { path: `/api/bebe/audio/${entradaFoto.id}/0?owner=1` }, ajena);
  ok(r.status === 403, 'una cuenta ajena no la escucha (403)');
  r = await request(server, { path: `/api/bebe/audio/${entradaFoto.id}/0` });
  ok(r.status === 401, 'sin sesión tampoco (401)');
  r = await request(server, { path: '/api/bebe/entradas', method: 'POST', body: { texto: 'Hoy dormimos la siesta juntas', audioUrl: voz1 } }, paula);
  ok(r.status === 200 && r.json.entrada.audios.length === 1, 'una nota de voz sin foto crea su propia entrada con el audio');
  const entradaVoz = r.json.entrada;
  r = await request(server, { path: `/api/bebe/entradas/${entradaVoz.id}`, method: 'PATCH', body: { texto: '', borrarAudios: true } }, paula);
  ok(r.status === 200 && r.json.entrada.audios.length === 0 && r.json.entrada.texto === '' && borrados.includes(voz1), '"borrar y volver a contar" quita el texto y borra los audios guardados');
  await request(server, { path: `/api/bebe/entradas/${entradaVoz.id}`, method: 'DELETE' }, paula);

  // --- Entrada "de la charla" (modo bebé): su grabación es la misma del libro ---
  const AUDIO_CHARLA = 'https://fake.public.blob.vercel-storage.com/audio/1/sesion-9/user-2.webm';
  subidos['audio/1/sesion-9/user-2.webm'] = WEBM;
  const filaCharla = { id: siguienteId++, profile_user_id: 1, texto: 'Hoy durmió toda la noche', media_url: null, audio_urls: JSON.stringify([AUDIO_CHARLA]), origen: 'charla', created_at: new Date().toISOString() };
  entradas.push(filaCharla);
  r = await request(server, { path: '/api/bebe' }, paula);
  const vistaCharla = r.json.entradas.find((e) => e.id === filaCharla.id);
  ok(vistaCharla && vistaCharla.deCharla === true && vistaCharla.audios.length === 1, 'la entrada que viene de la charla se marca "de la charla" y trae su grabación');
  r = await request(server, { path: vistaCharla.audios[0] }, paula);
  ok(r.status === 200, 'la grabación de la charla se escucha desde el diario');
  const borradosAntes = borrados.length;
  r = await request(server, { path: `/api/bebe/entradas/${filaCharla.id}`, method: 'DELETE' }, paula);
  ok(r.status === 200 && !borrados.slice(borradosAntes).includes(AUDIO_CHARLA), 'borrar esa entrada del diario NO borra la grabación (sigue en el libro)');
  r = await request(server, { path: '/api/bebe/audio/1/0', method: 'GET' }, ajena);
  ok(r.status !== 200, 'una cuenta ajena no escucha grabaciones del diario');

  r = await request(server, { path: '/api/bebe?owner=1' }, abuela);
  ok(r.status === 200 && r.json.config.nombre === 'Rafaela' && r.json.puedeEditar === false && r.json.entradas.length === 2, 'una familiar invitada ve el diario completo, sin poder editar');
  r = await request(server, { path: `/api/bebe/audio/${entradaFoto.id}/1?owner=1` }, abuela);
  ok(r.status === 200 && r.body.equals(WEBM), 'y escucha las notas de voz');
  r = await request(server, { path: entradaFoto.fotoUrl }, abuela);
  ok(r.status === 200 && r.body.equals(PNG_1X1), 'y puede ver las fotos');
  r = await request(server, { path: '/api/bebe/entradas?owner=1', method: 'POST', body: { texto: 'intento', owner: 1 } }, abuela);
  ok(entradas.filter((e) => e.profile_user_id === 1).length === 2, 'si intenta escribir en el diario de otra persona, no cambia nada del diario de Paula');
  r = await request(server, { path: '/api/bebe?owner=1', method: 'PUT', body: { nombre: 'Otra', owner: 1 } }, abuela);
  ok(diarios.find((d) => d.profile_user_id === 1).nombre === 'Rafaela', 'ni el nombre del bebé de Paula');
  r = await request(server, { path: `/api/bebe/entradas/${entradaFoto.id}?owner=1`, method: 'DELETE' }, abuela);
  ok(r.status !== 200 && entradas.length === 2, 'ni borrar nada');

  r = await request(server, { path: '/api/bebe?owner=1' }, ajena);
  ok(r.status === 403, 'una cuenta que nadie invitó no ve el diario (403)');
  r = await request(server, { path: entradaFoto.fotoUrl }, ajena);
  ok(r.status === 403, 'ni sus fotos (403)');
  r = await request(server, { path: entradaFoto.fotoUrl });
  ok(r.status === 401, 'sin sesión tampoco se ven las fotos (401)');
  r = await request(server, { path: '/api/bebe' }, ajena);
  ok(r.status === 200 && r.json.config === null, 'su propio diario es otro: vacío');

  r = await request(server, { path: '/api/bebe', method: 'PUT', body: { nombre: 'Rafaela', genero: 'femenino', nacioEn: new Date().toISOString().slice(0, 10) } }, paula);
  ok(r.status === 200 && r.json.config.estado === 'nacida', 'cuando nace: el diario pasa a "ya llegó" con su fecha');

  r = await request(server, { path: `/api/bebe/entradas/${entradaFoto.id}`, method: 'DELETE' }, ajena);
  ok(r.status === 404 && entradas.length === 2, 'otra cuenta no logra borrar una entrada ajena (404)');
  r = await request(server, { path: `/api/bebe/entradas/${entradaFoto.id}`, method: 'DELETE' }, paula);
  ok(r.status === 200 && entradas.length === 1 && borrados.includes(fotoUrl) && borrados.includes(voz2), 'ella borra la entrada y también se borran la foto y las notas de voz guardadas');

  // Archivar: deja de verse y se puede recuperar creándolo de nuevo
  r = await request(server, { path: '/api/bebe/archivar', method: 'POST' }, abuela);
  ok(diarios.some((d) => d.profile_user_id === 1 && !d.archivado), 'archivar desde otra cuenta no toca el diario de Paula (solo archiva el propio)');
  r = await request(server, { path: '/api/bebe/archivar', method: 'POST' }, paula);
  ok(r.status === 200, 'Paula archiva su diario');
  r = await request(server, { path: '/api/bebe' }, paula);
  ok(r.status === 200 && r.json.config === null && r.json.entradas.length === 0, 'archivado: ya no hay diario en la pantalla principal');
  r = await request(server, { path: '/api/bebe/entradas', method: 'POST', body: { texto: 'nota' } }, paula);
  ok(r.status === 409, 'y no se le agregan notas mientras está archivado');
  r = await request(server, { path: '/api/bebe/archivar', method: 'POST' }, paula);
  ok(r.status === 404, 'archivarlo otra vez no hace nada (404)');
  r = await request(server, { path: '/api/bebe', method: 'PUT', body: { nombre: 'Rafaela', genero: 'femenino' } }, paula);
  r = await request(server, { path: '/api/bebe' }, paula);
  ok(r.json.config && r.json.config.nombre === 'Rafaela', 'crear el diario de nuevo lo recupera');

  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})().catch((e) => { console.error('ERROR EN EL SMOKE TEST DEL DIARIO:', e); process.exit(1); });
