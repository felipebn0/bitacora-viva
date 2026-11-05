// Junta i18n/es-en-*.json en public/eco-idioma-en.js (diccionario ES -> EN).
// Uso: node tools/generar-idioma.js
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'i18n');
const salida = path.join(__dirname, '..', 'public', 'eco-idioma-en.js');
const todo = {};
for (const f of fs.readdirSync(dir).filter((x) => /^es-en-\d+\.json$/.test(x)).sort()) {
  const datos = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  Object.assign(todo, datos);
}
// Frases que se arman con un nombre o un número en medio: la clave lleva {} donde
// va el pedazo variable (i18n/patrones.json).
const patrones = (() => {
  const f = path.join(dir, 'patrones.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
})();
const lineas = Object.entries(todo).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
const lineasPatrones = Object.entries(patrones).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
fs.writeFileSync(salida, `/* ECO · Traducciones al inglés (clave = texto en español tal como aparece en la página).\n   Generado por tools/generar-idioma.js a partir de i18n/es-en-*.json. No editar a mano. */\nwindow.ECO_EN = {\n${lineas.join(',\n')}\n};\nwindow.ECO_EN_PATRONES = {\n${lineasPatrones.join(',\n')}\n};\n`);
console.log('entradas:', Object.keys(todo).length, '· patrones:', Object.keys(patrones).length);
