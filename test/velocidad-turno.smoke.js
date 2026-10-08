// Velocidad del turno (pedido de Felipe, 2026-10-08: "se demora mucho desde que
// uno habla hasta que la IA vuelve y habla"). Cubre lo que se cambió:
//   - POST /api/story-log/audio: enlaza el audio con la historia DESPUÉS de que
//     /api/next ya contestó (la subida ya no bloquea a la IA),
//   - /api/speak tiene su propio cupo de pedidos (clave "voz:", 120/min) para
//     poder pedir dos pedazos de voz por turno,
//   - Server-Timing + línea [latencia] en las rutas del turno,
//   - el cliente: no recodifica a WAV, sube el audio en paralelo, parte la voz.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.BLOB_READ_WRITE_TOKEN = '';
process.env.ELEVENLABS_API_KEY = 'clave-de-prueba';
process.env.ELEVENLABS_VOICE_ID = 'voz123';

const fs = require('fs');
const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const users = { 1: { id: 1, username: 'duena', password_hash: bcrypt.hashSync('miclave123', 4), token_version: 0, owner_user_id: null } };

const AUDIO_PROPIO = 'https://viejo.public.blob.vercel-storage.com/audio/1/sesion-1/user-1-abc.webm';
const AUDIO_AJENO = 'https://viejo.public.blob.vercel-storage.com/audio/2/sesion-9/user-1-xyz.webm';
let storyLog = [];
const clavesRateLimit = [];
let conteoRateLimit = 1;

function fakeSql(strings, ...values) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('INSERT INTO rate_limits')) { clavesRateLimit.push(values[0]); return Promise.resolve([{ count: conteoRateLimit }]); }
  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = Object.values(users).find((x) => x.username === values[0]);
    return Promise.resolve(u ? [{ id: u.id, username: u.username, password_hash: u.password_hash, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ owner_user_id: u.owner_user_id, token_version: u.token_version }] : []);
  }
  if (text.includes('UPDATE story_log SET audio_url')) {
    const [url, userId, texto] = values;
    const fila = storyLog.filter((r) => r.user_id === userId && r.texto === texto && !r.audio_url).sort((a, b) => b.id - a.id)[0];
    if (!fila) return Promise.resolve([]);
    fila.audio_url = url;
    return Promise.resolve([{ id: fila.id }]);
  }
  return Promise.resolve([]);
}
fakeSql.transaction = (q) => Promise.all(q);

const fetchOriginal = global.fetch;
global.fetch = async (url, opts = {}) => {
  const u = typeof url === 'string' ? url : (url && url.url) || String(url);
  if (u.startsWith('https://api.elevenlabs.io/v1/text-to-speech/')) return new Response(Buffer.from('audio-falso'), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
  return fetchOriginal(url, opts);
};
require.cache[require.resolve('@neondatabase/serverless')] = { id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true, exports: { neon: () => fakeSql } };
require.cache[require.resolve('@vercel/blob')] = { id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true, exports: { put: async () => ({ url: 'x' }), del: async () => {}, get: async () => null, list: async () => ({ blobs: [], hasMore: false }) } };
require.cache[require.resolve('@anthropic-ai/sdk')] = { id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true, exports: class { constructor() {} } };
const app = require(serverPath);

function llamar(server, metodo, pth, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { Origin: `http://127.0.0.1:${server.address().port}` };
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    if (cookie) headers.Cookie = cookie;
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path: pth, method: metodo, headers }, (res) => {
      const ch = []; res.on('data', (c) => ch.push(c));
      res.on('end', () => { const t = Buffer.concat(ch).toString(); let j = null; try { j = JSON.parse(t); } catch (e) {} resolve({ status: res.statusCode, headers: res.headers, json: j }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

(async () => {
  const logs = [];
  const logOriginal = console.log;
  console.log = (...a) => { logs.push(a.join(' ')); logOriginal(...a); };
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  const login = await llamar(server, 'POST', '/api/login', { username: 'duena', password: 'miclave123' });
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  const enlazar = (body, c = cookie) => llamar(server, 'POST', '/api/story-log/audio', body, c);

  // --- /api/story-log/audio ---
  storyLog = [{ id: 1, user_id: 1, texto: 'Nací en Bogotá, en una casa grande con mis abuelos.', audio_url: null }];
  const sinSesion = await enlazar({ text: 'x', audioUrl: AUDIO_PROPIO }, null);
  ok(sinSesion.status === 401, 'enlazar audio: sin sesión -> 401');
  const sinDatos = await enlazar({ text: '', audioUrl: AUDIO_PROPIO });
  ok(sinDatos.status === 400, 'enlazar audio: sin texto -> 400');
  const urlMala = await enlazar({ text: 'hola', audioUrl: 'https://malo.example.com/audio/1/x.webm' });
  ok(urlMala.status === 400, 'enlazar audio: URL de un host que no es nuestro -> 400');
  const ajeno = await enlazar({ text: 'Nací en Bogotá, en una casa grande con mis abuelos.', audioUrl: AUDIO_AJENO });
  ok(ajeno.status === 403, 'enlazar audio: archivo de OTRA bitácora -> 403');
  ok(storyLog[0].audio_url === null, 'enlazar audio: con un archivo ajeno no se toca nada');
  const bien = await enlazar({ text: 'nací en Bogotá, en una casa grande con mis abuelos.', audioUrl: AUDIO_PROPIO });
  ok(bien.status === 200 && bien.json.enlazado === true, 'enlazar audio: archivo propio -> 200 y enlazado (aunque el texto llegue sin mayúscula inicial)');
  ok(storyLog[0].audio_url === AUDIO_PROPIO, 'enlazar audio: la historia quedó con su audio');
  const repetido = await enlazar({ text: 'Nací en Bogotá, en una casa grande con mis abuelos.', audioUrl: AUDIO_PROPIO });
  ok(repetido.status === 200 && repetido.json.enlazado === false, 'enlazar audio: si ya tenía audio no se pisa (enlazado=false)');
  const noExiste = await enlazar({ text: 'Esta historia nunca se guardó en el registro.', audioUrl: AUDIO_PROPIO });
  ok(noExiste.status === 200 && noExiste.json.enlazado === false, 'enlazar audio: sin historia que coincida -> 200 sin enlazar (no es un error)');

  // --- cupo propio de la voz ---
  clavesRateLimit.length = 0;
  await llamar(server, 'POST', '/api/speak', { text: 'Hola.' }, cookie);
  ok(clavesRateLimit.some((k) => String(k).startsWith('voz:')), '/api/speak cuenta en su propio cupo (clave "voz:")');
  ok(!clavesRateLimit.some((k) => !String(k).startsWith('voz:')), '/api/speak no gasta el cupo general de 30/minuto');
  conteoRateLimit = 31;
  const voz31 = await llamar(server, 'POST', '/api/speak', { text: 'Hola.' }, cookie);
  ok(voz31.status === 200, '/api/speak: 31 pedidos en un minuto SÍ pasan (el tope de la voz es 120)');
  const general31 = await enlazar({ text: 'x', audioUrl: AUDIO_PROPIO });
  ok(general31.status === 429, 'el resto de rutas siguen con el tope de 30/minuto (31 -> 429)');
  conteoRateLimit = 121;
  const voz121 = await llamar(server, 'POST', '/api/speak', { text: 'Hola.' }, cookie);
  ok(voz121.status === 429, '/api/speak: más de 120 en un minuto -> 429');
  conteoRateLimit = 1;

  // --- medición de tiempos ---
  logs.length = 0;
  const hablado = await llamar(server, 'POST', '/api/speak', { text: 'Hola.' }, cookie);
  ok(/tts;dur=\d+/.test(String(hablado.headers['server-timing'])) && /total;dur=\d+/.test(String(hablado.headers['server-timing'])), '/api/speak devuelve Server-Timing con tts y total');
  ok(logs.some((l) => l.includes('[latencia] ruta=speak total=')), 'queda la línea [latencia] ruta=speak en los logs');

  server.close();
  console.log = logOriginal;

  // --- el cliente (estático) ---
  const app_ = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'app.html'), 'utf8');
  const colab = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'colaborar.html'), 'utf8');
  for (const [nombre, h] of [['app.html', app_], ['colaborar.html', colab]]) {
    ok(!/audioBufferToWav|recortarSilencioDeCola|decodeAudioData/.test(h), `${nombre}: ya no decodifica ni recodifica el audio a WAV antes de transcribir`);
    ok(/function dividirParaVoz/.test(h) && (/partes\.map\(\(parte\) => pedirVoz\(parte\)\)/.test(h) || /const pedido = pedirVoz\(limpio\)/.test(h)), `${nombre}: la voz se pide en partes, en paralelo`);
  }
  ok(!/await uploadAudio\(audioBlob, 'user'/.test(app_), 'app.html: la subida del audio de la persona ya NO bloquea la llamada a la IA');
  ok(/enlazarAudioConHistoria\(text\.trim\(\), file\)/.test(app_) && /\/api\/story-log\/audio/.test(app_), 'app.html: el audio se enlaza con la historia cuando terminan las dos cosas');
  ok(/let subida = Promise\.resolve\(\);[\s\S]*await subida;\s*\n\s*if \(!texto\) return false;/.test(colab), 'colaborar.html: sube y transcribe en paralelo, y espera la subida antes de mandar el turno');
  ok(/score -= 5/.test(app_) && /\(ar\|uy\)/.test(app_), 'app.html: la voz del sistema de respaldo nunca prefiere una voz argentina');

  // dividirParaVoz: se extrae del HTML real
  const i = app_.indexOf('function dividirParaVoz');
  const j = app_.indexOf('async function pedirVoz');
  const dividir = new Function(app_.slice(i, j) + '; return dividirParaVoz;')();
  ok(JSON.stringify(dividir('Uy, qué belleza.')) === JSON.stringify(['Uy, qué belleza.']), 'voz: un texto corto se pide entero');
  const largo = dividir('Qué lindo recuerdo, me imagino esa casa llena de gente. ¿Y qué cocinaba tu mamá los domingos para toda la familia?');
  ok(largo.length === 2 && largo[0].endsWith('de gente.') && largo[1].startsWith('¿Y qué cocinaba'), 'voz: un texto de varias frases se parte en la primera frase y el resto');
  ok(dividir('Qué bonito. Cuéntame más. Y luego seguimos con otra cosa distinta si quieres, sin ningún apuro.').length === 2, 'voz: nunca más de dos pedazos');
  ok(dividir('Mmm. Sí. Claro, claro, cuéntame con calma todo lo que te acuerdes de esa época tan bonita, sin afán.').length === 1, 'voz: sin una frase completa de al menos 20 caracteres al inicio, va entera');

  // --- Voz por pedazos (streaming de /api/next, 2026-10-08) ---
  ok(/JSON\.stringify\(\{ stream: true, history/.test(app_), 'app: /api/next se pide con stream: true');
  ok(/resp\.headers\.get\('content-type'\) \|\| ''\)\.includes\('ndjson'\)/.test(app_) && /data = await resp\.json\(\)/.test(app_), 'app: si el servidor no hace streaming, sigue funcionando con el JSON de siempre');
  const h0 = app_.indexOf('function iniciarHabla');
  const h1 = app_.indexOf('async function speak(');
  ok(h0 !== -1 && h1 > h0, 'app: existe iniciarHabla');
  const crear = new Function('pedirVoz', 'reproducirBlob', 'speakWithSystemVoice', 'uploadAudio', 'ttsAudioEl', 'Blob',
    app_.slice(h0, h1) + '; return iniciarHabla;');
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const armar = (opts = {}) => {
    const sonaron = []; const subidas = []; let fin = 0; let sistema = null;
    const iniciarHabla = crear(
      async (t) => { await esperar(t.includes('lenta') ? 30 : 1); if (opts.falla === t) throw new Error('tts'); return t; },
      async (b) => { await esperar(2); sonaron.push(b); },
      (t) => { sistema = t; },
      async (blob, quien, idx) => { subidas.push([quien, idx]); return 'archivo.mp3'; },
      { pause() {} },
      class { constructor(p) { this.p = p; } }
    );
    return { iniciarHabla, sonaron, subidas, fin: () => fin, sistema: () => sistema, onEnd: () => { fin++; } };
  };
  {
    const a = armar(); const log = {};
    const h = a.iniciarHabla(a.onEnd);
    h.agregar('Primera frase lenta.'); h.agregar('Segunda.');
    await esperar(5); h.agregar('Tercera.'); h.cerrar(log, 3);
    await esperar(120);
    ok(a.sonaron.join('|') === 'Primera frase lenta.|Segunda.|Tercera.', 'habla: suenan en orden aunque la voz de una tarde más que la siguiente');
    ok(a.fin() === 1, 'habla: avisa una sola vez cuando termina todo');
    ok(a.subidas.length === 1 && a.subidas[0][0] === 'assistant' && a.subidas[0][1] === 3 && log.audioFile === 'archivo.mp3', 'habla: sube el audio completo del turno al final');
  }
  {
    const a = armar(); const h = a.iniciarHabla(a.onEnd);
    h.agregar('Una.'); await esperar(20);
    ok(a.fin() === 0, 'habla: si todavía llegan pedazos, no termina antes de tiempo');
    h.agregar('Otra.'); h.cerrar(null, null); await esperar(30);
    ok(a.sonaron.join('|') === 'Una.|Otra.' && a.fin() === 1, 'habla: un pedazo que llega tarde igual se dice y luego termina');
  }
  {
    const a = armar(); let vigente = true; const h = a.iniciarHabla(a.onEnd, () => vigente);
    h.agregar('Una.'); await esperar(20); vigente = false; h.agregar('No debe sonar.'); h.cerrar(null, null); await esperar(30);
    ok(a.sonaron.join('|') === 'Una.' && a.fin() === 0, 'habla: si la sesión ya no está vigente (pausa/fin), no sigue hablando ni termina el turno');
  }
  {
    const a = armar({ falla: 'Rota.' }); const h = a.iniciarHabla(a.onEnd);
    h.agregar('Buena.'); h.agregar('Rota.'); h.agregar('Última.'); h.cerrar(null, null); await esperar(50);
    ok(a.sonaron.join('|') === 'Buena.' && a.sistema() === 'Rota. Última.', 'habla: si la voz falla, lo que falta se dice con la voz del sistema');
  }

  // --- Respuesta especulativa (2026-10-08) ---
  ok(/const ESPECULAR_MS = 900;/.test(app_) && /const SILENCE_MS = 2000;/.test(app_), 'app: se especula a los 900 ms de silencio y se cierra a los 2000 ms');
  ok(/if \(especulacion && especulacion\.loudAt !== lastLoudTime\) cancelarEspeculacion\(\);/.test(app_), 'app: si la persona vuelve a hablar, la especulación se descarta');
  ok(/const esp = especulacion && !especulacion\.cancelada && especulacion\.loudAt === lastLoudTime/.test(app_), 'app: al cerrar el turno solo se aprovecha si no volvió a hablar');
  ok(/if \(!esp && !interpretarRespuestaPausa/.test(app_), 'app: un turno especulado nunca ofrece la pausa (no se especula si le toca)');
  const e0 = app_.indexOf('async function* leerEventos');
  const e1 = app_.indexOf('async function fetchNext(');
  ok(e0 !== -1 && e1 > e0, 'app: existe el bloque de especulación');
  const montar = new Function('estado', 'fetch', 'transcribeAudio', 'adelantarVoz', 'dividirParaVoz', 'vozAdelantada', 'Blob', 'AbortController',
    `let { sessionMode, history, esperandoRespuestaPausa, mediaUrlsLocal, fotoRecienSubida, subidaFotoEnCurso, ofrecioPausa, sessionStartTime, OFRECER_PAUSA_MS,
       mediaRecorder, audioChunks, lastRecordingMimeType, recordingStartedAt, lastLoudTime } = estado;\n` +
    app_.slice(e0, e1) + `\nreturn { iniciar: iniciarEspeculacion, cancelar: cancelarEspeculacion, actual: () => especulacion, fuenteEspeculada, puedeEspecular, contador: () => especulacionesEsteTurno };`);
  const ndjson = (eventos) => new Response(eventos.map((e) => JSON.stringify(e)).join('\n') + '\n', { headers: { 'Content-Type': 'application/x-ndjson' } });
  const armarEsp = (over = {}) => {
    const llamadas = []; const adelantadas = new Map();
    const estado = Object.assign({
      sessionMode: 'historia', history: [{ role: 'assistant', content: '¿Cómo era tu casa?' }], esperandoRespuestaPausa: false, mediaUrlsLocal: [], fotoRecienSubida: null,
      subidaFotoEnCurso: null, ofrecioPausa: false, sessionStartTime: Date.now(), OFRECER_PAUSA_MS: 15 * 60 * 1000,
      mediaRecorder: { state: 'recording', addEventListener(_, cb) { this.cb = cb; }, removeEventListener() {}, requestData() { setTimeout(() => this.cb(), 1); } },
      audioChunks: [new Uint8Array(1500)], lastRecordingMimeType: 'audio/webm', recordingStartedAt: Date.now() - 4000, lastLoudTime: 1234,
    }, over.estado || {});
    const api = montar(estado,
      async (url, opts) => { llamadas.push({ url, body: JSON.parse(opts.body) }); return over.respuesta ? over.respuesta() : ndjson([{ t: 'frase', texto: 'Qué bello.' }, { t: 'fin', message: 'Qué bello. ¿Cómo era?', restante: '¿Cómo era?', done: false, pausado: false }]); },
      async () => (over.texto === undefined ? 'Era una casa grande con patio.' : over.texto),
      (t) => adelantadas.set(t, true),
      (t) => [String(t || '')],
      adelantadas, Blob, AbortController);
    return { api, llamadas, adelantadas };
  };
  const recoger = async (fuente) => { const out = []; for await (const e of fuente) out.push(e); return out; };
  {
    const { api, llamadas, adelantadas } = armarEsp();
    ok(api.puedeEspecular() === true, 'especular: una charla normal sí puede especularse');
    api.iniciar();
    const esp = api.actual();
    ok(!!esp && esp.loudAt === 1234 && api.contador() === 1, 'especular: guarda cuándo fue la última voz y cuenta el intento');
    ok((await esp.textoPromise) === 'Era una casa grande con patio.', 'especular: transcribe lo grabado hasta ahora (sin detener la grabación)');
    await esp.tarea;
    ok(llamadas.length === 1 && llamadas[0].url === '/api/next' && llamadas[0].body.especulativo === true && llamadas[0].body.stream === true, 'especular: pide /api/next con especulativo:true');
    ok(llamadas[0].body.history.length === 2 && llamadas[0].body.history[1].content === 'Era una casa grande con patio.', 'especular: la respuesta se pide con lo que dijo ya agregado al historial');
    ok(adelantadas.has('Qué bello.') && adelantadas.has('¿Cómo era?'), 'especular: la voz de cada frase y del resto se pide por adelantado');
    let abrioReal = false;
    const eventos = await recoger(api.fuenteEspeculada(esp, async () => { abrioReal = true; return (async function* () {})(); }));
    ok(eventos.map((e) => e.t).join(',') === 'frase,fin' && !abrioReal, 'adoptar: entrega los eventos ya guardados, en orden, sin pedir nada más');
  }
  {
    const { api, llamadas } = armarEsp({ respuesta: () => new Response(JSON.stringify({ noEspeculable: true }), { headers: { 'Content-Type': 'application/json' } }) });
    api.iniciar(); const esp = api.actual(); await esp.tarea;
    let abrioReal = false;
    const eventos = await recoger(api.fuenteEspeculada(esp, async () => { abrioReal = true; return (async function* () { yield { t: 'fin', message: 'Real.' }; })(); }));
    ok(esp.noEspeculable && abrioReal && eventos.length === 1 && eventos[0].message === 'Real.', 'adoptar: si el servidor dijo "no se puede especular", pide el turno de verdad');
  }
  {
    const { api, llamadas } = armarEsp({ texto: '' });
    api.iniciar(); const esp = api.actual(); await esp.tarea;
    ok(esp.noEspeculable && llamadas.length === 0, 'especular: si no se entendió nada, no se llama a la IA');
  }
  {
    const { api, adelantadas } = armarEsp();
    api.iniciar(); const esp = api.actual(); await esp.tarea;
    api.cancelar();
    ok(esp.cancelada && api.actual() === null && adelantadas.size === 0, 'cancelar: marca el intento como descartado y borra la voz adelantada');
  }
  {
    const { api } = armarEsp({ estado: { history: [] } });
    ok(api.puedeEspecular() === false, 'especular: no en el primer turno (prueba de micrófono)');
    ok(armarEsp({ estado: { esperandoRespuestaPausa: true } }).api.puedeEspecular() === false, 'especular: no cuando se espera la respuesta a la oferta de pausa');
    ok(armarEsp({ estado: { mediaUrlsLocal: ['x'] } }).api.puedeEspecular() === false, 'especular: no con fotos pendientes de enviar');
    ok(armarEsp({ estado: { sessionStartTime: Date.now() - 16 * 60 * 1000 } }).api.puedeEspecular() === false, 'especular: no cuando toca ofrecer la pausa');
    ok(armarEsp({ estado: { sessionMode: 'arbol' } }).api.puedeEspecular() === false, 'especular: no en el modo árbol');
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
