// Verifica la sección "Instalación" del panel de Cuenta en app.html
// (agregar la charla a la pantalla de inicio) — antes esto solo existía
// para quien entraba con el enlace permanente de un subperfil
// (#accesoDirectoRow); ahora también aparece dentro de Cuenta (en
// "Opciones avanzadas") para la cuenta dueña normal.
//
// Es siempre una guía manual, para iPhone y para el resto por igual — en
// iPhone porque Apple no da ninguna forma de disparar este paso con
// código, y en Android/Chrome porque esta app todavía no tiene un
// "service worker" registrado (requisito de Chrome para que llegue a
// disparar beforeinstallprompt), así que no se ofrece ningún botón de un
// solo toque acá que en la práctica nunca aparecería (ver
// configurarSeccionInstalacion en app.html).
//
// Tres escenarios, cada uno con su propio user agent (Playwright permite
// fijar el user agent por contexto de navegador):
//   1. iPhone + Safari: 3 pasos (compartir → "Ver más" → "Añadir a
//      pantalla de inicio"), con la nota de que queda en pantalla completa.
//   2. iPhone + Chrome (CriOS en el user agent): 2 pasos distintos (menú ⋮
//      → "Añadir a pantalla de inicio"), con la nota de que Chrome NO deja
//      pantalla completa.
//   3. Android/escritorio: se ve siempre la instrucción manual (menú ⋮),
//      incluso si el navegador llega a disparar beforeinstallprompt (ese
//      evento solo se usa en #accesoDirectoRow, no acá).
//
// No usa server.js: app.html se sirve estático y todas las llamadas a
// /api/* se interceptan con page.route() (mismo patrón que
// test/pause-resume.playwright.js) — esta sección no depende de ningún
// dato del servidor, solo del user agent.
//
//   node test/instalacion-cuenta.playwright.js   (o: npm run test:instalacion)

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

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log('✓ ' + msg);
  } else {
    failures++;
    console.error('✗ ' + msg);
  }
}

const UA_IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1';
const UA_ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

async function abrirPanelDeCuenta(browser, base, userAgent) {
  const context = await browser.newContext({ userAgent });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('  [pageerror]', e.message));

  await page.route('**/api/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ isCollaborator: false, username: 'tester', name: 'Tester', email: 't@example.com', fechaNacimiento: null }),
  }));

  await page.goto(base + '/app.html');
  await page.waitForSelector('#appContent', { state: 'visible' });
  await page.click('#userMenuBtn');
  // "Instalación" vive dentro del acordeón anidado "Opciones avanzadas"
  // (experimento UX de ux-pruebas) — hay que abrir ese primero.
  await page.click('button[aria-controls="umSecAvanzadas"]');
  await page.click('button[aria-controls="umSecInstalacion"]');
  await page.waitForSelector('#umSecInstalacion', { state: 'visible' });
  return { context, page };
}

async function scenarioIphoneSafari(browser, base) {
  console.log('\n--- Escenario 1: iPhone + Safari (3 pasos, nota de pantalla completa) ---');
  const { context, page } = await abrirPanelDeCuenta(browser, base, UA_IPHONE_SAFARI);

  const iosVisible = await page.isVisible('#umInstalIOS');
  const otrosOculto = await page.isHidden('#umInstalOtros');
  assert(iosVisible, 'se muestra el bloque de instrucciones de iPhone');
  assert(otrosOculto, 'el bloque de Android/otros queda oculto');

  const pasos = await page.$$eval('#umInstalIOSPasos li', (els) => els.map((el) => el.textContent));
  assert(pasos.length === 3, `Safari muestra 3 pasos (compartir → Ver más → Añadir) — se contaron ${pasos.length}`);
  assert(pasos.some((p) => /compartir/i.test(p)), 'el paso 1 menciona el ícono de compartir');
  assert(pasos.some((p) => /ver más/i.test(p)), 'el paso 2 menciona "Ver más"');
  assert(pasos.some((p) => /añadir a pantalla de inicio/i.test(p)), 'el paso final menciona "Añadir a pantalla de inicio"');

  const nota = await page.textContent('#umInstalIOSNota');
  assert(/pantalla completa/i.test(nota), 'la nota aclara que con Safari queda en pantalla completa');

  await context.close();
}

async function scenarioIphoneChrome(browser, base) {
  console.log('\n--- Escenario 2: iPhone + Chrome (CriOS) — 2 pasos, nota distinta ---');
  const { context, page } = await abrirPanelDeCuenta(browser, base, UA_IPHONE_CHROME);

  const pasos = await page.$$eval('#umInstalIOSPasos li', (els) => els.map((el) => el.textContent));
  assert(pasos.length === 2, `Chrome en iPhone muestra 2 pasos (menú → Añadir), no los 3 de Safari — se contaron ${pasos.length}`);
  assert(pasos.some((p) => /menú/i.test(p)), 'el paso 1 menciona el menú de Chrome, no el ícono de compartir de Safari');

  const nota = await page.textContent('#umInstalIOSNota');
  assert(/barra de direcciones/i.test(nota), 'la nota para Chrome aclara que NO queda en pantalla completa (se sigue viendo la barra de direcciones)');
  assert(!/pantalla completa/i.test(nota) || /Safari/i.test(nota), 'la nota de Chrome no afirma pantalla completa como si fuera Safari');

  await context.close();
}

async function scenarioAndroidSiempreManual(browser, base) {
  console.log('\n--- Escenario 3: Android — siempre instrucción manual, incluso si llega beforeinstallprompt ---');
  const { context, page } = await abrirPanelDeCuenta(browser, base, UA_ANDROID_CHROME);

  const iosOculto = await page.isHidden('#umInstalIOS');
  let otrosVisible = await page.isVisible('#umInstalOtros');
  let fallbackVisible = await page.isVisible('#umInstalarFallback');
  assert(iosOculto, 'en Android no se muestra el bloque de instrucciones de iPhone');
  assert(otrosVisible, 'se muestra el bloque de Android/otros');
  assert(fallbackVisible, 'se ve la instrucción manual (menú ⋮ → Agregar a pantalla de inicio)');
  assert((await page.$('#umInstalarBtn')) === null, 'no existe ningún botón de "un solo toque" en esta sección — prometerlo sería mentir: la app no tiene service worker, así que Chrome nunca dispara beforeinstallprompt acá');

  // Aunque el navegador SÍ llegue a ofrecer instalar (simulado, ya que
  // Playwright no puede disparar el heurístico real de Chrome), la sección
  // "Instalación" de Cuenta no cambia — ese evento solo lo consume
  // #accesoDirectoRow (enlace de subperfil), un mecanismo aparte.
  await page.evaluate(() => {
    const ev = new Event('beforeinstallprompt', { cancelable: true });
    ev.prompt = () => Promise.resolve();
    ev.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(ev);
  });
  await page.waitForTimeout(100);

  otrosVisible = await page.isVisible('#umInstalOtros');
  fallbackVisible = await page.isVisible('#umInstalarFallback');
  assert(otrosVisible, 'después de beforeinstallprompt, la sección de Cuenta sigue mostrando el bloque de Android/otros');
  assert(fallbackVisible, 'después de beforeinstallprompt, la instrucción manual sigue ahí — no aparece ningún botón nuevo');

  await context.close();
}

(async () => {
  const server = await startStaticServer();
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const browser = await launchChromium();
  try {
    await scenarioIphoneSafari(browser, base);
    await scenarioIphoneChrome(browser, base);
    await scenarioAndroidSiempreManual(browser, base);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? '\n✅ Todo OK' : `\n❌ ${failures} fallo(s)`);
  process.exit(failures === 0 ? 0 : 1);
})();
