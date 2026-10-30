// Recordatorio diario dentro de la app del celular (Capacitor): en el navegador no aparece nada; en la app
// se programa por defecto a las 5 pm, se puede cambiar la hora y apagar, y hay un botón de prueba.
//
//   node test/recordatorio-app.playwright.js   (o: npm run test:recordatorio-app)
const path = require('path');
const express = require('express');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright — correr "npm install" primero.'); process.exit(1); }

let fallas = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallas++; console.error('✗ ' + m); } };

const PLUGIN_FALSO = () => {
  window.__ln = { llamadas: [], permiso: 'prompt' };
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      LocalNotifications: {
        checkPermissions: async () => ({ display: window.__ln.permiso }),
        requestPermissions: async () => { window.__ln.permiso = 'granted'; return { display: 'granted' }; },
        cancel: async (a) => { window.__ln.llamadas.push(['cancel', a]); },
        schedule: async (a) => { window.__ln.llamadas.push(['schedule', a]); },
      },
    },
  };
};

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());

  async function abrir(nativo) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    if (nativo) await page.addInitScript(PLUGIN_FALSO);
    await page.addInitScript(() => { try { localStorage.setItem('eco_tour_done__app_html', '1'); } catch (e) { /* nada */ } });
    await page.route('**/api/**', (route) => {
      const u = new URL(route.request().url());
      const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.pathname === '/api/me') return json({ username: 'felipe', name: 'Felipe Bernal', email: 'f@x.com', isCollaborator: false, isGuest: false });
      return json({});
    });
    await page.goto(base + '/app.html', { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    return page;
  }

  // En el navegador no se ve nada
  const web = await abrir(false);
  ok(await web.locator('#umRecordatorioApp').count() === 0, 'en el navegador no aparece el recordatorio de la app');
  await web.close();

  // En la app: por defecto 5 pm
  const p = await abrir(true);
  ok(await p.locator('#umRecordatorioApp').count() === 1, 'en la app aparece el recordatorio diario en Recordatorios');
  let ll = await p.evaluate(() => window.__ln.llamadas);
  const prog = ll.find((x) => x[0] === 'schedule');
  ok(!!prog && prog[1].notifications[0].schedule.on.hour === 17 && prog[1].notifications[0].schedule.on.minute === 0, 'por defecto se programa todos los días a las 17:00');
  ok(!!prog && /ratico a Eco/.test(prog[1].notifications[0].title) && /5 minutos/.test(prog[1].notifications[0].body), 'el mensaje es amable y pide 5 minutos');
  ok(await p.evaluate(() => window.__ln.permiso) === 'granted', 'pide el permiso de notificaciones');

  // Cambiar la hora y guardar
  await p.evaluate(() => {
    document.getElementById('umRecordatorioAppHora').value = '18:30';
    document.querySelector('#umRecordatorioApp .um-btn').click();
  });
  await p.waitForTimeout(300);
  ll = await p.evaluate(() => window.__ln.llamadas);
  const ultima = ll.filter((x) => x[0] === 'schedule').pop();
  ok(ultima[1].notifications[0].schedule.on.hour === 18 && ultima[1].notifications[0].schedule.on.minute === 30, 'al guardar 18:30 se reprograma a esa hora');
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem('eco-recordatorio-app')).hora) === '18:30', 'la hora queda guardada en el celular');

  // Apagar
  await p.evaluate(() => { document.getElementById('umRecordatorioAppActivo').checked = false; });
  const antes = (await p.evaluate(() => window.__ln.llamadas)).filter((x) => x[0] === 'schedule').length;
  await p.evaluate(() => { document.querySelector('#umRecordatorioApp .um-btn').click(); });
  await p.waitForTimeout(300);
  ll = await p.evaluate(() => window.__ln.llamadas);
  ok(ll.filter((x) => x[0] === 'schedule').length === antes && ll[ll.length - 1][0] === 'cancel', 'al apagarlo se cancela y no se vuelve a programar');

  // Prueba
  await p.evaluate(() => { document.querySelector('#umRecordatorioApp .um-plain').click(); });
  await p.waitForTimeout(300);
  ll = await p.evaluate(() => window.__ln.llamadas);
  const prueba = ll.filter((x) => x[0] === 'schedule').pop();
  ok(!!prueba && !!prueba[1].notifications[0].schedule.at, 'el botón de prueba programa un aviso para dentro de unos segundos');

  await p.close();
  await browser.close();
  server.close();
  console.log(fallas ? `\n${fallas} fallaron` : '\nTodo bien');
  process.exit(fallas ? 1 : 0);
})();
