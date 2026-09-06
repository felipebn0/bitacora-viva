// Dos cosas que test/responsive.playwright.js no cubre porque solo prueba
// anchos en vertical: vista horizontal (landscape) en celular, y que el
// padding de env(safe-area-inset-*) realmente empuje el contenido lejos
// del notch/Dynamic Island/barra inferior en un iPhone con pantalla
// completa (requiere viewport-fit=cover, ver el <meta viewport> de cada
// página).
//
// Los env(safe-area-inset-*) no se pueden "simular" cambiando el viewport
// nada más — hace falta que el navegador realmente exponga esos valores.
// Chromium lo permite desde DevTools Protocol
// (Emulation.setSafeAreaInsetsOverride); si esta versión de Chromium no lo
// soporta, esa parte se salta con aviso en vez de fallar (no es una regla
// del navegador que dependa del código de la app).
//
//   node test/landscape-safearea.playwright.js   (o: npm run test:landscape)

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';

const path = require('path');
const http = require('http');
const bcrypt = require(path.resolve(__dirname, '..', 'node_modules', 'bcryptjs'));

const serverPath = path.resolve(__dirname, '..', 'server.js');

const PASSWORD_HASH = bcrypt.hashSync('claveDePrueba123', 4);
const users = {
  1: { id: 1, username: 'personadeprueba', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null, name: 'Persona de Prueba', email: 'p@example.com', fecha_nacimiento: '1950-01-01' },
};

function fakeSql(strings, ...values) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = users[1]; return Promise.resolve([{ id: u.id, username: u.username, password_hash: u.password_hash, token_version: u.token_version }]);
  }
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) { const u = users[values[0]]; return Promise.resolve(u ? [{ owner_user_id: u.owner_user_id, token_version: u.token_version }] : []); }
  if (text.includes('SELECT name, email, fecha_nacimiento FROM users WHERE id')) { const u = users[values[0]]; return Promise.resolve(u ? [{ name: u.name, email: u.email, fecha_nacimiento: u.fecha_nacimiento }] : []); }
  if (text.includes('SELECT tree_pending_names FROM users WHERE id')) return Promise.resolve([{ tree_pending_names: null }]);
  if (text.includes('SELECT name, username FROM users WHERE id')) { const u = users[values[0]]; return Promise.resolve(u ? [{ name: u.name, username: u.username }] : []); }
  return Promise.resolve([]);
}
fakeSql.transaction = (queries) => Promise.all(queries);
require.cache[require.resolve('@neondatabase/serverless')] = { id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true, exports: { neon: () => fakeSql } };
require.cache[require.resolve('@vercel/blob')] = { id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true, exports: { put: async () => ({ url: 'https://fake.public.blob.vercel-storage.com/x' }), del: async () => {} } };
require.cache[require.resolve('@anthropic-ai/sdk')] = { id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true, exports: class FakeAnthropic { constructor() {} } };

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.log('SKIP: playwright no está instalado (correr `npm ci`). Saltando pruebas de landscape/safe-area.');
  process.exit(0);
}

const { attachCspViolationCollector, checkSinViolacionesCsp } = require('./helpers/csp-violations');

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

function launchChromium() {
  return chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
}

let ok = true;
function check(cond, label) {
  console.log((cond ? 'OK  ' : 'FAIL'), label);
  if (!cond) ok = false;
}

// Anchos "landscape" típicos de celular (girado): iPhone SE, iPhone
// 14/15/16 "normal", y uno más ancho tipo Pro Max — todos con poca altura,
// que es donde suele romperse un layout pensado solo para vertical.
const LANDSCAPES = [
  { w: 667, h: 375, label: 'iPhone SE landscape' },
  { w: 844, h: 390, label: 'iPhone 14 landscape' },
  { w: 926, h: 428, label: 'iPhone 14 Pro Max landscape' },
];

async function checkLandscapePagina(browser, base, url, etiqueta, cookie) {
  for (const { w, h, label } of LANDSCAPES) {
    const context = await browser.newContext({ viewport: { width: w, height: h } });
    await attachCspViolationCollector(context);
    if (cookie) await context.addCookies([{ name: cookie.name, value: cookie.value, url: base }]);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#appContent', { state: 'visible' }).catch(() => {});
    await page.waitForTimeout(150);
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(overflowX <= 1, `${etiqueta} — ${label} (${w}x${h}): sin scroll horizontal (overflow=${overflowX}px)`);
    await checkSinViolacionesCsp(page, `${etiqueta} — ${label} (${w}x${h})`, check);
    await context.close();
  }
}

async function checkSafeArea(browser, base, cookie) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await attachCspViolationCollector(context);
  await context.addCookies([{ name: cookie.name, value: cookie.value, url: base }]);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  let soportado = true;
  try {
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, left: 0, right: 0, bottom: 34 } });
  } catch (e) {
    soportado = false;
  }
  if (!soportado) {
    console.log('SKIP  safe-area: este Chromium no soporta Emulation.setSafeAreaInsetsOverride — no se puede simular sin depender de un iPhone real.');
    await context.close();
    return;
  }
  // app.html (no la landing) es la que usa env(safe-area-inset-*) en el
  // body — pensada para pantalla completa en el celular durante la charla.
  await page.goto(`${base}/app.html`, { waitUntil: 'load' });
  await page.waitForSelector('#appContent', { state: 'visible' }).catch(() => {});
  const padTop = await page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingTop || '0'));
  const padBottom = await page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom || '0'));
  // El CSS es "24px + env(...)" — con top:47/bottom:34 simulados, debería
  // quedar bien por encima del padding base de 24px si el env() se está
  // aplicando de verdad (si no se aplicara, quedaría clavado en 24px).
  check(padTop > 30, `app.html con notch simulado (top:47px): el padding superior del body lo respeta (padding-top=${padTop}px, base sin notch sería 24px)`);
  check(padBottom > 30, `app.html con barra inferior simulada (bottom:34px): el padding inferior del body lo respeta (padding-bottom=${padBottom}px, base sin barra sería 24px)`);
  await checkSinViolacionesCsp(page, 'app.html con safe-area simulado', check);
  await context.close();
}

async function main() {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const cookie = await login(server);

  const browser = await launchChromium();
  try {
    await checkLandscapePagina(browser, base, `${base}/index.html`, 'landing', null);
    await checkLandscapePagina(browser, base, `${base}/app.html`, 'app.html', cookie);
    await checkSafeArea(browser, base, cookie);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(ok ? '\n✅ Todo OK' : '\n❌ Hay fallos');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
