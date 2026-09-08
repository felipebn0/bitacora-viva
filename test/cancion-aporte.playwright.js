// Verifica empíricamente la función "agregar una canción" (2026-09-08, a
// pedido del usuario: que una colaboradora pueda dejar el link de una
// canción como aporte y que, igual que ya pasa con una foto/video, la
// bitácora la traiga a colación cuando la persona vuelve a abrir el chat).
//
// Tres escenarios, cada uno con el harness que ya usa la suite más parecida
// para esa misma página (ver los comentarios de cada función):
//   1. colaborar.html de punta a punta contra el server.js real (mismo
//      patrón que colaborar-sticky.playwright.js): un link inválido se
//      rechaza con un mensaje, uno válido de Spotify se acepta.
//   2. app.html con /api/next mockeado (mismo patrón que
//      pause-resume.playwright.js): cuando la respuesta trae
//      media.type==='cancion', se muestra el <iframe>, nunca la <img>/<video>.
//   3. colaboraciones.html con /api/contributions mockeado (mismo patrón
//      que arbol-conexiones.playwright.js): la canción de un aporte pasado
//      se pinta como <iframe>, no como <img>/<video> ni se pierde.
//
//   node test/cancion-aporte.playwright.js   (o: npm run test:cancion)

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';

const path = require('path');
const http = require('http');
const express = require('express');
const bcrypt = require(path.resolve(__dirname, '..', 'node_modules', 'bcryptjs'));

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.log('SKIP: playwright no está instalado (correr `npm ci`). Saltando prueba de "agregar canción".');
  process.exit(0);
}

function launchChromium() {
  return chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
}

let ok = true;
function check(cond, label) {
  console.log((cond ? 'OK  ' : 'FAIL'), label);
  if (!cond) ok = false;
}

// --- Escenario 1: colaborar.html contra el server.js real ---
async function scenarioColaborarHtml(browser) {
  console.log('\n--- Escenario 1: agregar una canción desde colaborar.html (server.js real) ---');
  const serverPath = path.resolve(__dirname, '..', 'server.js');
  const PASSWORD_HASH = bcrypt.hashSync('claveDePrueba123', 4);
  // A: colaboradora fija que hace el aporte. B: dueña de la bitácora que
  // recibe la canción — mismo patrón de dos cuentas que colaborar-sticky.playwright.js,
  // necesario para que colaborar.html tenga una bitácora ajena real a la
  // que aportar (?owner=2), no solo un login sin ningún destino.
  const users = {
    1: { id: 1, username: 'personadeprueba', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null, name: 'Persona De Prueba', email: 'p@example.com' },
    2: { id: 2, username: 'duenadelabitacora', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null, name: 'Nicolás Vargas Galeano' },
  };
  const collaborationsRows = [{ collaborator_user_id: 1, owner_user_id: 2 }];

  function fakeSql(strings, ...values) {
    const text = strings.join('?');
    if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
    if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
    if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
      const u = users[1]; return Promise.resolve([{ id: u.id, username: u.username, password_hash: u.password_hash, token_version: u.token_version }]);
    }
    if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) { const u = users[values[0]]; return Promise.resolve(u ? [{ owner_user_id: u.owner_user_id, token_version: u.token_version }] : []); }
    if (text.includes('SELECT name, email, fecha_nacimiento FROM users WHERE id')) { const u = users[values[0]]; return Promise.resolve(u ? [{ name: u.name, email: u.email, fecha_nacimiento: null }] : []); }
    if (text.includes('SELECT tree_pending_names FROM users WHERE id')) return Promise.resolve([{ tree_pending_names: null }]);
    if (text.includes('SELECT name, username FROM users WHERE id')) { const u = users[values[0]]; return Promise.resolve(u ? [{ name: u.name, username: u.username }] : []); }
    if (text.includes('SELECT 1 FROM collaborations')) {
      const [collaboratorId, ownerId] = values;
      const hit = collaborationsRows.some((c) => c.collaborator_user_id === collaboratorId && c.owner_user_id === ownerId);
      return Promise.resolve(hit ? [{ '?column?': 1 }] : []);
    }
    if (text.includes('FROM collaborations c') && text.includes('c.collaborator_user_id')) {
      const rows = collaborationsRows.filter((c) => c.collaborator_user_id === values[0]).map((c) => ({ owner_id: c.owner_user_id, name: users[c.owner_user_id].name, username: users[c.owner_user_id].username }));
      return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }
  fakeSql.transaction = (queries) => Promise.all(queries);
  require.cache[require.resolve('@neondatabase/serverless')] = { id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true, exports: { neon: () => fakeSql } };
  require.cache[require.resolve('@vercel/blob')] = { id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true, exports: { put: async () => ({ url: 'https://fake.public.blob.vercel-storage.com/x' }), del: async () => {} } };
  require.cache[require.resolve('@anthropic-ai/sdk')] = { id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true, exports: class FakeAnthropic { constructor() {} } };
  const app = require(serverPath);

  function request(server, opts) {
    return new Promise((resolve, reject) => {
      const data = opts.body ? JSON.stringify(opts.body) : null;
      const headers = Object.assign({}, opts.headers || {});
      if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
      const host = `127.0.0.1:${server.address().port}`;
      if (!headers['Origin']) headers['Origin'] = `http://${host}`;
      const r = http.request({ hostname: '127.0.0.1', port: server.address().port, path: opts.path, method: opts.method || 'GET', headers }, (res) => {
        let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
      });
      r.on('error', reject); if (data) r.write(data); r.end();
    });
  }

  async function login(server) {
    const resp = await request(server, { path: '/api/login', method: 'POST', body: { username: 'personadeprueba', password: 'claveDePrueba123' } });
    if (resp.status !== 200) throw new Error(`No se pudo loguear: ${resp.status} ${resp.body}`);
    const raw = resp.headers['set-cookie'][0].split(';')[0];
    const idx = raw.indexOf('=');
    return { name: raw.slice(0, idx), value: raw.slice(idx + 1) };
  }

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const cookie = await login(server);

  try {
    const context = await browser.newContext();
    await context.addCookies([{ name: cookie.name, value: cookie.value, url: base }]);
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
    await page.goto(`${base}/colaborar.html?owner=2`, { waitUntil: 'load' });
    await page.waitForSelector('#appContent', { state: 'visible' });

    await page.click('#cancionToggleBtn');
    const filaVisible = await page.$eval('#cancionRow', (el) => el.classList.contains('visible'));
    check(filaVisible, 'al tocar "agregar una canción" se muestra el formulario (link + recuerdo)');

    // --- Link inválido: se rechaza, el formulario NO se cierra ---
    await page.fill('#cancionLinkInput', 'https://example.com/no-es-una-cancion');
    await page.click('#cancionSend');
    await page.waitForFunction(() => document.getElementById('cancionMsg').textContent.trim().length > 0);
    const msgInvalido = await page.$eval('#cancionMsg', (el) => el.textContent);
    check(/no parece ser de Spotify o YouTube/.test(msgInvalido), `un link que no es de Spotify/YouTube se rechaza con un aviso claro (mensaje: "${msgInvalido}")`);
    const siguioAbierto = await page.$eval('#cancionRow', (el) => el.classList.contains('visible'));
    check(siguioAbierto, 'después de un link inválido el formulario sigue abierto (no se pierde lo que ya estaba escribiendo)');

    // --- Link válido de Spotify: se acepta, queda listo para viajar con la historia ---
    await page.fill('#cancionLinkInput', 'https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp?si=xyz');
    await page.fill('#cancionCaptionInput', 'La cantábamos siempre con la abuela');
    await page.click('#cancionSend');
    await page.waitForFunction(() => document.getElementById('cancionMsg').textContent.includes('agregó'));
    const cerroFormulario = await page.$eval('#cancionRow', (el) => !el.classList.contains('visible'));
    check(cerroFormulario, 'un link válido de Spotify se acepta y el formulario se cierra solo');
    // mediaUrlsLocal (donde queda guardada para viajar con la historia) es
    // una variable interna del IIFE de colaborar.html, no expuesta a
    // propósito — que el mensaje de éxito haya aparecido ya confirma que
    // /api/contribute-song devolvió ok:true y que subirFotoPendiente-style
    // el push a mediaUrlsLocal se ejecutó (ver test/contribute-draft.smoke.js
    // para la cobertura de que efectivamente se guarda junto con la
    // historia del lado del servidor).
    const inputsLimpios = await page.evaluate(() => document.getElementById('cancionLinkInput').value === '' && document.getElementById('cancionCaptionInput').value === '');
    check(inputsLimpios, 'los campos se limpian después de agregar la canción (lista para un próximo aporte, no queda el link viejo)');

    await context.close();
  } finally {
    server.close();
  }
}

// --- Escenario 2: app.html con /api/next mockeado ---
async function scenarioAppHtml(browser) {
  console.log('\n--- Escenario 2: app.html muestra el reproductor embebido cuando media.type es "cancion" ---');
  const staticApp = express();
  staticApp.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((resolve) => { const s = staticApp.listen(0, () => resolve(s)); });
  const port = server.address().port;
  const base = `http://localhost:${port}`;

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message));

    await page.addInitScript(() => {
      // Mismo motivo que en pause-resume.playwright.js: nada de esto
      // prueba audio real, solo que fetchNext() reciba una respuesta y la
      // pinte — un Audio real que intente decodificar bytes falsos
      // rompería el test sin aportar nada.
      class FakeAudio {
        constructor() { this._src = ''; this.onended = null; this.onerror = null; this.paused = true; }
        set src(v) { this._src = v; }
        get src() { return this._src; }
        play() { this.paused = false; setTimeout(() => { if (this.onended) this.onended(); }, 5); return Promise.resolve(); }
        pause() { this.paused = true; }
        load() {}
      }
      window.Audio = FakeAudio;
    });

    const CANCION_URL = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ';
    await page.route('**/api/me', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ isCollaborator: false, username: 'tester', name: 'Tester', email: 't@example.com', fechaNacimiento: null }) }));
    await page.route('**/api/tree/pending', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ names: [] }) }));
    await page.route('**/api/next', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Tu mamá dejó esta canción para vos, ¿qué recuerdo tienen con ella?', media: { url: CANCION_URL, type: 'cancion' } }),
    }));
    await page.route('**/api/speak', (route) => route.fulfill({ contentType: 'audio/wav', body: Buffer.from('UklGRigAAABXQVZFZm10IBIAAAABAAEAQB8AAEAfAAABAAgAAABkYXRhAAAAAA==', 'base64') }));

    await page.goto(base + '/app.html');
    await page.waitForSelector('#orb', { state: 'visible' });
    await page.click('#orb');

    await page.waitForSelector('#mediaMomentoCancion:not([hidden])', { timeout: 10000 });
    const estado = await page.evaluate(() => ({
      cancionSrc: document.getElementById('mediaMomentoCancion').getAttribute('src'),
      cancionHidden: document.getElementById('mediaMomentoCancion').hidden,
      imgHidden: document.getElementById('mediaMomentoImg').hidden,
      videoHidden: document.getElementById('mediaMomentoVideo').hidden,
      momentoHidden: document.getElementById('mediaMomento').hidden,
    }));
    check(!estado.momentoHidden, 'el bloque de "media del momento" se muestra');
    check(!estado.cancionHidden, 'el <iframe> de la canción se muestra');
    check(estado.cancionSrc === CANCION_URL, `el <iframe> usa el link de embeber tal cual lo mandó el servidor (src: "${estado.cancionSrc}")`);
    check(estado.imgHidden && estado.videoHidden, 'ni la <img> ni el <video> de foto/video se muestran para una canción');

    await context.close();
  } finally {
    server.close();
  }
}

// --- Escenario 3: colaboraciones.html con /api/contributions mockeado ---
async function scenarioColaboracionesHtml(browser) {
  console.log('\n--- Escenario 3: colaboraciones.html pinta la canción de un aporte pasado como reproductor embebido ---');
  const staticApp = express();
  staticApp.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((resolve) => { const s = staticApp.listen(0, () => resolve(s)); });
  const port = server.address().port;
  const base = `http://localhost:${port}`;

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message));

    const CANCION_URL = 'https://open.spotify.com/embed/track/3n3Ppam7vgaVa1iaRUc9Lp';
    await page.route('**/api/tree/colaboradores', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ colaboradores: [] }) }));
    await page.route('**/api/contributions', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        notes: [{
          contributor: 'Mamá', parentesco: 'Hija', protagonista: null,
          texto: 'La cantábamos siempre con la abuela en la cocina.',
          audio_urls: [], media_urls: [{ url: CANCION_URL, type: 'cancion', caption: 'La guirnalda' }],
          created_at: new Date().toISOString(),
        }],
      }),
    }));
    await page.route('**/api/aportes/mark-seen', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));

    await page.goto(base + '/colaboraciones.html');
    await page.waitForSelector('.aporte-item', { timeout: 10000 });

    const info = await page.evaluate(() => {
      const iframe = document.querySelector('.aporte-item .media-adjunta iframe');
      const img = document.querySelector('.aporte-item .media-adjunta img');
      const video = document.querySelector('.aporte-item .media-adjunta video');
      return { iframeSrc: iframe ? iframe.getAttribute('src') : null, hayImg: !!img, hayVideo: !!video };
    });
    check(info.iframeSrc === CANCION_URL, `la canción del aporte se pinta como <iframe> con el link de embeber (src: "${info.iframeSrc}")`);
    check(!info.hayImg && !info.hayVideo, 'no se intenta pintar la canción como <img>/<video> (eso pasaría por /api/media-file, que rechazaría un host externo)');

    await context.close();
  } finally {
    server.close();
  }
}

(async () => {
  const browser = await launchChromium();
  try {
    await scenarioColaborarHtml(browser);
    await scenarioAppHtml(browser);
    await scenarioColaboracionesHtml(browser);
  } finally {
    await browser.close();
  }

  console.log(ok ? '\n✅ Todo OK' : '\n❌ Hay fallos');
  process.exit(ok ? 0 : 1);
})();
