// "/" sirve siempre la landing con portada de foto (public/index.html) a todo el mundo: sin cookie y sin tocar la base de
// datos (Neon cobra por el tiempo encendida). La landing anterior queda abierta en /index-anterior.html, sin indexar.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';

const path = require('path');
const http = require('http');
let consultas = [];
function fakeSql(strings) {
  const text = strings.join('?');
  consultas.push(text);
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);
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
  const fs = require('fs');
  const publico = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
  const bots = [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'facebookexternalhit/1.1', 'curl/8.4.0', 'python-requests/2.31', 'UptimeRobot/2.0', '',
  ];
  for (const ua of bots.concat([CHROME])) {
    consultas = [];
    const r = await pedir(server, ua ? { 'User-Agent': ua } : {});
    ok(r.status === 200 && r.body === publico('index.html') && !r.headers['set-cookie'] && !consultas.length, `"${ua.slice(0, 28)}": recibe la landing nueva, sin cookie y sin tocar la base`);
  }
  consultas = [];
  const conCookie = await pedir(server, { 'User-Agent': CHROME, Cookie: 'bv_ab_landing=v2' });
  ok(conCookie.body === publico('index.html') && !consultas.length, 'quien tenía la cookie de la antigua prueba A/B también ve la landing nueva');

  ok(!/noindex/i.test(publico('index.html')) && /Eco — Historias que siguen vivas/.test(publico('index.html')), 'la landing nueva se puede indexar');
  for (const f of ['index-anterior.html', 'index-v2.html']) ok(/<meta name="robots" content="noindex, nofollow">/.test(publico(f)), `${f} queda abierta por su dirección pero sin indexar`);
  ok(/Conversa|portada/i.test(publico('index.html')) && publico('index.html') !== publico('index-anterior.html'), 'la landing anterior es distinta de la nueva');
  ok(!fs.existsSync(path.join(__dirname, '..', 'public', 'index-portada.html')), 'la dirección de prueba ya no existe como archivo (vercel.json la manda a "/")');
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const redir = vercel.routes.find((x) => x.src === '/index-portada.html');
  ok(redir && redir.status === 308 && redir.headers.Location === '/', 'vercel.json redirige /index-portada.html a "/"');

  server.close();
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
