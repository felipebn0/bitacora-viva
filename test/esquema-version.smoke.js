// Arranque en frío: una instancia nueva no vuelve a correr todo el esquema (más de 150 CREATE/ALTER) si la base ya lo
// tiene. Solo lo corre la primera vez, cuando cambia alguna sentencia, o si se fuerza con ECO_FORZAR_ESQUEMA=1.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';
delete process.env.ECO_FORZAR_ESQUEMA;

const path = require('path');
const http = require('http');
const serverPath = path.resolve(__dirname, '..', 'server.js');

// "Base de datos" que sobrevive entre instancias: solo guarda la versión del esquema.
const base = { version: null, tablaMeta: false };
let transacciones = [];
let consultasSueltas = [];
function fakeSql(strings, ...v) {
  const text = strings.join('?');
  const q = { text, valores: v, then: (ok, mal) => ejecutar(text, v).then(ok, mal) };
  return q;
}
function ejecutar(text, v) {
  consultasSueltas.push(text);
  if (text.includes('SELECT version FROM schema_meta')) {
    if (!base.tablaMeta) return Promise.reject(Object.assign(new Error('relation "schema_meta" does not exist'), { code: '42P01' }));
    return Promise.resolve(base.version ? [{ version: base.version }] : []);
  }
  if (text.includes('CREATE TABLE IF NOT EXISTS schema_meta')) { base.tablaMeta = true; return Promise.resolve([]); }
  if (text.includes('INSERT INTO schema_meta')) { base.version = v[0]; return Promise.resolve([]); }
  return Promise.resolve([]);
}
fakeSql.transaction = (consultas) => { transacciones.push(consultas.length); return Promise.resolve(consultas.map(() => [])); };

const cache = (mod, exports) => { require.cache[require.resolve(mod)] = { id: require.resolve(mod), filename: require.resolve(mod), loaded: true, exports }; };
cache('@neondatabase/serverless', { neon: () => fakeSql });
cache('@vercel/blob', { put: async () => ({ url: 'x' }), del: async () => {}, list: async () => ({ blobs: [], hasMore: false }), get: async () => null });
cache('@anthropic-ai/sdk', class { constructor() {} });

function pedir(server, ruta) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path: ruta, method: 'GET' }, (res) => {
      const ch = []; res.on('data', (x) => ch.push(x)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(ch).toString() }));
    });
    r.on('error', reject); r.end();
  });
}
// Una "instancia nueva" = volver a cargar server.js desde cero (como un arranque en frío en Vercel).
async function instanciaNueva(pedidos = 1) {
  delete require.cache[serverPath];
  transacciones = []; consultasSueltas = [];
  const app = require(serverPath);
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  const respuestas = [];
  for (let i = 0; i < pedidos; i++) respuestas.push(await pedir(server, '/api/clave/estado'));
  server.close();
  return { respuestas, transacciones: transacciones.slice(), revisiones: consultasSueltas.filter((t) => t.includes('SELECT version FROM schema_meta')).length };
}
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

(async () => {
  let r = await instanciaNueva();
  ok(r.respuestas[0].status === 200, 'la primera instancia responde (200)');
  ok(r.transacciones.length === 1 && r.transacciones[0] > 100, `base nueva: se aplica el esquema completo una vez (${r.transacciones[0]} sentencias)`);
  ok(base.tablaMeta && /^[a-f0-9]{32}$/.test(base.version || ''), 'y queda guardada la versión del esquema');
  const version1 = base.version;

  r = await instanciaNueva(3);
  ok(r.respuestas.every((x) => x.status === 200), 'una instancia nueva (arranque en frío) responde');
  ok(r.transacciones.length === 0, 'y NO vuelve a correr el esquema: la base ya lo tiene');
  ok(r.revisiones === 1, 'solo hace una consulta de revisión, una vez por instancia (no una por pedido)');

  base.version = 'version-vieja-de-otro-despliegue';
  r = await instanciaNueva();
  ok(r.transacciones.length === 1 && base.version === version1, 'si el esquema cambió (la versión guardada es otra), se aplica completo y se actualiza la versión');

  process.env.ECO_FORZAR_ESQUEMA = '1';
  r = await instanciaNueva();
  ok(r.transacciones.length === 1, 'con ECO_FORZAR_ESQUEMA=1 se aplica siempre, aunque la versión coincida');
  delete process.env.ECO_FORZAR_ESQUEMA;

  base.tablaMeta = false; base.version = null;
  r = await instanciaNueva();
  ok(r.respuestas[0].status === 200 && r.transacciones.length === 1 && base.tablaMeta, 'si la tabla de versión no existe (base restaurada o nueva), no falla: aplica el esquema y la crea');

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
