// El "Árbol completo" real (public/arbol.html con sus scripts): con posiciones guardadas en
// desorden, abuelos arriba, padres en la fila siguiente e hijos debajo; las tarjetas movidas
// a mano se respetan; y "Organizar árbol" manda las posiciones jerárquicas al servidor.
//   node test/arbol-jerarquia.playwright.js
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright: corre "npm install".'); process.exit(1); }

let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };

const people = [
  { id: 1, nombre: 'Felipe', relacion: 'Yo', padres: ['Carlos Bernal', 'Marta Nisperuza'], es_principal: true },
  { id: 2, nombre: 'Carlos Bernal', relacion: 'Papá', padres: ['Abuelo Pedro', 'Abuela Rosa'] },
  { id: 3, nombre: 'Marta Nisperuza', relacion: 'Mamá', padres: [] },
  { id: 4, nombre: 'Abuelo Pedro', relacion: 'Abuelo', padres: [] },
  { id: 5, nombre: 'Abuela Rosa', relacion: 'Abuela', padres: [] },
  { id: 6, nombre: 'Tío Luis', relacion: 'Tío', padres: ['Abuelo Pedro', 'Abuela Rosa'] },
  { id: 7, nombre: 'Prima Eva', relacion: 'Prima', padres: ['Tío Luis'] },
  { id: 8, nombre: 'Abuela Lola', relacion: 'Abuela materna', padres: [] },
];
// Posiciones guardadas de antes, todas mezcladas en una sola fila (como se ve hoy).
const guardadas = {};
people.forEach((p, i) => { guardadas[p.id] = { x: 40 + i * 228, y: 55 }; });

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  let guardadoPut = null;
  await page.route('**/api/tree/**', (r) => r.fulfill({ contentType: 'application/json', body: '{}' }));
  const estado = { positions: JSON.parse(JSON.stringify(guardadas)), links: [], hiddenPeople: [], photos: {} };
  await page.route('**/api/tree', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ people, events: [] }) }));
  await page.route('**/api/tree/v4-state', (r) => {
    if (r.request().method() === 'PUT') { guardadoPut = JSON.parse(r.request().postData()); return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ revision: 2 }) }); }
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: estado, revision: 1 }) });
  });
  await page.route('**/api/me', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ username: 'felipe', isGuest: false }) }));
  await page.goto(base + '/arbol.html');
  await page.waitForSelector('.eco7-nav button[data-mode="tree"]', { timeout: 10000 });
  await page.click('.eco7-nav button[data-mode="tree"]');
  await page.waitForSelector('#nodes .person', { timeout: 10000 });

  const pos = async () => page.$$eval('#nodes .person', (els) => Object.fromEntries(els.map((e) => [e.dataset.id, { x: parseInt(e.style.left, 10), y: parseInt(e.style.top, 10) }])));
  let p = await pos();
  ok(Object.keys(p).length === 8, 'las 8 personas se dibujan');
  ok(p[4].y < p[2].y && p[5].y < p[2].y, 'los abuelos paternos quedan arriba de su hijo (aunque lo guardado estaba en una sola fila)');
  ok(p[2].y === p[3].y && p[2].y === p[6].y, 'papá, mamá y tío en la misma fila, aunque la mamá no tenga padres registrados');
  ok(p[8].y === p[4].y, 'la abuela materna sin vínculos (relación "Abuela materna") queda en la fila de los abuelos');
  ok(p[1].y > p[2].y && p[7].y === p[1].y, 'la persona principal y su prima en la fila de los hijos');
  const filas = new Set(Object.values(p).map((q) => q.y));
  ok(filas.size === 3, 'son 3 generaciones: abuelos, padres e hijos (' + filas.size + ')');
  const solapes = Object.values(p).some((a, i, arr) => arr.some((b, j) => j > i && a.y === b.y && Math.abs(a.x - b.x) < 200));
  ok(!solapes, 'ninguna tarjeta tapa a otra');
  await page.screenshot({ path: process.env.ARBOL_SHOT || '/tmp/arbol-jerarquia.png' });

  // Esposos: al seleccionar a uno aparece una línea punteada hacia el otro.
  const lineas = () => page.$$eval('#wires path', (ps) => ps.map((x) => ({ d: x.getAttribute('d'), punteada: !!x.getAttribute('stroke-dasharray'), pareja: x.classList.contains('eco-pareja') })));
  ok(!(await lineas()).some((l) => l.pareja), 'con la persona principal seleccionada (sin pareja) no hay línea punteada');
  await page.click('#nodes .person[data-id="2"]');
  await page.waitForTimeout(300);
  let ls = await lineas();
  const pareja = ls.find((l) => l.pareja);
  if (process.env.ARBOL_SHOT2) await page.screenshot({ path: process.env.ARBOL_SHOT2 });
  ok(!!pareja && pareja.punteada, 'al seleccionar a Carlos, su esposa Marta (con quien tiene un hijo) se conecta con una línea punteada');
  ok(!!pareja && /^M \d+ \d+ L \d+ \d+$/.test(pareja.d) && pareja.d.split(' ')[2] === pareja.d.split(' ')[5], 'la línea de pareja es recta y horizontal entre las dos tarjetas');
  ok(ls.some((l) => !l.punteada), 'y las líneas de padres e hijos siguen siendo continuas');
  await page.click('#nodes .person[data-id="7"]');
  await page.waitForTimeout(300);
  ok(!(await lineas()).some((l) => l.pareja), 'quien no tiene pareja no muestra línea punteada');

  // Una tarjeta movida a mano se respeta.
  const caja = await page.locator('#nodes .person[data-id="7"]').boundingBox();
  await page.mouse.move(caja.x + 40, caja.y + 20);
  await page.mouse.down();
  await page.mouse.move(caja.x + 40, caja.y + 120, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  const antes = p[7];
  p = await pos();
  ok(p[7].y > antes.y + 60, 'arrastrar una tarjeta la mueve');
  await page.click('#nodes .person[data-id="1"]');
  await page.waitForTimeout(300);
  const despues = await pos();
  ok(despues[7].y === p[7].y && despues[7].x === p[7].x, 'y seguir usando el árbol no la devuelve a su lugar');
  ok(guardadoPut && guardadoPut.state.positions['7'] && guardadoPut.state.positions['7'].m === 1, 'se guarda marcada como movida a mano');

  // Organizar árbol: manda posiciones jerárquicas y sin marcas manuales.
  guardadoPut = null;
  page.on('dialog', (d) => d.accept());
  await page.click('.eco7-organize');
  await page.waitForTimeout(800);
  const nuevas = guardadoPut && guardadoPut.state.positions;
  ok(nuevas && nuevas[4].y < nuevas[2].y && nuevas[2].y < nuevas[1].y && nuevas[2].y === nuevas[3].y, 'Organizar árbol guarda abuelos arriba, padres en medio e hijos abajo');
  ok(nuevas && !Object.values(nuevas).some((q) => q.m), 'y borra las marcas de tarjetas movidas a mano');
  ok(errores.length === 0, 'sin errores de JavaScript' + (errores.length ? ': ' + errores.join(' | ') : ''));

  await browser.close();
  server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
