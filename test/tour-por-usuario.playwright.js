// El recorrido con focos se muestra una sola vez por usuario (se recuerda en el servidor), aunque cambie de celular o
// borre el almacenamiento del navegador.
//
//   node test/tour-por-usuario.playwright.js   (o: npm run test:tour)
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright — correr "npm install" primero.'); process.exit(1); }

let fallas = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallas++; console.error('✗ ' + m); } };

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());

  async function abrir({ vistos = [], tourFalla = false, localStorageHecho = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    if (localStorageHecho) await page.addInitScript(() => { try { localStorage.setItem('eco_tour_done__app_html', '1'); } catch (e) { /* nada */ } });
    const posts = [];
    await page.route('**/api/**', (route) => {
      const u = new URL(route.request().url());
      const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
      if (route.request().method() === 'POST') posts.push({ ruta: u.pathname, cuerpo: route.request().postData() });
      if (u.pathname === '/api/me') return json({ username: 'felipe', name: 'Felipe Bernal', email: 'f@x.com', isCollaborator: false, isGuest: false });
      if (u.pathname === '/api/tour') return tourFalla ? json({ error: 'caído' }, 500) : json({ aplica: true, vistos });
      if (u.pathname === '/api/intro') return json({ aplica: false, pendiente: false });
      if (u.pathname === '/api/aportes/pending') return json({ names: [] });
      if (u.pathname === '/api/push/clave') return json({ habilitado: false, clave: null });
      return json({ ok: true });
    });
    await page.goto(base + '/app.html', { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    return { ctx, page, posts };
  }

  let t = await abrir();
  ok(await t.page.locator('#eco-tour-tip').count() === 1, 'una cuenta que nunca lo vio, lo ve');
  await t.page.locator('.eco-tour-skip').click();
  await t.page.waitForTimeout(300);
  const marca = t.posts.find((p) => p.ruta === '/api/tour/visto');
  ok(marca && JSON.parse(marca.cuerpo).pagina === '/app.html', 'al terminarlo se guarda en el servidor');
  ok(await t.page.evaluate(() => localStorage.getItem('eco_tour_done__app_html')) === '1', 'y también en este navegador');
  await t.ctx.close();

  t = await abrir({ vistos: ['/app.html'] });
  ok(await t.page.locator('#eco-tour-tip').count() === 0 && await t.page.locator('#eco-tour-overlay').count() === 0, 'si el servidor dice que ya lo vio, no aparece (aunque sea otro celular sin nada guardado)');
  ok(await t.page.evaluate(() => localStorage.getItem('eco_tour_done__app_html')) === '1', 'y este navegador lo recuerda');
  await t.ctx.close();

  t = await abrir({ vistos: [], localStorageHecho: true });
  ok(await t.page.locator('#eco-tour-tip').count() === 0, 'si ya lo había visto en este navegador, no aparece');
  ok(t.posts.some((p) => p.ruta === '/api/tour/visto'), 'y se le avisa al servidor para que no vuelva a salir en otros celulares');
  await t.ctx.close();

  t = await abrir({ tourFalla: true });
  ok(await t.page.locator('#eco-tour-tip').count() === 1, 'si el servidor no responde, sigue funcionando como antes (lo muestra si este navegador no lo ha visto)');
  await t.ctx.close();

  t = await abrir({ tourFalla: true, localStorageHecho: true });
  ok(await t.page.locator('#eco-tour-tip').count() === 0, 'y si no responde pero este navegador ya lo vio, no aparece');
  await t.ctx.close();

  await browser.close();
  server.close();
  console.log(fallas ? `\n${fallas} fallaron` : '\nTodo bien');
  process.exit(fallas ? 1 : 0);
})();
