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

    // --- Endurecimiento (reporte 2026-09-06, punto 5): límite de tamaño propio ---
    // /api/csp-report tiene su propio límite de 16kb (mucho más chico que
    // el 1mb global de otras rutas) -- un cuerpo que se pasa de eso tiene
    // que rechazarse con 413, no bancarse entero ni tirar un 500.
    stderrCapturado = '';
    const reporteGigante = JSON.stringify({
      'csp-report': {
        'document-uri': 'https://ejemplo.com/app.html',
        'effective-directive': 'script-src',
        'blocked-uri': 'https://ejemplo.com/' + 'x'.repeat(20 * 1024), // ~20kb, > el límite de 16kb
      },
    });
    const r4 = await post(server, { path: '/api/csp-report', contentType: 'application/csp-report', body: reporteGigante });
    check('cuerpo de ~20kb (> 16kb) -> 413, no 500 ni 204', r4.status === 413);
    check('un cuerpo rechazado por tamaño no llega a loguearse', !stderrCapturado.includes('[csp-report]'));

    // --- Endurecimiento: truncado de campos largos antes de loguear ---
    // Un campo individual (típicamente blocked-uri con una data: URI larga)
    // puede pesar la mayoría de esos 16kb sin que el cuerpo entero se pase
    // del límite -- eso igual se trunca antes de loguear, para no inflar el
    // log/Sentry con un valor que no aporta más información que sus
    // primeros caracteres.
    stderrCapturado = '';
    const urlLarga = 'https://ejemplo.com/' + 'a'.repeat(700); // > el tope de 500 para "bloqueado"
    const reporteConCampoLargo = JSON.stringify({
      'csp-report': {
        'document-uri': 'https://ejemplo.com/app.html',
        'effective-directive': 'connect-src', // directiva propia de este caso, no choca con los de arriba
        'blocked-uri': urlLarga,
      },
    });
    const r5 = await post(server, { path: '/api/csp-report', contentType: 'application/csp-report', body: reporteConCampoLargo });
    check('reporte con un campo largo (pero cuerpo < 16kb) -> 204 igual', r5.status === 204);
    check('el campo largo quedó truncado en el log (no aparece completo)', !stderrCapturado.includes(urlLarga));
    check('el log deja la marca "(truncado)" en el campo recortado', stderrCapturado.includes('(truncado)'));

    // --- Endurecimiento: deduplicación/muestreo de reportes repetidos ---
    // La misma combinación directiva+recurso-bloqueado, repetida en
    // seguida (como pasaría si un solo quiebre de CSP dispara el mismo
    // reporte desde muchas sesiones a la vez), se loguea una sola vez
    // dentro de la ventana -- las repeticiones se cuentan pero no inflan
    // el log ni Sentry. (La reaparición del log al vencer la ventana de 5
    // minutos no se prueba acá: no tiene sentido esperar 5 minutos reales
    // en un smoke test -- lo que sí se verifica es que la repetición
    // inmediata efectivamente se suprime.)
    stderrCapturado = '';
    const reporteRepetido = JSON.stringify({
      'csp-report': {
        'document-uri': 'https://ejemplo.com/otra-pagina.html', // página distinta a propósito
        'effective-directive': 'font-src', // directiva propia de este caso
        'blocked-uri': 'https://cdn-rota.ejemplo.com/tipografia.woff2',
      },
    });
    const rRep1 = await post(server, { path: '/api/csp-report', contentType: 'application/csp-report', body: reporteRepetido });
    check('primer reporte de una combinación nueva -> 204 y queda logueado', rRep1.status === 204 && stderrCapturado.includes('font-src'));
    stderrCapturado = '';
    const rRep2 = await post(server, { path: '/api/csp-report', contentType: 'application/csp-report', body: reporteRepetido });
    check('repetición inmediata de la misma combinación -> sigue devolviendo 204...', rRep2.status === 204);
    check('...pero NO se vuelve a loguear (deduplicada dentro de la ventana)', !stderrCapturado.includes('[csp-report]'));
  } finally {
    process.stderr.write = stderrWriteOriginal;
    server.close();
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
