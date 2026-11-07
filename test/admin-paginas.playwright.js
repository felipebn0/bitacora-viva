// Panel de consumo: los perfiles con gasto 0 en el período no se muestran, y si hay más de 10 se pasa de página.
//   node test/admin-paginas.playwright.js   (o: npm run test:admin-paginas)
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright: corre "npm install".'); process.exit(1); }
let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };

const perfil = (id, gasto) => ({
  id, nombre: 'Persona ' + String(id).padStart(2, '0'), email: 'p' + id + '@x.co', username: 'p' + id, isAdmin: false, tipo: 'cuenta', relacion: null, archivado: false, duenoNombre: null, createdAt: '2026-11-01T00:00:00Z',
  claude: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, calls: 1, costUsd: gasto, inputTokensRange: 1, outputTokensRange: 1, callsRange: 1, costUsdRange: gasto, costUsdPrevRange: 0 },
  elevenlabsTts: { characters: 0, costUsd: 0, charactersRange: 0, costUsdRange: 0, costUsdPrevRange: 0 },
  elevenlabsStt: { seconds: 0, calls: 0, costUsd: 0, secondsRange: 0, callsRange: 0, costUsdRange: 0, costUsdPrevRange: 0 },
  azureTts: { characters: 0 },
  db: { totalBytes: 10, textBytes: 10, audioBytes: 0, audioCount: 0, fotoBytes: 0, fotoCount: 0, videoBytes: 0, videoCount: 0, totalFiles: 0, mediaFiles: 0, sessionsCount: 1 },
  totalCostUsd: gasto, totalCostUsdRange: gasto, totalCostUsdPrevRange: 0,
});
// 23 con gasto (de 0.23 a 0.01) y 5 con gasto 0
const perfiles = [...Array.from({ length: 23 }, (_, i) => perfil(i + 1, (23 - i) / 100)), ...Array.from({ length: 5 }, (_, i) => perfil(100 + i, 0))];

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url());
    const json = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/me') return json({ isAdmin: true });
    if (u.pathname === '/api/admin/usage') {
      return json({ generatedAt: new Date().toISOString(), range: { start: '2026-11-07T05:00:00.000Z', end: '2026-11-08T04:59:59.999Z' }, pricing: { alertThresholdUsd: null, anthropicInputPer1M: 1, anthropicOutputPer1M: 5, elevenTtsPer1kChars: 0.1, elevenSttPerHour: 0.22 }, kindBreakdown: [], totalHistoricoUsd: 99.5, profiles: perfiles });
    }
    return json({});
  });
  await page.goto(base + '/admin.html');
  await page.waitForSelector('#usageTable tbody tr');

  const filas = () => page.locator('#usageTable tbody tr').count();
  const nombres = () => page.locator('#usageTable tbody .name').allTextContents();
  ok(await filas() === 10, 'la primera página muestra 10 perfiles');
  ok(!(await nombres()).some((n) => /Persona 10[0-4]/.test(n)), 'los perfiles con gasto 0 no aparecen');
  ok(/Mostrando 1–10 de 23 perfiles con gasto/.test(await page.textContent('#paginacion')), 'dice cuántos perfiles con gasto hay en total (23, sin los de gasto 0)');
  ok(!(await page.locator('#pagAnterior').count()) && await page.locator('#pagSiguiente').count() === 1, 'en la primera página solo está «Ir a página 2»');
  ok(/Ir a página 2/.test(await page.textContent('#pagSiguiente')), 'el botón dice «Ir a página 2»');
  ok(/\$99\.5/.test(await page.textContent('body')) || /99[.,]5/.test(await page.textContent('body')), 'el total histórico sale del servidor (99.5), no solo de los perfiles listados');

  await page.click('#pagSiguiente');
  ok(await filas() === 10 && (await nombres())[0].includes('Persona 11'), 'la página 2 muestra los siguientes 10');
  ok(await page.locator('#pagAnterior').count() === 1 && /Ir a página 3/.test(await page.textContent('#pagSiguiente')), 'en la página 2 hay «Página anterior» y «Ir a página 3»');
  await page.click('#pagSiguiente');
  ok(await filas() === 3 && /Mostrando 21–23 de 23/.test(await page.textContent('#paginacion')), 'la página 3 muestra los 3 que quedan');
  ok(await page.locator('#pagSiguiente').count() === 0, 'en la última página ya no hay «Ir a página»');
  await page.click('#pagAnterior');
  ok(await filas() === 10, 'se puede volver a la página anterior');

  await page.click('th.sortable[data-key="perfil"]');
  ok(/Mostrando 1–10/.test(await page.textContent('#paginacion')), 'al cambiar el orden se vuelve a la página 1');
  ok(errores.length === 0, 'sin errores de JavaScript' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
