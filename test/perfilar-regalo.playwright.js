// Grabar, oír, guardar y quitar el mensaje de regalo desde public/perfilar.html (micrófono falso).
//   node test/perfilar-regalo.playwright.js
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
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  let mensaje = null, subido = null, borrado = false;
  await page.route('**/api/subprofiles/7/onboarding', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ nombre: 'Mamá', contextoOnboarding: null }) }));
  await page.route('**/api/subprofiles/7/mensaje-regalo', (r) => {
    const m = r.request().method();
    if (m === 'POST') { subido = { tipo: r.request().headers()['content-type'], bytes: r.request().postDataBuffer().length }; mensaje = { existe: true, url: '/api/media-file?u=x', de: 'Felipe', grabadoEn: new Date().toISOString() }; return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, url: '/api/media-file?u=x', de: 'Felipe' }) }); }
    if (m === 'DELETE') { borrado = true; mensaje = null; return r.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); }
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify(mensaje || { existe: false, url: null }) });
  });
  await page.route('**/api/media-file**', (r) => r.fulfill({ contentType: 'audio/wav', body: Buffer.alloc(100) }));
  page.on('dialog', (d) => d.accept());
  await page.goto(base + '/perfilar.html?id=7');
  await page.waitForSelector('#regaloBox:not([hidden])', { timeout: 8000 });
  ok((await page.textContent('#regaloNombre')) === 'Mamá', 'la tarjeta nombra a la persona que recibirá el mensaje');
  ok((await page.textContent('#regaloEstado')).includes('Todavía no hay un mensaje') && await page.isHidden('#regaloGuardar') && await page.isHidden('#regaloQuitar'), 'sin mensaje: solo se puede grabar');
  await page.click('#regaloGrabar');
  await page.waitForFunction(() => /Terminar/.test(document.getElementById('regaloGrabar').textContent));
  await page.waitForTimeout(1300);
  await page.click('#regaloGrabar');
  await page.waitForSelector('#regaloGuardar:not([hidden])');
  ok(await page.isVisible('#regaloAudio'), 'al terminar de grabar aparece el reproductor para escucharlo antes de guardar');
  ok(!subido, 'todavía no se sube nada hasta que se guarda');
  await page.click('#regaloGuardar');
  await page.waitForFunction(() => /Mensaje guardado/.test(document.getElementById('regaloEstado').textContent));
  ok(subido && subido.bytes > 0 && /audio/.test(subido.tipo), 'al guardar se sube la grabación como audio (' + (subido && subido.bytes) + ' bytes)');
  ok(await page.isHidden('#regaloGuardar') && await page.isVisible('#regaloQuitar') && (await page.textContent('#regaloGrabar')) === 'Grabar de nuevo', 'queda guardado: se puede quitar o grabar de nuevo');
  await page.click('#regaloQuitar');
  await page.waitForFunction(() => /Todavía no hay/.test(document.getElementById('regaloEstado').textContent));
  ok(borrado && await page.isHidden('#regaloQuitar'), 'quitarlo lo borra');
  ok(errores.length === 0, 'sin errores de JavaScript' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close();
  server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
