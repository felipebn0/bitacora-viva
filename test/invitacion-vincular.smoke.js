// Quien ya tiene cuenta y abre su enlace personal de invitado entra con su misma cuenta si el celular coincide.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');
const HASH = bcrypt.hashSync('miclave123', 4);
const users = {
  1: { id: 1, username: 'felipe', name: 'Felipe', phone: '+57 300 123 4567' },
  2: { id: 2, username: 'sincel', name: 'Sin Celular', phone: null },
  3: { id: 3, username: 'otro', name: 'Otro', phone: '+57 311 999 8888' },
  10: { id: 10, username: 'diego', name: 'Diego Vargas', phone: '+57 301 000 0000' },
};
const invitados = [
  { id: 'a', codigo: 'cod-felipe', owner_id: 10, owner_es_bitacora: false, nombre: 'Felipe', telefono: '573001234567', revocado_at: null },
  { id: 'b', codigo: 'cod-bitacora', owner_id: 900, owner_es_bitacora: true, nombre: 'Felipe', telefono: '573001234567', revocado_at: null },
  { id: 'c', codigo: 'cod-revocado', owner_id: 10, owner_es_bitacora: false, nombre: 'Felipe', telefono: '573001234567', revocado_at: new Date() },
  { id: 'd', codigo: 'cod-propio', owner_id: 1, owner_es_bitacora: false, nombre: 'Felipe', telefono: '573001234567', revocado_at: null },
];
const collabs = [];
function fakeSql(strings, ...v) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = Object.values(users).find((x) => x.username === v[0]);
    return Promise.resolve(u ? [{ id: u.id, username: u.username, password_hash: HASH, token_version: 0 }] : []);
  }
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) return Promise.resolve(users[v[0]] ? [{ owner_user_id: null, token_version: 0 }] : []);
  if (text.includes('FROM invitados WHERE codigo') && text.includes('revocado_at IS NULL')) {
    const i = invitados.find((x) => x.codigo === v[0] && !x.revocado_at);
    return Promise.resolve(i ? [i] : []);
  }
  if (text.includes('SELECT phone FROM users WHERE id')) return Promise.resolve([{ phone: users[v[0]].phone }]);
  if (text.includes('INSERT INTO collaborations')) { if (!collabs.some((c) => c[0] === v[0] && c[1] === v[1])) collabs.push([v[0], v[1]]); return Promise.resolve([]); }
  if (text.includes('SELECT name, username FROM users WHERE id')) { const u = users[v[0]]; return Promise.resolve(u ? [{ name: u.name, username: u.username }] : []); }
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);
const cache = (mod, exports) => { require.cache[require.resolve(mod)] = { id: require.resolve(mod), filename: require.resolve(mod), loaded: true, exports }; };
cache('@neondatabase/serverless', { neon: () => fakeSql });
cache('@vercel/blob', { put: async () => ({ url: 'x' }), del: async () => {}, list: async () => ({ blobs: [], hasMore: false }), get: async () => null });
cache('@anthropic-ai/sdk', class { constructor() {} });
const app = require(path.resolve(__dirname, '..', 'server.js'));

function pedir(server, opts, cookie) {
  return new Promise((resolve, reject) => {
    const host = '127.0.0.1:' + server.address().port;
    const cuerpo = opts.body ? JSON.stringify(opts.body) : null;
    const headers = { Origin: 'http://' + host };
    if (cuerpo) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(cuerpo); }
    if (cookie) headers.Cookie = cookie;
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path: opts.path, method: opts.method || 'GET', headers }, (res) => {
      const ch = []; res.on('data', (x) => ch.push(x));
      res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(ch).toString()); } catch (e) { /* nada */ } resolve({ status: res.statusCode, headers: res.headers, json }); });
    });
    r.on('error', reject); if (cuerpo) r.write(cuerpo); r.end();
  });
}
const entrar = async (server, u) => (await pedir(server, { path: '/api/login', method: 'POST', body: { username: u, password: 'miclave123' } })).headers['set-cookie'][0].split(';')[0];
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  const vincular = (cod, cookie) => pedir(server, { path: '/api/invitacion-vincular', method: 'POST', body: { invitacion: cod } }, cookie);
  const felipe = await entrar(server, 'felipe');

  let r = await vincular('cod-felipe');
  ok(r.status === 401, 'sin sesión no se puede');
  r = await vincular('cod-felipe', felipe);
  ok(r.status === 200 && r.json.ownerId === 10 && r.json.ownerName === 'Diego Vargas', 'con la cuenta de Felipe y su mismo celular: entra a la bitácora de Diego');
  ok(collabs.some((c) => c[0] === 1 && c[1] === 10), 'queda como colaborador con su propia cuenta');
  r = await vincular('cod-felipe', felipe);
  ok(r.status === 200 && collabs.length === 1, 'abrirlo otra vez no duplica nada');
  r = await vincular('cod-felipe', await entrar(server, 'otro'));
  ok(r.status === 403 && r.json.otroCelular && collabs.length === 1, 'una cuenta con otro celular no entra con ese enlace');
  r = await vincular('cod-felipe', await entrar(server, 'sincel'));
  ok(r.status === 403 && r.json.faltaCelular, 'una cuenta sin celular guardado recibe el aviso de agregarlo');
  r = await vincular('cod-revocado', felipe);
  ok(r.status === 404, 'un enlace quitado no sirve');
  r = await vincular('cod-bitacora', felipe);
  ok(r.status === 409, 'los enlaces de perfiles administrados siguen siendo sin cuenta');
  r = await vincular('cod-propio', felipe);
  ok(r.status === 400, 'no se invita a uno mismo a su propia bitácora');
  r = await vincular('no-existe', felipe);
  ok(r.status === 404, 'un enlace inventado no sirve');

  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
