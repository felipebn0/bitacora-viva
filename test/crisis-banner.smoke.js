// Banner de líneas de ayuda en crisis (public/eco-crisis-banner.js): qué frases muestran el banner de
// una (suena a algo que pasa AHORA), cuáles primero preguntan si está pasando (pasado o ambiguo) y
// cuáles no hacen nada (expresiones sin riesgo o recuerdos de otra persona). En una app de memorias se
// cuentan muchas cosas duras del pasado: el banner no puede saltar con cada recuerdo.
const path = require('path');
const fs = require('fs');
const { clasificar } = require(path.resolve(__dirname, '..', 'public', 'eco-crisis-banner.js'));

let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };
const espera = (texto, tipo, modo) => {
  const r = clasificar(texto);
  const bien = modo === null ? r === null : !!r && r.tipo === tipo && r.modo === modo;
  ok(bien, `"${texto}" -> ${modo === null ? 'nada' : tipo + '/' + modo}${bien ? '' : ' (dio ' + JSON.stringify(r) + ')'}`);
};

// Presente: banner de una
espera('Me quiero morir', 'suicide', 'directo');
espera('ya no quiero vivir, no aguanto', 'suicide', 'directo');
espera('Estoy pensando en quitarme la vida', 'suicide', 'directo');
espera('tengo pensamientos suicidas desde hace semanas', 'suicide', 'directo');
espera('Me voy a matar', 'suicide', 'directo');
espera('me estoy haciendo daño', 'suicide', 'directo');
espera('Mi esposo me está pegando', 'violence', 'directo');
espera('todavía me pega cuando llega borracho', 'violence', 'directo');
espera('anoche me golpeó otra vez', 'violence', 'directo');
espera('tengo miedo de que me mate', 'violence', 'directo');
espera('me amenaza todos los días', 'violence', 'directo');

// Pasado o ambiguo: primero se pregunta si está pasando ahora
espera('Cuando era niña mi papá me pegaba', 'violence', 'verificar');
espera('mi primer esposo me maltrataba mucho', 'violence', 'verificar');
espera('En esa época quería morirme', 'suicide', 'verificar');
espera('una vez intenté suicidarme', 'suicide', 'verificar');
espera('a veces quiero desaparecer', 'suicide', 'verificar');
espera('hubo violencia intrafamiliar en mi casa', 'violence', 'verificar');
espera('Mi hermano se suicidó y yo también pensé en matarme', 'suicide', 'verificar');

// Sin riesgo: nada
espera('Me muero de la risa con esa historia', null, null);
espera('casi me mato de la risa', null, null);
espera('se me pega esa canción todo el día', null, null);
espera('el sol me pega duro en la finca', null, null);
espera('Mi tío se suicidó en 1990, fue muy duro para todos', null, null);
espera('Nos fuimos a vivir a Cali en el 85', null, null);
espera('', null, null);

// El banner está conectado a la voz en colaborar.html (allí no hay cajas de texto).
const colaborar = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'colaborar.html'), 'utf8');
ok(/window\.ecoCrisisCheck\(texto,/.test(colaborar) && /eco-crisis-banner\.js/.test(colaborar), 'colaborar.html revisa lo que se dice por voz tras transcribir');

// Los números de las líneas son los verificados (195 no es la Línea Púrpura; 192 opción 4 sin confirmar).
const js = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'eco-crisis-banner.js'), 'utf8');
ok(/018000112137/.test(js) && !/num:'195'/.test(js) && !/192 opci/.test(js), 'líneas verificadas: Línea Púrpura 018000112137, sin 195 ni 192 opción 4');

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
