// El enlace "¿Olvidaste tu clave?" del ingreso y la página para escribir la clave nueva dos veces.
//   node test/restablecer-clave.playwright.js
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
  const page = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  let enviado = null;
  await page.route('**/api/**', (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/me') return json({ error: 'No autenticado.' }, 401);
    if (u.pathname === '/api/clave/restablecer') { enviado = JSON.parse(req.postData()); return enviado.usuario === 'nadie' ? json({ error: 'No encontramos una cuenta con ese correo o usuario.' }, 404) : json({ ok: true }); }
    return json({});
  });

  await page.goto(base + '/app.html');
  await page.waitForSelector('#loginScreen', { state: 'visible' });
  ok(await page.isVisible('#olvideClave'), 'el ingreso muestra "¿Olvidaste tu clave?"');
  await page.click('#olvideClave');
  await page.waitForURL('**/restablecer.html');

  await page.click('#btnNueva');
  ok(/correo o usuario/i.test(await page.textContent('#msg')), 'sin correo o usuario avisa');
  await page.fill('#usuario', 'paula@ejemplo.com');
  await page.fill('#clave', '123');
  await page.fill('#clave2', '123');
  await page.click('#btnNueva');
  ok(/6 caracteres/.test(await page.textContent('#msg')) && !enviado, 'una clave corta se rechaza sin enviar nada');
  await page.fill('#clave', 'claveNueva9');
  await page.fill('#clave2', 'otraCosa99');
  await page.click('#btnNueva');
  ok(/no coinciden/.test(await page.textContent('#msg')) && !enviado, 'si no coinciden avisa y no envía');
  await page.click('#verClave');
  ok(await page.getAttribute('#clave', 'type') === 'text' && await page.getAttribute('#clave2', 'type') === 'text', '"Mostrar" muestra las dos claves');
  await page.fill('#clave2', 'claveNueva9');
  await page.click('#btnNueva');
  await page.waitForSelector('#vistaListo:not([hidden])');
  ok(enviado && enviado.usuario === 'paula@ejemplo.com' && enviado.clave === 'claveNueva9' && enviado.claveConfirmar === 'claveNueva9', 'envía el usuario y las dos claves');
  ok(await page.isVisible('a.rest-boton'), 'queda el botón para entrar con la clave nueva');

  await page.goto(base + '/restablecer.html');
  await page.fill('#usuario', 'nadie');
  await page.fill('#clave', 'claveNueva9');
  await page.fill('#clave2', 'claveNueva9');
  await page.click('#btnNueva');
  await page.waitForFunction(() => /No encontramos/.test(document.getElementById('msg').textContent));
  ok(await page.isVisible('#vistaNueva'), 'si la cuenta no existe, muestra el error y deja corregir');
  ok(errores.length === 0, 'sin errores de JavaScript' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close();
  server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
