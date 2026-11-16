// Demo pública (/demo): nombre → Eco saluda → la persona habla (micrófono simulado con un archivo) → Eco responde → al
// acabarse el tiempo Eco hace el cierre y aparece el popup de registro. Las rutas del servidor van simuladas.
//   node test/demo.playwright.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { chromium } = require('playwright');
let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };

function wav(segundosTono, segundosSilencio) {
  const tasa = 16000;
  const n = Math.round(tasa * (segundosTono + segundosSilencio));
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(tasa, 24);
  b.writeUInt32LE(tasa * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < tasa * segundosTono; i++) b.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 220 / tasa) * 12000), 44 + i * 2);
  return b;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-demo-'));
  const microfono = path.join(dir, 'voz.wav');
  fs.writeFileSync(microfono, wav(1.5, 6));
  const audioEco = wav(0, 0.4).toString('base64');

  const app = express();
  app.get('/demo', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'demo.html')));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${microfono}%noloop`, '--autoplay-policy=no-user-gesture-required'],
  });

  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
    await ctx.addInitScript(() => { window.ECO_DEMO_MS = 4000; });
    const page = await ctx.newPage();
    const errores = [];
    page.on('pageerror', (e) => errores.push(e.message));
    const turnos = [];
    await page.route('**/api/demo/empezar', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ token: 'tok', segundos: 60 }) }));
    await page.route('**/api/demo/transcribir', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ text: 'Mi abuela hacía arepas los domingos' }) }));
    await page.route('**/api/demo/pitch', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ texto: 'Con tu cuenta gratis, Eco sigue charlando contigo. Crea tu cuenta con el botón.', audio: audioEco }) }));
    await page.route('**/api/demo/turno', async (r) => {
      await new Promise((ok2) => setTimeout(ok2, 600));
      const cuerpo = JSON.parse(r.request().postData());
      turnos.push(cuerpo);
      const texto = cuerpo.fin ? 'Gracias, Ana, qué bonito lo de las arepas.' : (cuerpo.history.length ? '¡Qué rico! ¿Quién más estaba ahí?' : 'Hola, Ana. ¿Qué olor te recuerda la casa de tu abuela?');
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ texto, audio: audioEco, fin: !!cuerpo.fin }) });
    });
    await page.goto(base + '/demo');
    ok(await page.locator('h1').innerText() === 'Charla un minuto con Eco', 'la página abre con el título');
    await page.click('#botonEmpezar');
    ok(/Escribe tu nombre/.test(await page.locator('#errorNombre').innerText()), 'sin nombre pide escribirlo');
    await page.fill('#nombre', 'Ana');
    await page.click('#botonEmpezar');
    await page.waitForSelector('#pasoCharla:not([hidden])', { timeout: 5000 });
    ok(true, 'con nombre pasa a la charla');
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.getElementById('barraTiempo').style.transform === ''), 'el minuto no corre mientras Eco prepara su saludo');
    await page.waitForFunction(() => document.getElementById('orbe').dataset.state === 'listening', null, { timeout: 15000 });
    await page.waitForTimeout(1600);
    await page.screenshot({ path: path.join(__dirname, '..', 'test-artifacts', 'demo-escuchando.png') }).catch(() => {});
    ok(/abuela/.test(await page.locator('#saludo').innerText()), 'Eco saluda y después escucha');
    await page.waitForFunction(() => /Con tu cuenta gratis/.test(document.getElementById('saludo').textContent), null, { timeout: 45000 }).catch(() => {});
    ok(/Con tu cuenta gratis/.test(await page.locator('#saludo').innerText()), 'después de la despedida Eco dice el pitch');
    await page.waitForSelector('#popup:not([hidden])', { timeout: 45000 });
    await page.screenshot({ path: path.join(__dirname, '..', 'test-artifacts', 'demo-popup.png') }).catch(() => {});
    ok(turnos.length >= 2 && turnos[turnos.length - 1].fin === true, 'al acabarse el tiempo Eco hace el cierre');
    ok(turnos.some((t) => t.history.some((m) => m.role === 'user' && /arepas/.test(m.content))), 'lo que dijo la persona llega a Eco');
    ok(await page.getAttribute('#popupRegistro', 'href') === '/#registro-form', 'el popup lleva al registro');
    await page.click('#popupCerrar');
    ok(await page.isVisible('#barraFinal') && !(await page.isVisible('#popup')), '«Ahora no» deja un botón fijo de registro');
    ok(!errores.length, 'sin errores de JavaScript' + (errores.length ? ': ' + errores.join(' | ') : ''));
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ permissions: ['microphone'] });
    const page = await ctx.newPage();
    await page.route('**/api/demo/empezar', (r) => r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ motivo: 'limite' }) }));
    await page.goto(base + '/demo');
    await page.fill('#nombre', 'Ana');
    await page.click('#botonEmpezar');
    await page.waitForSelector('#popup:not([hidden])', { timeout: 5000 });
    ok(/Ya hiciste tus pruebas de hoy/.test(await page.locator('#popupTitulo').innerText()), 'pasado el límite del día sale directo el registro');
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ permissions: ['microphone'] });
    const page = await ctx.newPage();
    await page.route('**/api/demo/empezar', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ token: 'tok' }) }));
    await page.route('**/api/demo/turno', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"motivo":"error"}' }));
    await page.goto(base + '/demo');
    await page.fill('#nombre', 'Ana');
    await page.click('#botonEmpezar');
    await page.waitForFunction(() => /no pudo responder/.test(document.getElementById('estado').textContent), null, { timeout: 5000 }).catch(() => {});
    ok(/no pudo responder/.test(await page.locator('#estado').innerText()), 'si la IA falla, lo dice claro (no «error 500») y deja reintentar');
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
