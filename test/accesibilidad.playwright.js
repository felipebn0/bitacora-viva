// Scan automático de accesibilidad (axe-core) sobre las pantallas
// principales: landing, login y el menú de Cuenta (con sesión real).
//
// No reemplaza una auditoría manual con lector de pantalla (VoiceOver/NVDA
// quedó explícitamente fuera del alcance, ver claude/links.md), pero agarra
// gratis toda la categoría de errores mecánicos que un axe-core sí detecta
// bien: contraste insuficiente, inputs sin label asociado, atributos ARIA
// mal usados, jerarquía de headings rota, etc. — nada de esto se revisaba
// antes de forma automática.
//
// Mismo patrón que test/responsive.playwright.js: levanta el server.js
// real con un mock de @neondatabase/serverless (una sola cuenta de
// prueba) y navega con Playwright + Chromium.
//
//   node test/accesibilidad.playwright.js   (o: npm run test:a11y)

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';

const path = require('path');
const http = require('http');
const bcrypt = require(path.resolve(__dirname, '..', 'node_modules', 'bcryptjs'));

const serverPath = path.resolve(__dirname, '..', 'server.js');

const PASSWORD_HASH = bcrypt.hashSync('claveDePrueba123', 4);
const users = {
  1: {
    id: 1, username: 'personadeprueba', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null,
    name: 'Persona de Prueba', email: 'persona.de.prueba@example.com', fecha_nacimiento: '1950-01-01',
  },
};

function fakeSql(strings, ...values) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = users[1].username === values[0] ? users[1] : null;
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
  if (text.includes('SELECT tree_pending_names FROM users WHERE id')) return Promise.resolve([{ tree_pending_names: null }]);
  if (text.includes('SELECT name, username FROM users WHERE id')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ name: u.name, username: u.username }] : []);
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

let chromium, AxeBuilder;
try {
  ({ chromium } = require('playwright'));
  ({ AxeBuilder } = require('@axe-core/playwright'));
} catch (e) {
  console.log('SKIP: playwright o @axe-core/playwright no están instalados (correr `npm ci`). Saltando scan de accesibilidad.');
  process.exit(0);
}

const app = require(serverPath);

function request(server, opts) {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : null;
    const headers = Object.assign({}, opts.headers || {});
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
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

// Reglas de axe que dependen de contenido/estilo aún no definitivo y que no
// queremos que bloqueen CI por ahora (colores de marca, íconos decorativos
// sin texto todavía revisados a mano) — el resto de las reglas (la enorme
// mayoría: labels, ARIA, estructura, nombres accesibles) sí se exige.
const REGLAS_EXCLUIDAS_POR_AHORA = [];

async function scanPagina(page, url, etiqueta) {
  if (url) {
    await page.goto(url);
    // La landing tiene animaciones "reveal" (fade-up al entrar en
    // viewport, ver .reveal en index.html) que arrancan en opacity:0 y
    // llegan a opacity:1 recién ~700ms después de que el
    // IntersectionObserver las dispara. Escanear antes de que terminen
    // daba un falso positivo de contraste (el color a mitad de transición,
    // no el real una vez asentada la página).
    await page.waitForTimeout(800);
  }
  const resultados = await new AxeBuilder({ page })
    .disableRules(REGLAS_EXCLUIDAS_POR_AHORA)
    .analyze();
  const violaciones = resultados.violations || [];
  check(violaciones.length === 0, `${etiqueta}: sin violaciones de accesibilidad (axe-core)`);
  if (violaciones.length) {
    for (const v of violaciones) {
      console.log(`      - [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} elemento(s)) — ${v.helpUrl}`);
    }
  }
  return violaciones;
}

async function main() {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const cookie = await login(server);

  const browser = await launchChromium();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await scanPagina(page, `${base}/index.html`, 'landing');
    await scanPagina(page, `${base}/colaborar.html`, 'login (colaborar.html sin sesión)');

    await context.addCookies([{ name: cookie.name, value: cookie.value, url: base }]);
    await page.goto(`${base}/app.html`, { waitUntil: 'load' });
    await page.waitForSelector('#appContent', { state: 'visible' }).catch(() => {});
    await scanPagina(page, `${base}/app.html`, 'app.html (charla, con sesión)');

    // El menú de Cuenta es un acordeón dentro de app.html, no una página
    // aparte — lo abrimos para que axe también revise su contenido (hoy
    // queda oculto/no interactuable hasta que se despliega).
    await page.click('#userMenuBtn').catch(() => {});
    await page.waitForTimeout(150);
    await page.click('text=Tamaño de letra').catch(() => {});
    await page.waitForTimeout(150);
    await page.click('text=Perfil').catch(() => {});
    await page.waitForTimeout(150);
    await scanPagina(page, null, 'menú de Cuenta abierto (dentro de app.html)');

    await context.close();
  } finally {
    await browser.close();
    server.close();
  }

  console.log(ok ? '\n✅ Todo OK' : '\n❌ Hay violaciones de accesibilidad sin resolver');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
