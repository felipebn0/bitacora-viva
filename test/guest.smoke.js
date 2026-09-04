// Smoke test para la entrada de "invitado sin cuenta" (BACKLOG #5): alguien
// recibe el código de familia por WhatsApp, entra a colaborar.html con
// ?codigo=XXXXXXXX, escribe su nombre una sola vez — sin correo, sin clave —
// y puede aportar una historia. Cubre: código inválido, falta el nombre,
// entrada exitosa, /api/me refleja la sesión de invitado, un invitado no
// puede tocar rutas de cuenta real (perfil/clave/borrar cuenta), un invitado
// no puede "saltar" a otra bitácora aunque mande un owner distinto, y que
// /api/contribute-chat usa el nombre del invitado sin consultar la base.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const PASSWORD_HASH = bcrypt.hashSync('miclave123', 4);

// A: dueña con código de familia. B: otra dueña sin relación con A — para
// probar que un invitado de A no puede colarse a la bitácora de B.
const users = {
  1: { id: 1, username: 'felipe', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null, name: 'Felipe', invite_code: 'ABCD1234' },
  2: { id: 2, username: 'otradueña', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null, name: 'Otra Dueña', invite_code: 'ZZZZ9999' },
};

const familyNotesInsertadas = [];

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
  // requireAuth valida que la sesión de invitado siga apuntando a una
  // cuenta dueña real.
  if (text.includes('SELECT id FROM users WHERE id') && text.includes('owner_user_id IS NULL')) {
    const u = users[values[0]];
    return Promise.resolve(u && !u.owner_user_id ? [{ id: u.id }] : []);
  }
  if (text.includes('SELECT id, name, username FROM users WHERE invite_code') && text.includes('owner_user_id IS NULL')) {
    const u = Object.values(users).find((x) => x.invite_code === values[0]);
    return Promise.resolve(u ? [{ id: u.id, name: u.name, username: u.username }] : []);
  }
  if (text.includes('SELECT name, username FROM users WHERE id')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ name: u.name, username: u.username }] : []);
  }
  if (text.includes('SELECT 1 FROM collaborations')) return Promise.resolve([]); // sin colaboraciones registradas en este test
  if (text.includes('INSERT INTO family_notes')) { familyNotesInsertadas.push(values); return Promise.resolve([]); }
  if (text.includes('SELECT id, contributor, parentesco, protagonista, texto, audio_url, audio_urls, created_at FROM family_notes')) {
    return Promise.resolve([]);
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
  exports: { put: async () => ({ url: 'https://fake.public.blob.vercel-storage.com/x' }), del: async () => {}, get: async () => null },
};

let capturedCalls = [];
require.cache[require.resolve('@anthropic-ai/sdk')] = {
  id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true,
  exports: class FakeAnthropic {
    constructor() {}
    get messages() {
      return {
        create: async (opts) => {
          capturedCalls.push(opts);
          return { content: [{ type: 'text', text: 'Hola, contame con confianza.' }] };
        },
      };
    }
  },
};

const app = require(serverPath);

function request(server, opts, cookie) {
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
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function guestStart(server, codigo, name) {
  const resp = await request(server, { path: '/api/guest-start', method: 'POST', body: { codigo, name } });
  return resp;
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
    // --- guest-code-info ---
    const infoOk = await request(server, { path: '/api/guest-code-info?codigo=abcd1234' }); // minúscula a propósito: se normaliza a mayúscula
    check('guest-code-info con código real -> 200', infoOk.status === 200);
    check('guest-code-info devuelve el nombre del dueño', JSON.parse(infoOk.body).ownerName === 'Felipe');

    const infoMal = await request(server, { path: '/api/guest-code-info?codigo=NOEXISTE' });
    check('guest-code-info con código inexistente -> 404', infoMal.status === 404);

    // --- guest-start: validaciones ---
    const sinNombre = await guestStart(server, 'ABCD1234', '');
    check('guest-start sin nombre -> 400', sinNombre.status === 400);

    const codigoMalo = await guestStart(server, 'NOEXISTE', 'María');
    check('guest-start con código inexistente -> 404', codigoMalo.status === 404);

    // --- guest-start: entrada real ---
    const okResp = await guestStart(server, 'ABCD1234', 'María');
    check('guest-start con código y nombre válidos -> 200', okResp.status === 200);
    const cookieInvitada = okResp.headers['set-cookie'][0].split(';')[0];
    check('la cookie de invitado se marca HttpOnly', okResp.headers['set-cookie'][0].includes('HttpOnly'));

    // --- /api/me refleja la sesión de invitado ---
    const me = await request(server, { path: '/api/me' }, cookieInvitada);
    const meData = JSON.parse(me.body);
    check('/api/me -> 200 para la sesión de invitado', me.status === 200);
    check('/api/me marca isGuest', meData.isGuest === true);
    check('/api/me trae el nombre que escribió', meData.guestName === 'María');
    check('/api/me trae el nombre del dueño de la bitácora', meData.ownerName === 'Felipe');
    check('/api/me NO trae username (no hay cuenta real)', !meData.username);

    // --- Rutas de cuenta real, bloqueadas para invitados ---
    const upd = await request(server, { path: '/api/update-profile', method: 'POST', body: { name: 'Otro nombre' } }, cookieInvitada);
    check('update-profile bloqueado para invitados -> 403', upd.status === 403);

    const del = await request(server, { path: '/api/delete-account', method: 'POST', body: { password: 'x' } }, cookieInvitada);
    check('delete-account bloqueado para invitados -> 403', del.status === 403);

    const chg = await request(server, { path: '/api/change-password', method: 'POST', body: { currentPassword: 'x', newPassword: 'y' } }, cookieInvitada);
    check('change-password bloqueado para invitados -> 403', chg.status === 403);

    const reset = await request(server, { path: '/api/reset-bitacora', method: 'POST', body: { password: 'x' } }, cookieInvitada);
    check('reset-bitacora bloqueado para invitados (bloquearColaborador) -> 403', reset.status === 403);

    // --- Un invitado de A no puede saltar a la bitácora de B ---
    const hijack = await request(server, { path: '/api/collaboration-info?owner=2' }, cookieInvitada);
    check('un invitado no puede pedir la bitácora de otro dueño -> 403', hijack.status === 403);

    // --- contribute-chat usa el nombre del invitado, sin cuenta ---
    capturedCalls = [];
    const chat = await request(server, { path: '/api/contribute-chat', method: 'POST', body: { history: [] } }, cookieInvitada);
    check('contribute-chat funciona para un invitado -> 200', chat.status === 200);
    check('el prompt arma el saludo con el nombre real del invitado', capturedCalls.length === 1 && capturedCalls[0].messages[0].content.includes('María'));
    check('el prompt del sistema menciona a la dueña de la bitácora', capturedCalls[0].system.includes('Felipe'));

    // --- Cerrar sesión de invitado (mismo /api/logout que una cuenta real) ---
    const logout = await request(server, { path: '/api/logout', method: 'POST' }, cookieInvitada);
    check('logout funciona igual para una sesión de invitado -> 200', logout.status === 200);
    check('logout manda un Set-Cookie que borra la cookie (Max-Age=0)', (logout.headers['set-cookie'] || [''])[0].includes('Max-Age=0'));
  } finally {
    server.close();
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
