// Cómo quiere ser tratada cada persona (masculino/femenino): antes la IA
// asumía mujer para todas las personas nuevas. Se verifica con el código real
// de server.js que (1) el valor se valida, (2) las instrucciones cambian según
// el trato y sin trato piden NO asumir, (3) el trato se guarda en el registro,
// el perfil y los subperfiles, y (4) las páginas lo piden.
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(raiz, 'server.js'), 'utf8');
const leer = (f) => fs.readFileSync(path.join(raiz, 'public', f), 'utf8');
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

const ini = server.indexOf('function tratamientoValido');
const fin = server.indexOf('\n// Contraparte de users.tree_pending_names', ini);
ok(ini !== -1 && fin > ini, 'se encontró el bloque de trato en server.js');
const { tratamientoValido, instruccionTratamiento } = new Function(server.slice(ini, fin) + '\nreturn { tratamientoValido, instruccionTratamiento };')();

ok(tratamientoValido('masculino') === 'masculino' && tratamientoValido(' Femenino ') === 'femenino', 'acepta masculino y femenino (sin importar mayúsculas)');
ok(tratamientoValido('otro') === null && tratamientoValido('') === null && tratamientoValido(undefined) === null, 'cualquier otro valor queda sin elegir');
ok(/MASCULINO/.test(instruccionTratamiento('masculino')) && !/FEMENINO/.test(instruccionTratamiento('masculino')), 'masculino: la instrucción pide género masculino');
ok(/FEMENINO/.test(instruccionTratamiento('femenino')) && !/MASCULINO/.test(instruccionTratamiento('femenino')), 'femenino: la instrucción pide género femenino');
ok(/No lo asumas por el nombre/.test(instruccionTratamiento(null)), 'sin trato: la instrucción pide NO asumir por el nombre');

ok(/ADD COLUMN IF NOT EXISTS tratamiento TEXT/.test(server) && (server.match(/ADD COLUMN IF NOT EXISTS tratamiento TEXT/g) || []).length === 2, 'columna tratamiento en users y en bitacoras');
ok(/INSERT INTO users \([^)]*tratamiento\)/.test(server), 'el registro guarda el trato');
ok(/INSERT INTO bitacoras \([^)]*tratamiento\)/.test(server), 'crear un subperfil guarda el trato');
ok(/tratamiento = COALESCE\(\$\{cleanTratamiento\}, tratamiento\)/.test(server), 'editar el perfil no borra el trato si no se manda');
ok(/app\.post\('\/api\/subprofiles\/:id\/tratamiento'/.test(server), 'se puede cambiar el trato de un subperfil existente');
ok(/instruccionTratamiento\(tratamientoValido\(perfil && perfil\.tratamiento\)\)/.test(server), 'la charla normal recibe el trato de la bitácora activa');
ok(/ARBOL_SYSTEM_PROMPT \+ instruccionTratamiento/.test(server), 'la charla del árbol también');
ok(/instruccionTratamientoDeTercero\(nombre, ownerTratamiento\)/.test(server), 'los aportes de familiares también');

for (const f of ['index.html', 'index-v2.html']) {
  const h = leer(f);
  ok(/id="suTratamiento"[^>]*required/.test(h) && /tratamiento, password/.test(h), `${f}: el registro pide y envía el trato`);
}
ok(/id="umProfileTratamiento"/.test(leer('app.html')) && /tratamiento: umProfileTratamiento\.value/.test(leer('app.html')), 'app.html: el perfil propio permite elegirlo');
ok(/id="nuevoTratamiento"/.test(leer('perfiles.html')) && /data-tratamiento=/.test(leer('perfiles.html')), 'perfiles.html: se pide al crear y se puede cambiar después');
ok(!/no puedes contar su historia por ella/.test(leer('app.html')), 'el aviso del subperfil ya no asume mujer');
ok(!/Salúdala/.test(server.replace(/Salúdala\/salúdalo/g, '')), 'los saludos de la IA ya no dicen "Salúdala"');

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
