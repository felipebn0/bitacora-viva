// Panel de consumo: abre en "Hoy" y "Hoy" empieza a la medianoche de quien mira el panel (en Colombia, las 5 am UTC),
// no a las 7 pm del día anterior.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';

const fs = require('fs');
const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const HASH = bcrypt.hashSync('miclave123', 4);
function fakeSql(strings, ...v) {
  const text = strings.join('?');
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) return Promise.resolve(v[0] === 'admin' ? [{ id: 1, username: 'admin', password_hash: HASH, token_version: 0 }] : []);
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) return Promise.resolve([{ owner_user_id: null, token_version: 0 }]);
  if (text.includes('SELECT is_admin FROM users WHERE id')) return Promise.resolve([{ is_admin: true }]);
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);
const cache = (mod, exports) => { require.cache[require.resolve(mod)] = { id: require.resolve(mod), filename: require.resolve(mod), loaded: true, exports }; };
cache('@neondatabase/serverless', { neon: () => fakeSql });
cache('@vercel/blob', { put: async () => ({ url: 'x' }), del: async () => {}, list: async () => ({ blobs: [], hasMore: false }), get: async () => null });
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

(async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  ok(/\{ key: 'hoy', label: 'Hoy', dias: 1 \}/.test(html), 'el panel tiene el botón «Hoy»');
  ok(/let activePreset = 'hoy';/.test(html), 'y «Hoy» es la vista por defecto');
  ok(html.indexOf("key: 'hoy'") < html.indexOf("key: '7d'"), '«Hoy» va de primero');
  ok(/typeof data\.totalHistoricoUsd === 'number'/.test(html), 'el total histórico sale del que manda el servidor (el panel solo lista perfiles con uso)');

  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  const login = await pedir(server, 'POST', '/api/login', { username: 'admin', password: 'miclave123' });
  const cookie = login.headers['set-cookie'][0].split(';')[0];

  let r = await pedir(server, 'GET', '/api/admin/usage?start=2026-11-06&end=2026-11-06&tz=300', null, cookie);
  ok(r.status === 200 && r.json && r.json.range, 'el reporte responde con un rango');
  ok(r.json.range.start === '2026-11-06T05:00:00.000Z', 'con tz=300 (Colombia), «hoy» empieza a las 5:00 UTC (medianoche local)');
  ok(r.json.range.end === '2026-11-07T04:59:59.999Z', 'y termina a las 4:59:59 UTC del día siguiente (23:59:59 local)');

  r = await pedir(server, 'GET', '/api/admin/usage?start=2026-11-06&end=2026-11-06', null, cookie);
  ok(r.json.range.start === '2026-11-06T00:00:00.000Z', 'sin tz se comporta como antes (días en UTC)');

  r = await pedir(server, 'GET', '/api/admin/usage?start=2026-11-06&end=2026-11-06&tz=abc', null, cookie);
  ok(r.status === 200 && r.json.range.start === '2026-11-06T00:00:00.000Z', 'un tz que no es número se ignora');

  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
