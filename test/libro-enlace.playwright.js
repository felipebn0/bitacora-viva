// Mi libro: "Compartir libro en línea" crea un enlace sin descargar nada y, una vez creado, se actualiza solo cuando cambia el libro.
//
//   node test/libro-enlace.playwright.js   (o: npm run test:libro-enlace)
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright: corre "npm install".'); process.exit(1); }
let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };
const AUDIO = 'https://x.public.blob.vercel-storage.com/audio/1/uno.webm';
const capitulos = [
  { id: 1, title: 'Infancia', theme: 'infancia', generated_text: 'Primer párrafo de la infancia.\n\nSegundo párrafo.', story_ids: [1], audios: [AUDIO], preguntas: ['¿Cómo era la finca?'], created_at: new Date().toISOString() },
  { id: 2, title: 'El trabajo', theme: 'trabajo', generated_text: 'Texto del trabajo.', story_ids: [2], audios: [], created_at: new Date().toISOString() },
];

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const t = { posts: [], deletes: 0, activo: false, descargas: 0, pedidosDeMedios: 0, borrador: { title: 'Mi libro de prueba', subtitle: '', order: ['1', '2'], edits: {}, qr: {}, qrOff: {} }, version: 1, errores: [] };
  page.on('pageerror', (e) => t.errores.push(e.message));
  page.on('download', () => t.descargas++);
  await page.addInitScript(() => { try { localStorage.setItem('eco_tour_done__capitulos_html', '1'); } catch (e) { /* nada */ } });
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url()), m = r.request().method();
    const json = (o) => r.fulfill({ json: o });
    if (u.pathname === '/api/book-demo/status') return json({ approved: true });
    if (u.pathname === '/api/book-demo/purchase') return json({ approved: true });
    if (u.pathname === '/api/media-file') { t.pedidosDeMedios++; return r.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from('x') }); }
    if (u.pathname === '/api/libro-compartido') {
      if (m === 'POST') { t.posts.push(JSON.parse(r.request().postData())); t.activo = true; return json({ ok: true, token: 'a'.repeat(48), url: base + '/libro/' + 'a'.repeat(48) }); }
      if (m === 'DELETE') { t.deletes++; t.activo = false; return json({ ok: true }); }
      return json(t.activo ? { activo: true, url: base + '/libro/' + 'a'.repeat(48) } : { activo: false });
    }
    if (u.pathname === '/api/chapters') return json({ chapters: capitulos });
    if (u.pathname === '/api/story-log') return json({ stories: [] });
    if (u.pathname === '/api/book-editor/draft' && m === 'PUT') { t.borrador = JSON.parse(r.request().postData()).book; t.version++; return json({ ok: true, version: t.version }); }
    if (u.pathname === '/api/book-editor/draft') return json({ book: t.borrador, version: t.version });
    return json({});
  });
  await page.goto(base + '/capitulos.html');
  await page.waitForFunction(() => /sincronizado/.test((document.getElementById('ecoEditorialStatus') || {}).textContent || ''));

  ok(await page.locator('#ecoEditorialShareMake').isVisible() && await page.locator('#ecoEditorialShareBox').isHidden(), 'sin enlace: se ve el botón «Compartir libro en línea» y no el cuadro del enlace');

  await page.click('#ecoEditorialShareMake');
  await page.waitForSelector('#ecoDemoPay:not([hidden])');
  ok(t.posts.length === 0, 'antes de crear el enlace se muestra la pantalla de pago');
  await page.click('#ecoDemoConfirm');
  await page.waitForSelector('#ecoEditorialShareBox:not([hidden])');
  ok(t.posts.length === 1 && t.descargas === 0, 'al aprobar se crea el enlace sin descargar ningún archivo');
  const cuerpo = JSON.stringify(t.posts[0]);
  ok(!/data:(image|audio)/.test(cuerpo), 'y sin fotos ni audios pegados al enlace: solo se mandan sus direcciones');
  ok(t.posts[0].datos.capitulos.length === 2 && t.posts[0].datos.capitulos[0].audios[0].url === AUDIO && t.posts[0].datos.capitulos[0].audios[0].pregunta === '¿Cómo era la finca?', 'el enlace lleva los capítulos, el audio y su pregunta');
  ok(/\/libro\/a{48}$/.test(await page.inputValue('#ecoEditorialShareUrl')) && await page.locator('#ecoEditorialShareMake').isHidden(), 'se muestra el enlace y se esconde el botón de crear');

  // Cambiar el libro lo actualiza solo
  await page.locator('[data-sec="ch-1"] h2').fill('Infancia (editado)');
  const t0 = Date.now(); while (t.posts.length < 2 && Date.now() - t0 < 15000) await page.waitForTimeout(150);
  ok(t.posts.length === 2, 'si cambias el libro, el enlace se actualiza solo');
  ok(JSON.stringify(t.posts[1]).includes('(editado)'), 'con el cambio nuevo');
  ok(t.descargas === 0, 'sin descargar nada');

  // Dejar de compartir
  page.once('dialog', (d) => d.accept());
  await page.click('#ecoEditorialShareStop');
  await page.waitForSelector('#ecoEditorialShareMake:not([hidden])');
  ok(t.deletes === 1 && await page.locator('#ecoEditorialShareBox').isHidden(), 'dejar de compartir retira el enlace y vuelve el botón de crear');
  const antes = t.posts.length;
  await page.locator('[data-sec="ch-1"] h2').fill('Infancia más');
  await page.waitForTimeout(7500);
  ok(t.posts.length === antes, 'sin enlace, los cambios ya no lo vuelven a crear');
  ok(t.errores.length === 0, 'sin errores en la página' + (t.errores.length ? ': ' + t.errores.join(' | ') : ''));

  await browser.close(); server.close();
  console.log(fallos ? '\nHubo fallos.' : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
