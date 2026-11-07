// Enlace abierto: cualquiera entra a colaborar con nombre y apellido (obligatorios) y los Términos. Cada visita crea su
// propia fila de invitado, así dos personas con el mismo nombre no se ven los aportes.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';

const fs = require('fs');
const path = require('path');
const http = require('http');

const invitados = [];
const consentimientos = [];
function fakeSql(strings, ...v) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, name, username FROM users WHERE invite_code')) return Promise.resolve(v[0] === 'CODIGO123' ? [{ id: 1, name: 'felipe', username: 'felipe' }] : []);
  if (text.includes('SELECT id, nombre FROM bitacoras WHERE invite_code')) return Promise.resolve([]);
  if (text.includes('SELECT COUNT(*)::int AS n FROM invitados')) return Promise.resolve([{ n: invitados.filter((i) => i.origen === 'abierto').length }]);
  if (text.includes('INSERT INTO invitados')) {
    invitados.push({ id: v[0], owner_id: v[1], owner_es_bitacora: v[2], nombre: v[3], telefono: v[4], origen: 'abierto' });
    return Promise.resolve([]);
  }
  if (text.includes('INSERT INTO consentimientos')) { consentimientos.push(v); return Promise.resolve([]); }
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);
const cache = (mod, exports) => { require.cache[require.resolve(mod)] = { id: require.resolve(mod), filename: require.resolve(mod), loaded: true, exports }; };
cache('@neondatabase/serverless', { neon: () => fakeSql });
cache('@vercel/blob', { put: async () => ({ url: 'x' }), del: async () => {}, list: async () => ({ blobs: [], hasMore: false }), get: async () => null });
cache('@anthropic-ai/sdk', class { constructor() {} });
const app = require(path.resolve(__dirname, '..', 'server.js'));

function pedir(server, cuerpo) {
  return new Promise((resolve, reject) => {
    const host = '127.0.0.1:' + server.address().port;
    const datos = JSON.stringify(cuerpo);
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/guest-abierto', method: 'POST', headers: { Origin: 'http://' + host, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(datos) } }, (res) => {
      const ch = []; res.on('data', (x) => ch.push(x));
      res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(ch).toString()); } catch (e) { /* nada */ } resolve({ status: res.statusCode, headers: res.headers, json }); });
    });
    r.on('error', reject); r.write(datos); r.end();
  });
}
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };
const valido = { codigo: 'CODIGO123', nombre: 'maria josé', apellido: 'perez', acceptTerms: true };

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));

  let r = await pedir(server, valido);
  ok(r.status === 200 && r.json.ok && r.json.guestName === 'Maria José Perez' && /Felipe/i.test(r.json.ownerName), 'con nombre, apellido y términos entra (200) y queda registrado a su nombre completo');
  ok(/bv_session=/.test((r.headers['set-cookie'] || [''])[0]) && /HttpOnly/.test(r.headers['set-cookie'][0]), 'se crea la sesión de invitado (cookie HttpOnly)');
  ok(invitados.length === 1 && invitados[0].owner_id === 1 && /^abierto:/.test(invitados[0].telefono), 'se crea su propia fila de invitado, sin celular');
  ok(consentimientos.length === 1, 'queda el registro de que aceptó los Términos');

  r = await pedir(server, { ...valido, apellido: '' });
  ok(r.status === 400 && r.json.necesitaNombre, 'sin apellido no entra (400)');
  r = await pedir(server, { ...valido, nombre: ' ' });
  ok(r.status === 400, 'sin nombre no entra (400)');
  r = await pedir(server, { ...valido, nombre: 'a' });
  ok(r.status === 400, 'un nombre de una sola letra no sirve');
  r = await pedir(server, { ...valido, apellido: 'http://spam.co 123' });
  ok(r.status === 400, 'el apellido no acepta números ni direcciones');
  r = await pedir(server, { ...valido, acceptTerms: false });
  ok(r.status === 400 && r.json.necesitaTerminos, 'sin aceptar los Términos no entra (400)');
  r = await pedir(server, { ...valido, codigo: 'NOEXISTE1' });
  ok(r.status === 404, 'un enlace que no existe da 404');
  r = await pedir(server, { ...valido, codigo: '' });
  ok(r.status === 400, 'sin código da 400');
  ok(invitados.length === 1, 'ninguno de los intentos fallidos creó invitados');

  r = await pedir(server, valido);
  ok(r.status === 200 && invitados.length === 2 && invitados[0].id !== invitados[1].id, 'dos personas con el mismo nombre quedan con ids distintos (no se mezclan sus aportes)');

  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  ok(/origen IS DISTINCT FROM 'abierto'/.test(src), 'la lista de invitaciones personales no se llena con los visitantes del enlace abierto');
  ok(/UPDATE invitados SET revocado_at = now\(\) WHERE owner_id = \$\{req\.profileUserId\} AND origen = 'abierto'/.test(src), 'generar un enlace nuevo corta también a quienes entraron por el anterior');

  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
