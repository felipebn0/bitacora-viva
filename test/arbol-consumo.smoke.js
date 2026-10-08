// Smoke test del CONSUMO del árbol genealógico y del resumen de memoria
// (pedido de Felipe, 2026-10-08: "revisa cuánto está consumiendo el árbol y
// redúcelo lo más posible" y "el que más ahorre y sea más eficiente").
// Cubre las cinco palancas de ahorro de updateFamilyTree / /api/save:
//   1) solo se procesa lo nuevo de cada sesión (sessions.arbol_procesado),
//   2) se salta la llamada si lo nuevo no tiene pistas de familia ni hitos,
//   3) lo ya conocido viaja compacto, con ids cortos,
//   4) Claude devuelve solo los CAMBIOS y el servidor los junta con lo que ya
//      había (sin duplicar, sin perder a nadie, sin mezclar dos personas que
//      se llaman igual),
//   5) si no cambió nada, no se reescribe la base.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const user = { id: 1, username: 'jorge', password_hash: bcrypt.hashSync('miclave123', 4), token_version: 0, owner_user_id: null };

let familyMembers = [];
let nextId = 1;
let sessions = []; // { id, user_id, intercambios, arbol_procesado }
let nextSessionId = 1;
let insertsFamilyMembers = 0;
let deletesFamilyMembers = 0;
const llamadasArbol = [];
let respuestaArbol = null; // objeto con el input del tool_use, o { throw: Error }
let resumenGuardado = ''; // tabla resumen (un solo usuario)
const llamadasResumen = [];
let respuestaResumen = null; // string, o { throw: Error }; null -> 'Resumen de prueba.'

function fakeSql(strings, ...values) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    return Promise.resolve(values[0] === user.username ? [{ id: user.id, username: user.username, password_hash: user.password_hash, token_version: user.token_version }] : []);
  }
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) {
    return Promise.resolve(values[0] === user.id ? [{ owner_user_id: null, token_version: 0 }] : []);
  }

  // --- sessions ---
  if (text.includes('INSERT INTO sessions')) {
    const fila = { id: nextSessionId++, user_id: values[0], intercambios: JSON.parse(values[1]), arbol_procesado: 0, resumen_procesado: 0 };
    sessions.push(fila);
    return Promise.resolve([{ id: fila.id }]);
  }
  if (text.includes('UPDATE sessions SET intercambios')) {
    const fila = sessions.find((s) => s.id === values[1] && s.user_id === values[2]);
    if (!fila) return Promise.resolve([]);
    fila.intercambios = JSON.parse(values[0]);
    return Promise.resolve([{ id: fila.id, arbol_procesado: fila.arbol_procesado, resumen_procesado: fila.resumen_procesado }]);
  }
  if (text.includes('UPDATE sessions SET arbol_procesado = jsonb_array_length')) {
    sessions.filter((s) => s.user_id === values[0]).forEach((s) => { s.arbol_procesado = s.intercambios.length; });
    return Promise.resolve([]);
  }
  if (text.includes('UPDATE sessions SET arbol_procesado')) {
    const fila = sessions.find((s) => s.id === values[2] && s.user_id === values[3]);
    if (fila) { fila.arbol_procesado = values[0]; fila.resumen_procesado = values[1]; }
    return Promise.resolve([]);
  }
  if (text.includes('SELECT texto FROM resumen WHERE user_id')) return Promise.resolve(resumenGuardado ? [{ texto: resumenGuardado }] : []);
  if (text.includes('INSERT INTO resumen')) { resumenGuardado = values[1]; return Promise.resolve([]); }
  if (text.includes('SELECT intercambios FROM sessions')) {
    return Promise.resolve(sessions.filter((s) => s.user_id === values[0]).map((s) => ({ intercambios: s.intercambios })));
  }

  // --- árbol ---
  if (text.includes('SELECT nombre, relacion, detalles, padres, es_principal FROM family_members')) {
    return Promise.resolve(familyMembers.map((p) => ({ nombre: p.nombre, relacion: p.relacion, detalles: p.detalles, padres: p.padres, es_principal: p.es_principal })));
  }
  if (text.includes('SELECT nombre, relacion, detalles, padres FROM family_members') && text.includes('ORDER BY id')) {
    return Promise.resolve(familyMembers.map((p) => ({ nombre: p.nombre, relacion: p.relacion, detalles: p.detalles, padres: p.padres })));
  }
  if (text.includes('SELECT descripcion, anio, edad_aprox, categoria FROM timeline_events')) return Promise.resolve([]);
  if (text.includes('SELECT tree_pending_names FROM users WHERE id')) return Promise.resolve([{ tree_pending_names: null }]);
  if (text.includes('DELETE FROM family_members')) { deletesFamilyMembers++; familyMembers = []; return Promise.resolve([]); }
  if (text.includes('INSERT INTO family_members')) {
    const [userId, nombre, relacion, detalles, padres, esPrincipal] = values;
    insertsFamilyMembers++;
    familyMembers.push({ id: nextId++, user_id: userId, nombre, relacion, detalles, padres, es_principal: !!esPrincipal });
    return Promise.resolve([]);
  }
  return Promise.resolve([]);
}
fakeSql.transaction = (queries) => Promise.all(queries);

require.cache[require.resolve('@neondatabase/serverless')] = { id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true, exports: { neon: () => fakeSql } };
require.cache[require.resolve('@vercel/blob')] = { id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true, exports: { put: async () => ({ url: 'x' }), del: async () => {}, get: async () => null } };
require.cache[require.resolve('@anthropic-ai/sdk')] = {
  id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true,
  exports: class FakeAnthropic {
    constructor() {}
    get messages() {
      return {
        create: async (opts) => {
          if (opts.tool_choice && opts.tool_choice.name === 'actualizar_arbol_y_linea_de_tiempo') {
            llamadasArbol.push(opts);
            if (!respuestaArbol) throw new Error('FakeAnthropic: falta programar respuestaArbol');
            if (respuestaArbol.throw) throw respuestaArbol.throw;
            return { content: [{ type: 'tool_use', id: 't1', name: opts.tool_choice.name, input: respuestaArbol }], usage: { input_tokens: 100, output_tokens: 20 } };
          }
          // resumen de la memoria u otras llamadas de texto del /api/save
          llamadasResumen.push(opts);
          if (respuestaResumen && respuestaResumen.throw) throw respuestaResumen.throw;
          return { content: [{ type: 'text', text: respuestaResumen == null ? 'Resumen de prueba.' : respuestaResumen }], usage: { input_tokens: 10, output_tokens: 5 } };
        },
      };
    }
  },
};

const app = require(serverPath);

function request(server, opts, cookie) {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : null;
    const headers = {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    if (cookie) headers.Cookie = cookie;
    headers.Origin = `http://127.0.0.1:${server.address().port}`;
    const r = http.request({ hostname: '127.0.0.1', port: server.address().port, path: opts.path, method: opts.method || 'GET', headers }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

let passed = 0, failed = 0;
const check = (name, cond) => { if (cond) { passed++; console.log(`OK  - ${name}`); } else { failed++; console.log(`FAIL - ${name}`); } };
const padres = (p) => { try { return JSON.parse(p.padres || '[]'); } catch (e) { return []; } };
const porNombre = (n) => familyMembers.find((p) => p.nombre === n);

async function main() {
  const logs = [];
  const originalLog = console.log, originalError = console.error, originalWarn = console.warn;
  console.log = (...a) => { logs.push(a.join(' ')); originalLog(...a); };
  console.error = () => {};
  console.warn = () => {};

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const login = await request(server, { path: '/api/login', method: 'POST', body: { username: 'jorge', password: 'miclave123' } });
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  const guardar = (history, sessionDbId) => request(server, { path: '/api/save', method: 'POST', body: { history, sessionDbId } }, cookie);

  // --- 1) Primera vez: sesión nueva, todo es nuevo ---
  const h1 = [
    { role: 'assistant', content: '¿Cómo se llaman tus papás?' },
    { role: 'user', content: 'Mi mamá se llama Juliana Palacio y mi papá Jorge Vargas.' },
  ];
  respuestaArbol = {
    personas: [
      { nombre: 'Juliana Palacio', relacion: 'mamá' },
      { nombre: 'Jorge Vargas', relacion: 'papá' },
    ],
    eventos: [],
  };
  const s1 = await guardar(h1);
  const s1Body = JSON.parse(s1.body);
  check('primer save -> 200 sin derivados fallidos', s1.status === 200 && s1Body.derivadosFallidos.length === 0);
  check('primer save: una sola llamada al árbol', llamadasArbol.length === 1);
  check('primer save: el árbol queda con las dos personas nuevas', familyMembers.length === 2 && !!porNombre('Juliana Palacio') && !!porNombre('Jorge Vargas'));
  check('primer save: el prompt dice que todavía no hay nadie conocido', llamadasArbol[0].messages[0].content.includes('(ninguna todavía)'));
  check('primer save: la sesión quedó marcada como procesada (2 mensajes)', sessions[0].arbol_procesado === 2);
  check('el tope de salida bajó de 8000 a 3000 (ahora solo se devuelven cambios)', llamadasArbol[0].max_tokens === 3000);
  check('la herramienta pide SOLO los cambios, no la lista completa', /SOLO los CAMBIOS/.test(llamadasArbol[0].tools[0].description));

  // --- 2) Segundo save de la MISMA sesión: solo viaja lo nuevo, y solo se devuelven cambios ---
  const h2 = [
    ...h1,
    { role: 'assistant', content: '¿A qué se dedicaba tu papá?' },
    { role: 'user', content: 'Era ingeniero. Y tengo un hermano, Pedro Vargas.' },
  ];
  const idJorge = familyMembers.findIndex((p) => p.nombre === 'Jorge Vargas') + 1; // id = línea en la lista que ve la IA
  respuestaArbol = {
    personas: [
      { id: idJorge, nombre: 'Jorge Vargas', relacion: 'papá', detalles: 'Era ingeniero' },
      { nombre: 'Pedro Vargas', relacion: 'hermano', padres: ['Jorge Vargas', 'Juliana Palacio'] },
    ],
    eventos: [],
  };
  llamadasArbol.length = 0;
  const s2 = await guardar(h2, 1);
  check('segundo save -> 200', s2.status === 200);
  check('segundo save: una sola llamada', llamadasArbol.length === 1);
  const prompt2 = llamadasArbol[0].messages[0].content;
  check('segundo save: la charla vieja NO se vuelve a mandar', !prompt2.includes('Mi mamá se llama Juliana Palacio y mi papá Jorge Vargas.'));
  check('segundo save: sí viaja lo nuevo', prompt2.includes('Era ingeniero. Y tengo un hermano, Pedro Vargas.'));
  check('segundo save: lo ya conocido viaja compacto, con id (línea "1 | Juliana Palacio | mamá")', /\n1 \| Juliana Palacio \| mamá \|/.test(prompt2) && !prompt2.includes('"nombre"'));
  check('segundo save: quedan 3 personas (Juliana NO se perdió aunque no se repitió)', familyMembers.length === 3 && !!porNombre('Juliana Palacio'));
  check('segundo save: a Jorge se le sumó el detalle (actualizado por id)', capitalizado(porNombre('Jorge Vargas').detalles) === 'Era ingeniero');
  check('segundo save: Pedro quedó conectado a sus dos padres', padres(porNombre('Pedro Vargas')).join(',') === 'Jorge Vargas,Juliana Palacio');
  check('segundo save: la sesión quedó marcada con los 4 mensajes', sessions[0].arbol_procesado === 4);

  // --- 3) Save repetido SIN mensajes nuevos: cero llamadas ---
  llamadasArbol.length = 0;
  const s3 = await guardar(h2, 1);
  check('save repetido sin nada nuevo -> 200', s3.status === 200);
  check('save repetido sin nada nuevo: NO se llama a la IA', llamadasArbol.length === 0);

  // --- 4) Mensaje nuevo sin ninguna pista de familia ni hitos: se salta ---
  const h4 = [...h2, { role: 'assistant', content: 'Qué bonito.' }, { role: 'user', content: 'ese día estaba soleado y fuimos a pescar al río, todo muy tranquilo.' }];
  llamadasArbol.length = 0; logs.length = 0;
  const s4 = await guardar(h4, 1);
  check('mensaje sin pistas -> 200', s4.status === 200);
  check('mensaje sin pistas: NO se llama a la IA', llamadasArbol.length === 0);
  check('mensaje sin pistas: queda la línea de métrica salto=sin-pistas', logs.some((l) => l.includes('[arbol-consumo]') && l.includes('salto=sin-pistas')));
  check('mensaje sin pistas: igual se marca como procesado (no se reintenta)', sessions[0].arbol_procesado === h4.length);

  // --- 5) La IA repite a alguien ya conocido SIN id y no hay cambios reales: no duplica y no reescribe ---
  const h5 = [...h4, { role: 'assistant', content: 'Cuéntame más.' }, { role: 'user', content: 'Mi mamá Juliana Palacio cocinaba muy rico.' }];
  respuestaArbol = { personas: [{ nombre: 'Juliana Palacio', relacion: 'mamá' }], eventos: [] };
  llamadasArbol.length = 0; logs.length = 0;
  const insertsAntes = insertsFamilyMembers, deletesAntes = deletesFamilyMembers;
  const s5 = await guardar(h5, 1);
  check('IA repite a una conocida sin id -> 200', s5.status === 200);
  check('IA repite a una conocida sin id: sigue habiendo 3 personas (no se duplicó)', familyMembers.length === 3);
  check('sin cambios reales: NO se reescribió la base (ni un DELETE ni un INSERT más)', insertsFamilyMembers === insertsAntes && deletesFamilyMembers === deletesAntes);
  check('sin cambios reales: queda la línea sin-cambios', logs.some((l) => l.includes('[arbol-consumo]') && l.includes('sin-cambios')));

  // --- 6) Quitar por id ---
  const idPedro = familyMembers.findIndex((p) => p.nombre === 'Pedro Vargas') + 1;
  const h6 = [...h5, { role: 'assistant', content: '¿Y Pedro?' }, { role: 'user', content: 'Ah no, Pedro en realidad es un amigo de la familia, no mi hermano.' }];
  respuestaArbol = { personas: [], quitar_personas: [idPedro], eventos: [] };
  llamadasArbol.length = 0;
  await guardar(h6, 1);
  check('quitar_personas: Pedro salió del árbol', !porNombre('Pedro Vargas') && familyMembers.length === 2);
  check('quitar_personas: Juliana y Jorge siguen ahí', !!porNombre('Juliana Palacio') && !!porNombre('Jorge Vargas'));

  // --- 7) Dos personas con el mismo nombre en roles distintos NO se mezclan ---
  const h7 = [...h6, { role: 'assistant', content: '¿Y tu abuelo?' }, { role: 'user', content: 'Mi abuelo paterno también se llamaba Jorge, Jorge Vargas.' }];
  respuestaArbol = { personas: [{ nombre: 'Jorge Vargas', relacion: 'abuelo paterno' }], eventos: [] };
  await guardar(h7, 1);
  const jorges = familyMembers.filter((p) => p.nombre === 'Jorge Vargas');
  check('mismo nombre, otro parentesco (papá y abuelo): quedan DOS personas', jorges.length === 2 && jorges.some((p) => p.relacion === 'papá') && jorges.some((p) => p.relacion === 'abuelo paterno'));

  // --- 8) Falla la IA: el save sigue en 200, avisa, y NO marca la sesión como procesada ---
  const h8 = [...h7, { role: 'assistant', content: '¿Algo más?' }, { role: 'user', content: 'Sí, mi tía Marta también vivía con nosotros.' }];
  respuestaArbol = { throw: new Error('Anthropic no respondió (simulado)') };
  const procesadoAntes = sessions[0].arbol_procesado;
  const s8 = await guardar(h8, 1);
  check('falla del árbol -> el save igual responde 200 (la charla quedó guardada)', s8.status === 200 && JSON.parse(s8.body).derivadosFallidos.includes('arbol'));
  check('falla del árbol: la sesión NO se marca como procesada (se reintenta en el próximo save)', sessions[0].arbol_procesado === procesadoAntes);

  // --- 9) El próximo save reintenta lo que falló ---
  respuestaArbol = { personas: [{ nombre: 'Marta', relacion: 'tía' }], eventos: [] };
  llamadasArbol.length = 0;
  await guardar(h8, 1);
  check('tras la falla, el siguiente save reintenta con lo pendiente (incluye a la tía Marta)', llamadasArbol.length === 1 && llamadasArbol[0].messages[0].content.includes('mi tía Marta'));
  check('tras reintentar, la tía quedó en el árbol y la sesión al día', !!porNombre('Marta') && sessions[0].arbol_procesado === h8.length);

  // --- 10) /api/rebuild-tree procesa todo y deja todo marcado ---
  sessions.push({ id: nextSessionId++, user_id: 1, intercambios: [{ role: 'user', content: 'Mi papá se llamaba Jorge.' }], arbol_procesado: 0, resumen_procesado: 0 });
  respuestaArbol = { personas: [], eventos: [] };
  const rb = await request(server, { path: '/api/rebuild-tree', method: 'POST' }, cookie);
  check('rebuild-tree -> 200', rb.status === 200);
  check('rebuild-tree: todas las sesiones quedan marcadas como procesadas', sessions.every((s) => s.arbol_procesado === s.intercambios.length));


  // ===================== RESUMEN DE MEMORIA =====================
  // Sesión nueva y aparte, para que no se mezcle con lo del árbol de arriba.
  const idxSesion = (n) => sessions.find((x) => x.id === n);
  const largo = (t) => t.repeat(4); // para pasar el mínimo de caracteres
  const r1 = [
    { role: 'assistant', content: '¿Cómo era tu casa de niña?' },
    { role: 'user', content: largo('Vivíamos en una casa grande con patio, al lado de la plaza, y siempre había gente. ') },
  ];
  llamadasResumen.length = 0; resumenGuardado = ''; respuestaResumen = '- Infancia: casa grande con patio junto a la plaza.';
  const sr1 = await guardar(r1);
  const sesionR = sessions[sessions.length - 1];
  check('resumen: primera vez (sin resumen previo) -> modo completo, con tope de 700 tokens', llamadasResumen.length === 1 && llamadasResumen[0].max_tokens === 700 && llamadasResumen[0].messages[0].content.includes('máximo 400 palabras'));
  check('resumen: el prompt dice que todavía no hay resumen', llamadasResumen[0].messages[0].content.includes('(ninguno todavía)'));
  check('resumen: se guardó el resumen', resumenGuardado === '- Infancia: casa grande con patio junto a la plaza.');
  check('resumen: la sesión quedó marcada como resumida', sesionR.resumen_procesado === r1.length);
  check('resumen: usa la regla corta de español colombiano (no la larga)', llamadasResumen[0].system.includes('IDIOMA: todo lo que escribas va en español de Colombia') && !llamadasResumen[0].system.includes('IDIOMA — OBLIGATORIO'));

  // Segundo save de la misma sesión: solo lo nuevo, y Claude devuelve solo viñetas nuevas.
  const r2 = [...r1, { role: 'assistant', content: '¿Y tus abuelos?' }, { role: 'user', content: largo('Mi abuela Rosa hacía arepas todos los domingos para toda la familia, era su orgullo. ') }];
  respuestaResumen = '- Familia: la abuela Rosa hacía arepas los domingos.';
  llamadasResumen.length = 0; logs.length = 0;
  await guardar(r2, sesionR.id);
  const promptR2 = llamadasResumen[0].messages[0].content;
  check('resumen: segunda vez -> modo delta (pide SOLO las viñetas nuevas), con tope de 300 tokens', llamadasResumen.length === 1 && llamadasResumen[0].max_tokens === 300 && promptR2.includes('SOLO las viñetas NUEVAS'));
  check('resumen: la charla ya resumida NO se vuelve a mandar', !promptR2.includes('casa grande con patio, al lado de la plaza'));
  check('resumen: sí se manda lo nuevo', promptR2.includes('Mi abuela Rosa hacía arepas'));
  check('resumen: la viñeta nueva se AGREGA al resumen (no lo reemplaza)', resumenGuardado === '- Infancia: casa grande con patio junto a la plaza.\n- Familia: la abuela Rosa hacía arepas los domingos.');
  check('resumen: queda la línea de métrica modo=delta', logs.some((l) => l.includes('[resumen-consumo]') && l.includes('modo=delta')));

  // SIN_CAMBIOS: no toca el resumen.
  const r3 = [...r2, { role: 'assistant', content: 'Qué rico.' }, { role: 'user', content: largo('Sí, eran unas arepas buenísimas, las recuerdo con muchísimo cariño todavía. ') }];
  respuestaResumen = 'SIN_CAMBIOS';
  const antesDelResumen = resumenGuardado;
  await guardar(r3, sesionR.id);
  check('resumen: SIN_CAMBIOS deja el resumen intacto', resumenGuardado === antesDelResumen);
  check('resumen: SIN_CAMBIOS igual cuenta como procesado', sesionR.resumen_procesado === r3.length);

  // Lo nuevo es muy corto: no se llama, no se marca, y se junta con lo que venga.
  const r4 = [...r3, { role: 'assistant', content: 'Qué lindo.' }, { role: 'user', content: 'Sí, claro.' }];
  llamadasResumen.length = 0; logs.length = 0;
  await guardar(r4, sesionR.id);
  check('resumen: lo nuevo es muy corto -> NO se llama a la IA', llamadasResumen.length === 0);
  check('resumen: lo muy corto NO se marca como procesado (no se pierde)', sesionR.resumen_procesado === r3.length);
  check('resumen: queda la línea salto=pocos', logs.some((l) => l.includes('[resumen-consumo]') && l.includes('salto=pocos')));
  const r5 = [...r4, { role: 'assistant', content: '¿Y después?' }, { role: 'user', content: largo('Después nos mudamos a la ciudad, a un apartamento pequeño cerca del trabajo de mi papá. ') }];
  respuestaResumen = '- Juventud: se mudaron a la ciudad.';
  await guardar(r5, sesionR.id);
  check('resumen: en el siguiente save viaja lo corto de antes junto con lo nuevo', llamadasResumen.length === 1 && llamadasResumen[0].messages[0].content.includes('Sí, claro.') && llamadasResumen[0].messages[0].content.includes('nos mudamos a la ciudad'));

  // Resumen largo: se consolida (reescritura completa) para que no crezca sin límite.
  resumenGuardado = '- Dato: ' + 'x'.repeat(2900);
  const r6 = [...r5, { role: 'assistant', content: '¿Algo más?' }, { role: 'user', content: largo('Sí, también me acuerdo de las fiestas del pueblo en diciembre, con música y pólvora. ') }];
  respuestaResumen = '- Resumen consolidado.';
  llamadasResumen.length = 0;
  await guardar(r6, sesionR.id);
  check('resumen: pasado el límite se reescribe completo (máx. 400 palabras, 700 tokens)', llamadasResumen.length === 1 && llamadasResumen[0].max_tokens === 700 && llamadasResumen[0].messages[0].content.includes('máximo 400 palabras'));
  check('resumen: la consolidación REEMPLAZA el resumen largo', resumenGuardado === '- Resumen consolidado.');

  // Falla la IA del resumen: el save responde 200, avisa, y no marca la sesión.
  const r7 = [...r6, { role: 'assistant', content: 'Cuéntame más.' }, { role: 'user', content: largo('Había un carnaval en el pueblo vecino al que íbamos todos los años en camión. ') }];
  respuestaResumen = { throw: new Error('Anthropic no respondió (simulado)') };
  const marcaAntes = sesionR.resumen_procesado;
  const sr7 = await guardar(r7, sesionR.id);
  check('resumen: si falla -> el save igual responde 200 y avisa', sr7.status === 200 && JSON.parse(sr7.body).derivadosFallidos.includes('resumen'));
  check('resumen: si falla, la sesión NO se marca (se reintenta en el próximo save)', sesionR.resumen_procesado === marcaAntes);
  respuestaResumen = null;

  server.close();
  console.log = originalLog; console.error = originalError; console.warn = originalWarn;
  console.log(`\n${passed} pasaron, ${failed} fallaron`);
  process.exit(failed ? 1 : 0);
}

function capitalizado(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

main().catch((e) => { console.error('ERROR EN EL SMOKE TEST DEL CONSUMO DEL ÁRBOL:', e); process.exit(1); });
