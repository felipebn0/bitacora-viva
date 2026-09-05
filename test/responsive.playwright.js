// Suite de regresión responsive — corre en CI (ver .github/workflows/ci.yml)
// y también a mano con `npm run test:responsive`.
//
// Nace de una auditoría de UX que encontró varios bugs de layout (el nav
// tapando anclas, el header cortándose con la letra agrandada, botones por
// debajo del tamaño táctil mínimo) que un `npm test` normal no agarra
// porque no mide nada visual — y que esta misma sesión tuvo que
// re-verificar a mano con scripts descartables más de una vez. Esto deja
// esa verificación corriendo sola en cada PR, en vez de depender de que
// alguien la repita manualmente.
//
// Mismo patrón que test/account-actions.smoke.js: mock programable de
// @neondatabase/serverless para levantar el server.js real sin depender de
// una base de datos de verdad, más un login real vía bcrypt para poder
// probar también las pantallas que requieren sesión (el menú de Cuenta).
//
// Qué revisa, para cada ancho (320/390/768/1440) x escala de letra
// (100%/120%/140%):
//   - la landing: nada se sale verticalmente de los límites del nav, los
//     botones/links del nav miden 44px o más de alto, no hay scroll
//     horizontal, y el destino de "Ver cómo funciona" no queda tapado por
//     el nav sticky al hacer clic.
//   - el login (sin sesión): sin scroll horizontal, el control A-/A+ mide
//     44px o más.
//   - el menú de Cuenta (con sesión real): sin scroll horizontal, el
//     correo se ve completo (en el cuadro o en el texto de abajo, nunca
//     cortado sin avisar), el control A-/A+ mide 44px o más.
// Aparte (una sola vez, no por cada ancho × escala — ver checkColaborar):
//   - colaborar.html de visita en otra historia (?owner=): un solo link
//     "← volver", sin "cerrar sesión"/"borrar cuenta", y "Tus
//     colaboraciones" centrado — y la misma página, para una cuenta 100%
//     colaboradora sin bitácora propia, sigue conservando esos dos.
// Además guarda una captura de cada combinación en test-artifacts/responsive/
// para poder revisarlas a simple vista (CI las sube como artifact).
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';

const path = require('path');
const fs = require('fs');
const http = require('http');
const bcrypt = require(path.resolve(__dirname, '..', 'node_modules', 'bcryptjs'));

const serverPath = path.resolve(__dirname, '..', 'server.js');

const PASSWORD_HASH = bcrypt.hashSync('claveDePrueba123', 4);
const users = {
  1: {
    id: 1, username: 'personadeprueba', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null,
    name: 'Persona de Prueba', email: 'persona.de.prueba@example.com', fecha_nacimiento: '1950-01-01',
  },
  // Para checkColaborar() más abajo: 2 y 4 son dos historias distintas a
  // las que la cuenta de prueba (1) colabora además de tener la suya
  // propia — hace falta más de una para que se muestre el selector "Tus
  // colaboraciones" (con una sola no tiene sentido, ver colaborar.html).
  // 3 es una cuenta 100% colaboradora fija de 2, sin bitácora propia.
  2: { id: 2, username: 'otrahistoria', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null, name: 'Nicolás Vargas Galeano' },
  3: { id: 3, username: 'colabfija', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: 2, name: 'Colab Fija' },
  4: { id: 4, username: 'segundahistoria', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null, name: 'Felipe' },
};
const byUsername = { personadeprueba: users[1], otrahistoria: users[2], colabfija: users[3], segundahistoria: users[4] };
const collaborationsRows = [
  { collaborator_user_id: 1, owner_user_id: 2 },
  { collaborator_user_id: 1, owner_user_id: 4 },
];

function fakeSql(strings, ...values) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = byUsername[values[0]];
    return Promise.resolve(u ? [{ id: u.id, username: u.username, password_hash: u.password_hash, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ owner_user_id: u.owner_user_id, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT name, email, fecha_nacimiento FROM users WHERE id')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ name: u.name, email: u.email, fecha_nacimiento: u.fecha_nacimiento }] : []);
  }
  if (text.includes('SELECT tree_pending_names FROM users WHERE id')) {
    return Promise.resolve([{ tree_pending_names: null }]);
  }
  if (text.includes('SELECT name, username FROM users WHERE id')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ name: u.name, username: u.username }] : []);
  }
  if (text.includes('SELECT 1 FROM collaborations')) {
    const [collaboratorId, ownerId] = values;
    const hit = collaborationsRows.some((c) => c.collaborator_user_id === collaboratorId && c.owner_user_id === ownerId);
    return Promise.resolve(hit ? [{ '?column?': 1 }] : []);
  }
  if (text.includes('FROM collaborations c') && text.includes('c.collaborator_user_id')) {
    const rows = collaborationsRows
      .filter((c) => c.collaborator_user_id === values[0])
      .map((c) => ({ owner_id: c.owner_user_id, name: users[c.owner_user_id].name, username: users[c.owner_user_id].username }));
    return Promise.resolve(rows);
  }
  return Promise.resolve([]);
}
fakeSql.transaction = (queries) => Promise.all(queries);
require.cache[require.resolve('@neondatabase/serverless')] = {
  id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true,
  exports: { neon: () => fakeSql },
};
require.cache[require.resolve('@vercel/blob')] = {
  id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true,
  exports: { put: async () => ({ url: 'https://fake.public.blob.vercel-storage.com/x' }), del: async () => {} },
};
require.cache[require.resolve('@anthropic-ai/sdk')] = {
  id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true,
  exports: class FakeAnthropic { constructor() {} },
};

// Playwright no es una dependencia de producción — si no está instalada
// (por ejemplo, alguien corriendo `npm test` sin haber corrido `npm ci`
// completo) este test se salta en vez de romper el resto de la suite.
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.log('SKIP: playwright no está instalado (correr `npm ci` para tenerlo). Saltando pruebas responsive.');
  process.exit(0);
}

const app = require(serverPath);

function request(server, opts) {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : null;
    const headers = Object.assign({}, opts.headers || {});
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    const host = `127.0.0.1:${server.address().port}`;
    if (!headers['Origin']) headers['Origin'] = `http://${host}`;
    const r = http.request({ hostname: '127.0.0.1', port: server.address().port, path: opts.path, method: opts.method || 'GET', headers }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function login(server) {
  return loginAs(server, 'personadeprueba');
}

async function loginAs(server, username) {
  const resp = await request(server, { path: '/api/login', method: 'POST', body: { username, password: 'claveDePrueba123' } });
  if (resp.status !== 200) throw new Error(`No se pudo loguear "${username}": ${resp.status} ${resp.body}`);
  const raw = resp.headers['set-cookie'][0].split(';')[0]; // "bv_session=TOKEN"
  const idx = raw.indexOf('=');
  return { name: raw.slice(0, idx), value: raw.slice(idx + 1) };
}

const WIDTHS = [320, 390, 768, 1440];
const SCALES = [100, 120, 140];

let ok = true;
function check(cond, label) {
  console.log((cond ? 'OK  ' : 'FAIL'), label);
  if (!cond) ok = false;
}

async function launchChromium() {
  // /opt/pw-browsers/chromium: ruta fija del sandbox de desarrollo donde se
  // escribió este test. En CI (o en cualquier otra máquina) ese path no
  // existe y cae al chromium normal que instala `playwright install`.
  return chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
}

async function checkNav(page, label, w, scale) {
  const info = await page.evaluate(() => {
    const nav = document.querySelector('nav');
    if (!nav) return null;
    const navRect = nav.getBoundingClientRect();
    const interactivos = Array.from(nav.querySelectorAll('a, button'));
    const visibles = interactivos.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 || r.height > 0;
    });
    const fueraDelNav = visibles
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top < navRect.top - 1 || r.bottom > navRect.bottom + 1;
      })
      .map((el) => el.textContent.trim() || el.className);
    const chicos = visibles
      .filter((el) => el.getBoundingClientRect().height < 43.5)
      .map((el) => `${el.textContent.trim() || el.className} (${Math.round(el.getBoundingClientRect().height)}px)`);
    return {
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      fueraDelNav,
      chicos,
      navHeight: navRect.height,
    };
  });
  if (!info) {
    check(false, `${label}: el nav está presente`);
    return;
  }
  check(info.overflowX <= 1, `${label}: sin scroll horizontal (overflow=${info.overflowX}px)`);
  check(info.fueraDelNav.length === 0, `${label}: nada se sale de los límites del nav (${JSON.stringify(info.fueraDelNav)})`);
  check(info.chicos.length === 0, `${label}: todos los targets del nav miden 44px+ de alto (${JSON.stringify(info.chicos)})`);

  // Guarda de regresión: en 320/390px el header llegó a medir 123px (una
  // auditoría de UX lo marcó como que consumía demasiado espacio útil de
  // la pantalla) — se achicó a ~111px sin esconder ningún control ni bajar
  // ningún target de 44px (ver el CSS de .nav-inner en index.html). El
  // límite es más laxo a 140% porque ahí "Iniciar sesión"/"Crear cuenta"
  // pueden necesitar una fila extra — igual sirve para agarrar si alguien
  // vuelve a agregar padding/filas de más sin querer.
  if (w <= 390) {
    const limite = scale >= 140 ? 200 : 130;
    check(info.navHeight <= limite, `${label}: el header no volvió a crecer sin control (alto=${Math.round(info.navHeight)}px, límite=${limite}px)`);
  }
}

async function checkLanding(browser, base, w, scale, screenshotDir) {
  const label = `landing ${w}px @ ${scale}%`;
  const context = await browser.newContext({ viewport: { width: w, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  if (scale !== 100) {
    await page.evaluate((s) => window.bitacoraFontSize.set(s), scale);
    await page.waitForTimeout(120);
  }
  await checkNav(page, label, w, scale);

  // El botón "Ver cómo funciona" salta a #como-funciona — el destino no
  // debe quedar tapado por el nav sticky (bug real que se reprodujo en
  // esta misma sesión, ver commit "Corrige que el nav sticky tape...").
  const link = page.locator('a.btn-secondary[href="#como-funciona"]').first();
  if (await link.isVisible().catch(() => false)) {
    await link.scrollIntoViewIfNeeded();
    await link.click();
    await page.waitForTimeout(1200);
    const anchorInfo = await page.evaluate(() => {
      const nav = document.querySelector('nav');
      const eyebrow = document.getElementById('como-funciona').querySelector('.eyebrow');
      return {
        navBottom: nav.getBoundingClientRect().bottom,
        eyebrowTop: eyebrow ? eyebrow.getBoundingClientRect().top : null,
      };
    });
    check(
      anchorInfo.eyebrowTop === null || anchorInfo.eyebrowTop >= anchorInfo.navBottom - 1,
      `${label}: el destino de "Ver cómo funciona" no queda tapado por el nav`
    );
  }

  await page.screenshot({ path: path.join(screenshotDir, `landing-${w}-${scale}.png`) });
  await context.close();
}

async function checkLogin(browser, base, w, scale, screenshotDir) {
  const label = `login ${w}px @ ${scale}%`;
  const context = await browser.newContext({ viewport: { width: w, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${base}/app.html`, { waitUntil: 'load' });
  await page.waitForSelector('#loginScreen', { state: 'visible' }).catch(() => {});
  if (scale !== 100) {
    await page.evaluate((s) => window.bitacoraFontSize.set(s), scale);
    await page.waitForTimeout(120);
  }
  const info = await page.evaluate(() => {
    const btn = document.getElementById('loginFontIncBtn');
    return {
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      botonAlto: btn ? btn.getBoundingClientRect().height : null,
    };
  });
  check(info.overflowX <= 1, `${label}: sin scroll horizontal (overflow=${info.overflowX}px)`);
  check(info.botonAlto !== null && info.botonAlto >= 43.5, `${label}: A-/A+ mide 44px+ de alto (${info.botonAlto}px)`);
  await page.screenshot({ path: path.join(screenshotDir, `login-${w}-${scale}.png`) });
  await context.close();
}

async function checkCuenta(browser, base, w, scale, sessionCookie, screenshotDir) {
  const label = `cuenta ${w}px @ ${scale}%`;
  const context = await browser.newContext({ viewport: { width: w, height: 900 } });
  await context.addCookies([{ name: sessionCookie.name, value: sessionCookie.value, url: base }]);
  const page = await context.newPage();
  await page.goto(`${base}/app.html`, { waitUntil: 'load' });
  await page.waitForSelector('#appContent', { state: 'visible' }).catch(() => {});
  if (scale !== 100) {
    await page.evaluate((s) => window.bitacoraFontSize.set(s), scale);
    await page.waitForTimeout(120);
  }
  await page.click('#userMenuBtn').catch(() => {});
  await page.waitForTimeout(150);
  // El acordeón no es exclusivo: se pueden abrir "Tamaño de letra" (donde
  // vive el control A-/A+ de esta pantalla) y "Perfil" (donde vive el
  // correo) a la vez, sin que una cierre a la otra.
  await page.click('text=Tamaño de letra').catch(() => {});
  await page.waitForTimeout(150);
  await page.click('text=Perfil').catch(() => {});
  await page.waitForTimeout(150);

  const info = await page.evaluate(() => {
    const email = document.getElementById('umProfileEmail');
    const emailFull = document.getElementById('umProfileEmailFull');
    const incBtn = document.getElementById('umFontIncBtn');
    const emailLegible = email
      ? (emailFull && !emailFull.hidden ? emailFull.textContent === email.value : email.scrollWidth <= email.clientWidth + 1)
      : null;
    return {
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      emailLegible,
      botonAlto: incBtn ? incBtn.getBoundingClientRect().height : null,
    };
  });
  check(info.overflowX <= 1, `${label}: sin scroll horizontal (overflow=${info.overflowX}px)`);
  check(info.emailLegible !== false, `${label}: el correo se ve completo, en el cuadro o en el texto de abajo`);
  check(info.botonAlto !== null && info.botonAlto >= 43.5, `${label}: A-/A+ mide 44px+ de alto (${info.botonAlto}px)`);
  await page.screenshot({ path: path.join(screenshotDir, `cuenta-${w}-${scale}.png`) });
  await context.close();
}

// Nace del mismo reporte que la corrección del audio en iPhone: la página
// de "aportar a otra historia" (colaborar.html?owner=X) tenía su propia fila
// de 3 íconos (distinta del link "← volver a la bitácora" que usan
// arbol.html/capitulos.html/colaboraciones.html/historias.html), mostraba
// "cerrar sesión"/"borrar cuenta" aunque quien la usa ya administra su
// cuenta desde app.html, y "Tus colaboraciones" quedaba pegado al borde
// izquierdo en vez de centrado. Solo corre una vez (no por cada ancho ×
// escala, a diferencia de las de arriba) porque es un chequeo de estructura
// y no de layout responsive — igual se corre en un ancho de escritorio
// (1440px), el mismo en el que se vio el problema original.
async function checkColaborar(browser, server, base, screenshotDir) {
  const sessionCookieDueña = await loginAs(server, 'personadeprueba');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: sessionCookieDueña.name, value: sessionCookieDueña.value, url: base }]);
  const page = await context.newPage();

  // --- Cuenta dueña (con su propia bitácora) de visita en otra historia ---
  await page.goto(`${base}/colaborar.html?owner=2`, { waitUntil: 'load' });
  await page.waitForSelector('#appContent', { state: 'visible' }).catch(() => {});
  await page.waitForTimeout(300);

  const topbarHTML = await page.locator('#ownTopbar').innerHTML().catch(() => '');
  check(/class="volver"/.test(topbarHTML) && !/icon-btn/.test(topbarHTML), 'colaborar (owner=): el topbar tiene un solo link "← volver", no la fila de 3 íconos de antes');
  const logoutRowVisible = await page.locator('#logoutRow').isVisible().catch(() => true);
  check(!logoutRowVisible, 'colaborar (owner=): NO muestra "cerrar sesión"/"borrar cuenta" (eso se maneja desde app.html)');
  const collabBox = await page.locator('#collabSwitch').boundingBox();
  check(
    !!collabBox && Math.abs(collabBox.x - (1440 - (collabBox.x + collabBox.width))) < 30,
    `colaborar (owner=): "Tus colaboraciones" queda centrado, no pegado al borde izquierdo (${collabBox ? `leftGap=${Math.round(collabBox.x)} rightGap=${Math.round(1440 - (collabBox.x + collabBox.width))}` : 'no se encontró la caja'})`
  );
  await page.screenshot({ path: path.join(screenshotDir, 'colaborar-owner-1440.png') });
  await context.close();

  // --- Cuenta 100% colaboradora (sin bitácora propia) en su vista por
  //     defecto: sigue sin topbar, pero conserva "cerrar sesión"/"borrar
  //     cuenta" porque no tiene otro lugar para eso. ---
  const sessionCookieColab = await loginAs(server, 'colabfija');
  const context2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context2.addCookies([{ name: sessionCookieColab.name, value: sessionCookieColab.value, url: base }]);
  const page2 = await context2.newPage();
  await page2.goto(`${base}/colaborar.html`, { waitUntil: 'load' });
  await page2.waitForSelector('#appContent', { state: 'visible' }).catch(() => {});
  await page2.waitForTimeout(300);

  check(!(await page2.locator('#ownTopbar').isVisible().catch(() => false)), 'colaborar (cuenta 100% colaboradora): sigue sin topbar de "volver" (no tiene otra bitácora)');
  check(await page2.locator('#logoutRow').isVisible().catch(() => false), 'colaborar (cuenta 100% colaboradora): SÍ conserva "cerrar sesión"/"borrar cuenta"');
  await page2.screenshot({ path: path.join(screenshotDir, 'colaborar-propia-1440.png') });
  await context2.close();
}

async function main() {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const sessionCookie = await login(server);

  const screenshotDir = path.resolve(__dirname, '..', 'test-artifacts', 'responsive');
  fs.rmSync(screenshotDir, { recursive: true, force: true });
  fs.mkdirSync(screenshotDir, { recursive: true });

  const browser = await launchChromium();

  for (const w of WIDTHS) {
    for (const scale of SCALES) {
      await checkLanding(browser, base, w, scale, screenshotDir);
      await checkLogin(browser, base, w, scale, screenshotDir);
      await checkCuenta(browser, base, w, scale, sessionCookie, screenshotDir);
    }
  }
  await checkColaborar(browser, server, base, screenshotDir);

  await browser.close();
  server.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('ERROR EN LAS PRUEBAS RESPONSIVE:', e);
  process.exit(1);
});
