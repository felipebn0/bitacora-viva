// Calcula, a partir del contenido REAL de las páginas de public/, los
// hashes sha256 que hacen falta en script-src/style-src para permitir sus
// bloques <script>/<style> inline sin usar 'unsafe-inline' -- ronda 3 del
// camino hacia CSP en enforce (2026-09-06).
//
// Por qué hash en vez de extraer todo a archivos .js/.css externos (la
// alternativa "de fondo", ya evaluada): entre las 7 páginas hay ~3.865
// líneas de <script> inline y ~1.728 de <style> inline -- extraerlas es
// mucho más trabajo y mucho más riesgo (tocar prácticamente toda la
// lógica interactiva de la app) que calcular un hash. La objeción real al
// hash es que es frágil: cualquier edición futura a un bloque cambia su
// hash. Este archivo existe para que esa fragilidad no sea silenciosa:
// server.js lo usa para calcular sus propios hashes en cada arranque
// (siempre exactos, nunca se puede desactualizar), y
// tools/actualizar-hashes-vercel.js lo usa para regenerar el CSP de
// vercel.json (que sí es texto estático, sin forma de ejecutar código) --
// y test/hashes-csp-vercel.smoke.js falla fuerte si alguien edita una
// página y se olvida de correr ese script antes de commitear.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUBLIC_DIR = path.join(__dirname, 'public');
const PAGINAS = ['index.html', 'app.html', 'arbol.html', 'capitulos.html', 'colaboraciones.html', 'colaborar.html', 'historias.html'];

// script: cualquier <script ...> SIN atributo src (el inline real; los que
// sí tienen src, como /font-size.js, ya los cubre 'self' sin necesitar hash).
// style: siempre inline en estas páginas (no hay <link rel="stylesheet">
// disfrazado de <style>), así que cualquier <style> cuenta.
function extraerBloques(contenido, tag) {
  const bloques = [];
  const re = tag === 'script'
    ? /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g
    : /<style[^>]*>([\s\S]*?)<\/style>/g;
  let m;
  while ((m = re.exec(contenido)) !== null) {
    if (m[1].trim()) bloques.push(m[1]);
  }
  return bloques;
}

// El hash de CSP se calcula sobre el contenido EXACTO entre las etiquetas,
// tal cual lo ve el navegador (script/style son "raw text elements" en el
// parseo de HTML -- no hay decodificación de entidades de por medio, así
// que el substring crudo del archivo es exactamente lo que hay que
// hashear). Codificado en UTF-8 antes de aplicar sha256, como pide CSP3.
function hashSha256(texto) {
  return 'sha256-' + crypto.createHash('sha256').update(texto, 'utf8').digest('base64');
}

function calcularHashesDeInline() {
  const scriptHashes = new Set();
  const styleHashes = new Set();
  for (const pagina of PAGINAS) {
    const ruta = path.join(PUBLIC_DIR, pagina);
    if (!fs.existsSync(ruta)) continue;
    const contenido = fs.readFileSync(ruta, 'utf8');
    for (const bloque of extraerBloques(contenido, 'script')) scriptHashes.add(hashSha256(bloque));
    for (const bloque of extraerBloques(contenido, 'style')) styleHashes.add(hashSha256(bloque));
  }
  // Orden estable (no el de inserción de un Set, que puede variar entre
  // ejecuciones si el orden de PAGINAS cambiara) -- para que el string de
  // CSP_POLICY no cambie de un arranque a otro sin motivo.
  return {
    scriptHashes: [...scriptHashes].sort(),
    styleHashes: [...styleHashes].sort(),
  };
}

module.exports = { calcularHashesDeInline, PAGINAS, PUBLIC_DIR };
