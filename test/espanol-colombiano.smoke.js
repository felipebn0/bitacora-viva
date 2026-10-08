// Verificación estática del "español de Colombia 100%" (pedido de Felipe,
// 2026-10-08): (1) TODO system prompt de Claude lleva la regla explícita,
// para que un prompt nuevo no pueda quedar sin ella; (2) ningún texto
// visible de las páginas trae voseo ni argentinismos; (3) el detector y el
// reemplazo determinista cubren lo que prometen. El comportamiento en vivo
// (corrección de lo que escribe la IA) se prueba en test/next.smoke.js.
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(raiz, 'server.js'), 'utf8');
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

// --- 1) Cada llamada a Claude lleva la regla en su system prompt ---
const llamadas = [...server.matchAll(/anthropic\.messages\.create\(/g)].length;
ok(llamadas >= 9, `hay ${llamadas} llamadas a anthropic.messages.create en server.js`);
// Los 9 prompts "grandes" se arman con la regla de datos no confiables; la de
// idioma tiene que ir siempre pegada al lado.
const conDatos = [...server.matchAll(/\+ REGLA_DATOS_NO_CONFIABLES/g)].length;
const conAmbas = [...server.matchAll(/\+ REGLA_DATOS_NO_CONFIABLES \+ REGLA_ESPANOL_COLOMBIANO/g)].length;
ok(conDatos >= 9 && conDatos === conAmbas, `los ${conDatos} system prompts con datos no confiables llevan también REGLA_ESPANOL_COLOMBIANO (${conAmbas})`);
ok(/system: 'Vas a recibir un mensaje de una entrevistadora cálida[^\n]*\+ REGLA_ESPANOL_COLOMBIANO,/.test(server), 'el corrector de "una sola pregunta" lleva la regla');
ok(/system: 'Vas a recibir un mensaje de una entrevistadora colombiana[^\n]*\+ REGLA_ESPANOL_COLOMBIANO,/.test(server), 'el corrector de dialecto lleva la regla');

// La regla en sí es explícita: nombra el voseo y los argentinismos, el tuteo
// y que lo dicho por la persona se conserva.
const regla = server.slice(server.indexOf('const REGLA_ESPANOL_COLOMBIANO'), server.indexOf('// Formas que NO son español de Colombia'));
for (const frag of ['español de Colombia, 100%', 'NUNCA voseo', 'tenés', 'contame', 'che, boludo', 'aquí', 'carro', 'conserva sus palabras exactamente']) {
  ok(regla.includes(frag), `la regla explícita incluye "${frag}"`);
}

// --- 2) Las páginas: sin voseo ni vocabulario no colombiano en el texto visible ---
const PALABRAS = ['vos', 'sos', 'tenés', 'querés', 'podés', 'sabés', 'decís', 'contás', 'hacés', 'vení', 'mirá', 'fijate', 'acordate', 'contame', 'decime',
  'andá', 'pensá', 'imaginate', 'hablá', 'sentate', 'esperá', 'dejá', 'poné', 'llamá', 'mandá', 'buscá', 'hacé', 'decí', 'cargá', 'guardá', 'compartís',
  'invitás', 'administrás', 'pagás', 'empezá', 'che', 'boludo', 'pibe', 'laburo', 'piola', 'copado', 'acá'];
const re = new RegExp('(?<![\\p{L}\\p{N}_-])(?:' + PALABRAS.join('|') + ')(?![\\p{L}\\p{N}_-])', 'giu');
function textoVisible(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, (b) => b) // el JS también tiene textos visibles: se deja
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
}
const publico = path.join(raiz, 'public');
const paginas = ['index.html', 'index-v2.html', 'app.html', 'colaborar.html', 'colaboraciones.html', 'historias.html', 'capitulos.html', 'arbol.html',
  'perfiles.html', 'perfilar.html', 'admin.html', 'privacidad.html', 'terminos.html', 'audiencias/adulto.html', 'audiencias/mayor.html', 'audiencias/nina.html'];
for (const f of paginas) {
  const ruta = path.join(publico, f);
  if (!fs.existsSync(ruta)) continue;
  const hallazgos = [...textoVisible(fs.readFileSync(ruta, 'utf8')).matchAll(re)].map((m) => m[0]);
  ok(hallazgos.length === 0, `${f}: sin voseo ni argentinismos${hallazgos.length ? ' — encontrado: ' + [...new Set(hallazgos)].join(', ') : ''}`);
}

// --- 3) El detector y el reemplazo determinista (se extraen del código real) ---
const m = server.match(/const PALABRAS_NO_COLOMBIANAS = [\s\S]*?function corregirDeterministicoAColombiano[\s\S]*?\n}\n/);
ok(!!m, 'se encontró el bloque del detector en server.js');
if (m) {
  const { detectarFueraDeColombia, corregirDeterministicoAColombiano } = new Function(m[0] + '\nreturn { detectarFueraDeColombia, corregirDeterministicoAColombiano };')();
  ok(detectarFueraDeColombia('¿Vos qué querés contarme? Mirá, acá tenés tiempo, che.').length >= 5, 'el detector encuentra voseo y argentinismos');
  ok(detectarFueraDeColombia('Cuéntame más. ¿Cómo eran los domingos en tu casa? Uy, qué belleza.').length === 0, 'el detector deja pasar español colombiano normal');
  ok(detectarFueraDeColombia('Te conté que subí al cerro, compartí el almuerzo y salí temprano.').length === 0, 'no marca pasados válidos de tú (subí, compartí, salí)');
  ok(detectarFueraDeColombia('La palabra "auto" y el autobús: el bus de la autopista.').length === 1, 'marca "auto" suelto pero no autobús ni autopista');
  ok(corregirDeterministicoAColombiano('Mirá, acá tenés que contarme más. Contame de tu auto.') === 'Mira, aquí tienes que contarme más. Cuéntame de tu carro.', 'el reemplazo determinista deja español colombiano y respeta mayúsculas');
  ok(detectarFueraDeColombia(corregirDeterministicoAColombiano('¿Vos sos de acá? Decime, che, ¿qué querés?')).length === 1, 'tras el reemplazo solo queda lo que no tiene equivalente directo ("che")');
}

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
