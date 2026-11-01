// Preguntas que se muestran sobre cada nota de voz del libro: cuando la pregunta de Eco era corta ("¿cómo se llamaban?") un
// modelo la reescribe. Debe ir por número de bloque (no por posición) y no puede traer un tema que la nota no menciona.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const PASSWORD_HASH = bcrypt.hashSync('miclave123', 4);


const users = { 1: { id: 1, username: 'felipe', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null } };

const A1 = 'https://fake.blob/audio/1/a.webm', A2 = 'https://fake.blob/audio/1/b.webm', A3 = 'https://fake.blob/audio/1/c.webm';
const storyLog = [
  { id: 10, texto: 'Teníamos un chigüiro que se llamaba Pancho y dos conejos en el patio de la casa.', audio_url: A1 },
  { id: 11, texto: 'Mis tíos por parte de papá eran Mario, Jaime y Lucía, los tres de Cotorra.', audio_url: A2 },
  { id: 12, texto: 'Sí, claro, les echaba maíz a las gallinas todas las mañanas con mi papá.', audio_url: A3 },
];
const charla = [
  { role: 'assistant', content: 'Cuéntame de los animales de la finca. ¿Qué animales tenían?' },
  { role: 'user', content: storyLog[0].texto },
  { role: 'assistant', content: '¿Cómo se llamaban?' },
  { role: 'user', content: storyLog[1].texto },
  { role: 'assistant', content: 'Y los hermanos de tu papá Fernando, ¿quiénes eran?' },
  { role: 'user', content: storyLog[2].texto },
  { role: 'assistant', content: '¿Los alimentabas tú?' },
];
let respuestaDelModelo = () => [];
let llamadas = [];

function fakeSql(strings, ...values) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = users[1];
    return Promise.resolve(u.username === values[0] ? [{ id: u.id, username: u.username, password_hash: u.password_hash, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) { const u = users[values[0]]; return Promise.resolve(u ? [{ owner_user_id: u.owner_user_id, token_version: u.token_version }] : []); }
  if (text.includes('SELECT id, texto, audio_url, audio_urls FROM story_log WHERE user_id') && text.includes('audio_url IS NOT NULL')) return Promise.resolve(storyLog.map((s) => ({ id: s.id, texto: s.texto, audio_url: s.audio_url })));
  if (text.includes('SELECT intercambios FROM sessions WHERE user_id')) return Promise.resolve([{ intercambios: charla }]);
  if (text.includes('SELECT id, title, theme, generated_text, story_ids, persona, created_at FROM chapters WHERE user_id')) {
    return Promise.resolve([{ id: 1, title: 'Animales', theme: 'Finca', generated_text: 'x', story_ids: JSON.stringify([10, 11, 12]), persona: 'tercera', created_at: '2026-01-02T00:00:00Z' }]);
  }
  return Promise.resolve([]);
}
fakeSql.transaction = (queries) => Promise.all(queries);

require.cache[require.resolve('@neondatabase/serverless')] = { id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true, exports: { neon: () => fakeSql } };
require.cache[require.resolve('@vercel/blob')] = { id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true, exports: { put: async () => ({ url: 'https://fake.public.blob.vercel-storage.com/x' }), del: async () => {}, get: async () => null } };
require.cache[require.resolve('@anthropic-ai/sdk')] = {
  id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true,
  exports: class FakeAnthropic {
    get messages() {
      return { create: async (opts) => { llamadas.push(opts); return { content: [{ type: 'text', text: JSON.stringify(respuestaDelModelo(opts)) }], usage: { input_tokens: 1, output_tokens: 1 } }; } };
    }
  },
};

const app = require(serverPath);

function request(server, opts, cookie) {
  return new Promise((resolve, reject) => {
    const headers = { Origin: `http://127.0.0.1:${server.address().port}` };
    if (cookie) headers.Cookie = cookie;
    const data = opts.body ? JSON.stringify(opts.body) : null;
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const r = http.request({ hostname: '127.0.0.1', port: server.address().port, path: opts.path, method: opts.method || 'GET', headers }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

let pasaron = 0, fallaron = 0;
function check(nombre, cond) { if (cond) { pasaron++; console.log('OK  -', nombre); } else { fallaron++; console.log('FAIL -', nombre); } }

(async () => {
  const server = app.listen(0);
  try {
    const login = await request(server, { path: '/api/login', method: 'POST', body: { username: 'felipe', password: 'miclave123' } });
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const preguntas = async () => JSON.parse((await request(server, { path: '/api/chapters' }, cookie)).body).chapters[0].preguntas;

    // El modelo contesta en otro orden y con un tema que la nota no menciona (hermanos de Fernando) para la nota 2.
    respuestaDelModelo = () => [
      { n: 3, texto: '¿Les echabas maíz a las gallinas de la finca?' },
      { n: 1, texto: '¿Cómo se llamaban los hermanos de tu papá Fernando?' },
      { n: 2, texto: '¿Cómo se llamaban tus tíos Mario, Jaime y Lucía?' },
    ];
    const lista = await preguntas();
    const bloque = llamadas[0] && llamadas[0].messages[0].content;
    check('las notas con pregunta corta se mandan al modelo numeradas', /#1\n/.test(bloque) && /#2\n/.test(bloque));
    check('pide la respuesta con el número de bloque', /"n"/.test(llamadas[0].system));
    check('una reescritura con un tema que la nota no menciona se descarta: queda la pregunta original de Eco', lista[0] === '¿Qué animales tenían?');
    check('la reescritura que sí sale de lo que la persona contó se conserva', lista[1] === '¿Cómo se llamaban tus tíos Mario, Jaime y Lucía?');
    check('cada respuesta va a su nota aunque el modelo las devuelva en otro orden', lista[2] === '¿Les echabas maíz a las gallinas de la finca?');
  } finally { server.close(); }
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
