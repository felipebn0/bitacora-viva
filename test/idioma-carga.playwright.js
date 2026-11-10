// El diccionario de inglés (unos 200 KB) solo se descarga cuando la página va a mostrarse en inglés:
// quien usa Eco en español nunca lo baja, y quien lo usa en inglés lo sigue viendo todo traducido.
//   node test/idioma-carga.playwright.js   (o: npm run test:idioma-carga)
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright: corre "npm install".'); process.exit(1); }
let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errores = [];

  async function abrir(ruta, { me = null, local = null } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    if (local) await ctx.addInitScript((v) => { try { for (const k of Object.keys(v)) localStorage.setItem(k, v[k]); } catch (e) { /* nada */ } }, local);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errores.push(ruta + ': ' + e.message));
    const diccionario = [];
    page.on('request', (r) => { if (/eco-idioma-en\.js/.test(r.url())) diccionario.push(new URL(r.url()).search); });
    await page.route('**/api/**', (route) => {
      const u = new URL(route.request().url());
      const json = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.pathname === '/api/me') return me ? json(me) : json({ error: 'No autenticado.' }, 401);
      if (u.pathname === '/api/intro') return json({ aplica: false, pendiente: false });
      if (u.pathname === '/api/tree/pending') return json({ names: [] });
      return json({});
    });
    await page.goto(base + ruta, { waitUntil: 'load' });
    await page.waitForTimeout(700);
    return { ctx, page, diccionario };
  }
  const olvide = (page) => page.evaluate(() => (document.getElementById('olvideClave') || {}).textContent || '');

  console.log('--- en español ---');
  {
    const { ctx, page, diccionario } = await abrir('/');
    ok(diccionario.length === 0, 'landing en español: no se descarga el diccionario de inglés');
    ok(await page.evaluate(() => document.documentElement.lang) === 'es', 'la página queda en español');
    const antes = await page.evaluate(() => document.body.innerText.slice(0, 1500));
    await page.click('#ecoIdiomaBtn');
    await page.waitForFunction(() => /ESP/.test(document.getElementById('ecoIdiomaBtn').textContent) && typeof window.ECO_EN === 'object');
    await page.waitForTimeout(300);
    ok(diccionario.length === 1, 'al tocar la bandera se descarga una sola vez');
    ok(/^\?v=\d+$/.test(diccionario[0] || '') && diccionario[0] === new URL(await page.evaluate(() => document.querySelector('script[src*="eco-idioma.js"]').src)).search, 'con el mismo ?v= del motor (' + diccionario[0] + ')');
    const despues = await page.evaluate(() => document.body.innerText.slice(0, 1500));
    ok(await page.evaluate(() => document.documentElement.lang) === 'en' && despues !== antes, 'y la página cambia a inglés');
    await page.click('#ecoIdiomaBtn');
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.body.innerText.slice(0, 1500)) === antes && diccionario.length === 1, 'al volver a español se restaura el texto original, sin descargar nada más');
    await ctx.close();
  }
  {
    const { ctx, page, diccionario } = await abrir('/app.html', { me: { isCollaborator: false, username: 'ana', name: 'Ana', email: 'a@x.co', idioma: 'es', isAdmin: false } });
    ok(diccionario.length === 0, 'app con una cuenta en español: no se descarga el diccionario');
    ok(/Olvidaste/.test(await olvide(page)), 'y los textos siguen en español');
    await ctx.close();
  }

  console.log('--- en inglés ---');
  {
    const { ctx, page, diccionario } = await abrir('/app.html', { local: { 'eco-idioma-cuenta': 'en' } });
    await page.waitForFunction(() => document.getElementById('olvideClave').textContent === 'Forgot your password?', null, { timeout: 8000 }).catch(() => {});
    ok(diccionario.length === 1, 'quien ya venía en inglés: el diccionario se descarga (una vez)');
    ok(await olvide(page) === 'Forgot your password?', 'y la pantalla de entrada sale en inglés');
    await ctx.close();
  }
  {
    const { ctx, page, diccionario } = await abrir('/app.html', { me: { isCollaborator: false, username: 'john', name: 'John', email: 'j@x.co', idioma: 'en', isAdmin: false } });
    await page.waitForFunction(() => document.getElementById('olvideClave').textContent === 'Forgot your password?', null, { timeout: 8000 }).catch(() => {});
    ok(diccionario.length === 1 && await olvide(page) === 'Forgot your password?', 'una cuenta en inglés (según el servidor) también lo descarga y queda traducida');
    ok(await page.evaluate(() => document.documentElement.lang) === 'en', 'la página queda marcada en inglés');
    await ctx.close();
  }
  {
    const { ctx, page, diccionario } = await abrir('/restablecer.html', { local: { 'eco-idioma-cuenta': 'en' } });
    await page.waitForFunction(() => typeof window.ECO_EN === 'object', null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    ok(diccionario.length === 1 && /Reset your password/.test(await page.title()), 'el título de la página también se traduce cuando llega el diccionario (' + await page.title() + ')');
    await ctx.close();
  }

  ok(errores.length === 0, 'sin errores de JavaScript' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
