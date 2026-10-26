// Perfiles: "Agregar un perfil" con selector (familiar, mascota o bebé), y contar la vida de la mascota o del bebé desde app.html.
//   node test/perfil-mascota.playwright.js   (o: npm run test:perfil-mascota)
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright: corre "npm install".'); process.exit(1); }
let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };
const CAPTURAS = process.env.CAPTURAS_MASCOTA;

// Textos de los botones de la fila en el orden en que se ven (de izquierda a derecha).
const enOrden = (page) => page.locator('.eco-especiales button:visible').evaluateAll((bs) => bs.sort((a, b) => Math.round(a.getBoundingClientRect().top / 10) - Math.round(b.getBoundingClientRect().top / 10) || a.getBoundingClientRect().left - b.getBoundingClientRect().left).map((b) => b.textContent.trim()));

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1100 } });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  const perfiles = [
    { id: 1, nombre: 'Felipe', esPropia: true },
    { id: 50, nombre: 'Papá', relacion: 'Papá', tratamiento: 'masculino', tieneOnboarding: false, esPropia: false },
  ];
  let creado = null;
  await page.route('**/api/**', (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/me') return json({ username: 'felipe', name: 'Felipe', email: 'f@x.com', isCollaborator: false, isGuest: false, puedeNarrar: true, bitacoraActiva: globalThis.__activa || null });
    if (u.pathname === '/api/subprofiles' && req.method() === 'GET') return json({ perfiles });
    if (u.pathname === '/api/subprofiles' && req.method() === 'POST') {
      creado = JSON.parse(req.postData());
      if (creado.tipo === 'bebe') {
        perfiles.push({ id: 78, nombre: 'Rafaela', tratamiento: creado.tratamiento, esPropia: false, tipo: 'bebe', estado: creado.nacioEn ? 'nacida' : 'en_camino' });
        return json({ ok: true, id: 78, nombre: 'Rafaela' });
      }
      perfiles.push({ id: 77, nombre: 'Roma', tratamiento: creado.tratamiento, tieneOnboarding: false, esPropia: false, tipo: 'mascota', especie: creado.especie, raza: creado.raza });
      return json({ ok: true, id: 77, nombre: 'Roma' });
    }
    if (u.pathname.includes('/narrador-link')) return json({ enlace: null, activo: false });
    return json({});
  });

  await page.goto(base + '/perfiles.html');
  await page.waitForSelector('#nuevaSection');
  ok(await page.isVisible('#grupoFamiliar') && await page.isHidden('#grupoMascota') && await page.isHidden('#grupoBebe'), 'Agregar un perfil: por defecto se ven las opciones de familiar');
  await page.selectOption('#tipoPerfil', 'mascota');
  ok(await page.isHidden('#grupoFamiliar') && await page.isVisible('#grupoMascota') && await page.isHidden('#grupoBebe') && /mascota|ella|su vida/i.test(await page.textContent('#nuevoSub')), 'al elegir mascota solo se ven las opciones de mascota');
  await page.selectOption('#tipoPerfil', 'bebe');
  ok(await page.isHidden('#grupoFamiliar') && await page.isHidden('#grupoMascota') && await page.isVisible('#grupoBebe') && await page.isHidden('#bebeFechaCampo'), 'al elegir bebé solo se ven las opciones de bebé (la fecha aparece al marcar "Ya nació")');
  await page.selectOption('#tipoPerfil', 'mascota');
  await page.click('#mascotaBtn');
  ok(/nombre/i.test(await page.textContent('#mascotaMsg')), 'sin nombre no deja crear la mascota');
  await page.fill('#mascotaNombre', 'roma');
  await page.click('#mascotaBtn');
  ok(/macho o hembra/i.test(await page.textContent('#mascotaMsg')), 'pide elegir macho o hembra');
  await page.selectOption('#mascotaSexo', 'femenino');
  await page.fill('#mascotaRaza', 'Criolla');
  await page.click('#mascotaBtn');
  await page.waitForSelector('.perfil-card:has-text("Roma")');
  ok(creado && creado.tipo === 'mascota' && creado.especie === 'perro' && creado.raza === 'Criolla' && creado.tratamiento === 'femenino', 'crea la mascota con tipo, especie, raza y sexo');
  const tarjeta = page.locator('.perfil-card', { hasText: 'Roma' });
  ok((await tarjeta.textContent()).includes('perro · Criolla'), 'la lista muestra "perro · Criolla"');
  ok(await tarjeta.locator('a[href*="perfilar.html"]').count() === 0 && await tarjeta.locator('.trato-fila').count() === 0, 'a la mascota no se le ofrece lo de "contarle a la IA sobre esta persona" ni el trato');
  ok(await page.locator('.perfil-card', { hasText: 'Papá' }).locator('a[href*="perfilar.html"]').count() === 1, 'las personas siguen igual');
  await page.selectOption('#tipoPerfil', 'bebe');
  await page.click('#bebeBtn');
  ok(/nombre/i.test(await page.textContent('#bebeMsg')), 'bebé: sin nombre no deja crear');
  await page.fill('#bebeNombre', 'rafaela');
  await page.selectOption('#bebeSexo', 'femenino');
  await page.click('#bebeBtn');
  await page.waitForSelector('.perfil-card:has-text("Rafaela")');
  ok(creado && creado.tipo === 'bebe' && creado.nombre === 'rafaela' && creado.tratamiento === 'femenino' && creado.nacioEn === null, 'crea el bebé como perfil: tipo bebé, niña y todavía en camino');
  ok((await page.locator('.perfil-card', { hasText: 'Rafaela' }).textContent()).includes('Bebé · en camino'), 'la lista muestra "Bebé · en camino"');
  ok(await page.locator('.perfil-card', { hasText: 'Rafaela' }).locator('a[href*="perfilar.html"]').count() === 0, 'y al bebé tampoco se le ofrece lo de "contarle a la IA sobre esta persona"');
  await page.fill('#bebeNombre', 'Tomás');
  await page.check('#bebeNacio');
  ok(await page.isVisible('#bebeFechaCampo') && (await page.inputValue('#bebeFecha')).length === 10, 'al marcar "Ya nació" aparece la fecha, con la de hoy');
  await page.click('#bebeBtn');
  const tb = Date.now(); while (!(creado && creado.nacioEn) && Date.now() - tb < 4000) await page.waitForTimeout(50);
  ok(creado.nacioEn === new Date().toISOString().slice(0, 10), 'si ya nació, viaja la fecha de nacimiento');
  if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, 'perfiles-mascota.png'), fullPage: true });

  // app.html con la mascota activa
  await page.evaluate(() => { globalThis.__activa = null; });
  const p2 = await ctx.newPage();
  p2.on('pageerror', (e) => errores.push(e.message));
  await p2.route('**/api/**', (route) => {
    const u = new URL(route.request().url());
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/me') return json({ username: 'felipe', name: 'Felipe', email: 'f@x.com', isCollaborator: false, isGuest: false, puedeNarrar: true, bitacoraActiva: { id: 77, nombre: 'Roma', tipo: 'mascota', especie: 'perro' } });
    if (u.pathname === '/api/subprofiles') return json({ perfiles: [{ id: 1, nombre: 'Felipe Bernal', esPropia: true }, { id: 77, nombre: 'Roma', esPropia: false, tipo: 'mascota', especie: 'perro' }], diarioBebe: { nombre: 'Luna', genero: 'femenino', estado: 'en_camino' } });
    return json({});
  });
  await p2.goto(base + '/app.html');
  await p2.waitForSelector('#subperfilBanner', { state: 'visible', timeout: 8000 });
  ok(/Estás contando la vida de Roma/.test(await p2.textContent('#subperfilBannerTexto')), 'app: el aviso dice que estás contando la vida de Roma');
  ok(await p2.isVisible('#orb'), 'app: el botón de hablar sigue visible');
  await p2.waitForSelector('.eco-especiales .eco-pill-propia', { timeout: 8000 });
  await p2.waitForTimeout(700);
  const mascotaTema = await p2.evaluate(() => ({ clase: document.documentElement.classList.contains('eco-mascota-activo'), fondo: getComputedStyle(document.body).backgroundColor, orbe: getComputedStyle(document.getElementById('orb')).backgroundColor, volver: getComputedStyle(document.getElementById('subperfilVolverBtn')).display }));
  ok(mascotaTema.clase && mascotaTema.fondo === 'rgb(244, 236, 227)' && mascotaTema.orbe === 'rgb(181, 139, 99)', 'perfil de la mascota: colores café tenue (fondo y botón de hablar)');
  const filaMascota = await enOrden(p2);
  ok(filaMascota.length === 3 && /Felipe/.test(filaMascota[0]) && /👧 Luna/.test(filaMascota[1]) && /🐶 Roma/.test(filaMascota[2]) && mascotaTema.volver === 'none', 'perfil de la mascota: arriba, en orden, Felipe, el diario del bebé (Luna) y la mascota (sin el botón suelto de volver)');
  if (CAPTURAS) await p2.screenshot({ path: path.join(CAPTURAS, 'app-mascota.png') });
  // "Ir a Felipe" desde la mascota no debe reabrir el diario de tu propia bitácora (el modo recordado)
  await p2.evaluate(() => localStorage.setItem('eco-bebe-activo', '1'));
  await p2.click('.eco-pill-propia');
  await p2.waitForLoadState('load');
  await p2.waitForTimeout(500);
  ok(await p2.evaluate(() => localStorage.getItem('eco-bebe-activo')) === '0', 'al ir a Felipe desde la mascota se olvida el modo del diario (si no, abría el del bebé)');

  // una persona administrada sigue sin botón de hablar
  const p3 = await ctx.newPage();
  await p3.route('**/api/**', (route) => {
    const u = new URL(route.request().url());
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/me') return json({ username: 'felipe', name: 'Felipe', email: 'f@x.com', isCollaborator: false, isGuest: false, puedeNarrar: false, bitacoraActiva: { id: 50, nombre: 'Papá' } });
    return json({});
  });
  await p3.goto(base + '/app.html');
  await p3.waitForSelector('#subperfilBanner', { state: 'visible', timeout: 8000 });
  ok(await p3.isHidden('#orb') && /no puedes contar su historia/.test(await p3.textContent('#subperfilBannerTexto')), 'app: el perfil de una persona sigue sin botón de hablar');


  // pantalla principal: un botón por cada mascota, y el diario archivado deja de salir
  const p4 = await ctx.newPage();
  p4.on('pageerror', (e) => errores.push(e.message));
  let cambioA = null;
  await p4.route('**/api/**', (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/me') return json({ username: 'felipe', name: 'Felipe', email: 'f@x.com', isCollaborator: false, isGuest: false, puedeNarrar: true });
    if (u.pathname === '/api/subprofiles/switch') { cambioA = JSON.parse(req.postData()).id; return json({ ok: true }); }
    if (u.pathname === '/api/subprofiles') return json({ perfiles: [{ id: 1, nombre: 'Felipe', esPropia: true }, { id: 50, nombre: 'Papá', esPropia: false }, { id: 77, nombre: 'Roma', esPropia: false, tipo: 'mascota', especie: 'perro' }, { id: 78, nombre: 'Rafaela', tratamiento: 'femenino', esPropia: false, tipo: 'bebe', estado: 'en_camino' }, { id: 79, nombre: 'Michi', esPropia: false, tipo: 'mascota', especie: 'gato' }], diarioBebe: null });
    if (u.pathname === '/api/bebe') return json({ config: null, puedeEditar: true, entradas: [] });
    return json({});
  });
  await p4.goto(base + '/app.html');
  await p4.waitForSelector('.eco-pill-mascota', { timeout: 8000 });
  ok(await p4.locator('.eco-especiales button').count() === 3 && /Roma/.test(await p4.textContent('.eco-pill-mascota')) && /Rafaela/.test(await p4.textContent('.eco-pill-bebe')), 'pantalla principal: un botón por la mascota y otro por el bebé (y no los de las personas)');
  ok(await p4.locator('#ecoBebePill').count() === 0, 'y sin diario de bebé no sale el botón del diario');
  const textos = await p4.locator('.eco-especiales button').allTextContents();
  ok(textos.some((x) => x.includes('🐶') && x.includes('Roma')) && textos.some((x) => x.includes('🐱') && x.includes('Michi')) && textos.some((x) => x.includes('👧') && x.includes('Rafaela')), 'cada botón lleva su emoji: perro 🐶, gato 🐱 y niña 👧');
  const tops = await p4.locator('.eco-especiales button').evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().top)));
  ok(new Set(tops).size === 1, 'y van uno al lado del otro, en la misma fila');
  if (CAPTURAS) await p4.screenshot({ path: path.join(CAPTURAS, 'inicio-mascota.png') });
  const colores = await p4.evaluate(() => { const c = (s) => getComputedStyle(document.querySelector(s)).borderTopColor; return { bebe: c('.eco-pill-bebe'), mascota: c('.eco-pill-mascota') }; });
  ok(colores.bebe === 'rgb(231, 180, 186)' && colores.mascota === 'rgb(217, 164, 65)', 'el botón del bebé es rosado y el de la mascota amarillo');
  await p4.click('.eco-pill-mascota');
  const t0 = Date.now(); while (cambioA === null && Date.now() - t0 < 4000) await p4.waitForTimeout(50);
  ok(cambioA === 77, 'al tocar el de la mascota cambia a su perfil');
  cambioA = null;
  await p4.reload();
  await p4.waitForSelector('.eco-pill-bebe', { timeout: 8000 });
  await p4.click('.eco-pill-bebe');
  const tc = Date.now(); while (cambioA === null && Date.now() - tc < 4000) await p4.waitForTimeout(50);
  ok(cambioA === 78, 'y el del bebé cambia al perfil del bebé');

  // Dentro del perfil de un bebé: modo del diario siempre activo, sin botón para salir del modo ni los botones de la pantalla principal
  const p6 = await ctx.newPage();
  p6.on('pageerror', (e) => errores.push(e.message));
  await p6.route('**/api/**', (route) => {
    const u = new URL(route.request().url());
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/me') return json({ username: 'felipe', name: 'Felipe', email: 'f@x.com', isCollaborator: false, isGuest: false, puedeNarrar: true, bitacoraActiva: { id: 78, nombre: 'Rafaela', tipo: 'bebe' } });
    if (u.pathname === '/api/bebe') return json({ config: { nombre: 'Rafaela', genero: 'femenino', nacioEn: null, estado: 'en_camino' }, puedeEditar: true, entradas: [] });
    if (u.pathname === '/api/subprofiles') return json({ perfiles: [{ id: 1, nombre: 'Felipe', esPropia: true }, { id: 77, nombre: 'Roma', esPropia: false, tipo: 'mascota', especie: 'perro' }, { id: 78, nombre: 'Rafaela', tratamiento: 'femenino', esPropia: false, tipo: 'bebe', estado: 'en_camino' }], diarioBebe: { nombre: 'Luna', genero: 'femenino', estado: 'en_camino' } });
    return json({});
  });
  await p6.goto(base + '/app.html');
  await p6.waitForSelector('#ecoBebePanel:not([hidden])', { timeout: 8000 });
  ok(/Estás guardando el diario de Rafaela/.test(await p6.textContent('#subperfilBannerTexto')) && await p6.isVisible('#orb'), 'perfil del bebé: el aviso dice de quién es el diario y el botón de hablar está visible');
  ok(await p6.evaluate(() => document.documentElement.classList.contains('eco-bebe-activo') && window.EcoBebe.activo()), 'perfil del bebé: el modo rosado del diario ya está activo');
  ok(await p6.isHidden('#ecoBebePill'), 'perfil del bebé: no hay botón para entrar o salir del modo');
  await p6.waitForSelector('.eco-especiales .eco-pill-propia');
  const filaBebe = await enOrden(p6);
  ok(filaBebe.length === 4 && /Felipe/.test(filaBebe[0]) && /Luna/.test(filaBebe[1]) && /Rafaela/.test(filaBebe[2]) && /Roma/.test(filaBebe[3]), 'perfil del bebé: arriba, en orden, Felipe, el diario del bebé (Luna), el bebé y la mascota');
  const colBebe = await p6.evaluate(() => { const c = (s) => getComputedStyle(document.querySelector(s)).borderTopColor; return { propia: c('.eco-pill-propia'), mascota: c('.eco-pill-mascota') }; });
  ok(colBebe.propia === 'rgb(138, 160, 112)' && colBebe.mascota === 'rgb(217, 164, 65)', 'estando en el bebé: Felipe sale en verde y la mascota en amarillo');
  let cambioDiario = null;
  await p6.route('**/api/subprofiles/switch', (route) => { cambioDiario = JSON.parse(route.request().postData()).id; route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
  await p6.locator('.eco-especiales button', { hasText: 'Luna' }).click();
  const tl = Date.now(); while (cambioDiario === null && Date.now() - tl < 4000) await p6.waitForTimeout(50);
  ok(cambioDiario === 1, 'el botón del diario de bebé lleva a tu bitácora (con ese diario abierto)');
  ok(await p6.locator('.eco-pill-bebe[aria-current="true"]').count() === 1, 'y el del bebé activo va resaltado');
  if (CAPTURAS) await p6.screenshot({ path: path.join(CAPTURAS, 'perfil-bebe.png') });

  // Perfiles: el diario de bebé aparece como un perfil más y se puede archivar
  const p5 = await ctx.newPage();
  p5.on('pageerror', (e) => errores.push(e.message));
  let diarioActivo = true, archivoPedido = false;
  p5.on('dialog', (d) => d.accept());
  await p5.route('**/api/**', (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/me') return json({ username: 'felipe', name: 'Felipe', isCollaborator: false, isGuest: false, puedeNarrar: true });
    if (u.pathname === '/api/bebe/archivar') { archivoPedido = true; diarioActivo = false; return json({ ok: true }); }
    if (u.pathname === '/api/subprofiles') return json({ perfiles: [{ id: 1, nombre: 'Felipe', esPropia: true }], diarioBebe: diarioActivo ? { nombre: 'Lucca', estado: 'en_camino' } : null });
    return json({});
  });
  await p5.goto(base + '/perfiles.html');
  await p5.waitForSelector('.perfil-card:has-text("Lucca")');
  ok((await p5.locator('.perfil-card', { hasText: 'Lucca' }).textContent()).includes('Diario de bebé · en camino'), 'Perfiles: el diario de bebé aparece como un perfil más');
  await p5.locator('.perfil-card', { hasText: 'Lucca' }).locator('[data-archivar-diario]').click();
  await p5.waitForFunction(() => !document.body.innerText.includes('Lucca'));
  ok(archivoPedido, 'Perfiles: al archivarlo se pide archivar y deja de aparecer');

  ok(errores.length === 0, 'sin errores de JavaScript' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close();
  server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
