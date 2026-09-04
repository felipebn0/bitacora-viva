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

function fakeSql(strings, ...values) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = users[1];
    return Promise.resolve(u.username === values[0] ? [{ id: u.id, username: u.username, password_hash: u.password_hash, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ owner_user_id: u.owner_user_id, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT id, texto, created_at FROM story_log WHERE user_id')) {
    return Promise.resolve(storyLog.map((s) => ({ id: s.id, texto: s.texto, created_at: '2026-01-01T00:00:00Z' })));
  }
  if (text.includes('SELECT id, audio_url FROM story_log WHERE user_id') && text.includes('audio_url IS NOT NULL')) {
    return Promise.resolve(storyLog.filter((s) => s.audio_url).map((s) => ({ id: s.id, audio_url: s.audio_url })));
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
            return { content: [{ type: 'tool_use', id: 't1', name: toolName, input: { grupos: [{ theme: 'La infancia', story_ids: [10, 11] }] } }] };
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

    const lista = await request(server, { path: '/api/chapters' }, cookie);
    check('GET /api/chapters -> 200', lista.status === 200);
    const listaData = JSON.parse(lista.body);
    check('el capítulo trae el audio de la historia que sí tenía (id 10)', JSON.stringify(listaData.chapters[0].audios) === JSON.stringify(['https://fake.blob/audio/1/a.webm']));
    check('NO trae null por la historia sin audio (id 11) — se filtra, no se cuela', listaData.chapters[0].audios.length === 1);

    // --- Default: sin mandar "persona", narra en tercera ---
    capturedAnthropicCalls = [];
    const genDefault = await request(server, { path: '/api/chapters/generate', method: 'POST', body: {} }, cookie);
    check('chapters/generate sin persona -> 200', genDefault.status === 200);
    const promptDefault = capturedAnthropicCalls.find((c) => c.tool_choice && c.tool_choice.name === 'escribir_capitulo');
    check('sin especificar, narra en tercera persona (compatibilidad con lo de antes)', promptDefault.messages[0].content.includes('tercera persona') && !promptDefault.messages[0].content.includes('PRIMERA persona'));
  } finally {
    server.close();
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
