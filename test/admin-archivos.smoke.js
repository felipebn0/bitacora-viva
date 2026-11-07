// Panel de consumo: el espacio de archivos de todos los perfiles sale de 2 listados en total (audio/ y media/), no de
// 3 consultas por cada cuenta, y se guarda unos minutos. Antes el panel se ponía lentísimo con cientos de cuentas.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';
delete process.env.R2_BUCKET;

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const HASH = bcrypt.hashSync('miclave123', 4);
const filaDelPerfil = (extra) => new Proxy(Object.assign({ id: 5, nombre: 'ana', username: 'ana', email: 'ana@x.co' }, extra), { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? 0 : undefined)) });
const perfiles = [filaDelPerfil({ id: 5 }), filaDelPerfil({ id: 6, nombre: 'luis', username: 'luis', email: 'l@x.co' }), filaDelPerfil({ id: 7, nombre: 'sin archivos', username: 'sa', email: 's@x.co' })];

function fakeSql(strings, ...v) {
  const text = strings.join('?');
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) return Promise.resolve(v[0] === 'admin' ? [{ id: 1, username: 'admin', password_hash: HASH, token_version: 0 }] : []);
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) return Promise.resolve([{ owner_user_id: null, token_version: 0 }]);
  if (text.includes('SELECT is_admin FROM users WHERE id')) return Promise.resolve([{ is_admin: true }]);
  if (text.includes('usage_all')) return Promise.resolve(perfiles);
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);

const listados = [];
const archivos = {
  'audio/': [
    { pathname: 'audio/5/a.webm', size: 1000 },
    { pathname: 'audio/aportes/5/b.webm', size: 500 },
    { pathname: 'audio/6/c.webm', size: 200 },
    { pathname: 'audio/aportes/xyz/ignorado.webm', size: 9 },
  ],
  'media/': [
    { pathname: 'media/5/foto-1.jpg', size: 300 },
    { pathname: 'media/5/video-1.mp4', size: 4000 },
    { pathname: 'media/5/bebe/voz-x.webm', size: 999 },
    { pathname: 'media/6/foto-2.jpg', size: 50 },
  ],
};
const cache = (mod, exports) => { require.cache[require.resolve(mod)] = { id: require.resolve(mod), filename: require.resolve(mod), loaded: true, exports }; };
cache('@neondatabase/serverless', { neon: () => fakeSql });
cache('@vercel/blob', { put: async () => ({ url: 'x' }), del: async () => {}, get: async () => null, list: async ({ prefix }) => { listados.push(prefix); return { blobs: archivos[prefix] || [], hasMore: false }; } });
cache('@anthropic-ai/sdk', class { constructor() {} });
const app = require(path.resolve(__dirname, '..', 'server.js'));

function pedir(server, metodo, ruta, cuerpo, cookie) {
  return new Promise((resolve, reject) => {
    const host = '127.0.0.1:' + server.address().port;
    const datos = cuerpo ? JSON.stringify(cuerpo) : null;
    const headers = { Origin: 'http://' + host };
    if (datos) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(datos); }
    if (cookie) headers.Cookie = cookie;
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path: ruta, method: metodo, headers }, (res) => {
      const ch = []; res.on('data', (x) => ch.push(x));
      res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(ch).toString()); } catch (e) { /* nada */ } resolve({ status: res.statusCode, headers: res.headers, json }); });
    });
    r.on('error', reject); if (datos) r.write(datos); r.end();
  });
}
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };
const buscar = (obj, clave) => { if (!obj || typeof obj !== 'object') return undefined; if (clave in obj) return obj[clave]; for (const v of Object.values(obj)) { const r = buscar(v, clave); if (r !== undefined) return r; } return undefined; };

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  const login = await pedir(server, 'POST', '/api/login', { username: 'admin', password: 'miclave123' });
  const cookie = login.headers['set-cookie'][0].split(';')[0];

  let r = await pedir(server, 'GET', '/api/admin/usage?start=2026-11-06&end=2026-11-06&tz=300', null, cookie);
  ok(r.status === 200 && Array.isArray(r.json.profiles) && r.json.profiles.length === 3, 'el panel carga con 3 perfiles');
  ok(listados.length === 2 && listados.includes('audio/') && listados.includes('media/'), 'pide solo 2 listados de archivos (no 3 por perfil): ' + JSON.stringify(listados));
  const ana = r.json.profiles.find((p) => p.id === 5);
  const luis = r.json.profiles.find((p) => p.id === 6);
  const sin = r.json.profiles.find((p) => p.id === 7);
  ok(buscar(ana, 'audioBytes') === 1500 && buscar(ana, 'audioCount') === 2, 'los audios propios y los aportes se suman a cada perfil (1500 bytes, 2 archivos)');
  ok(buscar(ana, 'fotoBytes') === 300 && buscar(ana, 'videoBytes') === 4000, 'fotos y videos se reparten bien (la nota de voz del bebé no cuenta como foto ni video)');
  ok(buscar(luis, 'audioBytes') === 200 && buscar(luis, 'fotoBytes') === 50, 'cada perfil recibe solo lo suyo');
  ok(buscar(sin, 'audioBytes') === 0 && buscar(sin, 'fotoCount') === 0, 'un perfil sin archivos queda en cero');

  r = await pedir(server, 'GET', '/api/admin/usage?start=2026-11-01&end=2026-11-06&tz=300', null, cookie);
  ok(r.status === 200 && listados.length === 2, 'al cambiar de rango no se vuelve a consultar el almacenamiento (queda guardado unos minutos)');

  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
