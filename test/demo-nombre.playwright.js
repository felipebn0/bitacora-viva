// Demo de "Cómo funciona": Eco saluda con el nombre que se le dice, y si el servidor no lo entiende sigue con el saludo de siempre.
// Usa un micrófono falso del navegador y responde a /api/demo-nombre sin llamar a ningún servicio de voz.
//
//   node test/demo-nombre.playwright.js
const path = require('path');
const fs = require('fs');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright: corre "npm install".'); process.exit(1); }
let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };
const PUBLICO = path.join(__dirname, '..', 'public');
const MP3 = fs.readFileSync(path.join(PUBLICO, 'audio-demo', 'gusto.mp3'));
const ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'];

(async () => {
  const app = express();
  app.use(express.static(PUBLICO));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ARGS }).catch(() => chromium.launch({ args: ARGS }));

  async function correr(respuesta) {
    const context = await browser.newContext({ permissions: ['microphone'] });
    const page = await context.newPage();
    const errores = [];
    page.on('pageerror', (e) => errores.push(e.message));
    await page.addInitScript(() => {
      window.__oidos = [];
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () { if (this.src) window.__oidos.push(this.src); return play.apply(this, arguments); };
    });
    const pedidos = [];
    await page.route('**/api/demo-nombre', (r) => {
      pedidos.push({ tipo: r.request().headers()['content-type'], bytes: (r.request().postDataBuffer() || Buffer.alloc(0)).length });
      return respuesta(r);
    });
    await page.goto(base + '/como-funciona.html');
    await page.locator('#demoOrbe').click();
    await page.waitForFunction(() => window.__oidos.some((s) => /gusto\.mp3|^blob:/.test(s)), null, { timeout: 60000 });
    const oidos = await page.evaluate(() => window.__oidos.slice());
    await context.close();
    return { pedidos, oidos, errores };
  }

  let t = await correr((r) => r.fulfill({ status: 200, contentType: 'audio/mpeg', headers: { 'X-Nombre': encodeURIComponent('María José') }, body: MP3 }));
  ok(t.pedidos.length === 1 && t.pedidos[0].bytes > 1500, 'el audio del nombre se manda una sola vez al servidor');
  ok(t.oidos.some((s) => s.startsWith('blob:')) && !t.oidos.some((s) => /gusto\.mp3/.test(s)), 'Eco usa el saludo con el nombre en vez del grabado');
  ok(!t.errores.length, 'sin errores en la página (' + t.errores.join(' | ') + ')');

  t = await correr((r) => r.fulfill({ status: 204 }));
  ok(t.pedidos.length === 1 && t.oidos.some((s) => /gusto\.mp3/.test(s)), 'si no se entiende el nombre, sigue el saludo de siempre');

  t = await correr((r) => r.abort());
  ok(t.oidos.some((s) => /gusto\.mp3/.test(s)), 'si el servidor falla, sigue el saludo de siempre');

  await browser.close(); server.close();
  console.log(fallos ? '\nHubo fallos.' : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
