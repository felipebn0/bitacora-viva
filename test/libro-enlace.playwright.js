// Mi libro: el botón «Compartir libro digital» crea un enlace sin descargar nada y, una vez creado, se actualiza solo cuando cambia el libro.
//
//   node test/libro-enlace.playwright.js   (o: npm run test:libro-enlace)
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright: corre "npm install".'); process.exit(1); }
let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };
const AUDIO = 'https://x.public.blob.vercel-storage.com/audio/1/uno.webm';
// 1 segundo de tono (WAV) como si fuera la grabación original: el navegador la decodifica y la guarda otra vez en WAV de 16 kHz.
const wavOriginal = (() => { const n = 8000, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * 12000), 44 + i * 2); return b; })();
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
  const t = { copias: {}, puts: [], ordenPost: [], posts: [], deletes: 0, activo: false, aprobado: false, descargas: 0, pedidosDeMedios: 0, borrador: { title: 'Mi libro de prueba', subtitle: '', order: ['1', '2'], edits: {}, qr: {}, qrOff: {} }, version: 1, errores: [] };
  page.on('pageerror', (e) => t.errores.push(e.message));
  page.on('download', () => t.descargas++);
  await page.addInitScript(() => { try { localStorage.setItem('eco_tour_done__capitulos_html', '1'); } catch (e) { /* nada */ } });
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url()), m = r.request().method();
    const json = (o) => r.fulfill({ json: o });
    if (u.pathname === '/api/book-demo/status') return json({ approved: t.aprobado });
    if (u.pathname === '/api/book-demo/purchase') { t.aprobado = true; return json({ approved: true }); }
    if (u.pathname === '/api/media-file') { t.pedidosDeMedios++; return u.searchParams.get('u') === AUDIO ? r.fulfill({ status: 200, contentType: 'audio/wav', body: wavOriginal }) : r.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from('x') }); }
    if (u.pathname === '/api/libro-compartido/audios') return json({ copias: t.copias });
    if (u.pathname === '/api/libro-compartido/audio' && m === 'PUT') { const cuerpo = r.request().postDataBuffer(); t.puts.push({ u: u.searchParams.get('u'), tipo: r.request().headers()['content-type'], riff: cuerpo.toString('latin1', 0, 4), wave: cuerpo.toString('latin1', 8, 12), tasa: cuerpo.readUInt32LE(24), canales: cuerpo.readUInt16LE(22), bytes: cuerpo.length }); t.ordenPost.push('put'); t.copias[u.searchParams.get('u')] = base + '/copia.wav'; return json({ ok: true, url: base + '/copia.wav' }); }
    if (u.pathname === '/api/libro-compartido') {
      if (m === 'POST') { t.ordenPost.push('post'); t.posts.push(JSON.parse(r.request().postData())); t.activo = true; return json({ ok: true, token: 'a'.repeat(48), url: base + '/libro/' + 'a'.repeat(48) }); }
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

  ok(await page.locator('#ecoEditorialDigital').innerText() === 'Compartir libro digital' && await page.locator('#ecoEditorialShare').isHidden(), 'sin enlace: arriba está «Compartir libro digital» y el cuadro del enlace no se ve');

  await page.click('#ecoEditorialDigital');
  await page.waitForSelector('#ecoDemoPay:not([hidden])');
  ok(t.posts.length === 0, 'antes de crear el enlace se muestra la pantalla de pago');
  await page.click('#ecoDemoConfirm');
  await page.waitForSelector('#ecoEditorialShare:not([hidden])');
  ok(t.posts.length === 1 && t.descargas === 0, 'al aprobar se crea el enlace sin descargar ningún archivo');
  const cuerpo = JSON.stringify(t.posts[0]);
  ok(!/data:(image|audio)/.test(cuerpo), 'y sin fotos ni audios pegados al enlace: solo se mandan sus direcciones');
  ok(t.posts[0].datos.capitulos.length === 2 && t.posts[0].datos.capitulos[0].audios[0].url === AUDIO && t.posts[0].datos.capitulos[0].audios[0].pregunta === '¿Cómo era la finca?', 'el enlace lleva los capítulos, el audio y su pregunta');
  ok(/\/libro\/a{48}$/.test(await page.inputValue('#ecoEditorialShareUrl')), 'se muestra el enlace del libro');

  ok(t.puts.length === 1 && t.puts[0].u === AUDIO && t.puts[0].tipo === 'audio/wav' && t.puts[0].riff === 'RIFF' && t.puts[0].wave === 'WAVE', 'antes de crear el enlace, cada audio se convierte a WAV y se guarda (para que suene en todos los iPhone)');
  ok(t.puts[0].tasa === 16000 && t.puts[0].canales === 1 && t.puts[0].bytes < 4.2 * 1024 * 1024, 'en mono y a 16 kHz, liviano para el celular');
  ok(t.ordenPost.join(',') === 'put,post', 'y la copia se guarda antes de armar el enlace');

  // Con el enlace ya hecho y la compra aprobada, el botón solo muestra el enlace
  const postsAntes = t.posts.length, putsAntes = t.puts.length, medios0 = t.pedidosDeMedios;
  await page.click('#ecoEditorialDigital');
  await page.waitForTimeout(800);
  ok(await page.locator('#ecoDemoPay').isHidden(), 'con la compra hecha, el botón ya no vuelve a mostrar la pantalla de pago');
  ok(t.posts.length === postsAntes && t.puts.length === putsAntes && t.pedidosDeMedios === medios0, 'y no rearma el libro: ni nuevo envío, ni audios convertidos, ni fotos pedidas');
  ok(/siempre el mismo/.test(await page.locator('#ecoEditorialStatus').innerText()) && /\/libro\/a{48}$/.test(await page.inputValue('#ecoEditorialShareUrl')), 'avisa que es el mismo enlace y lo deja a la vista');
  ok(await page.locator('#ecoEditorialShareRefresh').isVisible(), 'queda el botón «Actualizar ahora»');
  await page.click('#ecoEditorialShareRefresh');
  const tr = Date.now(); while (t.posts.length === postsAntes && Date.now() - tr < 15000) await page.waitForTimeout(150);
  ok(t.posts.length === postsAntes + 1, '«Actualizar ahora» sí vuelve a armar y actualizar el enlace');

  // Cambiar el libro lo actualiza solo
  const antesDeEditar = t.posts.length;
  await page.locator('[data-sec="ch-1"] h2').fill('Infancia (editado)');
  const t0 = Date.now(); while (t.posts.length === antesDeEditar && Date.now() - t0 < 15000) await page.waitForTimeout(150);
  ok(t.posts.length === antesDeEditar + 1, 'si cambias el libro, el enlace se actualiza solo');
  ok(JSON.stringify(t.posts[t.posts.length - 1]).includes('(editado)'), 'con el cambio nuevo');
  ok(t.puts.length === 1, 'los audios que ya tienen copia no se vuelven a convertir');
  ok(t.descargas === 0, 'sin descargar nada');

  // Dejar de compartir
  page.once('dialog', (d) => d.accept());
  await page.click('#ecoEditorialShareStop');
  await page.waitForSelector('#ecoEditorialShare', { state: 'hidden' });
  ok(t.deletes === 1, 'dejar de compartir retira el enlace y esconde el cuadro');
  const antes = t.posts.length;
  await page.locator('[data-sec="ch-1"] h2').fill('Infancia más');
  await page.waitForTimeout(7500);
  ok(t.posts.length === antes, 'sin enlace, los cambios ya no lo vuelven a crear');
  // Al volver a abrir el libro con un enlace ya activo: se ve el enlace y el botón no rearma nada
  t.activo = true;
  await page.reload();
  await page.waitForFunction(() => /sincronizado/.test((document.getElementById('ecoEditorialStatus') || {}).textContent || ''));
  await page.waitForSelector('#ecoEditorialShare:not([hidden])');
  const postsRecarga = t.posts.length;
  await page.click('#ecoEditorialDigital');
  await page.waitForTimeout(800);
  ok(t.posts.length === postsRecarga && await page.locator('#ecoDemoPay').isHidden(), 'al volver otro día: el botón muestra el enlace sin pantalla de pago ni rearmar el libro');
  ok(t.errores.length === 0, 'sin errores en la página' + (t.errores.length ? ': ' + t.errores.join(' | ') : ''));

  await browser.close(); server.close();
  console.log(fallos ? '\nHubo fallos.' : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
