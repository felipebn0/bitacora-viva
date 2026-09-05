// Smoke test para el pineo del host EXACTO de nuestro store de Vercel Blob
// (hallazgo de seguridad 2026-09-05: el chequeo anterior aceptaba
// cualquier host que terminara en ".blob.vercel-storage.com", no solo el
// nuestro — cualquiera puede crear su propio store gratis con ese mismo
// sufijo).
//
// BLOB_READ_WRITE_TOKEN se lee una sola vez al cargar el módulo (server.js
// arma BLOB_STORE_ID/BLOB_HOST_EXACTO como constantes de arranque), así que
// esto corre en un proceso hijo — como test/sentry.smoke.js — para poder
// fijar la variable de entorno ANTES de que server.js se cargue, con un
// storeId de prueba conocido.
//
// Cubre: con el token puesto, una URL del host EXACTO de nuestro store se
// acepta (200), pero una URL de OTRO store — mismo sufijo válido, distinto
// storeId — ahora se rechaza (404), cosa que antes de este arreglo hubiera
// pasado igual con solo mirar el sufijo.
//
//   node test/blob-host-exacto.smoke.js

const { spawn } = require('child_process');
const path = require('path');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const BASE_ENV = {
  ...process.env,
  SESSION_SECRET: 'test-blob-host-secret',
  DATABASE_URL: 'postgres://fake:fake@localhost/fake',
  ANTHROPIC_API_KEY: 'fake',
  // Mismo formato que usa @vercel/blob de verdad: vercel_blob_rw_<storeId>_<random>.
  BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_nuestrostoreid123_tokenDePrueba',
};

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`OK  - ${name}`); }
  else { failed++; console.log(`FAIL - ${name}`); }
}

function runChildEval(script, env, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', script], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ timedOut: true, stdout, stderr, code: null }); }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('exit', (code) => { clearTimeout(timer); resolve({ timedOut: false, stdout, stderr, code }); });
  });
}

async function main() {
  const script = `
    const path = require('path');
    const http = require('http');
    const bcrypt = require('bcryptjs');
    const PASSWORD_HASH = bcrypt.hashSync('miclave123', 4);
    const users = { 1: { id: 1, username: 'duena', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null } };

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
      return Promise.resolve([]);
    }
    fakeSql.transaction = (queries) => Promise.all(queries);

    require.cache[require.resolve('@neondatabase/serverless')] = {
      id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true,
      exports: { neon: () => fakeSql },
    };
    require.cache[require.resolve('@vercel/blob')] = {
      id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true,
      exports: { put: async () => ({ url: 'https://nuestrostoreid123.public.blob.vercel-storage.com/x' }), del: async () => {}, get: async () => null },
    };
    require.cache[require.resolve('@anthropic-ai/sdk')] = {
      id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true,
      exports: class FakeAnthropic { constructor() {} },
    };

    function streamDesdeBuffer(buf) {
      return new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(buf)); controller.close(); } });
    }
    const CONTENIDO = Buffer.from('contenido-real');
    const URL_NUESTRA = 'https://nuestrostoreid123.public.blob.vercel-storage.com/audio/1/x/file.webm';
    const URL_OTRO_STORE = 'https://otrostoreid999.public.blob.vercel-storage.com/audio/1/x/file.webm';
    const fetchOriginal = global.fetch;
    global.fetch = async (url) => {
      if (url === URL_NUESTRA || url === URL_OTRO_STORE) {
        return { ok: true, status: 200, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'audio/webm' : null) }, body: streamDesdeBuffer(CONTENIDO) };
      }
      return fetchOriginal(url);
    };

    const app = require(${JSON.stringify(serverPath)});

    function request(server, opts, cookie) {
      return new Promise((resolve, reject) => {
        const headers = Object.assign({}, opts.headers || {});
        if (cookie) headers['Cookie'] = cookie;
        const host = '127.0.0.1:' + server.address().port;
        if (!headers['Origin']) headers['Origin'] = 'http://' + host;
        const r = http.request({ hostname: '127.0.0.1', port: server.address().port, path: opts.path, method: opts.method || 'GET', headers }, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bodyBuffer: Buffer.concat(chunks) }));
        });
        r.on('error', reject);
        r.end();
      });
    }

    async function login(server, username) {
      const data = JSON.stringify({ username, password: 'miclave123' });
      const resp = await new Promise((resolve, reject) => {
        const host = '127.0.0.1:' + server.address().port;
        const r = http.request(
          { hostname: '127.0.0.1', port: server.address().port, path: '/api/login', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Origin: 'http://' + host } },
          (res) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() })); }
        );
        r.on('error', reject);
        r.write(data);
        r.end();
      });
      if (resp.status !== 200) throw new Error('login falló: ' + resp.status + ' ' + resp.body);
      return resp.headers['set-cookie'][0].split(';')[0];
    }

    (async () => {
      const server = app.listen(0);
      const cookie = await login(server, 'duena');
      const u = (valor) => '/api/media-file?u=' + encodeURIComponent(valor);
      const rNuestra = await request(server, { path: u(URL_NUESTRA) }, cookie);
      const rOtroStore = await request(server, { path: u(URL_OTRO_STORE) }, cookie);
      console.log('STATUS_NUESTRA=' + rNuestra.status);
      console.log('STATUS_OTRO_STORE=' + rOtroStore.status);
      server.close();
    })();
  `;
  const r = await runChildEval(script, BASE_ENV, 8000);
  if (r.timedOut) console.log('(el proceso hijo no terminó a tiempo)');
  if (r.stderr) console.log('--- stderr del hijo ---\\n' + r.stderr);

  check('con BLOB_READ_WRITE_TOKEN puesto, una URL de NUESTRO store se acepta -> 200', /STATUS_NUESTRA=200/.test(r.stdout));
  check('una URL de OTRO store (mismo sufijo, distinto storeId) se rechaza -> 404', /STATUS_OTRO_STORE=404/.test(r.stdout));

  console.log(`\n${passed} pasaron, ${failed} fallaron`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
