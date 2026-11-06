// El enlace "¿Olvidaste tu clave?" del ingreso y la página de restablecer en sus dos modos:
// sin correo propio (solo explica cómo pedir ayuda) y con correo (pide el correo, y con el enlace escribe la clave nueva).
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
  const errores = [];
  const nuevaPagina = async (estado, extra) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
    page.on('pageerror', (e) => errores.push(e.message));
    const enviados = { olvide: null, restablecer: null };
    await page.route('**/api/**', (route) => {
      const req = route.request();
      const u = new URL(req.url());
      const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.pathname === '/api/me') return json({ error: 'No autenticado.' }, 401);
      if (u.pathname === '/api/clave/estado') return json(estado);
      if (u.pathname === '/api/clave/verificar') return json({ valido: u.searchParams.get('t') === 'b'.repeat(64) });
      if (u.pathname === '/api/clave/olvide') { enviados.olvide = JSON.parse(req.postData()); return json({ ok: true }); }
      if (u.pathname === '/api/clave/restablecer') { enviados.restablecer = JSON.parse(req.postData()); return json({ ok: true }); }
      return json({});
    });
    return { page, enviados };
  };

  console.log('--- sin correo propio ---');
  {
    const { page, enviados } = await nuevaPagina({ porCorreo: false, mensaje: 'Escríbenos a ayuda@ejemplo.com y te ayudamos.' });
    await page.goto(base + '/app.html');
    await page.waitForSelector('#loginScreen', { state: 'visible' });
    ok(await page.isVisible('#olvideClave'), 'el ingreso muestra "¿Olvidaste tu clave?"');
    await page.click('#olvideClave');
    await page.waitForURL('**/restablecer.html');
    await page.waitForSelector('#vistaAyuda:not([hidden])');
    ok(/ayuda@ejemplo\.com/.test(await page.textContent('#ayudaTexto')), 'explica a qué correo escribir para pedir ayuda');
    ok(!(await page.isVisible('#formPedir')) && !(await page.isVisible('#formNueva')), 'no hay ningún formulario para cambiar la clave');
    ok(!enviados.olvide && !enviados.restablecer, 'no se envía nada al servidor');
  }

  console.log('--- con correo propio ---');
  {
    const { page, enviados } = await nuevaPagina({ porCorreo: true });
    await page.goto(base + '/restablecer.html');
    await page.waitForSelector('#vistaPedir:not([hidden])');
    await page.click('#btnPedir');
    ok(/correo/i.test(await page.textContent('#msg')) && !enviados.olvide, 'sin correo avisa y no envía');
    await page.fill('#correo', 'paula@ejemplo.com');
    await page.click('#btnPedir');
    await page.waitForSelector('#vistaEnviado:not([hidden])');
    ok(enviados.olvide && enviados.olvide.correo === 'paula@ejemplo.com', 'pide el enlace con el correo');
    ok(/30 minutos/.test(await page.textContent('#vistaEnviado')), 'avisa que el enlace dura 30 minutos');
  }
  {
    const { page } = await nuevaPagina({ porCorreo: true });
    await page.goto(base + '/restablecer.html?t=' + 'c'.repeat(64));
    await page.waitForSelector('#vistaPedir:not([hidden])');
    ok(/venció|no sirve/.test(await page.textContent('#msg')), 'un enlace que no sirve avisa y deja pedir otro');
  }
  {
    const { page, enviados } = await nuevaPagina({ porCorreo: true });
    await page.goto(base + '/restablecer.html?t=' + 'b'.repeat(64));
    await page.waitForSelector('#vistaNueva:not([hidden])');
    await page.fill('#clave', '123');
    await page.fill('#clave2', '123');
    await page.click('#btnNueva');
    ok(/6 caracteres/.test(await page.textContent('#msg')) && !enviados.restablecer, 'una clave corta se rechaza sin enviar nada');
    await page.fill('#clave', 'claveNueva9');
    await page.fill('#clave2', 'otraCosa99');
    await page.click('#btnNueva');
    ok(/no coinciden/.test(await page.textContent('#msg')) && !enviados.restablecer, 'si no coinciden avisa y no envía');
    await page.click('#verClave');
    ok(await page.getAttribute('#clave', 'type') === 'text' && await page.getAttribute('#clave2', 'type') === 'text', '"Mostrar" muestra las dos claves');
    await page.fill('#clave2', 'claveNueva9');
    await page.click('#btnNueva');
    await page.waitForSelector('#vistaListo:not([hidden])');
    ok(enviados.restablecer && enviados.restablecer.token === 'b'.repeat(64) && enviados.restablecer.clave === 'claveNueva9', 'envía el enlace y las dos claves');
    ok(await page.isVisible('a.rest-boton'), 'queda el botón para entrar con la clave nueva');
  }
  ok(errores.length === 0, 'sin errores de JavaScript' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close();
  server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
