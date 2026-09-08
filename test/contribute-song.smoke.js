// Smoke test para POST /api/contribute-song — agregar una canción (link de
// Spotify o YouTube) como aporte de este recuerdo, sin subir ningún archivo
// (2026-09-08, a pedido del usuario: "si mi mamá quiere colaborar en la
// bitácora de mi abuela... que suene un pedazo de la canción y le pregunte
// qué recuerdo tienen").
//
// A diferencia de /api/contribute-media, acá NO hay bytes que verificar —
// lo que hay que validar es que el link sea de verdad de una de las dos
// plataformas permitidas (ver HOSTS_LINK_CANCION_PERMITIDOS en server.js) y
// que el link de EMBEBER que se arma a partir de él (lo único que se
// devuelve y se termina guardando) sea uno de los dos hosts de la allowlist
// de lectura (HOSTS_EMBED_CANCION_PERMITIDOS) — nunca se acepta "cualquier
// URL http(s)", eso permitiría meter un iframe a cualquier sitio bajo la
// apariencia de "una canción".
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const PASSWORD_HASH = bcrypt.hashSync('miclave123', 4);

// A: dueña. B: cuenta sin ninguna relación con A.
const users = {
  1: { id: 1, username: 'duena', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null },
  2: { id: 2, username: 'ajena', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null },
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
  if (text.includes('SELECT 1 FROM collaborations')) return Promise.resolve([]);
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
require.cache[require.resolve('@anthropic-ai/sdk')] = {
  id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true,
  exports: class FakeAnthropic { constructor() {} },
};

const app = require(serverPath);

function request(server, opts, cookie) {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : null;
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
  if (resp.status !== 200) throw new Error(`login falló para ${username}: ${resp.status} ${resp.body}`);
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
    const cookieA = await login(server, 'duena');
    const cookieB = await login(server, 'ajena');

    // --- Sin sesión ---
    const sinSesion = await request(server, { path: '/api/contribute-song', method: 'POST', body: { url: 'https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp' } });
    check('sin sesión -> 401', sinSesion.status === 401);

    // --- Cuenta sin relación con A: no puede agregar canciones a la bitácora de A ---
    const comoAjena = await request(server, { path: '/api/contribute-song?owner=1', method: 'POST', body: { url: 'https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp' } }, cookieB);
    check('cuenta sin relación con A -> 403', comoAjena.status === 403);

    // --- Falta el link ---
    const sinUrl = await request(server, { path: '/api/contribute-song', method: 'POST', body: {} }, cookieA);
    check('sin url -> 400', sinUrl.status === 400);

    // --- No es una URL en absoluto ---
    const noEsUrl = await request(server, { path: '/api/contribute-song', method: 'POST', body: { url: 'esto no es un link' } }, cookieA);
    check('texto que no es una URL -> 400', noEsUrl.status === 400);

    // --- Dominio cualquiera, no Spotify ni YouTube ---
    const dominioAjeno = await request(server, { path: '/api/contribute-song', method: 'POST', body: { url: 'https://example.com/track/123' } }, cookieA);
    check('dominio que no es Spotify ni YouTube -> 400', dominioAjeno.status === 400);

    // --- http (no https) ---
    const noHttps = await request(server, { path: '/api/contribute-song', method: 'POST', body: { url: 'http://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp' } }, cookieA);
    check('link por http (no https) -> 400', noHttps.status === 400);

    // --- Spotify: track real, con parámetros de tracking (?si=...) ---
    const spotifyOk = await request(server, { path: '/api/contribute-song', method: 'POST', body: { url: 'https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp?si=abc123' } }, cookieA);
    check('link de Spotify válido -> 200', spotifyOk.status === 200);
    const dataSpotify = JSON.parse(spotifyOk.body);
    check('devuelve el link de EMBEBER de Spotify, no el original', dataSpotify.url === 'https://open.spotify.com/embed/track/3n3Ppam7vgaVa1iaRUc9Lp');
    check('el tipo es "cancion"', dataSpotify.type === 'cancion');

    // --- Spotify: con prefijo de idioma en la ruta ---
    const spotifyIntl = await request(server, { path: '/api/contribute-song', method: 'POST', body: { url: 'https://open.spotify.com/intl-es/track/3n3Ppam7vgaVa1iaRUc9Lp' } }, cookieA);
    check('link de Spotify con prefijo de idioma (/intl-es/) -> 200', spotifyIntl.status === 200);
    check('arma igual el link de embeber', JSON.parse(spotifyIntl.body).url === 'https://open.spotify.com/embed/track/3n3Ppam7vgaVa1iaRUc9Lp');

    // --- Spotify: una playlist, no una canción puntual ---
    const spotifyPlaylist = await request(server, { path: '/api/contribute-song', method: 'POST', body: { url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M' } }, cookieA);
    check('link de Spotify que es una playlist, no /track/ -> 400', spotifyPlaylist.status === 400);

    // --- YouTube: link normal ---
    const youtubeOk = await request(server, { path: '/api/contribute-song', method: 'POST', body: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } }, cookieA);
    check('link de YouTube válido -> 200', youtubeOk.status === 200);
    const dataYoutube = JSON.parse(youtubeOk.body);
    check('devuelve el link de EMBEBER en youtube-nocookie.com', dataYoutube.url === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');

    // --- YouTube: link corto youtu.be ---
    const youtuBeOk = await request(server, { path: '/api/contribute-song', method: 'POST', body: { url: 'https://youtu.be/dQw4w9WgXcQ' } }, cookieA);
    check('link corto youtu.be -> 200', youtuBeOk.status === 200);
    check('arma el mismo link de embeber que la versión larga', JSON.parse(youtuBeOk.body).url === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');

    // --- YouTube Music ---
    const ytMusicOk = await request(server, { path: '/api/contribute-song', method: 'POST', body: { url: 'https://music.youtube.com/watch?v=dQw4w9WgXcQ' } }, cookieA);
    check('link de music.youtube.com -> 200', ytMusicOk.status === 200);

    // --- YouTube: sin el parámetro v= ---
    const youtubeSinV = await request(server, { path: '/api/contribute-song', method: 'POST', body: { url: 'https://www.youtube.com/watch?list=PL123' } }, cookieA);
    check('link de YouTube sin ?v= -> 400', youtubeSinV.status === 400);

    // --- Intentar colar un link a un iframe malicioso disfrazado de "embed" de Spotify ---
    const spotifyFalsoEmbed = await request(server, { path: '/api/contribute-song', method: 'POST', body: { url: 'https://open.spotify.com.evil.com/track/3n3Ppam7vgaVa1iaRUc9Lp' } }, cookieA);
    check('dominio que solo CONTIENE "open.spotify.com" pero no lo es -> 400', spotifyFalsoEmbed.status === 400);
  } finally {
    server.close();
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
