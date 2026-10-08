// Smoke test para la entrada de "invitado sin cuenta" con INVITACIÓN PERSONAL
// (BACKLOG #5 + SEC-002A/C, 2026-10-08): el dueño invita a cada persona con su
// nombre y su celular (el celular arma el enlace de WhatsApp) y esa persona
// entra con SU enlace, sin correo ni clave. Cubre: validaciones de la
// invitación, entrada con enlace válido/inválido/revocado, que el código
// familiar ya no sirve para entrar sin cuenta, /api/me del invitado, rutas de
// cuenta real bloqueadas, un invitado no puede "saltar" a otra bitácora, y lo
// de seguridad: dos invitados con el MISMO nombre no ven ni tocan los aportes
// del otro, nadie sobrescribe un borrador o un aporte terminado ajeno, y una
// sesión anterior a las invitaciones (por nombre) no ve lo de las nuevas.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { crearFakeInvitados } = require('./_fake-invitados');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const PASSWORD_HASH = bcrypt.hashSync('miclave123', 4);

// A: dueña con código de familia. B: otra dueña sin relación con A — para
// probar que un invitado de A no puede colarse a la bitácora de B.
const users = {
  1: { id: 1, username: 'felipe', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null, name: 'Felipe', invite_code: 'ABCD1234' },
  2: { id: 2, username: 'otradueña', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null, name: 'Otra Dueña', invite_code: 'ZZZZ9999' },
};

const fakeInvitados = crearFakeInvitados();
// family_notes en memoria (solo lo que usan las rutas de aportes).
const notas = [];
let siguienteNotaId = 100;

function insertarNota(text, values) {
  const columnas = text.match(/INSERT INTO family_notes \(([^)]+)\)/)[1].split(',').map((c) => c.trim());
  const nota = { id: siguienteNotaId++, en_progreso: false, is_private: false, archived_at: null, contributed_by: null, guest_id: null, created_at: new Date() };
  // en_progreso viaja como `true` literal en el borrador (no es un parámetro).
  let k = 0;
  columnas.forEach((c) => {
    if (c === 'en_progreso') { nota.en_progreso = true; return; }
    nota[c] = values[k++];
  });
  notas.push(nota);
  return nota;
}

function fakeSql(strings, ...values) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);
  const deInvitados = fakeInvitados.manejar(text, values);
  if (deInvitados) return deInvitados;

  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = Object.values(users).find((x) => x.username === values[0]);
    return Promise.resolve(u ? [{ id: u.id, username: u.username, password_hash: u.password_hash, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ owner_user_id: u.owner_user_id, token_version: u.token_version }] : []);
  }
  // requireAuth: la sesión de invitado sigue apuntando a una cuenta dueña real.
  if (text.includes('SELECT id, invite_code FROM users WHERE id') && text.includes('owner_user_id IS NULL')) {
    const u = users[values[0]];
    return Promise.resolve(u && !u.owner_user_id ? [{ id: u.id, invite_code: u.invite_code }] : []);
  }
  if (text.includes('SELECT id, name, username FROM users WHERE invite_code') && text.includes('owner_user_id IS NULL')) {
    const u = Object.values(users).find((x) => x.invite_code === values[0]);
    return Promise.resolve(u ? [{ id: u.id, name: u.name, username: u.username }] : []);
  }
  if (text.includes('SELECT id, name, username FROM users WHERE id') && text.includes('owner_user_id IS NULL')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ id: u.id, name: u.name, username: u.username }] : []);
  }
  if (/SELECT name, username(, tratamiento)? FROM users WHERE id/.test(text)) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ name: u.name, username: u.username }] : []);
  }
  if (text.includes('SELECT 1 FROM collaborations')) return Promise.resolve([]); // sin colaboraciones registradas en este test
  if (text.includes('SELECT 1 FROM bitacoras WHERE id')) return Promise.resolve([]);

  // --- family_notes ---
  if (text.includes('INSERT INTO family_notes')) {
    const n = insertarNota(text, values);
    return Promise.resolve([{ id: n.id }]);
  }
  if (text.includes('UPDATE family_notes SET texto') && text.includes('en_progreso = true AND contributed_by IS NOT DISTINCT FROM')) {
    // borrador: [texto, audioUrls, protagonista, mediaUrls, id, ownerId, contributedBy, guestId]
    const [texto, , , , id, ownerId, contributedBy, guestId] = values;
    const n = notas.find((x) => x.id === id && x.user_id === ownerId && x.en_progreso && (x.contributed_by ?? null) === (contributedBy ?? null) && (x.guest_id ?? null) === (guestId ?? null));
    if (!n) return Promise.resolve([]);
    n.texto = texto;
    return Promise.resolve([{ id: n.id }]);
  }
  if (text.includes('UPDATE family_notes SET contributor') && text.includes('contributed_by IS NOT DISTINCT FROM')) {
    // final: [contributor, parentesco, texto, audioUrls, protagonista, mediaUrls, id, ownerId, contributedBy, guestId]
    const [contributor, parentesco, texto, , , , id, ownerId, contributedBy, guestId] = values;
    const n = notas.find((x) => x.id === id && x.user_id === ownerId && (x.contributed_by ?? null) === (contributedBy ?? null) && (x.guest_id ?? null) === (guestId ?? null));
    if (!n) return Promise.resolve([]);
    Object.assign(n, { contributor, parentesco, texto, en_progreso: false });
    return Promise.resolve([{ id: n.id }]);
  }
  if (text.includes('SELECT id, user_id, contributed_by, contributor, guest_id FROM family_notes WHERE id')) {
    const n = notas.find((x) => x.id === values[0] && !x.archived_at);
    return Promise.resolve(n ? [{ id: n.id, user_id: n.user_id, contributed_by: n.contributed_by ?? null, contributor: n.contributor, guest_id: n.guest_id ?? null }] : []);
  }
  if (text.includes('UPDATE family_notes') && text.includes('SET is_private')) {
    const [privada, id, ownerId] = values;
    const n = notas.find((x) => x.id === id && x.user_id === ownerId);
    if (n) n.is_private = privada;
    return Promise.resolve(n ? [{ id: n.id }] : []);
  }
  if (text.includes('FROM family_notes WHERE user_id') && text.includes('is_private FROM family_notes')) {
    const ownerId = values[0];
    let lista = notas.filter((n) => n.user_id === ownerId && !n.archived_at);
    if (text.includes('guest_id = ?')) lista = lista.filter((n) => n.contributed_by == null && n.guest_id === values[1]);
    else if (text.includes('guest_id IS NULL AND contributor = ?')) lista = lista.filter((n) => n.contributed_by == null && n.guest_id == null && n.contributor === values[1]);
    else if (text.includes('contributed_by = ?')) lista = lista.filter((n) => n.contributed_by === values[1]);
    return Promise.resolve(lista.map((n) => ({ id: n.id, contributor: n.contributor, parentesco: n.parentesco || null, protagonista: n.protagonista || null, texto: n.texto, audio_url: null, audio_urls: null, media_urls: null, created_at: n.created_at, is_private: n.is_private })));
  }
  if (text.includes('SELECT parentesco FROM family_notes')) return Promise.resolve([]);
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
let respuestaIA = 'Hola, cuéntame con confianza.';
require.cache[require.resolve('@anthropic-ai/sdk')] = {
  id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true,
  exports: class FakeAnthropic {
    constructor() {}
    get messages() {
      return {
        create: async (opts) => {
          capturedCalls.push(opts);
          if (opts.tool_choice && opts.tool_choice.name === 'guardar_aporte') {
            // extracción del aporte final: el texto es lo que dijo el colaborador en la charla
            const dicho = String(opts.messages[0].content).split('\n').filter((l) => l.startsWith('Colaborador: ')).map((l) => l.slice('Colaborador: '.length)).join(' ');
            return { content: [{ type: 'tool_use', name: 'guardar_aporte', input: { texto: dicho, parentesco: 'primo' } }] };
          }
          return { content: [{ type: 'text', text: respuestaIA }] };
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

const secreto = process.env.SESSION_SECRET;
// Cookie de una sesión de invitado ANTERIOR a las invitaciones personales
// (firmada con el código familiar y sin guestId), tal como se emitía antes.
function cookieDeSesionVieja(payload) {
  const b64 = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', secreto).update(b64).digest('base64url');
  return `bv_session=${b64}.${sig}`;
}

(async () => {
  const server = app.listen(0);
  try {
    // --- Sesiones de los dos dueños ---
    const loginFelipe = await request(server, { path: '/api/login', method: 'POST', body: { username: 'felipe', password: 'miclave123' } });
    const cookieFelipe = loginFelipe.headers['set-cookie'][0].split(';')[0];
    const loginOtra = await request(server, { path: '/api/login', method: 'POST', body: { username: 'otradueña', password: 'miclave123' } });
    const cookieOtra = loginOtra.headers['set-cookie'][0].split(';')[0];

    // --- Crear invitaciones personales ---
    const sinSesion = await request(server, { path: '/api/invitaciones', method: 'POST', body: { nombre: 'Carlos', telefono: '+57 300 111 2233' } });
    check('invitar sin sesión -> 401', sinSesion.status === 401);
    const sinNombre = await request(server, { path: '/api/invitaciones', method: 'POST', body: { nombre: '', telefono: '+57 300 111 2233' } }, cookieFelipe);
    check('invitar sin nombre -> 400', sinNombre.status === 400);
    const telMalo = await request(server, { path: '/api/invitaciones', method: 'POST', body: { nombre: 'Carlos', telefono: '12345678' } }, cookieFelipe);
    check('invitar con un celular sin código de país -> 400', telMalo.status === 400);

    const inv1 = await request(server, { path: '/api/invitaciones', method: 'POST', body: { nombre: 'carlos', telefono: '+57 300 111 2233' } }, cookieFelipe);
    check('invitar a Carlos -> 200', inv1.status === 200);
    const carlos1 = JSON.parse(inv1.body).invitacion;
    check('el nombre queda capitalizado', carlos1.nombre === 'Carlos');
    check('el enlace es personal: /colaborar.html?invitacion=…', /\/colaborar\.html\?invitacion=[A-Za-z0-9_-]{12}$/.test(carlos1.enlace));
    check('el link de WhatsApp abre el chat con SU número y lleva el enlace', carlos1.whatsapp.startsWith('https://wa.me/573001112233?text=') && decodeURIComponent(carlos1.whatsapp).includes(carlos1.enlace));
    check('el mensaje de WhatsApp nombra a quien invita y a la persona', decodeURIComponent(carlos1.whatsapp).includes('Hola Carlos') && decodeURIComponent(carlos1.whatsapp).includes('bitácora de Felipe'));

    const inv2 = await request(server, { path: '/api/invitaciones', method: 'POST', body: { nombre: 'Carlos', telefono: '3009998877' } }, cookieFelipe);
    const carlos2 = JSON.parse(inv2.body).invitacion;
    check('otro Carlos con otro celular (sin código de país, se completa con 57) es otra persona', carlos2.id !== carlos1.id && carlos2.telefono === '573009998877' && carlos2.enlace !== carlos1.enlace);

    const reinvitar = await request(server, { path: '/api/invitaciones', method: 'POST', body: { nombre: 'Carlos', telefono: '300 111 2233' } }, cookieFelipe);
    const carlos1Nuevo = JSON.parse(reinvitar.body).invitacion;
    check('el mismo celular es la misma persona: conserva su id', carlos1Nuevo.id === carlos1.id);
    check('…pero el enlace anterior ya no sirve (se renueva)', carlos1Nuevo.enlace !== carlos1.enlace);
    const viejoInfo = await request(server, { path: `/api/invitacion-info?invitacion=${new URL(carlos1.enlace).searchParams.get('invitacion')}` });
    check('el enlace viejo ya no es válido -> 404', viejoInfo.status === 404);

    const lista = await request(server, { path: '/api/invitaciones' }, cookieFelipe);
    check('la lista del dueño trae sus dos invitados', JSON.parse(lista.body).invitaciones.length === 2);
    const listaOtra = await request(server, { path: '/api/invitaciones' }, cookieOtra);
    check('otra familia no ve las invitaciones de Felipe', JSON.parse(listaOtra.body).invitaciones.length === 0);

    // --- Entrada con el enlace ---
    const codigo1 = new URL(carlos1Nuevo.enlace).searchParams.get('invitacion');
    const codigo2 = new URL(carlos2.enlace).searchParams.get('invitacion');
    const info = await request(server, { path: `/api/invitacion-info?invitacion=${codigo1}` });
    check('invitacion-info trae el nombre y la bitácora', info.status === 200 && JSON.parse(info.body).nombre === 'Carlos' && JSON.parse(info.body).ownerName === 'Felipe');

    const viejoCodigoFamiliar = await request(server, { path: '/api/guest-start', method: 'POST', body: { codigo: 'ABCD1234', name: 'María' } });
    check('el código familiar YA NO deja entrar sin cuenta -> 403', viejoCodigoFamiliar.status === 403 && JSON.parse(viejoCodigoFamiliar.body).necesitaInvitacion === true);
    const malo = await request(server, { path: '/api/guest-start', method: 'POST', body: { invitacion: 'NOEXISTE' } });
    check('enlace inexistente -> 404', malo.status === 404);

    const e1 = await request(server, { path: '/api/guest-start', method: 'POST', body: { invitacion: codigo1 } });
    check('Carlos entra con su enlace -> 200', e1.status === 200);
    check('la cookie de invitado se marca HttpOnly', e1.headers['set-cookie'][0].includes('HttpOnly'));
    const cookieCarlos1 = e1.headers['set-cookie'][0].split(';')[0];
    const e2 = await request(server, { path: '/api/guest-start', method: 'POST', body: { invitacion: codigo2 } });
    const cookieCarlos2 = e2.headers['set-cookie'][0].split(';')[0];

    // --- /api/me refleja la sesión de invitado ---
    const me = await request(server, { path: '/api/me' }, cookieCarlos1);
    const meData = JSON.parse(me.body);
    check('/api/me -> 200 para la sesión de invitado', me.status === 200);
    check('/api/me marca isGuest, con el nombre de la invitación y el de la bitácora', meData.isGuest === true && meData.guestName === 'Carlos' && meData.ownerName === 'Felipe');
    check('/api/me NO trae username (no hay cuenta real)', !meData.username);

    // --- Rutas de cuenta real, bloqueadas para invitados ---
    const upd = await request(server, { path: '/api/update-profile', method: 'POST', body: { name: 'Otro nombre' } }, cookieCarlos1);
    check('update-profile bloqueado para invitados -> 403', upd.status === 403);
    const del = await request(server, { path: '/api/delete-account', method: 'POST', body: { password: 'x' } }, cookieCarlos1);
    check('delete-account bloqueado para invitados -> 403', del.status === 403);
    const chg = await request(server, { path: '/api/change-password', method: 'POST', body: { currentPassword: 'x', newPassword: 'y' } }, cookieCarlos1);
    check('change-password bloqueado para invitados -> 403', chg.status === 403);
    const reset = await request(server, { path: '/api/reset-bitacora', method: 'POST', body: { password: 'x' } }, cookieCarlos1);
    check('reset-bitacora bloqueado para invitados -> 403', reset.status === 403);
    const invitarInvitado = await request(server, { path: '/api/invitaciones', method: 'POST', body: { nombre: 'Intruso', telefono: '+57 300 555 5555' } }, cookieCarlos1);
    check('un invitado no puede invitar a nadie más -> 403', invitarInvitado.status === 403);

    // --- Un invitado de A no puede saltar a la bitácora de B ---
    const hijack = await request(server, { path: '/api/collaboration-info?owner=2' }, cookieCarlos1);
    check('un invitado no puede pedir la bitácora de otro dueño -> 403', hijack.status === 403);

    // --- contribute-chat usa el nombre de la invitación, sin cuenta ---
    capturedCalls = [];
    const chat = await request(server, { path: '/api/contribute-chat', method: 'POST', body: { history: [] } }, cookieCarlos1);
    check('contribute-chat funciona para un invitado -> 200', chat.status === 200);
    check('el prompt arma el saludo con el nombre real del invitado', capturedCalls.length === 1 && capturedCalls[0].messages[0].content.includes('Carlos'));
    check('el prompt del sistema menciona a la dueña de la bitácora', capturedCalls[0].system.includes('Felipe'));

    // --- SEC-002A: dos Carlos no se ven los aportes ---
    respuestaIA = 'Qué lindo recuerdo, cuéntame más.';
    const borrador1 = JSON.parse((await request(server, { path: '/api/contribute-chat', method: 'POST', body: { history: [{ role: 'user', content: 'Soy el primo de Felipe y me acuerdo del río.' }] } }, cookieCarlos1)).body);
    const borrador2 = JSON.parse((await request(server, { path: '/api/contribute-chat', method: 'POST', body: { history: [{ role: 'user', content: 'Soy otro Carlos, amigo de la infancia.' }] } }, cookieCarlos2)).body);
    check('cada Carlos tiene su propio borrador', borrador1.draftId && borrador2.draftId && borrador1.draftId !== borrador2.draftId);
    check('los aportes quedan atados a la invitación (guest_id), no al nombre', notas.find((n) => n.id === borrador1.draftId).guest_id === carlos1.id && notas.find((n) => n.id === borrador2.draftId).guest_id === carlos2.id);

    const ve1 = JSON.parse((await request(server, { path: '/api/contributions' }, cookieCarlos1)).body).notes;
    const ve2 = JSON.parse((await request(server, { path: '/api/contributions' }, cookieCarlos2)).body).notes;
    check('el primer Carlos ve solo lo suyo', ve1.length === 1 && ve1[0].texto.includes('río'));
    check('el segundo Carlos ve solo lo suyo (aunque se llaman igual)', ve2.length === 1 && ve2[0].texto.includes('infancia'));
    const veDueno = JSON.parse((await request(server, { path: '/api/contributions' }, cookieFelipe)).body).notes;
    check('el dueño sigue viendo los aportes de los dos', veDueno.length === 2);

    const privAjeno = await request(server, { path: `/api/contributions/${borrador1.draftId}/privacy`, method: 'POST', body: { private: true } }, cookieCarlos2);
    check('un Carlos no puede volver privado el aporte del otro -> 404', privAjeno.status === 404 && notas.find((n) => n.id === borrador1.draftId).is_private === false);
    const privPropio = await request(server, { path: `/api/contributions/${borrador1.draftId}/privacy`, method: 'POST', body: { private: true } }, cookieCarlos1);
    check('el dueño del aporte sí puede -> 200', privPropio.status === 200 && notas.find((n) => n.id === borrador1.draftId).is_private === true);

    // --- SEC-002C: nadie sobrescribe el borrador ni el aporte terminado de otro ---
    const ataqueBorrador = JSON.parse((await request(server, { path: '/api/contribute-chat', method: 'POST', body: { history: [{ role: 'user', content: 'TEXTO DEL ATACANTE' }], draftId: borrador1.draftId } }, cookieCarlos2)).body);
    check('mandar el draftId de otro NO cambia su borrador', notas.find((n) => n.id === borrador1.draftId).texto.includes('río') && !notas.find((n) => n.id === borrador1.draftId).texto.includes('ATACANTE'));
    check('…y el atacante recibe un borrador propio nuevo', ataqueBorrador.draftId && ataqueBorrador.draftId !== borrador1.draftId && notas.find((n) => n.id === ataqueBorrador.draftId).guest_id === carlos2.id);

    respuestaIA = 'Gracias por contarme todo, qué recuerdo tan bonito. [FIN]';
    const ataqueFinal = JSON.parse((await request(server, { path: '/api/contribute-chat', method: 'POST', body: { history: [{ role: 'user', content: 'TEXTO FINAL DEL ATACANTE, bien largo para que se guarde completo.' }], draftId: borrador1.draftId } }, cookieCarlos2)).body);
    const notaVictima = notas.find((n) => n.id === borrador1.draftId);
    check('cerrar un aporte con el draftId de otro NO sobrescribe el suyo', !notaVictima.texto.includes('ATACANTE') && notaVictima.en_progreso === true);
    check('…se guarda como un aporte nuevo del atacante', ataqueFinal.saved === true && notas.some((n) => n.guest_id === carlos2.id && n.texto.includes('TEXTO FINAL DEL ATACANTE') && n.id !== borrador1.draftId));

    const finalPropio = JSON.parse((await request(server, { path: '/api/contribute-chat', method: 'POST', body: { history: [{ role: 'user', content: 'Y así terminó la historia del río con mi primo Felipe.' }], draftId: borrador1.draftId } }, cookieCarlos1)).body);
    check('quien lo escribió sí puede cerrar su propio borrador', finalPropio.saved === true && notas.find((n) => n.id === borrador1.draftId).en_progreso === false && notas.find((n) => n.id === borrador1.draftId).texto.includes('terminó la historia'));
    const reintento = JSON.parse((await request(server, { path: '/api/contribute-chat', method: 'POST', body: { history: [{ role: 'user', content: 'Y así terminó la historia del río con mi primo Felipe.' }], draftId: borrador1.draftId } }, cookieCarlos1)).body);
    check('reintentar el cierre (red lenta) no duplica el aporte', reintento.saved === true && notas.filter((n) => n.guest_id === carlos1.id).length === 1);
    respuestaIA = 'Hola, cuéntame con confianza.';

    // --- Otra familia no puede quitar el acceso de un invitado de Felipe ---
    const revocarAjeno = await request(server, { path: `/api/invitaciones/${carlos1.id}/revocar`, method: 'POST' }, cookieOtra);
    check('otra familia no puede revocar la invitación de Felipe -> 404', revocarAjeno.status === 404);
    const sigueVivo = await request(server, { path: '/api/me' }, cookieCarlos1);
    check('…y el invitado sigue dentro', sigueVivo.status === 200);

    // --- Una sesión ANTERIOR a las invitaciones sigue por nombre, pero no ve lo nuevo ---
    notas.push({ id: siguienteNotaId++, user_id: 1, contributor: 'Carlos', texto: 'aporte viejo de antes de las invitaciones', contributed_by: null, guest_id: null, en_progreso: false, is_private: false, archived_at: null, created_at: new Date() });
    const cookieVieja = cookieDeSesionVieja({ guest: true, ownerId: 1, guestName: 'Carlos', code: 'ABCD1234' });
    const veVieja = JSON.parse((await request(server, { path: '/api/contributions' }, cookieVieja)).body).notes;
    check('sesión vieja (por nombre): ve solo los aportes viejos sin invitación', veVieja.length === 1 && veVieja[0].texto.includes('antes de las invitaciones'));
    const meViejo = await request(server, { path: '/api/me' }, cookieVieja);
    check('la sesión vieja sigue valiendo mientras no se rote el código familiar', meViejo.status === 200);

    // --- Quitar acceso: corta la sesión, conserva los aportes, y se puede reactivar ---
    const revocar = await request(server, { path: `/api/invitaciones/${carlos1.id}/revocar`, method: 'POST' }, cookieFelipe);
    check('el dueño quita el acceso -> 200', revocar.status === 200);
    const cortado = await request(server, { path: '/api/me' }, cookieCarlos1);
    check('la sesión de ese invitado cae en su próximo pedido -> 401', cortado.status === 401);
    const otroSigue = await request(server, { path: '/api/me' }, cookieCarlos2);
    check('el otro Carlos no se ve afectado', otroSigue.status === 200);
    check('sus aportes se conservan', notas.some((n) => n.guest_id === carlos1.id));
    const entrarRevocado = await request(server, { path: '/api/guest-start', method: 'POST', body: { invitacion: codigo1 } });
    check('con el enlace revocado no se puede volver a entrar -> 404', entrarRevocado.status === 404);
    const reactivar = await request(server, { path: `/api/invitaciones/${carlos1.id}/renovar`, method: 'POST' }, cookieFelipe);
    const nuevoCodigo1 = new URL(JSON.parse(reactivar.body).invitacion.enlace).searchParams.get('invitacion');
    const reentra = await request(server, { path: '/api/guest-start', method: 'POST', body: { invitacion: nuevoCodigo1 } });
    const cookieReentra = reentra.headers['set-cookie'][0].split(';')[0];
    const veOtraVez = JSON.parse((await request(server, { path: '/api/contributions' }, cookieReentra)).body).notes;
    check('al reactivarlo con enlace nuevo recupera SUS aportes (mismo id)', reentra.status === 200 && veOtraVez.length === 1 && veOtraVez[0].texto.includes('terminó la historia'));

    // --- Las páginas usan el enlace personal ---
    const fs = require('fs');
    const appHtml = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'app.html'), 'utf8');
    const colabHtml = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'colaborar.html'), 'utf8');
    check('app.html pide nombre y celular para invitar', /id="inviteNombre"/.test(appHtml) && /id="invitePhone"/.test(appHtml) && /fetch\('\/api\/invitaciones'/.test(appHtml));
    check('colaborar.html entra con ?invitacion= y ya no manda solo el nombre', /get\('invitacion'\)/.test(colabHtml) && /body: JSON\.stringify\(\{ invitacion: invitacionUrl \}\)/.test(colabHtml) && !/guest-start[\s\S]{0,200}name: nombre/.test(colabHtml));

    // --- Cerrar sesión de invitado (mismo /api/logout que una cuenta real) ---
    const logout = await request(server, { path: '/api/logout', method: 'POST' }, cookieCarlos2);
    check('logout funciona igual para una sesión de invitado -> 200', logout.status === 200);
    check('logout manda un Set-Cookie que borra la cookie (Max-Age=0)', (logout.headers['set-cookie'] || [''])[0].includes('Max-Age=0'));
  } finally {
    server.close();
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
