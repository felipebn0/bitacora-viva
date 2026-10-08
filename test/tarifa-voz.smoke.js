// Tarifa de voz de ElevenLabs para el panel de consumo (2026-10-08): $0.04 por
// 1.000 caracteres, con la promoción de v4 Turbo ($0.011) hasta el 12 de
// octubre de 2026 (hora de Colombia). Se extrae el bloque real de server.js y
// se ejecuta con el reloj y el modelo simulados.
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');
const ini = server.indexOf('const ELEVEN_TTS_TARIFA_NORMAL');
const fin = server.indexOf('function elevenSttRatePerHour');
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };
ok(ini !== -1 && fin > ini, 'se encontró el bloque de tarifas en server.js');

function tarifa({ modelo, ahora, env = {}, opts }) {
  const falsoDate = { now: () => Date.parse(ahora), parse: Date.parse };
  const fn = new Function('process', 'ELEVEN_MODEL_ID', 'Date', server.slice(ini, fin) + '\nreturn elevenTtsRatePer1kChars;');
  return fn({ env }, modelo, falsoDate)(opts);
}
ok(tarifa({ modelo: 'eleven_v4_turbo', ahora: '2026-10-08T12:00:00-05:00' }) === 0.011, 'v4 Turbo durante la promo -> $0.011');
ok(tarifa({ modelo: 'eleven_v4_turbo', ahora: '2026-10-12T23:00:00-05:00' }) === 0.011, 'v4 Turbo el último día de la promo (12 de octubre) -> $0.011');
ok(tarifa({ modelo: 'eleven_v4_turbo', ahora: '2026-10-13T00:30:00-05:00' }) === 0.04, 'v4 Turbo al día siguiente -> vuelve a $0.04 solo');
ok(tarifa({ modelo: 'eleven_flash_v2_5', ahora: '2026-10-08T12:00:00-05:00' }) === 0.04, 'Flash v2.5 durante la promo -> $0.04 (la promo no le aplica)');
ok(tarifa({ modelo: 'eleven_v4_turbo', ahora: '2026-10-08T12:00:00-05:00', opts: { conPromo: false } }) === 0.04, 'sin promo (recálculo del historial) -> $0.04');
ok(tarifa({ modelo: 'eleven_v4_turbo', ahora: '2026-10-08T12:00:00-05:00', env: { ELEVENLABS_PRICE_PER_1K_CHARS: '0.07' } }) === 0.07, 'la variable de Vercel manda sobre todo');
ok(/elevenTtsPer1kChars: elevenTtsRatePer1kChars\(\)/.test(server), 'el panel muestra la tarifa efectiva (con promo si corresponde)');
ok(/elevenTtsRatePer1kChars\(\{ conPromo: false \}\)/.test(server), 'el recálculo del historial usa la tarifa normal');
ok(!/process\.env\.ELEVENLABS_PRICE_PER_1K_CHARS \|\| 0\.05/.test(server), 'ya no queda el $0.05 viejo');

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
