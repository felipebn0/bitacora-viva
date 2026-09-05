// Smoke test para las tres mejoras "baratas" del hallazgo de CSP/errores
// (2026-09-05): apagar X-Powered-By, un id de correlación por pedido
// (X-Request-Id + prefijo en console.error), y que vercel.json tenga la
// misma política CSP-Report-Only para las páginas estáticas (que en
// producción nunca pasan por este server.js — ver el comentario junto a
// CSP_POLICY en server.js).
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';

const path = require('path');
const fs = require('fs');
const http = require('http');

const serverPath = path.resolve(__dirname, '..', 'server.js');

// Un query especial ("FORZAR_ERROR") deja pasar el DDL de ensureSchema pero
// tira una excepción real en cualquier otra consulta — así se puede forzar
// determinísticamente el catch(err){ console.error(err); ... } de una ruta
// cualquiera, sin tener que armar un escenario de negocio completo.
function fakeSql(strings, ...values) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  throw new Error('FORZAR_ERROR: fallo simulado de base de datos');
}
fakeSql.transaction = (queries) => Promise.all(queries);

require.cache[require.resolve('@neondatabase/serverless')] = {
  id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true,
  exports: { neon: () => fakeSql },
};
require.cache[require.resolve('@vercel/blob')] = {
  id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true,
  exports: { put: async () => ({ url: 'https://fake.public.blob.vercel-storage.com/x' }), del: async () => {}, get: async () => null },
};
require.cache[require.resolve('@anthropic-ai/sdk')] = {
  id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true,
  exports: class FakeAnthropic { constructor() {} },
};

// Capturamos lo que se escribe por stderr (adonde va console.error) para
// confirmar el prefijo "[req:<id>]" sin tener que exportar contextoDePedido
// desde server.js.
let stderrCapturado = '';
const stderrWriteOriginal = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  stderrCapturado += chunk.toString();
  return stderrWriteOriginal(chunk, ...args);
};

const app = require(serverPath);

function request(server, opts) {
  return new Promise((resolve, reject) => {
    const host = `127.0.0.1:${server.address().port}`;
    const headers = Object.assign({ Origin: `http://${host}` }, opts.headers || {});
    const r = http.request({ hostname: '127.0.0.1', port: server.address().port, path: opts.path, method: opts.method || 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    r.on('error', reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

let pasaron = 0;
let fallaron = 0;
function check(nombre, cond) {
  if (cond) { pasaron++; console.log('OK  -', nombre); }
  else { fallaron++; console.log('FAIL -', nombre); }
}

(async () => {
  const server = app.listen(0);
  try {
    // --- X-Powered-By apagado ---
    const r1 = await request(server, { path: '/api/login', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'x', password: 'y' }) });
    check('X-Powered-By no está presente en ninguna respuesta', r1.headers['x-powered-by'] === undefined);

    // --- X-Request-Id: presente y distinto entre pedidos ---
    const r2 = await request(server, { path: '/api/login', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'x', password: 'y' }) });
    check('X-Request-Id está presente', typeof r1.headers['x-request-id'] === 'string' && r1.headers['x-request-id'].length > 0);
    check('X-Request-Id es distinto en dos pedidos separados', r1.headers['x-request-id'] !== r2.headers['x-request-id']);

    // --- El error de este pedido (FORZAR_ERROR) salió por consola con el mismo id que el header ---
    const idDeR1 = r1.headers['x-request-id'];
    check('el error de esa misma respuesta 500 quedó logueado con el prefijo [req:<ese id>]', stderrCapturado.includes(`[req:${idDeR1}]`));
    check('el log también trae el mensaje real del error (FORZAR_ERROR)', stderrCapturado.includes('FORZAR_ERROR'));

    // --- CSP: en las páginas estáticas (que en prod no pasan por Express) también debe estar declarada en vercel.json ---
    const vercelJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'vercel.json'), 'utf8'));
    const rutaEstatica = vercelJson.routes.find((r) => r.src === '^/(?!api/).*');
    check('vercel.json tiene una regla de headers para las rutas no-api', !!(rutaEstatica && rutaEstatica.headers));
    const cspEstatica = rutaEstatica && rutaEstatica.headers['Content-Security-Policy-Report-Only'];
    check('esa regla incluye Content-Security-Policy-Report-Only', typeof cspEstatica === 'string' && cspEstatica.length > 0);
    check('la CSP de vercel.json no permite unsafe-inline (coherente con la de server.js)', !!cspEstatica && !cspEstatica.includes('unsafe-inline'));
  } finally {
    process.stderr.write = stderrWriteOriginal;
    server.close();
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
