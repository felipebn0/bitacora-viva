// Colaboración: menú de dos opciones, botones verdes, sin "Quiénes han colaborado", celular con bandera
// (Colombia o Estados Unidos, 10 dígitos) y volver desde "Aportar a una historia".
//   node test/colaboracion.playwright.js
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright: corre "npm install".'); process.exit(1); }
let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };
const CAPTURAS = process.env.CAPTURAS_COLAB;

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  let enviada = null;
  const pedidos = [];
  await page.route('**/api/**', (route) => {
    const req = route.request();
    const u = new URL(req.url());
    pedidos.push(u.pathname);
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/me') return json({ username: 'felipe', name: 'Felipe', isCollaborator: false, isGuest: false, puedeNarrar: true });
    if (u.pathname === '/api/subprofiles') return json({ perfiles: [{ id: 1, nombre: 'Felipe', esPropia: true }] });
    if (u.pathname === '/api/contributions') return json({ notes: [{ id: 3, contributor: 'Diego', parentesco: 'hermano', texto: 'Una tarde de pesca en el río con el abuelo.', audio_urls: [], media_urls: [] }] });
    if (u.pathname === '/api/invitaciones' && req.method() === 'POST') { enviada = JSON.parse(req.postData()); return json({ ok: true, invitacion: { telefono: '573001234567', mensaje: 'Hola Tía, entra: https://bitacora-viva.vercel.app/colaborar.html?invitacion=abc' } }); }
    if (u.pathname === '/api/invitaciones') return json({ invitaciones: [] });
    return json({});
  });

  await page.goto(base + '/colaboraciones.html');
  await page.waitForSelector('.eco-c-story-card');
  const texto = await page.innerText('body');
  ok(!/Quiénes han colaborado/.test(texto) && !/Ver colaboradores/.test(texto), 'ya no aparece "Quiénes han colaborado"');
  ok(!pedidos.includes('/api/tree/colaboradores'), 'ni se pide esa lista al servidor');
  ok((await page.textContent('.aportar-ahora')).trim() === 'Aportar a una historia', 'el botón dice "Aportar a una historia"');
  const verde = await page.evaluate(() => {
    const c = (sel) => getComputedStyle(document.querySelector(sel)).backgroundColor;
    return { cta: c('.aportar-ahora'), invitar: c('.eco-c-colabs-btnrow button'), tabActivo: c('.tab-btn.active') };
  });
  ok(verde.cta === 'rgb(77, 101, 66)' && verde.invitar === 'rgb(77, 101, 66)' && verde.tabActivo === 'rgb(77, 101, 66)', 'los botones clickeables están en verde');
  ok(await page.locator('.tabs-row .tab-btn').count() === 2 && /dijeron de mí/.test(await page.textContent('.tabs-row')) && /yo dije de otros/.test(await page.textContent('.tabs-row')), '"Lo que dijeron de mí" y "Lo que yo dije de otros" quedan juntos como un menú');
  if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, 'colaboracion.png'), fullPage: true });

  await page.click('.eco-c-colabs-btnrow button');
  await page.waitForSelector('#ecoInvitarModal:not([hidden])');
  ok(await page.locator('#ecoInvitarModal .eco-tel-pais option').count() === 2, 'el celular tiene un menú con solo dos países');
  const opciones = await page.locator('#ecoInvitarModal .eco-tel-pais option').allTextContents();
  ok(opciones[0].includes('🇨🇴') && opciones[0].includes('+57') && opciones[1].includes('🇺🇸') && opciones[1].includes('+1'), 'con bandera: Colombia (+57) y Estados Unidos (+1)');
  await page.fill('#inviteNombre', 'tía marta');
  await page.fill('#invitePhone', '30012');
  await page.click('#inviteSendBtn');
  ok(/10 dígitos/.test(await page.textContent('#inviteMsg')) && !enviada, 'con menos de 10 dígitos avisa y no envía');
  await page.fill('#invitePhone', '3001234567');
  ok((await page.inputValue('#invitePhone')) === '300 123 4567', 'el número se acomoda: 300 123 4567');
  await page.click('#inviteSendBtn');
  await page.waitForSelector('#invitePreview:not([hidden])');
  ok(enviada && enviada.telefono === '+573001234567', 'al servidor viaja +57 y los 10 dígitos');
  ok(/https:\/\//.test(await page.inputValue('#inviteMsgEdit')), 'el mensaje trae el enlace con https');
  if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, 'colaboracion-invitar.png') });
  await page.fill('#inviteNombre', 'Tío Sam');
  await page.selectOption('#ecoInvitarModal .eco-tel-pais', '+1');
  await page.fill('#invitePhone', '2125551234');
  enviada = null;
  await page.click('#inviteSendBtn');
  const t0 = Date.now(); while (!enviada && Date.now() - t0 < 4000) await page.waitForTimeout(50);
  ok(enviada && enviada.telefono === '+12125551234', 'con Estados Unidos viaja +1 y los 10 dígitos');

  const p2 = await page.context().newPage();
  p2.on('pageerror', (e) => errores.push(e.message));
  await p2.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await p2.goto(base + '/colaborar.html');
  ok(await p2.locator('#ownTopbar a.volver').getAttribute('href') === '/colaboraciones.html', 'en "Aportar a una historia" el enlace de volver lleva a Colaboración');
  ok(!(await p2.textContent('body')).includes('Ver el diario'), 'y ya no hay botón de diario ahí');
  ok(errores.length === 0, 'sin errores de JavaScript' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close();
  server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
