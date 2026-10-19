// La landing no debe despertar la base de datos por culpa de robots, ni revisar todas las tablas
// cada vez que llega una persona nueva.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';

const path = require('path');
const http = require('http');
let consultas = [];
let transacciones = 0;
let fallarConTablaInexistente = false;
function fakeSql(strings) {
  const text = strings.join('?');
  consultas.push(text);
  if (text.includes('INSERT INTO ab_landing_counters') && fallarConTablaInexistente) {
    fallarConTablaInexistente = false;
    return Promise.reject(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
  }
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => { transacciones++; return Promise.all(q); };
const cache = (mod, exports) => { require.cache[require.resolve(mod)] = { id: require.resolve(mod), filename: require.resolve(mod), loaded: true, exports }; };
cache('@neondatabase/serverless', { neon: () => fakeSql });
cache('@anthropic-ai/sdk', class { constructor() {} });
const app = require(path.resolve(__dirname, '..', 'server.js'));

function pedir(server, headers) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path: '/', method: 'GET', headers }, (res) => {
      const ch = []; res.on('data', (x) => ch.push(x)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(ch).toString() }));
    });
    r.on('error', reject); r.end();
  });
}

let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };
const CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  const bots = [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'facebookexternalhit/1.1', 'curl/8.4.0', 'python-requests/2.31', 'UptimeRobot/2.0', '',
  ];
  for (const ua of bots) {
    consultas = [];
    const r = await pedir(server, ua ? { 'User-Agent': ua } : {});
    ok(r.status === 200 && /<html/i.test(r.body) && !r.headers['set-cookie'] && !consultas.length, `robot "${ua.slice(0, 28)}": recibe la página, sin cookie y sin tocar la base`);
  }

  consultas = []; transacciones = 0;
  let r = await pedir(server, { 'User-Agent': CHROME });
  ok(r.status === 200 && /bv_ab_landing=v[12]/.test(String(r.headers['set-cookie'])), 'una persona nueva recibe su versión A/B');
  ok(consultas.filter((q) => q.includes('INSERT INTO ab_landing_counters')).length === 1, 'y se cuenta una sola vez');
  ok(transacciones === 0, 'sin revisar todas las tablas para contarla');

  consultas = [];
  r = await pedir(server, { 'User-Agent': CHROME, Cookie: 'bv_ab_landing=v2' });
  ok(r.status === 200 && !consultas.length, 'quien ya tiene la cookie no toca la base');

  consultas = []; transacciones = 0; fallarConTablaInexistente = true;
  r = await pedir(server, { 'User-Agent': CHROME });
  ok(r.status === 200 && transacciones === 1 && consultas.filter((q) => q.includes('INSERT INTO ab_landing_counters')).length === 2, 'si la tabla no existe todavía, entonces sí se crea y se cuenta');

  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
