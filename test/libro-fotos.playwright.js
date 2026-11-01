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
// Audio de 3 segundos (WAV de 8 kHz) para comprobar que la duración se ve sin darle play.
const WAV = (() => { const n = 8000 * 3, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); return b; })();
const parrafos = Array.from({ length: 6 }, (_, i) => `Párrafo ${i + 1}. Era una tarde de lluvia en la casa de mis abuelos y todos nos reunimos alrededor de la mesa a contar historias de cuando éramos pequeños.`).join('\n\n');
const capitulos = [
  { id: 1, title: 'Infancia', theme: 'infancia', generated_text: 'Texto original.', story_ids: [1], audios: ['https://x.test/a1.wav', 'https://x.test/a2.wav'], preguntas: ['¿Cómo era la casa donde creciste?', null], created_at: new Date().toISOString() },
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
    if (u.pathname === '/api/media-file') return /\.wav/.test(u.searchParams.get('u') || '') ? r.fulfill({ status: 200, contentType: 'audio/wav', body: WAV }) : r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (u.pathname.startsWith('/api/book-qr/image/')) return r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' });
    if (u.pathname === '/api/chapters') return json({ chapters: capitulos });
    if (u.pathname === '/api/story-log') return json({ stories: [{ id: 1, texto: 'x', media_urls: [{ url: FOTO, type: 'foto', caption: 'En el río' }], created_at: new Date().toISOString() }, { id: 2, texto: 'y', created_at: new Date().toISOString() }] });
    if (u.pathname === '/api/book-editor/draft' && m === 'PUT') { borrador = JSON.parse(r.request().postData()).book; version++; return json({ ok: true, version }); }
    if (u.pathname === '/api/book-editor/draft') return json({ book: borrador, version });
    return json({});
  });
  await page.goto(base + '/capitulos.html');

  // 1) El libro sigue lo diseñado: orden y títulos
  await page.waitForFunction(() => /sincronizado|Guardado en tu cuenta/.test(document.getElementById('ecoEditorialStatus').textContent));
  const titulos = await page.locator('#ecoEditorialOutline .eco-outline-t').allTextContents();
  ok(titulos.join('|') === 'El trabajo|La casa de siempre', 'el libro sigue el orden y los títulos del libro diseñado (' + titulos.join(' | ') + ')');
  ok(await page.locator('[data-sec="ch-1"] p.eco-editorial-paragraph').count() === 6 && /Párrafo 1/.test(await page.locator('[data-sec="ch-1"] p.eco-editorial-paragraph').first().textContent()), 'y el texto que se editó, en sus párrafos');

  // 2) El estudio: el libro se edita directamente; las fotos y el QR de cada capítulo están debajo del texto
  const pdf = await (async () => { await page.emulateMedia({ media: 'print' }); const b = await page.pdf({ preferCSSPageSize: true }); await page.emulateMedia({ media: 'screen' }); return b.toString('latin1'); })();
  const caja = pdf.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  ok(caja && Math.abs(caja[1] - 595.28) < 1.5 && Math.abs(caja[2] - 841.89) < 1.5, 'el libro siempre se imprime en hoja A4 (' + (caja ? caja[1] + ' x ' + caja[2] + ' pt' : 'sin medida') + ')');
  await page.click('[data-sec="ch-1"] .eco-editorial-tools > summary');
  await page.waitForSelector('[data-sec="ch-1"] .eco-editorial-photo-config');
  ok(await page.locator('[data-sec="ch-1"] .eco-editorial-photo-fields select').count() === 0, 'por cada foto ya no hay opciones de tamaño ni de posición');
  ok(await page.locator('[data-sec="ch-1"] .eco-editorial-photo-fields input[type=checkbox]').count() === 1 && await page.locator('[data-sec="ch-1"] .eco-editorial-photo-fields input:not([type=checkbox])').count() === 1, 'solo queda "Incluir" y el pie de foto');
  ok(!/Volver a comprobar/.test(await page.textContent('[data-sec="ch-1"] .eco-editorial-tools')) && await page.locator('[data-sec="ch-1"] .eco-editorial-makeqr').count() === 0, 'ya no existe "Volver a comprobar el QR" (con QR no hay botón de crear)');
  ok(await page.locator('[data-sec="ch-1"] .eco-editorial-revokeqr').count() === 1 && await page.locator('[data-sec="ch-1"] .eco-editorial-qr-link').count() === 1, 'quedan "Probar enlace" y "Retirar el enlace"');
  await page.fill('[data-sec="ch-1"] .eco-editorial-photo-fields input:not([type=checkbox])', 'En la finca, 1985');
  await page.press('[data-sec="ch-1"] .eco-editorial-photo-fields input:not([type=checkbox])', 'Tab');
  await page.waitForSelector('#ecoEditorialBook [data-sec="ch-1"] .eco-foto-flota');
  const libro = await page.evaluate(() => { const pag = document.querySelector('#ecoEditorialBook [data-sec="ch-1"]'); const f = pag.querySelector('figure'); return { pie: f.querySelector('figcaption').textContent, antesDelPrimerParrafo: f.compareDocumentPosition(pag.querySelector('p.eco-editorial-paragraph')) & Node.DOCUMENT_POSITION_FOLLOWING, flota: getComputedStyle(f).float }; });
  ok(libro.pie === 'En la finca, 1985' && libro.antesDelPrimerParrafo && libro.flota === 'right', 'en el libro la foto va arriba a la derecha con el pie que se editó');
  if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, 'libro-vista.png') });
  await page.uncheck('[data-sec="ch-1"] .eco-editorial-photo-fields input[type=checkbox]');
  await page.waitForFunction(() => !document.querySelector('#ecoEditorialBook .eco-foto-flota'));
  ok(await page.locator('#ecoEditorialBook .eco-foto-flota').count() === 0, 'si se quita la foto con "Incluir", desaparece del libro');
  await page.check('[data-sec="ch-1"] .eco-editorial-photo-fields input[type=checkbox]');
  await page.waitForSelector('#ecoEditorialBook .eco-foto-flota');

  // 3) Lo diseñado vuelve a verse al recargar la página
  const t0 = Date.now(); while (!(borrador.media && borrador.media['1'] && borrador.media['1'][FOTO] && borrador.media['1'][FOTO].caption === 'En la finca, 1985' && borrador.media['1'][FOTO].pos === '0') && Date.now() - t0 < 6000) await page.waitForTimeout(100);
  await page.reload();
  await page.waitForSelector('#ecoEditorialBook [data-sec="ch-1"] figure');
  ok((await page.textContent('#ecoEditorialBook [data-sec="ch-1"] figcaption')) === 'En la finca, 1985', 'al volver al libro se ve la foto con lo que se diseñó');
  const audio = await page.evaluate(async () => { document.querySelector('[data-sec="ch-1"] .eco-editorial-tools > summary').click(); const a = [...document.querySelectorAll('[data-sec="ch-1"] .eco-editorial-tools audio')]; await new Promise((r) => setTimeout(r, 800)); return { n: a.length, preguntas: [...document.querySelectorAll('[data-sec="ch-1"] .eco-editorial-pregunta')].map((x) => x.textContent), duraciones: a.map((x) => Math.round(x.duration)) }; });
  ok(audio.n === 2 && audio.preguntas.join('|') === '¿Cómo era la casa donde creciste?' && audio.duraciones.every((d) => d === 3), 'las notas de voz originales se oyen desde el capítulo, con su pregunta y su duración (0:03) sin darles play');
  ok(errores.length === 0, 'sin errores de JavaScript' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close();
  server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
