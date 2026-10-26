// Perfiles: agregar una mascota (perrito) y contar su vida desde app.html.
//   node test/perfil-mascota.playwright.js   (o: npm run test:perfil-mascota)
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright: corre "npm install".'); process.exit(1); }
let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };
const CAPTURAS = process.env.CAPTURAS_MASCOTA;

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
      perfiles.push({ id: 77, nombre: 'Roma', tratamiento: creado.tratamiento, tieneOnboarding: false, esPropia: false, tipo: 'mascota', especie: creado.especie, raza: creado.raza });
      return json({ ok: true, id: 77, nombre: 'Roma' });
    }
    if (u.pathname.includes('/narrador-link')) return json({ enlace: null, activo: false });
    return json({});
  });

  await page.goto(base + '/perfiles.html');
  await page.waitForSelector('#mascotaSection');
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
  if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, 'perfiles-mascota.png'), fullPage: true });

  // app.html con la mascota activa
  await page.evaluate(() => { globalThis.__activa = null; });
  const p2 = await ctx.newPage();
  p2.on('pageerror', (e) => errores.push(e.message));
  await p2.route('**/api/**', (route) => {
    const u = new URL(route.request().url());
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/me') return json({ username: 'felipe', name: 'Felipe', email: 'f@x.com', isCollaborator: false, isGuest: false, puedeNarrar: true, bitacoraActiva: { id: 77, nombre: 'Roma', tipo: 'mascota', especie: 'perro' } });
    return json({});
  });
  await p2.goto(base + '/app.html');
  await p2.waitForSelector('#subperfilBanner', { state: 'visible', timeout: 8000 });
  ok(/Estás contando la vida de Roma/.test(await p2.textContent('#subperfilBannerTexto')), 'app: el aviso dice que estás contando la vida de Roma');
  ok(await p2.isVisible('#orb'), 'app: el botón de hablar sigue visible');
  if (CAPTURAS) await p2.screenshot({ path: path.join(CAPTURAS, 'app-mascota.png') });

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
    if (u.pathname === '/api/subprofiles') return json({ perfiles: [{ id: 1, nombre: 'Felipe', esPropia: true }, { id: 50, nombre: 'Papá', esPropia: false }, { id: 77, nombre: 'Roma', esPropia: false, tipo: 'mascota', especie: 'perro' }], diarioBebe: null });
    if (u.pathname === '/api/bebe') return json({ config: null, puedeEditar: true, entradas: [] });
    return json({});
  });
  await p4.goto(base + '/app.html');
  await p4.waitForSelector('.eco-mascota-pill', { timeout: 8000 });
  ok(await p4.locator('.eco-mascota-pill').count() === 1 && /Roma/.test(await p4.textContent('.eco-mascota-pill')), 'pantalla principal: sale un botón con el nombre de la mascota (y no el de las personas)');
  ok(await p4.locator('#ecoBebePill').count() === 0, 'y sin diario de bebé no sale el botón del diario');
  if (CAPTURAS) await p4.screenshot({ path: path.join(CAPTURAS, 'inicio-mascota.png') });
  await p4.click('.eco-mascota-pill');
  const t0 = Date.now(); while (cambioA === null && Date.now() - t0 < 4000) await p4.waitForTimeout(50);
  ok(cambioA === 77, 'al tocarlo cambia al perfil de la mascota');

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
