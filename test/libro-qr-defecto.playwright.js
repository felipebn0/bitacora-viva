// Mi libro: todos los capítulos con grabaciones llevan su QR de voz por defecto; quien retira uno a propósito
// no lo vuelve a recibir solo.
//   node test/libro-qr-defecto.playwright.js
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright: corre "npm install".'); process.exit(1); }
let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };
const TOKEN = (n) => String(n).repeat(48).slice(0, 48);
const capitulos = [
  { id: 1, title: 'Infancia', theme: 'infancia', generated_text: 'Había una casa grande.', story_ids: [1], audios: ['https://x.test/a1.webm'], created_at: new Date().toISOString() },
  { id: 2, title: 'Sin voz', theme: 'otro', generated_text: 'Este no tiene grabaciones.', story_ids: [2], audios: [], created_at: new Date().toISOString() },
  { id: 3, title: 'El trabajo', theme: 'trabajo', generated_text: 'Segundo capítulo.', story_ids: [3], audios: ['https://x.test/a3.webm'], created_at: new Date().toISOString() },
];

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('eco_tour_done__capitulos_html', '1'); } catch (e) { /* nada */ } });
  let borrador = {};
  let version = 1;
  const creados = [];
  const retirados = [];
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url()), m = r.request().method();
    const json = (o) => r.fulfill({ json: o });
    const qr = /\/api\/book-qr\/chapters\/(\d+)$/.exec(u.pathname);
    if (qr && m === 'POST') { creados.push(Number(qr[1])); return json({ ok: true, token: TOKEN(qr[1]), url: 'https://bitacora-viva.vercel.app/escuchar.html?t=' + TOKEN(qr[1]) }); }
    if (qr && m === 'DELETE') { retirados.push(Number(qr[1])); return json({ ok: true }); }
    if (u.pathname === '/api/chapters') return json({ chapters: capitulos });
    if (u.pathname === '/api/story-log') return json({ stories: [] });
    if (u.pathname === '/api/book-editor/draft' && m === 'PUT') { const b = JSON.parse(r.request().postData()); borrador = b.book; version++; return json({ ok: true, version }); }
    if (u.pathname === '/api/book-editor/draft') return json({ book: borrador, version });
    return json({});
  });
  await page.goto(base + '/capitulos.html');
  await page.waitForSelector('#ecoEditorialOpen');

  await page.click('#ecoEditorialOpen');
  await page.waitForFunction(() => /sincronizado|Guardado en tu cuenta/.test(document.getElementById('ecoEditorialStatus').textContent));
  const t0 = Date.now(); while (creados.length < 2 && Date.now() - t0 < 6000) await page.waitForTimeout(50);
  ok(creados.sort().join(',') === '1,3', 'al abrir el estudio se crean solos los QR de los capítulos con grabaciones (1 y 3)');
  ok(!creados.includes(2), 'y no se pide uno para el capítulo sin grabaciones');

  await page.click('[data-view="preview"]');
  await page.waitForSelector('#ecoEditorialBook .eco-editorial-qr');
  ok(await page.locator('#ecoEditorialBook .eco-editorial-qr img').count() === 2, 'la vista del libro lleva el QR en esos dos capítulos');
  ok(await page.locator('#ecoEditorialBook .eco-editorial-qr img').first().getAttribute('src') === '/api/book-qr/image/' + TOKEN(1) + '.svg', 'el QR apunta al código de su capítulo');

  await page.click('[data-view="media"]');
  await page.waitForSelector('.eco-editorial-revokeqr');
  page.once('dialog', (d) => d.accept());
  await page.click('.eco-editorial-revokeqr');
  await page.waitForFunction(() => !document.querySelector('.eco-editorial-revokeqr'));
  ok(retirados.join(',') === '1', 'retirar el QR del capítulo 1 lo revoca en el servidor');
  const t1 = Date.now(); while (!(borrador.qrOff && borrador.qrOff['1']) && Date.now() - t1 < 5000) await page.waitForTimeout(100);
  ok(borrador.qrOff && borrador.qrOff['1'] === true, 'y queda anotado en el borrador que se retiró a propósito');

  await page.click('#ecoEditorialClose');
  creados.length = 0;
  await page.click('#ecoEditorialOpen');
  await page.waitForFunction(() => /sincronizado|Guardado en tu cuenta/.test(document.getElementById('ecoEditorialStatus').textContent));
  await page.waitForTimeout(800);
  ok(!creados.includes(1), 'al volver a abrir, el QR retirado no se vuelve a crear solo');
  ok(errores.length === 0, 'sin errores de JavaScript' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close();
  server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
