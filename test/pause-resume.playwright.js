// Verifica empíricamente el arreglo de pauseConversation()/handleAnswer()
// en app.html: pausar a mitad de estar grabando una respuesta ya NO
// descarta lo dicho — se transcribe y se guarda como una respuesta real
// (con seguir:false, para no gastar un llamado a la IA que podría
// descartarse si la persona nunca vuelve), y al volver
// (resumeConversation(), con pausedFromState==='thinking') se pide una
// pregunta NUEVA en vez de repetir la que ya había sido respondida.
// Antes, pausar a mitad de grabar tiraba el audio a la basura sin más, y
// al volver se repetía la misma pregunta como si la persona nunca hubiera
// dicho nada.
//
// Escenario 2 cubre el otro caso (no se pudo transcribir nada): acá
// pausedFromState queda en 'listening', y resumeConversation() vuelve
// directo a escuchar sin repetir la pregunta en voz alta (arreglo del
// 2026-09-06 — antes SÍ la repetía, sintiéndose como si la charla
// repitiera todo lo ya dicho).
//
// No usa server.js ni mockea la base de datos/Blob/Anthropic: este test es
// sobre la lógica del front-end en app.html, así que todas las llamadas a
// /api/* se interceptan directamente con page.route(), y los archivos de
// public/ se sirven con un servidor estático mínimo aparte.
//
// getUserMedia/MediaRecorder/AudioContext también se fakean por completo
// (en vez de usar micrófono real con --use-fake-device-for-media-stream):
// así el test no depende de permisos de micrófono ni del comportamiento
// real de audio del Chromium de turno (que puede variar entre el navegador
// fijo de este sandbox y el que instala Playwright en CI), y el tamaño del
// audio "grabado" es siempre el mismo, sin esperar a que se junten bytes
// de verdad.
//
//   node test/pause-resume.playwright.js   (o: npm run test:pause-resume)

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

// El mismo WAV silencioso mínimo que usa app.html (SILENT_AUDIO) para
// desbloquear el audio — lo reciclamos como respuesta fake de /api/speak.
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

async function setupPage(browser, { transcript }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('  [pageerror]', e.message, e.stack || ''));
  page.on('console', (msg) => { if (msg.type() === 'error') console.error('  [console.error]', msg.text()); });

  await page.addInitScript(() => {
    // window.Audio real depende de decodificar bytes de audio de verdad y
    // de la política de autoplay del navegador — nada de eso es lo que
    // este test quiere validar. Un Audio fake que "termina" solo, rápido,
    // hace que hablar la pregunta sea instantáneo y determinístico.
    class FakeAudio {
      constructor() {
        this._src = '';
        this.onended = null;
        this.onerror = null;
        this.paused = true;
      }
      set src(v) { this._src = v; }
      get src() { return this._src; }
      play() {
        this.paused = false;
        setTimeout(() => { if (this.onended) this.onended(); }, 5);
        return Promise.resolve();
      }
      pause() { this.paused = true; }
      load() {}
    }
    window.Audio = FakeAudio;

    // getUserMedia/MediaRecorder/AudioContext fakes: no hace falta
    // micrófono real ni permisos para probar la lógica de pausar/seguir —
    // solo hace falta que "grabar" produzca un Blob de un tamaño
    // controlado (>= 800 bytes, el mínimo que pide pauseConversation()
    // antes de intentar transcribir) apenas se llama a stop().
    class FakeMediaStreamTrack {
      stop() {}
    }
    class FakeMediaStream {
      getTracks() { return [new FakeMediaStreamTrack()]; }
    }
    navigator.mediaDevices = navigator.mediaDevices || {};
    navigator.mediaDevices.getUserMedia = async () => new FakeMediaStream();

    class FakeMediaRecorder {
      constructor(stream, opts) {
        this.stream = stream;
        this.state = 'inactive';
        this.mimeType = 'audio/webm';
        this.ondataavailable = null;
        this.onstop = null;
      }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        const blob = new Blob([new Uint8Array(2000)], { type: this.mimeType });
        if (this.ondataavailable) this.ondataavailable({ data: blob });
        if (this.onstop) this.onstop();
      }
    }
    window.MediaRecorder = FakeMediaRecorder;

    class FakeAnalyserNode {
      constructor() { this.fftSize = 512; this.frequencyBinCount = 256; }
      getByteTimeDomainData(arr) { arr.fill(128); } // 128 = silencio (rms 0): nunca dispara el auto-corte por silencio durante el test
    }
    class FakeAudioContext {
      constructor() { this.state = 'running'; }
      createMediaStreamSource() { return { connect() {} }; }
      createAnalyser() { return new FakeAnalyserNode(); }
      resume() {}
      close() {}
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  });

  const callCounts = { next: 0 };

  await page.route('**/api/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ isCollaborator: false, username: 'tester', name: 'Tester', email: 't@example.com', fechaNacimiento: null }),
  }));
  await page.route('**/api/tree/pending', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ names: [] }),
  }));
  const nextCalls = []; // el "history" que mandó cada pedido a /api/next, en orden
  await page.route('**/api/next', async (route) => {
    callCounts.next += 1;
    nextCalls.push(route.request().postDataJSON());
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ message: `Pregunta ${callCounts.next}` }) });
  });
  await page.route('**/api/speak', (route) => route.fulfill({ contentType: 'audio/wav', body: SILENT_WAV }));
  await page.route('**/api/transcribe', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ text: transcript }),
  }));
  await page.route('**/api/save', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sessionDbId: 1 }) }));

  return { context, page, callCounts, nextCalls };
}

async function esperarEstado(page, estado) {
  await page.waitForFunction((e) => document.getElementById('orb').dataset.state === e, estado, { timeout: 15000 });
}

async function scenarioGuardaRespuestaParcial(browser, base) {
  console.log('\n--- Escenario 1: pausar a mitad de grabar SÍ guarda lo dicho ---');
  const { context, page, callCounts, nextCalls } = await setupPage(browser, { transcript: 'Lo que alcancé a contar antes de pausar' });

  await page.goto(base + '/app.html');
  await page.waitForSelector('#orb', { state: 'visible' });
  await page.click('#orb'); // idle -> startSession() -> fetchNext() -> "Pregunta 1"

  await esperarEstado(page, 'listening');
  assert(callCounts.next === 1, 'primera pregunta pedida al arrancar la sesión');

  await page.click('#orb'); // listening -> pauseConversation()
  await esperarEstado(page, 'paused');

  assert(callCounts.next === 1, 'pausar todavía no pidió una pregunta nueva (seguir:false — se evita gastar un llamado a la IA que podría descartarse)');

  await page.click('#orb'); // paused -> resumeConversation()
  await esperarEstado(page, 'listening');

  // app.html ya no muestra un transcript en pantalla (a pedido, ver
  // commit "Ajustes de charla por voz") — se verifica lo mismo de antes
  // (que la respuesta parcial no se perdió, y que la pregunta original no
  // se coló dos veces) mirando el "history" que de verdad se mandó al
  // pedir la pregunta nueva, en vez de leer burbujas que ya no existen.
  assert(callCounts.next === 2, 'al volver, resumeConversation() pidió una pregunta NUEVA (pausedFromState quedó en "thinking")');
  const historyAlVolver = (nextCalls[1] && nextCalls[1].history) || [];
  const respuestasDeUsuario = historyAlVolver.filter((m) => m.role === 'user').map((m) => m.content);
  const preguntasDeIA = historyAlVolver.filter((m) => m.role === 'assistant').map((m) => m.content);
  assert(respuestasDeUsuario.includes('Lo que alcancé a contar antes de pausar'), 'la respuesta parcial quedó guardada (viaja en el "history" al pedir la pregunta nueva) — antes se perdía');
  assert(preguntasDeIA.filter((p) => p === 'Pregunta 1').length === 1, 'la pregunta original ("Pregunta 1") aparece una sola vez en el historial, no se repitió como si fuera nueva');

  await context.close();
}

async function scenarioSinNadaQueGuardar(browser, base) {
  console.log('\n--- Escenario 2: pausar sin haber dicho nada entendible vuelve directo a escuchar ---');
  const { context, page, callCounts, nextCalls } = await setupPage(browser, { transcript: '' }); // el servidor "no entendió nada"

  await page.goto(base + '/app.html');
  await page.waitForSelector('#orb', { state: 'visible' });
  await page.click('#orb');
  await esperarEstado(page, 'listening');

  await page.click('#orb'); // pausa — hay audio "de sobra" (blob fake de 2000 bytes), pero la transcripción vuelve vacía
  await esperarEstado(page, 'paused');

  assert(callCounts.next === 1, 'sin nada entendible, pausar no pidió ninguna pregunta nueva');

  // pausedFromState queda en 'listening' (no se pudo transcribir nada) —
  // la pregunta original YA se había dicho entera antes de arrancar a
  // escuchar, así que resumeConversation() ya no la repite en voz alta
  // (arreglo de hoy: antes volvía a reproducirla entera, sintiéndose como
  // si la charla repitiera todo lo ya dicho). Va directo a escuchar de
  // nuevo, sin pedirle nada nuevo a la IA.
  await page.click('#orb'); // resume -> listenForAnswer() directo
  await esperarEstado(page, 'listening');
  assert(callCounts.next === 1, 'al volver sin haber dicho nada entendible, tampoco se pide una pregunta nueva (vuelve directo a escuchar)');
  assert(nextCalls.length === 1, 'no se mandó ningún pedido extra a /api/next solo por pausar y seguir sin decir nada nuevo');

  await context.close();
}

(async () => {
  const server = await startStaticServer();
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const browser = await launchChromium();
  try {
    await scenarioGuardaRespuestaParcial(browser, base);
    await scenarioSinNadaQueGuardar(browser, base);
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
