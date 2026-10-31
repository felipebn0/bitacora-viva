// El árbol completo en el celular: la pantalla no se ensancha, el árbol arranca alejado (ajustado al ancho),
// centrado en la persona principal, y los botones de zoom siguen funcionando.
//   node test/arbol-movil.playwright.js
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright: corre "npm install".'); process.exit(1); }
let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };
const NOMBRES = ['Felipe', 'Fernando', 'Marta', 'Gloria', 'Lope', 'Oscar', 'Paula', 'Camilo', 'María Lucía', 'Santiago', 'Alina', 'Emma', 'Isaac', 'Eugenio', 'Lourdes', 'Gordo', 'Natalia', 'May', 'Ana María', 'Mario', 'Sharon', 'Cornelia', 'Carolina', 'Diego Andrés'];
const REL = { Felipe: 'Yo', Fernando: 'Papá', Marta: 'Mamá', Gloria: 'Hermana', Lope: 'Esposo de Gloria', Oscar: 'Hermano', Paula: 'Esposa de Oscar', Camilo: 'Hermano', 'María Lucía': 'Sobrina', Santiago: 'Sobrino', Alina: 'Sobrina', Emma: 'Sobrina', Isaac: 'Sobrino', Eugenio: 'Abuelo', Lourdes: 'Abuela', Gordo: 'Tío', Natalia: 'Prima', May: 'Tía', 'Ana María': 'Prima', Mario: 'Tío', Sharon: 'Prima', Cornelia: 'Tía', Carolina: 'Prima', 'Diego Andrés': 'Primo' };
const PAD = { Felipe: ['Fernando', 'Marta'], Gloria: ['Fernando', 'Marta'], Oscar: ['Fernando', 'Marta'], Camilo: ['Fernando', 'Marta'], 'María Lucía': ['Gloria', 'Lope'], Santiago: ['Gloria', 'Lope'], Alina: ['Oscar', 'Paula'], Emma: ['Oscar', 'Paula'], Isaac: ['Oscar', 'Paula'], Fernando: ['Eugenio', 'Lourdes'], Gordo: ['Eugenio', 'Lourdes'], May: ['Eugenio', 'Lourdes'], Mario: ['Eugenio', 'Lourdes'], Cornelia: ['Eugenio', 'Lourdes'], Natalia: ['Gordo'], 'Ana María': ['May'], Sharon: ['Mario'], Carolina: ['Cornelia'], 'Diego Andrés': ['May'] };
const people = NOMBRES.map((n, i) => ({ id: i + 1, nombre: n, relacion: REL[n], padres: PAD[n] || [], es_principal: n === 'Felipe' }));

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('eco_tour_done__arbol_html', '1'); } catch (e) { /* nada */ } });
  await page.route('**/api/tree/**', (r) => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route('**/api/tree', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ people, events: [] }) }));
  await page.route('**/api/tree/v4-state', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: { positions: {}, links: [], hiddenPeople: [], photos: {} }, revision: 1 }) }));
  await page.route('**/api/me', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ username: 'felipe', isGuest: false }) }));
  await page.goto(base + '/arbol.html');
  await page.waitForSelector('.eco7-nav button[data-mode="tree"]', { timeout: 10000 });
  await page.click('.eco7-nav button[data-mode="tree"]');
  await page.waitForSelector('#nodes .person', { timeout: 10000 });
  await page.waitForTimeout(600);

  const m = await page.evaluate(() => {
    const st = document.getElementById('stage').getBoundingClientRect();
    const n = document.querySelector('#nodes .person[data-id="1"]').getBoundingClientRect();
    const lado = document.querySelector('.side').getBoundingClientRect();
    return { scroll: document.documentElement.scrollWidth, ancho: innerWidth, zoom: parseInt(document.getElementById('zoomText').textContent, 10), principalDentro: n.left >= st.left - 2 && n.right <= st.right + 2 && n.top >= st.top - 2 && n.bottom <= st.bottom + 2, panelDentro: lado.right <= innerWidth + 1, altoCuadro: Math.round(st.height) };
  });
  ok(m.scroll <= m.ancho, 'la pantalla no se ensancha con el árbol (ancho de la página ' + m.scroll + ' de ' + m.ancho + ')');
  ok(m.zoom < 100 && m.zoom >= 30, 'el árbol arranca alejado (' + m.zoom + '%) para verlo mejor');
  ok(m.principalDentro, 'y la persona principal (Felipe) queda a la vista, en el centro');
  ok(m.panelDentro, 'el panel de la persona cabe completo en la pantalla');
  ok(m.altoCuadro < 500, 'el cuadro del árbol no deja un espacio en blanco enorme (alto ' + m.altoCuadro + 'px)');
  await page.click('#zoomIn');
  const mas = await page.evaluate(() => parseInt(document.getElementById('zoomText').textContent, 10));
  ok(mas > m.zoom, 'con + se acerca (' + mas + '%)');
  await page.click('#zoomReset');
  const reset = await page.evaluate(() => parseInt(document.getElementById('zoomText').textContent, 10));
  ok(reset === m.zoom, 'el botón de restablecer vuelve a ver todo el ancho (' + reset + '%)');
  ok(errores.length === 0, 'sin errores de JavaScript' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close();
  server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
