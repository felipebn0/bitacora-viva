// Smoke test de las páginas legales y de lo que las conecta con el resto
// (lanzamiento gratis, 2026-10-07): que existan Política de Privacidad y
// Términos con lo mínimo que exige la Ley 1581 de 2012, que las dos
// landings (V1 y V2 de la prueba A/B) las enlacen y pidan la aceptación
// con una casilla obligatoria, que la app no muestre precios mientras el
// cobro está apagado y que la entrada de invitados avise de los términos.
const fs = require('fs');
const path = require('path');

const pub = (f) => fs.readFileSync(path.resolve(__dirname, '..', 'public', f), 'utf8');
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

const priv = pub('privacidad.html');
const term = pub('terminos.html');

// --- Política de Privacidad ---
ok(/Ley 1581 de 2012/.test(priv), 'privacidad: cita la Ley 1581 de 2012');
ok(/El Rebusuque SAS/.test(priv), 'privacidad: identifica al responsable');
ok(/felipebnisperuza@hotmail\.com/.test(priv), 'privacidad: da un correo para ejercer derechos');
ok(/10 días hábiles/.test(priv) && /15 días hábiles/.test(priv), 'privacidad: plazos legales de consultas y reclamos');
ok(/Superintendencia de Industria y Comercio/.test(priv), 'privacidad: menciona a la SIC');
for (const proveedor of ['Anthropic', 'ElevenLabs', 'Cloudflare', 'Neon', 'Vercel', 'Resend', 'Sentry']) {
  ok(priv.includes(proveedor), `privacidad: nombra al proveedor ${proveedor}`);
}
ok(/datos sensibles/i.test(priv) && /voluntario/i.test(priv), 'privacidad: explica que los datos sensibles son voluntarios');
ok(/no vendemos/i.test(priv), 'privacidad: promete no vender datos');
ok(/mayores de 18/.test(priv), 'privacidad: edad mínima');
ok(/<a href="\/terminos\.html"/.test(priv), 'privacidad: enlaza a los términos');

// --- Términos ---
ok(/El Rebusuque SAS/.test(term), 'términos: identifican al responsable');
ok(/gratis/i.test(term) && /30 días/.test(term), 'términos: servicio gratis y aviso de 30 días antes de cualquier cobro');
ok(/autorización/.test(term) && /mamá o tu papá/.test(term), 'términos: exigen permiso de la persona a quien se graba');
ok(/República de Colombia/.test(term), 'términos: ley aplicable');
ok(/<a href="\/privacidad\.html"/.test(term), 'términos: enlazan a la política de privacidad');

// Ninguna de las dos usa atributos style="" (rompe el CSP) ni scripts inline.
for (const [n, h] of [['privacidad', priv], ['terminos', term]]) {
  ok(!/\sstyle="/i.test(h), `${n}: sin atributos style=""`);
  ok(!/<script(?![^>]*\ssrc=)[^>]*>/.test(h), `${n}: sin scripts inline`);
}

// --- Las dos landings de la prueba A/B ---
for (const f of ['index.html', 'index-v2.html']) {
  const h = pub(f);
  ok(h.includes('href="/privacidad.html"') && h.includes('href="/terminos.html"'), `${f}: enlaza a la política y a los términos`);
  ok(/<input id="suTerms" name="acceptTerms" type="checkbox" required>/.test(h), `${f}: casilla de aceptación obligatoria`);
  ok(/acceptTerms: true/.test(h), `${f}: el formulario manda acceptTerms al servidor`);
  ok(/Gratis por ahora/.test(h), `${f}: dice que es gratis`);
  ok(/<details class="privacy-item" open>/.test(h), `${f}: las promesas de privacidad se ven abiertas`);
  ok(/no existe un enlace público/.test(h), `${f}: afirma que los archivos son privados`);
  ok(!/no porque el archivo en sí sea inaccesible/.test(h), `${f}: ya no tiene la versión antigua de la respuesta sobre archivos`);
  ok(/<footer>[\s\S]*Términos y Condiciones[\s\S]*<\/footer>/.test(h), `${f}: el pie de página lleva los enlaces legales`);
}

// --- V2 (la nostálgica): construir recuerdos en vida, con casos de uso ---
const v2 = pub('index-v2.html');
ok(/<section id="para-quien">/.test(v2), 'v2: tiene la sección de casos de uso');
const bloquePara = v2.slice(v2.indexOf('<section id="para-quien">'), v2.indexOf('<section id="familia">'));
ok((bloquePara.match(/class="family-card"/g) || []).length === 3, 'v2: son tres casos de uso (papás/abuelos, familia, hijos)');
ok(/Para tus papás o abuelos/.test(bloquePara) && /Para toda tu familia/.test(bloquePara) && /Para tus hijos/.test(bloquePara), 'v2: los tres casos tienen su título');
const cuerpoV2 = v2.slice(v2.indexOf('<main'), v2.indexOf('</main>'));
ok(!/morir|muert|falleci|extrañar|se apag|última vez|mientras todavía/i.test(cuerpoV2), 'v2: el texto no gira alrededor de la muerte ni de la pérdida');
ok(/noindex/.test(v2), 'v2: sigue con noindex');

// --- V1 (control): también lleva la sección de casos de uso ---
const v1 = pub('index.html');
const bloquePara1 = v1.indexOf('<section id="para-quien">') === -1 ? '' : v1.slice(v1.indexOf('<section id="para-quien">'), v1.indexOf('<section id="familia">'));
ok((bloquePara1.match(/class="family-card"/g) || []).length === 3, 'v1: tiene la sección de casos de uso con tres tarjetas');
ok(bloquePara1 === bloquePara, 'v1 y v2: la sección de casos de uso es idéntica en las dos landings');

// --- App: sin precios visibles mientras no se cobra ---
const app = pub('app.html');
const iPago = app.indexOf('id="umPlanPago" hidden');
ok(iPago !== -1, 'app: el bloque de cobro quedó oculto (umPlanPago hidden)');
ok(/gratis durante el lanzamiento/.test(app), 'app: el menú Plan dice que es gratis');
const antesDelBloque = iPago === -1 ? app : app.slice(0, iPago);
ok(!/\$399\.000|\$649\.000|\$449\.000/.test(antesDelBloque), 'app: ningún precio visible fuera del bloque oculto');
ok(app.includes('href="/privacidad.html"') && app.includes('href="/terminos.html"'), 'app: el menú de Cuenta enlaza a las páginas legales');

// --- Invitados ---
const colab = pub('colaborar.html');
ok(colab.includes('href="/privacidad.html"') && colab.includes('href="/terminos.html"'), 'colaborar: la entrada de invitados avisa de los términos');

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
