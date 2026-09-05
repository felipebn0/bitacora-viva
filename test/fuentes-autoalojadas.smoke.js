// Smoke test para las fuentes autoalojadas — ronda 2 del camino hacia CSP
// en enforce (2026-09-06). Antes las 7 páginas de public/ cargaban Source
// Serif 4 y Atkinson Hyperlegible desde fonts.googleapis.com/gstatic.com:
// eso violaba la política (font-src 'self', desde la cuarta ronda) en
// cada visita, y de paso mandaba la IP de quien mira la app a un tercero
// solo para traer una tipografía. Ahora las sirve el propio servidor
// desde public/fonts/ (archivos extraídos de los paquetes de Fontsource,
// mismo binario que usa Google, empaquetado para autoalojar).
//
// Cubre: ninguna de las 7 páginas sigue enlazando el dominio externo,
// las 7 sí enlazan la hoja de estilos local, esa hoja sirve con el
// Content-Type correcto y declara las dos familias con los pesos que se
// pedían antes (Atkinson 400/700, Source Serif 4 variable 200-900 con
// itálica), y al menos un archivo .woff2 de cada familia se sirve con el
// Content-Type font/woff2.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';

const fs = require('fs');
const path = require('path');
const http = require('http');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const publicDir = path.resolve(__dirname, '..', 'public');

require.cache[require.resolve('@neondatabase/serverless')] = {
  id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true,
  exports: { neon: () => { const f = () => Promise.resolve([]); f.transaction = (qs) => Promise.all(qs); return f; } },
};
require.cache[require.resolve('@vercel/blob')] = {
  id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true,
  exports: { put: async () => ({ url: 'https://fake.public.blob.vercel-storage.com/x' }), del: async () => {}, get: async () => null },
};
require.cache[require.resolve('@anthropic-ai/sdk')] = {
  id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true,
  exports: class FakeAnthropic { constructor() {} },
};

const app = require(serverPath);

function get(server, p) {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: '127.0.0.1', port: server.address().port, path: p, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
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

const PAGINAS = ['index.html', 'app.html', 'arbol.html', 'capitulos.html', 'colaboraciones.html', 'colaborar.html', 'historias.html'];

(async () => {
  const server = app.listen(0);
  try {
    // --- Ninguna página de disco sigue enlazando el dominio externo ---
    for (const pagina of PAGINAS) {
      const contenido = fs.readFileSync(path.join(publicDir, pagina), 'utf8');
      check(`${pagina}: ya no trae <link ...href="https://fonts...`, !/href=["']https:\/\/fonts\.(googleapis|gstatic)\.com/.test(contenido));
      check(`${pagina}: sí enlaza la hoja de fuentes local (/fonts/fonts.css)`, contenido.includes('href="/fonts/fonts.css"'));
    }

    // --- La hoja local sirve con el Content-Type correcto y declara lo esperado ---
    const css = await get(server, '/fonts/fonts.css');
    check('GET /fonts/fonts.css -> 200', css.status === 200);
    check('Content-Type text/css', /text\/css/.test(css.headers['content-type'] || ''));
    check('declara Atkinson Hyperlegible en 400 y 700', css.body.includes("font-family: 'Atkinson Hyperlegible'") && css.body.includes('font-weight: 400') && css.body.includes('font-weight: 700'));
    check('declara Source Serif 4 variable (200-900) normal e itálica', css.body.includes("font-family: 'Source Serif 4'") && css.body.includes('font-weight: 200 900') && css.body.includes('font-style: italic'));
    check('usa font-display: swap (no bloquea el renderizado de texto mientras carga)', css.body.includes('font-display: swap'));

    // --- Los archivos de fuente en sí se sirven con el Content-Type correcto ---
    const atkinson = await get(server, '/fonts/files/atkinson-hyperlegible-latin-400-normal.woff2');
    check('GET de un .woff2 de Atkinson -> 200', atkinson.status === 200);
    check('Content-Type font/woff2 (Atkinson)', atkinson.headers['content-type'] === 'font/woff2');

    const serif = await get(server, '/fonts/files/source-serif-4-latin-standard-normal.woff2');
    check('GET de un .woff2 de Source Serif 4 -> 200', serif.status === 200);
    check('Content-Type font/woff2 (Source Serif 4)', serif.headers['content-type'] === 'font/woff2');

    // --- La página servida por Express (no solo el archivo en disco) también quedó sin el link externo ---
    const home = await get(server, '/');
    check('GET / servido por Express tampoco trae el link externo', !/href=["']https:\/\/fonts\.(googleapis|gstatic)\.com/.test(home.body));
  } finally {
    server.close();
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
