// Despedirse con la voz («chao», «terminemos por hoy») cierra la charla igual que el botón «Fin», aunque la IA no ponga
// la marca [FIN]. Una historia que solo menciona una despedida («y me dijo chao») no la cierra.
//   node test/despedida-voz.playwright.js   (o: npm run test:despedida-voz)
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright: corre "npm install".'); process.exit(1); }
let fallos = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallos++; console.error('✗ ' + m); } };
const SILENT_WAV = Buffer.from('UklGRigAAABXQVZFZm10IBIAAAABAAEAQB8AAEAfAAABAAgAAABkYXRhAAAAAA==', 'base64');

// Sin grabadora: la app ofrece escribir, y lo escrito sigue el mismo camino que lo dicho con la voz (handleAnswer).
const fakes = () => {
  class AudioFalso {
    constructor() { this.onended = null; this.onerror = null; this.paused = true; this._t = null; }
    set src(v) { this._src = v; }
    get src() { return this._src; }
    play() { this.paused = false; clearTimeout(this._t); this._t = setTimeout(() => { this.paused = true; if (this.onended) this.onended(); }, 5); return Promise.resolve(); }
    pause() { this.paused = true; clearTimeout(this._t); }
    load() {}
  }
  window.Audio = AudioFalso;
  try { delete window.MediaRecorder; } catch (e) { /* nada */ }
  window.MediaRecorder = undefined;
};

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errores = [];

  async function abrir(respuestas) {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.addInitScript(fakes);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errores.push(e.message));
    const pedidos = [];
    await page.route('**/api/**', async (route) => {
      const u = new URL(route.request().url());
      const json = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.pathname === '/api/me') return json({ isCollaborator: false, username: 'tester', name: 'Tester', email: 't@example.com', fechaNacimiento: null });
      if (u.pathname === '/api/intro') return json({ aplica: false, pendiente: false });
      if (u.pathname === '/api/tree/pending') return json({ names: [] });
      if (u.pathname === '/api/next') { const body = JSON.parse(route.request().postData() || '{}'); pedidos.push(body); return json(respuestas[pedidos.length - 1] || { message: 'Cuéntame más.' }); }
      if (u.pathname === '/api/speak') return route.fulfill({ contentType: 'audio/wav', body: SILENT_WAV });
      if (u.pathname === '/api/save') return json({ sessionDbId: 1 });
      return json({});
    });
    await page.goto(base + '/app.html');
    await page.waitForSelector('#orb', { state: 'visible' });
    return { ctx, page, pedidos };
  }
  const estado = (page) => page.evaluate(() => document.getElementById('orb').dataset.state);
  async function responder(page, texto) {
    await page.waitForSelector('#writeInput', { state: 'visible', timeout: 15000 });
    await page.fill('#writeInput', texto);
    await page.click('#writeSend');
  }

  console.log('--- qué cuenta como despedida ---');
  {
    const { ctx, page } = await abrir([]);
    const si = ['Chao', 'Bueno, chao', 'Gracias Eco, hasta mañana', 'Listo, terminemos por hoy', 'Me tengo que ir', 'Ya me voy, gracias',
      'Por hoy es todo', 'Hasta luego Eco', 'Dejémoslo aquí', 'Quiero terminar', 'Bye', "That's all for today", 'Nos vemos', 'Adiós, muchas gracias',
      'Paremos aquí', 'Terminemos la charla', 'Bueno Eco, terminemos por hoy, gracias'];
    const no = ['Y mi papá me dijo chao y se fue para la finca a trabajar', 'Me voy a acordar siempre de esa casa', 'Eso es todo',
      'Ya terminé', 'Terminamos el colegio en 1985 y nos fuimos a Bogotá', 'Cuando era niño me iba a la finca de mi abuelo todos los diciembres y allá aprendí a ordeñar y a montar a caballo, chao',
      'Mi abuela siempre decía adiós con la mano desde la ventana', 'Paremos un momento en la parte de la finca de mis abuelos',
      'Terminemos de hablar de mi papá y pasemos a mi mamá', 'Quiero terminar la historia de cuando nos fuimos a Cali'];
    const r = await page.evaluate(([si, no]) => ({ si: si.map((t) => [t, window.__ecoPideTerminarLaCharla(t)]), no: no.map((t) => [t, window.__ecoPideTerminarLaCharla(t)]) }), [si, no]);
    const faltan = r.si.filter(([, v]) => !v).map(([t]) => t);
    const sobran = r.no.filter(([, v]) => v).map(([t]) => t);
    ok(!faltan.length, 'reconoce las despedidas' + (faltan.length ? ' — no reconoció: ' + faltan.join(' | ') : ' (' + si.length + ' frases)'));
    ok(!sobran.length, 'no confunde historias ni «eso es todo» con una despedida' + (sobran.length ? ' — se equivocó en: ' + sobran.join(' | ') : ' (' + no.length + ' frases)'));
    await ctx.close();
  }

  console.log('--- despedirse cierra la charla ---');
  {
    const { ctx, page, pedidos } = await abrir([{ message: '¡Hola! ¿Qué recuerdas de tu infancia?' }, { message: 'Listo, cerramos por hoy. Todo quedó guardado.' }]);
    await page.click('#orb');
    await responder(page, 'Bueno, terminemos por hoy, chao');
    await page.waitForFunction(() => document.getElementById('orb').dataset.state === 'ended', null, { timeout: 15000 }).catch(() => {});
    ok(pedidos.length === 2 && pedidos[1].fin === true, 'el turno de la despedida se pide como cierre (fin: true), igual que el botón «Fin»');
    ok(await estado(page) === 'ended', 'la charla termina aunque la IA no ponga la marca [FIN] (estado: ' + await estado(page) + ')');
    ok(!(await page.isVisible('#writeInput')), 'y ya no queda esperando una respuesta');
    await ctx.close();
  }

  console.log('--- una historia que menciona una despedida no cierra ---');
  {
    const { ctx, page, pedidos } = await abrir([{ message: '¡Hola! ¿Qué recuerdas de tu papá?' }, { message: '¡Qué bonito! ¿Y qué hacían en la finca?' }]);
    await page.click('#orb');
    await responder(page, 'Y mi papá me dijo chao y se fue para la finca a trabajar');
    await page.waitForSelector('#writeInput', { state: 'visible', timeout: 15000 });
    ok(pedidos.length === 2 && !pedidos[1].fin, 'el turno sigue normal (sin fin)');
    ok(await estado(page) !== 'ended', 'y la charla sigue esperando su respuesta');
    await ctx.close();
  }

  ok(errores.length === 0, 'sin errores de JavaScript' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(fallos ? `\n${fallos} fallaron` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})();
