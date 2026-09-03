// Smoke test de regresión para /api/next — el corazón de la app (la charla
// con la entrevistadora): primera bienvenida, turno normal, cierre con
// [FIN], oferta/interpretación de pausa, y la segunda pasada que corrige
// cuando el modelo cuela más de una pregunta en el mismo turno.
//
// test/smoke.js (el smoke original) mockea @anthropic-ai/sdk con una clase
// vacía sin ni siquiera un .messages — cualquier ruta que de verdad llame a
// Anthropic explota ahí. Por eso /api/next quedaba sin cobertura: no había
// forma de simular una respuesta del modelo. Este archivo arma un cliente
// fake pero PROGRAMABLE (una cola de respuestas configurable por test) para
// poder probar el flujo real sin pegarle a la API de Anthropic de verdad.
//
// Corre por separado de test/smoke.js (ver "test" en package.json) para no
// mezclar los dos fakes de @anthropic-ai/sdk en el mismo proceso — cada uno
// necesita cachear su propio require().
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');

const PASSWORD_HASH = bcrypt.hashSync('miclave123', 4);

// --- Estado fake de la "base de datos", en memoria ------------------------

const user = {
  id: 1,
  username: 'diego',
  password_hash: PASSWORD_HASH,
  token_version: 0,
  owner_user_id: null, // null = cuenta dueña, no colaboradora
  fecha_nacimiento: null,
  resumenTexto: '', // memoria de charlas anteriores (loadMemorySummary)
  pendingFamilyNote: null, // { id, contributor, parentesco, texto } | null
};

let storyLogInserts = []; // para verificar que se guardó (o no) una historia larga
let familyNoteMarkedDiscussed = []; // ids marcados como discussed=true

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

  if (text.includes('SELECT texto FROM resumen')) {
    return Promise.resolve(user.resumenTexto ? [{ texto: user.resumenTexto }] : []);
  }

  // loadPendingFamilyNote (con "id," al principio) — tiene que chequearse
  // ANTES que loadFamilyContext (sin "id,"), aunque en los hechos ninguna
  // es substring literal de la otra por la coma después de SELECT.
  if (text.includes('SELECT id, contributor, parentesco, texto FROM family_notes')) {
    return Promise.resolve(user.pendingFamilyNote ? [user.pendingFamilyNote] : []);
  }
  if (text.includes('UPDATE family_notes SET discussed = true')) {
    familyNoteMarkedDiscussed.push(values[0]);
    return Promise.resolve([]);
  }
  if (text.includes('SELECT contributor, parentesco, texto FROM family_notes')) {
    return Promise.resolve([]); // loadFamilyContext: sin notas guardadas, para simplificar estos tests
  }

  if (text.includes('SELECT id, type, caption, contributor FROM media')) return Promise.resolve([]);
  if (text.includes('SELECT fecha_nacimiento FROM users WHERE id')) {
    if (values[0] === user.id) return Promise.resolve([{ fecha_nacimiento: user.fecha_nacimiento }]);
    return Promise.resolve([]);
  }

  if (text.includes('SELECT nombre, relacion, detalles FROM family_members')) return Promise.resolve([]);

  if (text.includes('INSERT INTO story_log')) {
    storyLogInserts.push({ userId: values[0], texto: values[1], audioUrl: values[2] });
    return Promise.resolve([]);
  }

  return Promise.resolve([]);
}

require.cache[require.resolve('@neondatabase/serverless')] = {
  id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true,
  exports: { neon: () => fakeSql },
};
require.cache[require.resolve('@vercel/blob')] = {
  id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true,
  exports: { put: async () => ({ url: 'https://fake.public.blob.vercel-storage.com/x' }), del: async () => {} },
};

// --- Cliente de Anthropic fake, pero programable ---------------------------
//
// Cada test carga en la cola (con pushAnthropicResponse) el/los texto(s) que
// quiere que el modelo "responda", en el orden en que se van a consumir —
// server.js hace hasta 2 llamadas por turno (la pregunta, y opcionalmente la
// segunda pasada que corrige cuando hay más de una pregunta). Si un test
// dispara una llamada sin haber programado respuesta, se tira un error
// claro en vez de colgarse — así una regresión que agregue una llamada
// nueva a Anthropic se nota enseguida en vez de fallar en silencio.
let responseQueue = [];
let capturedCalls = [];

function pushAnthropicResponse(entry) {
  responseQueue.push(entry);
}
function resetAnthropicMock() {
  responseQueue = [];
  capturedCalls = [];
}

require.cache[require.resolve('@anthropic-ai/sdk')] = {
  id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true,
  exports: class FakeAnthropic {
    constructor() {}
    get messages() {
      return {
        create: async (opts) => {
          capturedCalls.push(opts);
          if (!responseQueue.length) {
            throw new Error('FakeAnthropic: se llamó a messages.create() sin respuesta programada (llamada #' + capturedCalls.length + ')');
          }
          const next = responseQueue.shift();
          if (next && next.throw) throw next.throw;
          if (next && next.raw) return next.raw; // para simular content vacío/malformado
          return { content: [{ type: 'text', text: next }] };
        },
      };
    }
  },
};

const app = require(serverPath);

// --- Helpers de HTTP --------------------------------------------------------

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

async function nextForUser(server, cookie, body) {
  resetAnthropicMock.calls = null; // no-op, solo documental
  return request(server, { path: '/api/next', method: 'POST', body }, cookie);
}

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`OK  - ${name}`); }
  else { failed++; console.log(`FAIL - ${name}`); }
}

async function main() {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));

  const loginResp = await request(server, { path: '/api/login', method: 'POST', body: { username: 'diego', password: 'miclave123' } });
  if (loginResp.status !== 200) console.log('LOGIN DEBUG:', loginResp.status, loginResp.body);
  check('login ok', loginResp.status === 200);
  const cookie = loginResp.headers['set-cookie'][0].split(';')[0];

  // Sin sesión -> 401.
  const noAuth = await request(server, { path: '/api/next', method: 'POST', body: { history: [], mode: 'historia' } });
  check('sin cookie -> 401', noAuth.status === 401);

  // --- 1) Primera vez: bienvenida ------------------------------------------
  resetAnthropicMock();
  user.resumenTexto = '';
  pushAnthropicResponse('¡Hola Diego! Qué lindo tenerte por acá. Vamos a ir armando juntas tu historia de vida, de a poco. Para empezar, decime cualquier cosa, tu nombre o un saludo, para confirmar que el micrófono te escucha bien.');
  const primera = await nextForUser(server, cookie, { history: [], mode: 'historia' });
  check('primera vez -> 200', primera.status === 200);
  const primeraBody = JSON.parse(primera.body);
  check('primera vez: done=false', primeraBody.done === false);
  check('primera vez: pausado=false', primeraBody.pausado === false);
  check('primera vez: un solo llamado a Anthropic', capturedCalls.length === 1);
  check('primera vez: el prompt de arranque pide confirmar el micrófono', capturedCalls[0].messages[0].content.includes('micrófono'));

  // --- 2) Turno normal con historial ya iniciado ----------------------------
  resetAnthropicMock();
  pushAnthropicResponse('Qué lindo recuerdo. ¿Y quién más vivía con ustedes en esa casa?');
  const historial = [
    { role: 'user', content: 'Hola, soy Diego.' },
    { role: 'assistant', content: '¡Hola Diego! Contame, ¿de dónde sos?' },
    { role: 'user', content: 'Nací en Bogotá, en una casa grande con mis abuelos.' },
  ];
  const normal = await nextForUser(server, cookie, { history: historial, mode: 'historia' });
  check('turno normal -> 200', normal.status === 200);
  const normalBody = JSON.parse(normal.body);
  check('turno normal: done=false', normalBody.done === false);
  check('turno normal: un solo llamado (una sola pregunta, no dispara segunda pasada)', capturedCalls.length === 1);
  check('turno normal: mensaje tal cual (sin marcadores)', !normalBody.message.includes('[FIN]') && !normalBody.message.includes('[PAUSA]'));

  // --- 3) Cierre con [FIN] ---------------------------------------------------
  resetAnthropicMock();
  pushAnthropicResponse('Fue hermoso escuchar todo esto hoy. Vamos a seguir la próxima vez. [FIN]');
  const cierre = await nextForUser(server, cookie, { history: historial, mode: 'historia' });
  const cierreBody = JSON.parse(cierre.body);
  check('cierre: done=true', cierreBody.done === true);
  check('cierre: marcador [FIN] no llega al mensaje final', !cierreBody.message.includes('[FIN]'));

  // --- 4) Oferta de pausa -----------------------------------------------------
  resetAnthropicMock();
  pushAnthropicResponse('Qué historia tan linda. ¿Querés seguir charlando un rato más o preferís hacer una pausa por ahora?');
  const ofertaPausa = await nextForUser(server, cookie, { history: historial, mode: 'historia', ofrecerPausa: true });
  check('oferta de pausa -> 200', ofertaPausa.status === 200);
  check('oferta de pausa: el prompt extra se pegó al último mensaje del usuario', capturedCalls[0].messages[capturedCalls[0].messages.length - 1].content.includes('hacer una pausa'));

  // --- 5) Interpretación de respuesta de pausa (la persona elige pausar) -----
  resetAnthropicMock();
  pushAnthropicResponse('Dale, nos vemos pronto entonces. Ya quedó todo guardado. [PAUSA]');
  const interpretaPausa = await nextForUser(server, cookie, {
    history: [...historial, { role: 'assistant', content: '¿Querés seguir o pausamos?' }, { role: 'user', content: 'Prefiero pausar por ahora.' }],
    mode: 'historia',
    interpretarRespuestaPausa: true,
  });
  const interpretaBody = JSON.parse(interpretaPausa.body);
  check('interpretación de pausa: pausado=true', interpretaBody.pausado === true);
  check('interpretación de pausa: marcador [PAUSA] no llega al mensaje final', !interpretaBody.message.includes('[PAUSA]'));
  check('interpretación de pausa: el prompt de interpretación se mandó', capturedCalls[0].messages[capturedCalls[0].messages.length - 1].content.includes('prefiere pausar'));

  // --- 6) Segunda pasada: el modelo cuela dos preguntas en un turno normal ---
  resetAnthropicMock();
  pushAnthropicResponse('Qué lindo. ¿En qué año fue eso? ¿Y quién más vivía con ustedes?'); // 2 "?" de cierre reales
  pushAnthropicResponse('Qué lindo. ¿Quién más vivía con ustedes?'); // reescritura: 1 sola pregunta
  const dosPreguntas = await nextForUser(server, cookie, { history: historial, mode: 'historia' });
  check('dos preguntas -> 200', dosPreguntas.status === 200);
  const dosPreguntasBody = JSON.parse(dosPreguntas.body);
  check('dos preguntas: dispara la segunda pasada (2 llamadas a Anthropic)', capturedCalls.length === 2);
  check('dos preguntas: el mensaje final es el reescrito, con una sola pregunta', dosPreguntasBody.message === 'Qué lindo. ¿Quién más vivía con ustedes?');

  // --- 7) La segunda pasada NO se dispara en el cierre, aunque haya 2+ "?" ---
  resetAnthropicMock();
  pushAnthropicResponse('Qué lindo todo lo que contaste. ¿Seguimos otro día? ¿Te gustó charlar hoy? [FIN]');
  const cierreConDosPreguntas = await nextForUser(server, cookie, { history: historial, mode: 'historia' });
  const cierreConDosPreguntasBody = JSON.parse(cierreConDosPreguntas.body);
  check('cierre con 2+ preguntas: NO dispara la segunda pasada (1 sola llamada)', capturedCalls.length === 1);
  check('cierre con 2+ preguntas: done=true de todas formas', cierreConDosPreguntasBody.done === true);

  // --- 8) Historial inválido -> 400 ------------------------------------------
  resetAnthropicMock();
  const historialInvalido = await nextForUser(server, cookie, { history: [{ role: 'admin', content: 'hola' }], mode: 'historia' });
  check('historial con role inválido -> 400', historialInvalido.status === 400);
  check('historial inválido: no llegó a llamar a Anthropic', capturedCalls.length === 0);

  // --- 9) Cuenta colaboradora bloqueada (bloquearColaborador) -----------------
  const originalOwnerId = user.owner_user_id;
  user.owner_user_id = 999; // simula que esta cuenta es colaboradora de otra
  const loginColab = await request(server, { path: '/api/login', method: 'POST', body: { username: 'diego', password: 'miclave123' } });
  const cookieColab = loginColab.headers['set-cookie'][0].split(';')[0];
  resetAnthropicMock();
  const comoColaborador = await nextForUser(server, cookieColab, { history: [], mode: 'historia' });
  check('cuenta colaboradora -> 403 en /api/next', comoColaborador.status === 403);
  check('cuenta colaboradora: no llegó a llamar a Anthropic', capturedCalls.length === 0);
  user.owner_user_id = originalOwnerId; // deshacer para el resto de los tests

  // --- 10) Respuesta larga del usuario se guarda en story_log -----------------
  resetAnthropicMock();
  storyLogInserts = [];
  pushAnthropicResponse('Qué recuerdo tan lindo, gracias por contarlo.');
  const respuestaLarga = 'x'.repeat(200); // >= HISTORIA_MIN_CHARS (180)
  await nextForUser(server, cookie, {
    history: [...historial, { role: 'assistant', content: '¿Y qué más recordás?' }, { role: 'user', content: respuestaLarga }],
    mode: 'historia',
  });
  check('respuesta larga: se guardó en story_log', storyLogInserts.length === 1 && storyLogInserts[0].texto.length >= 180);

  // Contraprueba: una respuesta corta NO se guarda en story_log.
  resetAnthropicMock();
  storyLogInserts = [];
  pushAnthropicResponse('Contame más.');
  await nextForUser(server, cookie, {
    history: [...historial, { role: 'assistant', content: '¿Y qué más recordás?' }, { role: 'user', content: 'Poquita cosa.' }],
    mode: 'historia',
  });
  check('respuesta corta: NO se guarda en story_log', storyLogInserts.length === 0);

  // --- 11) Nota pendiente de un colaborador se incorpora al arranque ---------
  resetAnthropicMock();
  user.resumenTexto = 'Diego ya contó algunas historias de su infancia.';
  user.pendingFamilyNote = { id: 42, contributor: 'María', parentesco: 'hija', texto: 'Contó que su papá le enseñó a andar en bici en el parque.' };
  pushAnthropicResponse('¡Hola Diego! Quiero contarte que estuve hablando con María y me contó una historia sobre vos, de cuando tu papá te enseñó a andar en bici. ¿Qué te acordás de eso?');
  const conNota = await nextForUser(server, cookie, { history: [], mode: 'historia' });
  check('nota pendiente -> 200', conNota.status === 200);
  check('nota pendiente: el prompt de arranque incluye el texto de la nota', capturedCalls[0].messages[0].content.includes('andar en bici'));
  check('nota pendiente: se marcó como discutida', familyNoteMarkedDiscussed.includes(42));
  user.pendingFamilyNote = null;
  user.resumenTexto = '';

  // --- 12) Respuesta de Anthropic vacía/malformada -> 500 controlado, no cuelga --
  resetAnthropicMock();
  pushAnthropicResponse({ raw: { content: [] } }); // sin bloques de texto
  const respuestaVacia = await nextForUser(server, cookie, { history: historial, mode: 'historia' });
  check('respuesta de Anthropic vacía -> 500 controlado (no 200, no cuelga)', respuestaVacia.status === 500);
  check('respuesta de Anthropic vacía: mensaje de error genérico, no un stack trace', JSON.parse(respuestaVacia.body).error === 'No se pudo generar la siguiente pregunta.');

  server.close();
  console.log(`\n${passed} pasaron, ${failed} fallaron`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR EN EL SMOKE TEST DE /api/next:', e);
  process.exit(1);
});
