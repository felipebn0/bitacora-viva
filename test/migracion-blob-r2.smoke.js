// Smoke test de POST /api/admin/migrar-blob-a-r2 (archivos viejos de Vercel
// Blob público -> R2). Cubre: solo admin; sin confirmar no toca nada; con
// confirmar copia a R2 con la misma clave, cambia la URL en TODAS las filas
// que la usan (story_log, family_notes, media), borra el original de Blob
// recién después, y si la copia falla deja la URL vieja y el original intactos.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';
process.env.R2_ACCOUNT_ID = 'cuenta123';
process.env.R2_BUCKET = 'bitacora-test';
process.env.R2_ACCESS_KEY_ID = 'ak-test';
process.env.R2_SECRET_ACCESS_KEY = 'sk-test';
process.env.R2_PUBLIC_URL = 'https://pub-abc123.r2.dev';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const HASH = bcrypt.hashSync('miclave123', 4);
const users = {
  1: { id: 1, username: 'admin', password_hash: HASH, token_version: 0, owner_user_id: null, is_admin: true },
  2: { id: 2, username: 'normal', password_hash: HASH, token_version: 0, owner_user_id: null, is_admin: false },
};

const BUENA = 'https://tienda1.public.blob.vercel-storage.com/audio/1/uno-abc123.webm';
const MALA = 'https://tienda1.public.blob.vercel-storage.com/audio/1/dos-def456.webm';
const FOTO = 'https://tienda1.public.blob.vercel-storage.com/media/1/foto-ghi789.jpg';
const R2URL = (k) => 'https://pub-abc123.r2.dev/' + k;

// Base en memoria.
const db = {
  story_log: [{ id: 1, audio_url: BUENA, audio_urls: JSON.stringify([BUENA]), media_urls: JSON.stringify([FOTO]) },
              { id: 2, audio_url: MALA, audio_urls: null, media_urls: null }],
  family_notes: [{ id: 1, audio_url: null, audio_urls: JSON.stringify([BUENA]), media_urls: null }],
  media: [{ id: 1, url: FOTO }],
};
const contiene = (v) => typeof v === 'string' && v.includes('.blob.vercel-storage.com/');

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
  if (text.includes('SELECT is_admin FROM users')) return Promise.resolve([{ is_admin: users[values[0]].is_admin }]);
  if (text.includes('FROM collaborations')) return Promise.resolve([]);

  if (text.startsWith('SELECT id, audio_url, audio_urls, media_urls FROM story_log')) return Promise.resolve(db.story_log.filter((r) => contiene(r.audio_url) || contiene(r.audio_urls) || contiene(r.media_urls)));
  if (text.startsWith('SELECT id, audio_url, audio_urls, media_urls FROM family_notes')) return Promise.resolve(db.family_notes.filter((r) => contiene(r.audio_url) || contiene(r.audio_urls) || contiene(r.media_urls)));
  if (text.startsWith('SELECT id, url FROM media')) return Promise.resolve(db.media.filter((r) => contiene(r.url)));
  if (text.includes('count(*)::int AS n FROM story_log')) return Promise.resolve([{ n: db.story_log.filter((r) => contiene(r.audio_url) || contiene(r.audio_urls) || contiene(r.media_urls)).length }]);
  if (text.includes('count(*)::int AS n FROM family_notes')) return Promise.resolve([{ n: db.family_notes.filter((r) => contiene(r.audio_url) || contiene(r.audio_urls) || contiene(r.media_urls)).length }]);
  if (text.includes('count(*)::int AS n FROM media')) return Promise.resolve([{ n: db.media.filter((r) => contiene(r.url)).length }]);
  if (text.includes('UNION ALL SELECT url AS u FROM media')) {
    const all = [...db.story_log.map((r) => r.audio_url), ...db.media.map((r) => r.url)].filter((u) => typeof u === 'string' && u.startsWith('https://pub-abc123.r2.dev/'));
    return Promise.resolve(all.length ? [{ u: all[0] }] : []);
  }
  if (text.startsWith('UPDATE story_log SET audio_url = replace')) {
    const [vieja, nueva] = values;
    const rep = (v) => (typeof v === 'string' ? v.split(vieja).join(nueva) : v);
    db.story_log.forEach((r) => { r.audio_url = rep(r.audio_url); r.audio_urls = rep(r.audio_urls); r.media_urls = rep(r.media_urls); });
    return Promise.resolve([]);
  }
  if (text.startsWith('UPDATE family_notes SET audio_url = replace')) {
    const [vieja, nueva] = values;
    const rep = (v) => (typeof v === 'string' ? v.split(vieja).join(nueva) : v);
    db.family_notes.forEach((r) => { r.audio_url = rep(r.audio_url); r.audio_urls = rep(r.audio_urls); r.media_urls = rep(r.media_urls); });
    return Promise.resolve([]);
  }
  if (text.startsWith('UPDATE media SET url = replace')) {
    const [vieja, nueva] = values;
    db.media.forEach((r) => { r.url = r.url.split(vieja).join(nueva); });
    return Promise.resolve([]);
  }
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);

const borradosDeBlob = [];
const subidosAR2 = {};
const fetchOriginal = global.fetch;
global.fetch = async (url, opts = {}) => {
  const esRequest = url && typeof url === 'object' && typeof url.url === 'string';
  const u = esRequest ? url.url : String(url);
  const metodo = (esRequest ? url.method : opts.method) || 'GET';
  if (u.includes('r2.cloudflarestorage.com')) {
    const clave = decodeURIComponent(u.split('/bitacora-test/')[1] || '');
    if (metodo === 'PUT') {
      if (clave.includes('dos-def456')) return new Response('boom', { status: 500 });
      const cuerpo = esRequest ? Buffer.from(await url.arrayBuffer()) : Buffer.from(opts.body);
      subidosAR2[clave] = cuerpo;
      return new Response('', { status: 200 });
    }
    if (metodo === 'HEAD') {
      const b = subidosAR2[clave];
      return b ? new Response('', { status: 200, headers: { 'content-length': String(b.length) } }) : new Response('', { status: 404 });
    }
    return new Response('', { status: 404 });
  }
  if (u.startsWith('https://pub-abc123.r2.dev/')) return new Response('', { status: 403 });
  if (u.includes('.blob.vercel-storage.com')) {
    return new Response(Buffer.from('contenido-de:' + u.split('/').pop()), { status: 200, headers: { 'Content-Type': 'audio/webm' } });
  }
  return fetchOriginal(url, opts);
};

require.cache[require.resolve('@neondatabase/serverless')] = { id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true, exports: { neon: () => fakeSql } };
require.cache[require.resolve('@vercel/blob')] = { id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true, exports: { put: async () => ({ url: 'x' }), del: async (u) => { borradosDeBlob.push(u); }, get: async () => null, list: async () => ({ blobs: [], hasMore: false }) } };
require.cache[require.resolve('@anthropic-ai/sdk')] = { id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true, exports: class { constructor() {} } };

const app = require(serverPath);

function llamar(server, metodo, pth, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const host = '127.0.0.1:' + server.address().port;
    const headers = { Origin: 'http://' + host };
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    if (cookie) headers.Cookie = cookie;
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path: pth, method: metodo, headers }, (res) => {
      const ch = []; res.on('data', (c) => ch.push(c));
      res.on('end', () => { const t = Buffer.concat(ch).toString(); let j = null; try { j = JSON.parse(t); } catch (e) {} resolve({ status: res.statusCode, headers: res.headers, json: j }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
async function login(server, username) {
  const r = await llamar(server, 'POST', '/api/login', { username, password: 'miclave123' });
  return r.headers['set-cookie'][0].split(';')[0];
}

let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  const admin = await login(server, 'admin');
  const normal = await login(server, 'normal');
  const URL_MIG = '/api/admin/migrar-blob-a-r2';

  const r0 = await llamar(server, 'POST', URL_MIG, {}, normal);
  ok(r0.status === 403, 'una cuenta que no es admin -> 403');
  const r00 = await llamar(server, 'POST', URL_MIG, {});
  ok(r00.status === 401 || r00.status === 403, 'sin sesión -> 401/403');

  const antes = JSON.stringify(db);
  const r1 = await llamar(server, 'POST', URL_MIG, {}, admin);
  ok(r1.status === 200 && r1.json.dryRun === true, 'sin confirmar -> dry run');
  ok(r1.json.filasConArchivoViejo.story_log === 2 && r1.json.filasConArchivoViejo.family_notes === 1 && r1.json.filasConArchivoViejo.media === 1, 'el dry run cuenta las filas con archivos viejos');
  ok(r1.json.archivosEnEsteLote === 3, 'el dry run cuenta 3 archivos distintos (la misma URL en varias filas cuenta una vez)');
  ok(JSON.stringify(db) === antes && !borradosDeBlob.length && !Object.keys(subidosAR2).length, 'el dry run no toca la base, ni R2, ni Blob');

  const r2 = await llamar(server, 'POST', URL_MIG, { confirmar: true }, admin);
  ok(r2.status === 200 && r2.json.dryRun === false, 'con confirmar -> ejecuta');
  ok(r2.json.migradas === 2, 'migra los 2 archivos que se pudieron copiar');
  ok(r2.json.fallidas.length === 1 && r2.json.fallidas[0].url === MALA, 'el que falló en R2 queda listado como fallido');

  const claveBuena = 'audio/1/uno-abc123.webm';
  const claveFoto = 'media/1/foto-ghi789.jpg';
  ok(subidosAR2[claveBuena] && subidosAR2[claveBuena].toString() === 'contenido-de:uno-abc123.webm', 'se copió el contenido a R2 con la MISMA clave');
  ok(db.story_log[0].audio_url === R2URL(claveBuena) && db.story_log[0].audio_urls === JSON.stringify([R2URL(claveBuena)]), 'story_log: URL reemplazada (texto plano y JSON)');
  ok(db.story_log[0].media_urls === JSON.stringify([R2URL(claveFoto)]), 'story_log.media_urls: foto reemplazada');
  ok(db.family_notes[0].audio_urls === JSON.stringify([R2URL(claveBuena)]), 'family_notes: la MISMA URL también se reemplazó en otra tabla');
  ok(db.media[0].url === R2URL(claveFoto), 'media.url reemplazada');
  ok(borradosDeBlob.includes(BUENA) && borradosDeBlob.includes(FOTO), 'los originales se borran de Blob solo después de reemplazar');
  ok(db.story_log[1].audio_url === MALA && !borradosDeBlob.includes(MALA), 'el que falló: URL vieja intacta y el original NO se borra');

  const r3 = await llamar(server, 'POST', URL_MIG, {}, admin);
  ok(r3.json.filasConArchivoViejo.story_log === 1 && r3.json.filasConArchivoViejo.family_notes === 0 && r3.json.filasConArchivoViejo.media === 0, 'el dry run posterior solo ve lo que falló');
  ok(r3.json.r2PublicoAbierto === false, 'detecta que el bucket de R2 ya NO responde en público (403)');

  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
