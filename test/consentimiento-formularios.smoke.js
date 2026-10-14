// Todos los formularios de entrada piden aceptar Términos y Política de
// Privacidad con un checkbox, y el servidor guarda la fecha. El comportamiento
// de las rutas se prueba en signup.smoke.js, guest.smoke.js y subperfiles.smoke.js.
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

for (const f of ['public/index.html', 'public/index-v2.html']) {
  const h = leer(f);
  ok(/<input[^>]*id="suTerms"[^>]*type="checkbox"[^>]*required|<input[^>]*id="suTerms"[^>]*required[^>]*type="checkbox"/.test(h), `${f}: el registro tiene el checkbox de términos obligatorio`);
  ok(/for="suTerms">[^<]*<a href="\/terminos\.html"[^>]*>[^<]*<\/a>[^<]*<a href="\/privacidad\.html"/.test(h), `${f}: el checkbox enlaza los Términos y la Política de Privacidad`);
  ok(/acceptTerms: true/.test(h), `${f}: manda acceptTerms al servidor`);
}

const colab = leer('public/colaborar.html');
ok(/id="guestTerms"/.test(colab) && /href="\/terminos\.html"/.test(colab) && /href="\/privacidad\.html"/.test(colab), 'colaborar.html: la entrada de invitado tiene el checkbox con los dos enlaces');
ok(/acceptTerms: guestTerms\.checked/.test(colab), 'colaborar.html: manda acceptTerms al servidor');
ok(/guestTermsRow\.hidden = !!data\.terminosAlDia/.test(colab), 'colaborar.html: no vuelve a pedirlo a quien ya aceptó esta versión');

const app = leer('public/app.html');
ok(/id="narradorTerms"/.test(app) && /href="\/terminos\.html"/.test(app) && /href="\/privacidad\.html"/.test(app), 'app.html: la entrada del narrador tiene el checkbox con los dos enlaces');
ok(/acceptTerms: narradorTerms\.checked/.test(app), 'app.html: manda acceptTerms al servidor');
ok(/showNarradorScreen\(data\.bitacoraNombre, data\.pinYaConfigurado, data\.terminosAlDia\)/.test(app), 'app.html: no vuelve a pedirlo a quien ya aceptó esta versión');

const server = leer('server.js');
for (const frag of [
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at',
  'ALTER TABLE invitados ADD COLUMN IF NOT EXISTS terms_accepted_at',
  'ALTER TABLE bitacoras ADD COLUMN IF NOT EXISTS narrador_terms_accepted_at',
  'CREATE TABLE IF NOT EXISTS consentimientos',
]) ok(server.includes(frag), `server.js: ${frag}`);
ok(!/DELETE FROM consentimientos/.test(server), 'server.js: el borrado de cuenta no destruye la prueba de consentimiento');

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
