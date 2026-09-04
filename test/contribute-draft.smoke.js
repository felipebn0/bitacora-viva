// Smoke test para el guardado incremental de /api/contribute-chat: lo que
// el colaborador va contando se guarda turno a turno (family_notes con
// en_progreso=true), no recién al final de toda la charla — así si
// abandona a mitad de camino no se pierde lo que ya narró. Al terminar
// ([FIN]), esa MISMA fila se actualiza con el texto pulido por la IA
// (en_progreso=false), no se crea una fila aparte.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const PASSWORD_HASH = bcrypt.hashSync('miclave123', 4);

// A: dueña de la bitácora. B: colaboradora fija (owner_user_id=1).
const users = {
  1: { id: 1, username: 'duena', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null },
  2: { id: 2, username: 'colab', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: 1 },
};

let familyNotesTable = [];
let nextId = 1;
let capturedAnthropicCalls = [];

function fakeSql(strings, ...values) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = Object.values(users).find((x) => x.username === values[0]);
    return Promise.resolve(u ? [{ id: u.id, username: u.username, password_hash: u.password_hash, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ owner_user_id: u.owner_user_id, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT name, username FROM users WHERE id')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ name: null, username: u.username }] : []);
  }
  if (text.includes('SELECT descripcion, anio, categoria FROM timeline_events')) return Promise.resolve([]);
  if (text.includes('INSERT INTO family_notes')) {
    // (user_id, contributor, texto, audio_urls, contributed_by, protagonista) — "en_progreso"
    // va literal (true) en el propio texto de la consulta, no como parámetro.
    const [userId, contributor, texto, audioUrls, contributedBy, protagonista] = values;
    const row = { id: nextId++, user_id: userId, contributor, parentesco: null, texto, audio_urls: audioUrls, contributed_by: contributedBy, protagonista, en_progreso: true };
    familyNotesTable.push(row);
    return Promise.resolve([{ id: row.id }]);
  }
  if (text.includes('UPDATE family_notes SET texto') && text.includes('en_progreso = true')) {
    // borrador: (texto, audio_urls, protagonista, id, user_id)
    const [texto, audioUrls, protagonista, id, userId] = values;
    const row = familyNotesTable.find((r) => r.id === id && r.user_id === userId && r.en_progreso);
    if (row) { row.texto = texto; row.audio_urls = audioUrls; row.protagonista = protagonista; }
    return Promise.resolve(row ? [{ id: row.id }] : []);
  }
  if (text.includes('UPDATE family_notes SET contributor') && text.includes('en_progreso = false')) {
    // final: (contributor, parentesco, texto, audio_urls, protagonista, id, user_id)
    const [contributor, parentesco, texto, audioUrls, protagonista, id, userId] = values;
    const row = familyNotesTable.find((r) => r.id === id && r.user_id === userId);
    if (row) { row.contributor = contributor; row.parentesco = parentesco; row.texto = texto; row.audio_urls = audioUrls; row.protagonista = protagonista; row.en_progreso = false; }
    return Promise.resolve(row ? [{ id: row.id }] : []);
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
// Turno 1 (historial vacío): saluda. Turno 2 (ya contó la historia): pide
// aclaración de parentesco/año. Turno 3: pregunta si hay algo más. Turno 4:
// cierra con [FIN].
let turno = 0;
require.cache[require.resolve('@anthropic-ai/sdk')] = {
  id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true,
  exports: class FakeAnthropic {
    constructor() {}
    get messages() {
      return {
        create: async (opts) => {
          capturedAnthropicCalls.push(opts);
          if (opts.tool_choice && opts.tool_choice.name === 'guardar_aporte') {
            return { content: [{ type: 'tool_use', id: 't1', name: 'guardar_aporte', input: { parentesco: 'Hija', texto: 'Un recuerdo de la finca en los años 80, ya pulido por la IA.' } }] };
          }
          turno++;
          if (turno === 1) return { content: [{ text: '¡Hola! Cuéntame tu historia.' }] };
          if (turno === 2) return { content: [{ text: '¿Y en qué época fue eso?\n[FALTA_DATO]' }] };
          if (turno === 3) return { content: [{ text: '¿Hay algo más que quieras agregar?' }] };
          return { content: [{ text: 'Gracias por contarme. La historia quedó guardada.\n[FIN]' }] };
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
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
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
    const cookie = await login(server, 'colab');

    // Turno 1: saludo — historial vacío, no hay nada que guardar todavía.
    const t1 = await request(server, { path: '/api/contribute-chat', method: 'POST', body: { history: [] } }, cookie);
    check('turno 1 (saludo) -> 200', t1.status === 200);
    const d1 = JSON.parse(t1.body);
    check('turno 1 no crea borrador (nada contado aún)', !d1.draftId);
    check('todavía no hay ninguna fila en family_notes', familyNotesTable.length === 0);

    // Turno 2: el colaborador ya contó su historia -> se guarda un borrador.
    const historial2 = [{ role: 'user', content: 'Recuerdo que en la finca de mi abuela nos íbamos a bañar al río todos los veranos.' }];
    const t2 = await request(server, { path: '/api/contribute-chat', method: 'POST', body: { history: historial2, draftId: null } }, cookie);
    check('turno 2 -> 200', t2.status === 200);
    const d2 = JSON.parse(t2.body);
    check('turno 2 crea un borrador (draftId)', Number.isInteger(d2.draftId));
    check('se creó una sola fila en family_notes', familyNotesTable.length === 1);
    check('la fila quedó marcada en_progreso=true', familyNotesTable[0].en_progreso === true);
    check('el texto crudo del borrador es lo que contó, no está vacío', familyNotesTable[0].texto.includes('bañar al río'));
    check('pidió el dato que faltaba (needsBasicInfo)', d2.needsBasicInfo === true);

    // Turno 3: responde la aclaración -> se actualiza el MISMO borrador, no uno nuevo.
    const historial3 = historial2.concat([
      { role: 'assistant', content: d2.message },
      { role: 'user', content: 'Fue en 1985.' },
    ]);
    const t3 = await request(server, { path: '/api/contribute-chat', method: 'POST', body: { history: historial3, draftId: d2.draftId } }, cookie);
    const d3 = JSON.parse(t3.body);
    check('turno 3 sigue con el mismo draftId (no crea uno nuevo)', d3.draftId === d2.draftId);
    check('sigue habiendo una sola fila en family_notes', familyNotesTable.length === 1);
    check('el borrador ya incluye la aclaración del año', familyNotesTable[0].texto.includes('1985'));

    // Turno 4: [FIN] -> se limpia con la IA y se actualiza esa MISMA fila.
    const historial4 = historial3.concat([
      { role: 'assistant', content: d3.message },
      { role: 'user', content: 'No, eso fue todo.' },
    ]);
    const t4 = await request(server, { path: '/api/contribute-chat', method: 'POST', body: { history: historial4, draftId: d3.draftId } }, cookie);
    const d4 = JSON.parse(t4.body);
    check('turno final -> done y saved', d4.done === true && d4.saved === true);
    check('sigue habiendo una sola fila (se actualizó, no se duplicó)', familyNotesTable.length === 1);
    check('la fila final quedó en_progreso=false', familyNotesTable[0].en_progreso === false);
    check('la fila final tiene el texto pulido por la IA (guardar_aporte)', familyNotesTable[0].texto.includes('pulido por la IA'));
    check('la fila final tiene el parentesco extraído', familyNotesTable[0].parentesco === 'Hija');
  } finally {
    server.close();
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
