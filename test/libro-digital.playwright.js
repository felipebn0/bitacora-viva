// El libro digital (public/libro-digital-plantilla.txt): estantería 3D de capítulos que se abre en una página de lectura.
//
//   node test/libro-digital.playwright.js   (o: npm run test:libro-digital)
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta playwright — correr "npm install" primero.'); process.exit(1); }

let fallas = 0;
const ok = (c, m) => { if (c) console.log('✓ ' + m); else { fallas++; console.error('✗ ' + m); } };
const plantilla = fs.readFileSync(path.join(__dirname, '..', 'public', 'libro-digital-plantilla.txt'), 'utf8');
const foto = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, '..', 'public', 'images', 'voces', 'voz-1.jpg')).toString('base64');

function libro(n, extra = {}) {
  const textos = [
    'Nací en una finca pequeña, al pie de la montaña.\n\nMi mamá madrugaba a prender el fogón y el olor del café llegaba hasta la cama.\n\nLos domingos nos reuníamos todos alrededor de la mesa grande.',
    'El primer trabajo que tuve fue en una panadería. Me pagaban poco, pero me regalaban el pan de ayer.',
    '',
  ];
  const caps = [];
  for (let i = 0; i < n; i++) caps.push({ id: i + 1, titulo: ['Mi infancia en la finca', 'Mi primer trabajo', 'Cómo conocí a tu abuela y todo lo que pasó después en aquel pueblo', 'La casa de los domingos'][i % 4] + (i >= 4 ? ' ' + (i + 1) : ''), tema: i % 2 ? 'Trabajo' : 'Infancia', texto: textos[i % 3], fotos: i % 2 === 0 ? [{ src: foto, pie: 'Con mi mamá, 1962' }] : [], audios: i === 4 ? [{ src: 'data:audio/webm;base64,GkXfowEAAAAAAAAfQoaBAUL3gQFC8oEEQvOBCEKCQAR3ZWJtQoeBAkKFgQIYU4BnQI0VSalmQCgq17FAAw9CQE2AQAZ3aGFtbXlXQUAGd2hhbW15RIlACECPQAAAAAAAFlSua0AxrkAu14EBY8WBAZyBACK1nEADdW5khkAFVl9WUDglhohAA1ZQOIOBAeBABrCBCLqBCB9DtnVAIueBAKNAHIEAAIAwAQCdASoIAAgAAUAmJaQAA3AA/vz0AAA=', pregunta: '¿Cómo se llamaban tus papás?' }] : [] });
  return Object.assign({ titulo: 'Los recuerdos de Felipe', subtitulo: 'Una historia contada con Eco', dedicatoria: 'Para mis nietos', fecha: 'Octubre de 2026', capitulos: caps }, extra);
}
const armar = (datos) => plantilla.replace(/(<script type="application\/json" id="datos">)[\s\S]*?(<\/script>)/, (m, a, b) => a + JSON.stringify(datos).replace(/</g, '\\u003c') + b);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  async function abrir(datos, { ancho = 1440, alto = 900 } = {}) {
    const ctx = await browser.newContext({ viewport: { width: ancho, height: alto } });
    const page = await ctx.newPage();
    const errores = [];
    page.on('pageerror', (e) => errores.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.setContent(armar(datos), { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    return { ctx, page, errores };
  }
  const titulo = (p) => p.locator('#pieCap .cap-t').last().innerText();

  // Estantería infinita (12 capítulos)
  let t = await abrir(libro(12));
  ok(t.errores.length === 0, 'sin errores al cargar (12 capítulos): ' + JSON.stringify(t.errores));
  ok(await t.page.locator('.tape').count() === 36, 'con 12 capítulos la estantería se repite 3 veces (36 libros)');
  ok(/^Cómo conocí a tu abuela.* 7$/.test(await titulo(t.page)), 'abre en el capítulo del medio');
  ok(/CAPÍTULO 7 DE 12/.test(await t.page.locator('#indice').innerText()), 'el indicador dice en qué capítulo va');
  ok(await t.page.locator('.cursor').count() === 0 && await t.page.evaluate(() => getComputedStyle(document.body).cursor !== 'none'), 'usa el puntero normal del sistema (sin círculo)');
  ok(/PARA MIS NIETOS/i.test(await t.page.locator('#pieIzq').innerText()), 'el pie muestra la dedicatoria del libro');
  await t.page.keyboard.press('ArrowRight');
  await t.page.waitForTimeout(1400);
  ok(await titulo(t.page) === 'La casa de los domingos 8', 'la flecha derecha pasa al capítulo siguiente');
  await t.page.locator('#ant').click();
  await t.page.locator('#ant').click();
  await t.page.locator('#ant').click();
  await t.page.waitForTimeout(1800);
  ok(/CAPÍTULO 5 DE 12/.test(await t.page.locator('#indice').innerText()), 'las flechas de la pantalla retroceden');
  await t.page.screenshot({ path: path.join(process.env.CAPTURAS || '/tmp', 'libro-digital-estanteria.png') });
  await t.page.evaluate(() => document.activeElement && document.activeElement.blur());
  await t.page.keyboard.press('Enter');
  await t.page.waitForTimeout(2600);
  ok(await t.page.evaluate(() => document.getElementById('detalle').classList.contains('vivo')), 'Enter abre el capítulo');
  ok(/Mi infancia en la finca 5/.test(await t.page.locator('#dTitulo').innerText()), 'muestra el título del capítulo abierto');
  ok(await t.page.locator('#dAudios audio').count() === 1 && /Cómo se llamaban tus papás/.test(await t.page.locator('#dAudios').innerText()) && /escucha la historia original/i.test(await t.page.locator('#dAudios').innerText()), 'muestra el audio original con su pregunta');
  ok((await t.page.locator('#dCuerpo p').count()) >= 1 && (await t.page.locator('#dCuerpo figure img').count()) >= 1, 'muestra el texto en párrafos y su foto');
  await t.page.screenshot({ path: path.join(process.env.CAPTURAS || '/tmp', 'libro-digital-detalle.png') });
  await t.page.locator('#dMas').click();
  ok(await t.page.evaluate(() => getComputedStyle(document.getElementById('dCuerpo')).fontSize) === '20px', 'A+ agranda la letra');
  await t.page.keyboard.press('Escape');
  await t.page.waitForTimeout(1200);
  ok(await t.page.evaluate(() => !document.getElementById('detalle').classList.contains('vivo')), 'Escape cierra y vuelve a la estantería');
  ok(t.errores.length === 0, 'sin errores al usarlo: ' + JSON.stringify(t.errores));
  await t.ctx.close();

  // Estantería finita (3 capítulos)
  t = await abrir(libro(3));
  ok(await t.page.locator('.tape').count() === 3, 'con pocos capítulos no se repiten (3 libros)');
  await t.page.keyboard.press('ArrowLeft'); await t.page.keyboard.press('ArrowLeft'); await t.page.keyboard.press('ArrowLeft');
  await t.page.waitForTimeout(1500);
  ok(/CAPÍTULO 1 DE 3/.test(await t.page.locator('#indice').innerText()), 'la estantería se detiene en el primer capítulo');
  ok(t.errores.length === 0, 'sin errores (3 capítulos): ' + JSON.stringify(t.errores));
  await t.ctx.close();

  // Clic en un lomo
  t = await abrir(libro(12));
  const cajas = await t.page.locator('.tape .sp').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; }));
  const vecino = cajas.filter((c) => c.w > 10 && c.x > 780 && c.x < 1300).sort((a, b) => a.x - b.x)[0];
  await t.page.mouse.click(vecino.x, vecino.y);
  await t.page.waitForTimeout(1800);
  ok(/CAPÍTULO 8 DE 12|CAPÍTULO 9 DE 12/.test(await t.page.locator('#indice').innerText()), 'un clic en un lomo lo trae al centro');
  await t.ctx.close();

  // Celular
  t = await abrir(libro(12), { ancho: 390, alto: 844 });
  ok(t.errores.length === 0, 'sin errores en el celular');
  ok(await t.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sin scroll horizontal en el celular');
  await t.page.screenshot({ path: path.join(process.env.CAPTURAS || '/tmp', 'libro-digital-movil.png') });
  await t.page.keyboard.press('Enter');
  await t.page.waitForTimeout(2600);
  ok(await t.page.evaluate(() => document.getElementById('detalle').classList.contains('vivo')), 'en el celular también abre el capítulo');
  await t.page.screenshot({ path: path.join(process.env.CAPTURAS || '/tmp', 'libro-digital-movil-detalle.png') });
  await t.ctx.close();

  // Sin dedicatoria, el pie dice "Creado con Eco"
  t = await abrir(libro(3, { dedicatoria: '' }));
  ok(/^CREADO CON ECO/.test(await t.page.locator('#pieIzq').innerText()), 'sin dedicatoria, el pie dice "Creado con Eco"');
  await t.ctx.close();

  // Libro sin capítulos
  t = await abrir(libro(0));
  ok(/TODAVÍA NO TIENE CAPÍTULOS/.test(await t.page.locator('body').innerText()), 'un libro sin capítulos lo dice');
  await t.ctx.close();

  await browser.close();
  console.log(fallas ? `\n${fallas} fallaron` : '\nTodo bien');
  process.exit(fallas ? 1 : 0);
})();
