// Cuando sale el popup de ayuda, Eco termina de hablar y se queda sin escuchar hasta que la persona toque
// «Seguir hablando con Eco». También avisa a los admins una sola vez.
//
//   node test/crisis-pausa.playwright.js   (o: npm run test:crisis-pausa)
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
  class AudioFalso {
    constructor() { this.onended = null; this.onerror = null; this.paused = true; this._t = null; }
    set src(v) { this._src = v; }
    get src() { return this._src; }
    play() {
      this.paused = false;
      clearTimeout(this._t);
      this._t = setTimeout(() => { this.paused = true; if (this.onended) this.onended(); }, window.__audioMs);
      return Promise.resolve();
    }
    pause() { this.paused = true; clearTimeout(this._t); }
    load() {}
  }
  window.Audio = AudioFalso;
  window.__microsPedidos = 0;
  navigator.mediaDevices = navigator.mediaDevices || {};
  navigator.mediaDevices.getUserMedia = async () => { window.__microsPedidos += 1; return { active: true, getTracks: () => [{ stop() {} }] }; };
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
};

const estado = (page, e, ms = 15000) => page.waitForFunction((x) => document.getElementById('orb').dataset.state === x, e, { timeout: ms });

async function pruebaApp(browser, base) {
  console.log('\n--- app.html ---');
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await context.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.addInitScript(fakes);
  const avisos = [];
  let turnos = 0;
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url());
    const json = (o) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/me') return json({ isCollaborator: false, username: 'tester', name: 'Tester', email: 't@example.com', fechaNacimiento: null });
    if (u.pathname === '/api/tree/pending') return json({ names: [] });
    if (u.pathname === '/api/next') {
      turnos += 1;
      return json(turnos === 2 ? { message: 'No estás sola. Te dejé unos números en la pantalla.', ayuda: 'suicide' } : { message: 'Pregunta ' + turnos });
    }
    if (u.pathname === '/api/crisis-aviso') { avisos.push(route.request().postDataJSON()); return json({ ok: true }); }
    if (u.pathname === '/api/speak') return route.fulfill({ contentType: 'audio/wav', body: SILENT_WAV });
    if (u.pathname === '/api/transcribe') return json({ text: 'algo que conté' });
    if (u.pathname === '/api/save') return json({ sessionDbId: 1 });
    return json({});
  });
  await page.goto(base + '/app.html');
  await page.waitForSelector('#orb', { state: 'visible' });
  await page.click('#orb');
  await estado(page, 'listening');
  await page.waitForTimeout(1300);
  await page.click('#orb'); // pausa -> se guarda la respuesta y al seguir Eco pide el turno 2
  await estado(page, 'paused');
  await page.click('#orb');
  await page.waitForSelector('.eco-crisis-banner', { timeout: 15000 });
  await estado(page, 'paused');
  ok(true, 'sale el popup de ayuda y la charla queda en pausa en vez de escuchar');
  await dormir(1200);
  ok(await page.evaluate(() => document.getElementById('orb').dataset.state) === 'paused', 'sigue en pausa pasado un rato (no escucha sola)');
  ok(avisos.length === 1 && avisos[0].tipo === 'suicide', 'se avisó a los admins una sola vez, con el tipo');

  await page.click('#orb', { force: true });
  await dormir(500);
  ok(await page.evaluate(() => document.getElementById('orb').dataset.state) === 'paused', 'con el popup abierto, tocar el círculo no hace que escuche');

  await page.click('.eco-crisis-close');
  await dormir(500);
  ok(await page.evaluate(() => document.getElementById('orb').dataset.state) === 'paused', 'cerrar el popup con la X no hace que escuche');

  await page.evaluate(() => { document.dispatchEvent(new CustomEvent('eco:crisis-chat')); });
  await estado(page, 'listening');
  ok(true, 'al tocar «Seguir hablando con Eco» vuelve a escuchar');

  ok(errores.length === 0, 'sin errores en la página' + (errores.length ? ': ' + errores[0] : ''));
  await context.close();

  console.log('\n--- app.html: la persona lo dice y la IA no pone la marca ---');
  const ctx2 = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const p2 = await ctx2.newPage();
  await p2.addInitScript(fakes);
  const avisos2 = [];
  let turnos2 = 0;
  await p2.route('**/api/**', async (route) => {
    const u = new URL(route.request().url());
    const json = (o) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/me') return json({ isCollaborator: false, username: 'tester', name: 'Tester', email: 't@example.com', fechaNacimiento: null });
    if (u.pathname === '/api/tree/pending') return json({ names: [] });
    if (u.pathname === '/api/next') { turnos2 += 1; return json({ message: 'Pregunta ' + turnos2 }); }
    if (u.pathname === '/api/crisis-aviso') { avisos2.push(route.request().postDataJSON()); return json({ ok: true }); }
    if (u.pathname === '/api/speak') return route.fulfill({ contentType: 'audio/wav', body: SILENT_WAV });
    if (u.pathname === '/api/transcribe') return json({ text: 'ya no aguanto más, me quiero morir' });
    if (u.pathname === '/api/save') return json({ sessionDbId: 1 });
    return json({});
  });
  await p2.goto(base + '/app.html');
  await p2.waitForSelector('#orb', { state: 'visible' });
  await p2.click('#orb');
  await estado(p2, 'listening');
  await p2.waitForTimeout(1300);
  await p2.click('#orb');
  await p2.waitForSelector('.eco-crisis-banner', { timeout: 15000 });
  await estado(p2, 'paused');
  ok(true, 'sale el popup solo por lo que dijo la persona y la charla queda en pausa');
  await dormir(1200);
  ok(await p2.evaluate(() => document.getElementById('orb').dataset.state) === 'paused', 'no vuelve a escuchar sola');
  ok(avisos2.length === 1 && avisos2[0].tipo === 'suicide', 'se avisó a los admins');
  await p2.evaluate(() => { document.dispatchEvent(new CustomEvent('eco:crisis-chat')); });
  await p2.waitForFunction(() => document.getElementById('orb').dataset.state !== 'paused', null, { timeout: 15000 });
  ok(true, 'con «Seguir hablando con Eco» la charla continúa');
  await ctx2.close();
}

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  try {
    await pruebaApp(browser, base);
  } catch (err) {
    fallos++;
    console.error('✗ error inesperado:', err && err.stack ? err.stack : err);
  } finally {
    await browser.close(); server.close();
  }
  console.log(fallos ? '\nHubo fallos.' : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
