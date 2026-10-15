// Mi libro: "Exportar en PDF". Al comprar (prueba) se descarga de una vez: se abre la ventana de impresión
// ("Guardar como PDF") sin pasos de más, tanto desde el botón de Mi libro como desde el editor.
//   node test/libro-exportar.playwright.js
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright: corre "npm install".'); process.exit(1); }
let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };

const capitulos = [
  { id: 1, title: 'Infancia en Bogotá', theme: 'infancia', generated_text: 'Había una casa grande.\n\nSegundo párrafo.', story_ids: [1], created_at: new Date().toISOString() },
  { id: 2, title: 'El trabajo', theme: 'trabajo', generated_text: 'Texto del segundo capítulo.', story_ids: [2], created_at: new Date().toISOString() },
];

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();

  async function abrir({ aprobada = false, sinCapitulos = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
    const page = await ctx.newPage();
    const estado = { aprobada, compras: 0 };
    const errores = [];
    page.on('pageerror', (e) => errores.push(e.message));
    await page.addInitScript(() => {
      try { localStorage.setItem('eco_tour_done__capitulos_html', '1'); } catch (e) { /* nada */ }
      window.__imprimio = 0;
      window.print = () => { window.__imprimio++; setTimeout(() => window.dispatchEvent(new Event('afterprint')), 50); };
    });
    await page.route('**/api/**', (r) => {
      const u = r.request().url(), m = r.request().method();
      if (u.includes('/api/book-demo/status')) return r.fulfill({ json: { approved: estado.aprobada } });
      if (u.includes('/api/book-demo/purchase') && m === 'POST') { estado.compras++; estado.aprobada = true; return r.fulfill({ json: { approved: true } }); }
      if (u.includes('/api/chapters')) return r.fulfill({ json: { chapters: sinCapitulos ? [] : capitulos } });
      if (u.includes('/api/story-log')) return r.fulfill({ json: { stories: [{ id: 1, texto: 'x', created_at: new Date().toISOString() }] } });
      if (u.includes('/api/book-editor/draft')) return r.fulfill({ json: { book: {}, version: 1 } });
      return r.fulfill({ json: {} });
    });
    await page.goto(base + '/capitulos.html');
    await page.waitForSelector('#ecoLibroExportar', { timeout: 10000 });
    return { page, ctx, estado, errores };
  }
  const imprimio = (page) => page.evaluate(() => window.__imprimio);

  // 1) El botón está en Mi libro y mide lo mismo que los demás.
  let t = await abrir();
  const medidas = await t.page.evaluate(() => { const r = document.getElementById('ecoLibroExportar').getBoundingClientRect(); const d = document.getElementById('ecoEditorialOpen').getBoundingClientRect(); return { h: Math.round(r.height), hd: Math.round(d.height), visible: r.width > 0 }; });
  ok(medidas.visible && (await t.page.textContent('#ecoLibroExportar')) === 'Exportar en PDF', 'Mi libro tiene el botón "Exportar en PDF"');
  ok(medidas.h === 46 && medidas.hd === 46, 'y mide lo mismo que "Diseñar mi libro" (46px)');

  // 2) Sin comprar: abre la compra y al pagar se imprime de una vez.
  await t.page.click('#ecoLibroExportar');
  await t.page.waitForSelector('#ecoDemoPay:not([hidden])');
  ok(await t.page.isVisible('#ecoDemoConfirm') && (await imprimio(t.page)) === 0, 'sin comprar: abre la ventana de pago y todavía no imprime');
  await t.page.click('#ecoDemoConfirm');
  await t.page.waitForFunction(() => window.__imprimio === 1, null, { timeout: 20000 });
  ok(t.estado.compras === 1, 'al darle al botón de pago se registra la compra de prueba');
  ok(await t.page.isHidden('#ecoDemoPay'), 'la ventana de pago se cierra sola');
  ok((await imprimio(t.page)) === 1, 'y se abre de una vez la ventana para guardar el PDF (sin pasos de más)');
  const paginas = await t.page.evaluate(() => document.querySelectorAll('#ecoEditorialBook .eco-editorial-page').length);
  ok(paginas >= 3, 'el libro completo estaba armado al imprimir (' + paginas + ' páginas: portada, índice y capítulos)');
  await t.page.waitForFunction(() => document.getElementById('ecoEditorialDialog').hidden === true, null, { timeout: 5000 });
  ok(true, 'el editor se cierra solo después de imprimir (no queda nada abierto)');
  ok((await t.page.textContent('#ecoLibroExportar')) === 'Exportar en PDF' && !(await t.page.isDisabled('#ecoLibroExportar')), 'el botón queda listo para volver a usarse');

  // 3) Ya comprado: va directo, sin ventana de pago.
  await t.page.click('#ecoLibroExportar');
  await t.page.waitForFunction(() => window.__imprimio === 2, null, { timeout: 20000 });
  ok(t.estado.compras === 1 && await t.page.isHidden('#ecoDemoPay'), 'con la compra aprobada, exporta directo sin volver a pedir pago');
  ok(t.errores.length === 0, 'sin errores de JavaScript' + (t.errores.length ? ': ' + t.errores.join(' | ') : ''));
  await t.ctx.close();

  // 4) Cerrar la ventana de pago: no se imprime y se explica.
  t = await abrir();
  await t.page.click('#ecoLibroExportar');
  await t.page.waitForSelector('#ecoDemoPay:not([hidden])');
  await t.page.click('#ecoDemoContinue');
  await t.page.waitForTimeout(500);
  ok((await imprimio(t.page)) === 0 && (await t.page.textContent('#ecoLibroExportarMsg')).includes('compra de prueba'), 'si cierra la ventana de pago no se imprime y se le explica por qué');
  await t.ctx.close();

  // 5) Sin capítulos.
  t = await abrir({ aprobada: true, sinCapitulos: true });
  await t.page.click('#ecoLibroExportar');
  await t.page.waitForFunction(() => /Todavía no tienes capítulos/.test(document.getElementById('ecoLibroExportarMsg').textContent), null, { timeout: 10000 });
  ok((await imprimio(t.page)) === 0 && await t.page.isHidden('#ecoDemoPay'), 'sin capítulos no pide pago ni imprime una hoja en blanco: avisa que primero hay que generarlos');
  await t.ctx.close();

  // 6) Desde el editor: al comprar también se descarga de una vez.
  t = await abrir();
  await t.page.click('#ecoEditorialOpen');
  await t.page.waitForFunction(() => /✓/.test((document.getElementById('ecoEditorialStatus') || {}).textContent || ''), null, { timeout: 15000 });
  await t.page.click('#ecoEditorialPrint');
  await t.page.waitForSelector('#ecoDemoPay:not([hidden])');
  await t.page.click('#ecoDemoConfirm');
  await t.page.waitForFunction(() => window.__imprimio === 1, null, { timeout: 20000 });
  ok(await t.page.isHidden('#ecoDemoPay'), 'desde el editor: al pagar se cierra la ventana y se abre de una vez la ventana del PDF');
  await t.ctx.close();

  await browser.close();
  server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
