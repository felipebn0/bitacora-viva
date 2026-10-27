// Los QR del libro son públicos: quien los escanea escucha las grabaciones SIN cuenta. Solo la
// cuenta dueña crea, comprueba y retira el enlace; el token (48 hex) es la llave y se puede revocar.
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
const AUDIO_1 = 'audio/1/sesion-a/user-0.webm';
const AUDIO_AJENO = 'audio/2/sesion-b/user-0.webm';
const CONTENIDO = Buffer.from('0123456789abcdefghij');
const T1 = 'a'.repeat(48), T_REVOCADO = 'b'.repeat(48), T_AJENO = 'c'.repeat(48);
const enlaces = [
  { token: T1, owner_id: 1, chapter_id: 7, chapter_title: 'Infancia', audio_urls: JSON.stringify([`https://fake.public.blob.vercel-storage.com/${AUDIO_1}`, 'https://fake.public.blob.vercel-storage.com/audio/1/sesion-a/user-1.webm']), revoked_at: null },
  { token: T_REVOCADO, owner_id: 1, chapter_id: 8, chapter_title: 'Retirado', audio_urls: JSON.stringify([`https://fake.public.blob.vercel-storage.com/${AUDIO_1}`]), revoked_at: new Date() },
  // enlace manipulado: apunta al audio de OTRA cuenta
  { token: T_AJENO, owner_id: 1, chapter_id: 9, chapter_title: 'Manipulado', audio_urls: JSON.stringify([`https://fake.public.blob.vercel-storage.com/${AUDIO_AJENO}`]), revoked_at: null },
];

function fakeSql(strings, ...values) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = Object.values(users).find((x) => x.username === values[0]);
    return Promise.resolve(u ? [{ id: u.id, username: u.username, password_hash: u.password_hash, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) { const u = users[values[0]]; return Promise.resolve(u ? [{ owner_user_id: null, token_version: u.token_version }] : []); }
  if (text.includes('SELECT owner_id,chapter_title,audio_urls FROM book_audio_links WHERE token')) {
    const e = enlaces.find((x) => x.token === values[0] && !x.revoked_at);
    return Promise.resolve(e ? [{ owner_id: e.owner_id, chapter_title: e.chapter_title, audio_urls: e.audio_urls }] : []);
  }
  if (text.includes('SELECT owner_id,audio_urls FROM book_audio_links WHERE token')) {
    const e = enlaces.find((x) => x.token === values[0] && !x.revoked_at);
    return Promise.resolve(e ? [{ owner_id: e.owner_id, audio_urls: e.audio_urls }] : []);
  }
  if (text.includes('SELECT 1 FROM book_audio_links WHERE token') && text.includes('owner_id')) {
    const e = enlaces.find((x) => x.token === values[0] && x.owner_id === values[1] && !x.revoked_at);
    return Promise.resolve(e ? [{ '?column?': 1 }] : []);
  }
  if (text.includes('SELECT id, texto, audio_url, audio_urls FROM story_log WHERE user_id')) {
    return Promise.resolve([{ id: 5, texto: 'Crecí en Medellín.', audio_url: `https://fake.public.blob.vercel-storage.com/${AUDIO_1}`, audio_urls: null }, { id: 6, texto: 'Mi papá era arriero y viajaba mucho.', audio_url: 'https://fake.public.blob.vercel-storage.com/audio/1/sesion-a/user-1.webm', audio_urls: null }]);
  }
  if (text.includes('SELECT intercambios FROM sessions WHERE user_id')) {
    return Promise.resolve([{ intercambios: [
      { role: 'assistant', content: 'Qué bueno verte. Cuéntame, ¿dónde creciste?' },
      { role: 'user', content: 'Crecí en Medellín.' },
    ] }]);
  }
  if (text.includes('UPDATE book_audio_links SET revoked_at')) {
    enlaces.filter((x) => x.owner_id === values[0] && x.chapter_id === values[1] && !x.revoked_at).forEach((x) => { x.revoked_at = new Date(); });
    return Promise.resolve([]);
  }
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);

function streamDe(buf) { return new ReadableStream({ start(c) { c.enqueue(new Uint8Array(buf)); c.close(); } }); }
require.cache[require.resolve('@neondatabase/serverless')] = { id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true, exports: { neon: () => fakeSql } };
require.cache[require.resolve('@vercel/blob')] = { id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true, exports: {
  put: async () => ({ url: 'x' }), del: async () => {}, list: async () => ({ blobs: [], hasMore: false }),
  get: async (clave, opts) => {
    if (clave !== AUDIO_1 && clave !== AUDIO_AJENO) return null;
    const rango = opts && opts.headers && opts.headers.Range;
    const headers = new Headers();
    let cuerpo = CONTENIDO;
    if (rango) { const m = /bytes=(\d+)-(\d*)/.exec(rango); cuerpo = CONTENIDO.subarray(Number(m[1]), m[2] ? Number(m[2]) + 1 : undefined); headers.set('content-range', `bytes ${m[1]}-${Number(m[1]) + cuerpo.length - 1}/${CONTENIDO.length}`); headers.set('content-length', String(cuerpo.length)); }
    return { statusCode: 200, stream: streamDe(cuerpo), headers, blob: { contentType: 'audio/webm', size: CONTENIDO.length } };
  } } };
require.cache[require.resolve('@anthropic-ai/sdk')] = { id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true, exports: class { constructor() { this.messages = { create: async (p) => ({ content: [{ type: 'text', text: JSON.stringify(p.messages[0].content.split('\n\n').map((b) => (/SIN PREGUNTA/.test(b) ? 'Hablando de su papá arriero' : '¿En qué ciudad creciste?'))) }], usage: { input_tokens: 1, output_tokens: 1 } }) }; } } };
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
  const ana = await entrar(server, 'ana');
  const otra = await entrar(server, 'otra');

  // --- Público: sin cuenta ni cookie ---
  let r = await request(server, { path: `/api/book-qr/listen/${T1}` });
  ok(r.status === 200 && r.json.title === 'Infancia' && r.json.audios.length === 2, 'sin sesión: el QR abre el capítulo y lista sus grabaciones (200)');
  ok(r.json.audios[0] === `/api/book-qr/audio/${T1}/0`, 'las grabaciones se piden por token y posición, no por la ruta del archivo');
  ok(Array.isArray(r.json.preguntas) && r.json.preguntas[0] === '¿En qué ciudad creciste?', 'cada grabación trae su pregunta; si era muy corta para entenderse sola, viene completa');
  ok(r.json.preguntas[1] === 'Hablando de su papá arriero', 'si una nota no tiene pregunta, trae un contexto breve en su lugar');
  ok(r.headers['cache-control'] === 'no-store' && /noindex/.test(r.headers['x-robots-tag']), 'no se guarda en caché ni se indexa en buscadores');
  r = await request(server, { path: `/api/book-qr/audio/${T1}/0` });
  ok(r.status === 200 && /^audio\//.test(r.headers['content-type']) && r.body.equals(CONTENIDO), 'sin sesión: se oye la grabación (200, audio completo)');
  ok(r.headers['accept-ranges'] === 'bytes', 'con soporte de rangos (Safari en iPhone lo exige)');
  r = await request(server, { path: `/api/book-qr/audio/${T1}/0`, headers: { Range: 'bytes=2-5' } });
  ok(r.status === 206 && r.body.toString() === '2345' && /^bytes 2-5\/20$/.test(r.headers['content-range']), 'y responde pedazos (206) para poder adelantar y retroceder');

  // --- Lo que NO se puede abrir ---
  r = await request(server, { path: `/api/book-qr/listen/${T_REVOCADO}` });
  ok(r.status === 404, 'un enlace retirado ya no abre (404)');
  r = await request(server, { path: `/api/book-qr/audio/${T_REVOCADO}/0` });
  ok(r.status === 404, 'ni sus audios (404)');
  r = await request(server, { path: `/api/book-qr/listen/${'d'.repeat(48)}` });
  ok(r.status === 404, 'un token inventado -> 404');
  r = await request(server, { path: '/api/book-qr/listen/corto' });
  ok(r.status === 404, 'un token con mal formato -> 404');
  r = await request(server, { path: `/api/book-qr/audio/${T1}/5` });
  ok(r.status === 404, 'una posición que no existe -> 404');
  r = await request(server, { path: `/api/book-qr/audio/${T1}/..%2F..%2Fetc` });
  ok(r.status === 404, 'una posición con ruta rara -> 404');
  r = await request(server, { path: `/api/book-qr/audio/${T_AJENO}/0` });
  ok(r.status === 404, 'un enlace que apunta al audio de otra cuenta no lo entrega (404)');
  r = await request(server, { path: `/api/media-file?u=${encodeURIComponent('https://fake.public.blob.vercel-storage.com/' + AUDIO_1)}` });
  ok(r.status === 401, 'los archivos en sí siguen privados: /api/media-file sigue pidiendo sesión (401)');

  // --- Solo la dueña crea, comprueba y retira ---
  r = await request(server, { path: '/api/book-qr/chapters/7', method: 'POST' });
  ok(r.status === 401, 'crear un QR sin sesión -> 401');
  r = await request(server, { path: `/api/book-qr/owned/${T1}` });
  ok(r.status === 401, 'comprobar de quién es un QR sin sesión -> 401');
  r = await request(server, { path: `/api/book-qr/owned/${T1}` }, ana);
  ok(r.status === 200, 'la dueña comprueba que el QR es suyo (200)');
  r = await request(server, { path: `/api/book-qr/owned/${T1}` }, otra);
  ok(r.status === 404, 'otra cuenta no lo puede dar por suyo (404)');
  r = await request(server, { path: '/api/book-qr/chapters/7', method: 'DELETE' });
  ok(r.status === 401, 'retirar un enlace sin sesión -> 401');
  r = await request(server, { path: '/api/book-qr/chapters/7', method: 'DELETE' }, otra);
  ok(r.status === 200 && !enlaces[0].revoked_at, 'otra cuenta no logra retirar el enlace de la dueña (no cambia nada)');
  r = await request(server, { path: '/api/book-qr/chapters/7', method: 'DELETE' }, ana);
  ok(r.status === 200 && enlaces[0].revoked_at instanceof Date, 'la dueña retira el enlace');
  r = await request(server, { path: `/api/book-qr/listen/${T1}` });
  ok(r.status === 404, 'los QR ya impresos de ese capítulo dejan de funcionar (404)');

  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
