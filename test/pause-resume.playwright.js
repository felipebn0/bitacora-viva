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
// No usa server.js ni mockea la base de datos/Blob/Anthropic: este test es
// sobre la lógica del front-end en app.html, así que todas las llamadas a
// /api/* se interceptan directamente con page.route(), y los archivos de
// public/ se sirven con un servidor estático mínimo aparte.
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
  const args = ['--use-fake-device-for-media-stream'];
  return chromium
    .launch({ executablePath: '/opt/pw-browsers/chromium', args })
    .catch(() => chromium.launch({ args }));
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
  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('  [pageerror]', e.message));

  // window.Audio real depende de decodificar bytes de audio de verdad y de
  // la política de autoplay del navegador — nada de eso es lo que este
  // test quiere validar. Un Audio fake que "termina" solo, rápido, hace
  // que hablar la pregunta sea instantáneo y 100% determinístico.
  await page.addInitScript(() => {
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
  await page.route('**/api/next', async (route) => {
    callCounts.next += 1;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ message: `Pregunta ${callCounts.next}` }) });
  });
  await page.route('**/api/speak', (route) => route.fulfill({ contentType: 'audio/wav', body: SILENT_WAV }));
  await page.route('**/api/transcribe', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ text: transcript }),
  }));
  await page.route('**/api/save', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sessionDbId: 1 }) }));

  return { context, page, callCounts };
}

async function esperarEstado(page, estado) {
  await page.waitForFunction((e) => document.getElementById('orb').dataset.state === e, estado, { timeout: 15000 });
}

async function scenarioGuardaRespuestaParcial(browser, base) {
  console.log('\n--- Escenario 1: pausar a mitad de grabar SÍ guarda lo dicho ---');
  const { context, page, callCounts } = await setupPage(browser, { transcript: 'Lo que alcancé a contar antes de pausar' });

  await page.goto(base + '/app.html');
  await page.waitForSelector('#orb', { state: 'visible' });
  await page.click('#orb'); // idle -> startSession() -> fetchNext() -> "Pregunta 1"

  await esperarEstado(page, 'listening');
  assert(callCounts.next === 1, 'primera pregunta pedida al arrancar la sesión');

  await page.waitForTimeout(700); // deja que MediaRecorder junte algo de audio real antes de pausar
  await page.click('#orb'); // listening -> pauseConversation()

  await esperarEstado(page, 'paused');

  const respuestas = await page.$$eval('.bubble.a', (els) => els.map((e) => e.textContent));
  assert(respuestas.includes('Lo que alcancé a contar antes de pausar'), 'la respuesta parcial quedó guardada como burbuja de respuesta al pausar (antes se perdía)');
  assert(callCounts.next === 1, 'pausar todavía no pidió una pregunta nueva (seguir:false — se evita gastar un llamado a la IA que podría descartarse)');

  await page.click('#orb'); // paused -> resumeConversation()
  await esperarEstado(page, 'listening');

  const preguntas = await page.$$eval('.bubble.q', (els) => els.map((e) => e.textContent));
  assert(callCounts.next === 2, 'al volver, resumeConversation() pidió una pregunta NUEVA (pausedFromState quedó en "thinking")');
  assert(preguntas.includes('Pregunta 2'), 'la pregunta nueva ("Pregunta 2") se agregó al chat');
  assert(preguntas.filter((p) => p === 'Pregunta 1').length === 1, 'la pregunta original ("Pregunta 1") no se repitió como si fuera nueva');

  await context.close();
}

async function scenarioSinNadaQueGuardar(browser, base) {
  console.log('\n--- Escenario 2: pausar sin haber dicho nada entendible cae al comportamiento anterior ---');
  const { context, page, callCounts } = await setupPage(browser, { transcript: '' }); // el servidor "no entendió nada"

  await page.goto(base + '/app.html');
  await page.waitForSelector('#orb', { state: 'visible' });
  await page.click('#orb');
  await esperarEstado(page, 'listening');

  await page.waitForTimeout(700); // hay audio real de sobra, pero la transcripción vuelve vacía
  await page.click('#orb'); // pausa
  await esperarEstado(page, 'paused');

  const respuestas = await page.$$eval('.bubble.a', (els) => els.map((e) => e.textContent));
  assert(respuestas.length === 0, 'sin nada entendible, no se agrega ninguna burbuja de respuesta (nada real que guardar)');

  await page.click('#orb'); // resume: debería repetir la Pregunta 1 (no pedir una nueva)
  await page.waitForTimeout(400);
  assert(callCounts.next === 1, 'al volver sin haber dicho nada entendible, NO se pide una pregunta nueva — se repite la que ya estaba, como antes del arreglo');

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
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? '\n✅ Todo OK' : `\n❌ ${failures} fallo(s)`);
  process.exit(failures === 0 ? 0 : 1);
})();
