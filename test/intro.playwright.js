// La intro de la primera vez en un navegador real (public/eco-intro.js): mensaje de regalo,
// explicación, dos pruebas de micrófono (con micrófono falso), saltar y repetir.
//   node test/intro.playwright.js
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright: corre "npm install".'); process.exit(1); }

let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.from([36, 0, 0, 0]), Buffer.from('WAVEfmt '), Buffer.from([16, 0, 0, 0, 1, 0, 1, 0, 0x40, 0x1f, 0, 0, 0x80, 0x3e, 0, 0, 2, 0, 16, 0]), Buffer.from('data'), Buffer.from([0, 0, 0, 0])]);

(async () => {
  const app = express();
  app.get('/prueba-intro.html', (q, r) => r.type('html').send('<!doctype html><html lang="es"><body><div id="appContent">app</div><button id="umTutorialBtn" type="button">Ver el tutorial otra vez</button><script src="/eco-intro.js"></script></body></html>'));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

  async function abrir({ intro, transcripciones = ['Fernando', 'hola eco'], transcribeFalla = false }) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, permissions: ['microphone'] });
    const page = await ctx.newPage();
    const estado = { visto: 0, transcribe: 0, repetir: 0 };
    const errores = [];
    page.on('pageerror', (e) => errores.push(e.message));
    await page.route('**/api/intro/visto', (r) => { estado.visto++; r.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); });
    await page.route('**/api/intro**', (r) => {
      if (r.request().url().includes('/visto')) return r.fallback();
      if (r.request().url().includes('repetir=1')) estado.repetir++;
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(intro) });
    });
    await page.route('**/api/transcribe', (r) => {
      estado.transcribe++;
      if (transcribeFalla) return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'No se pudo transcribir el audio.' }) });
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ text: transcripciones[estado.transcribe - 1] || '' }) });
    });
    await page.route('**/api/media-file**', (r) => r.fulfill({ contentType: 'audio/wav', body: WAV }));
    await page.goto(base + '/prueba-intro.html');
    return { page, ctx, estado, errores };
  }
  const titulo = (page) => page.textContent('#ecoIntro .ei-titulo');
  const hablar = async (page) => {
    await page.click('#ecoIntro button.ei-orbe');
    await page.waitForSelector('#ecoIntro .ei-orbe-grabando');
    await page.waitForTimeout(900);
    await page.click('#ecoIntro button.ei-orbe', { force: true }); // el botón late mientras graba: no está "quieto"
  };

  // 1) Con mensaje de regalo: recorrido completo.
  let t = await abrir({ intro: { aplica: true, pendiente: true, mensaje: { url: '/api/media-file?u=x', de: 'Felipe' } } });
  await t.page.waitForSelector('#ecoIntro', { timeout: 8000 });
  ok((await titulo(t.page)) === 'Un regalo para ti' && (await t.page.textContent('#ecoIntro .ei-texto')).includes('Felipe te dejó un mensaje con su voz'), 'con mensaje: empieza con "Un regalo para ti" y el nombre de quien lo dejó');
  ok(await t.page.evaluate(() => document.documentElement.dataset.ecoIntro) === 'abierto', 'avisa al recorrido de botones que la intro está abierta (para que espere)');
  ok((await t.page.textContent('#ecoIntro .ei-progreso')) === 'Paso 1 de 5', 'son 5 pasos con mensaje');
  await t.page.click('text=▶ Escuchar el mensaje');
  await t.page.waitForTimeout(400);
  await t.page.click('#ecoIntro .ei-boton:has-text("Continuar")');
  ok((await titulo(t.page)) === 'Esto es Eco' && (await t.page.textContent('#ecoIntro .ei-cuerpo')).includes('chat de voz'), 'paso 2: explica en una frase que es un chat de voz');
  ok((await t.page.textContent('#ecoIntro .ei-cuerpo')).includes('Tu turno') && (await t.page.textContent('#ecoIntro .ei-cuerpo')).includes('Turno de Eco'), 'y muestra los dos botones: tu turno y turno de Eco');
  await t.page.click('#ecoIntro .ei-boton:has-text("Continuar")');
  ok((await titulo(t.page)) === 'Probemos tu micrófono', 'paso 3: prueba del micrófono (di tu nombre)');
  ok(await t.page.isDisabled('#ecoIntro .ei-boton:has-text("Continuar")'), 'no deja continuar hasta probar (o elegir seguir sin probar)');
  await hablar(t.page);
  await t.page.waitForFunction(() => /Escuché/.test(document.querySelector('#ecoIntro .ei-resultado').textContent));
  ok((await t.page.textContent('#ecoIntro .ei-resultado')).includes('«Fernando»'), 'muestra lo que escuchó: «Fernando»');
  await t.page.click('#ecoIntro .ei-boton:has-text("Continuar")');
  ok((await titulo(t.page)) === 'Una más', 'paso 4: di «Hola Eco»');
  await hablar(t.page);
  await t.page.waitForFunction(() => /Escuché/.test(document.querySelector('#ecoIntro .ei-resultado').textContent));
  ok((await t.page.textContent('#ecoIntro .ei-resultado')).includes('¡Muy bien!'), 'entendió «hola eco»');
  await t.page.click('#ecoIntro .ei-boton:has-text("Continuar")');
  ok((await titulo(t.page)) === 'Todo listo' && (await t.page.textContent('#ecoIntro')).includes('Opciones avanzadas'), 'paso 5: todo listo, y dice dónde repetirlo');
  await t.page.click('text=Empezar a charlar');
  await t.page.waitForTimeout(300);
  ok(t.estado.visto === 1 && (await t.page.$('#ecoIntro')) === null, 'al empezar se marca como vista y desaparece');
  ok(await t.page.evaluate(() => document.documentElement.dataset.ecoIntro) === 'nada', 'y libera al recorrido de botones');
  ok(t.errores.length === 0, 'sin errores de JavaScript' + (t.errores.length ? ': ' + t.errores.join(' | ') : ''));
  await t.ctx.close();

  // 2) Sin mensaje, y la transcripción falla: se puede seguir sin probar.
  t = await abrir({ intro: { aplica: true, pendiente: true, mensaje: null }, transcribeFalla: true });
  await t.page.waitForSelector('#ecoIntro', { timeout: 8000 });
  ok((await titulo(t.page)) === 'Esto es Eco' && (await t.page.textContent('#ecoIntro .ei-progreso')) === 'Paso 1 de 4', 'sin mensaje: empieza en "Esto es Eco" y son 4 pasos');
  await t.page.click('#ecoIntro .ei-boton:has-text("Continuar")');
  await hablar(t.page);
  await t.page.waitForSelector('#ecoIntro .ei-resultado.ei-error');
  ok((await t.page.textContent('#ecoIntro .ei-resultado')).length > 10, 'si falla la transcripción, explica qué pasó');
  await t.page.click('text=Seguir sin probar');
  ok((await titulo(t.page)) === 'Una más', 'se puede seguir sin probar');
  await t.ctx.close();

  // 3) Saltar el tutorial.
  t = await abrir({ intro: { aplica: true, pendiente: true, mensaje: null } });
  await t.page.waitForSelector('#ecoIntro', { timeout: 8000 });
  await t.page.click('text=Saltar el tutorial');
  await t.page.waitForTimeout(300);
  ok(t.estado.visto === 1 && (await t.page.$('#ecoIntro')) === null, 'saltar el tutorial lo marca como visto');
  await t.ctx.close();

  // 4) Micrófono bloqueado: mensaje claro y se puede seguir.
  const ctxSin = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const pSin = await ctxSin.newPage();
  await pSin.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })); });
  await pSin.route('**/api/intro**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ aplica: true, pendiente: true, mensaje: null }) }));
  await pSin.goto(base + '/prueba-intro.html');
  await pSin.waitForSelector('#ecoIntro', { timeout: 8000 });
  await pSin.click('#ecoIntro .ei-boton:has-text("Continuar")');
  await pSin.click('#ecoIntro button.ei-orbe');
  await pSin.waitForSelector('#ecoIntro .ei-resultado.ei-error');
  ok((await pSin.textContent('#ecoIntro .ei-resultado')).includes('bloqueado') && !(await pSin.isDisabled('#ecoIntro .ei-boton:has-text("Continuar")')), 'micrófono bloqueado: explica cómo permitirlo y deja continuar');
  await ctxSin.close();

  // 5) No aplica o no está pendiente: no aparece nada; y se puede repetir desde el botón.
  t = await abrir({ intro: { aplica: true, pendiente: false, mensaje: null } });
  await t.page.waitForTimeout(1500);
  ok((await t.page.$('#ecoIntro')) === null && await t.page.evaluate(() => document.documentElement.dataset.ecoIntro) === 'nada', 'si no está pendiente, no aparece');
  await t.page.click('#umTutorialBtn');
  await t.page.waitForSelector('#ecoIntro', { timeout: 5000 });
  ok(t.estado.repetir === 1, 'el botón "Ver el tutorial otra vez" la abre a pedido');
  await t.ctx.close();

  await browser.close();
  server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
