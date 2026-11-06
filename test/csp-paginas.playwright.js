// Ninguna página de public/ viola la política de seguridad (CSP) que ahora se aplica de verdad: si una página tiene
// un <script> o <style> inline sin hash (o un atributo style=""), el navegador la bloquearía y se vería rota.
// Típico descuido: agregar una página nueva y olvidar sumarla a PAGINAS en csp-hashes.js.
//
//   node test/csp-paginas.playwright.js   (o: npm run test:csp-paginas)
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';

const path = require('path');
const fs = require('fs');
const http = require('http');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright: corre "npm install".'); process.exit(1); }

function fakeSql() { return Promise.resolve([]); }
fakeSql.transaction = (q) => Promise.all(q);
const cache = (mod, exports) => { require.cache[require.resolve(mod)] = { id: require.resolve(mod), filename: require.resolve(mod), loaded: true, exports }; };
cache('@neondatabase/serverless', { neon: () => fakeSql });
cache('@vercel/blob', { put: async () => ({ url: 'x' }), del: async () => {}, get: async () => null, list: async () => ({ blobs: [], hasMore: false }) });
cache('@anthropic-ai/sdk', class { constructor() {} });
const app = require(path.resolve(__dirname, '..', 'server.js'));

function htmlDe(dir, prefijo = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? htmlDe(path.join(dir, e.name), prefijo + e.name + '/') : e.name.endsWith('.html') ? [prefijo + e.name] : []));
}

let fallos = 0;
(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const paginas = htmlDe(path.resolve(__dirname, '..', 'public'));
  for (const pagina of paginas) {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.addInitScript(() => {
      window.__violaciones = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__violaciones.push(e.violatedDirective + ' <- ' + e.blockedURI));
    });
    const page = await ctx.newPage();
    try { await page.goto(base + '/' + pagina, { waitUntil: 'load', timeout: 20000 }); await page.waitForTimeout(500); } catch (e) { /* se reporta abajo si violó algo */ }
    const v = [...new Set(await page.evaluate(() => window.__violaciones).catch(() => []))];
    if (v.length) { fallos++; console.error('✗ ' + pagina + ': ' + v.slice(0, 3).join(' | ')); } else console.log('✓ ' + pagina);
    await ctx.close();
  }
  await browser.close();
  server.close();
  console.log(fallos ? `\n${fallos} página(s) con violaciones de CSP` : `\nTodo bien (${paginas.length} páginas)`);
  process.exit(fallos ? 1 : 0);
})();
