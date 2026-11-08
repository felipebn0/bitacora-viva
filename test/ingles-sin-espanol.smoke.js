// Cuentas en inglés: la IA nunca debe hablar en español. Se verifica (1) el
// detector de frases en español, (2) que la charla y los aportes lleven el
// recordatorio pegado al último mensaje, (3) que el adelanto de frases a la voz
// se corte ante una frase en español y (4) la red de seguridad final.
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(raiz, 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(raiz, 'public', 'app.html'), 'utf8');
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

const a = server.indexOf('const SOLO_ES');
const b = server.indexOf('// Red de seguridad final');
const ctx = {};
new Function('ctx', server.slice(a, b) + '\nctx.pareceEspanol = pareceEspanol;')(ctx);
const { pareceEspanol } = ctx;
for (const t of [
  'What a lovely memory, José. How old were you when you moved to Bogotá?',
  'Tell me more about your grandmother.',
  'Okay.',
  'La Casa de la Abuela was the name of the restaurant, right?',
]) ok(!pareceEspanol(t), 'inglés no se marca: ' + t);
for (const t of [
  'Qué bonito recuerdo. ¿Cuántos años tenías?',
  'Perfecto, hemos llegado al fin por hoy.',
  'Cuéntame más de tu abuela.',
  'Sí, claro.',
]) ok(pareceEspanol(t), 'español se marca: ' + t);

ok(/messages: conRecordatorioDeIdioma\(messages\),\s*\n\s*\};/.test(server), 'la charla principal lleva el recordatorio en el último mensaje');
ok(/messages: conRecordatorioDeIdioma\(messages\),\s*\n\s*\}\);\s*\n\s*await logClaudeUsage\(ownerId, 'aporte_charla'/.test(server), 'la charla de aportes lleva el recordatorio');
ok(/\{ ingles: idiomaDeLaSolicitud\(\) === 'en' \}\);/.test(server), 'el adelanto de frases a la voz sabe si la cuenta es en inglés');
ok(/const fueraDeIdioma = \(t\) => \(ingles \? pareceEspanol\(t\)/.test(server), 'una frase en español corta el adelanto');
ok((server.match(/else text = await asegurarIngles\(/g) || []).length === 2, 'red de seguridad final en la charla y en los aportes');
ok(/content: document\.documentElement\.lang === 'en'\s*\n\s*\? '\(The person tapped the «End» button/.test(app), 'el aviso de «Fin» va en inglés para cuentas en inglés');
ok(/fallbackRecognition\.lang = \(document\.documentElement\.lang === 'en' \? 'en-US' : 'es-CO'\)/.test(app), 'el reconocimiento de respaldo del navegador escucha en inglés');
ok(/const prefijo = document\.documentElement\.lang === 'en' \? 'en' : 'es';/.test(app), 'la voz de respaldo del navegador es en inglés');

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
if (fallaron) process.exit(1);
