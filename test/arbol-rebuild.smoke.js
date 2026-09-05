// Smoke test para la mitad SERVIDOR del arreglo de conexiones rotas en el
// árbol genealógico (ver también test/arbol-conexiones.playwright.js, que
// cubre la mitad del NAVEGADOR).
//
// El árbol conecta a cada persona con sus padres por coincidencia EXACTA de
// texto entre "nombre" y "padres" — sin ID de por medio. Como esa lista la
// reescribe la IA en cada /api/save y de nuevo entera en /api/rebuild-tree,
// bastaba con que alguna vez escribiera el mismo nombre con un acento
// distinto para que la conexión se rompiera en silencio (el nodo quedaba
// "flotando", sin línea, a veces en la fila equivocada).
//
// Este test simula justo ese caso: el modelo (fake, programable) devuelve
// una persona cuyo "padres" tiene un acento distinto al "nombre" real de su
// madre. Verifica que server.js (resolverPadresPorNombreParecido) corrija
// esa referencia ANTES de guardarla — así lo que llega al navegador ya
// viene conectado, sin depender de que el navegador también lo arregle.
// También verifica el caso sin arreglo posible (un nombre que de verdad no
// se parece a nadie): se dejan tal cual, sin inventar una conexión, y se
// avisa por consola para que el problema se pueda diagnosticar.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const PASSWORD_HASH = bcrypt.hashSync('miclave123', 4);

const user = { id: 1, username: 'jorge', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null };

let familyMembers = []; // fila: { id, nombre, relacion, detalles, padres (string JSON o null) }
let nextId = 1;
let treePendingNames = null;

// El tool_use que "la IA" va a devolver en la próxima llamada de rebuild —
// cada test lo pisa antes de pedir /api/rebuild-tree.
let proximaRespuestaArbol = null;

function fakeSql(strings, ...values) {
  const text = strings.join('?');

  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);

  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    if (values[0] === user.username) return Promise.resolve([{ id: user.id, username: user.username, password_hash: user.password_hash, token_version: user.token_version }]);
    return Promise.resolve([]);
  }
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) {
    if (values[0] === user.id) return Promise.resolve([{ owner_user_id: user.owner_user_id, token_version: user.token_version }]);
    return Promise.resolve([]);
  }

  if (text.includes('SELECT intercambios FROM sessions')) {
    return Promise.resolve([{ intercambios: [
      { role: 'assistant', content: '¿Cómo se llamaba tu papá?' },
      { role: 'user', content: 'Se llamaba Pedro Vargas, y mi abuela paterna (su mamá) era Alejandrina.' },
    ] }]);
  }

  if (text.includes('SELECT nombre, relacion, detalles, padres FROM family_members') && !text.includes('ORDER BY id')) {
    // personasPrevias, adentro de updateFamilyTree — vacío en ambos tests.
    return Promise.resolve([]);
  }
  if (text.includes('SELECT descripcion, anio, edad_aprox, categoria FROM timeline_events')) {
    return Promise.resolve([]); // eventosPrevios, y la relectura final (no se usan eventos en este test)
  }

  if (text.includes('SELECT tree_pending_names FROM users WHERE id')) {
    return Promise.resolve([{ tree_pending_names: treePendingNames }]);
  }
  if (text.includes('UPDATE users SET tree_pending_names')) {
    treePendingNames = values[0];
    return Promise.resolve([]);
  }

  if (text.includes('DELETE FROM family_members')) {
    familyMembers = [];
    return Promise.resolve([]);
  }
  if (text.includes('INSERT INTO family_members')) {
    const [userId, nombre, relacion, detalles, padres] = values;
    familyMembers.push({ id: nextId++, user_id: userId, nombre, relacion, detalles, padres });
    return Promise.resolve([]);
  }
  if (text.includes('DELETE FROM timeline_events')) return Promise.resolve([]);
  if (text.includes('INSERT INTO timeline_events')) return Promise.resolve([]);

  if (text.includes('SELECT nombre, relacion, detalles, padres FROM family_members') && text.includes('ORDER BY id')) {
    // Relectura final que hace la propia ruta /api/rebuild-tree.
    return Promise.resolve(familyMembers.map((p) => ({ nombre: p.nombre, relacion: p.relacion, detalles: p.detalles, padres: p.padres })));
  }

  return Promise.resolve([]);
}
fakeSql.transaction = (queries) => Promise.all(queries);

require.cache[require.resolve('@neondatabase/serverless')] = {
  id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true,
  exports: { neon: () => fakeSql },
};
require.cache[require.resolve('@vercel/blob')] = {
  id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true,
  exports: { put: async () => ({ url: 'https://fake.public.blob.vercel-storage.com/x' }), del: async () => {}, get: async () => null },
};

require.cache[require.resolve('@anthropic-ai/sdk')] = {
  id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true,
  exports: class FakeAnthropic {
    constructor() {}
    get messages() {
      return {
        create: async (opts) => {
          if (opts.tool_choice && opts.tool_choice.name === 'actualizar_arbol_y_linea_de_tiempo') {
            if (!proximaRespuestaArbol) throw new Error('FakeAnthropic: falta programar proximaRespuestaArbol');
            return { content: [{ type: 'tool_use', id: 't1', name: 'actualizar_arbol_y_linea_de_tiempo', input: proximaRespuestaArbol }] };
          }
          throw new Error('FakeAnthropic: llamada inesperada (sin tool_choice de árbol)');
        },
      };
    }
  },
};

const app = require(serverPath);

function request(server, opts, cookie) {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : null;
    const headers = Object.assign({}, opts.headers || {});
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    if (cookie) headers['Cookie'] = cookie;
    const host = `127.0.0.1:${server.address().port}`;
    if (!headers['Origin']) headers['Origin'] = `http://${host}`;
    const r = http.request({ hostname: '127.0.0.1', port: server.address().port, path: opts.path, method: opts.method || 'GET', headers }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`OK  - ${name}`); }
  else { failed++; console.log(`FAIL - ${name}`); }
}

async function main() {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));

  const capturedLogs = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { capturedLogs.push(args.join(' ')); originalWarn(...args); };

  const loginResp = await request(server, { path: '/api/login', method: 'POST', body: { username: 'jorge', password: 'miclave123' } });
  check('login ok', loginResp.status === 200);
  const cookie = loginResp.headers['set-cookie'][0].split(';')[0];

  // --- 1) La IA devuelve "padres" con un acento distinto: se corrige antes de guardar ---
  familyMembers = [];
  nextId = 1;
  capturedLogs.length = 0;
  proximaRespuestaArbol = {
    personas: [
      { nombre: 'Jorge Vargas', relacion: 'sujeto principal', padres: ['Pedro Vargas'] },
      { nombre: 'Pedro Vargas', relacion: 'papá', padres: ['Alejandrína'] }, // acento de más — no coincide EXACTO con "Alejandrina"
      { nombre: 'Alejandrina', relacion: 'abuela paterna', padres: [] },
    ],
    eventos: [],
  };
  const r1 = await request(server, { path: '/api/rebuild-tree', method: 'POST' }, cookie);
  check('rebuild-tree (1) -> 200', r1.status === 200);
  const data1 = JSON.parse(r1.body || '{}');
  const pedro1 = (data1.people || []).find((p) => p.nombre === 'Pedro Vargas');
  check('a Pedro se le corrigió "padres" al nombre real ("Alejandrina", sin el acento de más)', !!pedro1 && Array.isArray(pedro1.padres) && pedro1.padres.includes('Alejandrina'));
  check('no quedó la versión con el acento de más', !!pedro1 && !pedro1.padres.includes('Alejandrína'));
  check('con una referencia que sí se pudo resolver, no se avisa nada por consola', !capturedLogs.some((l) => l.includes('no coincide con nadie')));

  // --- 2) Una referencia que de verdad no se parece a nadie: se deja tal cual y se avisa ---
  familyMembers = [];
  nextId = 1;
  capturedLogs.length = 0;
  proximaRespuestaArbol = {
    personas: [
      { nombre: 'Jorge Vargas', relacion: 'sujeto principal', padres: ['Pedro Vargas'] },
      { nombre: 'Pedro Vargas', relacion: 'papá', padres: ['Alejandra Gómez'] }, // nadie con ese nombre existe
      { nombre: 'Alejandrina', relacion: 'abuela paterna', padres: [] },
    ],
    eventos: [],
  };
  const r2 = await request(server, { path: '/api/rebuild-tree', method: 'POST' }, cookie);
  check('rebuild-tree (2) -> 200', r2.status === 200);
  const data2 = JSON.parse(r2.body || '{}');
  const pedro2 = (data2.people || []).find((p) => p.nombre === 'Pedro Vargas');
  check('sin nada parecido, la referencia se deja tal cual (no se inventa una conexión)', !!pedro2 && Array.isArray(pedro2.padres) && pedro2.padres.includes('Alejandra Gómez'));
  check('se avisó por consola que esa referencia no coincide con nadie (diagnosticable)', capturedLogs.some((l) => l.includes('no coincide con nadie')));

  console.warn = originalWarn;
  server.close();

  console.log(`\n${passed} pasaron, ${failed} fallaron`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
