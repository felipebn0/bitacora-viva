// Límites por cuenta en las rutas que gastan IA/voz/transcripción, y enlace mágico con el token en el fragmento (#t=),
// que el navegador no manda al servidor. Verifica el código fuente, como los demás smoke de seguridad.
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(raiz, 'server.js'), 'utf8');
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };
const lineaDeRuta = (ruta) => server.split('\n').find((l) => l.startsWith(`app.post('${ruta}'`)) || '';

ok(/porCuenta\s*=\s*false/.test(server) && /req\.userId\s*\?\s*'cuenta:'/.test(server), 'crearRateLimit cuenta por cuenta (req.userId) cuando porCuenta está activo');
ok(/const rateLimitCuentaTurno = crearRateLimit\('cuenta-turno:'/.test(server), 'limitador por cuenta para turnos definido');
ok(/const rateLimitCuentaVoz = crearRateLimit\('cuenta-voz:'/.test(server), 'limitador por cuenta para voz definido');
ok(/const rateLimitCuentaIA = crearRateLimit\('cuenta-ia:'/.test(server), 'limitador por cuenta para IA definido');

const conCuenta = {
  '/api/next': 'rateLimitCuentaTurno', '/api/next/guardar': 'rateLimitCuentaTurno', '/api/transcribe': 'rateLimitCuentaTurno',
  '/api/story-log/audio': 'rateLimitCuentaTurno', '/api/save-audio': 'rateLimitCuentaTurno', '/api/speak': 'rateLimitCuentaVoz',
  '/api/chapters/generate': 'rateLimitCuentaIA', '/api/contribute-chat': 'rateLimitCuentaIA',
};
for (const [ruta, mw] of Object.entries(conCuenta)) {
  const l = lineaDeRuta(ruta);
  const i = l.indexOf(mw);
  ok(i > -1 && l.indexOf('requireAuth') < i, `${ruta}: ${mw} va después de requireAuth`);
}

ok(/return `\$\{base\}\/magico\.html#t=/.test(server), 'el enlace mágico lleva el token en el fragmento (#t=), no en la query');
ok(!/\/api\/magic-login\?token=/.test(server.replace(/\/\/.*$/gm, '')), 'ningún código genera ya el enlace con ?token= en la URL');
ok(/app\.post\('\/api\/magic-login'/.test(server) && /app\.get\('\/api\/magic-login'/.test(server), 'existen GET (enlaces viejos) y POST (canje desde magico.html)');

const pagina = fs.readFileSync(path.join(raiz, 'public', 'magico.html'), 'utf8');
ok(/<script src="\/magico\.js\?v=\d+" defer><\/script>/.test(pagina) && !/<script>(?!\s*<\/script>)/.test(pagina), 'magico.html carga su script externo y no tiene JS inline');
ok(!/\sstyle="/.test(pagina), 'magico.html sin atributos style inline');
const js = fs.readFileSync(path.join(raiz, 'public', 'magico.js'), 'utf8');
ok(/location\.hash/.test(js) && /method: 'POST'/.test(js) && /\/api\/magic-login/.test(js), 'magico.js lee el fragmento y canjea con POST');
ok(/history\.replaceState/.test(js), 'magico.js quita el token de la barra antes de canjearlo');

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
