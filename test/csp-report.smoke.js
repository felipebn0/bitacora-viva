// Smoke test para /api/csp-report — primer paso de la ruta hacia CSP en
// enforce (2026-09-06): antes de extraer nada del inline de las 7 páginas,
// juntar violaciones REALES de gente navegando en vez de ir a ciegas por
// lectura de código. Cubre los dos formatos que puede mandar el navegador
// (report-uri viejo, report-to/Reporting API nuevo), que la ruta responde
// 204 sin sesión ni cookie, que queda afuera del chequeo de Origin (el
// navegador no siempre manda uno usable en este pedido en particular), y
// que la política y el header Reporting-Endpoints declaran esta misma
// ruta.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';

const path = require('path');
const http = require('http');

const serverPath = path.resolve(__dirname, '..', 'server.js');

function fakeSql(strings) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  return Promise.resolve([]);
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

// Capturamos stderr (adonde va console.error) para confirmar que el
// reporte quedó realmente logueado, sin exportar nada nuevo de server.js.
let stderrCapturado = '';
const stderrWriteOriginal = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  stderrCapturado += chunk.toString();
  return stderrWriteOriginal(chunk, ...args);
};

const app = require(serverPath);

function post(server, opts) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(opts.body);
    // A propósito SIN header Origin/Referer: así es como en la práctica
    // llega este pedido (lo dispara el navegador solo, no el JS de la
    // página), y es justo lo que se supone que /api/csp-report tolera.
    const headers = Object.assign({ 'Content-Type': opts.contentType, 'Content-Length': data.length }, opts.headers || {});
    const r = http.request({ hostname: '127.0.0.1', port: server.address().port, path: opts.path, method: 'POST', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    r.on('error', reject);
    r.write(data);
    r.end();
  });
}

function get(server, path) {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    r.on('error', reject);
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
    // --- La política y el header declaran esta misma ruta ---
    const home = await get(server, '/');
    const csp = home.headers['content-security-policy-report-only'] || '';
    check('la CSP pide report-uri hacia /api/csp-report', csp.includes('report-uri /api/csp-report'));
    check('la CSP pide report-to csp-endpoint', csp.includes('report-to csp-endpoint'));
    check('el header Reporting-Endpoints declara el grupo csp-endpoint hacia /api/csp-report', (home.headers['reporting-endpoints'] || '').includes('csp-endpoint="/api/csp-report"'));

    // --- Formato viejo: report-uri, Content-Type application/csp-report ---
    stderrCapturado = '';
    const reporteViejo = JSON.stringify({
      'csp-report': {
        'document-uri': 'https://ejemplo.com/app.html',
        'effective-directive': 'script-src',
        'blocked-uri': 'inline',
        'line-number': 42,
      },
    });
    const r1 = await post(server, { path: '/api/csp-report', contentType: 'application/csp-report', body: reporteViejo });
    check('formato viejo (report-uri) -> 204, sin Origin/Referer', r1.status === 204);
    check('el reporte viejo quedó logueado con [csp-report]', stderrCapturado.includes('[csp-report]'));
    check('el log trae la directiva real (script-src)', stderrCapturado.includes('script-src'));
    check('el log trae la URL bloqueada (inline)', stderrCapturado.includes('"bloqueado":"inline"'));

    // --- Formato nuevo: report-to, Content-Type application/reports+json, en lote ---
    stderrCapturado = '';
    const reporteNuevo = JSON.stringify([
      { type: 'csp-violation', body: { documentURL: 'https://ejemplo.com/app.html', effectiveDirective: 'style-src', blockedURL: 'inline', lineNumber: 7 } },
      { type: 'deprecation', body: { id: 'algo-no-relacionado' } }, // debe ignorarse: no es csp-violation
    ]);
    const r2 = await post(server, { path: '/api/csp-report', contentType: 'application/reports+json', body: reporteNuevo });
    check('formato nuevo (report-to, en lote) -> 204', r2.status === 204);
    check('el reporte nuevo quedó logueado (style-src)', stderrCapturado.includes('style-src'));
    check('el reporte "deprecation" (no csp-violation) del mismo lote NO se logueó', !stderrCapturado.includes('algo-no-relacionado'));

    // --- Un cuerpo vacío/basura no rompe la ruta ---
    const r3 = await post(server, { path: '/api/csp-report', contentType: 'application/csp-report', body: '{}' });
    check('cuerpo sin "csp-report" adentro -> igual 204, no 500', r3.status === 204);
  } finally {
    process.stderr.write = stderrWriteOriginal;
    server.close();
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
