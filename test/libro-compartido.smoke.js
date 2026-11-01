// Enlace para compartir el libro digital (/libro/<token>): lo crea o actualiza solo la cuenta dueña, lo abre cualquiera con el
// enlace SIN cuenta, solo sirve fotos y audios de la dueña, y se puede retirar.
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
  1: { id: 1, username: 'ana', password_hash: HASH, token_version: 0, owner_user_id: null },
  2: { id: 2, username: 'otra', password_hash: HASH, token_version: 0, owner_user_id: null },
};
const BASE = 'https://fake.public.blob.vercel-storage.com/';
const FOTO_ANA = 'media/libros/1/abc.jpg';
const AUDIO_ANA = 'audio/1/sesion-a/user-0.webm';
const FOTO_AJENA = 'media/libros/2/xyz.jpg';
const CONTENIDO = Buffer.from('0123456789abcdefghij');
let enlaces = [];

function fakeSql(strings, ...values) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = Object.values(users).find((x) => x.username === values[0]);
    return Promise.resolve(u ? [{ id: u.id, username: u.username, password_hash: u.password_hash, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) { const u = users[values[0]]; return Promise.resolve(u ? [{ owner_user_id: null, token_version: u.token_version }] : []); }
  if (text.includes('INSERT INTO libros_compartidos')) { enlaces.push({ token: values[0], owner_id: values[1], datos: values[2], medios: values[3], revoked_at: null, updated_at: new Date() }); return Promise.resolve([]); }
  if (text.includes('SELECT token FROM libros_compartidos WHERE owner_id')) { const e = enlaces.filter((x) => x.owner_id === values[0] && !x.revoked_at).pop(); return Promise.resolve(e ? [{ token: e.token }] : []); }
  if (text.includes('UPDATE libros_compartidos SET datos')) { const e = enlaces.find((x) => x.token === values[2] && x.owner_id === values[3]); if (e) { e.datos = values[0]; e.medios = values[1]; e.updated_at = new Date(); } return Promise.resolve([]); }
  if (text.includes('SELECT token,updated_at FROM libros_compartidos WHERE owner_id')) { const e = enlaces.filter((x) => x.owner_id === values[0] && !x.revoked_at).pop(); return Promise.resolve(e ? [{ token: e.token, updated_at: e.updated_at }] : []); }
  if (text.includes('SELECT datos FROM libros_compartidos WHERE token')) { const e = enlaces.find((x) => x.token === values[0] && !x.revoked_at); return Promise.resolve(e ? [{ datos: e.datos }] : []); }
  if (text.includes('SELECT owner_id,medios FROM libros_compartidos WHERE token')) { const e = enlaces.find((x) => x.token === values[0] && !x.revoked_at); return Promise.resolve(e ? [{ owner_id: e.owner_id, medios: e.medios }] : []); }
  if (text.includes('UPDATE libros_compartidos SET revoked_at')) { enlaces.filter((x) => x.owner_id === values[0] && !x.revoked_at).forEach((x) => { x.revoked_at = new Date(); }); return Promise.resolve([]); }
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);

function streamDe(buf) { return new ReadableStream({ start(c) { c.enqueue(new Uint8Array(buf)); c.close(); } }); }
require.cache[require.resolve('@neondatabase/serverless')] = { id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true, exports: { neon: () => fakeSql } };
require.cache[require.resolve('@vercel/blob')] = { id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true, exports: {
  put: async () => ({ url: 'x' }), del: async () => {}, list: async () => ({ blobs: [], hasMore: false }),
  get: async (clave, opts) => {
    if (![FOTO_ANA, AUDIO_ANA, FOTO_AJENA].includes(clave)) return null;
    const rango = opts && opts.headers && opts.headers.Range;
    const headers = new Headers();
    let cuerpo = CONTENIDO;
    if (rango) { const m = /bytes=(\d+)-(\d*)/.exec(rango); cuerpo = CONTENIDO.subarray(Number(m[1]), m[2] ? Number(m[2]) + 1 : undefined); headers.set('content-range', `bytes ${m[1]}-${Number(m[1]) + cuerpo.length - 1}/${CONTENIDO.length}`); headers.set('content-length', String(cuerpo.length)); return { statusCode: 206, stream: streamDe(cuerpo), headers, blob: { contentType: 'audio/webm', size: CONTENIDO.length } }; }
    return { statusCode: 200, stream: streamDe(cuerpo), headers, blob: { contentType: clave.endsWith('.jpg') ? 'image/jpeg' : 'audio/webm', size: CONTENIDO.length } };
  } } };
require.cache[require.resolve('@anthropic-ai/sdk')] = { id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true, exports: class { constructor() { this.messages = { create: async () => ({ content: [{ type: 'text', text: '[]' }] }) }; } } };
const app = require(serverPath);

function request(server, opts, cookie) {
  return new Promise((resolve, reject) => {
    const host = '127.0.0.1:' + server.address().port;
    const cuerpo = opts.body ? JSON.stringify(opts.body) : null;
    const headers = Object.assign({ Origin: 'http://' + host }, opts.headers || {});
    if (cuerpo) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(cuerpo); }
    if (cookie) headers.Cookie = cookie;
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path: opts.path, method: opts.method || 'GET', headers }, (res) => {
      const ch = []; res.on('data', (x) => ch.push(x));
      res.on('end', () => { const body = Buffer.concat(ch); let json = null; try { json = JSON.parse(body.toString()); } catch (e) { /* no es JSON */ } resolve({ status: res.statusCode, headers: res.headers, body, texto: body.toString(), json }); });
    });
    r.on('error', reject); if (cuerpo) r.write(cuerpo); r.end();
  });
}
const entrar = async (server, u) => (await request(server, { path: '/api/login', method: 'POST', body: { username: u, password: 'miclave123' } })).headers['set-cookie'][0].split(';')[0];
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

const libro = (extra = {}) => Object.assign({
  titulo: 'Los recuerdos de Ana', subtitulo: 'Para los nietos', dedicatoria: 'Con cariño', fecha: 'octubre de 2026',
  capitulos: [
    { id: 1, titulo: 'Infancia', tema: 'infancia', texto: 'Nací en una finca.\n\nMi mamá madrugaba.', fotos: [{ url: BASE + FOTO_ANA, pie: 'Con mamá' }, { url: BASE + FOTO_AJENA, pie: 'No es mía' }, { url: 'http://inseguro/media/libros/1/x.jpg', pie: 'sin https' }, { url: BASE + 'media/libros/1/../2/xyz.jpg', pie: 'con ..' }], audios: [{ url: BASE + AUDIO_ANA, pregunta: '¿Cómo era tu casa?' }] },
    { id: 2, titulo: 'El trabajo <b>x</b>', tema: 'trabajo', texto: 'Mi primer trabajo.', fotos: [], audios: [] },
  ],
}, extra);

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  const ana = await entrar(server, 'ana');
  const otra = await entrar(server, 'otra');

  let r = await request(server, { path: '/api/libro-compartido', method: 'POST', body: { datos: libro() } });
  ok(r.status === 401, 'sin sesión no se puede crear el enlace (401)');
  r = await request(server, { path: '/api/libro-compartido', method: 'POST', body: { datos: { titulo: 'x', capitulos: [] } } }, ana);
  ok(r.status === 400, 'un libro sin capítulos no se comparte (400)');

  r = await request(server, { path: '/api/libro-compartido', method: 'POST', body: { datos: libro() } }, ana);
  ok(r.status === 200 && /^http:\/\/127\.0\.0\.1:\d+\/libro\/[a-f0-9]{48}$/.test(r.json.url) && r.json.nuevo === true, 'la cuenta dueña crea su enlace');
  const token = r.json.token;
  const guardado = JSON.parse(enlaces[0].datos), medios = JSON.parse(enlaces[0].medios);
  ok(medios.length === 2 && medios[0] === BASE + FOTO_ANA && medios[1] === BASE + AUDIO_ANA, 'solo se guardan las fotos y audios que de verdad son de la dueña (la foto ajena, la que no es https y la de ".." se descartan)');
  ok(guardado.capitulos[0].fotos.length === 1 && guardado.capitulos[0].audios.length === 1, 'el libro queda con su única foto y su único audio');

  // Público
  r = await request(server, { path: `/libro/${token}` });
  ok(r.status === 200 && /text\/html/.test(r.headers['content-type']), 'sin cuenta ni cookie, el enlace abre la página del libro (200)');
  ok(/<title>Los recuerdos de Ana · Eco<\/title>/.test(r.texto) && /property="og:title" content="Los recuerdos de Ana"/.test(r.texto), 'con el título del libro y vista previa para WhatsApp');
  ok((r.texto.match(/id="indice"/g) || []).length === 1, 'el id "indice" (el cuadro "CAPÍTULO X DE N") está una sola vez en la página');
  ok(/<main class="plano">/.test(r.texto) && /id="contenido-lectura"/.test(r.texto) && /href="#cap-2"/.test(r.texto) && /id="cap-1"/.test(r.texto), 'trae la versión de lectura con índice con enlaces y cada capítulo en su tarjeta');
  ok(!/<b>x<\/b>/.test(r.texto) && /El trabajo &lt;b&gt;x&lt;\/b&gt;/.test(r.texto), 'el texto del libro se escapa (no entra HTML ajeno)');
  ok(new RegExp(`<img id="f-0-0" loading="lazy" src="/api/libro/${token}/m/0"`).test(r.texto) && new RegExp(`<audio id="a-0-0" controls preload="none" src="/api/libro/${token}/m/1"`).test(r.texto), 'las fotos y audios se piden por posición, no por la dirección del archivo');
  ok(!r.texto.includes(BASE) && !r.texto.includes('data:audio') && !r.texto.includes('fake.public'), 'la página no muestra las direcciones reales de los archivos');
  const datosJson = JSON.parse(r.texto.match(/<script type="application\/json" id="datos">([\s\S]*?)<\/script>/)[1]);
  ok(datosJson.capitulos[0].fotos[0].ref === 'f-0-0' && !datosJson.capitulos[0].fotos[0].src, 'los datos de la estantería solo apuntan a la foto, sin repetirla');
  ok(/noindex/.test(r.headers['x-robots-tag']) && /no-store/.test(r.headers['cache-control']), 'no se indexa ni se guarda en caché');
  ok(!r.headers['content-security-policy-report-only'] && !r.headers['content-security-policy'], 'la página no lleva política de contenido que la reporte (trae su propio estilo y programa)');
  ok(/@font-face\{font-family:"Source Serif 4"[^}]*url\(\/fonts\/files\/source-serif-4-latin-standard-normal\.woff2\)/.test(r.texto), 'las tipografías se piden al sitio (no van pegadas en la página)');

  r = await request(server, { path: `/api/libro/${token}/m/0` });
  ok(r.status === 200 && /^image\//.test(r.headers['content-type']) && r.body.equals(CONTENIDO), 'sin cuenta se ve la foto (200)');
  r = await request(server, { path: `/api/libro/${token}/m/1`, headers: { Range: 'bytes=2-5' } });
  ok(r.status === 206 && r.body.toString() === '2345', 'el audio responde por pedazos (206) para poder adelantar y retroceder');
  r = await request(server, { path: `/api/libro/${token}/m/7` });
  ok(r.status === 404, 'una posición que no existe -> 404');
  r = await request(server, { path: `/api/libro/${'d'.repeat(48)}/m/0` });
  ok(r.status === 404, 'un token inventado -> 404');
  r = await request(server, { path: '/libro/corto' });
  ok(r.status === 404 && /ya no está disponible/.test(r.texto), 'un enlace con mal formato -> página de "libro no disponible" (404)');

  // Actualizar: mismo enlace, libro nuevo
  r = await request(server, { path: '/api/libro-compartido', method: 'POST', body: { datos: libro({ titulo: 'Segunda versión' }) } }, ana);
  ok(r.status === 200 && r.json.token === token && r.json.nuevo === false && enlaces.length === 1, 'al descargar otra vez, el enlace se actualiza y sigue siendo el mismo');
  r = await request(server, { path: `/libro/${token}` });
  ok(/<title>Segunda versión · Eco<\/title>/.test(r.texto), 'y quien tiene el enlace ve el libro actualizado');

  // Gestión
  r = await request(server, { path: '/api/libro-compartido' }, ana);
  ok(r.status === 200 && r.json.activo === true && r.json.url.endsWith('/libro/' + token), 'la dueña ve su enlace activo');
  r = await request(server, { path: '/api/libro-compartido' }, otra);
  ok(r.json.activo === false, 'otra cuenta no ve el de ella');
  r = await request(server, { path: '/api/libro-compartido', method: 'DELETE' }, otra);
  ok(r.status === 200, 'otra cuenta puede pedir retirar, pero solo toca lo suyo');
  r = await request(server, { path: `/libro/${token}` });
  ok(r.status === 200, 'y el enlace de Ana sigue abriendo');
  r = await request(server, { path: '/api/libro-compartido', method: 'DELETE' }, ana);
  ok(r.status === 200, 'la dueña retira el enlace');
  r = await request(server, { path: `/libro/${token}` });
  ok(r.status === 404, 'un enlace retirado ya no abre (404)');
  r = await request(server, { path: `/api/libro/${token}/m/0` });
  ok(r.status === 404, 'ni sus fotos y audios (404)');
  r = await request(server, { path: '/api/libro-compartido', method: 'POST', body: { datos: libro() } }, ana);
  ok(r.json.nuevo === true && r.json.token !== token, 'si se vuelve a compartir, el enlace es nuevo');

  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
