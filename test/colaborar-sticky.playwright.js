// Verifica la barra de contexto fija en colaborar.html: con más de una
// historia a la que se puede colaborar (ver #collabSwitch), después de
// bajar un poco la página (pasado el <header> con el nombre grande) no
// quedaba ningún recordatorio de A QUIÉN se le está aportando la historia
// — fácil de olvidar a mitad de grabar. Ahora aparece una barra fija con
// el nombre en cuanto el header original sale de la vista, y desaparece
// al volver a subir.
//
// Mismo patrón que test/responsive.playwright.js: levanta el server.js
// real con un mock de @neondatabase/serverless y un login real.
//
//   node test/colaborar-sticky.playwright.js   (o: npm run test:colaborar-sticky)

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
  2: { id: 2, username: 'otrahistoria', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null, name: 'Nicolás Vargas Galeano' },
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
  if (text.includes('SELECT name, email, fecha_nacimiento FROM users WHERE id')) { const u = users[values[0]]; return Promise.resolve(u ? [{ name: u.name, email: u.email, fecha_nacimiento: u.fecha_nacimiento }] : []); }
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

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.log('SKIP: playwright no está instalado (correr `npm ci`). Saltando prueba de contexto fijo en colaborar.html.');
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

async function main() {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const cookie = await login(server);

  const browser = await launchChromium();
  try {
    // Viewport bajo a propósito (350px): con el contenido real de esta
    // pantalla (charla vacía en una cuenta de prueba nueva) un viewport
    // más alto puede alcanzar a mostrar toda la página sin que sobre
    // nada para scrollear — acá se fuerza que SÍ haya overflow, sin
    // depender de cuánto contenido real termine habiendo.
    const context = await browser.newContext({ viewport: { width: 390, height: 350 } });
    await context.addCookies([{ name: cookie.name, value: cookie.value, url: base }]);
    const page = await context.newPage();
    await page.goto(`${base}/colaborar.html?owner=2`, { waitUntil: 'load' });
    await page.waitForSelector('#appContent', { state: 'visible' });
    await page.waitForTimeout(300);

    const hayOverflow = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 20);
    check(hayOverflow, 'la página tiene contenido de sobra para hacer scroll (si no, el resto de este test no prueba nada real)');

    const hiddenAlPrincipio = await page.$eval('#stickyContext', (el) => el.hidden);
    check(hiddenAlPrincipio, 'al entrar (header a la vista): la barra de contexto fija arranca oculta, no es redundante con el nombre grande ya visible');

    // scrollTo al fondo (no un scrollBy de un valor fijo): así no importa
    // cuánto contenido real termine habiendo en esta pantalla, siempre
    // baja lo más posible.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);
    const infoScrolleado = await page.evaluate(() => ({
      hidden: document.getElementById('stickyContext').hidden,
      texto: document.getElementById('stickyOwnerName').textContent,
    }));
    check(!infoScrolleado.hidden, 'al bajar (header fuera de la vista): la barra de contexto aparece');
    check(infoScrolleado.texto === 'Nicolás Vargas Galeano', `la barra muestra el nombre correcto de la historia (texto: "${infoScrolleado.texto}")`);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const hiddenAlVolver = await page.$eval('#stickyContext', (el) => el.hidden);
    check(hiddenAlVolver, 'al volver a subir (header de nuevo a la vista): la barra de contexto se oculta otra vez');

    await context.close();
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
