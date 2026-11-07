// Enlace abierto: (1) la página colaborar.html?abierto=... pide nombre y apellido (obligatorios) y los Términos;
// (2) el modal «Invitar» de la app tiene la opción del enlace abierto para copiar, compartir por WhatsApp y renovar.
//   node test/enlace-abierto.playwright.js   (o: npm run test:enlace-abierto)
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

  console.log('--- colaborar.html?abierto= ---');
  {
    const page = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
    page.on('pageerror', (e) => errores.push(e.message));
    let enviado = null;
    await page.route('**/api/**', (route) => {
      const u = new URL(route.request().url());
      const json = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.pathname === '/api/me') return json({ error: 'No autenticado.' }, 401);
      if (u.pathname === '/api/guest-code-info') return json({ ownerName: 'Felipe' });
      if (u.pathname === '/api/guest-abierto') { enviado = JSON.parse(route.request().postData()); return json({ ok: true }); }
      return json({});
    });
    await page.goto(base + '/colaborar.html?abierto=CODIGO123');
    await page.waitForSelector('#guestScreen', { state: 'visible' });
    await page.waitForSelector('#guestNombre', { state: 'visible' });
    ok(/Felipe/.test(await page.textContent('#guestOwnerName')), 'muestra con quién va a colaborar (el dueño del libro)');
    for (const ancho of [390, 1280]) {
      await page.setViewportSize({ width: ancho, height: 844 });
      const g = await page.evaluate(() => { const r = document.getElementById('guestScreen').getBoundingClientRect(); return { izq: r.left, der: innerWidth - r.right }; });
      ok(Math.abs(g.izq - g.der) <= 1, `la tarjeta de entrada queda centrada con pantalla de ${ancho}px (márgenes ${Math.round(g.izq)} y ${Math.round(g.der)})`);
    }
    await page.setViewportSize({ width: 420, height: 900 });
    const hueco = await page.evaluate(() => document.getElementById('guestNombreRow').getBoundingClientRect().top - document.getElementById('guestOwnerName').getBoundingClientRect().bottom);
    ok(hueco < 60, 'no hay un hueco grande entre el nombre del dueño y el formulario (' + Math.round(hueco) + 'px)');
    ok(await page.isVisible('#guestApellido') && await page.isVisible('#guestTermsRow'), 'pide nombre y apellido y los Términos');
    ok(/Entrar a colaborar/.test(await page.textContent('#guestStartBtn')), 'el botón dice «Entrar a colaborar»');
    ok(/Solo tu nombre y apellido/.test(await page.textContent('#guestSinCuenta')), 'explica que no necesita cuenta ni clave');
    await page.click('#guestStartBtn');
    ok(/Escribe tu nombre/.test(await page.textContent('#guestError')) && !enviado, 'sin nombre avisa y no envía');
    await page.fill('#guestNombre', 'Ana');
    await page.click('#guestStartBtn');
    ok(/Escribe tu apellido/.test(await page.textContent('#guestError')) && !enviado, 'sin apellido avisa y no envía (el apellido es obligatorio)');
    await page.fill('#guestApellido', 'Gómez');
    await page.click('#guestStartBtn');
    ok(/Términos/.test(await page.textContent('#guestError')) && !enviado, 'sin aceptar los Términos avisa y no envía');
    await page.check('#guestTerms');
    await page.click('#guestStartBtn');
    await page.waitForFunction(() => true);
    await page.waitForTimeout(400);
    ok(enviado && enviado.codigo === 'CODIGO123' && enviado.nombre === 'Ana' && enviado.apellido === 'Gómez' && enviado.acceptTerms === true, 'envía código, nombre, apellido y aceptación');
  }
  {
    const page = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
    await page.route('**/api/**', (route) => {
      const u = new URL(route.request().url());
      const json = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.pathname === '/api/me') return json({ error: 'No autenticado.' }, 401);
      if (u.pathname === '/api/guest-code-info') return json({ error: 'Ese código no existe.' }, 404);
      return json({});
    });
    await page.goto(base + '/colaborar.html?abierto=VIEJO');
    await page.waitForSelector('#guestError:not(:empty)');
    ok(!(await page.isVisible('#guestNombre')) && /ya no es válido|no existe/.test(await page.textContent('#guestError')), 'con un enlace que ya no sirve avisa y no muestra el formulario');
  }

  console.log('--- modal Invitar en app.html ---');
  {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base }).catch(() => {});
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errores.push(e.message));
    let codigo = 'ABCD1234';
    let regeneraciones = 0;
    await page.route('**/api/**', (route) => {
      const u = new URL(route.request().url());
      const json = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.pathname === '/api/me') return json({ isCollaborator: false, username: 'felipe', name: 'Felipe', email: 'f@x.co', fechaNacimiento: null, isAdmin: false });
      if (u.pathname === '/api/intro') return json({ aplica: false, pendiente: false });
      if (u.pathname === '/api/tree/pending') return json({ names: [] });
      if (u.pathname === '/api/invite-code') return json({ code: codigo });
      if (u.pathname === '/api/invite-code/regenerate') { regeneraciones++; codigo = 'NUEVO5678'; return json({ code: codigo }); }
      if (u.pathname === '/api/invitaciones') return json({ invitaciones: [] });
      return json({});
    });
    page.on('dialog', (d) => d.accept());
    await page.goto(base + '/app.html');
    await page.waitForSelector('#inviteToggle', { state: 'visible' });
    await page.click('#inviteToggle');
    await page.waitForSelector('#ecoInviteModal:not([hidden])');
    const primera = (await page.locator('#ecoInviteChoices [data-view]').first().getAttribute('data-view'));
    ok(primera === 'abierto', 'la primera opción del modal es el enlace abierto');
    await page.click('[data-view="abierto"]');
    await page.waitForFunction(() => /abierto=ABCD1234/.test(document.getElementById('ecoAbiertoUrl').value));
    ok((await page.inputValue('#ecoAbiertoUrl')).endsWith('/colaborar.html?abierto=ABCD1234'), 'muestra el enlace abierto con el código de la bitácora');
    const wa = await page.getAttribute('#ecoAbiertoWhatsapp', 'href');
    ok(/^https:\/\/wa\.me\/\?text=/.test(wa) && decodeURIComponent(wa).includes('abierto=ABCD1234') && /apellido/.test(decodeURIComponent(wa)), 'el botón de WhatsApp comparte el enlace con un mensaje que pide nombre y apellido');
    await page.click('#ecoAbiertoCopiar');
    await page.waitForFunction(() => /Enlace copiado/.test(document.getElementById('ecoAbiertoMsg').textContent), null, { timeout: 5000 }).catch(() => {});
    ok(/Enlace copiado/.test(await page.textContent('#ecoAbiertoMsg')), 'al copiar avisa «Enlace copiado»');
    await page.click('#ecoAbiertoNuevo');
    await page.waitForFunction(() => /abierto=NUEVO5678/.test(document.getElementById('ecoAbiertoUrl').value));
    ok(regeneraciones === 1 && /enlace nuevo/.test(await page.textContent('#ecoAbiertoMsg')), 'generar un enlace nuevo cambia el código y lo avisa');
    ok(await page.locator('#ecoInviteChoices [data-view]').count() === 3, 'siguen las otras dos opciones (invitación personal y vincular cuenta)');
    await page.click('#ecoInviteBack');
    await page.click('[data-view="whatsapp"]');
    ok(await page.isHidden('#ecoAbiertoUrl'), 'al elegir otra opción el enlace abierto se oculta');
  }
  console.log('--- medición ---');
  {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errores.push(e.message));
    await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.goto(base + '/?desde=colaboracion#registro');
    ok(await page.evaluate(() => window.ecoOrigen()) === 'colaboracion', 'la landing recuerda de dónde llegó la persona (desde=colaboracion)');
    await page.goto(base + '/?desde=%3Cscript%3E');
    ok(await page.evaluate(() => window.ecoOrigen()) === 'colaboracion', 'una etiqueta con caracteres raros no pisa la guardada');
  }
  {
    const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
    page.on('pageerror', (e) => errores.push(e.message));
    let consulta = null;
    await page.route('**/api/**', (route) => {
      const u = new URL(route.request().url());
      const json = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.pathname === '/api/me') return json({ isAdmin: true });
      if (u.pathname === '/api/admin/enlace-abierto') {
        consulta = u.search;
        return json({ entraron: 12, empezaron: 7, terminaron: 4, cuentasNuevas: 2, ultimos: [
          { id: 'a', nombre: 'Ana Gómez', creado: '2026-11-07T15:00:00Z', empezo: true, termino: true, cortado: false },
          { id: 'b', nombre: 'Luis <b>Pérez</b>', creado: '2026-11-07T14:00:00Z', empezo: true, termino: false, cortado: false },
          { id: 'c', nombre: 'Sara Ruiz', creado: '2026-11-07T13:00:00Z', empezo: false, termino: false, cortado: true },
        ] });
      }
      return json({}, 404);
    });
    await page.goto(base + '/admin.html');
    await page.waitForSelector('#enlaceWrap .stat-card');
    const cartas = await page.locator('#enlaceWrap .stat-card').allTextContents();
    ok(cartas.length === 4 && /Entraron\s*12/.test(cartas[0]) && /Empezaron a contar\s*7/.test(cartas[1]) && /Terminaron un recuerdo\s*4/.test(cartas[2]) && /Cuentas nuevas desde ahí\s*2/.test(cartas[3]), 'la tarjeta muestra entraron, empezaron, terminaron y cuentas nuevas');
    ok(/58% de quienes entraron/.test(cartas[1]) && /33% de quienes entraron/.test(cartas[2]) && /50% de quienes terminaron/.test(cartas[3]), 'y los porcentajes de cada paso');
    const filas = await page.locator('#enlaceWrap tbody tr').allTextContents();
    ok(filas.length === 3 && /Terminó un recuerdo/.test(filas[0]) && /Empezó, no terminó/.test(filas[1]) && /Solo entró · acceso cortado/.test(filas[2]), 'la lista dice qué hizo cada uno');
    ok(await page.locator('#enlaceWrap b').count() === 0, 'un nombre con HTML se ve como texto');
    ok(/start=\d{4}-\d{2}-\d{2}&end=\d{4}-\d{2}-\d{2}&tz=/.test(consulta || ''), 'pide las cifras del mismo período que el resto del panel');
  }
  ok(errores.length === 0, 'sin errores de JavaScript' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
