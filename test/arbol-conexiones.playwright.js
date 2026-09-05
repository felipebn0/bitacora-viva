// Verifica empíricamente el arreglo de resolverPadresPorNombreParecido()
// en arbol.html (y su contraparte en server.js): el árbol conecta a cada
// persona con sus padres por COINCIDENCIA EXACTA de texto entre "nombre" y
// "padres" — sin ningún ID de por medio. Como esa lista la reescribe la IA
// charla a charla, un nombre escrito con un acento de más/de menos en
// distintas charlas rompía la conexión en silencio: el nodo se seguía
// dibujando, pero suelto, sin línea, y a veces en la fila que no
// correspondía (justo lo reportado: "abuelos paternos desconectados... hay
// gente por ahí volando donde no tiene sentido").
//
// No usa server.js: sirve arbol.html estático y mockea /api/tree con datos
// que reproducen ese caso exacto (una referencia de "padres" con un acento
// distinto al del nombre real), para comprobar con un navegador real que:
//   1. con el casi-igual, la persona queda en la generación correcta (antes
//      quedaba en la misma fila que su propia madre) y se dibuja al menos
//      una línea de más que en el caso roto;
//   2. una referencia que NO se parece a nadie (no un típo de tildes, un
//      nombre distinto de verdad) se deja como está — no se inventan
//      conexiones que no corresponden.
//
//   node test/arbol-conexiones.playwright.js

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

async function filaDeCadaNombre(page) {
  return page.$$eval('.tree-row', (rows) =>
    rows.map((row) => Array.from(row.querySelectorAll('.tree-node strong')).map((el) => el.textContent))
  );
}

async function cargarArbol(browser, base, people) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
  await page.route('**/api/tree', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ people, events: [] }),
  }));
  await page.route('**/api/tree/mark-seen', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route('**/api/tree/colaboradores', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ colaboradores: [] }) }));
  await page.goto(base + '/arbol.html');
  await page.waitForSelector('.tree-node', { timeout: 10000 });
  const filas = await filaDeCadaNombre(page);
  const numLineas = await page.$$eval('.tree-lines line', (els) => els.length);
  await context.close();
  return { filas, numLineas };
}

function filaDe(filas, nombre) {
  return filas.findIndex((fila) => fila.includes(nombre));
}

async function scenarioAcentoCasiIgual(browser, base) {
  console.log('\n--- Escenario 1: "padres" con un acento distinto al del nombre real ---');
  // Pedro es hijo de Alejandrina, pero en algún momento la IA lo guardó
  // como "Alejandrína" (acento de más) — el mismo tipo de casi-igual que
  // se ve entre charlas distintas en la app real.
  const people = [
    { id: 1, nombre: 'Jorge Vargas', relacion: 'principal', padres: ['Pedro Vargas', 'Marta'] },
    { id: 2, nombre: 'Pedro Vargas', relacion: 'papá', padres: ['Alejandrína'] },
    { id: 3, nombre: 'Marta', relacion: 'mamá', padres: [] },
    { id: 4, nombre: 'Alejandrina', relacion: 'abuela paterna', padres: [] },
  ];
  const { filas, numLineas } = await cargarArbol(browser, base, people);

  const filaAlejandrina = filaDe(filas, 'Alejandrina');
  const filaPedro = filaDe(filas, 'Pedro Vargas');
  const filaJorge = filaDe(filas, 'Jorge Vargas');

  assert(filaAlejandrina !== -1 && filaPedro !== -1 && filaJorge !== -1, 'las tres personas aparecen en el árbol (nadie desaparece)');
  assert(filaPedro === filaAlejandrina + 1, `Pedro queda UNA generación por debajo de su mamá Alejandrina, no en la misma fila (Alejandrina=fila ${filaAlejandrina}, Pedro=fila ${filaPedro})`);
  assert(filaJorge === filaPedro + 1, `Jorge queda una generación por debajo de su papá Pedro (Pedro=fila ${filaPedro}, Jorge=fila ${filaJorge})`);
  assert(numLineas >= 2, `se dibujó al menos una línea por cada conexión real de padre/madre (líneas dibujadas: ${numLineas})`);
}

async function scenarioSinParecido(browser, base) {
  console.log('\n--- Escenario 2: "padres" que de verdad no coincide con nadie (no se inventa una conexión) ---');
  const people = [
    { id: 1, nombre: 'Jorge Vargas', relacion: 'principal', padres: ['Pedro Vargas', 'Marta'] },
    { id: 2, nombre: 'Pedro Vargas', relacion: 'papá', padres: ['Alejandra Gómez'] }, // nadie con ese nombre existe
    { id: 3, nombre: 'Marta', relacion: 'mamá', padres: [] },
    { id: 4, nombre: 'Alejandrina', relacion: 'abuela paterna', padres: [] }, // persona real, pero NO es a quien Pedro referenció
  ];
  const { filas } = await cargarArbol(browser, base, people);
  const filaAlejandrina = filaDe(filas, 'Alejandrina');
  const filaPedro = filaDe(filas, 'Pedro Vargas');
  assert(filaAlejandrina !== -1 && filaPedro !== -1, 'ambos siguen apareciendo en el árbol');
  assert(filaPedro === filaAlejandrina, 'sin nada que de verdad se le parezca, Pedro NO se conecta con Alejandrina (quedan en la misma fila, como generación desconocida, en vez de forzar una conexión inventada)');
}

(async () => {
  const server = await startStaticServer();
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const browser = await launchChromium();
  try {
    await scenarioAcentoCasiIgual(browser, base);
    await scenarioSinParecido(browser, base);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? '\n✅ Todo OK' : `\n❌ ${failures} fallo(s)`);
  process.exit(failures === 0 ? 0 : 1);
})();
