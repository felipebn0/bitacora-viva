// La pantalla principal de app.html (el botón de hablar, la barra de íconos y
// "Invitar a mi círculo") tiene que caber en UNA sola vista, sin scroll, con el botón
// de hablar lo más grande posible (pedido de Felipe, 2026-10-09: en una ventana de
// ~1300x700 se perdía el botón de abajo).
//
//   node test/pantalla-principal.playwright.js   (o: npm run test:pantalla)
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright — correr "npm install" primero.'); process.exit(1); }

let fallas = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallas++; console.error('✗ ' + m); } };

// [ancho, alto, tamaño mínimo esperado del botón]
const TAMANOS = [[1300, 700, 250], [1440, 800, 330], [1920, 1080, 380], [1280, 600, 150], [768, 1024, 300], [430, 932, 280], [390, 844, 240], [375, 667, 220], [360, 640, 190], [320, 568, 150]];

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  for (const [w, h, minOrbe] of TAMANOS) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
    await page.route('**/api/**', (route) => {
      const u = new URL(route.request().url());
      const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.pathname === '/api/me') return json({ username: 'felipe', name: 'Felipe Bernal', email: 'f@x.com', isCollaborator: false, isGuest: false });
      return json({});
    });
    await page.goto(base + '/app.html', { waitUntil: 'load' });
    await page.waitForTimeout(900);
    const m = await page.evaluate(() => {
      const orbe = document.getElementById('orb').getBoundingClientRect();
      const card = document.querySelector('.device').getBoundingClientRect();
      const invitar = document.getElementById('inviteToggle').getBoundingClientRect();
      return { alto: innerHeight, scroll: document.documentElement.scrollHeight, orbe: Math.round(orbe.width), orbeDentro: orbe.left >= card.left && orbe.right <= card.right, invitarFondo: Math.round(invitar.bottom) };
    });
    ok(m.scroll <= m.alto, `${w}x${h}: cabe en una vista, sin scroll (alto de la página ${m.scroll} de ${m.alto})`);
    ok(m.invitarFondo <= m.alto, `${w}x${h}: el botón de "Invitar" se ve completo`);
    ok(m.orbe >= minOrbe, `${w}x${h}: el botón de hablar mide ${m.orbe}px (mínimo esperado ${minOrbe}px)`);
    ok(m.orbeDentro, `${w}x${h}: el botón queda dentro de la tarjeta`);
    await page.close();
  }
  await browser.close();
  server.close();
  console.log(fallas ? `\n${fallas} fallaron` : '\nTodo bien');
  process.exit(fallas ? 1 : 0);
})();
