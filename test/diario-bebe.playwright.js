// Diario de un bebé: el botón con el nombre dentro de la sesión (modo rosado), subir una foto del día,
// la charla con el modo activo y la página del diario (dueña y familiar invitada).
//   node test/diario-bebe.playwright.js   (o: npm run test:diario-bebe)
const path = require('path');
const fs = require('fs');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright: corre "npm install".'); process.exit(1); }
let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const CAPTURAS = process.env.CAPTURAS_BEBE;

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

  async function contexto({ config, puedeEditar = true, entradas = [], esquema = 'light' }) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'], colorScheme: esquema });
    const page = await ctx.newPage();
    const estado = { config, entradas: entradas.slice(), subidas: [], notas: [], pidioNext: [], guardados: [] };
    page.on('pageerror', (e) => (estado.errores = (estado.errores || []).concat(e.message)));
    await page.route('**/api/**', (route) => {
      const req = route.request();
      const u = new URL(req.url());
      const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.pathname === '/api/me') return json({ username: 'paula', name: 'Paula Bejarano', email: 'p@x.com', isCollaborator: false, isGuest: false });
      if (u.pathname === '/api/bebe' && req.method() === 'GET') return json({ config: estado.config, puedeEditar, dueno: 1, entradas: estado.entradas });
      if (u.pathname === '/api/bebe' && req.method() === 'PUT') {
        const b = JSON.parse(req.postData());
        estado.config = { nombre: b.nombre, genero: b.genero, nacioEn: b.nacioEn, estado: b.nacioEn ? 'nacida' : 'en_camino' };
        estado.guardados.push(b);
        return json({ ok: true, config: estado.config });
      }
      if (u.pathname === '/api/bebe/foto') { estado.subidas.push(req.postDataBuffer().length); return json({ ok: true, url: 'https://x.test/media/1/bebe/foto-1.png' }); }
      if (u.pathname === '/api/bebe/entradas' && req.method() === 'POST') {
        const b = JSON.parse(req.postData());
        const e = { id: 100 + estado.notas.length, texto: b.texto || '', fotoUrl: b.fotoUrl ? '/api/bebe/foto/9?owner=1' : null, creadaEn: new Date().toISOString() };
        estado.notas.push(b);
        return json({ ok: true, entrada: e });
      }
      if (u.pathname.startsWith('/api/bebe/foto/')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      if (u.pathname === '/api/next') {
        estado.pidioNext.push(JSON.parse(req.postData()));
        return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: JSON.stringify({ t: 'fin', message: 'Hola, Paula. ¿Cómo te has sentido hoy con Rafaela?', done: false, pausado: false, media: null }) + '\n' });
      }
      return json({});
    });
    return { ctx, page, estado };
  }

  // 1) Sin diario creado: la sesión es la de siempre
  let t = await contexto({ config: null });
  await t.page.goto(base + '/app.html');
  await t.page.waitForTimeout(900);
  ok(await t.page.locator('#ecoBebePill').count() === 0 && await t.page.locator('#umBebeLink').count() === 1, 'sin diario: no hay botón en la sesión, pero el menú tiene "Diario de un bebé"');
  await t.ctx.close();

  // 2) Con diario: botón con el nombre y modo rosado
  t = await contexto({ config: { nombre: 'Rafaela', genero: 'femenino', nacioEn: null, estado: 'en_camino' }, entradas: [{ id: 5, texto: 'Primera ecografía', fotoUrl: '/api/bebe/foto/5?owner=1', creadaEn: new Date().toISOString() }] });
  const p = t.page;
  await p.goto(base + '/app.html');
  await p.waitForSelector('#ecoBebePill', { timeout: 8000 });
  ok((await p.textContent('#ecoBebePill')) === 'Rafaela', 'el botón dentro de la sesión lleva el nombre: Rafaela');
  ok(await p.isHidden('#ecoBebePanel') && await p.evaluate(() => !document.documentElement.classList.contains('eco-bebe-activo')), 'al entrar todavía no cambia nada: sigue la sesión normal');
  const fondoNormal = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await p.click('#ecoBebePill');
  await p.waitForSelector('#ecoBebePanel:not([hidden])');
  const fondoRosa = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(fondoRosa !== fondoNormal && fondoRosa === 'rgb(251, 239, 238)', 'al tocarlo, los colores cambian a rosado tenue (' + fondoRosa + ')');
  ok((await p.textContent('.eco-bebe-chip')) === 'Rafaela, en camino', 'la etiqueta dice "Rafaela, en camino"');
  ok((await p.textContent('#ecoBebeFoto')) === 'Subir una foto de hoy' && await p.locator('.eco-bebe-tira img').count() === 1, 'el botón grande es subir una foto de hoy, con la tira de fotos recientes');
  ok(await p.evaluate(() => window.EcoBebe.activo()), 'el modo queda activo para la charla');
  await p.waitForTimeout(900);
  if (CAPTURAS) await p.screenshot({ path: path.join(CAPTURAS, 'sesion-rosa.png') });

  // subir foto del día con nota
  await p.setInputFiles('#ecoBebePanel input[type=file]', { name: 'hoy.png', mimeType: 'image/png', buffer: PNG });
  await p.waitForSelector('.eco-bebe-nota:not([hidden])');
  await p.fill('.eco-bebe-nota textarea', 'Mi barriga a las 30 semanas');
  await p.click('.eco-bebe-nota button');
  await p.waitForFunction(() => /Guardada en el diario/.test(document.querySelector('.eco-bebe-msg').textContent));
  ok(t.estado.subidas.length === 1 && t.estado.notas[0].texto === 'Mi barriga a las 30 semanas' && t.estado.notas[0].fotoUrl, 'sube la foto y la guarda en el diario con su nota');
  ok(await p.locator('.eco-bebe-tira img').count() === 2, 'la foto nueva aparece en la tira');

  // charla con el modo activo
  await p.click('#ecoBebeHablar');
  await p.waitForFunction(() => true);
  const t0 = Date.now();
  while (!t.estado.pidioNext.length && Date.now() - t0 < 8000) await p.waitForTimeout(100);
  ok(t.estado.pidioNext.length > 0 && t.estado.pidioNext[0].modoBebe === true, 'la charla le avisa al servidor que está en el modo de Rafaela');

  // apagar el modo
  await p.click('#ecoBebePill');
  ok(await p.isHidden('#ecoBebePanel') && await p.evaluate(() => !document.documentElement.classList.contains('eco-bebe-activo') && !window.EcoBebe.activo()), 'tocar de nuevo el botón vuelve a la sesión normal');
  ok(!(t.estado.errores || []).length, 'sin errores de JavaScript' + ((t.estado.errores || []).length ? ': ' + t.estado.errores.join(' | ') : ''));
  await t.ctx.close();

  // 3) Modo oscuro
  t = await contexto({ config: { nombre: 'Rafaela', genero: 'femenino', nacioEn: null, estado: 'en_camino' }, esquema: 'dark' });
  await t.page.goto(base + '/app.html');
  await t.page.waitForSelector('#ecoBebePill');
  await t.page.click('#ecoBebePill');
  await t.page.waitForTimeout(900);
  if (CAPTURAS) await t.page.screenshot({ path: path.join(CAPTURAS, 'sesion-rosa-oscuro.png') });
  await t.ctx.close();

  // 4) Página del diario: crear, ya nació, subir
  t = await contexto({ config: null });
  await t.page.goto(base + '/diario-bebe.html');
  await t.page.waitForSelector('#vistaCrear:not([hidden])');
  await t.page.click('#cfgGuardar');
  ok(/nombre/i.test(await t.page.textContent('#estado')), 'sin nombre no deja crear el diario');
  await t.page.fill('#cfgNombre', 'Rafaela');
  await t.page.selectOption('#cfgGenero', 'femenino');
  await t.page.click('#cfgGuardar');
  await t.page.waitForSelector('#vistaDiario:not([hidden])');
  ok((await t.page.textContent('#titulo')) === 'Diario de Rafaela' && (await t.page.textContent('#subtitulo')) === 'Rafaela, en camino', 'crea el diario: "Diario de Rafaela, en camino"');
  await t.page.fill('#textoNota', 'Hoy escuché su corazón');
  await t.page.click('#guardarNota');
  await t.page.waitForSelector('.eco-bebe-entrada');
  ok((await t.page.textContent('.eco-bebe-entrada p')) === 'Hoy escuché su corazón', 'escribe una nota del día y aparece en el diario');
  await t.page.click('#ajustes summary');
  await t.page.check('#cfgNacio');
  await t.page.click('#cfgGuardar');
  await t.page.waitForFunction(() => /ya llegó/.test(document.getElementById('subtitulo').textContent));
  ok(/Rafaela, ya llegó/.test(await t.page.textContent('#subtitulo')) && t.estado.guardados.at(-1).nacioEn, 'marcar "ya nació" cambia el diario a "ya llegó" con la fecha de hoy');
  if (CAPTURAS) await t.page.screenshot({ path: path.join(CAPTURAS, 'diario.png'), fullPage: true });
  ok(!(t.estado.errores || []).length, 'la página del diario sin errores de JavaScript');
  await t.ctx.close();

  // 5) Familiar invitada: solo ve
  t = await contexto({ config: { nombre: 'Rafaela', genero: 'femenino', nacioEn: null, estado: 'en_camino' }, puedeEditar: false, entradas: [{ id: 5, texto: 'Primera ecografía', fotoUrl: '/api/bebe/foto/5?owner=1', creadaEn: new Date().toISOString() }] });
  await t.page.goto(base + '/diario-bebe.html?owner=1');
  await t.page.waitForSelector('.eco-bebe-entrada');
  ok(await t.page.isHidden('#nuevaEntrada') && await t.page.isHidden('#ajustes') && await t.page.locator('.eco-bebe-borrar').count() === 0, 'una familiar invitada ve las fotos y notas, sin poder subir ni borrar');
  await t.ctx.close();

  await browser.close();
  server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
