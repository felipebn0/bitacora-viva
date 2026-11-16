// Demo pública de un minuto (/demo, demo-routes.js): sin cuenta, con topes por red y por día, y sin guardar nada de lo
// que la persona dice. La IA, la voz y la transcripción van simuladas.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.ELEVENLABS_API_KEY = 'eleven-prueba';
process.env.ELEVENLABS_VOICE_ID = 'voz-prueba';
process.env.BLOB_READ_WRITE_TOKEN = '';

const path = require('path');
const http = require('http');

const cupos = {};
const sentencias = [];
function fakeSql(strings, ...values) {
  const text = strings.join('?');
  sentencias.push(text);
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  if (text.includes('INSERT INTO demo_cupos')) {
    cupos[values[0]] = (cupos[values[0]] || 0) + 1;
    return Promise.resolve([{ cuenta: cupos[values[0]] }]);
  }
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);

const llamadasIA = [];
let respuestaIA = 'Hola, Ana. ¿Qué olor te recuerda la casa de tu abuela?';
const mod = (name, exports) => { require.cache[require.resolve(name)] = { id: require.resolve(name), filename: require.resolve(name), loaded: true, exports }; };
mod('@neondatabase/serverless', { neon: () => fakeSql });
mod('@vercel/blob', { put: async () => ({ url: 'x' }), del: async () => {}, get: async () => null });
mod('@anthropic-ai/sdk', class {
  constructor() {
    this.messages = {
      create: async (params) => {
        llamadasIA.push(params);
        return { content: [{ type: 'text', text: respuestaIA }], usage: { input_tokens: 10, output_tokens: 10 } };
      },
    };
  }
});
const fetchReal = global.fetch;
const llamadasFetch = [];
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('https://api.elevenlabs.io/v1/text-to-speech')) {
    llamadasFetch.push('tts');
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]).buffer, text: async () => '' };
  }
  if (u.startsWith('https://api.elevenlabs.io/v1/speech-to-text')) {
    llamadasFetch.push('stt');
    return { ok: true, status: 200, json: async () => ({ text: 'Mi abuela hacía arepas los domingos' }) };
  }
  return fetchReal(url, opts);
};
const app = require(path.resolve(__dirname, '..', 'server.js'));

let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.log('FAIL - ' + m); } };
function request(server, opts) {
  return new Promise((resolve, reject) => {
    const crudo = Buffer.isBuffer(opts.body);
    const data = opts.body ? (crudo ? opts.body : JSON.stringify(opts.body)) : null;
    const headers = Object.assign({}, opts.headers || {});
    if (data) { headers['Content-Type'] = headers['Content-Type'] || 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    headers.Origin = `http://127.0.0.1:${server.address().port}`;
    if (opts.ip) headers['X-Forwarded-For'] = opts.ip;
    const r = http.request({ hostname: '127.0.0.1', port: server.address().port, path: opts.path, method: opts.method || 'GET', headers }, (res) => {
      let b = ''; res.on('data', (c) => (b += c));
      res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch (e) { /* no json */ } resolve({ status: res.statusCode, headers: res.headers, body: b, json }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
function wav() {
  const n = 4000;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}

(async () => {
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    let r = await request(server, { path: '/demo' });
    ok(r.status === 200 && /Charla un minuto con Eco/.test(r.body), '/demo sirve la página');

    r = await request(server, { path: '/api/demo/empezar', method: 'POST', body: { nombre: '   ' }, ip: '10.0.0.1' });
    ok(r.status === 400, 'sin nombre no arranca');

    r = await request(server, { path: '/api/demo/empezar', method: 'POST', body: { nombre: 'Ana <b>María</b>' }, ip: '10.0.0.1' });
    ok(r.status === 200 && typeof r.json.token === 'string', 'con nombre arranca y devuelve un token');
    const token = r.json.token;

    r = await request(server, { path: '/api/demo/turno', method: 'POST', body: { token, history: [] }, ip: '10.0.0.1' });
    ok(r.status === 200 && r.json.texto === respuestaIA, 'el primer turno trae el saludo de Eco');
    ok(typeof r.json.audio === 'string' && r.json.audio.length > 0, 'y su voz');
    const primera = llamadasIA[llamadasIA.length - 1];
    ok(/MODO PRUEBA DE UN MINUTO/.test(primera.system[0].text) && !/Ana/.test(primera.system[0].text), 'instrucciones de la demo iguales para todos (el nombre no va ahí)');
    ok(/se llama Ana b María \/b/.test(primera.messages[0].content), 'el nombre llega limpio a la IA, sin símbolos raros');

    r = await request(server, { path: '/api/demo/transcribir', method: 'POST', body: wav(), headers: { 'Content-Type': 'audio/wav', 'X-Demo-Token': token }, ip: '10.0.0.1' });
    ok(r.status === 200 && r.json.text === 'Mi abuela hacía arepas los domingos', 'transcribe lo que dijo la persona');
    r = await request(server, { path: '/api/demo/transcribir', method: 'POST', body: wav(), headers: { 'Content-Type': 'audio/wav' }, ip: '10.0.0.1' });
    ok(r.status === 401, 'sin token no transcribe');
    r = await request(server, { path: '/api/demo/transcribir', method: 'POST', body: Buffer.from('esto no es audio para nada, solo texto'), headers: { 'Content-Type': 'audio/wav', 'X-Demo-Token': token }, ip: '10.0.0.1' });
    ok(r.status === 400, 'algo que no es audio se rechaza');

    const historia = [{ role: 'assistant', content: respuestaIA }, { role: 'user', content: 'Mi abuela hacía arepas los domingos' }];
    respuestaIA = 'Gracias, Ana. Con tu cuenta gratis Eco sigue charlando contigo. Crea tu cuenta con el botón. [FIN]';
    r = await request(server, { path: '/api/demo/turno', method: 'POST', body: { token, history: historia, fin: true }, ip: '10.0.0.1' });
    const cierre = llamadasIA[llamadasIA.length - 1];
    ok(r.status === 200 && r.json.fin === true && !/\[FIN\]/.test(r.json.texto), 'el cierre llega sin marcas internas');
    ok(/Se acabó el minuto de prueba/.test(cierre.messages[cierre.messages.length - 1].content), 'el cierre le pide a Eco el pitch');

    ok(cierre.max_tokens <= 150, 'la despedida es corta (no hace esperar al final)');

    const ttsAntes = llamadasFetch.filter((x) => x === 'tts').length;
    r = await request(server, { path: '/api/demo/pitch', method: 'POST', body: { token }, ip: '10.0.0.1' });
    ok(r.status === 200 && /Crea tu cuenta/.test(r.json.texto) && typeof r.json.audio === 'string', 'el pitch final llega con su voz');
    await request(server, { path: '/api/demo/pitch', method: 'POST', body: { token }, ip: '10.0.0.1' });
    ok(llamadasFetch.filter((x) => x === 'tts').length === ttsAntes + 1, 'la voz del pitch se genera una sola vez y se reutiliza');
    r = await request(server, { path: '/api/demo/pitch', method: 'POST', body: { token: 'nada' }, ip: '10.0.0.1' });
    ok(r.status === 401, 'sin token no hay pitch');

    r = await request(server, { path: '/api/demo/turno', method: 'POST', body: { token: token.slice(0, -2) + 'xx', history: [] }, ip: '10.0.0.1' });
    ok(r.status === 401, 'un token alterado no sirve');
    const [b64, firma] = token.split('.');
    const datos = JSON.parse(Buffer.from(b64, 'base64url').toString());
    const viejo = Buffer.from(JSON.stringify(Object.assign({}, datos, { iat: Date.now() - 10 * 60 * 1000 }))).toString('base64url') + '.' + firma;
    r = await request(server, { path: '/api/demo/turno', method: 'POST', body: { token: viejo, history: [] }, ip: '10.0.0.1' });
    ok(r.status === 401, 'un token con otra fecha no sirve');

    r = await request(server, { path: '/api/me', headers: { Cookie: 'session=' + token } });
    ok(r.status !== 200 || !(r.json && r.json.userId), 'el token de la demo no sirve como sesión');

    const largo = [];
    for (let i = 0; i < 9; i++) largo.push({ role: 'user', content: 'hola' }, { role: 'assistant', content: 'cuéntame' });
    r = await request(server, { path: '/api/demo/turno', method: 'POST', body: { token, history: largo }, ip: '10.0.0.1' });
    ok(r.status === 429, 'una charla demasiado larga se corta');

    await request(server, { path: '/api/demo/empezar', method: 'POST', body: { nombre: 'Ana' }, ip: '10.0.0.1' });
    await request(server, { path: '/api/demo/empezar', method: 'POST', body: { nombre: 'Ana' }, ip: '10.0.0.1' });
    r = await request(server, { path: '/api/demo/empezar', method: 'POST', body: { nombre: 'Ana' }, ip: '10.0.0.1' });
    ok(r.status === 429 && r.json.motivo === 'limite', 'la cuarta demo del día desde la misma red se frena');
    r = await request(server, { path: '/api/demo/empezar', method: 'POST', body: { nombre: 'Luis' }, ip: '10.0.0.2' });
    ok(r.status === 200, 'otra red sí puede');
    ok(!Object.keys(cupos).some((k) => k.includes('10.0.0')), 'la IP no se guarda tal cual');

    cupos.total = 200;
    r = await request(server, { path: '/api/demo/empezar', method: 'POST', body: { nombre: 'Rosa' }, ip: '10.0.0.3' });
    ok(r.status === 429 && r.json.motivo === 'cupo', 'pasadas 200 demos en el día ya no arranca ninguna');

    ok(!sentencias.some((s) => /INSERT INTO (story_log|sessions|usage_events|media)/.test(s)), 'no se guarda nada de la charla');

    process.env.DEMO_DESACTIVADA = '1';
    r = await request(server, { path: '/api/demo/empezar', method: 'POST', body: { nombre: 'Ana' }, ip: '10.0.0.9' });
    ok(r.status === 503, 'DEMO_DESACTIVADA=1 la apaga');
    delete process.env.DEMO_DESACTIVADA;
  } catch (e) {
    fallaron++; console.error(e);
  } finally {
    server.close();
    console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
    process.exit(fallaron ? 1 : 0);
  }
})();
