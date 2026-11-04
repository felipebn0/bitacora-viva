// Botón «Fin» solo mientras la charla sigue en curso; salir de la pantalla a mitad de charla pausa sin trabar la app;
// solo el árbol puede girar (en el resto, en horizontal sale el aviso de girar el celular).
//
//   node test/salir-pantalla.playwright.js   (o: npm run test:salir-pantalla)
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright: corre "npm install".'); process.exit(1); }
let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const SILENT_WAV = Buffer.from('UklGRigAAABXQVZFZm10IBIAAAABAAEAQB8AAEAfAAABAAgAAABkYXRhAAAAAA==', 'base64');

const fakes = () => {
  window.__audioMs = 5;
  window.__audiosIniciados = 0;
  class AudioFalso {
    constructor() { this.onended = null; this.onerror = null; this.paused = true; this._t = null; }
    set src(v) { this._src = v; }
    get src() { return this._src; }
    play() {
      this.paused = false;
      window.__audiosIniciados += 1;
      clearTimeout(this._t);
      this._t = setTimeout(() => { this.paused = true; if (this.onended) this.onended(); }, window.__audioMs);
      return Promise.resolve();
    }
    pause() { this.paused = true; clearTimeout(this._t); }
    load() {}
  }
  window.Audio = AudioFalso;
  navigator.mediaDevices = navigator.mediaDevices || {};
  navigator.mediaDevices.getUserMedia = async () => ({ active: true, getTracks: () => [{ stop() {} }] });
  class GrabadorFalso {
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; this.ondataavailable = null; this.onstop = null; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; if (this.ondataavailable) this.ondataavailable({ data: new Blob([new Uint8Array(2000)], { type: this.mimeType }) }); if (this.onstop) this.onstop(); }
  }
  window.MediaRecorder = GrabadorFalso;
  class AnalizadorFalso {
    constructor() { this.fftSize = 512; this.frequencyBinCount = 256; }
    getByteTimeDomainData(a) { a.fill(128); }
    getFloatFrequencyData(a) { a.fill(-120); }
  }
  class ContextoFalso {
    constructor() { this.state = 'running'; this.sampleRate = 48000; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return new AnalizadorFalso(); }
    resume() {} close() {}
  }
  window.AudioContext = ContextoFalso;
  window.webkitAudioContext = ContextoFalso;
  window.__salir = (oculto) => {
    Object.defineProperty(document, 'visibilityState', { value: oculto ? 'hidden' : 'visible', configurable: true });
    Object.defineProperty(document, 'hidden', { value: !!oculto, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  };
};

async function paginaApp(browser, base, { next }) {
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await context.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.addInitScript(fakes);
  const llamadas = { next: 0 };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const json = (o) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/me') return json({ isCollaborator: false, username: 'tester', name: 'Tester', email: 't@example.com', fechaNacimiento: null });
    if (u.pathname === '/api/tree/pending') return json({ names: [] });
    if (u.pathname === '/api/next') { llamadas.next += 1; return next(route, llamadas.next, json); }
    if (u.pathname === '/api/speak') return route.fulfill({ contentType: 'audio/wav', body: SILENT_WAV });
    if (u.pathname === '/api/transcribe') return json({ text: 'algo que conté' });
    if (u.pathname === '/api/save') return json({ sessionDbId: 1 });
    return json({});
  });
  await page.goto(base + '/app.html');
  await page.waitForSelector('#orb', { state: 'visible' });
  return { context, page, llamadas, errores };
}
const estado = (page, e, ms = 15000) => page.waitForFunction((x) => document.getElementById('orb').dataset.state === x, e, { timeout: ms });
const finVisible = (page) => page.evaluate(() => getComputedStyle(document.getElementById('endBtn')).display !== 'none');
const salir = (page, oculto) => page.evaluate((o) => window.__salir(o), oculto);

async function pruebasApp(browser, base) {
  console.log('\n--- app.html: botón «Fin» ---');
  {
    const { context, page } = await paginaApp(browser, base, { next: (route, n, json) => json({ message: 'Pregunta ' + n }) });
    ok(!(await finVisible(page)), 'antes de empezar el botón no está');
    await page.click('#orb');
    await estado(page, 'listening');
    ok(await finVisible(page), 'mientras la charla sigue, el botón está');
    await page.click('#orb');
    await estado(page, 'paused');
    ok(!(await finVisible(page)), 'al pausar el botón desaparece');
    await page.click('#orb');
    await estado(page, 'listening');
    ok(await finVisible(page), 'al seguir la charla vuelve');
    await context.close();
  }
  {
    const { context, page } = await paginaApp(browser, base, { next: (route, n, json) => json(n === 1 ? { message: 'Pregunta 1' } : { message: 'Listo, hasta pronto.', done: true }) });
    await page.click('#orb');
    await estado(page, 'listening');
    await page.evaluate(() => { window.__audioMs = 2500; });
    await page.click('#orb');
    await estado(page, 'paused');
    await page.click('#orb');
    await estado(page, 'speaking');
    await dormir(300);
    ok(!(await finVisible(page)), 'mientras Eco da el cierre por su cuenta, el botón no está');
    await estado(page, 'ended', 20000);
    ok(!(await finVisible(page)), 'terminada la charla, el botón sigue sin estar');
    await context.close();
  }

  console.log('\n--- app.html: salir de la pantalla ---');
  {
    const { context, page, llamadas, errores } = await paginaApp(browser, base, { next: (route, n, json) => json({ message: 'Pregunta ' + n }) });
    await page.click('#orb');
    await estado(page, 'listening');
    await salir(page, true);
    await estado(page, 'paused');
    ok(true, 'salir mientras escucha deja la charla en pausa');
    ok(!(await finVisible(page)), 'y sin botón «Fin»');
    await salir(page, false);
    await page.click('#orb');
    await estado(page, 'listening');
    ok(llamadas.next >= 2, 'al volver y tocar el orbe la charla sigue (' + llamadas.next + ' pedidos)');
    ok(!errores.length, 'sin errores en la página (' + errores.join(' | ') + ')');
    await context.close();
  }
  {
    let liberar;
    const lenta = new Promise((r) => { liberar = r; });
    const { context, page, errores } = await paginaApp(browser, base, {
      next: async (route, n, json) => { if (n === 2) await lenta; return json({ message: 'Pregunta ' + n }); },
    });
    await page.click('#orb');
    await estado(page, 'listening');
    await page.click('#orb');
    await estado(page, 'paused');
    await page.click('#orb');
    await estado(page, 'thinking');
    await salir(page, true);
    await estado(page, 'paused');
    liberar();
    await dormir(600);
    ok(await page.evaluate(() => document.getElementById('orb').dataset.state) === 'paused', 'salir mientras Eco piensa: la respuesta que llega tarde no la hace hablar a escondidas');
    await salir(page, false);
    await page.click('#orb');
    await estado(page, 'listening');
    ok(!errores.length, 'al volver se puede seguir sin errores (' + errores.join(' | ') + ')');
    await context.close();
  }
  {
    const { context, page, errores } = await paginaApp(browser, base, { next: (route, n, json) => json({ message: 'Pregunta ' + n }) });
    await page.evaluate(() => { window.__audioMs = 60000; });
    await page.click('#orb');
    await estado(page, 'speaking');
    await salir(page, true);
    await estado(page, 'paused');
    ok(true, 'salir mientras Eco habla deja la charla en pausa');
    await page.evaluate(() => { window.__audioMs = 5; });
    await salir(page, false);
    await page.click('#orb');
    await estado(page, 'listening');
    ok(!errores.length, 'al volver Eco retoma y vuelve a escuchar sin errores (' + errores.join(' | ') + ')');
    await context.close();
  }
}

async function pruebasColaborar(browser, base) {
  console.log('\n--- colaborar.html: salir de la pantalla ---');
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await context.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.addInitScript(() => {
    try { localStorage.setItem('eco_tour_done__colaborar_html', '1'); } catch (e) { /* nada */ }
  });
  await page.addInitScript(fakes);
  const turnos = [];
  let speaks = 0;
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const json = (o) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/me') return json({ username: 'felipe', name: 'Felipe', isCollaborator: false, isGuest: false });
    if (u.pathname === '/api/my-collaborations') return json({ historias: [{ ownerId: 7, ownerName: 'Diego Vargas', soloHistorial: false }] });
    if (u.pathname === '/api/collaboration-info') return json({ ownerName: 'Diego Vargas' });
    if (u.pathname === '/api/contribute-audio') return json({ url: 'https://x.test/a.webm' });
    if (u.pathname === '/api/transcribe') return json({ text: 'sí, claro' });
    if (u.pathname === '/api/speak') { speaks += 1; return route.fulfill({ contentType: 'audio/wav', body: SILENT_WAV }); }
    if (u.pathname === '/api/contribute-chat') { turnos.push(req.postDataJSON()); await dormir(turnos.length === 2 ? 800 : 0); return json({ message: 'Cuéntame más ' + turnos.length, done: false }); }
    return json({});
  });
  await page.goto(base + '/colaborar.html');
  await page.waitForFunction(() => document.getElementById('orb').dataset.state === 'idle');
  const est = (e, ms = 15000) => page.waitForFunction((x) => document.getElementById('orb').dataset.state === x, e, { timeout: ms });

  await page.click('#orb');
  await est('listening');
  await dormir(1300);
  await salir(page, true);
  await page.waitForFunction(() => document.getElementById('aporteMsg') !== null && document.getElementById('recStatus').textContent.includes('pausa'), null, { timeout: 10000 });
  await dormir(300);
  const hablasAntes = speaks;
  ok(await page.evaluate(() => document.getElementById('orb').dataset.state) === 'idle', 'salir mientras graba: se procesa lo dicho y el orbe queda quieto, sin volver a grabar a escondidas');
  ok(turnos.length >= 2, 'lo grabado se mandó a procesar (' + turnos.length + ' turnos)');
  ok(/pausa/i.test(await page.textContent('#recStatus')), 'avisa que está en pausa');
  await salir(page, false);
  await page.click('#orb');
  await est('listening');
  ok(true, 'al volver, tocar el orbe sigue la charla');

  await dormir(1300);
  await page.evaluate(() => { window.__audioMs = 60000; });
  await page.click('#orb');
  await est('speaking');
  await salir(page, true);
  await est('idle', 5000);
  ok(true, 'salir mientras Eco habla no deja el orbe trabado en «···»');
  await page.evaluate(() => { window.__audioMs = 5; });
  await salir(page, false);
  await page.click('#orb');
  await est('listening');
  ok(speaks >= hablasAntes, 'se puede seguir contando después');
  ok(!errores.length, 'sin errores en la página (' + errores.join(' | ') + ')');
  await context.close();
}

async function pruebasOrientacion(browser, base) {
  console.log('\n--- orientación ---');
  const abrir = async (ancho, alto, pagina) => {
    const context = await browser.newContext({ viewport: { width: ancho, height: alto }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.route('**/api/**', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
    await page.goto(base + pagina);
    await dormir(400);
    const visible = await page.evaluate(() => { const a = document.querySelector('.eco-gira'); return !!a && !a.hidden && getComputedStyle(a).display !== 'none'; });
    await context.close();
    return visible;
  };
  ok(!(await abrir(390, 800, '/app.html')), 'en vertical no sale ningún aviso');
  ok(await abrir(800, 390, '/app.html'), 'en horizontal, la charla pide girar el celular');
  ok(await abrir(800, 390, '/colaborar.html'), 'en horizontal, colaborar pide girar el celular');
  ok(await abrir(800, 390, '/capitulos.html'), 'en horizontal, el libro pide girar el celular');
  ok(!(await abrir(800, 390, '/arbol.html')), 'el árbol sí puede verse en horizontal, sin aviso');
}

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  try {
    await pruebasApp(browser, base);
    await pruebasColaborar(browser, base);
    await pruebasOrientacion(browser, base);
  } catch (err) {
    fallos++;
    console.error('✗ error inesperado:', err && err.stack ? err.stack : err);
  } finally {
    await browser.close(); server.close();
  }
  console.log(fallos ? '\nHubo fallos.' : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
