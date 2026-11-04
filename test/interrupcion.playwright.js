// Interrumpir a Eco hablando (app.html): si la persona retoma la palabra mientras Eco piensa o habla, Eco se calla, su
// respuesta se descarta y lo nuevo llega como otro mensaje a continuación del anterior. Un ruido (ventilador, tos corta)
// no interrumpe. Si Eco se calla por una falsa alarma y no llega nada, vuelve a responder lo de antes.
//
// Como pause-resume.playwright.js: las llamadas a /api/* se interceptan y el micrófono, el audio y el analizador se
// fingen. Aquí el "micrófono" lo maneja el test con window.__mic = { rms, voz }.
//
//   node test/interrupcion.playwright.js   (o: npm run test:interrupcion)
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright — correr "npm install" primero.'); process.exit(1); }

const SILENT_WAV = Buffer.from('UklGRigAAABXQVZFZm10IBIAAAABAAEAQB8AAEAfAAABAAgAAABkYXRhAAAAAA==', 'base64');
let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function preparar(browser, base, { demoraRespuesta = 0 } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
  await page.addInitScript(() => {
    window.__mic = { rms: 0.005, voz: false };
    window.__duracionAudio = 5;
    class AudioFalso {
      constructor() { this._src = ''; this.onended = null; this.onerror = null; this.paused = true; this.ended = false; this.currentTime = 0; this.duration = 1; this._t = null; }
      set src(v) { this._src = v; }
      get src() { return this._src; }
      play() {
        this.paused = false; this.ended = false; this.currentTime = 0.1;
        clearTimeout(this._t);
        this._t = setTimeout(() => { this.paused = true; this.ended = true; if (this.onended) this.onended(); }, window.__duracionAudio);
        return Promise.resolve();
      }
      pause() { this.paused = true; clearTimeout(this._t); }
      load() {}
    }
    window.Audio = AudioFalso;
    navigator.mediaDevices = navigator.mediaDevices || {};
    navigator.mediaDevices.getUserMedia = async () => ({ active: true, getTracks: () => [{ stop() {} }] });
    class GrabadorFalso {
      constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; this.ondataavailable = null; this.onstop = null; this._l = {}; }
      addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
      removeEventListener(t, f) { this._l[t] = (this._l[t] || []).filter((x) => x !== f); }
      start() { this.state = 'recording'; }
      requestData() { const e = { data: new Blob([new Uint8Array(2000)], { type: this.mimeType }) }; if (this.ondataavailable) this.ondataavailable(e); (this._l.dataavailable || []).slice().forEach((f) => f(e)); }
      stop() { this.state = 'inactive'; this.requestData(); if (this.onstop) this.onstop(); }
    }
    window.MediaRecorder = GrabadorFalso;
    class AnalizadorFalso {
      constructor() { this._fft = 512; }
      set fftSize(v) { this._fft = v; }
      get fftSize() { return this._fft; }
      get frequencyBinCount() { return this._fft / 2; }
      getByteTimeDomainData(a) { const n = Math.round(window.__mic.rms * 128); for (let i = 0; i < a.length; i++) a[i] = 128 + (i % 2 ? -n : n); }
      getFloatFrequencyData(a) {
        const ancho = 48000 / this._fft;
        for (let i = 0; i < a.length; i++) { const f = i * ancho; a[i] = window.__mic.voz ? (f >= 300 && f <= 3000 ? -30 : -100) : (f < 200 ? -30 : -100); }
      }
    }
    class ContextoFalso {
      constructor() { this.state = 'running'; this.sampleRate = 48000; }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createAnalyser() { return new AnalizadorFalso(); }
      resume() { return Promise.resolve(); }
      close() {}
    }
    window.AudioContext = ContextoFalso;
    window.webkitAudioContext = ContextoFalso;
  });

  const estado = { texto: 'Parte A' };
  const llamadas = [];
  await page.route('**/api/me', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ isCollaborator: false, username: 'tester', name: 'Tester', email: 't@example.com', fechaNacimiento: null }) }));
  await page.route('**/api/tree/pending', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ names: [] }) }));
  await page.route('**/api/next', async (r) => {
    const cuerpo = r.request().postDataJSON();
    if (cuerpo.especulativo) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ noEspeculable: true }) });
    llamadas.push(cuerpo);
    const n = llamadas.length;
    if (n > 1 && demoraRespuesta) await dormir(demoraRespuesta);
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ message: n === 1 ? 'Pregunta 1' : 'Respuesta de Eco ' + n }) }).catch(() => {});
  });
  await page.route('**/api/speak', (r) => r.fulfill({ contentType: 'audio/wav', body: SILENT_WAV }));
  await page.route('**/api/transcribe', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ text: estado.texto }) }));
  await page.route('**/api/save', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ sessionDbId: 1 }) }));
  await page.route('**/api/story-log/audio', (r) => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route('**/api/save-audio**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ file: 'audio/x.webm' }) }));

  await page.goto(base + '/app.html');
  await page.waitForSelector('#orb', { state: 'visible' });
  const estadoOrbe = () => page.evaluate(() => document.getElementById('orb').dataset.state);
  const esperar = (e, ms = 15000) => page.waitForFunction((x) => document.getElementById('orb').dataset.state === x, e, { timeout: ms });
  const mic = (rms, voz) => page.evaluate((v) => { window.__mic = v; }, { rms, voz });
  // La persona dice algo, hace una pausa y Eco empieza a responder.
  async function contarParteA() {
    await page.click('#orb');
    await esperar('listening');
    await mic(0.2, true); await dormir(900); await mic(0.005, false);
    await esperar('speaking', 20000);
  }
  return { context, page, estado, llamadas, estadoOrbe, esperar, mic, contarParteA };
}

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://localhost:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  try {
    console.log('\n--- 1: la persona retoma la palabra mientras Eco habla ---');
    let t = await preparar(browser, base);
    await t.page.evaluate(() => { window.__duracionAudio = 8000; });
    await t.contarParteA();
    ok(t.llamadas.length === 2, 'Eco empezó a responder a la primera parte');
    await dormir(1200); // pasa la calibración del eco
    await t.mic(0.25, true);
    await t.esperar('listening', 3000).then(() => ok(true, 'al retomar la palabra, Eco se calla y vuelve a escuchar'), () => ok(false, 'al retomar la palabra, Eco se calla y vuelve a escuchar'));
    t.estado.texto = 'Parte B';
    await dormir(700); await t.mic(0.005, false);
    await t.esperar('speaking', 20000);
    const ultima = t.llamadas[t.llamadas.length - 1];
    const roles = ultima.history.map((m) => m.role).join(',');
    ok(t.llamadas.length === 3, 'después se pidió una respuesta nueva a Eco');
    ok(/user,user$/.test(roles) && ultima.history.map((m) => m.content).includes('Parte A') && ultima.history.map((m) => m.content).includes('Parte B'), 'las dos partes viajan juntas, una detrás de otra (' + roles + ')');
    ok(!ultima.history.some((m) => /Respuesta de Eco/.test(m.content)), 'la respuesta que Eco no alcanzó a decir no queda en el historial');
    await t.context.close();

    console.log('\n--- 2: un ruido mientras Eco habla no lo interrumpe ---');
    t = await preparar(browser, base);
    await t.page.evaluate(() => { window.__duracionAudio = 6000; });
    await t.contarParteA();
    await dormir(1000);
    await t.mic(0.12, false); await dormir(2000);
    ok(await t.estadoOrbe() === 'speaking', 'un ventilador (sonido grave) no interrumpe a Eco');
    await t.mic(0.3, true); await dormir(250); await t.mic(0.005, false); await dormir(500);
    ok(await t.estadoOrbe() === 'speaking', 'una tos corta tampoco');
    await t.esperar('listening', 15000);
    ok(t.llamadas.length === 2, 'Eco terminó de hablar sola y la charla siguió normal');
    await t.context.close();

    console.log('\n--- 3: retoma la palabra mientras Eco todavía piensa ---');
    t = await preparar(browser, base, { demoraRespuesta: 4000 });
    await t.page.click('#orb');
    await t.esperar('listening');
    await t.mic(0.2, true); await dormir(900); await t.mic(0.005, false);
    await t.esperar('thinking', 20000);
    await dormir(300);
    await t.mic(0.25, true);
    await t.esperar('listening', 3000).then(() => ok(true, 'mientras Eco piensa, retomar la palabra lo frena y vuelve a escuchar'), () => ok(false, 'mientras Eco piensa, retomar la palabra lo frena y vuelve a escuchar'));
    await t.mic(0.005, false);
    await dormir(5000);
    ok(await t.estadoOrbe() === 'listening', 'la respuesta que llegó tarde no la dice (sigue escuchando)');
    await t.context.close();

    console.log('\n--- 4: falsa alarma: Eco se calló pero no llegó nada ---');
    t = await preparar(browser, base);
    await t.page.evaluate(() => { window.__duracionAudio = 8000; });
    await t.contarParteA();
    await dormir(1200);
    await t.mic(0.25, true); await dormir(700); await t.mic(0.005, false);
    await t.esperar('listening', 3000);
    t.estado.texto = '';
    await t.page.waitForFunction(() => document.getElementById('orb').dataset.state === 'speaking', null, { timeout: 25000 });
    const ult = t.llamadas[t.llamadas.length - 1];
    ok(t.llamadas.length === 3 && ult.history[ult.history.length - 1].content === 'Parte A', 'sin nada nuevo, Eco vuelve a responder lo que la persona había dicho');
    await t.context.close();
  } catch (err) {
    fallos++;
    console.error('✗ error inesperado:', err && err.stack ? err.stack : err);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fallos === 0 ? '\n✅ Todo OK' : `\n❌ ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
