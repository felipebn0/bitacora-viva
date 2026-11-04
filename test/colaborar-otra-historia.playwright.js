// Al terminar de aportar una historia (colaborar.html), el orbe se queda a la vista con el aviso de que se puede tocar
// para añadir otra historia, y tocarlo empieza una charla nueva.
//
//   node test/colaborar-otra-historia.playwright.js
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright: corre "npm install".'); process.exit(1); }
let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const page = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.addInitScript(() => {
    try { localStorage.setItem('eco_tour_done__colaborar_html', '1'); } catch (e) { /* nada */ }
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
  });
  const turnos = [];
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/me') return json({ username: 'felipe', name: 'Felipe', isCollaborator: false, isGuest: false });
    if (u.pathname === '/api/my-collaborations') return json({ historias: [{ ownerId: 7, ownerName: 'Diego Vargas', soloHistorial: false }] });
    if (u.pathname === '/api/collaboration-info') return json({ ownerName: 'Diego Vargas' });
    if (u.pathname === '/api/contribute-chat') {
      turnos.push(req.postDataJSON());
      const n = turnos.length;
      if (n === 2) return json({ message: 'Gracias por contármelo. Tu historia quedó guardada.', done: true, saved: true });
      return json({ message: n === 1 ? 'Cuéntame un recuerdo de Diego.' : 'Claro, cuéntame otra historia.', done: false });
    }
    if (u.pathname === '/api/speak') return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    return json({});
  });

  await page.goto(base + '/colaborar.html');
  await page.waitForSelector('#writeInputColab', { state: 'visible' });
  await page.fill('#writeInputColab', 'No tengo nada más para contar');
  await page.click('#writeSendColab');
  await page.waitForFunction(() => /guardada/.test(document.getElementById('aporteMsg').textContent), null, { timeout: 10000 });

  const orbe = () => page.evaluate(() => { const o = document.getElementById('orb'); const r = o.getBoundingClientRect(); return { visible: getComputedStyle(o).display !== 'none' && r.width > 0, texto: o.textContent.replace(/\s+/g, ' ').trim(), desactivado: o.disabled, estado: o.dataset.state }; });
  const o = await orbe();
  ok(o.visible, 'al terminar la historia el orbe sigue a la vista');
  ok(!o.desactivado && /otra historia/.test(o.texto), 'dice que se puede tocar para otra historia (' + o.texto + ')');
  ok(/toca el círculo/i.test(await page.textContent('#aporteMsg')), 'el mensaje avisa que se toca el círculo para añadir otra historia');

  if (process.env.CAPTURA) await page.screenshot({ path: process.env.CAPTURA });
  await page.click('#orb');
  await page.waitForFunction(() => document.getElementById('aporteMsg').textContent === '', null, { timeout: 10000 });
  ok(turnos.length === 3 && turnos[2].history.length === 0, 'tocar el orbe empieza una charla nueva (sin lo anterior)');
  const despues = await orbe();
  ok(despues.visible && !/otra historia/.test(despues.texto), 'y el orbe vuelve a su texto normal (' + despues.texto + ')');
  ok(!errores.length, 'sin errores en la página (' + errores.join(' | ') + ')');

  await browser.close(); server.close();
  console.log(fallos ? '\nHubo fallos.' : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
