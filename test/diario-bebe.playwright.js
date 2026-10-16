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
    // El tour de bienvenida de ECO tapa los botones: aquí se da por visto.
    await ctx.addInitScript(() => { try { localStorage.setItem('eco_tour_done__app_html', '1'); localStorage.setItem('eco_tour_done__diario_bebe_html', '1'); } catch (e) { /* nada */ } });
    const page = await ctx.newPage();
    const estado = { config, entradas: entradas.slice(), subidas: [], notas: [], audios: [], cambios: [], pidioNext: [], guardados: [] };
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
        const e = { id: 100 + estado.notas.length, texto: b.texto || '', fotoUrl: b.fotoUrl ? '/api/bebe/foto/9?owner=1' : null, audios: b.audioUrl ? ['/api/bebe/audio/' + (100 + estado.notas.length) + '/0?owner=1'] : [], creadaEn: new Date().toISOString() };
        estado.notas.push(b);
        estado.ultima = e;
        return json({ ok: true, entrada: e });
      }
      if (u.pathname === '/api/bebe/audio' && req.method() === 'POST') { estado.audios.push(req.postDataBuffer().length); return json({ ok: true, url: 'https://x.test/media/1/bebe/voz-' + estado.audios.length + '.webm' }); }
      if (/^\/api\/bebe\/entradas\/\d+$/.test(u.pathname) && req.method() === 'PATCH') {
        const b = JSON.parse(req.postData());
        estado.cambios.push(b);
        const e = Object.assign({}, estado.ultima, { id: Number(u.pathname.split('/').pop()), texto: b.texto });
        e.audios = b.borrarAudios ? [] : (estado.ultima.audios || []).concat(b.agregarAudio ? ['/api/bebe/audio/' + e.id + '/' + (estado.ultima.audios || []).length + '?owner=1'] : []);
        estado.ultima = e;
        return json({ ok: true, entrada: e });
      }
      if (u.pathname === '/api/transcribe') return json({ text: estado.dictado || '' });
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
  ok((await p.textContent('#ecoBebePill')) === 'Paula' && (await p.getAttribute('#ecoBebePill', 'aria-label')) === 'Volver al perfil de Paula', 'dentro del modo, el botón dice el nombre de la persona principal para volver a su perfil');
  ok((await p.textContent('.eco-bebe-chip')) === 'Rafaela, en camino', 'la etiqueta dice "Rafaela, en camino"');
  ok((await p.textContent('#ecoBebeFoto')) === 'Subir una foto de hoy' && await p.locator('.eco-bebe-tira img').count() === 1, 'el botón grande es subir una foto de hoy, con la tira de fotos recientes');
  ok(await p.evaluate(() => window.EcoBebe.activo()), 'el modo queda activo para la charla');
  await p.waitForTimeout(900);
  if (CAPTURAS) await p.screenshot({ path: path.join(CAPTURAS, 'sesion-rosa.png') });

  // subir foto del día con nota
  await p.setInputFiles('#ecoBebePanel input[type=file]', { name: 'hoy.png', mimeType: 'image/png', buffer: PNG });
  await p.waitForSelector('.eco-bebe-nota:not([hidden])');
  ok(t.estado.subidas.length === 1 && t.estado.notas.length === 1 && t.estado.notas[0].fotoUrl, 'la foto se guarda en el diario apenas se elige, sin otro botón');
  ok(await p.isHidden('.eco-bebe-nota textarea') && await p.isVisible('.eco-bebe-nota .eco-bebe-orbe') && await p.locator('.eco-bebe-nota .eco-bebe-grande').count() === 0, 'la nota se cuenta por voz: botón de ECO, sin caja de texto ni botón de guardar');
  t.estado.dictado = 'Mi barriga a las 30 semanas';
  await p.click('.eco-bebe-nota .eco-bebe-orbe');
  await p.waitForSelector('.eco-bebe-nota .eco-bebe-orbe.grabando');
  await p.waitForTimeout(700);
  await p.click('.eco-bebe-nota .eco-bebe-orbe', { force: true }); // late mientras graba
  await p.waitForSelector('.eco-bebe-nota .eco-bebe-dicho:not([hidden])');
  ok((await p.textContent('.eco-bebe-nota .eco-bebe-dicho')) === '«Mi barriga a las 30 semanas»', 'lo que dijo aparece escrito');
  ok(/Guardado en el diario/.test(await p.textContent('.eco-bebe-nota .eco-bebe-voz-msg')), 'y avisa que quedó guardado solo');
  ok(t.estado.audios.length === 1 && t.estado.audios[0] > 0 && t.estado.cambios.length === 1 && t.estado.cambios[0].texto === 'Mi barriga a las 30 semanas' && /voz-1\.webm$/.test(t.estado.cambios[0].agregarAudio), 'se sube el audio original y se pega, con lo dicho, a la entrada de la foto');
  t.estado.dictado = 'y pateó';
  await p.click('.eco-bebe-nota .eco-bebe-orbe');
  await p.waitForSelector('.eco-bebe-nota .eco-bebe-orbe.grabando');
  await p.waitForTimeout(700);
  await p.click('.eco-bebe-nota .eco-bebe-orbe', { force: true });
  await p.waitForFunction(() => /pateó/.test(document.querySelector('.eco-bebe-nota .eco-bebe-dicho').textContent));
  ok(t.estado.cambios.length === 2 && t.estado.cambios[1].texto === 'Mi barriga a las 30 semanas y pateó' && t.estado.notas.length === 1, '"contar más" suma a la misma entrada, con su propio audio');
  await p.click('.eco-bebe-nota .eco-bebe-revoz');
  await p.waitForFunction(() => document.querySelector('.eco-bebe-nota .eco-bebe-dicho').hidden);
  ok(t.estado.cambios.at(-1).borrarAudios === true && t.estado.cambios.at(-1).texto === '', '"borrar y volver a contar" limpia la nota guardada y sus audios');
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
  ok((await p.textContent('#ecoBebePill')) === 'Rafaela', 'y el botón vuelve a decir el nombre del bebé');
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
  t.estado.dictado = 'Hoy escuché su corazón';
  await t.page.click('#campoNota .eco-bebe-orbe');
  await t.page.waitForSelector('#campoNota .eco-bebe-orbe.grabando');
  await t.page.waitForTimeout(700);
  await t.page.click('#campoNota .eco-bebe-orbe', { force: true }); // late mientras graba
  await t.page.waitForSelector('#campoNota .eco-bebe-dicho:not([hidden])');
  await t.page.waitForSelector('.eco-bebe-entrada');
  ok((await t.page.textContent('.eco-bebe-entrada p')) === 'Hoy escuché su corazón' && t.estado.notas.at(-1).audioUrl, 'cuenta por voz una nota del día y aparece sola en el diario, con su audio');
  ok(await t.page.locator('.eco-bebe-entrada audio').count() === 1, 'la nota de voz original se puede escuchar en el diario');
  await t.page.click('#ajustes summary');
  await t.page.check('#cfgNacio');
  await t.page.click('#cfgGuardar');
  await t.page.waitForFunction(() => /ya llegó/.test(document.getElementById('subtitulo').textContent));
  ok(/Rafaela, ya llegó/.test(await t.page.textContent('#subtitulo')) && t.estado.guardados.at(-1).nacioEn, 'marcar "ya nació" cambia el diario a "ya llegó" con la fecha de hoy');
  if (CAPTURAS) await t.page.screenshot({ path: path.join(CAPTURAS, 'diario.png'), fullPage: true });
  ok(!(t.estado.errores || []).length, 'la página del diario sin errores de JavaScript');
  await t.ctx.close();

  // 4b) Si es niño: la misma paleta en azul clarito (sesión y página del diario)
  t = await contexto({ config: { nombre: 'Tomás', genero: 'masculino', nacioEn: null, estado: 'en_camino' } });
  await t.page.goto(base + '/app.html');
  await t.page.waitForSelector('#ecoBebePill', { timeout: 8000 });
  await t.page.click('#ecoBebePill');
  await t.page.waitForSelector('#ecoBebePanel:not([hidden])');
  const fondoAzul = await t.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(fondoAzul === 'rgb(238, 245, 251)', 'si es niño, el modo de la sesión es azul clarito (' + fondoAzul + ')');
  await t.page.waitForTimeout(900); // que termine la transición de color antes de la captura
  if (CAPTURAS) await t.page.screenshot({ path: path.join(CAPTURAS, 'sesion-azul.png') });
  await t.page.goto(base + '/diario-bebe.html');
  await t.page.waitForSelector('#vistaDiario:not([hidden])');
  const fondoDiarioAzul = await t.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(fondoDiarioAzul === 'rgb(238, 245, 251)', 'y la página del diario también (' + fondoDiarioAzul + ')');
  if (CAPTURAS) await t.page.screenshot({ path: path.join(CAPTURAS, 'diario-azul.png'), fullPage: true });
  ok(!(t.estado.errores || []).length, 'el modo azul sin errores de JavaScript');
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
