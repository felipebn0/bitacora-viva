// Mi libro: las fotos van arriba a la derecha dentro del texto (una sola manera, sin tamaños ni posiciones), el pie de foto
// se puede editar, y lo diseñado en "Diseñar mi libro" (orden, títulos, textos y fotos) se ve también en la lista y en "Leer capítulo".
//   node test/libro-fotos.playwright.js
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright: corre "npm install".'); process.exit(1); }
let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };
const CAPTURAS = process.env.CAPTURAS_LIBRO;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const FOTO = 'https://x.test/foto1.jpg';
const TOKEN = 'a'.repeat(48);
const parrafos = Array.from({ length: 6 }, (_, i) => `Párrafo ${i + 1}. Era una tarde de lluvia en la casa de mis abuelos y todos nos reunimos alrededor de la mesa a contar historias de cuando éramos pequeños.`).join('\n\n');
const capitulos = [
  { id: 1, title: 'Infancia', theme: 'infancia', generated_text: 'Texto original.', story_ids: [1], audios: [], created_at: new Date().toISOString() },
  { id: 2, title: 'El trabajo', theme: 'trabajo', generated_text: 'Segundo capítulo.', story_ids: [2], audios: [], created_at: new Date().toISOString() },
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
  let borrador = { title: 'Mi libro', order: ['2', '1'], edits: { 1: { title: 'La casa de siempre', text: parrafos } }, media: { 1: { [FOTO]: { pos: '0', caption: 'Con el abuelo', size: 'medium' } } }, qr: { 1: { token: TOKEN, url: 'https://x.test/escuchar.html?t=' + TOKEN } } };
  let version = 1;
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url()), m = r.request().method();
    const json = (o) => r.fulfill({ json: o });
    if (u.pathname === '/api/media-file') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (u.pathname.startsWith('/api/book-qr/image/')) return r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' });
    if (u.pathname === '/api/chapters') return json({ chapters: capitulos });
    if (u.pathname === '/api/story-log') return json({ stories: [{ id: 1, texto: 'x', media_urls: [{ url: FOTO, type: 'foto', caption: 'En el río' }], created_at: new Date().toISOString() }, { id: 2, texto: 'y', created_at: new Date().toISOString() }] });
    if (u.pathname === '/api/book-editor/draft' && m === 'PUT') { borrador = JSON.parse(r.request().postData()).book; version++; return json({ ok: true, version }); }
    if (u.pathname === '/api/book-editor/draft') return json({ book: borrador, version });
    return json({});
  });
  await page.goto(base + '/capitulos.html');
  await page.waitForSelector('#lista .chapter');

  // 1) La lista sigue lo diseñado: orden y títulos
  await page.waitForFunction(() => document.querySelector('#lista .chapter h2')?.textContent === 'El trabajo' && /La casa de siempre/.test(document.querySelectorAll('#lista .chapter h2')[1]?.textContent || ''));
  const titulos = await page.locator('#lista .chapter h2').allTextContents();
  ok(titulos.join('|') === 'El trabajo|La casa de siempre', 'la lista de Mi libro sigue el orden y los títulos del libro diseñado (' + titulos.join(' | ') + ')');

  // 2) "Leer capítulo": texto editado y la foto dentro del texto, arriba a la derecha
  await page.locator('#lista .chapter', { hasText: 'La casa de siempre' }).locator('.eco-read-btn').click();
  await page.waitForSelector('#ecoReader:not([hidden]) .eco-foto-flota');
  ok((await page.textContent('#ecoReaderTitle')) === 'La casa de siempre', 'Leer capítulo: muestra el título que se diseñó');
  ok(await page.locator('#ecoReaderText .eco-reader-par').count() === 6 && /Párrafo 1/.test(await page.locator('#ecoReaderText .eco-reader-par').first().textContent()), 'y el texto que se editó, en sus párrafos');
  const lectura = await page.evaluate(() => {
    const t = document.getElementById('ecoReaderText'); const f = t.querySelector('figure');
    const rf = f.getBoundingClientRect(), rt = t.getBoundingClientRect(); const rango = document.createRange(); rango.selectNodeContents(t.querySelector('.eco-reader-par')); const linea = rango.getClientRects()[0];
    return { primero: t.firstElementChild === f, flota: getComputedStyle(f).float, ancho: Math.round(rf.width / rt.width * 100), derecha: Math.abs(rt.right - rf.right) < 2, arriba: Math.abs(rf.top - rt.top) < 12, textoIzq: linea.right <= rf.left + 2 && linea.top < rf.bottom, pie: f.querySelector('figcaption')?.textContent };
  });
  ok(lectura.primero && lectura.flota === 'right' && lectura.derecha && lectura.arriba, 'la foto está al principio del texto, arriba a la derecha');
  ok(lectura.textoIzq, 'el texto empieza a la izquierda de la foto (la rodea)');
  ok(lectura.ancho >= 38 && lectura.ancho <= 46, 'y mide un solo tamaño estándar (' + lectura.ancho + '% del ancho del texto)');
  ok(lectura.pie === 'Con el abuelo', 'con su pie de foto editado');
  if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, 'libro-lectura.png') });
  await page.click('#ecoReaderClose');

  // 3) El estudio: sin tamaño ni posición, pie editable, sin "Volver a comprobar"
  await page.click('#ecoEditorialOpen');
  await page.waitForFunction(() => /sincronizado|Guardado en tu cuenta/.test(document.getElementById('ecoEditorialStatus').textContent));
  await page.click('[data-view="media"]');
  await page.selectOption('#ecoEditorialForm select', '1');
  await page.waitForSelector('.eco-editorial-photo-config');
  ok(await page.locator('.eco-editorial-photo-fields select').count() === 0, 'por cada foto ya no hay opciones de tamaño ni de posición');
  ok(await page.locator('.eco-editorial-photo-fields input[type=checkbox]').count() === 1 && await page.locator('.eco-editorial-photo-fields input:not([type=checkbox])').count() === 1, 'solo queda "Incluir" y el pie de foto');
  ok(!/Volver a comprobar/.test(await page.textContent('#ecoEditorialForm')) && await page.locator('.eco-editorial-makeqr').count() === 0, 'ya no existe "Volver a comprobar el QR" (con QR no hay botón de crear)');
  ok(await page.locator('.eco-editorial-revokeqr').count() === 1 && await page.locator('.eco-editorial-qr-link').count() === 1, 'quedan "Probar enlace" y "Retirar el enlace"');
  await page.fill('.eco-editorial-photo-fields input:not([type=checkbox])', 'En la finca, 1985');
  await page.click('[data-view="preview"]');
  await page.waitForSelector('#ecoEditorialBook .eco-foto-flota');
  const libro = await page.evaluate(() => { const pag = [...document.querySelectorAll('#ecoEditorialBook .eco-editorial-page')].find((p) => p.querySelector('figure')); const f = pag.querySelector('figure'); return { pie: f.querySelector('figcaption')?.textContent, antesDelPrimerParrafo: f.nextElementSibling?.classList.contains('eco-editorial-paragraph') && !f.previousElementSibling?.classList.contains('eco-editorial-paragraph'), flota: getComputedStyle(f).float }; });
  ok(libro.pie === 'En la finca, 1985' && libro.antesDelPrimerParrafo && libro.flota === 'right', 'en la vista del libro la foto va arriba a la derecha con el pie que se editó');
  if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, 'libro-vista.png') });
  await page.click('[data-view="media"]');
  await page.uncheck('.eco-editorial-photo-fields input[type=checkbox]');
  await page.click('[data-view="preview"]');
  ok(await page.locator('#ecoEditorialBook .eco-foto-flota').count() === 0, 'si se quita la foto con "Incluir", desaparece del libro');
  await page.click('[data-view="media"]');
  await page.check('.eco-editorial-photo-fields input[type=checkbox]');

  // 4) Lo diseñado vuelve a verse al salir del estudio y entrar al capítulo
  await page.waitForFunction(() => borradorListo = true).catch(() => {});
  const t0 = Date.now(); while (!(borrador.media && borrador.media['1'] && borrador.media['1'][FOTO] && borrador.media['1'][FOTO].caption === 'En la finca, 1985' && borrador.media['1'][FOTO].pos === '0') && Date.now() - t0 < 6000) await page.waitForTimeout(100);
  await page.click('#ecoEditorialClose');
  await page.reload();
  await page.waitForSelector('#lista .chapter');
  await page.locator('#lista .chapter', { hasText: 'La casa de siempre' }).locator('.eco-read-btn').click();
  await page.waitForSelector('#ecoReader:not([hidden]) .eco-foto-flota');
  ok((await page.textContent('#ecoReader figcaption')) === 'En la finca, 1985', 'al volver al libro y entrar al capítulo se ve la foto con lo que se diseñó');
  ok(errores.length === 0, 'sin errores de JavaScript' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close();
  server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
