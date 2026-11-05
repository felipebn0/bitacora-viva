// Smoke test para /api/chapters/generate y GET /api/chapters — cubre lo
// que se agregó a pedido: elegir primera o tercera persona al generar, y
// que el audio real de las historias fuente venga junto con cada capítulo
// (no solo el texto que armó la IA).
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const PASSWORD_HASH = bcrypt.hashSync('miclave123', 4);

const users = {
  1: { id: 1, username: 'felipe', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null },
};

// Dos historias: una con audio guardado, otra sin (texto corto, se
// descartó el audio — ver HISTORIA_MIN_CHARS/AUDIO_MIN_DURATION_MS en
// app.html). El capítulo agrupa las dos.
const storyLog = [
  { id: 10, texto: 'De chico vivíamos en una finca en Boyacá.', audio_url: 'https://fake.blob/audio/1/a.webm' },
  { id: 11, texto: 'Después nos mudamos a Bogotá.', audio_url: null },
];

let chaptersTable = [];
let nextChapterId = 1;
let capturedAnthropicCalls = [];
let trato = 'femenino';
let gruposFalsos = [{ theme: 'La infancia', story_ids: [10, 11] }];
let clasificacionesPendientes = [];

function fakeSql(strings, ...values) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = users[1];
    return Promise.resolve(u.username === values[0] ? [{ id: u.id, username: u.username, password_hash: u.password_hash, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT name AS nombre, fecha_nacimiento, created_at, tratamiento, voz FROM users WHERE id')) {
    return Promise.resolve([{ nombre: 'Stella', fecha_nacimiento: null, created_at: '2026-01-01T00:00:00Z', tratamiento: trato, voz: null }]);
  }
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ owner_user_id: u.owner_user_id, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT id, texto, created_at FROM story_log WHERE user_id')) {
    return Promise.resolve(storyLog.map((s) => ({ id: s.id, texto: s.texto, created_at: '2026-01-01T00:00:00Z' })));
  }
  if (text.includes('SELECT id, texto, audio_url, audio_urls FROM story_log WHERE user_id') && text.includes('audio_url IS NOT NULL')) {
    return Promise.resolve(storyLog.filter((s) => s.audio_url).map((s) => ({ id: s.id, texto: s.texto, audio_url: s.audio_url })));
  }
  // Charlas guardadas: la entrevistadora saluda, comenta y pregunta; la persona responde.
  if (text.includes('SELECT intercambios FROM sessions WHERE user_id')) {
    return Promise.resolve([{ intercambios: [
      { role: 'assistant', content: '¡Qué bueno verte, Diego! Hoy quiero conocerte mejor. Cuéntame, ¿cómo era la finca donde vivían en Boyacá?' },
      { role: 'user', content: 'De chico vivíamos en una finca en Boyacá.' },
      { role: 'assistant', content: 'Qué recuerdo tan lindo. Y después, ¿qué pasó?' },
      { role: 'user', content: 'Otra cosa distinta.' },
    ] }]);
  }
  if (text.includes('DELETE FROM chapters WHERE user_id')) { chaptersTable = []; return Promise.resolve([]); }
  if (text.includes('INSERT INTO chapters')) {
    // (user_id, title, theme, generated_text, story_ids, persona) -> 6 values.
    const [userId, title, theme, generatedText, storyIds, persona] = values;
    const row = { id: nextChapterId++, user_id: userId, title, theme, generated_text: generatedText, story_ids: storyIds, persona, created_at: '2026-01-02T00:00:00Z' };
    chaptersTable.push(row);
    return Promise.resolve([{ id: row.id, title: row.title, theme: row.theme, generated_text: row.generated_text, story_ids: row.story_ids, persona: row.persona, created_at: row.created_at }]);
  }
  if (text.includes('SELECT id, title, theme, generated_text, story_ids, persona, created_at FROM chapters WHERE user_id')) {
    return Promise.resolve(chaptersTable.map((c) => ({ id: c.id, title: c.title, theme: c.theme, generated_text: c.generated_text, story_ids: c.story_ids, persona: c.persona, created_at: c.created_at })));
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

// classifyStoriesByTheme pide "agrupar_historias_por_tema"; writeChapterFromStories
// pide "escribir_capitulo" — dos tool_use seguidos por cada capítulo.
require.cache[require.resolve('@anthropic-ai/sdk')] = {
  id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true,
  exports: class FakeAnthropic {
    constructor() {}
    get messages() {
      return {
        create: async (opts) => {
          capturedAnthropicCalls.push(opts);
          const toolName = opts.tool_choice && opts.tool_choice.name;
          if (toolName === 'agrupar_historias_por_tema') {
            if (clasificacionesPendientes.length) return { stop_reason: 'max_tokens', content: [{ type: 'tool_use', id: 't0', name: toolName, input: clasificacionesPendientes.shift() }] };
            return { content: [{ type: 'tool_use', id: 't1', name: toolName, input: { grupos: gruposFalsos } }] };
          }
          if (toolName === 'escribir_capitulo') {
            return { content: [{ type: 'tool_use', id: 't2', name: toolName, input: { title: 'La infancia', generated_text: 'Un capítulo corto y fiel a lo contado.' } }] };
          }
          throw new Error('FakeAnthropic: llamada inesperada sin tool_choice reconocido');
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

async function login(server, username) {
  const resp = await request(server, { path: '/api/login', method: 'POST', body: { username, password: 'miclave123' } });
  if (resp.status !== 200) throw new Error(`login falló: ${resp.status} ${resp.body}`);
  return resp.headers['set-cookie'][0].split(';')[0];
}

let pasaron = 0;
let fallaron = 0;
function check(nombre, cond) {
  if (cond) { pasaron++; console.log('OK  -', nombre); }
  else { fallaron++; console.log('FAIL -', nombre); }
}

(async () => {
  const server = app.listen(0);
  try {
    const cookie = await login(server, 'felipe');

    const gen = await request(server, { path: '/api/chapters/generate', method: 'POST', body: { persona: 'primera' } }, cookie);
    check('chapters/generate con persona=primera -> 200', gen.status === 200);
    const genData = JSON.parse(gen.body);
    check('devuelve 1 capítulo', genData.chapters && genData.chapters.length === 1);
    check('el capítulo se guardó con persona=primera', genData.chapters[0].persona === 'primera');

    const promptEscribir = capturedAnthropicCalls.find((c) => c.tool_choice && c.tool_choice.name === 'escribir_capitulo');
    check('el prompt le pidió a la IA narrar en PRIMERA persona', promptEscribir.messages[0].content.includes('PRIMERA persona'));
    const promptAgrupar = capturedAnthropicCalls.find((c) => c.tool_choice && c.tool_choice.name === 'agrupar_historias_por_tema');
    check('al agrupar por temas, cada historia llega con la pregunta de Eco a la que responde (una respuesta corta no se confunde con la de al lado)', promptAgrupar.messages[0].content.includes('#10') && promptAgrupar.messages[0].content.includes('Eco le preguntó: «¿cómo era la finca donde vivían en Boyacá?»'));
    check('y se le dice que estar juntas en la fecha no las hace del mismo tema', promptAgrupar.messages[0].content.includes('NO significa que sean del mismo tema'));
    check('cada historia llega con la pregunta de Eco que la originó (para saber de quién habla)', promptEscribir.messages[0].content.includes('Eco le preguntó: «¿cómo era la finca donde vivían en Boyacá?»'));
    check('el prompt prohíbe contarle a la persona la vida de otra, la charla técnica y los datos que se contradicen', /REGLAS: \(1\) Si en una respuesta la persona habla de OTRA persona/.test(promptEscribir.messages[0].content) && /pruebas de audio/.test(promptEscribir.messages[0].content) && /se contradicen/.test(promptEscribir.messages[0].content));

    const lista = await request(server, { path: '/api/chapters' }, cookie);
    check('GET /api/chapters -> 200', lista.status === 200);
    const listaData = JSON.parse(lista.body);
    check('el capítulo trae el audio de la historia que sí tenía (id 10)', JSON.stringify(listaData.chapters[0].audios) === JSON.stringify(['https://fake.blob/audio/1/a.webm']));
    check('NO trae null por la historia sin audio (id 11) — se filtra, no se cuela', listaData.chapters[0].audios.length === 1);
    check('cada nota de voz trae solo la pregunta que se le hizo (sin saludo ni comentarios)', JSON.stringify(listaData.chapters[0].preguntas) === JSON.stringify(['¿cómo era la finca donde vivían en Boyacá?']));

    check('el capítulo se escribe en FEMENINO si así se trata a la persona', promptEscribir.messages[0].content.includes('FEMENINO') && !promptEscribir.messages[0].content.includes('en MASCULINO'));
    trato = 'masculino';
    capturedAnthropicCalls = [];
    await request(server, { path: '/api/chapters/generate', method: 'POST', body: {} }, cookie);
    const promptMasc = capturedAnthropicCalls.find((c) => c.tool_choice && c.tool_choice.name === 'escribir_capitulo');
    check('y en MASCULINO si se trata en masculino', promptMasc.messages[0].content.includes('en MASCULINO'));
    trato = null;
    capturedAnthropicCalls = [];
    await request(server, { path: '/api/chapters/generate', method: 'POST', body: {} }, cookie);
    const promptSin = capturedAnthropicCalls.find((c) => c.tool_choice && c.tool_choice.name === 'escribir_capitulo');
    check('sin trato elegido, no se adivina por el nombre', promptSin.messages[0].content.includes('no se sabe si la persona'));

    // --- Default: sin mandar "persona", narra en tercera ---
    capturedAnthropicCalls = [];
    const genDefault = await request(server, { path: '/api/chapters/generate', method: 'POST', body: {} }, cookie);
    check('chapters/generate sin persona -> 200', genDefault.status === 200);
    const promptDefault = capturedAnthropicCalls.find((c) => c.tool_choice && c.tool_choice.name === 'escribir_capitulo');
    check('sin especificar, narra en tercera persona (compatibilidad con lo de antes)', promptDefault.messages[0].content.includes('tercera persona') && !promptDefault.messages[0].content.includes('PRIMERA persona'));

    // --- Una historia no se repite en dos capítulos ---
    gruposFalsos = [{ theme: 'La infancia', story_ids: [10, 11] }, { theme: 'La mudanza', story_ids: [10] }];
    const genRep = await request(server, { path: '/api/chapters/generate', method: 'POST', body: {} }, cookie);
    const repData = JSON.parse(genRep.body);
    check('una historia repetida en dos temas se queda solo en el primer capítulo', repData.chapters.length === 1 && JSON.stringify(repData.chapters[0].story_ids) === '[10,11]');

    // Un libro con muchos temas no pierde los últimos: antes se cortaba en 12 y se caían los de la parte final de la vida.
    for (let n = 12; n <= 25; n++) storyLog.push({ id: n, texto: 'Historia ' + n, audio_url: null });
    gruposFalsos = Array.from({ length: 16 }, (_, k) => ({ theme: 'Tema ' + (k + 1), story_ids: [10 + k], etapa: 'vida_laboral', orden: k + 1 }));
    const muchos = await request(server, { path: '/api/chapters/generate', method: 'POST', body: {} }, cookie);
    const muchosData = JSON.parse(muchos.body);
    check('con 16 temas salen los 16 capítulos, en orden', muchosData.chapters.length === 16 && muchosData.chapters.map((c) => c.theme).join('|') === gruposFalsos.map((g) => g.theme).join('|'));
    storyLog.length = 2;

    // La etapa manda sobre el número de orden: un tema de la infancia no queda detrás de los de la vida adulta ni de los sin época.
    gruposFalsos = [
      { theme: 'Su cocina', story_ids: [10], etapa: 'toda_la_vida', orden: 1 },
      { theme: 'Su primer trabajo', story_ids: [11], etapa: 'vida_laboral', orden: 2 },
      { theme: 'La música de la infancia', story_ids: [], etapa: 'infancia', orden: 9 },
    ];
    storyLog.push({ id: 12, texto: 'La música en casa', audio_url: null });
    gruposFalsos[2].story_ids = [12];
    const porEtapa = await request(server, { path: '/api/chapters/generate', method: 'POST', body: {} }, cookie);
    check('los temas se ordenan primero por etapa de vida (infancia, trabajo, sin época) y luego por posición', JSON.parse(porEtapa.body).chapters.map((c) => c.theme).join('|') === 'La música de la infancia|Su primer trabajo|Su cocina');
    storyLog.length = 2;

    // Si la primera respuesta de la IA llega cortada (sin grupos), se vuelve a pedir una vez en vez de rendirse.
    gruposFalsos = [{ theme: 'La infancia', story_ids: [10, 11], etapa: 'infancia', orden: 1 }];
    clasificacionesPendientes = [{}];
    const reintento = await request(server, { path: '/api/chapters/generate', method: 'POST', body: {} }, cookie);
    const reintentoData = JSON.parse(reintento.body);
    check('si la IA contesta la clasificación sin grupos, se reintenta y el libro se arma igual', reintentoData.chapters && reintentoData.chapters.length === 1);
    clasificacionesPendientes = [{ grupos: JSON.stringify([{ theme: 'Texto', story_ids: [10], etapa: 'infancia', orden: 1 }]) }];
    const comoTexto = await request(server, { path: '/api/chapters/generate', method: 'POST', body: {} }, cookie);
    check('si "grupos" llega como texto JSON, se lee igual', JSON.parse(comoTexto.body).chapters.some((c) => c.theme === 'Texto'));
    clasificacionesPendientes = [];

    // Los capítulos salen en el orden de la vida (infancia, colegio, universidad, trabajo), no en el que la IA los nombró.
    gruposFalsos = [
      { theme: 'El primer trabajo', story_ids: [11], etapa: 'vida_laboral', orden: 3 },
      { theme: 'La cocina', story_ids: [], etapa: 'toda_la_vida', orden: 2 },
      { theme: 'La infancia', story_ids: [10], etapa: 'infancia', orden: 1 },
    ];
    capturedAnthropicCalls = [];
    const ordenado = await request(server, { path: '/api/chapters/generate', method: 'POST', body: {} }, cookie);
    const ordenData = JSON.parse(ordenado.body);
    check('los capítulos salen en el orden de la línea de vida, no en el que los nombró la IA', ordenData.chapters.map((c) => c.theme).join('|') === 'La infancia|El primer trabajo');
    const promptAgruparOrden = capturedAnthropicCalls.find((c) => c.tool_choice && c.tool_choice.name === 'agrupar_historias_por_tema');
    check('a la IA se le pide agrupar por etapas de vida, sin mezclar colegio, universidad y trabajo, y ordenar en la línea de vida', /NO mezcles|no mezcles en un mismo tema épocas distintas/.test(promptAgruparOrden.messages[0].content) && promptAgruparOrden.messages[0].content.includes('cuándo se CONTÓ') && JSON.stringify(promptAgruparOrden.tools).includes('"orden"'));
    const promptEscribirEtapa = capturedAnthropicCalls.find((c) => c.tool_choice && c.tool_choice.name === 'escribir_capitulo');
    check('al escribir cada capítulo se le dice a qué etapa de la vida pertenece y que cuente en orden cronológico sin mezclar épocas', promptEscribirEtapa.messages[0].content.includes('etapa de su vida "infancia"') && promptEscribirEtapa.messages[0].content.includes('de lo más antiguo a lo más reciente'));
  } finally {
    server.close();
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
