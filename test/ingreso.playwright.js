// Que alguien con sesión iniciada ENTRE a la app y se quede dentro: si algo
// falla justo después de abrir la sesión (un error de JavaScript en el arranque de
// app.html), la app lo toma como "no hay sesión" y devuelve a la pantalla de
// login — la persona inicia sesión y vuelve a ver el login. Pasó el 2026-10-09
// (una función que vivía en otro bloque <script>) y ningún otro test lo vio.
// Sirve public/ con un server estático, mockea /api/* con page.route().
//
//   node test/ingreso.playwright.js   (o: npm run test:ingreso)
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

  for (const [nombre, me] of [
    ['cuenta dueña', { username: 'felipe', name: 'Felipe', email: 'f@x.com', isCollaborator: false, isGuest: false, puedeNarrar: true, tratamiento: 'masculino' }],
    ['cuenta dueña sin trato ni nombre', { username: 'maria', isCollaborator: false, isGuest: false }],
  ]) {
    const page = await (await browser.newContext()).newPage();
    const errores = [];
    const pedidos = [];
    page.on('pageerror', (e) => errores.push(e.message));
    await page.route('**/api/**', (route) => {
      const url = new URL(route.request().url());
      pedidos.push(url.pathname);
      const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (url.pathname === '/api/me') return json(me);
      if (url.pathname === '/api/voz') return json({ voz: 'masculina' });
      if (url.pathname === '/api/invite-code') return json({ code: 'ABCD1234' });
      if (url.pathname === '/api/invitaciones') return json({ invitaciones: [] });
      return json({});
    });
    await page.goto(base + '/app.html', { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    const estado = await page.evaluate(() => ({
      login: getComputedStyle(document.getElementById('loginScreen')).display,
      app: getComputedStyle(document.getElementById('appContent')).display,
      voz: document.getElementById('vozGeneroSelect').value,
    }));
    ok(estado.login === 'none', `${nombre}: no vuelve a la pantalla de login`);
    ok(estado.app !== 'none', `${nombre}: se ve la app`);
    ok(errores.length === 0, `${nombre}: sin errores de JavaScript${errores.length ? ' — ' + errores.join(' | ') : ''}`);
    ok(pedidos.includes('/api/voz') && estado.voz === 'masculina', `${nombre}: carga la voz elegida y la muestra en el menú`);
    await page.close();
  }

  await browser.close();
  server.close();
  console.log(fallas ? `\n${fallas} fallaron` : '\nTodo bien');
  process.exit(fallas ? 1 : 0);
})();
