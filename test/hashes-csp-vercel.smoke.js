// Smoke test para la ronda 3 del camino hacia CSP en enforce (2026-09-06):
// permitir los bloques <script>/<style> inline de las 7 páginas por su
// hash sha256 exacto (ver csp-hashes.js) en vez de extraerlos a archivos
// aparte.
//
// server.js calcula sus propios hashes en cada arranque, así que ahí
// nunca pueden quedar desactualizados. Pero vercel.json es la copia que
// de verdad gobierna las páginas estáticas en producción (public/** se
// sirve directo desde el build de Vercel, sin pasar por server.js) y es
// texto estático, sin forma de "calcular" nada solo -- si alguien edita
// el <script> o <style> de una página y se olvida de correr
// `node tools/actualizar-hashes-vercel.js`, vercel.json queda con hashes
// viejos que no matchean el contenido real, y CUALQUIER cosa que dependa
// de esos hashes (incluido, el día de mañana, CSP en enforce de verdad)
// se rompe en silencio. Este test existe para que ese olvido no sea
// silencioso: recalcula los hashes desde el contenido actual de public/
// (la misma función que usa server.js) y los compara letra por letra
// contra lo que hoy dice vercel.json.
const fs = require('fs');
const path = require('path');
const { calcularHashesDeInline } = require('../csp-hashes');

const VERCEL_JSON_PATH = path.join(__dirname, '..', 'vercel.json');

let pasaron = 0;
let fallaron = 0;
function check(nombre, cond) {
  if (cond) { pasaron++; console.log('OK  -', nombre); }
  else { fallaron++; console.log('FAIL -', nombre); }
}

function construirDirectiva(nombre, hashes) {
  return `${nombre} 'self' ${hashes.map((h) => `'${h}'`).join(' ')}`;
}

const { scriptHashes, styleHashes } = calcularHashesDeInline();
const raw = fs.readFileSync(VERCEL_JSON_PATH, 'utf8');

check('vercel.json sigue siendo JSON válido', (() => { try { JSON.parse(raw); return true; } catch { return false; } })());

const config = JSON.parse(raw);
const headers = config.routes && config.routes[0] && config.routes[0].headers;
const clavePolicy = headers && headers['Content-Security-Policy-Report-Only'] ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
check(`vercel.json tiene el header ${clavePolicy}`, !!(headers && headers[clavePolicy]));

const policyActual = headers && headers[clavePolicy];
check('script-src en vercel.json trae exactamente los hashes que hoy dan las páginas de public/', !!policyActual && policyActual.includes(construirDirectiva('script-src', scriptHashes)));
check('style-src en vercel.json trae exactamente los hashes que hoy dan las páginas de public/', !!policyActual && policyActual.includes(construirDirectiva('style-src', styleHashes)));
check(`hay ${scriptHashes.length} hashes de <script> (uno por bloque inline real, sin contar los que tienen src=)`, scriptHashes.length >= 7); // 7 páginas, app.html aporta 2
check(`hay ${styleHashes.length} hashes de <style> (uno por página)`, styleHashes.length === 7);

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
if (fallaron) {
  console.log('\nSi este test falla después de editar el <script> o <style> de una página,');
  console.log('correr: node tools/actualizar-hashes-vercel.js');
}
process.exit(fallaron ? 1 : 0);
