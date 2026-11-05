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
const lineas = Object.entries(todo).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
fs.writeFileSync(salida, `/* ECO · Traducciones al inglés (clave = texto en español tal como aparece en la página).\n   Generado por tools/generar-idioma.js a partir de i18n/es-en-*.json. No editar a mano. */\nwindow.ECO_EN = {\n${lineas.join(',\n')}\n};\n`);
console.log('entradas:', Object.keys(todo).length);
