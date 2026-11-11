// Mi Libro (auditoría 11-nov-2026):
// PRI-01  el respaldo local del libro va separado por cuenta: en un navegador compartido la cuenta B (o alguien sin
//         sesión) nunca ve la portada ni la dedicatoria de A, ni siquiera si el servidor falla.
// BOOK-01 si el guardado falla (409 por otra versión, 500, sin red), el libro NO se publica ni se muestra «Listo».
//   node test/libro-privacidad.playwright.js   (o: npm run test:libro-privacidad)
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

  async function abrir({ me, servidorFalla = false, guardado = 200, local = {} }) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    await ctx.addInitScript((v) => { try { for (const k of Object.keys(v)) localStorage.setItem(k, v[k]); } catch (e) { /* nada */ } }, local);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errores.push(e.message));
    const puts = [];
    await page.route('**/api/**', (route) => {
      const u = new URL(route.request().url());
      const m = route.request().method();
      const json = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.pathname === '/api/me') return me ? json(me) : json({ error: 'No autenticado.' }, 401);
      if (servidorFalla && ['/api/chapters', '/api/book-editor/draft', '/api/story-log'].includes(u.pathname) && m === 'GET') return json({ error: 'falla' }, 500);
      if (u.pathname === '/api/chapters') return json({ chapters: [{ id: 1, title: 'La finca', generated_text: 'Texto del capítulo.', persona: 'tercera' }] });
      if (u.pathname === '/api/book-editor/draft' && m === 'GET') return json({ book: {}, version: 1 });
      if (u.pathname === '/api/book-editor/draft' && m === 'PUT') { puts.push(1); return json(guardado === 200 ? { version: 2 } : { error: 'conflicto' }, guardado); }
      if (u.pathname === '/api/story-log') return json({ stories: [] });
      return json({});
    });
    await page.goto(base + '/capitulos.html');
    await page.waitForSelector('#ecoEditorialStatus');
    await page.waitForFunction(() => !/Cargando/.test(document.getElementById('ecoEditorialStatus').textContent), null, { timeout: 10000 });
    return { ctx, page, puts };
  }
  const textoLibro = (page) => page.evaluate(() => document.getElementById('ecoEditorialBook').innerText);
  const SECRETO_A = { 'eco-editorial-borrador-v2:ana:propia': JSON.stringify({ title: 'Libro de Ana', dedication: 'SECRETO-DE-ANA' }), 'eco-editorial-borrador-v1': JSON.stringify({ dedication: 'SECRETO-VIEJO' }) };

  console.log('--- PRI-01: cuentas separadas en el mismo navegador ---');
  {
    const { ctx, page } = await abrir({ me: { username: 'beto' }, servidorFalla: true, local: SECRETO_A });
    const t = await textoLibro(page);
    ok(!/SECRETO-DE-ANA|SECRETO-VIEJO|Libro de Ana/.test(t), 'con el servidor caído, Beto NO ve nada del libro de Ana');
    ok(await page.evaluate(() => localStorage.getItem('eco-editorial-borrador-v1')) === null, 'el respaldo viejo (sin cuenta) se borra');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir({ me: null, servidorFalla: true, local: SECRETO_A });
    ok(!/SECRETO-DE-ANA|SECRETO-VIEJO|Libro de Ana/.test(await textoLibro(page)), 'sin sesión (401) tampoco se muestra ningún respaldo');
    ok(/Inicia sesión/.test(await page.textContent('#ecoEditorialStatus')), 'y pide iniciar sesión');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir({ me: { username: 'ana' }, servidorFalla: true, local: SECRETO_A });
    ok(/SECRETO-DE-ANA/.test(await textoLibro(page)), 'Ana, con el servidor caído, sí recupera SU respaldo');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir({ me: { username: 'ana' } });
    await page.click('.eco-editorial-dedication');
    await page.keyboard.type('Para mi familia');
    await page.waitForTimeout(400);
    const claves = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('eco-editorial-borrador')));
    ok(claves.length === 1 && claves[0] === 'eco-editorial-borrador-v2:ana:propia', 'lo que Ana escribe se respalda solo bajo su cuenta (' + claves.join(', ') + ')');
    await ctx.close();
  }

  console.log('--- BOOK-01: un guardado fallido no publica ---');
  for (const codigo of [409, 500]) {
    const { ctx, page, puts } = await abrir({ me: { username: 'ana' }, guardado: codigo });
    await page.evaluate(() => { window.__publicado = 0; window.EcoLibroDigital.compartirEnLinea = async () => { window.__publicado++; return 'https://mieco.app/libro/x'; }; window.EcoLibroCompra = { asegurar: async () => true }; });
    await page.click('.eco-editorial-dedication');
    await page.keyboard.type('Para mi familia');
    await page.waitForTimeout(1200);
    await page.click('#ecoEditorialDigital');
    await page.waitForTimeout(800);
    const estado = await page.textContent('#ecoEditorialStatus');
    ok(puts.length >= 1, `(${codigo}) se intentó guardar`);
    ok(await page.evaluate(() => window.__publicado) === 0, `(${codigo}) el libro NO se publicó`);
    ok(!/Listo/.test(estado) && /no publiqué|Recarga|No se guardó/.test(estado), `(${codigo}) no dice «Listo» y explica qué pasó: «${estado.trim().slice(0, 90)}»`);
    ok(/Para mi familia/.test(await textoLibro(page)), `(${codigo}) el cambio sigue en pantalla para reintentar`);
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir({ me: { username: 'ana' }, guardado: 200 });
    await page.evaluate(() => { window.__publicado = 0; window.EcoLibroDigital.compartirEnLinea = async () => { window.__publicado++; return 'https://mieco.app/libro/x'; }; window.EcoLibroCompra = { asegurar: async () => true }; });
    await page.click('.eco-editorial-dedication');
    await page.keyboard.type('Para mi familia');
    await page.waitForTimeout(1200);
    await page.click('#ecoEditorialDigital');
    await page.waitForFunction(() => window.__publicado === 1, null, { timeout: 5000 }).catch(() => {});
    const est = await page.textContent('#ecoEditorialStatus');
    ok(await page.evaluate(() => window.__publicado) === 1 && /Listo/.test(est), 'con el guardado bien, sí se publica y dice «Listo» (' + est.trim().slice(0, 60) + ')');
    await ctx.close();
  }

  ok(errores.length === 0, 'sin errores de JavaScript' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
