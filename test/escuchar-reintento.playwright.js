// La página que abre quien escanea el QR del libro: si una grabación no carga a la primera, vuelve a intentarlo sola, y si no
// logra cargarla avisa y deja volver a intentar.
//
//   node test/escuchar-reintento.playwright.js   (o: npm run test:escuchar)
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright: corre "npm install".'); process.exit(1); }
let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };
const TOKEN = 'c'.repeat(48);
const wav = (() => { const n = 4000, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); return b; })();

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());

  async function abrir(fallasDelPrimero) {
    const page = await (await browser.newContext()).newPage();
    const pedidos = { 0: 0, 1: 0 };
    await page.route('**/api/book-qr/**', (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/api/book-qr/listen/' + TOKEN) return r.fulfill({ json: { title: 'Verde de infancia', audios: ['/api/book-qr/audio/' + TOKEN + '/0', '/api/book-qr/audio/' + TOKEN + '/1'], preguntas: ['¿Cómo era la finca?', null] } });
      const n = Number(u.pathname.split('/').pop());
      pedidos[n]++;
      if (n === 0 && pedidos[0] <= fallasDelPrimero) return r.fulfill({ status: 500, json: { error: 'falló' } });
      return r.fulfill({ status: 200, contentType: 'audio/wav', body: wav });
    });
    await page.goto(base + '/escuchar.html?t=' + TOKEN);
    await page.waitForSelector('audio');
    return { page, pedidos };
  }

  let t = await abrir(1);
  await t.page.waitForFunction(() => document.querySelector('audio').readyState >= 1, null, { timeout: 15000 });
  ok(t.pedidos[0] === 2 && await t.page.locator('.eco-escuchar-error').first().isHidden(), 'si la primera grabación falla una vez, se vuelve a pedir sola y carga sin molestar a quien escucha');
  ok(t.pedidos[1] === 1, 'la segunda grabación se pide una sola vez');
  // Una a la vez: al darle play a la segunda, la primera se pausa
  await t.page.waitForFunction(() => [...document.querySelectorAll('audio')].every((a) => a.readyState >= 1), null, { timeout: 15000 });
  const sonando = await t.page.evaluate(async () => {
    const [a, b] = document.querySelectorAll('audio');
    a.muted = b.muted = true;
    await a.play(); await b.play();
    await new Promise((r) => setTimeout(r, 150));
    return { primera: !a.paused, segunda: !b.paused };
  });
  ok(sonando.segunda && !sonando.primera, 'al darle play a una grabación, la que sonaba se pausa: nunca suenan todas al tiempo');
  await t.page.context().close();

  t = await abrir(99);
  await t.page.waitForSelector('.eco-escuchar-error:not([hidden])', { timeout: 15000 });
  ok(t.pedidos[0] === 3, 'si sigue fallando, se intenta tres veces en total (' + t.pedidos[0] + ')');
  ok(/no cargó/.test(await t.page.locator('.eco-escuchar-error').first().innerText()) && await t.page.locator('.eco-escuchar-error').nth(1).isHidden(), 'y avisa solo en la grabación que falló');
  await t.page.context().close();

  await browser.close(); server.close();
  console.log(fallos ? '\nHubo fallos.' : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
