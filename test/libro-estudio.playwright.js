// Mi libro: al entrar se abre el estudio, que funciona como un documento de Word: índice del libro a la izquierda, el libro
// editable a la derecha, y arriba "Descargar PDF" (hoja A4) y "Descargar libro digital".
//
//   node test/libro-estudio.playwright.js   (o: npm run test:libro-estudio)
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright: corre "npm install".'); process.exit(1); }
let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };
const CAPTURAS = process.env.CAPTURAS_LIBRO;
const foto = fs.readFileSync(path.join(__dirname, '..', 'public', 'images', 'voces', 'voz-1.jpg'));
const parrafos = (n) => Array.from({ length: n }, (_, i) => `Párrafo ${i + 1}. Era una tarde de lluvia en la casa de mis abuelos y todos nos reunimos alrededor de la mesa a contar historias de cuando éramos pequeños.`).join('\n\n');
const capitulos = [
  { id: 1, title: 'Infancia', theme: 'infancia', generated_text: parrafos(4), story_ids: [1], audios: [], created_at: new Date().toISOString() },
  { id: 2, title: 'El trabajo', theme: 'trabajo', generated_text: parrafos(3), story_ids: [2], audios: [], created_at: new Date().toISOString() },
  { id: 3, title: 'Mi familia', theme: 'familia', generated_text: parrafos(3), story_ids: [3], audios: [], created_at: new Date().toISOString() },
];

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());

  async function abrir({ ancho = 1300, alto = 900, sinCapitulos = false, aprobada = true, ruta = '/capitulos.html', movil = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, acceptDownloads: true, isMobile: movil, hasTouch: movil });
    const page = await ctx.newPage();
    const t = { ctx, page, errores: [], guardados: [], borrados: [], generados: [], fotosSubidas: [], capitulos: sinCapitulos ? [] : capitulos.map((c) => ({ ...c })), borrador: { title: 'Mi libro de prueba', subtitle: 'Para mis nietos', order: ['2', '1', '3'], edits: {}, qr: {}, qrOff: {} }, version: 1, imprimio: 0, compras: 0, aprobada };
    page.on('pageerror', (e) => t.errores.push(e.message));
    await page.addInitScript(() => { try { localStorage.setItem('eco_tour_done__capitulos_html', '1'); } catch (e) { /* nada */ } window.__imprimio = 0; window.print = () => { window.__imprimio++; }; });
    await page.route('**/api/**', (r) => {
      const u = new URL(r.request().url()), m = r.request().method();
      const json = (o) => r.fulfill({ json: o });
      if (u.pathname === '/api/book-demo/status') return json({ approved: t.aprobada });
      if (u.pathname === '/api/book-demo/purchase') { t.compras++; t.aprobada = true; return json({ approved: true }); }
      if (u.pathname === '/api/media-file') return r.fulfill({ status: 200, contentType: 'image/jpeg', body: foto });
      if (u.pathname === '/api/chapters/generate' && m === 'POST') { t.generados.push(JSON.parse(r.request().postData())); t.capitulos = [{ id: 11, title: 'Capítulo nuevo uno', theme: 'infancia', generated_text: 'Texto nuevo uno.', story_ids: [1], audios: [], persona: 'primera' }, { id: 12, title: 'Capítulo nuevo dos', theme: 'trabajo', generated_text: 'Texto nuevo dos.', story_ids: [2], audios: [] }]; return json({ ok: true, chapters: t.capitulos }); }
      if (/^\/api\/chapters\/\d+$/.test(u.pathname) && m === 'DELETE') { const id = Number(u.pathname.split('/').pop()); t.borrados.push(id); t.capitulos = t.capitulos.filter((c) => c.id !== id); return json({ ok: true }); }
      if (u.pathname === '/api/book-editor/photo' && m === 'POST') { t.fotosSubidas.push({ tipo: r.request().headers()['content-type'], bytes: r.request().postDataBuffer().length }); return json({ ok: true, url: 'https://x.test/subida' + t.fotosSubidas.length + '.jpg' }); }
      if (u.pathname === '/api/chapters') return json({ chapters: t.capitulos });
      if (u.pathname === '/api/story-log') return json({ stories: [] });
      if (u.pathname === '/api/book-editor/draft' && m === 'PUT') { t.borrador = JSON.parse(r.request().postData()).book; t.guardados.push(t.borrador); t.version++; return json({ ok: true, version: t.version }); }
      if (u.pathname === '/api/book-editor/draft') return json({ book: t.borrador, version: t.version });
      return json({});
    });
    await page.goto(base + ruta);
    return t;
  }
  const esperarGuardado = async (t, cond, ms = 6000) => { const t0 = Date.now(); while (!cond(t.borrador) && Date.now() - t0 < ms) await t.page.waitForTimeout(100); return cond(t.borrador); };

  // 1) Al entrar a Mi libro se abre el estudio solo
  let t = await abrir();
  await t.page.waitForFunction(() => /sincronizado/.test((document.getElementById('ecoEditorialStatus') || {}).textContent || ''));
  ok(await t.page.evaluate(() => document.getElementById('ecoEditorialDialog') && !document.getElementById('ecoEditorialDialog').hidden), 'al entrar a Mi libro se abre el estudio solo');
  ok(await t.page.locator('#ecoEditorialPdf').innerText() === 'Descargar PDF' && await t.page.locator('#ecoEditorialDigital').innerText() === 'Descargar libro digital', 'arriba hay dos botones: "Descargar PDF" y "Descargar libro digital"');
  ok(await t.page.locator('[data-view], #ecoEditorialForm').count() === 0, 'ya no está el menú de opciones de antes');

  // 2) El índice de la izquierda: todo el libro, en el orden del libro
  const items = await t.page.locator('#ecoEditorialOutline .eco-outline-item').allInnerTexts();
  ok(items.slice(0, 3).join('|') === 'Portada|Dedicatoria|Contenido', 'el índice lista Portada, Dedicatoria y Contenido (' + items.slice(0, 3).join(' | ') + ')');
  const titulos = await t.page.locator('#ecoEditorialOutline .eco-outline-t').allInnerTexts();
  ok(titulos.join('|') === 'El trabajo|Infancia|Mi familia', 'y luego los capítulos en el orden del libro (' + titulos.join(' | ') + ')');
  const lado = await t.page.evaluate(() => { const s = document.querySelector('.eco-editorial-sidebar').getBoundingClientRect(), p = document.querySelector('.eco-editorial-preview').getBoundingClientRect(); return s.right <= p.left + 1 && s.width > 200 && p.width > 500; });
  ok(lado, 'el índice está a la izquierda y el libro a la derecha');

  // 3) Recorrer el libro desde el índice
  await t.page.locator('#ecoEditorialOutline .eco-outline-chapter', { hasText: 'Mi familia' }).click();
  await t.page.waitForFunction(() => /Mi familia/.test((document.querySelector('#ecoEditorialOutline .eco-outline-item.selected') || {}).textContent || ''));
  ok(/Mi familia/.test(await t.page.locator('#ecoEditorialOutline .eco-outline-item.selected').innerText()), 'al tocar un capítulo del índice el libro baja hasta él y queda marcado');
  await t.page.locator('#ecoEditorialOutline .eco-outline-item', { hasText: 'Portada' }).click();
  await t.page.waitForFunction(() => document.querySelector('.eco-editorial-preview').scrollTop < 40);
  ok(await t.page.evaluate(() => document.querySelector('.eco-editorial-preview').scrollTop) < 40, 'y «Portada» vuelve al principio');

  // 4) Editar el libro directamente
  await t.page.locator('.eco-editorial-cover h1').fill('Los recuerdos de Ana');
  ok(await esperarGuardado(t, (b) => b.title === 'Los recuerdos de Ana'), 'se edita el título del libro sobre la portada y se guarda');
  ok(await t.page.locator('.eco-editorial-vacia').count() === 1, 'una dedicatoria vacía queda marcada para no imprimirse');
  await t.page.locator('[data-sec="dedication"] .eco-editorial-dedication').fill('Para mis nietos');
  ok(await esperarGuardado(t, (b) => b.dedication === 'Para mis nietos') && await t.page.locator('.eco-editorial-vacia').count() === 0, 'se escribe la dedicatoria y desde ahí sí va en el libro');
  await t.page.locator('[data-sec="ch-1"] h2').fill('Mi infancia en la finca');
  ok(await esperarGuardado(t, (b) => b.edits && b.edits['1'] && b.edits['1'].title === 'Mi infancia en la finca'), 'se edita el título de un capítulo y se guarda');
  ok((await t.page.locator('#ecoEditorialOutline .eco-outline-t').allInnerTexts()).includes('Mi infancia en la finca') && /Mi infancia en la finca/.test(await t.page.locator('.eco-editorial-indexrows').innerText()), 'el índice de la izquierda y la página de Contenido siguen el nuevo título');
  const primero = t.page.locator('[data-sec="ch-1"] p.eco-editorial-paragraph').first();
  await primero.fill('Primer párrafo reescrito.');
  await primero.press('Enter');
  await t.page.keyboard.type('Y un párrafo nuevo.');
  await t.page.locator('#ecoEditorialTitle').click();
  await t.page.waitForFunction(() => document.querySelectorAll('[data-sec="ch-1"] p.eco-editorial-paragraph').length === 5);
  ok(await t.page.locator('[data-sec="ch-1"] p.eco-editorial-paragraph').count() === 5, 'Enter separa un párrafo nuevo al salir del texto (5 párrafos)');
  ok(await esperarGuardado(t, (b) => b.edits['1'].text && b.edits['1'].text.startsWith('Primer párrafo reescrito.\n\nY un párrafo nuevo.\n\nPárrafo 2.')), 'el texto editado se guarda con sus párrafos');
  ok(await t.page.evaluate(() => getComputedStyle(document.querySelector('[data-sec="ch-1"] p.eco-editorial-paragraph')).textAlign) === 'justify', 'el texto del libro está justificado');

  // 5) Cambiar el orden desde el índice
  await t.page.locator('#ecoEditorialOutline .eco-outline-row', { hasText: 'Mi familia' }).locator('button', { hasText: '↑' }).click();
  ok(await esperarGuardado(t, (b) => b.order.join(',') === '2,3,1'), 'subir un capítulo en el índice cambia el orden del libro');
  ok((await t.page.locator('#ecoEditorialBook [data-sec^="ch-"] small').allInnerTexts()).join('|') === 'CAPÍTULO 01|CAPÍTULO 02|CAPÍTULO 03' && await t.page.locator('#ecoEditorialBook [data-sec^="ch-"]').first().getAttribute('data-sec') === 'ch-2', 'y el libro se reordena y renumera');

  // 6) Los botones de arriba: las dos descargas pasan por la pantalla de pago, aunque la compra de prueba ya estuviera aprobada
  let descargas = 0; t.page.on('download', () => { descargas++; });
  await t.page.click('#ecoEditorialPdf');
  await t.page.waitForSelector('#ecoDemoPay:not([hidden])');
  ok(descargas === 0, '«Descargar PDF» muestra primero la pantalla de pago (aunque ya se había aprobado antes)');
  await t.page.click('#ecoDemoContinue');
  await t.page.waitForTimeout(400);
  ok(descargas === 0 && /compra de prueba/.test(await t.page.locator('#ecoEditorialStatus').innerText()), 'si se cierra la pantalla de pago sin comprar, no se descarga nada');
  await t.page.click('#ecoEditorialPdf');
  await t.page.waitForSelector('#ecoDemoPay:not([hidden])');
  const [pdf] = await Promise.all([t.page.waitForEvent('download', { timeout: 60000 }), t.page.click('#ecoDemoConfirm')]);
  const bytesPdf = fs.readFileSync(await pdf.path());
  const textoPdf = bytesPdf.toString('latin1');
  ok(/\.pdf$/.test(pdf.suggestedFilename()) && bytesPdf.slice(0, 5).toString() === '%PDF-', 'al pagar, el PDF se descarga de una, como archivo (' + pdf.suggestedFilename() + ')');
  ok(await t.page.evaluate(() => window.__imprimio) === 0, 'sin abrir la ventana de impresión (que en el celular no hace nada)');
  const caja = textoPdf.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  ok(caja && Math.abs(caja[1] - 595.28) < 1 && Math.abs(caja[2] - 841.89) < 1, 'en hoja A4 (' + (caja ? caja[1] + ' x ' + caja[2] + ' pt' : 'sin medida') + ')');
  ok((textoPdf.match(/\/Type \/Page\b/g) || []).length >= 6, 'con portada, dedicatoria, contenido y una página por capítulo (' + (textoPdf.match(/\/Type \/Page\b/g) || []).length + ' páginas)');
  ok(/Listo: se descargó tu PDF en hoja A4/.test(await t.page.locator('#ecoEditorialStatus').innerText()), 'y avisa arriba que ya se descargó');
  await t.page.click('#ecoEditorialDigital');
  await t.page.waitForSelector('#ecoDemoPay:not([hidden])');
  ok(await t.page.locator('#ecoDemoConfirm').isVisible(), '«Descargar libro digital» también muestra la pantalla de pago');
  const [descarga] = await Promise.all([t.page.waitForEvent('download', { timeout: 30000 }), t.page.click('#ecoDemoConfirm')]);
  const html = fs.readFileSync(await descarga.path(), 'utf8');
  ok(/\.html$/.test(descarga.suggestedFilename()) && /Los recuerdos de Ana/.test(html) && /Mi infancia en la finca/.test(html), 'al pagar baja el libro digital con lo que se editó (' + descarga.suggestedFilename() + ')');
  ok(/Listo: se descargó/.test(await t.page.locator('#ecoEditorialStatus').innerText()), 'y avisa arriba, junto al libro');
  if (CAPTURAS) await t.page.screenshot({ path: path.join(CAPTURAS, 'estudio-escritorio.png') });

  // 7) Volver a la bitácora, eliminar un capítulo y actualizar el libro
  ok(await t.page.locator('#ecoEditorialBack').getAttribute('href') === '/app.html' && /Volver a la bitácora/.test(await t.page.locator('#ecoEditorialBack').innerText()), 'hay un botón para volver a la bitácora');
  ok(await t.page.locator('#ecoEditorialClose').count() === 0 && await t.page.locator('#lista, #generarBtn').count() === 0, 'ya no existe la pantalla de lista de capítulos');
  t.page.once('dialog', (d) => d.accept());
  await t.page.locator('[data-sec="ch-3"] .eco-editorial-delete').click();
  await t.page.waitForFunction(() => !document.querySelector('[data-sec="ch-3"]'));
  ok(t.borrados.join(',') === '3' && (await t.page.locator('#ecoEditorialOutline .eco-outline-t').allInnerTexts()).join('|') === 'El trabajo|Mi infancia en la finca', '«Eliminar capítulo» lo borra del servidor y del libro');
  ok(await esperarGuardado(t, (b) => !b.order.includes('3') && !(b.edits && b.edits['3'])), 'y limpia lo que colgaba de ese capítulo en el borrador');
  t.page.once('dialog', (d) => { ok(/se pierden los cambios/i.test(d.message()), 'antes de actualizar avisa que se pierden los cambios de los capítulos'); d.accept(); });
  await t.page.selectOption('#ecoEditorialVoz', 'primera');
  await t.page.click('#ecoEditorialUpdate');
  await t.page.waitForFunction(() => /Libro actualizado/.test(document.getElementById('ecoEditorialStatus').textContent));
  ok(t.generados.length === 1 && t.generados[0].persona === 'primera', '«Actualizar libro» vuelve a generar los capítulos con la voz elegida');
  ok((await t.page.locator('#ecoEditorialOutline .eco-outline-t').allInnerTexts()).join('|') === 'Capítulo nuevo uno|Capítulo nuevo dos', 'y el libro muestra los capítulos nuevos');
  ok(await esperarGuardado(t, (b) => b.order.length === 0 && Object.keys(b.edits || {}).length === 0 && b.title === 'Los recuerdos de Ana'), 'las ediciones viejas se limpian y el título del libro se conserva');
  ok(t.errores.length === 0, 'sin errores de JavaScript' + (t.errores.length ? ': ' + t.errores.join(' | ') : ''));
  await t.ctx.close();

  // 7b) Una foto grande del celular se reduce sola y hay un solo botón para subirla
  t = await abrir();
  await t.page.waitForFunction(() => /sincronizado/.test((document.getElementById('ecoEditorialStatus') || {}).textContent || ''));
  await t.page.click('[data-sec="ch-2"] .eco-editorial-tools > summary');
  ok(await t.page.locator('[data-sec="ch-2"] .eco-editorial-upload-label').count() === 1 && await t.page.evaluate(() => { const i = document.querySelector('[data-sec="ch-2"] .eco-editorial-upload-input'); const r = i.getBoundingClientRect(); return r.width <= 2 && r.height <= 2; }), 'para subir fotos hay un solo botón (el selector de archivos feo queda escondido)');
  const grande = await t.page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 4032; c.height = 3024; const x = c.getContext('2d'); const im = x.createImageData(c.width, c.height); for (let i = 0; i < im.data.length; i += 4) { im.data[i] = Math.random() * 255; im.data[i + 1] = Math.random() * 255; im.data[i + 2] = Math.random() * 255; im.data[i + 3] = 255; } x.putImageData(im, 0, 0); const b = await new Promise((r) => c.toBlob(r, 'image/png')); const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s); });
  const original = Buffer.from(grande, 'base64');
  await t.page.setInputFiles('[data-sec="ch-2"] .eco-editorial-upload-input', { name: 'IMG_4210.PNG', mimeType: 'image/png', buffer: original });
  const t0 = Date.now(); while (!t.fotosSubidas.length && Date.now() - t0 < 30000) await t.page.waitForTimeout(100);
  ok(original.length > 20 * 1024 * 1024, 'la foto de prueba es enorme (' + (original.length / 1048576).toFixed(0) + ' MB, como una del iPhone Pro)');
  ok(t.fotosSubidas.length === 1 && t.fotosSubidas[0].tipo === 'image/jpeg' && t.fotosSubidas[0].bytes < 2.9 * 1024 * 1024, 'se sube reducida: JPEG de ' + (t.fotosSubidas[0] ? (t.fotosSubidas[0].bytes / 1048576).toFixed(1) : '?') + ' MB (el libro acepta hasta 3 MB)');
  await t.ctx.close();

  // 8) Sin comprar: pide la compra de prueba antes de bajar el PDF
  t = await abrir({ aprobada: false });
  await t.page.waitForFunction(() => /sincronizado/.test((document.getElementById('ecoEditorialStatus') || {}).textContent || ''));
  await t.page.click('#ecoEditorialPdf');
  await t.page.waitForSelector('#ecoDemoPay:not([hidden])');
  ok(t.compras === 0, 'sin comprar, «Descargar PDF» primero abre la compra de prueba');
  const [pdf2] = await Promise.all([t.page.waitForEvent('download', { timeout: 60000 }), t.page.click('#ecoDemoConfirm')]);
  ok(t.compras === 1 && /\.pdf$/.test(pdf2.suggestedFilename()), 'y al aprobarla sigue con la descarga del PDF');
  await t.ctx.close();

  // 9) Sin capítulos todavía: el libro vacío invita a actualizar el libro
  t = await abrir({ sinCapitulos: true });
  await t.page.waitForSelector('.eco-editorial-sin-capitulos');
  ok(/Todavía no tienes capítulos/.test(await t.page.locator('.eco-editorial-sin-capitulos').innerText()) && await t.page.locator('.eco-editorial-sin-capitulos button', { hasText: 'Actualizar libro' }).count() === 1, 'sin capítulos, el libro lo explica y ofrece «Actualizar libro»');
  ok(t.errores.length === 0, 'sin errores sin capítulos' + (t.errores.length ? ': ' + t.errores.join(' | ') : ''));
  await t.ctx.close();

  // 10) Celular: el índice se abre con un botón
  t = await abrir({ ancho: 390, alto: 844, movil: true });
  await t.page.waitForFunction(() => /sincronizado/.test((document.getElementById('ecoEditorialStatus') || {}).textContent || ''));
  ok(!(await t.page.locator('.eco-editorial-sidebar').isVisible()), 'en el celular el índice está oculto hasta que se pide');
  await t.page.tap('#ecoEditorialIndexToggle');
  await t.page.waitForSelector('.eco-editorial-sidebar', { state: 'visible' });
  if (CAPTURAS) await t.page.screenshot({ path: path.join(CAPTURAS, 'estudio-movil-indice.png') });
  await t.page.locator('#ecoEditorialOutline .eco-outline-chapter', { hasText: 'Mi familia' }).tap();
  await t.page.waitForFunction(() => document.querySelector('.eco-editorial-preview').scrollTop > 500);
  ok(!(await t.page.locator('.eco-editorial-sidebar').isVisible()), 'al elegir un capítulo el índice se cierra y el libro baja hasta él');
  ok(await t.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'sin scroll horizontal en el celular');
  if (CAPTURAS) await t.page.screenshot({ path: path.join(CAPTURAS, 'estudio-movil.png') });
  ok(t.errores.length === 0, 'sin errores en el celular' + (t.errores.length ? ': ' + t.errores.join(' | ') : ''));
  await t.ctx.close();

  await browser.close(); server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
