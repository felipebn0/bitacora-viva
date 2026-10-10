// El botón de hablar es el logo animado de Eco (2026-10-09):
// - turno de la persona (listening): corre la intro (la gota, las ondas, los anillos que se
//   abren) y después el punto late; se REPITE cada vez que vuelve a ser su turno;
// - turno de la IA (speaking / thinking): los anillos se cierran (círculos completos) y el
//   botón es negro;
// - con "reducir movimiento" no hay animaciones y el logo queda quieto.
//
//   node test/orbe-eco.playwright.js   (o: npm run test:orbe)
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright — correr "npm install" primero.'); process.exit(1); }

let fallas = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallas++; console.error('✗ ' + m); } };

async function abrir(browser, base, opciones = {}) {
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 760 }, ...opciones })).newPage();
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url());
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/me') return json({ username: 'felipe', name: 'Felipe', email: 'f@x.com', isCollaborator: false, isGuest: false });
    return json({});
  });
  await page.goto(base + '/app.html', { waitUntil: 'load' });
  await page.waitForSelector('#appContent', { state: 'visible' });
  return page;
}
const estado = (page, s) => page.evaluate((s) => { document.getElementById('orb').dataset.state = s; }, s);
const leer = (page) => page.evaluate(() => {
  const orb = document.getElementById('orb');
  const css = (sel, prop) => getComputedStyle(orb.querySelector(sel))[prop];
  const anims = orb.getAnimations({ subtree: true }).filter((a) => a.animationName && a.animationName.startsWith('eco-'));
  return {
    fondo: getComputedStyle(orb).backgroundColor,
    dash: css('.r3 .ring', 'strokeDasharray'),
    nAnimaciones: anims.length,
    gota: orb.querySelector('.drop').getAnimations().map((a) => a.animationName).join(','),
    gotaTiempo: Math.round((orb.querySelector('.drop').getAnimations()[0] || { currentTime: -1 }).currentTime),
  };
});

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());

  let page = await abrir(browser, base);
  await page.waitForTimeout(300);
  let r = await leer(page);
  ok(r.fondo === 'rgb(79, 93, 58)', 'en reposo el botón es musgo (#4F5D3A)');
  ok(/^72/.test(r.dash), 'en reposo los anillos están abiertos (con su abertura)');

  await estado(page, 'listening');
  await page.waitForTimeout(150);
  r = await leer(page);
  ok(r.fondo === 'rgb(79, 93, 58)', 'turno de la persona: botón musgo');
  ok(r.gota.includes('eco-dropFall') && r.nAnimaciones >= 8, `turno de la persona: corre la intro (cae la gota, ondas, anillos): ${r.nAnimaciones} animaciones`);
  await page.waitForTimeout(2600);
  r = await leer(page);
  ok(/^72/.test(r.dash), 'tras la intro los anillos quedan abiertos');

  await estado(page, 'speaking');
  await page.waitForTimeout(800);
  r = await leer(page);
  ok(r.fondo === 'rgb(26, 26, 26)', 'turno de la IA (hablando): el botón es negro');
  ok(/^100/.test(r.dash) && /(0px|0)$/.test(r.dash.trim().split(/[ ,]+/).pop()), `turno de la IA: los anillos se cierran (dasharray ${r.dash})`);
  ok(r.nAnimaciones === 0, 'turno de la IA: sin animaciones (no se puede hablar)');

  await estado(page, 'thinking');
  await page.waitForTimeout(300);
  r = await leer(page);
  ok(r.fondo === 'rgb(26, 26, 26)' && /^100/.test(r.dash), 'pensando: también negro y con los anillos cerrados');

  await estado(page, 'listening');
  await page.waitForTimeout(200);
  r = await leer(page);
  ok(r.gota.includes('eco-dropFall') && r.gotaTiempo >= 0 && r.gotaTiempo < 900, `al volver el turno de la persona la animación arranca DE NUEVO (la gota va en ${r.gotaTiempo} ms)`);
  ok(r.fondo === 'rgb(79, 93, 58)' || r.fondo.startsWith('rgb('), 'al volver el turno el botón deja de ser negro');
  await page.waitForTimeout(700);
  r = await leer(page);
  ok(r.fondo === 'rgb(79, 93, 58)', 'musgo otra vez');

  await estado(page, 'paused');
  await page.waitForTimeout(700);
  r = await leer(page);
  ok(r.fondo === 'rgb(112, 101, 81)', 'en pausa: gris tierra, sin animaciones');
  await page.close();

  page = await abrir(browser, base, { reducedMotion: 'reduce' });
  await estado(page, 'listening');
  await page.waitForTimeout(300);
  r = await leer(page);
  ok(r.nAnimaciones === 0, 'con "reducir movimiento": el logo queda quieto, sin animaciones');
  ok(/^72/.test(r.dash), 'con "reducir movimiento": los anillos se ven abiertos y completos');
  await page.close();

  await browser.close();
  server.close();
  console.log(fallas ? `\n${fallas} fallaron` : '\nTodo bien');
  process.exit(fallas ? 1 : 0);
})();
