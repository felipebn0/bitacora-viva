// Al registrarse, la persona recibe un correo de bienvenida que explica cómo funciona Eco y la lleva a contar su
// primera historia. Si el correo falla o no hay remitente propio, el registro funciona igual.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';
process.env.RESEND_API_KEY = 're_prueba';
process.env.RESEND_FROM = 'Eco <hola@mieco.app>';
process.env.PUBLIC_BASE_URL = 'PUBLIC_BASE_URL=https://bitacora-viva.vercel.app';

const path = require('path');
const http = require('http');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const users = [{ id: 1, email: 'dueña@ejemplo.com', owner_user_id: null }];
let siguienteId = 10;
const correos = [];
let fallarCorreo = false;

function fakeSql(strings, ...v) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('SELECT id FROM users WHERE email =')) return Promise.resolve(users.filter((u) => u.email === v[0]).map((u) => ({ id: u.id })));
  if (text.includes('SELECT id FROM users WHERE invite_code')) return Promise.resolve([{ id: 1 }]);
  if (text.includes('INSERT INTO users (username, name, email')) {
    const u = { id: siguienteId++, email: v[2], owner_user_id: v[5] };
    users.push(u);
    return Promise.resolve([{ id: u.id, username: v[0], token_version: 0 }]);
  }
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);
const cache = (mod, exports) => { require.cache[require.resolve(mod)] = { id: require.resolve(mod), filename: require.resolve(mod), loaded: true, exports }; };
cache('@neondatabase/serverless', { neon: () => fakeSql });
cache('@vercel/blob', { put: async () => ({ url: 'x' }), del: async () => {}, list: async () => ({ blobs: [], hasMore: false }), get: async () => null });
cache('@anthropic-ai/sdk', class { constructor() {} });
const fetchReal = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).startsWith('https://api.resend.com/')) {
    if (fallarCorreo) return { ok: false, status: 500, text: async () => 'boom', json: async () => ({}) };
    correos.push(JSON.parse(opts.body));
    return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
  }
  return fetchReal(url, opts);
};
const app = require(serverPath);

function registrar(server, extra) {
  return new Promise((resolve, reject) => {
    const host = '127.0.0.1:' + server.address().port;
    const cuerpo = JSON.stringify(Object.assign({ name: 'maria perez', email: 'maria@ejemplo.com', phone: '+57 300 123 4567', password: 'miclave123', acceptTerms: true }, extra));
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/signup', method: 'POST', headers: { Origin: 'http://' + host, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(cuerpo) } }, (res) => {
      const ch = []; res.on('data', (x) => ch.push(x)); res.on('end', () => resolve({ status: res.statusCode }));
    });
    r.on('error', reject); r.write(cuerpo); r.end();
  });
}
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));

  let r = await registrar(server);
  ok(r.status === 200 && correos.length === 1, 'al registrarse se envía un correo');
  const c = correos[0];
  ok(c.to[0] === 'maria@ejemplo.com' && c.from === 'Eco <hola@mieco.app>', 'va al correo de la persona, desde el remitente de Eco');
  ok(/bienvenida/i.test(c.subject) && /primera historia/i.test(c.subject), 'el asunto da la bienvenida y habla de la primera historia');
  ok(/Hola, Maria\./.test(c.html), 'saluda por su primer nombre');
  ok(/Presiona el círculo/.test(c.html) && /Cuéntale con tu voz/.test(c.html) && /queda guardada/.test(c.html), 'explica cómo funciona en tres pasos');
  const href = c.html.match(/href="([^"]+)"/)[1];
  ok(href === 'https://mieco.app/app.html', 'el botón lleva a la app en mieco.app aunque PUBLIC_BASE_URL venga mal pegada');
  ok(/Contar mi primera historia/.test(c.html) && /bgcolor="#4F5D3A"/.test(c.html), 'el botón pide contar la primera historia y tiene fondo que Outlook respeta');
  ok(typeof c.text === 'string' && c.text.includes('https://mieco.app/app.html'), 'incluye versión en texto con el enlace');

  correos.length = 0;
  r = await registrar(server, { email: 'otra@ejemplo.com', name: '<b>Ana</b> Gómez' });
  ok(r.status === 200 && !/<b>ana/i.test(correos[0].html) && /&lt;b&gt;ana/i.test(correos[0].html), 'el nombre se escapa (no entra HTML ajeno al correo)');

  correos.length = 0;
  r = await registrar(server, { email: 'ingles@ejemplo.com', idioma: 'en' });
  ok(r.status === 200 && /Welcome to Eco/.test(correos[0].subject) && /Tell my first story/.test(correos[0].html), 'si la cuenta es en inglés, el correo sale en inglés');

  correos.length = 0;
  r = await registrar(server, { email: 'colab@ejemplo.com', accountType: 'collaborator', inviteCode: 'ABCD1234' });
  ok(r.status === 200 && correos.length === 0, 'una colaboradora (se une con código de familia) no recibe este correo');

  fallarCorreo = true;
  r = await registrar(server, { email: 'falla@ejemplo.com' });
  ok(r.status === 200, 'si el envío falla, el registro igual funciona');

  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
