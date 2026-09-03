// Smoke test para GET /api/export — el .zip con toda la bitácora, pensado
// para que cada familia se lleve su propia copia (complemento del backup
// automático del lado del servidor, que protege aunque nadie lo pida).
//
// Cubre: requiere sesión, bloqueado para cuentas colaboradoras, la
// respuesta es un .zip válido con los archivos esperados adentro, el
// contenido es el de la cuenta correcta (no inventado ni mezclado con
// otra), y aislamiento — el export de la cuenta A nunca incluye datos de
// la cuenta B.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';

const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const PASSWORD_HASH = bcrypt.hashSync('miclave123', 4);

// Dos cuentas dueñas (A y B) para probar aislamiento, más una cuenta
// colaboradora de A (C) para probar que el export le queda bloqueado.
const users = {
  1: {
    id: 1, username: 'usuarioa', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null,
    name: 'Usuaria A', email: 'a@example.com', fecha_nacimiento: '1950-05-10', created_at: '2024-01-01T00:00:00Z',
  },
  2: {
    id: 2, username: 'usuariob', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null,
    name: 'Usuario B', email: 'b@example.com', fecha_nacimiento: null, created_at: '2024-01-01T00:00:00Z',
  },
  3: {
    id: 3, username: 'colabc', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: 1,
    name: 'Colaboradora C', email: null, fecha_nacimiento: null, created_at: '2024-01-01T00:00:00Z',
  },
};

const storyLog = {
  1: [{ texto: 'Historia secreta de la cuenta A sobre su infancia en Manizales.', audio_url: null, created_at: '2024-02-01T00:00:00Z' }],
  2: [{ texto: 'Historia de la cuenta B que NUNCA debería aparecer en el export de A.', audio_url: null, created_at: '2024-02-01T00:00:00Z' }],
};
const resumenes = { 1: 'Resumen de A.', 2: 'Resumen de B.' };
const familyNotes = {
  1: [{ contributor: 'María', parentesco: 'hija', protagonista: null, texto: 'Aporte sobre A.', audio_url: null, audio_urls: null, created_at: '2024-02-02T00:00:00Z' }],
  2: [],
};
const mediaRows = { 1: [{ type: 'foto', url: 'https://x.blob.vercel-storage.com/foto-a.jpg', caption: 'Cumpleaños', contributor: 'María', created_at: '2024-02-03T00:00:00Z' }], 2: [] };
const familyMembers = { 1: [{ nombre: 'Papá de A', relacion: 'padre', detalles: null, padres: null, created_at: '2024-01-05T00:00:00Z' }], 2: [] };
const timelineEvents = { 1: [{ descripcion: 'Se mudó a Bogotá', anio: 1975, edad_aprox: 20, categoria: 'mudanza' }], 2: [] };
const chapters = { 1: [{ title: 'La infancia', theme: 'infancia', generated_text: 'Texto del capítulo de A.', story_ids: '[1]', created_at: '2024-02-05T00:00:00Z' }], 2: [] };

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
  if (text.includes('SELECT name, username, email, fecha_nacimiento, created_at FROM users WHERE id')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ name: u.name, username: u.username, email: u.email, fecha_nacimiento: u.fecha_nacimiento, created_at: u.created_at }] : []);
  }
  if (text.includes('SELECT texto, audio_url, created_at FROM story_log')) {
    return Promise.resolve(storyLog[values[0]] || []);
  }
  if (text.includes('SELECT texto FROM resumen')) {
    return Promise.resolve(resumenes[values[0]] ? [{ texto: resumenes[values[0]] }] : []);
  }
  if (text.includes('SELECT contributor, parentesco, protagonista, texto, audio_url, audio_urls, created_at FROM family_notes')) {
    return Promise.resolve(familyNotes[values[0]] || []);
  }
  if (text.includes('SELECT type, url, caption, contributor, created_at FROM media')) {
    return Promise.resolve(mediaRows[values[0]] || []);
  }
  if (text.includes('SELECT nombre, relacion, detalles, padres, created_at FROM family_members')) {
    return Promise.resolve(familyMembers[values[0]] || []);
  }
  if (text.includes('SELECT descripcion, anio, edad_aprox, categoria FROM timeline_events')) {
    return Promise.resolve(timelineEvents[values[0]] || []);
  }
  if (text.includes('SELECT title, theme, generated_text, story_ids, created_at FROM chapters')) {
    return Promise.resolve(chapters[values[0]] || []);
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
  exports: { put: async () => ({ url: 'https://fake.public.blob.vercel-storage.com/x' }), del: async () => {} },
};
require.cache[require.resolve('@anthropic-ai/sdk')] = {
  id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true,
  exports: class FakeAnthropic { constructor() {} },
};

const app = require(serverPath);

// request() en binario — el body de /api/export es un .zip, así que juntar
// los chunks como string (como hacen los otros smoke tests) corrompería los
// bytes. Acá se devuelve un Buffer.
function requestBinary(server, opts, cookie) {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : null;
    const headers = Object.assign({}, opts.headers || {});
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    if (cookie) headers['Cookie'] = cookie;
    const host = `127.0.0.1:${server.address().port}`;
    if (!headers['Origin']) headers['Origin'] = `http://${host}`;
    const r = http.request({ hostname: '127.0.0.1', port: server.address().port, path: opts.path, method: opts.method || 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bodyBuffer: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function login(server, username) {
  const resp = await requestBinary(server, { path: '/api/login', method: 'POST', body: { username, password: 'miclave123' } });
  if (resp.status !== 200) throw new Error(`login falló para ${username}: ${resp.status} ${resp.bodyBuffer.toString()}`);
  return resp.headers['set-cookie'][0].split(';')[0];
}

// Lista las entradas del .zip y devuelve el contenido de un archivo puntual
// adentro, usando el binario "unzip" del sistema (ya presente en el runner
// de CI de GitHub Actions) — evita sumar una dependencia nueva solo para
// leer zips en un test. "leerArchivo" queda como closure para llamarse
// varias veces DESPUÉS de que esta función retorne, así que el archivo
// temporal no se puede borrar acá adentro — lo borra "limpiar()", que el
// que llama tiene que invocar cuando ya terminó de leer todo.
function leerZip(bodyBuffer) {
  const tmpFile = path.join(os.tmpdir(), `export-test-${process.pid}-${Date.now()}.zip`);
  fs.writeFileSync(tmpFile, bodyBuffer);
  const listado = execFileSync('unzip', ['-l', tmpFile], { encoding: 'utf8' });
  const leerArchivo = (nombre) => execFileSync('unzip', ['-p', tmpFile, nombre], { encoding: 'utf8' });
  const limpiar = () => fs.unlinkSync(tmpFile);
  return { listado, leerArchivo, limpiar };
}

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`OK  - ${name}`); }
  else { failed++; console.log(`FAIL - ${name}`); }
}

async function main() {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));

  const sinCookie = await requestBinary(server, { path: '/api/export', method: 'GET' });
  check('export: sin cookie -> 401', sinCookie.status === 401);

  const cookieC = await login(server, 'colabc');
  const comoColaboradora = await requestBinary(server, { path: '/api/export', method: 'GET' }, cookieC);
  check('export: cuenta colaboradora -> 403 (bloquearColaborador)', comoColaboradora.status === 403);

  const cookieA = await login(server, 'usuarioa');
  const resp = await requestBinary(server, { path: '/api/export', method: 'GET' }, cookieA);
  check('export: cuenta dueña -> 200', resp.status === 200);
  check('export: Content-Type application/zip', resp.headers['content-type'] === 'application/zip');
  check('export: Content-Disposition con nombre .zip', /attachment; filename="bitacora-usuarioa-\d{4}-\d{2}-\d{2}\.zip"/.test(resp.headers['content-disposition'] || ''));
  check('export: el cuerpo empieza con la firma de un zip (PK)', resp.bodyBuffer.slice(0, 2).toString('latin1') === 'PK');

  const { listado, leerArchivo, limpiar } = leerZip(resp.bodyBuffer);
  for (const nombre of ['LEEME.txt', 'perfil.json', 'historias.json', 'resumen.txt', 'aportes_familiares.json', 'fotos_y_videos.json', 'arbol_genealogico.json', 'capitulos.json', 'historia-completa.txt']) {
    check(`export: el zip incluye ${nombre}`, listado.includes(nombre));
  }

  const perfil = JSON.parse(leerArchivo('perfil.json'));
  check('export: perfil.json tiene el nombre correcto', perfil.nombre === 'Usuaria A');
  check('export: perfil.json tiene el correo correcto', perfil.correo === 'a@example.com');

  const historiasJson = JSON.parse(leerArchivo('historias.json'));
  check('export: historias.json incluye la historia real de A', historiasJson.some((h) => h.texto.includes('infancia en Manizales')));
  check('export: historias.json NO incluye nada de la cuenta B (aislamiento)', !historiasJson.some((h) => h.texto.includes('cuenta B')));

  const historiaCompleta = leerArchivo('historia-completa.txt');
  check('export: historia-completa.txt es legible y tiene el texto de A', historiaCompleta.includes('infancia en Manizales'));
  check('export: historia-completa.txt NO tiene nada de la cuenta B', !historiaCompleta.includes('cuenta B'));

  const arbol = JSON.parse(leerArchivo('arbol_genealogico.json'));
  check('export: arbol_genealogico.json tiene a la persona de A', arbol.personas.some((p) => p.nombre === 'Papá de A'));
  check('export: arbol_genealogico.json tiene la línea de tiempo de A', arbol.linea_de_tiempo.some((e) => e.anio === 1975));

  const capitulosJson = JSON.parse(leerArchivo('capitulos.json'));
  check('export: capitulos.json tiene el capítulo de A', capitulosJson.some((c) => c.title === 'La infancia'));

  limpiar();
  server.close();
  console.log(`\n${passed} pasaron, ${failed} fallaron`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR EN EL SMOKE TEST DE EXPORT:', e);
  process.exit(1);
});
