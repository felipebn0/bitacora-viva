#!/usr/bin/env node
// Regenera, dentro de vercel.json, los hashes sha256 de los bloques
// <script>/<style> inline de public/ (ronda 3 del camino a CSP en
// enforce, 2026-09-06).
//
// server.js calcula estos mismos hashes solo (en cada arranque, desde el
// contenido real de las páginas -- ver csp-hashes.js), así que ahí nunca
// se desactualizan. Pero vercel.json es la copia que de verdad gobierna
// las páginas estáticas en producción (public/** se sirve directo desde
// el build de Vercel, sin pasar por server.js -- ver el comentario junto
// a CSP_POLICY en server.js), y es texto estático: no hay forma de que
// "calcule" nada solo.
//
// Correr este script:
//   node tools/actualizar-hashes-vercel.js
// después de cualquier cambio al <script> o <style> inline de una página
// de public/, y commitear el vercel.json resultante junto con ese cambio.
// test/hashes-csp-vercel.smoke.js falla fuerte si alguien se olvida (compara
// lo que hay en vercel.json contra lo que HOY darían las páginas reales).
'use strict';
const fs = require('fs');
const path = require('path');
const { calcularHashesDeInline } = require('../csp-hashes');

const VERCEL_JSON_PATH = path.join(__dirname, '..', 'vercel.json');

function construirDirectiva(nombre, hashes) {
  return `${nombre} 'self' ${hashes.map((h) => `'${h}'`).join(' ')}`;
}

function main() {
  const { scriptHashes, styleHashes } = calcularHashesDeInline();
  const raw = fs.readFileSync(VERCEL_JSON_PATH, 'utf8');
  // JSON.parse + JSON.stringify reformatearía TODO el archivo (colapsa
  // objetos de una línea, reordena espacios, etc.) -- un reemplazo de
  // texto quirúrgico, solo sobre el valor del header de CSP, deja el
  // resto del archivo carácter por carácter igual.
  JSON.parse(raw); // valida que siga siendo JSON bien formado antes de tocar nada

  const clavePolicy = raw.includes('"Content-Security-Policy-Report-Only"') ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
  const re = new RegExp(`"${clavePolicy}":\\s*"([^"]*(?:\\\\.[^"]*)*)"`);
  const m = raw.match(re);
  if (!m) {
    throw new Error(`No se encontró el header "${clavePolicy}" en vercel.json -- revisar a mano.`);
  }

  const partes = m[1].split('; ');
  const nuevaPartes = partes.map((parte) => {
    if (parte.startsWith('script-src')) return construirDirectiva('script-src', scriptHashes);
    if (parte.startsWith('style-src')) return construirDirectiva('style-src', styleHashes);
    return parte;
  });
  const nuevaPolicy = nuevaPartes.join('; ');

  if (m[1] === nuevaPolicy) {
    console.log('vercel.json ya tiene los hashes al día -- nada que cambiar.');
    return;
  }

  const nuevoRaw = raw.slice(0, m.index) + `"${clavePolicy}": "${nuevaPolicy}"` + raw.slice(m.index + m[0].length);
  JSON.parse(nuevoRaw); // por las dudas: confirma que el reemplazo no rompió el JSON
  fs.writeFileSync(VERCEL_JSON_PATH, nuevoRaw, 'utf8');
  console.log('vercel.json actualizado con los hashes actuales de public/ (sin tocar el resto del archivo).');
  console.log(`  script-src: ${scriptHashes.length} hashes`);
  console.log(`  style-src:  ${styleHashes.length} hashes`);
}

main();
