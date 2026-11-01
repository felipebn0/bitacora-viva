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
    const t = { ctx, page, errores: [], guardados: [], borrador: { title: 'Mi libro de prueba', subtitle: 'Para mis nietos', order: ['2', '1', '3'], edits: {}, qr: {}, qrOff: {} }, version: 1, imprimio: 0, compras: 0, aprobada };
    page.on('pageerror', (e) => t.errores.push(e.message));
    await page.addInitScript(() => { try { localStorage.setItem('eco_tour_done__capitulos_html', '1'); } catch (e) { /* nada */ } window.__imprimio = 0; window.print = () => { window.__imprimio++; }; });
    await page.route('**/api/**', (r) => {
      const u = new URL(r.request().url()), m = r.request().method();
      const json = (o) => r.fulfill({ json: o });
      if (u.pathname === '/api/book-demo/status') return json({ approved: t.aprobada });
      if (u.pathname === '/api/book-demo/purchase') { t.compras++; t.aprobada = true; return json({ approved: true }); }
      if (u.pathname === '/api/media-file') return r.fulfill({ status: 200, contentType: 'image/jpeg', body: foto });
      if (u.pathname === '/api/chapters') return json({ chapters: sinCapitulos ? [] : capitulos });
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

  // 6) Los botones de arriba
  await t.page.click('#ecoEditorialPdf');
  await t.page.waitForFunction(() => window.__imprimio === 1);
  ok(/A4/.test(await t.page.locator('#ecoEditorialStatus').innerText()), '«Descargar PDF» abre la impresión y avisa que la hoja es A4');
  const [descarga] = await Promise.all([t.page.waitForEvent('download', { timeout: 30000 }), t.page.click('#ecoEditorialDigital')]);
  const html = fs.readFileSync(await descarga.path(), 'utf8');
  ok(/\.html$/.test(descarga.suggestedFilename()) && /Los recuerdos de Ana/.test(html) && /Mi infancia en la finca/.test(html), '«Descargar libro digital» baja el archivo con lo que se editó (' + descarga.suggestedFilename() + ')');
  ok(/Listo: se descargó/.test(await t.page.locator('#ecoEditorialStatus').innerText()), 'y avisa arriba, junto al libro');
  if (CAPTURAS) await t.page.screenshot({ path: path.join(CAPTURAS, 'estudio-escritorio.png') });

  // 7) Salir a la lista y volver
  await t.page.click('#ecoEditorialClose');
  ok(await t.page.evaluate(() => document.getElementById('ecoEditorialDialog').hidden) && /#capitulos$/.test(t.page.url()), '«Capítulos y audios» cierra el estudio y muestra la lista');
  await t.page.click('#ecoEditorialOpen');
  ok(await t.page.evaluate(() => !document.getElementById('ecoEditorialDialog').hidden) && !/#capitulos/.test(t.page.url()), '«Diseñar mi libro» vuelve a abrir el estudio');
  ok(t.errores.length === 0, 'sin errores de JavaScript' + (t.errores.length ? ': ' + t.errores.join(' | ') : ''));
  await t.ctx.close();

  // 8) Sin comprar: pide la compra de prueba antes de bajar el PDF
  t = await abrir({ aprobada: false });
  await t.page.waitForFunction(() => /sincronizado/.test((document.getElementById('ecoEditorialStatus') || {}).textContent || ''));
  await t.page.click('#ecoEditorialPdf');
  await t.page.waitForSelector('#ecoDemoPay:not([hidden])');
  ok(await t.page.evaluate(() => window.__imprimio) === 0, 'sin comprar, «Descargar PDF» primero abre la compra de prueba');
  await t.page.click('#ecoDemoConfirm');
  await t.page.waitForFunction(() => window.__imprimio === 1);
  ok(t.compras === 1, 'y al aprobarla sigue con la descarga');
  await t.ctx.close();

  // 9) Sin capítulos todavía: se muestra la lista, donde se generan
  t = await abrir({ sinCapitulos: true });
  await t.page.waitForFunction(() => document.getElementById('ecoEditorialDialog') && document.getElementById('ecoEditorialDialog').hidden === true);
  ok(await t.page.evaluate(() => document.getElementById('ecoEditorialDialog').hidden), 'si todavía no hay capítulos, no se abre el estudio solo: se ve la lista para generarlos');
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
