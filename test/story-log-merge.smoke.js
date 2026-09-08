// Smoke test para POST /api/story-log/merge (BACKLOG: auditoría de Diego,
// 2026-09-08, punto 3 "agrupar historias detectadas") — una historia
// contada en varios turnos de la misma charla podía quedar como varias
// filas separadas en story_log, cada una con su propio audio. Esta ruta las
// une en una sola: texto en orden cronológico, TODOS los audios y fotos, y
// borra las filas que sobran. Cubre aislamiento entre familias, que un
// colaborador no puede unir nada, y los casos de error (menos de 2 ids, un
// id que no existe o no es de esta bitácora).
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const PASSWORD_HASH = bcrypt.hashSync('miclave123', 4);

// A: dueña de su bitácora. B: otra familia (aislamiento). C: colaboradora
// fija de A (owner_user_id=1) — nunca puede unir nada (bloquearColaborador).
const users = {
  1: { id: 1, username: 'felipe', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null },
  2: { id: 2, username: 'otrafamilia', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null },
  3: { id: 3, username: 'colab', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: 1 },
};

let nextId = 100;
const storyLog = {
  1: [
    { id: nextId++, texto: 'Mi primer trabajo fue en una tienda de telas.', audio_url: 'https://fake.blob/audio/1/a.webm', audio_urls: null, media_urls: null, created_at: '2024-01-01T10:00:00Z' },
    { id: nextId++, texto: 'Tenía como 18 años cuando empecé ahí.', audio_url: 'https://fake.blob/audio/1/b.webm', audio_urls: null, media_urls: JSON.stringify([{ url: 'https://fake.blob/media/1/foto.jpg', type: 'foto', caption: null }]), created_at: '2024-01-01T10:05:00Z' },
    { id: nextId++, texto: 'Los sábados se llenaba de gente para la feria.', audio_url: null, audio_urls: null, media_urls: null, created_at: '2024-01-01T10:10:00Z' },
    { id: nextId++, texto: 'Historia completamente distinta, de otro día.', audio_url: 'https://fake.blob/audio/1/c.webm', audio_urls: null, media_urls: null, created_at: '2024-02-01T09:00:00Z' },
  ],
  2: [
    { id: nextId++, texto: 'Historia de la cuenta B que A nunca debería poder tocar.', audio_url: null, audio_urls: null, media_urls: null, created_at: '2024-01-01T10:00:00Z' },
  ],
};

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

  if (text.includes('SELECT id, texto, audio_url, audio_urls, media_urls, created_at FROM story_log WHERE user_id')) {
    const userId = values[0];
    const filas = storyLog[userId] || [];
    if (text.includes('AND id =')) {
      const id = values[1];
      const fila = filas.find((f) => f.id === id);
      return Promise.resolve(fila ? [{ ...fila }] : []);
    }
    return Promise.resolve(
      filas.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map((f) => ({ ...f }))
    );
  }
  if (text.includes('UPDATE story_log SET texto')) {
    const [texto, audioUrl, audioUrlsJson, mediaUrlsJson, id] = values;
    for (const userId of Object.keys(storyLog)) {
      const fila = storyLog[userId].find((f) => f.id === id);
      if (fila) {
        fila.texto = texto;
        fila.audio_url = audioUrl;
        fila.audio_urls = audioUrlsJson;
        fila.media_urls = mediaUrlsJson;
      }
    }
    return Promise.resolve([]);
  }
  if (text.includes('DELETE FROM story_log WHERE id') && text.includes('AND user_id')) {
    const [id, userId] = values;
    if (storyLog[userId]) storyLog[userId] = storyLog[userId].filter((f) => f.id !== id);
    return Promise.resolve([]);
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
    const cookieFelipe = await login(server, 'felipe');
    const cookieOtra = await login(server, 'otrafamilia');
    const cookieColab = await login(server, 'colab');

    const idsDeA = storyLog[1].map((f) => f.id);
    const [id1, id2, id3, id4] = idsDeA;

    // --- Validaciones -----------------------------------------------------
    const sinIds = await request(server, { path: '/api/story-log/merge', method: 'POST', body: {} }, cookieFelipe);
    check('sin ids -> 400', sinIds.status === 400);

    const unSoloId = await request(server, { path: '/api/story-log/merge', method: 'POST', body: { ids: [id1] } }, cookieFelipe);
    check('con un solo id -> 400 (hacen falta 2 o más)', unSoloId.status === 400);

    const idInexistente = await request(server, { path: '/api/story-log/merge', method: 'POST', body: { ids: [id1, 999999] } }, cookieFelipe);
    check('con un id que no existe -> 404', idInexistente.status === 404);

    const idDeOtraFamilia = await request(server, { path: '/api/story-log/merge', method: 'POST', body: { ids: [id1, idsDeA.length ? storyLog[2][0].id : -1] } }, cookieFelipe);
    check('con un id de OTRA familia -> 404 (no 200, no filtra ni mezcla)', idDeOtraFamilia.status === 404);
    check('con un id de otra familia -> esa historia de B sigue intacta', storyLog[2].length === 1);

    const comoColaboradora = await request(server, { path: '/api/story-log/merge', method: 'POST', body: { ids: [id1, id2] } }, cookieColab);
    check('una colaboradora no puede unir nada -> 403 (bloquearColaborador)', comoColaboradora.status === 403);
    check('el 403 de la colaboradora no tocó nada -> A sigue con sus 4 historias', storyLog[1].length === 4);

    // --- Unir de verdad: las 3 primeras (misma charla), la 4ª queda aparte -
    const merge = await request(server, { path: '/api/story-log/merge', method: 'POST', body: { ids: [id3, id1, id2] } }, cookieFelipe);
    check('unir 3 historias de A -> 200', merge.status === 200);
    const mergeBody = JSON.parse(merge.body);
    check('el texto unido queda en orden cronológico (la más vieja primero)', mergeBody.texto.indexOf('tienda de telas') < mergeBody.texto.indexOf('18 años') && mergeBody.texto.indexOf('18 años') < mergeBody.texto.indexOf('feria'));
    check('el audio principal es el de la historia más vieja', mergeBody.audio_url === 'https://fake.blob/audio/1/a.webm');
    check('el segundo audio quedó en audio_urls', Array.isArray(mergeBody.audio_urls) && mergeBody.audio_urls.includes('https://fake.blob/audio/1/b.webm'));
    check('la foto de la 2ª historia se conservó', Array.isArray(mergeBody.media_urls) && mergeBody.media_urls.some((m) => m.url === 'https://fake.blob/media/1/foto.jpg'));

    check('quedan solo 2 historias para A (la unida + la que era de otro día)', storyLog[1].length === 2);
    check('la historia de "otro día" (id4) sigue intacta, sin tocar', storyLog[1].some((f) => f.id === id4 && f.texto === 'Historia completamente distinta, de otro día.'));

    const listaFinal = await request(server, { path: '/api/story-log' }, cookieFelipe);
    const listaFinalBody = JSON.parse(listaFinal.body);
    check('GET /api/story-log ya no muestra las 3 filas viejas por separado', listaFinalBody.stories.length === 2);
  } finally {
    server.close();
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
