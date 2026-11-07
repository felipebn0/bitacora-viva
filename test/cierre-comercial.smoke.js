// Al terminar su aporte, quien colaboró SIN cuenta (enlace abierto o personal) oye a Eco dar las gracias por colaborar
// con la historia de la persona y la invitación a empezar a contar sus propias historias («aún es gratis»).
// Esa frase va solo en lo que ve y oye: nunca en la conversación que se guarda. Quien ya tiene cuenta no la recibe.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const HASH = bcrypt.hashSync('miclave123', 4);
const users = {
  1: { id: 1, username: 'felipe', name: 'Felipe', invite_code: 'CODIGO123', password_hash: HASH, token_version: 0, owner_user_id: null },
  2: { id: 2, username: 'colab', password_hash: HASH, token_version: 0, owner_user_id: 1 },
};
const guardados = [];
const llamadas = [];
function fakeSql(strings, ...v) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = Object.values(users).find((x) => x.username === v[0]);
    return Promise.resolve(u ? [{ id: u.id, username: u.username, password_hash: u.password_hash, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) { const u = users[v[0]]; return Promise.resolve(u ? [{ owner_user_id: u.owner_user_id, token_version: u.token_version }] : []); }
  if (text.includes('SELECT id, invite_code FROM users WHERE id')) return Promise.resolve([{ id: 1, invite_code: 'CODIGO123' }]);
  if (text.includes('FROM invitados WHERE id')) return Promise.resolve([{ '?column?': 1 }]);
  if (/SELECT name, username(, tratamiento)? FROM users WHERE id/.test(text)) { const u = users[v[0]]; return Promise.resolve(u ? [{ name: u.name || null, username: u.username }] : []); }
  if (text.includes('INSERT INTO family_notes')) { guardados.push({ texto: v[2] }); return Promise.resolve([{ id: guardados.length }]); }
  if (text.includes('UPDATE family_notes SET contributor')) { guardados.push({ texto: v[2], final: true }); return Promise.resolve([{ id: 1 }]); }
  if (text.includes('SELECT aportes_pending_names FROM users WHERE id')) return Promise.resolve([{ aportes_pending_names: null }]);
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);
const cache = (mod, exports) => { require.cache[require.resolve(mod)] = { id: require.resolve(mod), filename: require.resolve(mod), loaded: true, exports }; };
cache('@neondatabase/serverless', { neon: () => fakeSql });
cache('@vercel/blob', { put: async () => ({ url: 'https://fake.public.blob.vercel-storage.com/x' }), del: async () => {}, get: async () => null, list: async () => ({ blobs: [], hasMore: false }) });
cache('@anthropic-ai/sdk', class {
  constructor() {}
  get messages() {
    return {
      create: async (opts) => {
        llamadas.push(opts);
        if (opts.tool_choice && opts.tool_choice.name === 'guardar_aporte') return { content: [{ type: 'tool_use', id: 't1', name: 'guardar_aporte', input: { parentesco: 'Amiga', texto: 'Un recuerdo pulido de la finca.' } }] };
        return { content: [{ type: 'text', text: 'Muchas gracias por colaborar con la historia de Felipe. Tu recuerdo quedó guardado.\n[FIN]' }] };
      },
    };
  }
});
const app = require(path.resolve(__dirname, '..', 'server.js'));

function pedir(server, ruta, cuerpo, cookie, metodo) {
  return new Promise((resolve, reject) => {
    const host = '127.0.0.1:' + server.address().port;
    const datos = cuerpo ? JSON.stringify(cuerpo) : null;
    const headers = { Origin: 'http://' + host };
    if (datos) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(datos); }
    if (cookie) headers.Cookie = cookie;
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path: ruta, method: metodo || 'POST', headers }, (res) => {
      const ch = []; res.on('data', (x) => ch.push(x));
      res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(ch).toString()); } catch (e) { /* nada */ } resolve({ status: res.statusCode, headers: res.headers, json }); });
    });
    r.on('error', reject); if (datos) r.write(datos); r.end();
  });
}
const firmar = (payload) => {
  const b64 = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
  return `bv_session=${b64}.${crypto.createHmac('sha256', process.env.SESSION_SECRET).update(b64).digest('base64url')}`;
};
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };
const historial = [
  { role: 'user', content: 'Recuerdo la finca de Felipe en diciembre, con toda la familia cantando alrededor de la mesa.' },
  { role: 'assistant', content: '¿Hay algo más que quieras agregar?' },
  { role: 'user', content: 'No, eso fue todo. Soy su amiga de la infancia, y fue en 1998.' },
];

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));

  const invitado = firmar({ guest: true, ownerId: 1, guestName: 'Ana Gómez', guestId: 'abc123' });
  let r = await pedir(server, '/api/contribute-chat', { history: historial }, invitado);
  ok(r.status === 200 && r.json.done === true, 'el aporte del invitado termina (done)');
  ok(/gracias por colaborar con la historia de Felipe/i.test(r.json.message), 'Eco da las gracias por colaborar con la historia de la persona');
  ok(/ingresa a mieco\.app/.test(r.json.message) && /Aún es gratis\.$/.test(r.json.message), 'y lo invita a ingresar a mieco.app, «aún es gratis»');
  ok(/ingresa a mieco\.app, o da clic en el botón de abajo\. Aún es gratis\.$/.test(r.json.message), 'después de mieco.app agrega «o da clic en el botón de abajo»');
  ok(/contar tus propias historias, o las de tus familiares/.test(r.json.message), 'habla de sus propias historias o las de sus familiares');
  ok(!/\[FIN\]/.test(r.json.message), 'sin la marca interna [FIN]');
  ok(!guardados.some((g) => /mieco\.app|aún es gratis/i.test(g.texto)), 'la frase comercial NO se guarda en la historia');
  const prompt = (llamadas.find((c) => c.system && !c.tool_choice) || {}).system || '';
  ok(/por colaborar con la historia de Felipe/.test(prompt), 'la instrucción de cierre le pide agradecer por colaborar con la historia de la persona');

  const cuenta = await pedir(server, '/api/login', { username: 'colab', password: 'miclave123' });
  const cookieCuenta = cuenta.headers['set-cookie'][0].split(';')[0];
  r = await pedir(server, '/api/contribute-chat', { history: historial }, cookieCuenta);
  ok(r.status === 200 && r.json.done === true && !/mieco\.app|gratis/i.test(r.json.message), 'quien ya tiene cuenta no recibe la invitación comercial');

  const colab = require('fs').readFileSync(path.join(__dirname, '..', 'public', 'colaborar.html'), 'utf8');
  ok(/id="ctaCrearCuenta" href="\/#registro" hidden/.test(colab) && /data\.saved && sesionEsGuest\) ctaCrearCuenta\.hidden = false/.test(colab), 'al terminar, el invitado ve un botón para empezar a contar sus historias (apunta al registro)');
  ok(/ctaCrearCuenta\.hidden = true;/.test(colab), 'el botón se oculta de nuevo al empezar otra historia');

  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
