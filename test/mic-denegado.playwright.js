// Verifica qué pasa cuando el navegador NIEGA (o revoca) el permiso de
// micrófono al arrancar una charla en app.html.
//
// app.html ya tenía manejo para esto (mensajeErrorMicrofono() / el "escribe
// tu respuesta" que aparece si no hay mediaStream), pero no existía ningún
// test que lo probara — así que un cambio futuro podía romper esa ruta sin
// que nada avisara, dejando a alguien con el mic bloqueado mirando
// "Escuchando…" para siempre, sin poder seguir la charla.
//
// Igual que test/pause-resume.playwright.js: sirve public/ con un server
// estático propio, mockea /api/* con page.route(), y fakea
// getUserMedia/MediaRecorder — acá la única diferencia es que
// getUserMedia() rechaza la promesa, simulando que la persona (o el
// sistema operativo) negó o revocó el permiso.
//
//   node test/mic-denegado.playwright.js   (o: npm run test:mic-denegado)

const path = require('path');
const express = require('express');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('Falta playwright — correr "npm install" primero.');
  process.exit(1);
}

function launchChromium() {
  return chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
}

function startStaticServer() {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

const SILENT_WAV = Buffer.from(
  'UklGRigAAABXQVZFZm10IBIAAAABAAEAQB8AAEAfAAABAAgAAABkYXRhAAAAAA==',
  'base64'
);

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log('✓ ' + msg);
  } else {
    failures++;
    console.error('✗ ' + msg);
  }
}

async function setupPage(browser, { errorName }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('  [pageerror]', e.message, e.stack || ''));

  await page.addInitScript((errName) => {
    class FakeAudio {
      constructor() { this._src = ''; this.onended = null; this.onerror = null; this.paused = true; }
      set src(v) { this._src = v; }
      get src() { return this._src; }
      play() { this.paused = false; setTimeout(() => { if (this.onended) this.onended(); }, 5); return Promise.resolve(); }
      pause() { this.paused = true; }
      load() {}
    }
    window.Audio = FakeAudio;

    // El corazón de este test: getUserMedia rechaza, como cuando el
    // permiso de micrófono está denegado o fue revocado desde los ajustes
    // del sistema operativo/navegador.
    navigator.mediaDevices = navigator.mediaDevices || {};
    navigator.mediaDevices.getUserMedia = async () => {
      const err = new Error('Permission denied');
      err.name = errName;
      throw err;
    };

    class FakeMediaRecorder {
      constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; this.ondataavailable = null; this.onstop = null; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; if (this.onstop) this.onstop(); }
    }
    window.MediaRecorder = FakeMediaRecorder;

    class FakeAudioContext {
      constructor() { this.state = 'running'; }
      createMediaStreamSource() { return { connect() {} }; }
      createAnalyser() { return { fftSize: 512, frequencyBinCount: 256, getByteTimeDomainData(arr) { arr.fill(128); } }; }
      resume() {}
      close() {}
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  }, errorName);

  await page.route('**/api/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ isCollaborator: false, username: 'tester', name: 'Tester', email: 't@example.com', fechaNacimiento: null }),
  }));
  await page.route('**/api/tree/pending', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ names: [] }) }));
  await page.route('**/api/next', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ message: 'Pregunta 1' }) }));
  await page.route('**/api/speak', (route) => route.fulfill({ contentType: 'audio/wav', body: SILENT_WAV }));

  return { context, page };
}

async function esperarEstado(page, estado) {
  await page.waitForFunction((e) => document.getElementById('orb').dataset.state === e, estado, { timeout: 15000 });
}

async function scenarioPermisoDenegado(browser, base) {
  console.log('\n--- Escenario 1: permiso de micrófono denegado (NotAllowedError) ---');
  const { context, page } = await setupPage(browser, { errorName: 'NotAllowedError' });

  await page.goto(base + '/app.html');
  await page.waitForSelector('#orb', { state: 'visible' });
  await page.click('#orb'); // idle -> startSession() -> intenta escuchar

  // No debe quedar trabado en "listening" para siempre: al fallar el
  // permiso, listenForAnswer() cae al mensaje de error + fallback de texto.
  await page.waitForFunction(() => {
    const s = document.getElementById('stateLabel');
    return s && /micrófono/i.test(s.textContent || '');
  }, { timeout: 15000 });

  const mensaje = await page.$eval('#stateLabel', (el) => el.textContent);
  assert(/bloqueado.*Ajustes|Ajustes.*teléfono/i.test(mensaje), `el mensaje explica que el mic está bloqueado y a dónde ir a arreglarlo (mensaje: "${mensaje}")`);

  const escribirVisible = await page.$eval('#writeRow', (el) => el.classList.contains('visible'));
  assert(escribirVisible, 'aparece la opción de escribir la respuesta a mano (no se queda sin forma de continuar)');

  const focoEnEscribir = await page.evaluate(() => document.activeElement && document.activeElement.id === 'writeInput');
  assert(focoEnEscribir, 'el foco queda puesto en el campo de escribir, listo para usar');

  await context.close();
}

async function scenarioSinMicrofono(browser, base) {
  console.log('\n--- Escenario 2: no hay micrófono en el dispositivo (NotFoundError) ---');
  const { context, page } = await setupPage(browser, { errorName: 'NotFoundError' });

  await page.goto(base + '/app.html');
  await page.waitForSelector('#orb', { state: 'visible' });
  await page.click('#orb');

  await page.waitForFunction(() => {
    const s = document.getElementById('stateLabel');
    return s && /micrófono/i.test(s.textContent || '');
  }, { timeout: 15000 });

  const mensaje = await page.$eval('#stateLabel', (el) => el.textContent);
  assert(/no se encontró/i.test(mensaje), `el mensaje es específico para "no hay micrófono", no el genérico de permiso bloqueado (mensaje: "${mensaje}")`);

  await context.close();
}

(async () => {
  const server = await startStaticServer();
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const browser = await launchChromium();
  try {
    await scenarioPermisoDenegado(browser, base);
    await scenarioSinMicrofono(browser, base);
  } catch (err) {
    failures++;
    console.error('✗ error inesperado:', err && err.stack ? err.stack : err);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? '\n✅ Todo OK' : `\n❌ ${failures} fallo(s)`);
  process.exit(failures === 0 ? 0 : 1);
})();
