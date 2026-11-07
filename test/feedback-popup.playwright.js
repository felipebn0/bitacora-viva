// El popup de retroalimentación (app.html) y su tabla en el panel de admin no pueden usar style="" en el HTML: la política
// de seguridad (CSP) lo bloquea, y el popup quedaba visible todo el tiempo y sin diseño. Aquí se prueba con el servidor
// real (con CSP obligatoria) que el popup nace oculto, se ve bien al mostrarse y que el panel escapa lo que escribe la gente.
//
//   node test/feedback-popup.playwright.js   (o: npm run test:feedback-popup)
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
  const browser = await chromium.launch();

  console.log('--- popup en app.html ---');
  {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.addInitScript(() => {
      window.__v = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__v.push(e.violatedDirective + ' <- ' + e.blockedURI));
    });
    const page = await ctx.newPage();
    let enviadoFb = null;
    await page.route('**/api/**', (route) => {
      const u = new URL(route.request().url());
      const json = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.pathname === '/api/me') return json({ isCollaborator: false, username: 'felipe', name: 'Felipe', email: 'f@x.co', fechaNacimiento: null, isAdmin: false });
      if (u.pathname === '/api/intro') return json({ aplica: false, pendiente: false });
      if (u.pathname === '/api/tree/pending') return json({ names: [] });
      if (u.pathname === '/api/session-feedback') { enviadoFb = JSON.parse(route.request().postData()); return json({ ok: true }); }
      return json({});
    });
    await page.goto(base + '/app.html');
    await page.waitForTimeout(1500);
    const display = () => page.evaluate(() => getComputedStyle(document.getElementById('feedbackOverlay')).display);
    ok(await display() === 'none', 'el popup nace oculto (antes quedaba visible porque el display:none en línea se bloqueaba)');
    ok(await page.evaluate(() => document.getElementById('feedbackOverlay').getBoundingClientRect().height) === 0, 'y no ocupa espacio en la pantalla');
    await page.evaluate(() => { const o = document.getElementById('feedbackOverlay'); o.hidden = false; o.classList.add('fb-visible'); });
    const geo = await page.evaluate(() => {
      const o = document.getElementById('feedbackOverlay').getBoundingClientRect();
      const c = document.querySelector('.fb-card').getBoundingClientRect();
      const x = document.getElementById('feedbackClose').getBoundingClientRect();
      return { overlay: [o.width, o.height], card: [c.left, c.top, c.right, c.bottom], x: [x.left, x.top], pos: getComputedStyle(document.getElementById('feedbackOverlay')).position };
    });
    ok(geo.pos === 'fixed' && geo.overlay[0] === 420 && geo.overlay[1] === 900, 'al mostrarse cubre toda la pantalla (posición fija)');
    ok(geo.card[0] >= 0 && geo.card[2] <= 420 && geo.card[1] > 100 && geo.card[3] < 800, 'la tarjeta queda centrada y dentro de la pantalla');
    ok(geo.x[0] > geo.card[0] && geo.x[0] < geo.card[2] && geo.x[1] > geo.card[1] && geo.x[1] < geo.card[3], 'la X de cerrar queda dentro de la tarjeta');
    ok(await page.evaluate(() => getComputedStyle(document.getElementById('feedbackBtns')).display) === 'flex', 'los tres botones (Mal, Regular, Bien) van en fila');
    ok(await page.isHidden('#feedbackComment'), 'el cuadro de comentario espera a que se elija una calificación');
    await page.click('.fb-btn[data-rating="bien"]');
    ok(await page.isVisible('#feedbackText'), 'al elegir una calificación aparece el comentario');
    ok(await page.getAttribute('.fb-btn[data-rating="bien"]', 'data-selected') !== null, 'la calificación elegida queda marcada');
    await page.evaluate(() => { document.getElementById('feedbackBtns').hidden = true; });
    ok(await page.isHidden('#feedbackBtns'), 'los botones se esconden de verdad cuando la página los pide ocultar (antes el display en línea lo impedía)');
    await page.evaluate(() => { document.getElementById('feedbackBtns').hidden = false; });
    await page.fill('#feedbackText', 'Muy bonito');
    await page.click('#feedbackSend');
    await page.waitForFunction(() => !document.getElementById('feedbackGracias').hidden);
    ok(enviadoFb && enviadoFb.rating === 'bien' && enviadoFb.comment === 'Muy bonito', 'Enviar manda la calificación y el comentario');
    ok(await page.isVisible('#feedbackGracias'), 'después de enviar, da las gracias');
    await page.click('#feedbackClose');
    ok(await display() === 'none', 'la X cierra el popup');
    ok(await page.evaluate(() => window.__v.length) === 0, 'sin violaciones de CSP en app.html');
  }

  console.log('--- tabla de feedback en admin.html ---');
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    await ctx.addInitScript(() => {
      window.__v = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__v.push(e.violatedDirective + ' <- ' + e.blockedURI));
    });
    const page = await ctx.newPage();
    await page.route('**/api/**', (route) => {
      const u = new URL(route.request().url());
      const json = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.pathname === '/api/me') return json({ isAdmin: true });
      if (u.pathname === '/api/admin/session-feedback') {
        return json({ feedback: [
          { created_at: '2026-11-07T15:00:00Z', nombre: '<img src=x id="xss1" onerror="window.__xss=1">Ana', rating: 'bien', comment: 'Me gustó <script>window.__xss=2</script>' },
          { created_at: '2026-11-07T14:00:00Z', nombre: null, rating: 'mal', comment: null },
        ] });
      }
      return json({}, 404);
    });
    await page.goto(base + '/admin.html');
    await page.waitForSelector('.fb-tabla');
    ok(await page.locator('.fb-tabla tbody tr').count() === 2, 'la tabla muestra las calificaciones');
    ok(await page.locator('#xss1').count() === 0 && !(await page.evaluate(() => window.__xss)), 'un nombre o comentario con HTML se muestra como texto y no se ejecuta');
    ok(/<img/.test(await page.locator('.fb-tabla tbody tr').first().innerText()), 'el texto malicioso se ve como texto');
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('.fb-bien')).color) !== await page.evaluate(() => getComputedStyle(document.querySelector('.fb-mal')).color), 'cada calificación tiene su color');
    ok(await page.evaluate(() => window.__v.length) === 0, 'sin violaciones de CSP en admin.html');
  }

  await browser.close(); server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
