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
// Ver el mismo comentario en test/media-file.smoke.js: un BLOB_READ_WRITE_TOKEN
// real en el .env de la máquina pinearía el host exacto a ESE store y
// haría fallar el chequeo de audioUrl con el host de prueba de más abajo.
process.env.BLOB_READ_WRITE_TOKEN = '';

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
  tratamiento: 'masculino',
  resumenTexto: '', // memoria de charlas anteriores (loadMemorySummary)
  pendingFamilyNote: null, // { id, contributor, parentesco, texto } | null
  pendingMedia: null, // { id, type, caption, contributor } | null
};

let storyLogInserts = []; // para verificar que se guardó (o no) una historia larga
let storyLogRows = []; // { id, userId, texto, audioUrl } — simula la tabla real para el chequeo de duplicados
let storyLogUpdates = []; // ids a los que se les completó el audio_url
let storyLogMediaUpdates = []; // ids a los que se les completó el media_urls
let familyNoteMarkedDiscussed = []; // ids marcados como discussed=true
let mediaMarkedDiscussed = []; // ids marcados como discussed=true

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
  if (text.includes('SELECT id, contributor, parentesco, texto, media_urls, ab_variant FROM family_notes')) {
    return Promise.resolve(user.pendingFamilyNote ? [user.pendingFamilyNote] : []);
  }
  if (text.includes('UPDATE family_notes SET discussed = true')) {
    familyNoteMarkedDiscussed.push(values[0]);
    return Promise.resolve([]);
  }
  // Item 12: el sorteo de variante solo corre si el fixture no trae
  // ab_variant ya puesto -- los tests de acá abajo siempre lo traen, así
  // que este mock no se ejercita hoy, pero queda por si algún test nuevo
  // arranca sin ab_variant.
  if (text.includes('UPDATE family_notes SET ab_variant')) {
    if (user.pendingFamilyNote) user.pendingFamilyNote.ab_variant = values[0];
    return Promise.resolve([]);
  }
  if (text.includes('SELECT contributor, parentesco, texto FROM family_notes')) {
    return Promise.resolve([]); // loadFamilyContext: sin notas guardadas, para simplificar estos tests
  }

  if (text.includes('SELECT id, type, caption, contributor, url FROM media')) {
    return Promise.resolve(user.pendingMedia ? [user.pendingMedia] : []);
  }
  if (text.includes('UPDATE media SET discussed = true')) {
    mediaMarkedDiscussed.push(values[0]);
    return Promise.resolve([]);
  }
  // leerPerfilBitacora (BACKLOG #12): para la bitácora propia lee "users".
  if (text.includes('SELECT name AS nombre, fecha_nacimiento, created_at, tratamiento FROM users WHERE id')) {
    if (values[0] === user.id) return Promise.resolve([{ nombre: user.username, fecha_nacimiento: user.fecha_nacimiento, created_at: null, tratamiento: user.tratamiento }]);
    return Promise.resolve([]);
  }

  if (text.includes('SELECT nombre, relacion, detalles FROM family_members')) return Promise.resolve([]);

  if (text.includes('SELECT id, audio_url, media_urls FROM story_log')) {
    const [userId, texto] = values;
    const fila = storyLogRows.find((r) => r.userId === userId && r.texto === texto);
    return Promise.resolve(fila ? [{ id: fila.id, audio_url: fila.audioUrl, media_urls: fila.mediaUrls }] : []);
  }
  if (text.includes('UPDATE story_log SET audio_url')) {
    const [audioUrl, id] = values;
    const fila = storyLogRows.find((r) => r.id === id);
    if (fila) fila.audioUrl = audioUrl;
    storyLogUpdates.push(id);
    return Promise.resolve([]);
  }
  if (text.includes('UPDATE story_log SET media_urls')) {
    const [mediaUrls, id] = values;
    const fila = storyLogRows.find((r) => r.id === id);
    if (fila) fila.mediaUrls = mediaUrls;
    storyLogMediaUpdates.push(id);
    return Promise.resolve([]);
  }
  if (text.includes('INSERT INTO story_log')) {
    const fila = { id: storyLogRows.length + 1, userId: values[0], texto: values[1], audioUrl: values[2], mediaUrls: values[3] };
    storyLogRows.push(fila);
    storyLogInserts.push({ userId: values[0], texto: values[1], audioUrl: values[2], mediaUrls: values[3] });
    return Promise.resolve([]);
  }

  return Promise.resolve([]);
}
// ensureSchema() ahora manda todo el DDL junto con sql.transaction() (ver
// server.js) en vez de un await por sentencia — el fake necesita este
// método para no romper en la primera request.
fakeSql.transaction = (queries) => Promise.all(queries);

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
        create: async (opts, requestOptions) => {
          capturedCalls.push(Object.assign({}, opts, { __requestOptions: requestOptions }));
          if (!responseQueue.length) {
            throw new Error('FakeAnthropic: se llamó a messages.create() sin respuesta programada (llamada #' + capturedCalls.length + ')');
          }
          const next = responseQueue.shift();
          if (next && next.throw) throw next.throw;
          if (next && next.raw) return next.raw; // para simular content vacío/malformado
          return { content: [{ type: 'text', text: next }] };
        },
        // Streaming: reparte el texto en pedacitos como lo haría el SDK real.
        // { parcial: '...' } emite ese texto y luego falla (error a mitad de camino).
        stream: (opts, requestOptions) => {
          capturedCalls.push(Object.assign({}, opts, { __requestOptions: requestOptions, __stream: true }));
          if (!responseQueue.length) {
            throw new Error('FakeAnthropic: se llamó a messages.stream() sin respuesta programada (llamada #' + capturedCalls.length + ')');
          }
          const next = responseQueue.shift();
          const manejadores = [];
          return {
            on(evento, cb) { if (evento === 'text') manejadores.push(cb); return this; },
            async finalMessage() {
              if (next && next.throw) throw next.throw;
              const texto = typeof next === 'string' ? next : (next && next.parcial) || '';
              for (let i = 0; i < texto.length; i += 7) {
                manejadores.forEach((h) => h(texto.slice(i, i + 7)));
                await new Promise((r) => setImmediate(r));
              }
              if (next && next.parcial) throw new Error('Anthropic se cortó a mitad (simulado)');
              return { content: [{ type: 'text', text: texto }] };
            },
          };
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

// Reimplementación local de server.js:contarPreguntas (no está exportada) —
// solo para verificar en las aserciones de este archivo.
function contarPreguntasTest(texto) {
  const matches = texto.match(/\?/g);
  return matches ? matches.length : 0;
}

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`OK  - ${name}`); }
  else { failed++; console.log(`FAIL - ${name}`); }
}

async function main() {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));

  // Captura las líneas de console.log/console.error (sin silenciarlas) para
  // poder verificar la "métrica" de la segunda pasada (grep por
  // "[segunda-pasada]") y sus logs de error, sin tener que ir a leer
  // stdout/stderr a mano.
  const capturedLogs = [];
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  console.log = (...args) => {
    capturedLogs.push(args.join(' '));
    originalConsoleLog(...args);
  };
  console.error = (...args) => {
    capturedLogs.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
    originalConsoleError(...args);
  };

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
  pushAnthropicResponse('¡Hola Diego! Qué lindo tenerte por aquí. Vamos a ir armando juntas tu historia de vida, de a poco. Para empezar, dime cualquier cosa, tu nombre o un saludo, para confirmar que el micrófono te escucha bien.');
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
    { role: 'assistant', content: '¡Hola Diego! Cuéntame, ¿de dónde eres?' },
    { role: 'user', content: 'Nací en Bogotá, en una casa grande con mis abuelos.' },
  ];
  const normal = await nextForUser(server, cookie, { history: historial, mode: 'historia' });
  check('turno normal -> 200', normal.status === 200);
  const normalBody = JSON.parse(normal.body);
  check('turno normal: done=false', normalBody.done === false);
  check('turno normal: un solo llamado (una sola pregunta, no dispara segunda pasada)', capturedCalls.length === 1);
  check('turno normal: mensaje tal cual (sin marcadores)', !normalBody.message.includes('[FIN]') && !normalBody.message.includes('[PAUSA]'));
  check('turno normal: el system lleva el trato elegido (masculino), no asume mujer', capturedCalls[0].system[0].text.includes('TRATO DE LA PERSONA') && capturedCalls[0].system[0].text.includes('MASCULINO'));
  check('turno normal: el system va con cache_control ephemeral (prompt caching)', capturedCalls[0].system[0].cache_control && capturedCalls[0].system[0].cache_control.type === 'ephemeral');

  // --- 3) Cierre con [FIN] ---------------------------------------------------
  resetAnthropicMock();
  pushAnthropicResponse('Fue hermoso escuchar todo esto hoy. Vamos a seguir la próxima vez. [FIN]');
  const cierre = await nextForUser(server, cookie, { history: historial, mode: 'historia' });
  const cierreBody = JSON.parse(cierre.body);
  check('cierre: done=true', cierreBody.done === true);
  check('cierre: marcador [FIN] no llega al mensaje final', !cierreBody.message.includes('[FIN]'));

  // --- 4) Oferta de pausa -----------------------------------------------------
  resetAnthropicMock();
  pushAnthropicResponse('Qué historia tan linda. ¿Quieres seguir charlando un rato más o prefieres hacer una pausa por ahora?');
  const ofertaPausa = await nextForUser(server, cookie, { history: historial, mode: 'historia', ofrecerPausa: true });
  check('oferta de pausa -> 200', ofertaPausa.status === 200);
  check('oferta de pausa: el prompt extra se pegó al último mensaje del usuario', capturedCalls[0].messages[capturedCalls[0].messages.length - 1].content.includes('hacer una pausa'));

  // --- 5) Interpretación de respuesta de pausa (la persona elige pausar) -----
  resetAnthropicMock();
  pushAnthropicResponse('Listo, nos vemos pronto entonces. Ya quedó todo guardado. [PAUSA]');
  const interpretaPausa = await nextForUser(server, cookie, {
    history: [...historial, { role: 'assistant', content: '¿Quieres seguir o pausamos?' }, { role: 'user', content: 'Prefiero pausar por ahora.' }],
    mode: 'historia',
    interpretarRespuestaPausa: true,
  });
  const interpretaBody = JSON.parse(interpretaPausa.body);
  check('interpretación de pausa: pausado=true', interpretaBody.pausado === true);
  check('interpretación de pausa: marcador [PAUSA] no llega al mensaje final', !interpretaBody.message.includes('[PAUSA]'));
  check('interpretación de pausa: el prompt de interpretación se mandó', capturedCalls[0].messages[capturedCalls[0].messages.length - 1].content.includes('prefiere pausar'));

  // --- 6) Segunda pasada: el modelo cuela dos preguntas en un turno normal ---
  resetAnthropicMock();
  capturedLogs.length = 0;
  pushAnthropicResponse('Qué lindo. ¿En qué año fue eso? ¿Y quién más vivía con ustedes?'); // 2 "?" de cierre reales
  pushAnthropicResponse('Qué lindo. ¿Quién más vivía con ustedes?'); // reescritura: 1 sola pregunta
  const dosPreguntas = await nextForUser(server, cookie, { history: historial, mode: 'historia' });
  check('dos preguntas -> 200', dosPreguntas.status === 200);
  const dosPreguntasBody = JSON.parse(dosPreguntas.body);
  check('dos preguntas: dispara la segunda pasada (2 llamadas a Anthropic)', capturedCalls.length === 2);
  check('dos preguntas: el mensaje final es el reescrito, con una sola pregunta', dosPreguntasBody.message === 'Qué lindo. ¿Quién más vivía con ustedes?');
  check('dos preguntas: la llamada a la segunda pasada llevó timeout corto', capturedCalls[1] && capturedCalls[1].__requestOptions && capturedCalls[1].__requestOptions.timeout === 8000);
  check('dos preguntas: quedó la línea de métrica con resultado=reescritura-ok', capturedLogs.some((l) => l.includes('[segunda-pasada]') && l.includes('preguntas_original=2') && l.includes('resultado=reescritura-ok')));

  // --- 6b) Segunda pasada: la reescritura del modelo TODAVÍA tiene 2+ "?" ----
  // (el modelo no obedeció del todo) -> no se acepta a ciegas, cae al
  // fallback determinista (corta en el primer "?" del texto original).
  resetAnthropicMock();
  capturedLogs.length = 0;
  pushAnthropicResponse('Qué lindo. ¿En qué año fue eso? ¿Y quién más vivía con ustedes?');
  pushAnthropicResponse('¿En qué año fue eso? ¿Y con quién vivías, y qué hacían?'); // reescritura mal hecha: sigue con 2+ "?"
  const reescrituraInvalida = await nextForUser(server, cookie, { history: historial, mode: 'historia' });
  const reescrituraInvalidaBody = JSON.parse(reescrituraInvalida.body);
  check('reescritura inválida: cae al fallback determinista (corta en el primer "?")', reescrituraInvalidaBody.message === 'Qué lindo. ¿En qué año fue eso?');
  check('reescritura inválida: el mensaje final tiene una sola pregunta', contarPreguntasTest(reescrituraInvalidaBody.message) === 1);
  check('reescritura inválida: queda logueado como fallback determinista', capturedLogs.some((l) => l.includes('[segunda-pasada]') && l.includes('resultado=reescritura-invalida-fallback-deterministico')));

  // --- 6c) Segunda pasada: la llamada a Anthropic falla del todo -------------
  // -> antes esto mandaba el texto original (con las 2+ preguntas) tal
  // cual; ahora también cae al fallback determinista, así que el mensaje
  // que le llega a la persona nunca tiene más de una pregunta.
  resetAnthropicMock();
  capturedLogs.length = 0;
  pushAnthropicResponse('Qué lindo. ¿En qué año fue eso? ¿Y quién más vivía con ustedes?');
  pushAnthropicResponse({ throw: new Error('Anthropic no respondió (simulado)') });
  const fallaSegundaPasada = await nextForUser(server, cookie, { history: historial, mode: 'historia' });
  check('falla la segunda pasada -> igual 200 (no se cae el pedido)', fallaSegundaPasada.status === 200);
  const fallaSegundaPasadaBody = JSON.parse(fallaSegundaPasada.body);
  check('falla la segunda pasada: cae al fallback determinista igual', fallaSegundaPasadaBody.message === 'Qué lindo. ¿En qué año fue eso?');
  check('falla la segunda pasada: queda logueado el error de la llamada', capturedLogs.some((l) => l.includes('No se pudo dejar el mensaje con una sola pregunta')));
  check('falla la segunda pasada: queda logueado como fallback por error', capturedLogs.some((l) => l.includes('[segunda-pasada]') && l.includes('resultado=reescritura-fallo-error')));

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

  // --- 10) Respuesta larga del usuario se guarda en story_log, con su foto ---
  resetAnthropicMock();
  storyLogInserts = [];
  pushAnthropicResponse('Qué recuerdo tan lindo, gracias por contarlo.');
  const respuestaLarga = 'x'.repeat(200); // >= HISTORIA_MIN_CHARS (180)
  const fotoPrimeraVez = { url: 'https://fake.blob.vercel-storage.com/media/1/foto-2.jpg', type: 'foto', caption: 'Un momento' };
  await nextForUser(server, cookie, {
    history: [...historial, { role: 'assistant', content: '¿Y qué más recuerdas?' }, { role: 'user', content: respuestaLarga }],
    mode: 'historia',
    mediaUrls: [fotoPrimeraVez],
  });
  check('respuesta larga: se guardó en story_log', storyLogInserts.length === 1 && storyLogInserts[0].texto.length >= 180);
  check('respuesta larga: la foto agregada en el mismo turno queda guardada', JSON.parse(storyLogInserts[0].mediaUrls)[0].url === fotoPrimeraVez.url);

  // Contraprueba: una respuesta corta NO se guarda en story_log.
  resetAnthropicMock();
  storyLogInserts = [];
  pushAnthropicResponse('Cuéntame más.');
  await nextForUser(server, cookie, {
    history: [...historial, { role: 'assistant', content: '¿Y qué más recuerdas?' }, { role: 'user', content: 'Poquita cosa.' }],
    mode: 'historia',
  });
  check('respuesta corta: NO se guarda en story_log', storyLogInserts.length === 0);

  // --- 10.1) La misma respuesta larga NO se duplica si /api/next se llama
  // de nuevo sin que se haya sumado una respuesta nueva (bug real: pausar y
  // seguir varias veces seguidas insertaba la misma historia una y otra vez).
  resetAnthropicMock();
  storyLogInserts = [];
  storyLogRows = [];
  storyLogUpdates = [];
  storyLogMediaUpdates = [];
  const historialConRespuestaLarga = [...historial, { role: 'assistant', content: '¿Y qué más recuerdas?' }, { role: 'user', content: respuestaLarga }];
  pushAnthropicResponse('Qué recuerdo tan lindo, gracias por contarlo.');
  await nextForUser(server, cookie, { history: historialConRespuestaLarga, mode: 'historia', lastAudioUrl: null });
  pushAnthropicResponse('Qué recuerdo tan lindo, gracias por contarlo.');
  await nextForUser(server, cookie, { history: historialConRespuestaLarga, mode: 'historia', lastAudioUrl: null });
  check('la misma respuesta larga repetida -> una sola fila en story_log, no dos', storyLogInserts.length === 1 && storyLogRows.length === 1);

  // Si en la repetida esta vez sí llega el audio (que antes no había
  // llegado a tiempo), se completa la fila existente en vez de duplicarla.
  pushAnthropicResponse('Qué recuerdo tan lindo, gracias por contarlo.');
  await nextForUser(server, cookie, { history: historialConRespuestaLarga, mode: 'historia', lastAudioUrl: 'https://fake.blob.vercel-storage.com/audio/1/x/y.webm' });
  check('con audio en la repetida: se completa la fila existente, no se crea otra', storyLogRows.length === 1 && storyLogUpdates.length === 1);
  check('la fila existente quedó con el audio completado', storyLogRows[0].audioUrl === 'https://fake.blob.vercel-storage.com/audio/1/x/y.webm');

  // Mismo criterio con una foto que llega recién en la repetida.
  pushAnthropicResponse('Qué recuerdo tan lindo, gracias por contarlo.');
  const fotoDeLaHistoria = { url: 'https://fake.blob.vercel-storage.com/media/1/foto-1.jpg', type: 'foto', caption: 'La finca' };
  await nextForUser(server, cookie, { history: historialConRespuestaLarga, mode: 'historia', mediaUrls: [fotoDeLaHistoria] });
  check('con foto en la repetida: se completa la fila existente, no se crea otra', storyLogRows.length === 1 && storyLogMediaUpdates.length === 1);
  check('la fila existente quedó con la foto completada', JSON.parse(storyLogRows[0].mediaUrls)[0].url === fotoDeLaHistoria.url);

  // --- 11) Nota pendiente de un colaborador se incorpora al arranque ---------
  resetAnthropicMock();
  user.resumenTexto = 'Diego ya contó algunas historias de su infancia.';
  user.pendingFamilyNote = { id: 42, contributor: 'María', parentesco: 'hija', texto: 'Contó que su papá le enseñó a andar en bici en el parque.', ab_variant: 'inicio' };
  pushAnthropicResponse('¡Hola Diego! Quiero contarte que estuve hablando con María y me contó una historia sobre ti, de cuando tu papá te enseñó a andar en bici. ¿Qué te acuerdas de eso?');
  const conNota = await nextForUser(server, cookie, { history: [], mode: 'historia' });
  check('nota pendiente -> 200', conNota.status === 200);
  check('nota pendiente: el prompt de arranque incluye el texto de la nota', capturedCalls[0].messages[0].content.includes('andar en bici'));
  check('nota pendiente: se marcó como discutida', familyNoteMarkedDiscussed.includes(42));

  // --- 11b) Si Anthropic falla, la nota pendiente NO se marca como discutida --
  // (server.js: el UPDATE se movió a después de validar la respuesta —
  // antes corría ANTES de llamar a Anthropic, así que una falla del
  // proveedor perdía el aporte en silencio: la nota quedaba marcada como
  // discutida aunque la persona nunca llegó a enterarse).
  resetAnthropicMock();
  user.pendingFamilyNote = { id: 43, contributor: 'María', parentesco: 'hija', texto: 'Otra historia distinta.', ab_variant: 'inicio' };
  pushAnthropicResponse({ throw: new Error('Anthropic no respondió (simulado)') });
  const conNotaFallaProveedor = await nextForUser(server, cookie, { history: [], mode: 'historia' });
  check('nota pendiente + falla del proveedor -> 500 (no 200)', conNotaFallaProveedor.status === 500);
  check('nota pendiente + falla del proveedor: la nota NO se marca como discutida', !familyNoteMarkedDiscussed.includes(43));

  // --- 11b2) Si la historia pendiente tiene una foto adjunta (se subió
  // mientras se contaba, ver mediaUrls en /api/contribute-chat), se
  // menciona y se muestra JUNTO con la historia en la misma introducción
  // — no como un pendiente aparte que compita por ser lo primero (bug
  // real reportado: la foto de una historia quedaba sin mencionarse
  // porque la nota de texto siempre tenía prioridad).
  resetAnthropicMock();
  user.pendingFamilyNote = {
    id: 44, contributor: 'Felipe', parentesco: 'hijo', texto: 'Contó del río de la finca de la abuela.',
    media_urls: JSON.stringify([{ url: 'https://fake.blob.vercel-storage.com/media/1/foto-1.jpg', type: 'foto', caption: 'El río de la finca' }]),
    ab_variant: 'inicio',
  };
  pushAnthropicResponse('¡Hola Diego! Felipe te contó una historia sobre el río de la finca, y también subió una foto. ¿Qué recuerdas de eso?');
  const conNotaYFoto = await nextForUser(server, cookie, { history: [], mode: 'historia' });
  check('nota con foto adjunta -> 200', conNotaYFoto.status === 200);
  check('nota con foto: el prompt de arranque menciona al contribuidor real (Felipe)', capturedCalls[0].messages[0].content.includes('Felipe'));
  check('nota con foto: el prompt de arranque NO usa el ejemplo "Marcela"', !capturedCalls[0].messages[0].content.includes('Marcela'));
  check('nota con foto: se marcó la nota como discutida', familyNoteMarkedDiscussed.includes(44));
  const notaYFotoBody = JSON.parse(conNotaYFoto.body);
  check('nota con foto: la respuesta trae la foto para mostrarla en pantalla', notaYFotoBody.media && notaYFotoBody.media.url === 'https://fake.blob.vercel-storage.com/media/1/foto-1.jpg' && notaYFotoBody.media.type === 'foto');

  // --- 11c1) Item 12 (A/B test): variante 'medio' -- NO se menciona en el
  // primer turno, se difiere hasta que la charla lleva unos intercambios.
  resetAnthropicMock();
  user.pendingFamilyNote = { id: 45, contributor: 'María', parentesco: 'hija', texto: 'Contó del cumpleaños sorpresa.', ab_variant: 'medio' };
  pushAnthropicResponse('¡Hola Diego! Cuéntame, ¿de dónde eres?');
  const medioTurno0 = await nextForUser(server, cookie, { history: [], mode: 'historia' });
  check('variante medio, turno 0 -> 200', medioTurno0.status === 200);
  check('variante medio, turno 0: el arranque NO menciona la nota (se difiere)', !capturedCalls[0].messages[0].content.includes('cumpleaños sorpresa'));
  check('variante medio, turno 0: NO se marca como discutida todavía', !familyNoteMarkedDiscussed.includes(45));

  resetAnthropicMock();
  const historialLargo = [
    { role: 'user', content: 'Hola, soy Diego.' },
    { role: 'assistant', content: '¡Hola Diego! Cuéntame, ¿de dónde eres?' },
    { role: 'user', content: 'Nací en Bogotá.' },
    { role: 'assistant', content: '¿Y con quién vivías?' },
    { role: 'user', content: 'Con mis papás y mis hermanos.' },
    { role: 'assistant', content: '¿Algún recuerdo lindo de esa casa?' },
    { role: 'user', content: 'Sí, los domingos en familia.' },
  ];
  pushAnthropicResponse('Qué lindo. Y antes de seguir, María me contó una historia sobre el cumpleaños sorpresa. ¿Qué recuerdas de eso?');
  const medioTurnoTarde = await nextForUser(server, cookie, { history: historialLargo, mode: 'historia' });
  check('variante medio, turno tardío -> 200', medioTurnoTarde.status === 200);
  const ultimoMensajeMedio = capturedCalls[0].messages[capturedCalls[0].messages.length - 1];
  check('variante medio, turno tardío: se pega al ÚLTIMO mensaje del usuario (no reemplaza la charla)', ultimoMensajeMedio.role === 'user' && ultimoMensajeMedio.content.includes('Sí, los domingos en familia.') && ultimoMensajeMedio.content.includes('cumpleaños sorpresa'));
  check('variante medio, turno tardío: se marca como discutida', familyNoteMarkedDiscussed.includes(45));

  user.pendingFamilyNote = null;

  // --- 11c) Foto/video pendiente arma un arranque dedicado (como la nota de
  // un colaborador), se marca discutida, y se le manda la URL al cliente
  // para que la muestre en pantalla mientras habla. Necesita resumenTexto
  // puesto (igual que 11): con history:[] y sin resumen, esPrimeraVez tiene
  // prioridad y nunca llegaría a evaluarse mediaPendiente.
  resetAnthropicMock();
  user.pendingMedia = { id: 77, type: 'foto', caption: 'Cumpleaños de 15 en el patio de la abuela.', contributor: 'María', url: 'https://fake.blob.vercel-storage.com/media/1/foto-1.jpg' };
  pushAnthropicResponse('Qué lindo, ¿quién más estaba en esa foto del cumpleaños?');
  const conMedia = await nextForUser(server, cookie, { history: [], mode: 'historia' });
  check('media pendiente -> 200', conMedia.status === 200);
  check('media pendiente: el prompt de arranque incluye la descripción', capturedCalls[0].messages[0].content.includes('Cumpleaños de 15'));
  check('media pendiente: se marcó como discutida', mediaMarkedDiscussed.includes(77));
  check('media pendiente: la respuesta trae la url y el tipo para mostrarla', JSON.parse(conMedia.body).media && JSON.parse(conMedia.body).media.url === user.pendingMedia.url && JSON.parse(conMedia.body).media.type === 'foto');

  // --- 11d) Si Anthropic falla, la media pendiente NO se marca como discutida --
  // (mismo bug que 11b, encontrado en una revisión propia del código: el
  // UPDATE vivía adentro de loadFamilyContext() y corría ANTES de llamar a
  // Anthropic — si el proveedor fallaba, la foto/video quedaba marcada
  // como "ya la mencioné" aunque la persona nunca se enteró).
  resetAnthropicMock();
  user.pendingMedia = { id: 78, type: 'video', caption: 'Otro momento distinto.', contributor: 'María', url: 'https://fake.blob.vercel-storage.com/media/1/video-1.mp4' };
  pushAnthropicResponse({ throw: new Error('Anthropic no respondió (simulado)') });
  const conMediaFallaProveedor = await nextForUser(server, cookie, { history: [], mode: 'historia' });
  check('media pendiente + falla del proveedor -> 500 (no 200)', conMediaFallaProveedor.status === 500);
  check('media pendiente + falla del proveedor: la media NO se marca como discutida', !mediaMarkedDiscussed.includes(78));

  user.pendingMedia = null;

  // --- 12) Respuesta de Anthropic vacía/malformada -> 500 controlado, no cuelga --
  resetAnthropicMock();
  pushAnthropicResponse({ raw: { content: [] } }); // sin bloques de texto
  const respuestaVacia = await nextForUser(server, cookie, { history: historial, mode: 'historia' });
  check('respuesta de Anthropic vacía -> 500 controlado (no 200, no cuelga)', respuestaVacia.status === 500);
  check('respuesta de Anthropic vacía: mensaje de error genérico, no un stack trace', JSON.parse(respuestaVacia.body).error === 'No se pudo generar la siguiente pregunta.');

  // --- 13) Español de Colombia: nada de voseo ni argentinismos al usuario -------
  // El modelo a veces se cuela con voseo aunque el prompt lo prohíba; el
  // detector lo agarra y se pide una reescritura mínima (o, si falla, se
  // reemplaza de forma determinista).
  resetAnthropicMock();
  capturedLogs.length = 0;
  pushAnthropicResponse('Qué lindo recuerdo, contame más. ¿Y dónde vivías vos en esa época?');
  pushAnthropicResponse('Qué lindo recuerdo, cuéntame más. ¿Y dónde vivías tú en esa época?');
  const conVoseo = await nextForUser(server, cookie, { history: historial, mode: 'historia' });
  const conVoseoBody = JSON.parse(conVoseo.body);
  check('dialecto: voseo -> dispara una corrección (2 llamadas a Anthropic)', capturedCalls.length === 2);
  check('dialecto: la corrección lleva la regla explícita de español de Colombia', String(capturedCalls[1].system).includes('IDIOMA — OBLIGATORIO'));
  check('dialecto: el mensaje final es el corregido (sin voseo)', conVoseoBody.message === 'Qué lindo recuerdo, cuéntame más. ¿Y dónde vivías tú en esa época?');
  check('dialecto: queda logueado reescritura-ok', capturedLogs.some((l) => l.includes('[dialecto]') && l.includes('resultado=reescritura-ok')));
  check('dialecto: el system de la charla lleva la regla de español de Colombia', capturedCalls[0].system[0].text.includes('IDIOMA — OBLIGATORIO'));

  // Si la reescritura del modelo sigue trayendo voseo, se cae al reemplazo determinista.
  resetAnthropicMock();
  capturedLogs.length = 0;
  pushAnthropicResponse('Mirá, acá tenés que contarme más. ¿Cómo eran los domingos?');
  pushAnthropicResponse('Mirá, acá tenés que contarme más. ¿Cómo eran los domingos?'); // "corrección" que no corrigió nada
  const sigueConVoseo = await nextForUser(server, cookie, { history: historial, mode: 'historia' });
  check('dialecto: si la reescritura no arregla, igual no llega voseo (fallback determinista)', JSON.parse(sigueConVoseo.body).message === 'Mira, aquí tienes que contarme más. ¿Cómo eran los domingos?');
  check('dialecto: queda logueado como fallback determinista', capturedLogs.some((l) => l.includes('[dialecto]') && l.includes('fallback-deterministico')));

  // Si falla la llamada de corrección, el pedido sigue en 200 y sin voseo.
  resetAnthropicMock();
  pushAnthropicResponse('Contame de tu infancia.');
  pushAnthropicResponse({ throw: new Error('Anthropic no respondió (simulado)') });
  const fallaCorreccion = await nextForUser(server, cookie, { history: historial, mode: 'historia' });
  check('dialecto: si falla la corrección -> 200 igual', fallaCorreccion.status === 200);
  check('dialecto: si falla la corrección -> el mensaje sale corregido de forma determinista', JSON.parse(fallaCorreccion.body).message === 'Cuéntame de tu infancia.');

  // Texto ya colombiano: cero llamadas extra (no agrega latencia ni costo).
  resetAnthropicMock();
  pushAnthropicResponse('Uy, qué belleza. Cuéntame más de esa casa, ¿tenía patio?');
  const limpio = await nextForUser(server, cookie, { history: historial, mode: 'historia' });
  check('dialecto: texto ya colombiano -> una sola llamada, sin corrección', capturedCalls.length === 1 && JSON.parse(limpio.body).message.startsWith('Uy, qué belleza.'));

  // --- 14) Streaming: las primeras oraciones salen antes del mensaje final ---
  const lineas = (r) => r.body.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const junto = (t) => t.replace(/\s+/g, ' ').trim();

  resetAnthropicMock();
  pushAnthropicResponse('¡Qué bello recuerdo, Diego! Me imagino lo feliz que serías. ¿Cómo se llamaba tu perro?');
  const stream1 = await nextForUser(server, cookie, { history: historial, mode: 'historia', stream: true });
  const ev1 = lineas(stream1);
  const frases1 = ev1.filter((e) => e.t === 'frase');
  const fin1 = ev1[ev1.length - 1];
  check('streaming: contesta como ndjson', stream1.status === 200 && String(stream1.headers['content-type']).includes('ndjson'));
  check('streaming: usó messages.stream (no create)', capturedCalls.length === 1 && capturedCalls[0].__stream === true);
  check('streaming: salen las dos primeras oraciones antes del final', frases1.length === 2 && frases1[0].texto === '¡Qué bello recuerdo, Diego!');
  check('streaming: el último evento es "fin" con el mensaje completo', fin1.t === 'fin' && fin1.message === '¡Qué bello recuerdo, Diego! Me imagino lo feliz que serías. ¿Cómo se llamaba tu perro?' && fin1.done === false);
  check('streaming: frases + restante = mensaje completo (nada repetido ni perdido)', junto(frases1.map((f) => f.texto).join(' ') + ' ' + fin1.restante) === junto(fin1.message) && fin1.restante === '¿Cómo se llamaba tu perro?');

  // Nada después de la primera pregunta (la regla de "una sola pregunta" se decide con el mensaje entero).
  resetAnthropicMock();
  pushAnthropicResponse('Qué lindo eso, Diego, de verdad. ¿Y tu mamá qué decía? ¿Y tu papá? Cuéntame más.');
  pushAnthropicResponse('Qué lindo eso, Diego, de verdad. ¿Y tu mamá qué decía?');
  const stream2 = await nextForUser(server, cookie, { history: historial, mode: 'historia', stream: true });
  const ev2 = lineas(stream2);
  const frases2 = ev2.filter((e) => e.t === 'frase');
  const fin2 = ev2[ev2.length - 1];
  check('streaming: se detiene en la primera pregunta (no adelanta la segunda)', frases2.length === 2 && frases2[1].texto === '¿Y tu mamá qué decía?');
  check('streaming: con 2 preguntas igual corre la segunda pasada y el final queda con una sola', capturedCalls.length === 2 && fin2.message === 'Qué lindo eso, Diego, de verdad. ¿Y tu mamá qué decía?' && fin2.restante === '');

  // Voseo: no se adelanta nada (se corrige con el texto completo).
  resetAnthropicMock();
  pushAnthropicResponse('Contame más de eso, por favor. ¿Cómo era la casa?');
  pushAnthropicResponse('Cuéntame más de eso, por favor. ¿Cómo era la casa?');
  const stream3 = await nextForUser(server, cookie, { history: historial, mode: 'historia', stream: true });
  const ev3 = lineas(stream3);
  check('streaming: una oración con voseo NO se adelanta', !ev3.some((e) => e.t === 'frase'));
  check('streaming: el final llega corregido y completo en "restante"', ev3[ev3.length - 1].message === 'Cuéntame más de eso, por favor. ¿Cómo era la casa?' && ev3[ev3.length - 1].restante === ev3[ev3.length - 1].message);

  // Cierre con [FIN]: el marcador no se adelanta ni se dice.
  resetAnthropicMock();
  pushAnthropicResponse('Gracias por contarme todo esto, Diego. Fue un gusto. [FIN]');
  const stream4 = await nextForUser(server, cookie, { history: historial, mode: 'historia', stream: true });
  const ev4 = lineas(stream4);
  const fin4 = ev4[ev4.length - 1];
  check('streaming: [FIN] -> done=true, sin el marcador en el texto', fin4.done === true && !fin4.message.includes('[FIN]') && fin4.message === 'Gracias por contarme todo esto, Diego. Fue un gusto.');
  check('streaming: lo que se adelantó no incluye el marcador', ev4.filter((e) => e.t === 'frase').every((e) => !e.texto.includes('[')) && fin4.restante === 'Fue un gusto.');

  // Falla antes de empezar: un 500 normal en JSON. Falla ya empezada: evento "error".
  resetAnthropicMock();
  pushAnthropicResponse({ throw: new Error('Anthropic no respondió (simulado)') });
  const stream5 = await nextForUser(server, cookie, { history: historial, mode: 'historia', stream: true });
  check('streaming: falla antes de contestar -> 500 con JSON de error', stream5.status === 500 && JSON.parse(stream5.body).error === 'No se pudo generar la siguiente pregunta.');
  resetAnthropicMock();
  pushAnthropicResponse({ parcial: 'Qué bonito recuerdo, Diego, cuéntame. ¿Y luego qué pasó' });
  const stream6 = await nextForUser(server, cookie, { history: historial, mode: 'historia', stream: true });
  const ev6 = lineas(stream6);
  check('streaming: falla a mitad -> manda la oración ya lista y luego un evento "error"', ev6[0].t === 'frase' && ev6[ev6.length - 1].t === 'error');

  // Sin "stream": sigue contestando JSON como siempre.
  resetAnthropicMock();
  pushAnthropicResponse('Uy, qué belleza. Cuéntame más de esa casa, ¿tenía patio?');
  const sinStream = await nextForUser(server, cookie, { history: historial, mode: 'historia' });
  check('sin stream: JSON normal y messages.create', String(sinStream.headers['content-type']).includes('application/json') && capturedCalls[0].__stream !== true && JSON.parse(sinStream.body).message.startsWith('Uy, qué belleza.'));

  server.close();
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  console.log(`\n${passed} pasaron, ${failed} fallaron`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR EN EL SMOKE TEST DE /api/next:', e);
  process.exit(1);
});
