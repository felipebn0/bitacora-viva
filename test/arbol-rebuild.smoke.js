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
//
// Suma cobertura de dos bugs reportados sobre un árbol real (usuario
// "Diego"): la mamá apareciendo dos veces (fusionarRolesUnicos, que junta
// duplicados solo dentro de los siete casilleros únicos alrededor del
// sujeto principal — mamá, papá, los 4 abuelos, y el propio "Yo" — nunca
// por nombre suelto en el resto del árbol) y el resaltado naranja de "Yo"
// perdiéndose al corregir el parentesco a mano (es_principal, un flag
// aparte que sobrevive aunque la palabra "principal" ya no esté en el
// texto).
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const PASSWORD_HASH = bcrypt.hashSync('miclave123', 4);

const user = { id: 1, username: 'jorge', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null };

let familyMembers = []; // fila: { id, nombre, relacion, detalles, padres (string JSON o null), es_principal }
let nextId = 1;
let treePendingNames = null;

// "padres" se guarda en family_members como TEXT (JSON) o null — mismo
// parseJsonArray defensivo que usa server.js, para leer el mock en los
// checks de abajo.
function parseJsonArrayTest(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

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

  if (text.includes('SELECT id, nombre, relacion, detalles, padres, es_principal FROM family_members')) {
    // GET /api/tree — lo que de verdad ve el navegador, con "id" y
    // "es_principal" incluidos.
    return Promise.resolve(familyMembers.map((p) => ({ id: p.id, nombre: p.nombre, relacion: p.relacion, detalles: p.detalles, padres: p.padres, es_principal: p.es_principal })));
  }
  if (text.includes('SELECT nombre, relacion, detalles, padres, es_principal FROM family_members')) {
    // personasPrevias, adentro de updateFamilyTree — refleja lo que haya
    // quedado guardado de la corrida anterior (para el test de que
    // es_principal sobrevive entre reconstrucciones).
    return Promise.resolve(familyMembers.map((p) => ({ nombre: p.nombre, relacion: p.relacion, detalles: p.detalles, padres: p.padres, es_principal: p.es_principal })));
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

  // Endpoints de edición manual (PUT/DELETE/marcar-principal), todos por id
  // — van ANTES del "DELETE FROM family_members" a secas de más abajo
  // (el de la reconstrucción completa), que si no los atraparía primero.
  if (text.includes('SELECT id FROM family_members WHERE id')) {
    const fila = familyMembers.find((p) => p.id === values[0] && p.user_id === values[1]);
    return Promise.resolve(fila ? [{ id: fila.id }] : []);
  }
  if (text.includes('SELECT nombre, relacion, padres, es_principal FROM family_members WHERE id')) {
    const fila = familyMembers.find((p) => p.id === values[0] && p.user_id === values[1]);
    return Promise.resolve(fila ? [{ nombre: fila.nombre, relacion: fila.relacion, padres: fila.padres, es_principal: fila.es_principal }] : []);
  }
  if (text.includes('SELECT nombre, relacion, padres FROM family_members WHERE id')) {
    const fila = familyMembers.find((p) => p.id === values[0] && p.user_id === values[1]);
    return Promise.resolve(fila ? [{ nombre: fila.nombre, relacion: fila.relacion, padres: fila.padres }] : []);
  }
  if (text.includes('UPDATE family_members SET es_principal = false')) {
    familyMembers.filter((p) => p.user_id === values[0]).forEach((p) => { p.es_principal = false; });
    return Promise.resolve([]);
  }
  if (text.includes('UPDATE family_members SET es_principal = true')) {
    const fila = familyMembers.find((p) => p.id === values[0] && p.user_id === values[1]);
    if (fila) fila.es_principal = true;
    return Promise.resolve([]);
  }
  if (text.includes('INSERT INTO historia_versiones')) return Promise.resolve([]);
  if (text.includes('SELECT id, padres FROM family_members WHERE user_id')) {
    return Promise.resolve(familyMembers.filter((p) => p.padres).map((p) => ({ id: p.id, padres: p.padres })));
  }
  if (text.includes('UPDATE family_members SET padres = ') && text.includes('WHERE id')) {
    const fila = familyMembers.find((p) => p.id === values[1]);
    if (fila) fila.padres = values[0];
    return Promise.resolve([]);
  }
  if (text.includes('DELETE FROM family_members WHERE id')) {
    familyMembers = familyMembers.filter((p) => !(p.id === values[0] && p.user_id === values[1]));
    return Promise.resolve([]);
  }

  if (text.includes('DELETE FROM family_members')) {
    familyMembers = [];
    return Promise.resolve([]);
  }
  if (text.includes('INSERT INTO family_members')) {
    const [userId, nombre, relacion, detalles, padres, esPrincipal] = values;
    familyMembers.push({ id: nextId++, user_id: userId, nombre, relacion, detalles, padres, es_principal: !!esPrincipal });
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

  // --- 3) "Mamá" duplicada (el bug real reportado: Juliana Palacio aparecía
  // dos veces en el árbol) se fusiona en una sola fila, y la conexión
  // mamá-papá queda intacta ---
  familyMembers = [];
  nextId = 1;
  capturedLogs.length = 0;
  proximaRespuestaArbol = {
    personas: [
      { nombre: 'Diego', relacion: 'sujeto principal', padres: ['Jorge Vargas', 'Juliana Palacio'] },
      { nombre: 'Jorge Vargas', relacion: 'papá', padres: [] },
      { nombre: 'Juliana Palacio', relacion: 'mamá', padres: [] },
      { nombre: 'Juliana Palacio', relacion: 'mamá', padres: [] }, // duplicada — misma persona, mencionada dos veces
    ],
    eventos: [],
  };
  const r3 = await request(server, { path: '/api/rebuild-tree', method: 'POST' }, cookie);
  check('rebuild-tree (3) -> 200', r3.status === 200);
  const julianasGuardadas = familyMembers.filter((p) => p.nombre === 'Juliana Palacio');
  check('"Juliana Palacio" quedó UNA sola vez en la base, no duplicada', julianasGuardadas.length === 1);
  const diego3 = familyMembers.find((p) => p.nombre === 'Diego');
  check('Diego (el sujeto principal) sigue conectado a las dos, mamá y papá', Array.isArray(parseJsonArrayTest(diego3.padres)) && parseJsonArrayTest(diego3.padres).includes('Jorge Vargas') && parseJsonArrayTest(diego3.padres).includes('Juliana Palacio'));
  check('nombre idéntico duplicado: fusión silenciosa, nada raro que avisar', !capturedLogs.some((l) => l.includes('se fusionaron en un solo')));

  // --- 3b) Mismo caso, pero la segunda mención de la mamá viene con un
  // nombre distinto (ej. la IA la transcribió distinto en otra charla) —
  // se fusiona igual (es el mismo casillero "mamá") y esta vez SÍ avisa
  // por consola, porque acá sí conviene poder revisarlo a mano. ---
  familyMembers = [];
  nextId = 1;
  capturedLogs.length = 0;
  proximaRespuestaArbol = {
    personas: [
      { nombre: 'Diego', relacion: 'sujeto principal', padres: ['Jorge Vargas', 'Juliana Palacio'] },
      { nombre: 'Jorge Vargas', relacion: 'papá', padres: [] },
      { nombre: 'Juliana Palacio', relacion: 'mamá', padres: [] },
      { nombre: 'Juliana P.', relacion: 'mamá', padres: [] }, // misma persona, nombre distinto
    ],
    eventos: [],
  };
  const r3b = await request(server, { path: '/api/rebuild-tree', method: 'POST' }, cookie);
  check('rebuild-tree (3b) -> 200', r3b.status === 200);
  check('con nombres distintos para la misma mamá, sigue quedando UNA sola fila', familyMembers.filter((p) => p.relacion === 'mamá').length === 1);
  check('se avisó por consola de la fusión (diagnosticable, para poder revisarlo)', capturedLogs.some((l) => l.includes('se fusionaron en un solo "mama"')));

  // --- 4) Dos personas con el MISMO nombre pero roles únicos distintos
  // (ej. un papá y un abuelo que se llaman igual) NO se fusionan — la
  // fusión es por casillero de rol, nunca por nombre suelto. ---
  familyMembers = [];
  nextId = 1;
  proximaRespuestaArbol = {
    personas: [
      { nombre: 'Diego', relacion: 'sujeto principal', padres: ['Jorge'] },
      { nombre: 'Jorge', relacion: 'papá', padres: ['Jorge'] },
      { nombre: 'Jorge', relacion: 'abuelo paterno', padres: [] },
    ],
    eventos: [],
  };
  const r4 = await request(server, { path: '/api/rebuild-tree', method: 'POST' }, cookie);
  check('rebuild-tree (4) -> 200', r4.status === 200);
  const jorgesGuardados = familyMembers.filter((p) => p.nombre === 'Jorge');
  check('dos "Jorge" en roles distintos (papá y abuelo) quedan como DOS personas, no se fusionan por compartir nombre', jorgesGuardados.length === 2);
  check('el papá "Jorge" sigue con su propio padre (el abuelo "Jorge") conectado', !!jorgesGuardados.find((p) => p.relacion === 'papá' && parseJsonArrayTest(p.padres).includes('Jorge')));

  // --- 5/6) El resaltado de "Yo" (es_principal) no depende de que la
  // palabra "principal" siga en el texto — sobrevive a una corrección
  // manual del parentesco Y a una reconstrucción posterior. ---
  familyMembers = [];
  nextId = 1;
  proximaRespuestaArbol = {
    personas: [{ nombre: 'Diego', relacion: 'sujeto principal', padres: [] }],
    eventos: [],
  };
  await request(server, { path: '/api/rebuild-tree', method: 'POST' }, cookie);
  const tree1 = JSON.parse((await request(server, { path: '/api/tree', method: 'GET' }, cookie)).body || '{}');
  const diegoTree1 = (tree1.people || []).find((p) => p.nombre === 'Diego');
  check('recién generado, "Diego" queda marcado es_principal (por la palabra "principal" en su parentesco)', !!diegoTree1 && diegoTree1.es_principal === true);

  // Simula justo lo que hace PUT /api/tree/person/:id al corregir el
  // parentesco a mano: cambia "relacion", nunca toca "es_principal".
  const diegoRow = familyMembers.find((p) => p.nombre === 'Diego');
  diegoRow.relacion = 'Yo';

  // Reconstrucción posterior: la IA, al leer "Personas ya conocidas" con
  // "relacion": "Yo", lo devuelve tal cual — sin la palabra "principal" en
  // ningún lado de esta corrida.
  proximaRespuestaArbol = {
    personas: [{ nombre: 'Diego', relacion: 'Yo', padres: [] }],
    eventos: [],
  };
  await request(server, { path: '/api/rebuild-tree', method: 'POST' }, cookie);
  const tree2 = JSON.parse((await request(server, { path: '/api/tree', method: 'GET' }, cookie)).body || '{}');
  const diegoTree2 = (tree2.people || []).find((p) => p.nombre === 'Diego');
  check('después de una reconstrucción sin la palabra "principal" en el texto, "Diego" SIGUE marcado es_principal (se reconoce por nombre, no se pierde el resaltado)', !!diegoTree2 && diegoTree2.es_principal === true);

  // --- 7) Válvula de escape manual: POST .../marcar-principal ---
  familyMembers = [];
  nextId = 1;
  proximaRespuestaArbol = {
    personas: [
      { nombre: 'Diego', relacion: 'sujeto principal', padres: [] },
      { nombre: 'Nicolás', relacion: 'hermano menor', padres: [] },
    ],
    eventos: [],
  };
  await request(server, { path: '/api/rebuild-tree', method: 'POST' }, cookie);
  const nicolasId = familyMembers.find((p) => p.nombre === 'Nicolás').id;
  const rMarcar = await request(server, { path: `/api/tree/person/${nicolasId}/marcar-principal`, method: 'POST' }, cookie);
  check('marcar-principal -> 200', rMarcar.status === 200);
  const treeTrasMarcar = JSON.parse((await request(server, { path: '/api/tree', method: 'GET' }, cookie)).body || '{}');
  const diegoTrasMarcar = (treeTrasMarcar.people || []).find((p) => p.nombre === 'Diego');
  const nicolasTrasMarcar = (treeTrasMarcar.people || []).find((p) => p.nombre === 'Nicolás');
  check('al marcar a Nicolás como principal, Diego deja de estarlo (solo puede haber uno)', diegoTrasMarcar.es_principal === false);
  check('y Nicolás pasa a estarlo', nicolasTrasMarcar.es_principal === true);
  const rMarcarInexistente = await request(server, { path: '/api/tree/person/99999/marcar-principal', method: 'POST' }, cookie);
  check('marcar-principal sobre un id que no existe -> 404', rMarcarInexistente.status === 404);

  // --- 8) Borrar a mano un duplicado: limpia también las referencias de
  // "padres" de terceros, y nunca deja borrar a quien es "Yo" ---
  familyMembers = [];
  nextId = 1;
  proximaRespuestaArbol = {
    personas: [
      { nombre: 'Diego', relacion: 'sujeto principal', padres: ['Jorge Vargas'] },
      { nombre: 'Jorge Vargas', relacion: 'papá', padres: [] },
      { nombre: 'Jorge Vargas Duplicado', relacion: 'tío', padres: [] }, // duplicado que la fusión automática no atrapó (rol no-único)
    ],
    eventos: [],
  };
  await request(server, { path: '/api/rebuild-tree', method: 'POST' }, cookie);
  const diegoId = familyMembers.find((p) => p.nombre === 'Diego').id;
  const duplicadoId = familyMembers.find((p) => p.nombre === 'Jorge Vargas Duplicado').id;

  const rBorrarPrincipal = await request(server, { path: `/api/tree/person/${diegoId}`, method: 'DELETE' }, cookie);
  check('no se puede borrar a quien está marcado como "Yo" -> 400', rBorrarPrincipal.status === 400);
  check('sigue estando en la base (no se borró)', !!familyMembers.find((p) => p.id === diegoId));

  const rBorrarDuplicado = await request(server, { path: `/api/tree/person/${duplicadoId}`, method: 'DELETE' }, cookie);
  check('borrar el duplicado -> 200', rBorrarDuplicado.status === 200);
  check('el duplicado ya no está en la base', !familyMembers.find((p) => p.id === duplicadoId));
  check('Diego y su papá siguen ahí, sin verse afectados', familyMembers.some((p) => p.nombre === 'Diego') && familyMembers.some((p) => p.nombre === 'Jorge Vargas'));

  const rBorrarInexistente = await request(server, { path: '/api/tree/person/99999', method: 'DELETE' }, cookie);
  check('borrar un id que no existe -> 404', rBorrarInexistente.status === 404);

  console.warn = originalWarn;
  server.close();

  console.log(`\n${passed} pasaron, ${failed} fallaron`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
