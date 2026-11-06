// La voz de Eco (audio que llega de /api/speak y se reproduce desde una dirección blob:) y las vistas previas de fotos
// no pueden quedar bloqueadas por la política de seguridad (CSP). Si se bloquean, la voz cae a la del navegador (la
// "de Google") y las fotos que la persona sube no se ven. Pasó el 2026-11-06 al activar la CSP obligatoria.
//
//   node test/csp-blob.playwright.js   (o: npm run test:csp-blob)
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';

const path = require('path');
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

let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.__violaciones = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__violaciones.push(e.violatedDirective + ' <- ' + e.blockedURI.slice(0, 40)));
  });
  await page.goto(base + '/privacidad.html');
  const r = await page.evaluate(async () => {
    const wav = new Uint8Array([82, 73, 70, 70, 40, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 18, 0, 0, 0, 1, 0, 1, 0, 64, 31, 0, 0, 64, 31, 0, 0, 1, 0, 8, 0, 0, 0, 100, 97, 116, 97, 0, 0, 0, 0]);
    const audio = new Audio(URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })));
    let errorAudio = null;
    try { await audio.play(); } catch (e) { errorAudio = e.name; }
    const img = new Image();
    let imgOk = null;
    img.onload = () => { imgOk = true; }; img.onerror = () => { imgOk = false; };
    img.src = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>'], { type: 'image/svg+xml' }));
    await new Promise((res) => setTimeout(res, 400));
    return { errorAudio, imgOk, violaciones: [...new Set(window.__violaciones)] };
  });
  ok(r.errorAudio === null, 'un audio armado en el navegador (la voz de Eco) se puede reproducir' + (r.errorAudio ? ' (' + r.errorAudio + ')' : ''));
  ok(r.imgOk === true, 'una imagen armada en el navegador (vista previa de una foto) se muestra');
  ok(r.violaciones.length === 0, 'sin violaciones de CSP' + (r.violaciones.length ? ': ' + r.violaciones.join(' | ') : ''));
  await browser.close();
  server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
