// Verifica el arreglo de doLogin() en app.html y colaborar.html: antes,
// tocar "Entrar" (o Enter) con el usuario o la clave vacíos no hacía
// absolutamente nada — ni mensaje, ni foco, ni el botón cambiaba de
// estado ("if (!username || !password) return;"). Alguien peleando con un
// teclado chico, o que tocó el botón sin darse cuenta de que un campo
// estaba vacío, se quedaba sin ninguna pista de qué pasó. Ahora se avisa
// cuál falta (usuario o clave) y se pone el foco justo ahí.
//
// No usa server.js: es puro comportamiento de front-end, así que basta con
// servir public/ estático (sin mockear /api/login siquiera, porque con
// campos vacíos el código nunca debería llegar a hacer el fetch).
//
//   node test/login-vacio.playwright.js   (o: npm run test:login-vacio)

const path = require('path');
const express = require('express');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.log('SKIP: playwright no está instalado (correr `npm ci`). Saltando prueba de login con campos vacíos.');
  process.exit(0);
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

let ok = true;
function check(cond, label) {
  console.log((cond ? 'OK  ' : 'FAIL'), label);
  if (!cond) ok = false;
}

// Cubre las dos pantallas (mismo bug, mismo arreglo, copiado en los dos
// archivos): app.html (dueño) y colaborar.html (colaborador/invitado).
async function probarPantalla(browser, base, url, etiqueta) {
  const context = await browser.newContext();
  const page = await context.newPage();
  let loginRequestDisparado = false;
  await page.route('**/api/login', (route) => {
    loginRequestDisparado = true;
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  // /api/me sin sesión -> 401, para que arranque directo en loginScreen en
  // vez de quedarse en "Comprobando tu sesión…" esperando de verdad.
  await page.route('**/api/me', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"No autenticado."}' }));

  await page.goto(`${base}${url}`, { waitUntil: 'load' });
  await page.waitForSelector('#loginScreen', { state: 'visible' });

  // --- Caso 1: los dos campos vacíos -> avisa que falta el usuario, foco ahí ---
  await page.click('#loginBtn');
  await page.waitForTimeout(150);
  let info = await page.evaluate(() => ({
    mensaje: document.getElementById('loginError').textContent,
    focoEnUsuario: document.activeElement === document.getElementById('loginUser'),
    botonSigueHabilitado: !document.getElementById('loginBtn').disabled,
  }));
  check(!loginRequestDisparado, `${etiqueta}: con los dos campos vacíos, no se llega a mandar el pedido a /api/login`);
  check(!!info.mensaje, `${etiqueta}: con los dos campos vacíos, aparece un mensaje (antes: nada) — "${info.mensaje}"`);
  check(info.focoEnUsuario, `${etiqueta}: con los dos campos vacíos, el foco queda en el campo de usuario`);
  check(info.botonSigueHabilitado, `${etiqueta}: el botón "Entrar" no queda trabado deshabilitado`);

  // --- Caso 2: usuario cargado, clave vacía -> avisa que falta la clave, foco ahí ---
  await page.fill('#loginUser', 'alguien@example.com');
  await page.click('#loginBtn');
  await page.waitForTimeout(150);
  info = await page.evaluate(() => ({
    mensaje: document.getElementById('loginError').textContent,
    focoEnClave: document.activeElement === document.getElementById('loginPass'),
  }));
  check(!loginRequestDisparado, `${etiqueta}: con la clave vacía, tampoco se manda el pedido a /api/login`);
  check(!!info.mensaje, `${etiqueta}: con la clave vacía, aparece un mensaje — "${info.mensaje}"`);
  check(info.focoEnClave, `${etiqueta}: con la clave vacía, el foco queda en el campo de clave`);

  // --- Caso 3: los dos campos cargados -> ahora sí se manda el pedido ---
  await page.fill('#loginPass', 'unaClaveCualquiera');
  await page.click('#loginBtn');
  await page.waitForTimeout(200);
  check(loginRequestDisparado, `${etiqueta}: con los dos campos cargados, el login sigue funcionando normal (se manda el pedido)`);

  await context.close();
}

async function main() {
  const server = await startStaticServer();
  const base = `http://localhost:${server.address().port}`;
  const browser = await launchChromium();
  try {
    await probarPantalla(browser, base, '/app.html', 'app.html');
    await probarPantalla(browser, base, '/colaborar.html', 'colaborar.html');
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
