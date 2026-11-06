// El panel lateral de Cuenta oculta "Opciones avanzadas" y reparte sus secciones en cuatro apartados. Si una sección
// no se reparte, queda escondida y nadie puede llegar a ella (pasó con el tutorial: "Ver el tutorial otra vez" desapareció).
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');
const lateral = fs.readFileSync(path.join(__dirname, '..', 'public', 'eco-cuenta-lateral.js'), 'utf8');

let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

const inicio = app.indexOf('id="umSecAvanzadas"');
const fin = app.indexOf('id="umLogoutBtn"');
const dentro = [...app.slice(inicio, fin).matchAll(/aria-controls="(umSec[A-Za-z]+)"/g)].map((m) => m[1]);
const movidas = new Set([...lateral.matchAll(/'(umSec[A-Za-z]+)'/g)].map((m) => m[1]));
ok(dentro.length >= 7, `se encontraron las secciones de Opciones avanzadas (${dentro.length})`);
for (const id of dentro) ok(movidas.has(id), `${id} se mueve a un apartado visible del panel de Cuenta`);
ok(/umSecTutorial/.test(lateral), 'el tutorial ("Ver el tutorial otra vez") queda accesible');

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
