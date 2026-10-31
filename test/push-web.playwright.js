// Pantalla de avisos: la franja "contó una historia" al abrir Eco y el bloque para activar los avisos push.
//
//   node test/push-web.playwright.js   (o: npm run test:push-web)
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright — correr "npm install" primero.'); process.exit(1); }

let fallas = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallas++; console.error('✗ ' + m); } };

const FALSOS = () => {
  window.__push = { suscrito: null, registrados: [], permiso: 'default' };
  const sub = { endpoint: 'https://push.example/x', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'p', auth: 'a' } }; }, async unsubscribe() { window.__push.suscrito = null; return true; } };
  const reg = { pushManager: { getSubscription: async () => window.__push.suscrito, subscribe: async () => { window.__push.suscrito = sub; return sub; } } };
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => reg, register: async (u) => { window.__push.registrados.push(u); return reg; }, ready: Promise.resolve(reg) } });
  window.PushManager = function PushManager() {};
  window.Notification = { permission: 'default', requestPermission: async () => { window.Notification.permission = 'granted'; return 'granted'; } };
};

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());

  async function abrir({ nombres = [], compatible = true, push = true, ua } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: ua });
    const page = await ctx.newPage();
    if (compatible) await page.addInitScript(FALSOS);
    else await page.addInitScript(() => { delete window.PushManager; });
    await page.addInitScript(() => { try { localStorage.setItem('eco_tour_done__app_html', '1'); } catch (e) { /* nada */ } });
    const posts = [];
    await page.route('**/api/**', (route) => {
      const u = new URL(route.request().url());
      const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (route.request().method() === 'POST') posts.push(u.pathname);
      if (u.pathname === '/api/me') return json({ username: 'felipe', name: 'Felipe Bernal', email: 'f@x.com', isCollaborator: false, isGuest: false });
      if (u.pathname === '/api/aportes/pending') return json({ names: nombres });
      if (u.pathname === '/api/push/clave') return json({ habilitado: push, clave: push ? 'BEl2hHDP' : null });
      if (u.pathname === '/api/push/prueba') return json({ ok: true, enviados: 1 });
      return json({ ok: true });
    });
    await page.goto(base + '/app.html', { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    return { ctx, page, posts };
  }

  // Franja al abrir
  let t = await abrir({ nombres: ['Ana'] });
  ok(await t.page.locator('#ecoAvisoAportes').count() === 1 && /Ana contó una historia/.test(await t.page.locator('#ecoAvisoAportes').innerText()), 'al abrir, la franja dice quién contó una historia');
  ok(await t.page.locator('#ecoAvisoAportes a').getAttribute('href') === '/colaboraciones.html', 'la franja lleva a Colaboración');
  await t.page.locator('#ecoAvisoAportes button').click();
  ok(await t.page.locator('#ecoAvisoAportes').count() === 0, 'se puede cerrar');
  await t.ctx.close();

  t = await abrir({ nombres: ['Ana', 'Luis', 'Marta', 'Pedro'] });
  ok(/Ana, Luis y 2 más contaron historias/.test(await t.page.locator('#ecoAvisoAportes').innerText()), 'con varios nombres los resume');
  await t.ctx.close();

  t = await abrir({ nombres: [] });
  ok(await t.page.locator('#ecoAvisoAportes').count() === 0, 'sin aportes nuevos no sale ninguna franja');
  await t.ctx.close();

  // Avisos push
  t = await abrir();
  ok(await t.page.locator('#umPushWeb').count() === 1, 'aparece el bloque de avisos en Recordatorios');
  const activar = t.page.locator('#umPushWeb button', { hasText: 'Avisarme cuando un familiar' });
  ok(await activar.isVisible().catch(() => false) || await activar.count() === 1, 'ofrece activar los avisos');
  await t.page.evaluate(() => [...document.querySelectorAll('#umPushWeb button')].find((b) => /Avisarme/.test(b.textContent)).click());
  await t.page.waitForTimeout(600);
  ok(await t.page.evaluate(() => window.__push.registrados.includes('/eco-sw.js')), 'al activar se registra el service worker');
  ok(t.posts.includes('/api/push/suscribir'), 'la suscripción se manda al servidor');
  await t.page.evaluate(() => [...document.querySelectorAll('#umPushWeb button')].find((b) => /prueba/.test(b.textContent)).click());
  await t.page.waitForTimeout(300);
  ok(t.posts.includes('/api/push/prueba'), 'el botón de prueba pide un aviso de prueba');
  await t.page.evaluate(() => [...document.querySelectorAll('#umPushWeb button')].find((b) => /Dejar de avisarme/.test(b.textContent)).click());
  await t.page.waitForTimeout(400);
  ok(t.posts.includes('/api/push/baja') && await t.page.evaluate(() => window.__push.suscrito === null), 'al apagarlo se avisa al servidor y se cancela la suscripción');
  await t.ctx.close();

  t = await abrir({ push: false });
  ok(await t.page.locator('#umPushWeb').count() === 0, 'si el servidor no tiene los avisos configurados, no se muestra nada');
  await t.ctx.close();

  t = await abrir({ compatible: false, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' });
  ok(/Añadir a pantalla de inicio/.test(await t.page.locator('#umPushWeb').innerText().catch(() => '')), 'en iPhone sin instalar explica que primero hay que añadirla a la pantalla de inicio');
  await t.ctx.close();

  await browser.close();
  server.close();
  console.log(fallas ? `\n${fallas} fallaron` : '\nTodo bien');
  process.exit(fallas ? 1 : 0);
})();
