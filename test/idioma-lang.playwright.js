// Idioma: todo arranca en español. Con inglés elegido, <html lang> sigue en «es» hasta que llega la traducción
// (si no, un lector de pantalla leería texto en español con voz en inglés). Sin traducción, se queda en «es».
//   node test/idioma-lang.playwright.js
const path = require('path');
const express = require('express');
const { chromium } = require('playwright');
let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const lang = (page) => page.evaluate(() => document.documentElement.lang);

  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.route('**/api/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
    await page.goto(base + '/');
    ok(await lang(page) === 'es', 'primera visita: la página está en español');
    ok(await page.evaluate(() => !window.ECO_EN), 'y no descarga la traducción al inglés');
    await ctx.close();
  }
  {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => { try { localStorage.setItem('eco-idioma', 'en'); } catch (e) { /* nada */ } });
    const page = await ctx.newPage();
    let soltar;
    const espera = new Promise((r) => { soltar = r; });
    await page.route('**/api/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
    await page.route('**/eco-idioma-en.js*', async (r) => { await espera; r.continue(); });
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    ok(await lang(page) === 'es', 'con inglés elegido, mientras llega la traducción sigue marcada «es»');
    soltar();
    await page.waitForFunction(() => document.documentElement.lang === 'en', null, { timeout: 5000 }).catch(() => {});
    ok(await lang(page) === 'en', 'cuando llega la traducción pasa a «en»');
    await ctx.close();
  }
  {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => { try { localStorage.setItem('eco-idioma', 'en'); } catch (e) { /* nada */ } });
    const page = await ctx.newPage();
    await page.route('**/api/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
    await page.route('**/eco-idioma-en.js*', (r) => r.abort());
    await page.goto(base + '/');
    await page.waitForTimeout(500);
    ok(await lang(page) === 'es', 'si la traducción no carga, se queda en español (coincide con el texto)');
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
