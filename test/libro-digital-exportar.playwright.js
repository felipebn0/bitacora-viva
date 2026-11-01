// Mi libro: "Exportar libro digital" descarga un solo archivo HTML con los capítulos (ya editados y en el orden elegido),
// las fotos reducidas y las tipografías, y ese archivo abre solo, sin internet.
//
//   node test/libro-digital-exportar.playwright.js   (o: npm run test:libro-digital-exportar)
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright: corre "npm install".'); process.exit(1); }
let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };

const foto = fs.readFileSync(path.join(__dirname, '..', 'public', 'images', 'voces', 'voz-1.jpg'));
const capitulos = [
  { id: 1, title: 'Infancia en Bogotá', theme: 'infancia', generated_text: 'Había una casa grande.\n\nSegundo párrafo.', story_ids: [1], audios: ['https://ejemplo.blob/audio-1.webm', 'https://ejemplo.blob/audio-enorme.webm'], preguntas: ['¿Cómo se llamaban tus papás?', ''], created_at: new Date().toISOString() },
  { id: 2, title: 'El trabajo', theme: 'trabajo', generated_text: 'Texto del segundo capítulo.', story_ids: [2], created_at: new Date().toISOString() },
];

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());

  async function abrir({ aprobada = true, sinCapitulos = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    const estado = { aprobada, compras: 0 };
    const errores = [];
    page.on('pageerror', (e) => errores.push(e.message));
    await page.addInitScript(() => { try { localStorage.setItem('eco_tour_done__capitulos_html', '1'); } catch (e) { /* nada */ } });
    await page.route('**/api/**', (r) => {
      const u = r.request().url(), m = r.request().method();
      if (u.includes('/api/book-demo/status')) return r.fulfill({ json: { approved: estado.aprobada } });
      if (u.includes('/api/book-demo/purchase') && m === 'POST') { estado.compras++; estado.aprobada = true; return r.fulfill({ json: { approved: true } }); }
      if (u.includes('/api/media-file') && u.includes('audio-enorme')) return r.fulfill({ status: 200, contentType: 'audio/webm', body: Buffer.alloc(9 * 1024 * 1024, 1) });
      if (u.includes('/api/media-file') && u.includes('audio')) return r.fulfill({ status: 200, contentType: 'audio/webm', body: Buffer.from('audio-de-prueba') });
      if (u.includes('/api/media-file')) return r.fulfill({ status: 200, contentType: 'image/jpeg', body: foto });
      if (u.includes('/api/chapters')) return r.fulfill({ json: { chapters: sinCapitulos ? [] : capitulos } });
      if (u.includes('/api/story-log')) return r.fulfill({ json: { stories: [{ id: 1, texto: 'x', created_at: new Date().toISOString(), media_urls: [{ type: 'image', url: 'https://ejemplo.blob/foto1.jpg', caption: 'Con mamá' }] }] } });
      if (u.includes('/api/book-editor/draft')) return r.fulfill({ json: { book: { title: 'El libro de Ana', subtitle: 'Para los nietos', dedication: 'Para Lucía', order: [2, 1], edits: { 1: { title: 'Infancia editada' } } }, version: 1 } });
      return r.fulfill({ json: {} });
    });
    await page.goto(base + '/capitulos.html');
    await page.waitForFunction(() => /sincronizado/.test((document.getElementById('ecoEditorialStatus') || {}).textContent || ''), null, { timeout: 15000 });
    return { page, ctx, estado, errores };
  }

  let t = await abrir();
  ok((await t.page.textContent('#ecoEditorialDigital')) === 'Compartir libro digital', 'Mi libro tiene el botón "Compartir libro digital" (ya no descarga)');
  // El archivo sigue existiendo en EcoLibroDigital.exportar (el estudio ya no lo ofrece): se prueba directo.
  const [descarga] = await Promise.all([t.page.waitForEvent('download', { timeout: 30000 }), t.page.evaluate(() => window.EcoLibroDigital.exportar({ yaPagado: true, aviso: (txt) => { document.getElementById('ecoEditorialStatus').textContent = txt || ''; } }))]);
  ok(descarga.suggestedFilename() === 'el-libro-de-ana-eco.html', 'el archivo se llama como el libro: ' + descarga.suggestedFilename());
  const ruta = await descarga.path();
  const html = fs.readFileSync(ruta, 'utf8');
  const datos = JSON.parse(html.match(/<script type="application\/json" id="datos">([\s\S]*?)<\/script>/)[1]);
  ok(datos.titulo === 'El libro de Ana' && datos.dedicatoria === 'Para Lucía', 'lleva el título y la dedicatoria del libro');
  ok(datos.capitulos.map((c) => c.titulo).join('|') === 'El trabajo|Infancia editada', 'respeta el orden elegido y los títulos editados');
  const fotoRef = datos.capitulos[1].fotos[0];
  ok(datos.capitulos[1].fotos.length === 1 && fotoRef.pie === 'Con mamá' && !fotoRef.src && new RegExp('<img id="' + fotoRef.ref + '" src="data:image/jpeg;base64,').test(html), 'las fotos van dentro del archivo (reducidas) con su pie de foto, una sola vez');
  ok(/@font-face\{font-family:"Source Serif 4"[^}]*data:font\/woff2;base64,/.test(html) && /font-family:"Atkinson Hyperlegible"/.test(html), 'las tipografías van incluidas');
  const conAudio = datos.capitulos[1].audios;
  ok(conAudio.length === 1 && !conAudio[0].src && new RegExp('<audio id="' + conAudio[0].ref + '" controls preload="metadata" src="data:audio/webm;base64,').test(html) && conAudio[0].pregunta === '¿Cómo se llamaban tus papás?', 'los audios originales van dentro del archivo, con su pregunta, una sola vez');
  ok(/Un audio pesaba demasiado/.test(await t.page.locator('#ecoEditorialStatus').innerText()), 'un audio demasiado pesado se deja fuera y se avisa');
  ok(datos.audiosOmitidos === undefined, 'el conteo de audios omitidos no se cuela en el archivo');
  ok(!html.includes('/*__FUENTES__*/') && !html.includes('/*__DATOS__*/'), 'no quedan marcas sin llenar');
  ok(html.length < 3 * 1024 * 1024, 'pesa poco (' + (html.length / 1048576).toFixed(2) + ' MB)');
  ok(/Listo: se descargó/.test(await t.page.locator('#ecoEditorialStatus').innerText()), 'avisa que ya se descargó');
  ok(!(await t.page.isDisabled('#ecoEditorialDigital')), 'el botón de compartir sigue disponible');
  ok(t.errores.length === 0, 'sin errores de JavaScript' + (t.errores.length ? ': ' + t.errores.join(' | ') : ''));

  // El archivo descargado abre solo, sin servidor ni internet.
  const ctx2 = await browser.newContext({ viewport: { width: 1300, height: 900 }, offline: true });
  const p2 = await ctx2.newPage();
  const err2 = []; p2.on('pageerror', (e) => err2.push(e.message));
  const copia = path.join(os.tmpdir(), 'eco-libro-digital-prueba.html'); fs.copyFileSync(ruta, copia);
  await p2.goto('file://' + copia); await p2.waitForTimeout(1500);
  ok(await p2.locator('.tape').count() === 2, 'el archivo abre sin conexión y muestra los 2 capítulos');
  ok((await p2.locator('#libroTitulo').innerText()) === 'El libro de Ana', 'con el título del libro arriba');
  ok(await p2.evaluate(() => document.fonts.check('16px "Source Serif 4"')), 'y usa la tipografía incluida');
  ok(await p2.evaluate(() => !document.querySelector('.plano').offsetParent) && await p2.evaluate((ref) => !!document.getElementById(ref).src.startsWith('data:image/jpeg'), fotoRef.ref), 'con JavaScript la versión de lectura se esconde pero conserva las fotos que usa la estantería');
  ok(err2.length === 0, 'sin errores al abrir el archivo' + (err2.length ? ': ' + err2.join(' | ') : ''));
  await ctx2.close();

  // Sin JavaScript (vista previa de Archivos en el iPhone, correo...): se lee el texto del libro
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  const p3 = await ctx3.newPage();
  await p3.goto('file://' + copia); await p3.waitForTimeout(500);
  const texto3 = await p3.locator('body').innerText();
  ok(/El libro de Ana/.test(texto3) && /El trabajo/.test(texto3) && /Infancia editada/.test(texto3) && /Texto del segundo capítulo/.test(texto3), 'sin JavaScript se ve el texto del libro (títulos y capítulos)');
  ok(/ábrelo en un navegador/.test(texto3) && /¿Cómo se llamaban tus papás\?/.test(texto3), 'y explica cómo ver la estantería, y deja las preguntas de los audios');
  ok(await p3.evaluate(() => document.querySelectorAll('.plano img').length === 1 && document.querySelectorAll('.plano audio').length === 1 && !!document.querySelector('.plano img').naturalWidth), 'con su foto y su reproductor de audio a la vista');
  ok(await p3.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && getComputedStyle(document.body).overflowY !== 'hidden'), 'sin JavaScript se puede recorrer hacia abajo y no se sale de la pantalla');
  await ctx3.close();
  await t.ctx.close();

  // Sin comprar: pide la compra y no descarga hasta pagar. El PDF no se dispara solo.
  t = await abrir({ aprobada: false });
  await t.page.evaluate(() => { window.__imprimio = 0; window.print = () => { window.__imprimio++; }; });
  await t.page.evaluate(() => { window.EcoLibroDigital.exportar({ aviso: () => {} }); });
  await t.page.waitForSelector('#ecoDemoPay:not([hidden])');
  const [d2] = await Promise.all([t.page.waitForEvent('download', { timeout: 30000 }), t.page.click('#ecoDemoConfirm')]);
  ok(t.estado.compras === 1 && !!d2.suggestedFilename(), 'sin comprar: pide la compra de prueba y al pagar descarga');
  await t.page.waitForTimeout(500);
  ok((await t.page.evaluate(() => window.__imprimio)) === 0, 'y no abre la ventana de impresión del PDF');
  await t.ctx.close();

  // Sin capítulos
  t = await abrir({ sinCapitulos: true });
  await t.page.click('#ecoEditorialDigital');
  await t.page.waitForTimeout(600);
  ok(/Todavía no tienes capítulos/.test(await t.page.locator('#ecoEditorialStatus').innerText()), 'sin capítulos lo explica y no crea el enlace');
  await t.ctx.close();

  await browser.close(); server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
