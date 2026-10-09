// Redirección del link viejo al nuevo (Eco): /api/redirigir-dominio arma una
// redirección permanente a DOMINIO_NUEVO conservando la ruta y los parámetros.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.DOMINIO_NUEVO = 'https://Eco.Ejemplo.co/';
const path = require('path');
const http = require('http');
function fakeSql() { return Promise.resolve([]); }
fakeSql.transaction = (q) => Promise.all(q);
require.cache[require.resolve('@neondatabase/serverless')] = { id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true, exports: { neon: () => fakeSql } };
require.cache[require.resolve('@vercel/blob')] = { id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true, exports: { put: async () => ({ url: 'x' }), del: async () => {}, get: async () => null } };
require.cache[require.resolve('@anthropic-ai/sdk')] = { id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true, exports: class { constructor() {} } };
const app = require(path.resolve(__dirname, '..', 'server.js'));
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };
const pedir = (server, pth) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: server.address().port, path: pth }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location })); }).on('error', reject);
});
(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  let r = await pedir(server, '/api/redirigir-dominio?ruta=colaborar.html&invitacion=AbC_123');
  ok(r.status === 308 && r.location === 'https://eco.ejemplo.co/colaborar.html?invitacion=AbC_123', 'el enlace personal de invitado se conserva en el dominio nuevo (308, sin "https://" ni "/" de más en DOMINIO_NUEVO)');
  r = await pedir(server, '/api/redirigir-dominio?ruta=colaborar.html&codigo=ABCD1234');
  ok(r.location === 'https://eco.ejemplo.co/colaborar.html?codigo=ABCD1234', 'el enlace viejo con ?codigo= también');
  r = await pedir(server, '/api/redirigir-dominio?ruta=api%2Fmagic-login&token=a.b&next=%2Fapp.html');
  ok(r.location === 'https://eco.ejemplo.co/api/magic-login?token=a.b&next=%2Fapp.html', 'un enlace mágico de un correo viejo conserva el token y el destino');
  r = await pedir(server, '/api/redirigir-dominio');
  ok(r.status === 308 && r.location === 'https://eco.ejemplo.co/', 'sin ruta -> la portada del dominio nuevo');
  r = await pedir(server, '/api/redirigir-dominio?ruta=%2F%2Fmalo.com');
  ok(r.location === 'https://eco.ejemplo.co/malo.com', 'una ruta con "//" no puede sacar a otro sitio (siempre queda dentro del dominio nuevo)');
  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
