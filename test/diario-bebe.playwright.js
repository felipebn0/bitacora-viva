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
  const cajaPill = await p.locator('#ecoBebePill').boundingBox();
  const cajaChip = await p.locator('.eco-bebe-chip').boundingBox();
  ok(Math.abs((cajaPill.y + cajaPill.height / 2) - (cajaChip.y + cajaChip.height / 2)) < 6 && cajaChip.x > cajaPill.x, 'el estado del bebé va al lado del botón, en la misma fila');
  ok(await p.isHidden('.eco-bebe-edad'), 'mientras está "en camino" no se muestra la edad');
  ok(await p.locator('.eco-bebe-pregunta').count() === 0 && !/Cuéntame cómo te sientes hoy/.test(await p.textContent('#ecoBebePanel')), 'ya no aparece "Cuéntame cómo te sientes hoy"');
  ok((await p.textContent('#ecoBebeFoto')) === 'Subir una foto de hoy' && await p.locator('.eco-bebe-tira img').count() === 1, 'el botón grande es subir una foto de hoy, con la tira de fotos recientes');
  ok(await p.evaluate(() => window.EcoBebe.activo()), 'el modo queda activo para la charla');
  await p.waitForTimeout(900);
  if (CAPTURAS) await p.screenshot({ path: path.join(CAPTURAS, 'sesion-rosa.png') });

  // subir foto del día: se guarda sola, queda en el centro y arranca la charla grande para contar su historia
  ok(await p.locator('#ecoBebeHablar').count() === 0, 'ya no está el botón "Contar mi día con…" (hacía lo mismo que el botón grande)');
  await p.click('#ecoBebeFoto', { noWaitAfter: true }).catch(() => {});
  await p.setInputFiles('#ecoBebePanel input[type=file]', { name: 'hoy.png', mimeType: 'image/png', buffer: PNG });
  await p.waitForFunction(() => /Foto guardada/.test(document.querySelector('.eco-bebe-msg').textContent));
  ok(t.estado.subidas.length === 1 && t.estado.notas.length === 1 && t.estado.notas[0].fotoUrl, 'la foto se guarda en el diario apenas se elige, sin otro botón');
  ok(await p.locator('#ecoBebePanel .eco-bebe-orbe, #ecoBebePanel textarea').count() === 0, 'en el panel ya no está el botón redondo pequeño ni la caja de texto');
  ok(await p.locator('.eco-bebe-tira img').count() === 2, 'la foto nueva aparece en la tira');
  const cajaTira = await p.locator('.eco-bebe-tira').boundingBox();
  const fotos = await p.locator('.eco-bebe-tira li').evaluateAll((lis) => lis.map((li) => { const r = li.getBoundingClientRect(); return [r.left, r.right]; }));
  const izq = Math.min(...fotos.map((f) => f[0])) - cajaTira.x;
  const der = cajaTira.x + cajaTira.width - Math.max(...fotos.map((f) => f[1]));
  ok(Math.abs(izq - der) < 4, 'las fotos quedan centradas');
  const t0 = Date.now();
  while (!t.estado.pidioNext.length && Date.now() - t0 < 8000) await p.waitForTimeout(100);
  const primerTurno = t.estado.pidioNext[0] || {};
  ok(primerTurno.modoBebe === true, 'la charla grande arranca sola, en el modo de Rafaela');
  await p.waitForTimeout(600);
  ok(await p.evaluate(() => { const img = document.querySelector('#mediaMomentoImg, .media-momento img'); return !!img && !img.hidden && img.getAttribute('src').startsWith('/api/bebe/foto/') && img.naturalWidth > 0; }), 'la foto se ve encima del botón de ECO mientras cuenta su historia (sin imagen rota)');
  ok(primerTurno.fotoRecienSubida && primerTurno.bebeFotoId === 100, 'y ECO sabe que acaba de subir esa foto (para preguntar por ella y pegarle lo que cuente)');

  // Si en la charla contó que ya nació, el servidor avisa (data.bebe) y el estado cambia solo.
  await p.evaluate(() => window.EcoBebe.actualizar({ nombre: 'Rafaela', genero: 'femenino', nacioEn: new Date().toISOString().slice(0, 10), estado: 'nacida' }));
  ok((await p.textContent('.eco-bebe-chip')) === 'Rafaela, ya llegó', 'al contar en la charla que ya nació, el estado cambia a "ya llegó" sin recargar');
  ok(await p.isVisible('.eco-bebe-edad') && (await p.textContent('.eco-bebe-edad')).replace(/\s+/g, '') === 'EdadHoynació', 'el día que nace, arriba a la derecha dice "Edad · Hoy nació"');
  const hace21 = (() => { const d = new Date(); d.setDate(d.getDate() - 21); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  await p.evaluate((f) => window.EcoBebe.actualizar({ nacioEn: f }), hace21);
  const cajaEdad = await p.locator('.eco-bebe-edad').boundingBox();
  const cajaTarjeta = await p.locator('.device').boundingBox();
  ok((await p.textContent('.eco-bebe-edad .eco-bebe-edad-num')) === '21' && (await p.textContent('.eco-bebe-edad .eco-bebe-edad-unidad')) === 'días', 'a las 3 semanas dice "Edad 21 días"');
  ok(cajaEdad.x + cajaEdad.width > cajaTarjeta.x + cajaTarjeta.width - 40 && cajaEdad.y < cajaTarjeta.y + 40, 'la edad va en la esquina superior derecha de la tarjeta');
  const cajaChip2 = await p.locator('.eco-bebe-chip').boundingBox();
  const cajaPill2 = await p.locator('#ecoBebePill').boundingBox();
  const seCruzan = (r1, r2) => r1.x < r2.x + r2.width && r2.x < r1.x + r1.width && r1.y < r2.y + r2.height && r2.y < r1.y + r1.height;
  ok(!seCruzan(cajaEdad, cajaChip2) && !seCruzan(cajaEdad, cajaPill2), 'la edad no se monta sobre el nombre ni el estado');
  if (CAPTURAS) await p.screenshot({ path: path.join(CAPTURAS, 'sesion-edad.png') });

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
  t = await contexto({ config: { nombre: 'Rafaela', genero: 'femenino', nacioEn: null, estado: 'en_camino' }, puedeEditar: false, entradas: [{ id: 5, texto: 'Primera ecografía', fotoUrl: '/api/bebe/foto/5?owner=1', creadaEn: new Date().toISOString() }, { id: 6, texto: 'Hoy le armamos la cuna con mi papá', fotoUrl: null, audios: [], deCharla: true, creadaEn: new Date().toISOString() }] });
  await t.page.goto(base + '/diario-bebe.html?owner=1');
  await t.page.waitForSelector('.eco-bebe-entrada');
  ok(await t.page.isHidden('#nuevaEntrada') && await t.page.isHidden('#ajustes') && await t.page.locator('.eco-bebe-borrar').count() === 0, 'una familiar invitada ve las fotos y notas, sin poder subir ni borrar');
  ok(await t.page.locator('.eco-bebe-origen').count() === 1 && (await t.page.textContent('.eco-bebe-origen')) === 'De la charla con ECO', 'lo que se contó en la charla aparece en el diario marcado "De la charla con ECO"');
  if (CAPTURAS) await t.page.screenshot({ path: path.join(CAPTURAS, 'diario-charla.png'), fullPage: true });
  await t.ctx.close();

  await browser.close();
  server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
