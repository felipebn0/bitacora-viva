// El idioma se elige al crear la cuenta y manda en toda la bitácora: dentro de
// la app no hay botón para cambiarlo. Se verifica que (1) las páginas de la app
// pidan el idioma de la cuenta, (2) el motor lo consulte en /api/me y no dibuje
// la bandera, (3) el diccionario traiga los textos que antes quedaban en
// español, y (4) los patrones con nombre estén bien formados.
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

const PAGINAS_APP = ['app', 'arbol', 'capitulos', 'colaboraciones', 'colaborar', 'diario-bebe',
  'escuchar', 'historias', 'perfilar', 'perfiles', 'restablecer', 'admin'];
for (const p of PAGINAS_APP) {
  const html = leer(path.join('public', p + '.html'));
  ok(/<html[^>]*\sdata-idioma-cuenta/.test(html), p + '.html: <html> pide el idioma de la cuenta');
  ok(html.includes('/eco-idioma-en.js') && html.includes('/eco-idioma.js'), p + '.html: carga el diccionario y el motor');
  ok(!html.includes('eco-idioma.css'), p + '.html: no trae la hoja de la bandera (dentro de la app no hay botón)');
}

const motor = leer('public/eco-idioma.js');
ok(motor.includes("document.documentElement.hasAttribute('data-idioma-cuenta')"), 'el motor reconoce el modo "idioma de la cuenta"');
ok(/function crearBoton\(\) \{\s*if \(POR_CUENTA/.test(motor), 'en ese modo no se dibuja la bandera');
ok(motor.includes("fetch('/api/me'"), 'el motor consulta el idioma guardado en la cuenta');
ok(motor.includes('characterData: true'), 'también mira los textos que cambian sin agregar nodos (el saludo)');
ok(/function envolverAvisos\(\)/.test(motor) && /'confirm', 'alert', 'prompt'/.test(motor), 'los avisos del navegador (confirm/alert) también se traducen');

// En el registro, el idioma de la bitácora arranca en el idioma en que está el landing.
ok(/campoIdioma\.value = idioma/.test(motor), 'el campo del registro sigue el idioma del landing');
ok(/campoIdioma\.dataset\.elegido/.test(motor), 'si la persona lo eligió a mano, no se le pisa');
for (const p of ['index', 'index-v2']) {
  const html = leer(path.join('public', p + '.html'));
  ok(/id="suIdioma"/.test(html), p + '.html: el registro tiene el campo de idioma');
  ok(/idioma: document\.getElementById\('suIdioma'\)\.value/.test(html), p + '.html: el registro manda el idioma elegido');
}

const server = leer('server.js');
ok(/ALTER TABLE users ADD COLUMN IF NOT EXISTS idioma/.test(server), 'la cuenta guarda el idioma');
ok(/idioma: \(contextoDePedido\.getStore\(\) \|\| \{\}\)\.idioma/.test(server), '/api/me devuelve el idioma de la cuenta');

// La voz de la IA: el prompt dice decenas de veces "español de Colombia", así que
// el aviso de inglés va arriba Y abajo, y dice expresamente que gana.
ok(/function cabeceraIdioma\(\)/.test(server), 'hay una cabecera de idioma para el prompt');
ok(/THIS ACCOUNT IS IN ENGLISH/.test(server), 'la cabecera avisa en inglés desde la primera línea');
ok(/THIS RULE BEATS EVERY OTHER INSTRUCTION/.test(server), 'la regla de idioma dice que gana sobre el resto del prompt');
ok((server.match(/cabeceraIdioma\(\)/g) || []).length >= 3, 'la cabecera se aplica a la charla principal y a la de aportes');
ok(/system = cabeceraIdioma\(\) \+ system \+ instruccionIdiomaRespuesta\(\)/.test(server), 'charla principal: cabecera + prompt + regla final');
ok(/ctxAporte\.idioma = await idiomaDeUsuario\(ownerId\)/.test(server), 'quien aporta sin cuenta sigue el idioma de la bitácora');
ok(/AZURE_VOICE_NAME_EN/.test(server), 'el respaldo de voz de Azure tiene voz en inglés');

const dicFuente = leer('public/eco-idioma-en.js');
const ventana = {};
new Function('window', dicFuente)(ventana);
const dic = ventana.ECO_EN || {};
const patrones = ventana.ECO_EN_PATRONES || {};
ok(Object.keys(dic).length > 1500, 'el diccionario trae los textos de la app (' + Object.keys(dic).length + ')');

const IMPRESCINDIBLES = [
  'Creando tu cuenta…',            // el aviso del registro que salía en español
  'Bienvenida a Eco',              // tutorial
  'Saltar el tutorial',
  'Todo listo',
  'Buenas tardes,',                // saludo de la pantalla principal
  'Háblale a ECO',                 // recorrido
  'Mi bitácora',
  'No se pudo guardar. Intenta de nuevo.',
  'Continuar',                     // botón del tutorial
  'Hablando…',                     // estado del orbe
  'Yo',                            // tarjeta del árbol
  'Portada',                       // libro
  'Voz del libro',
  '← Volver a la bitácora',
  'Usuario principal'
];
for (const t of IMPRESCINDIBLES) ok(typeof dic[t] === 'string' && dic[t].length > 0, 'hay traducción para: ' + t);

ok(Object.keys(patrones).length > 0, 'hay patrones para las frases con un nombre en medio');
for (const p of ['Paso {} de {}', 'Escuché: «{}». ¡Muy bien!']) {
  ok(typeof patrones[p] === 'string', 'hay patrón para: ' + p);
}
for (const [es, en] of Object.entries(patrones)) {
  const huecosEs = (es.match(/\{\}/g) || []).length;
  const huecosEn = (en.match(/\{\}/g) || []).length;
  if (huecosEs !== huecosEn) ok(false, 'el patrón «' + es + '» tiene ' + huecosEs + ' huecos en español y ' + huecosEn + ' en inglés');
}
ok(fallaron === 0 || true, 'patrones revisados: ' + Object.keys(patrones).length);

// Las traducciones se generan: el archivo público no se edita a mano.
const generador = leer('tools/generar-idioma.js');
ok(generador.includes('ECO_EN_PATRONES'), 'el generador también arma los patrones');

console.log('\n' + pasaron + ' pasaron, ' + fallaron + ' fallaron');
if (fallaron) process.exit(1);
