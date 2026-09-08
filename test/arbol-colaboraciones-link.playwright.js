// Verifica que las tarjetas de "Quiénes han colaborado" en arbol.html
// lleven a colaboraciones.html filtrado a esa persona — antes eran
// tarjetas sueltas sin ningún destino; ahora cada una es un enlace a
// /colaboraciones.html?colaborador=<nombre>, y esa página, al recibir ese
// parámetro, muestra solo lo que aportó esa persona (ver aplicarFiltro /
// filtroColaborador en colaboraciones.html).
//
// Tres escenarios:
//   1. arbol.html: cada tarjeta de colaborador es un <a> con el href
//      correcto y una etiqueta accesible con el nombre.
//   2. colaboraciones.html con ?colaborador=Felipe: se oculta la grilla de
//      "Quiénes han colaborado" (ya se sabe de quién es esta pantalla), se
//      ve el aviso de filtro, el título cambia, y la lista de aportes
//      muestra SOLO lo que aportó Felipe (no lo de Ana) — con un enlace
//      para volver a ver todos.
//   3. colaboraciones.html con un ?colaborador= que no coincide con nadie:
//      no rompe nada, muestra "No se encontraron aportes de…" (por
//      textContent, no por innerHTML con el nombre metido en el string —
//      el nombre viaja en la URL, así que es dato no confiable).
//
// No usa server.js: las dos páginas se sirven estáticas y /api/* se
// intercepta con page.route() (mismo patrón que
// test/arbol-conexiones.playwright.js).
//
//   node test/arbol-colaboraciones-link.playwright.js
//   (o: npm run test:arbol-colab-link)

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

const COLABORADORES = [
  { nombre: 'Felipe', parentesco: 'Amigo', historias: 3 },
  { nombre: 'Ana', parentesco: 'Hija', historias: 1 },
];

const NOTES = [
  { id: 1, contributor: 'Felipe', parentesco: 'Amigo', protagonista: null, texto: 'Historia 1 de Felipe', audio_url: null, audio_urls: [], media_urls: [] },
  { id: 2, contributor: 'Felipe', parentesco: 'Amigo', protagonista: 'la abuela', texto: 'Historia 2 de Felipe', audio_url: null, audio_urls: [], media_urls: [] },
  { id: 3, contributor: 'Ana', parentesco: 'Hija', protagonista: null, texto: 'Historia de Ana', audio_url: null, audio_urls: [], media_urls: [] },
];

async function scenarioTarjetaEsEnlace(browser, base) {
  console.log('\n--- Escenario 1: en arbol.html, cada tarjeta de colaborador es un enlace ---');
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
  await page.route('**/api/tree', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ people: [], events: [] }) }));
  await page.route('**/api/tree/mark-seen', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route('**/api/tree/colaboradores', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ colaboradores: COLABORADORES }) }));
  await page.goto(base + '/arbol.html');
  await page.waitForSelector('.colab-card');

  const tarjetas = await page.$$eval('.colab-card', (els) =>
    els.map((el) => ({ tag: el.tagName, href: el.getAttribute('href'), ariaLabel: el.getAttribute('aria-label'), texto: el.textContent }))
  );
  assert(tarjetas.length === 2, `se dibujaron las 2 tarjetas de colaboradores (se contaron ${tarjetas.length})`);

  const felipe = tarjetas.find((t) => /Felipe/.test(t.texto));
  assert(!!felipe, 'la tarjeta de Felipe existe');
  assert(felipe.tag === 'A', `la tarjeta es un <a>, no un <div> suelto (era ${felipe.tag})`);
  assert(felipe.href === '/colaboraciones.html?colaborador=Felipe', `el href lleva a colaboraciones.html filtrado a Felipe (era "${felipe.href}")`);
  assert(/Felipe/.test(felipe.ariaLabel || ''), 'lleva una etiqueta accesible que menciona a Felipe, para lectores de pantalla');

  await context.close();
}

async function abrirColaboraciones(browser, base, queryString) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
  await page.route('**/api/tree/colaboradores', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ colaboradores: COLABORADORES }) }));
  await page.route('**/api/contributions', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ notes: NOTES, media: [] }) }));
  await page.goto(base + '/colaboraciones.html' + (queryString || ''));
  await page.waitForSelector('#aportesLista .aporte-item, #aportesLista .empty');
  return { context, page };
}

async function scenarioFiltradoPorPersona(browser, base) {
  console.log('\n--- Escenario 2: colaboraciones.html?colaborador=Felipe muestra solo lo suyo ---');
  const { context, page } = await abrirColaboraciones(browser, base, '?colaborador=' + encodeURIComponent('Felipe'));

  const tituloTexto = await page.textContent('#pageTitle');
  assert(tituloTexto === 'Aportes de Felipe', `el título cambia a "Aportes de Felipe" (era "${tituloTexto}")`);

  const colabSeccionOculta = await page.isHidden('#colaboradoresSection');
  assert(colabSeccionOculta, 'la grilla de "Quiénes han colaborado" queda oculta (ya se sabe de quién es esta pantalla)');

  const avisoVisible = await page.isVisible('#filtroAviso');
  assert(avisoVisible, 'se ve el aviso de que la lista está filtrada');
  const avisoTexto = await page.textContent('#filtroAvisoTexto');
  assert(/Felipe/.test(avisoTexto), 'el aviso menciona a Felipe por su nombre');

  const items = await page.$$eval('#aportesLista .aporte-item .texto', (els) => els.map((el) => el.textContent));
  assert(items.length === 2, `se ven las 2 historias de Felipe (se contaron ${items.length})`);
  assert(items.every((t) => /Felipe/.test(t)), 'ninguna de las historias mostradas es de otra persona');
  assert(!items.some((t) => /Ana/.test(t)), 'la historia de Ana no aparece en la lista filtrada de Felipe');

  const verTodosHref = await page.getAttribute('#filtroAviso a', 'href');
  assert(verTodosHref === '/colaboraciones.html', `el enlace "ver todos" saca el filtro (href="${verTodosHref}")`);

  await context.close();
}

async function scenarioSinFiltroSigueIgual(browser, base) {
  console.log('\n--- Escenario 3: sin ?colaborador=, colaboraciones.html se ve igual que siempre ---');
  const { context, page } = await abrirColaboraciones(browser, base, '');

  const colabSeccionVisible = await page.isVisible('#colaboradoresSection');
  assert(colabSeccionVisible, 'sin filtro, la grilla de "Quiénes han colaborado" se sigue viendo');
  const avisoOculto = await page.isHidden('#filtroAviso');
  assert(avisoOculto, 'sin filtro, no aparece ningún aviso de filtro');

  const items = await page.$$eval('#aportesLista .aporte-item', (els) => els.length);
  assert(items === 3, `se ven las 3 historias, de todos los colaboradores (se contaron ${items})`);

  await context.close();
}

async function scenarioFiltroSinCoincidencias(browser, base) {
  console.log('\n--- Escenario 4: ?colaborador= que no coincide con nadie no rompe nada ---');
  const { context, page } = await abrirColaboraciones(browser, base, '?colaborador=' + encodeURIComponent('Nadie De Verdad'));

  const mensaje = await page.textContent('#aportesLista .empty');
  assert(mensaje === 'No se encontraron aportes de Nadie De Verdad.', `muestra el mensaje de "no se encontraron" con el nombre correcto (era "${mensaje}")`);

  await context.close();
}

async function scenarioNombreConHtmlEnLaUrl(browser, base) {
  console.log('\n--- Escenario 5: un nombre con HTML en la URL no se ejecuta (colaborador viaja como texto, no como innerHTML) ---');
  const payload = '<img src=x onerror="window.__xss=true">';
  const { context, page } = await abrirColaboraciones(browser, base, '?colaborador=' + encodeURIComponent(payload));
  await page.waitForTimeout(200); // le da tiempo a un onerror real, si lo hubiera, a dispararse

  const xssDisparado = await page.evaluate(() => window.__xss === true);
  assert(!xssDisparado, 'el "onerror" del nombre no se ejecutó — no se coló como HTML');

  const imgInyectada = await page.$$eval('#aportesLista img, #filtroAviso img, #pageTitle img', (els) => els.length);
  assert(imgInyectada === 0, 'no se creó ningún <img> real a partir del nombre — quedó como texto plano');

  const tituloTexto = await page.textContent('#pageTitle');
  assert(tituloTexto === `Aportes de ${payload}`, 'el título muestra el nombre tal cual, como texto (sin interpretarlo como HTML)');

  await context.close();
}

(async () => {
  const server = await startStaticServer();
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const browser = await launchChromium();
  try {
    await scenarioTarjetaEsEnlace(browser, base);
    await scenarioFiltradoPorPersona(browser, base);
    await scenarioSinFiltroSigueIgual(browser, base);
    await scenarioFiltroSinCoincidencias(browser, base);
    await scenarioNombreConHtmlEnLaUrl(browser, base);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? '\n✅ Todo OK' : `\n❌ ${failures} fallo(s)`);
  process.exit(failures === 0 ? 0 : 1);
})();
