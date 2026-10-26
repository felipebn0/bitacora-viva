// Fusionar dos personas del árbol: la principal ("Yo") nunca se borra, queda con el nombre más completo y
// todo lo que apuntaba a cualquiera de los dos nombres apunta a la persona fusionada.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');
const HASH = bcrypt.hashSync('miclave123', 4);
const users = { 1: { id: 1, username: 'felipe' } };
let miembros, notas, excluidos;
function reiniciar() {
  miembros = [
    { id: 1, nombre: 'Yo', es_principal: true, aliases: null, padres: JSON.stringify(['Ana María']) },
    { id: 2, nombre: 'Felipe Bernal', es_principal: false, aliases: null, padres: null },
    { id: 3, nombre: 'Ana María', es_principal: false, aliases: null, padres: null },
    { id: 4, nombre: 'Ana', es_principal: false, aliases: null, padres: null },
    { id: 5, nombre: 'Lope', es_principal: false, aliases: null, padres: JSON.stringify(['Felipe Bernal', 'Ana']) },
  ];
  notas = [{ id: 1, protagonista: 'Felipe Bernal' }, { id: 2, protagonista: 'Ana' }];
  excluidos = [];
}
reiniciar();
function fakeSql(strings, ...v) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) return Promise.resolve(v[0] === 'felipe' ? [{ id: 1, username: 'felipe', password_hash: HASH, token_version: 0 }] : []);
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) return Promise.resolve([{ owner_user_id: null, token_version: 0 }]);
  if (text.includes('FROM family_members WHERE user_id') && text.includes('nombre IN')) return Promise.resolve(miembros.filter((m) => m.nombre === v[1] || m.nombre === v[2]).map((m) => ({ ...m })));
  if (text.includes('DELETE FROM family_members WHERE id')) { miembros = miembros.filter((m) => m.id !== v[0]); return Promise.resolve([]); }
  if (text.includes('UPDATE family_members SET nombre')) { const m = miembros.find((x) => x.id === v[2]); m.nombre = v[0]; m.aliases = v[1]; return Promise.resolve([]); }
  if (text.includes('UPDATE family_notes SET protagonista')) { notas.forEach((n) => { if (n.protagonista === v[2] || n.protagonista === v[3]) n.protagonista = v[0]; }); return Promise.resolve([]); }
  if (text.includes('SELECT id, padres FROM family_members')) return Promise.resolve(miembros.filter((m) => m.padres).map((m) => ({ id: m.id, padres: m.padres })));
  if (text.includes('UPDATE family_members SET padres')) { miembros.find((x) => x.id === v[1]).padres = v[0]; return Promise.resolve([]); }
  if (text.includes('INSERT INTO family_members_excluidos')) { excluidos.push(v[1]); return Promise.resolve([]); }
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
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  const cookie = (await pedir(server, { path: '/api/login', method: 'POST', body: { username: 'felipe', password: 'miclave123' } })).headers['set-cookie'][0].split(';')[0];
  const fusionar = (body) => pedir(server, { path: '/api/tree/merge', method: 'POST', body }, cookie);

  let r = await fusionar({ keepNombre: 'Ana', mergeNombre: 'Ana', nuevoNombre: 'Ana' });
  ok(r.status === 400, 'dos nombres iguales no se fusionan');
  r = await fusionar({ keepNombre: 'Ana', mergeNombre: 'Nadie' });
  ok(r.status === 404 && /Nadie/.test(r.json.error), 'si una persona no existe lo dice');

  // Fusión normal: Ana + Ana María
  r = await fusionar({ keepNombre: 'Ana María', mergeNombre: 'Ana', nuevoNombre: 'Ana María' });
  ok(r.status === 200 && !miembros.some((m) => m.nombre === 'Ana'), 'se fusiona y la entrada duplicada desaparece');
  ok(JSON.parse(miembros.find((m) => m.nombre === 'Lope').padres).join(',') === 'Felipe Bernal,Ana María', 'lo que apuntaba a "Ana" ahora apunta a "Ana María"');
  ok(notas[1].protagonista === 'Ana María', 'y los recuerdos que hablaban de "Ana" quedan con "Ana María"');
  ok(JSON.parse(miembros.find((m) => m.nombre === 'Ana María').aliases).includes('ana'), 'el nombre viejo queda como alias');

  // Fusión con la persona principal: se conserva "Yo" pero con el nombre completo
  r = await fusionar({ keepNombre: 'Yo', mergeNombre: 'Felipe Bernal', nuevoNombre: 'Felipe Bernal' });
  ok(r.status === 200, 'fusionar a la persona principal con otra ya no da error');
  const yo = miembros.find((m) => m.es_principal);
  ok(yo && yo.nombre === 'Felipe Bernal' && miembros.filter((m) => m.nombre === 'Felipe Bernal').length === 1, 'la persona principal se conserva y queda con el nombre más completo');
  ok(JSON.parse(miembros.find((m) => m.nombre === 'Lope').padres).includes('Felipe Bernal') && notas[0].protagonista === 'Felipe Bernal', 'sus hijos y recuerdos siguen apuntando a ella');
  ok(JSON.parse(yo.aliases).includes('yo'), '"Yo" queda como alias');

  // El servidor nunca borra a la persona principal
  reiniciar();
  r = await fusionar({ keepNombre: 'Felipe Bernal', mergeNombre: 'Yo', nuevoNombre: 'Felipe Bernal' });
  ok(r.status === 409 && miembros.some((m) => m.es_principal), 'pedir borrar a la principal se rechaza (409)');

  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
