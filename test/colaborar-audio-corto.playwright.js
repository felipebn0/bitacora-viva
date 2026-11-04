// En colaborar.html, una nota de voz de 5 segundos o menos no se guarda (el texto sí se procesa y sigue la charla). Se mide
// lo que la persona habló, no lo que duró la grabación: la espera antes de empezar y el silencio del final no cuentan.
// El micrófono, el audio y el analizador se fingen; el test maneja el volumen con window.__mic.
//
//   node test/colaborar-audio-corto.playwright.js
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright: corre "npm install".'); process.exit(1); }
let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const SILENT_WAV = Buffer.from('UklGRigAAABXQVZFZm10IBIAAAABAAEAQB8AAEAfAAABAAgAAABkYXRhAAAAAA==', 'base64');

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
    window.__mic = { rms: 0.005 };
    class AudioFalso {
      constructor() { this.onended = null; this.onerror = null; this.paused = true; }
      play() { this.paused = false; setTimeout(() => { if (this.onended) this.onended(); }, 5); return Promise.resolve(); }
      pause() { this.paused = true; }
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
      getByteTimeDomainData(a) { const n = Math.round(window.__mic.rms * 128); for (let i = 0; i < a.length; i++) a[i] = 128 + (i % 2 ? -n : n); }
    }
    class ContextoFalso {
      constructor() { this.state = 'running'; }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createAnalyser() { return new AnalizadorFalso(); }
      resume() {} close() {}
    }
    window.AudioContext = ContextoFalso;
    window.webkitAudioContext = ContextoFalso;
  });
  const subidas = [];
  const turnos = [];
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/me') return json({ username: 'felipe', name: 'Felipe', isCollaborator: false, isGuest: false });
    if (u.pathname === '/api/my-collaborations') return json({ historias: [{ ownerId: 7, ownerName: 'Diego Vargas', soloHistorial: false }] });
    if (u.pathname === '/api/collaboration-info') return json({ ownerName: 'Diego Vargas' });
    if (u.pathname === '/api/contribute-audio') { subidas.push(Date.now()); return json({ url: 'https://x.test/audio' + subidas.length + '.webm' }); }
    if (u.pathname === '/api/transcribe') return json({ text: 'sí, claro' });
    if (u.pathname === '/api/speak') return route.fulfill({ contentType: 'audio/wav', body: SILENT_WAV });
    if (u.pathname === '/api/contribute-chat') { turnos.push(req.postDataJSON()); return json({ message: 'Cuéntame más.', done: false }); }
    return json({});
  });

  await page.goto(base + '/colaborar.html');
  await page.waitForFunction(() => document.getElementById('orb').dataset.state === 'idle');
  const mic = (rms) => page.evaluate((v) => { window.__mic = { rms: v }; }, rms);
  const esperarEscucha = () => page.waitForFunction(() => document.getElementById('orb').dataset.state === 'listening', null, { timeout: 15000 });
  const esperarTurno = (n) => page.waitForFunction(() => true).then(async () => { for (let i = 0; i < 300 && turnos.length < n; i++) await dormir(100); });

  // Una frase corta con un par de segundos de espera antes y el silencio de después: la grabación dura más de 5 s, pero habló ~1 s.
  await page.click('#orb');
  await esperarEscucha();
  await dormir(2000); await mic(0.2); await dormir(1000); await mic(0.005);
  await esperarTurno(2);
  ok(turnos.length >= 2 && turnos[1].history.some((m) => m.role === 'user' && m.content === 'sí, claro'), 'lo que dijo igual se transcribe y sigue la charla');
  ok(subidas.length === 0, 'una frase de ~1 s no se guarda aunque la grabación completa dure más de 5 s (' + subidas.length + ' subidas)');

  // La charla vuelve a escuchar sola: ahora cuenta algo de más de 5 s.
  await esperarEscucha();
  await mic(0.2); await dormir(6500); await mic(0.005);
  await esperarTurno(3);
  ok(subidas.length === 1, 'una intervención de más de 5 s hablando sí se guarda (' + subidas.length + ' subidas)');
  ok(!errores.length, 'sin errores en la página (' + errores.join(' | ') + ')');

  await browser.close(); server.close();
  console.log(fallos ? '\nHubo fallos.' : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
