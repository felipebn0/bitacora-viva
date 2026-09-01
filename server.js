require('dotenv').config({ quiet: true });
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Anthropic = require('@anthropic-ai/sdk');
const { neon } = require('@neondatabase/serverless');
const { put } = require('@vercel/blob');

const app = express();
app.set('trust proxy', 1); // detrás del proxy de Vercel: para que req.ip y req.secure sean correctos
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Limitador simple por IP: evita que alguien con el link gaste crédito de
// Claude/ElevenLabs a lo loco (además del login, esto frena intentos de
// adivinar contraseñas).
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;
const rateLimitHits = new Map();

function rateLimit(req, res, next) {
  const ip = req.ip || 'desconocida';
  const now = Date.now();
  const hits = (rateLimitHits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Demasiados pedidos, espera un momento.' });
  }
  hits.push(now);
  rateLimitHits.set(ip, hits);
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, hits] of rateLimitHits) {
    const recent = hits.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length) rateLimitHits.set(ip, recent);
    else rateLimitHits.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-haiku-4-5-20251001';

// --- Base de datos (Neon Postgres, vía la integración de Vercel) ---
const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
let sql = null;
if (!DB_URL) {
  console.error('DATABASE_URL no está definida en las variables de entorno de esta función.');
} else if (!/^postgres(ql)?:\/\//.test(DB_URL)) {
  console.error(
    `DATABASE_URL está definida pero no empieza con postgres:// (largo=${DB_URL.length}, primeros caracteres="${DB_URL.slice(0, 12)}")`
  );
} else {
  try {
    sql = neon(DB_URL);
  } catch (err) {
    console.error('neon() rechazó DATABASE_URL:', err.message);
  }
}

let schemaReady = null;
function ensureSchema() {
  if (!sql) throw new Error('Falta configurar la base de datos (DATABASE_URL).');
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      // name/email: se agregaron para el registro abierto desde la landing
      // (public/landing.html) — las cuentas creadas a mano con SETUP_KEY
      // desde antes no tienen estos datos, por eso quedan nullable.
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL`;

      // Familiares colaboradores: se unen con un código en vez de crear su
      // propia bitácora. "invite_code" es el código que cada cuenta "dueña"
      // puede compartir; "owner_user_id" marca que ESTA cuenta es
      // colaboradora de la cuenta dueña (NULL = cuenta normal/dueña).
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_code TEXT`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS owner_user_id INT REFERENCES users(id)`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_code ON users(invite_code) WHERE invite_code IS NOT NULL`;

      // Nombres nuevos que se agregaron al árbol genealógico (por charla o
      // por reconstrucción) y todavía no se vieron en /arbol.html — para la
      // campanita de aviso en el ícono del árbol. JSON con la lista de
      // nombres; se vacía cuando la persona entra a ver el árbol.
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS tree_pending_names TEXT`;

      // sessions/resumen ya existían de una versión sin cuentas — se agrega
      // user_id de forma aditiva (nunca se borra nada existente).
      await sql`CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
        intercambios JSONB NOT NULL
      )`;
      await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`;

      await sql`CREATE TABLE IF NOT EXISTS resumen (
        id INT PRIMARY KEY DEFAULT 1,
        texto TEXT NOT NULL DEFAULT '',
        actualizado TIMESTAMPTZ
      )`;
      await sql`ALTER TABLE resumen ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id)`;
      // "id" era la clave primaria de la versión vieja (sin cuentas), con un
      // default constante (1) en vez de un contador — eso hacía chocar
      // cualquier fila nueva. La sacamos; user_id (con su índice único de
      // abajo) es la clave real ahora.
      await sql`ALTER TABLE resumen DROP CONSTRAINT IF EXISTS resumen_pkey`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_resumen_user ON resumen(user_id)`;

      // Aportes de la familia: historias escritas, y fotos/videos con descripción.
      await sql`CREATE TABLE IF NOT EXISTS family_notes (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id),
        contributor TEXT,
        texto TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      // discussed: si ya se le contó al dueño de la bitácora que un
      // familiar aportó esta historia (para abrir la próxima charla con
      // eso), igual que "discussed" en la tabla media de acá abajo.
      await sql`ALTER TABLE family_notes ADD COLUMN IF NOT EXISTS discussed BOOLEAN NOT NULL DEFAULT false`;
      await sql`ALTER TABLE family_notes ADD COLUMN IF NOT EXISTS audio_url TEXT`;
      await sql`CREATE INDEX IF NOT EXISTS idx_family_notes_user ON family_notes(user_id)`;

      await sql`CREATE TABLE IF NOT EXISTS media (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id),
        type TEXT NOT NULL,
        url TEXT NOT NULL,
        caption TEXT,
        contributor TEXT,
        discussed BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS idx_media_user ON media(user_id)`;

      // Log de historias detectadas dentro de la charla (no las que la
      // familia aporta a mano): cuando Claude nota que la respuesta fue una
      // historia completa, queda acá con el audio que ya se había subido.
      await sql`CREATE TABLE IF NOT EXISTS story_log (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id),
        texto TEXT NOT NULL,
        audio_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS idx_story_log_user ON story_log(user_id)`;

      // Capítulos de biografía generados con IA a partir de las historias
      // detectadas (story_log). Se reemplazan enteros cada vez que se piden
      // de nuevo, igual que el árbol genealógico.
      await sql`CREATE TABLE IF NOT EXISTS chapters (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id),
        title TEXT NOT NULL,
        theme TEXT,
        generated_text TEXT NOT NULL,
        story_ids TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      // story_ids se guarda como JSON (no array nativo de Postgres): el
      // driver de Neon por HTTP no bindea bien arrays de JS, mismo motivo
      // por el que "padres" de family_members también es TEXT con JSON.
      await sql`ALTER TABLE chapters ALTER COLUMN story_ids TYPE TEXT USING story_ids::text`;
      await sql`CREATE INDEX IF NOT EXISTS idx_chapters_user ON chapters(user_id)`;

      // Árbol genealógico y línea de tiempo: se reemplazan enteros cada vez
      // que se actualizan (más simple que ir haciendo diff a mano).
      await sql`CREATE TABLE IF NOT EXISTS family_members (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id),
        nombre TEXT NOT NULL,
        relacion TEXT NOT NULL,
        detalles TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      // padres: JSON con los nombres (tal cual aparecen acá) de los padres de
      // esta persona, para poder dibujar el árbol con las ramas reales en vez
      // de agrupar por generación nomás.
      await sql`ALTER TABLE family_members ADD COLUMN IF NOT EXISTS padres TEXT`;
      await sql`CREATE INDEX IF NOT EXISTS idx_family_members_user ON family_members(user_id)`;

      await sql`CREATE TABLE IF NOT EXISTS timeline_events (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id),
        descripcion TEXT NOT NULL,
        anio INT,
        edad_aprox INT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS categoria TEXT`;
      await sql`CREATE INDEX IF NOT EXISTS idx_timeline_events_user ON timeline_events(user_id)`;
    })();
  }
  return schemaReady;
}

// --- Sesión de login (cookie firmada, sin tabla de sesiones aparte) ---
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error('SESSION_SECRET no está definida — configurala en las variables de entorno para que el login sea seguro.');
}
const SESSION_COOKIE = 'bv_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 365; // 1 año, para no tener que loguearse siempre en el dispositivo físico

function signSession(payload) {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET || 'clave-insegura-configurar-SESSION_SECRET').update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function verifySession(token) {
  if (!token) return null;
  const idx = token.lastIndexOf('.');
  if (idx === -1) return null;
  const b64 = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET || 'clave-insegura-configurar-SESSION_SECRET').update(b64).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(b64, 'base64url').toString());
  } catch (e) {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function setSessionCookie(req, res, payload) {
  const token = signSession(payload);
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Max-Age=${SESSION_MAX_AGE}; Path=/; HttpOnly; SameSite=Lax${secure}`);
}

function clearSessionCookie(req, res) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`);
}

async function requireAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const session = verifySession(cookies[SESSION_COOKIE]);
  if (!session || !session.userId) {
    return res.status(401).json({ error: 'No autenticado.' });
  }
  req.userId = session.userId;
  req.username = session.username;
  // Una cuenta "colaboradora" (se unió con el código de otra familia, ver
  // /api/signup) no tiene bitácora propia — sus aportes van al perfil de
  // la cuenta dueña. req.profileUserId es a quién pertenecen los datos que
  // esta request debería leer/escribir; req.userId sigue siendo quién está
  // logueado en realidad.
  req.isCollaborator = false;
  req.profileUserId = session.userId;
  try {
    await ensureSchema();
    const rows = await sql`SELECT owner_user_id FROM users WHERE id = ${session.userId}`;
    if (rows[0] && rows[0].owner_user_id) {
      req.isCollaborator = true;
      req.profileUserId = rows[0].owner_user_id;
    }
  } catch (err) {
    console.error('No se pudo resolver si la cuenta es colaboradora:', err);
  }
  next();
}

// Para las rutas que son solo del dueño de la bitácora (charlar, ver el
// árbol, generar capítulos, etc.) — una cuenta colaboradora no tiene nada
// de eso, solo aporta historias y le pregunta a la bitácora.
function bloquearColaborador(req, res, next) {
  if (req.isCollaborator) {
    return res.status(403).json({ error: 'Esta función no está disponible para cuentas colaboradoras.' });
  }
  next();
}

app.get('/api/me', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const session = verifySession(cookies[SESSION_COOKIE]);
  if (!session) return res.status(401).json({ error: 'No autenticado.' });
  try {
    await ensureSchema();
    const rows = await sql`SELECT owner_user_id FROM users WHERE id = ${session.userId}`;
    const ownerUserId = rows[0] && rows[0].owner_user_id;
    let ownerName = null;
    if (ownerUserId) {
      const ownerRows = await sql`SELECT name, username FROM users WHERE id = ${ownerUserId}`;
      ownerName = capitalizarNombre((ownerRows[0] && (ownerRows[0].name || ownerRows[0].username)) || '') || null;
    }
    res.json({ username: session.username, isCollaborator: !!ownerUserId, ownerName });
  } catch (err) {
    console.error(err);
    res.json({ username: session.username, isCollaborator: false, ownerName: null });
  }
});

// Deja un nombre propio (o "Nombre Apellido") con mayúscula inicial en cada
// palabra — para cuando llega en minúsculas (a veces pasa con nombres
// dictados por voz, o tipeados de una sin pensarlo). Las partículas de
// apellidos compuestos (de, del, la, los, las, y) se dejan en minúscula
// salvo que sean la primera palabra.
const PARTICULAS_NOMBRE = new Set(['de', 'del', 'la', 'los', 'las', 'y']);
function capitalizarNombre(str) {
  const s = String(str || '').trim();
  if (!s) return s;
  return s
    .split(/\s+/)
    .map((palabra, i) => {
      const lower = palabra.toLowerCase();
      if (i > 0 && PARTICULAS_NOMBRE.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

// Deja en mayúscula la primera letra de un texto libre (respuesta,
// transcripción, historia) — no toca el resto, para no arruinar acrónimos
// o nombres propios que ya vengan bien escritos más adelante en el texto.
function capitalizarInicio(str) {
  const s = String(str || '');
  const m = s.match(/^(\s*)([\s\S])([\s\S]*)$/);
  if (!m) return s;
  return m[1] + m[2].toUpperCase() + m[3];
}

// Deriva una extensión de archivo razonable a partir del Content-Type de un
// audio — se usa tanto para el nombre que se guarda en Blob storage como
// para el nombre que se le manda a ElevenLabs (algunos formatos, como las
// notas de voz de WhatsApp .opus/.ogg o las de iPhone .m4a, se detectan
// mejor con la extensión correcta que con un .webm genérico).
const AUDIO_EXT_MAP = {
  'audio/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/3gpp': '3gp',
  'audio/3gpp2': '3g2',
  'audio/amr': 'amr',
  'audio/flac': 'flac',
};
function extensionForAudio(contentType) {
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (AUDIO_EXT_MAP[ct]) return AUDIO_EXT_MAP[ct];
  const sub = (ct.split('/')[1] || 'webm').replace(/^x-/, '').replace(/[^a-z0-9]/g, '').slice(0, 8);
  return sub || 'webm';
}

function randomInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I/L, se confunden al leer
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

app.get('/api/invite-code', requireAuth, async (req, res) => {
  try {
    if (req.isCollaborator) {
      return res.status(403).json({ error: 'Las cuentas colaboradoras no tienen código propio.' });
    }
    await ensureSchema();
    const rows = await sql`SELECT invite_code FROM users WHERE id = ${req.userId}`;
    if (rows[0] && rows[0].invite_code) return res.json({ code: rows[0].invite_code });
    let code;
    for (let intento = 0; intento < 5; intento++) {
      code = randomInviteCode();
      try {
        await sql`UPDATE users SET invite_code = ${code} WHERE id = ${req.userId}`;
        break;
      } catch (err) {
        if (err && err.code === '23505' && intento < 4) continue; // colisión rarísima: reintentar
        throw err;
      }
    }
    res.json({ code });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo generar el código.' });
  }
});

app.post('/api/register', rateLimit, async (req, res) => {
  try {
    const { username, password, setupKey } = req.body || {};
    if (!process.env.SETUP_KEY || setupKey !== process.env.SETUP_KEY) {
      return res.status(403).json({ error: 'Clave de configuración incorrecta.' });
    }
    if (!username || !password || String(password).length < 4) {
      return res.status(400).json({ error: 'Usuario y clave (mínimo 4 caracteres) son obligatorios.' });
    }
    const cleanUsername = String(username).trim().toLowerCase().slice(0, 50);
    if (!/^[a-z0-9_-]+$/.test(cleanUsername)) {
      return res.status(400).json({ error: 'El usuario solo puede tener letras, números, "-" y "_".' });
    }
    await ensureSchema();
    const existing = await sql`SELECT id FROM users WHERE username = ${cleanUsername}`;
    if (existing.length) return res.status(409).json({ error: 'Ese usuario ya existe.' });
    const hash = await bcrypt.hash(password, 10);
    await sql`INSERT INTO users (username, password_hash) VALUES (${cleanUsername}, ${hash})`;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo crear el usuario.' });
  }
});

// Registro abierto desde la landing pública (public/landing.html) — sin
// clave de invitación, a diferencia de /api/register (pensado para que
// Felipe cree cuentas a mano con SETUP_KEY). El correo hace de usuario
// para el login, así el formulario de "Usuario" que ya existe sigue
// funcionando sin tocarlo.
app.post('/api/signup', rateLimit, async (req, res) => {
  try {
    const { name, email, password, inviteCode } = req.body || {};
    const cleanName = capitalizarNombre(String(name || '').trim().slice(0, 100));
    const cleanEmail = String(email || '').trim().toLowerCase().slice(0, 200);
    if (!cleanName) return res.status(400).json({ error: 'Falta el nombre.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'El correo no parece válido.' });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: 'La clave debe tener al menos 6 caracteres.' });
    }
    await ensureSchema();
    const existing = await sql`SELECT id FROM users WHERE email = ${cleanEmail} OR username = ${cleanEmail}`;
    if (existing.length) return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });

    // Si viene un código de familia, esta cuenta es colaboradora de la
    // cuenta dueña de ese código — no arma su propia bitácora, solo aporta
    // historias y le pregunta a la de esa familia (ver bloquearColaborador).
    let ownerUserId = null;
    const cleanCode = String(inviteCode || '').trim().toUpperCase();
    if (cleanCode) {
      const ownerRows = await sql`SELECT id FROM users WHERE invite_code = ${cleanCode}`;
      if (!ownerRows.length) return res.status(400).json({ error: 'Ese código de familia no existe.' });
      ownerUserId = ownerRows[0].id;
    }

    const hash = await bcrypt.hash(password, 10);
    const rows = await sql`
      INSERT INTO users (username, name, email, password_hash, owner_user_id)
      VALUES (${cleanEmail}, ${cleanName}, ${cleanEmail}, ${hash}, ${ownerUserId})
      RETURNING id, username
    `;
    setSessionCookie(req, res, { userId: rows[0].id, username: rows[0].username });
    res.json({ ok: true, username: rows[0].username, isCollaborator: !!ownerUserId });
  } catch (err) {
    console.error(err);
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });
    }
    res.status(500).json({ error: 'No se pudo crear la cuenta.' });
  }
});

app.post('/api/login', rateLimit, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Faltan usuario o clave.' });
    await ensureSchema();
    const cleanUsername = String(username).trim().toLowerCase();
    const rows = await sql`SELECT id, username, password_hash FROM users WHERE username = ${cleanUsername}`;
    if (!rows.length) return res.status(401).json({ error: 'Usuario o clave incorrectos.' });
    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Usuario o clave incorrectos.' });
    setSessionCookie(req, res, { userId: rows[0].id, username: rows[0].username });
    res.json({ ok: true, username: rows[0].username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo iniciar sesión.' });
  }
});

app.post('/api/logout', (req, res) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

// Borra las charlas, el resumen y los aportes de la cuenta logueada, para
// empezar de cero. No borra la cuenta en sí (usuario/clave siguen sirviendo).
app.post('/api/reset-bitacora', requireAuth, bloquearColaborador, rateLimit, async (req, res) => {
  try {
    await ensureSchema();
    const s = await sql`DELETE FROM sessions WHERE user_id = ${req.userId} RETURNING id`;
    const r = await sql`DELETE FROM resumen WHERE user_id = ${req.userId} RETURNING user_id`;
    const n = await sql`DELETE FROM family_notes WHERE user_id = ${req.userId} RETURNING id`;
    const m = await sql`DELETE FROM media WHERE user_id = ${req.userId} RETURNING id`;
    const fm = await sql`DELETE FROM family_members WHERE user_id = ${req.userId} RETURNING id`;
    const te = await sql`DELETE FROM timeline_events WHERE user_id = ${req.userId} RETURNING id`;
    const sl = await sql`DELETE FROM story_log WHERE user_id = ${req.userId} RETURNING id`;
    const ch = await sql`DELETE FROM chapters WHERE user_id = ${req.userId} RETURNING id`;
    res.json({
      ok: true,
      deleted: {
        sessions: s.length,
        resumen: r.length,
        family_notes: n.length,
        media: m.length,
        family_members: fm.length,
        timeline_events: te.length,
        story_log: sl.length,
        chapters: ch.length,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo reiniciar la bitácora.' });
  }
});

async function loadMemorySummary(userId) {
  await ensureSchema();
  const rows = await sql`SELECT texto FROM resumen WHERE user_id = ${userId}`;
  return (rows[0] && rows[0].texto) || '';
}

// Historias y fotos/videos que la familia fue aportando, para que la
// entrevistadora los use y pregunte por las personas o momentos que aparecen.
async function loadFamilyContext(userId) {
  await ensureSchema();
  const notes = await sql`SELECT contributor, texto FROM family_notes WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 20`;
  const pending = await sql`SELECT id, type, caption, contributor FROM media WHERE user_id = ${userId} AND discussed = false ORDER BY created_at ASC LIMIT 1`;

  let text = '';
  if (notes.length) {
    text += `\n\nHistorias que OTROS familiares aportaron sobre ella (importante: esto NO es algo que ella te haya contado a ti — son reportes de otras personas. Puedes usarlas para profundizar o confirmar detalles, pero si las mencionas en la charla, siempre deja claro quién te la contó, por ejemplo "esto me lo contó tu hermana Marcela" — nunca se las atribuyas a la persona con la que estás hablando, ni des a entender que ella ya te lo había contado antes):\n${notes
      .map((n) => `- [${n.contributor || 'un familiar'}]: ${n.texto}`)
      .join('\n')}`;
  }
  if (pending.length) {
    const m = pending[0];
    const tipo = m.type === 'video' ? 'un video' : 'una foto';
    text += `\n\nLa familia subió ${tipo} (de ${m.contributor || 'un familiar'}) con esta descripción: "${m.caption || 'sin descripción'}". En algún momento de esta charla, pregúntale con naturalidad sobre eso (quién aparece, qué recuerda de ese momento) — no hace falta que sea lo primero que preguntes.`;
    sql`UPDATE media SET discussed = true WHERE id = ${m.id}`.catch(() => {});
  }
  return text;
}

// La historia más vieja que un colaborador aportó y todavía no se usó para
// abrir ninguna charla — se marca "discussed" apenas se usa, para no
// repetirla en la próxima sesión.
async function loadPendingFamilyNote(userId) {
  await ensureSchema();
  const rows = await sql`SELECT id, contributor, texto FROM family_notes WHERE user_id = ${userId} AND discussed = false ORDER BY created_at ASC LIMIT 1`;
  return rows[0] || null;
}

async function buildFullTranscripts(userId, keyword) {
  await ensureSchema();
  const rows = await sql`SELECT fecha, intercambios FROM sessions WHERE user_id = ${userId} ORDER BY fecha ASC`;
  if (!rows.length) return 'No hay charlas guardadas todavía.';

  let blocks = rows.map((s) => {
    const fecha = new Date(s.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    const lines = (s.intercambios || [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => (m.role === 'assistant' ? 'Entrevistadora: ' : 'Él contó: ') + m.content);
    return { fecha, lines };
  });

  if (keyword && keyword.trim()) {
    const k = keyword.trim().toLowerCase();
    const filtered = blocks
      .map((b) => ({ fecha: b.fecha, lines: b.lines.filter((l) => l.toLowerCase().includes(k)) }))
      .filter((b) => b.lines.length);
    if (filtered.length) blocks = filtered; // si no matchea nada, mejor devolver todo que quedarse corto
  }

  return blocks.map((b) => `--- Charla del ${b.fecha} ---\n${b.lines.join('\n')}`).join('\n\n');
}

async function updateMemorySummary(userId, newExchanges) {
  try {
    const anterior = await loadMemorySummary(userId);
    const nuevaCharla = (newExchanges || [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => (m.role === 'assistant' ? 'Entrevistadora: ' : 'Él contó: ') + m.content)
      .join('\n');

    if (!nuevaCharla.trim()) return;

    const prompt = `Resumen actual de la vida de esta persona (puede estar vacío si es la primera charla):\n${anterior || '(ninguno todavía)'}\n\nCharla nueva para integrar:\n${nuevaCharla}\n\nGenera un resumen actualizado, compacto (máximo 400 palabras), en español, en tercera persona, organizado en viñetas cortas por tema (identidad y familia, infancia, trabajo, momentos importantes, valores o consejos). Integra lo nuevo con lo anterior sin perder datos importantes ya guardados.`;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }],
    });

    const texto = response.content[0].text.trim();
    await ensureSchema();
    await sql`INSERT INTO resumen (user_id, texto, actualizado) VALUES (${userId}, ${texto}, now())
              ON CONFLICT (user_id) DO UPDATE SET texto = EXCLUDED.texto, actualizado = EXCLUDED.actualizado`;
  } catch (err) {
    console.error('No se pudo actualizar el resumen:', err);
  }
}

// --- Árbol genealógico y línea de tiempo ---
// Se extraen con "tool use" forzado: le pedimos a Claude una herramienta
// específica en vez de texto libre, así el resultado siempre tiene la
// forma exacta que esperamos (mucho más confiable que un marcador de texto).
const TREE_TOOLS = [{
  name: 'actualizar_arbol_y_linea_de_tiempo',
  description: 'Devuelve la lista completa y actualizada de familiares directos y de los hitos importantes de la vida de esta persona, integrando lo nuevo con lo que ya se sabía.',
  input_schema: {
    type: 'object',
    properties: {
      personas: {
        type: 'array',
        description: 'SOLO familia directa: papás, hermanos, abuelos, tíos, esposo/esposa (pareja YA CASADA), hijos, nietos, sobrinos, primos. NUNCA incluir novio/novia ni ex novio/ex novia (una pareja solo cuenta si está casada), ni amigos, ni compañeros de trabajo. Lista completa, no solo las nuevas.',
        items: {
          type: 'object',
          properties: {
            nombre: { type: 'string' },
            relacion: { type: 'string', description: 'Parentesco directo. Ej: papá, mamá, hermano mayor, abuela materna, tío, esposa, esposo, hijo, nieto, sobrino, primo. Nunca "novio" ni "novia".' },
            detalles: { type: 'string', description: 'Un dato breve si se conoce, opcional' },
            padres: {
              type: 'array',
              items: { type: 'string' },
              description: 'MUY IMPORTANTE para armar el árbol bien: nombres de esta persona reales padre/madre (o los dos), escritos EXACTAMENTE igual a como aparece su "nombre" en esta misma lista de personas, para poder conectar las ramas correctamente. Ej: si Ema es hija de Oscar, acá va ["Oscar"] (o ["Oscar","Paula Franco"] si se sabe también la mamá). Dejar vacío [] si es de la generación más alta (abuelos) o si no se sabe.',
            },
          },
          required: ['nombre', 'relacion'],
        },
      },
      eventos: {
        type: 'array',
        description: 'SOLO hitos importantes de la vida (nacimientos, cumpleaños, viajes, graduaciones, matrimonios, muertes u otra fecha realmente significativa). NUNCA charla cotidiana, opiniones, gustos, ni planes sin confirmar. Lista completa, ordenada cronológicamente si se puede.',
        items: {
          type: 'object',
          properties: {
            descripcion: { type: 'string' },
            categoria: { type: 'string', enum: ['nacimiento', 'cumpleaños', 'viaje', 'graduación', 'matrimonio', 'muerte', 'otro hito importante'] },
            anio: { type: 'number', description: 'Año aproximado si se puede inferir; si no, omitir' },
            edad_aprox: { type: 'number', description: 'Edad aproximada de la persona en ese momento, si se sabe; si no, omitir' },
          },
          required: ['descripcion', 'categoria'],
        },
      },
    },
    required: ['personas', 'eventos'],
  },
}];

// Respaldo determinístico: si el modelo dejó "padres" vacío en los casos más
// obvios (sujeto principal, papá/mamá, tíos), lo completamos por regla fija
// en vez de depender solo de que la IA lo infiera bien.
function inferirPadresFaltantes(personas) {
  const porRelacionExacta = (re) => personas.filter((p) => re.test((p.relacion || '').trim()));
  const papaNode = porRelacionExacta(/^pap[aá]$/i)[0];
  const mamaNode = porRelacionExacta(/^mam[aá]$/i)[0];
  const abuelosPaternos = porRelacionExacta(/^abuel[oa] patern[oa]$/i).map((p) => p.nombre);
  const abuelosMaternos = porRelacionExacta(/^abuel[oa] matern[oa]$/i).map((p) => p.nombre);

  personas.forEach((p) => {
    if (Array.isArray(p.padres) && p.padres.length) return; // ya lo trajo la IA, no tocar
    const rel = (p.relacion || '').trim().toLowerCase();
    if (rel === 'sujeto principal' && papaNode && mamaNode) {
      p.padres = [papaNode.nombre, mamaNode.nombre];
    } else if (/^pap[aá]$/.test(rel) && abuelosPaternos.length) {
      p.padres = abuelosPaternos.slice(0, 2);
    } else if (/^mam[aá]$/.test(rel) && abuelosMaternos.length) {
      p.padres = abuelosMaternos.slice(0, 2);
    } else if (/^t[ií]o paterno$|^t[ií]a paterna$/.test(rel) && abuelosPaternos.length) {
      p.padres = abuelosPaternos.slice(0, 2);
    } else if (/^t[ií]o materno$|^t[ií]a materna$/.test(rel) && abuelosMaternos.length) {
      p.padres = abuelosMaternos.slice(0, 2);
    } else if (/hermano|hermana/.test(rel) && papaNode && mamaNode) {
      p.padres = [papaNode.nombre, mamaNode.nombre];
    }
  });
  return personas;
}

function parseJsonArray(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function updateFamilyTree(userId, newExchanges) {
  try {
    const nuevaCharla = (newExchanges || [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => (m.role === 'assistant' ? 'Entrevistadora: ' : 'Él contó: ') + m.content)
      .join('\n');
    if (!nuevaCharla.trim()) return;

    await ensureSchema();
    const personasPreviasRaw = await sql`SELECT nombre, relacion, detalles, padres FROM family_members WHERE user_id = ${userId}`;
    const personasPrevias = personasPreviasRaw.map((p) => ({ ...p, padres: parseJsonArray(p.padres) }));
    const eventosPrevios = await sql`SELECT descripcion, anio, edad_aprox, categoria FROM timeline_events WHERE user_id = ${userId} ORDER BY anio NULLS LAST, id`;

    const prompt = `Personas ya conocidas:\n${JSON.stringify(personasPrevias)}\n\nEventos ya conocidos:\n${JSON.stringify(eventosPrevios)}\n\nCharla nueva para integrar:\n${nuevaCharla}\n\nUsa la herramienta para devolver la lista COMPLETA actualizada de personas y eventos (lo anterior + lo nuevo, sin perder nada, corrigiendo si hay datos más precisos). Recuerda las reglas: personas SOLO de la familia directa (nada de novio/novia, solo esposo/a si está casado/a); para cada persona completa "padres" con los nombres exactos de su papá y/o mamá tal como aparecen en esta misma lista, siempre que se pueda inferir (por ejemplo, por los "detalles" ya guardados tipo "hija de Oscar"); eventos SOLO hitos importantes (nacimiento, cumpleaños, viaje, graduación, matrimonio, muerte), nada de charla cotidiana ni planes sin confirmar. Si alguna persona o evento ya guardado no cumple estas reglas, quítalo de la lista.`;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2500,
      tools: TREE_TOOLS,
      tool_choice: { type: 'tool', name: 'actualizar_arbol_y_linea_de_tiempo' },
      messages: [{ role: 'user', content: prompt }],
    });

    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse || !toolUse.input) return;
    // Filtro defensivo por si el modelo se cuela: nada de novio/novia en el árbol.
    const personas = inferirPadresFaltantes(
      (Array.isArray(toolUse.input.personas) ? toolUse.input.personas : [])
        .filter((p) => p && p.nombre && p.relacion && !/\bnovi[oa]\b/i.test(p.relacion))
        .slice(0, 60)
    ).map((p) => ({
      ...p,
      nombre: capitalizarNombre(p.nombre),
      padres: Array.isArray(p.padres) ? p.padres.map(capitalizarNombre) : p.padres,
    }));
    const eventos = Array.isArray(toolUse.input.eventos) ? toolUse.input.eventos.slice(0, 100) : [];

    // Para la campanita de aviso en el ícono del árbol: nombres que
    // aparecen ahora y no estaban en la lista previa.
    const nombresPrevios = new Set(personasPrevias.map((p) => p.nombre));
    const nombresNuevos = personas.map((p) => p.nombre).filter((n) => !nombresPrevios.has(n));
    if (nombresNuevos.length) {
      const rows = await sql`SELECT tree_pending_names FROM users WHERE id = ${userId}`;
      const pendientes = new Set(parseJsonArray(rows[0] && rows[0].tree_pending_names));
      nombresNuevos.forEach((n) => pendientes.add(n));
      await sql`UPDATE users SET tree_pending_names = ${JSON.stringify(Array.from(pendientes))} WHERE id = ${userId}`;
    }

    await sql`DELETE FROM family_members WHERE user_id = ${userId}`;
    for (const p of personas) {
      const padres = Array.isArray(p.padres) ? p.padres.filter((x) => typeof x === 'string' && x.trim()).slice(0, 2) : [];
      await sql`INSERT INTO family_members (user_id, nombre, relacion, detalles, padres) VALUES (
        ${userId}, ${String(p.nombre).slice(0, 120)}, ${String(p.relacion).slice(0, 80)}, ${p.detalles ? capitalizarInicio(String(p.detalles).slice(0, 300)) : null}, ${padres.length ? JSON.stringify(padres) : null}
      )`;
    }

    await sql`DELETE FROM timeline_events WHERE user_id = ${userId}`;
    for (const e of eventos) {
      if (!e || !e.descripcion) continue;
      const anio = Number.isFinite(e.anio) ? Math.round(e.anio) : null;
      const edad = Number.isFinite(e.edad_aprox) ? Math.round(e.edad_aprox) : null;
      const categoria = e.categoria ? String(e.categoria).slice(0, 40) : null;
      await sql`INSERT INTO timeline_events (user_id, descripcion, anio, edad_aprox, categoria) VALUES (
        ${userId}, ${capitalizarInicio(String(e.descripcion).slice(0, 300))}, ${anio}, ${edad}, ${categoria}
      )`;
    }
  } catch (err) {
    console.error('No se pudo actualizar el árbol genealógico:', err);
  }
}

const ARBOL_SYSTEM_PROMPT = `Eres una entrevistadora cálida y paciente, colombiana, que está ayudando a armar el árbol genealógico de una persona mayor. Hablas en español de Colombia, tuteando siempre (usa "tú", nunca "usted" ni "vos"), con oraciones simples y cortas, fáciles de escuchar en voz alta.

Esta charla es distinta a las charlas normales: no se trata de contar anécdotas largas, sino de ir armando con calidez la lista de su familia — quiénes son, cómo se llaman, cómo se relacionan con ella. Tus reacciones son breves (una frase corta, no un párrafo) para poder cubrir más gente.

Reglas:
- Una sola pregunta por turno.
- Anda cubriendo, en este orden aproximado (sin ser rígida si la persona ya adelantó algo): sus papás (nombres), sus hermanos (nombres, si es mayor o menor), sus abuelos por los dos lados (nombres, si los llegó a conocer), sus tíos más cercanos, si tiene pareja (nombre), y si tiene hijos (nombres).
- Para cada persona, si hay lugar, pide un dato breve que la identifique (a qué se dedicaba, cómo era) — pero sin extenderte, esto es para saber quién es quién, no para contar toda su historia.
- Modismos colombianos suaves y variados (qué más, listo, de una, qué chévere, ¿cierto?, pues sí, qué belleza) sin exagerar, nunca jerga juvenil ni groserías.
- Cuando sientas que ya cubriste una buena parte del árbol familiar (generalmente entre 10 y 18 intercambios, o antes si la persona no tiene mucho más para agregar), cierra con un mensaje cálido agradeciendo, avisando que el árbol quedó guardado, e invitando a retomar las charlas normales o seguir el árbol otro día. Termina ese mensaje, y solo ese, con la palabra exacta [FIN] en una línea aparte.
- Nunca uses [FIN] excepto en ese cierre.
- Si más abajo hay personas ya conocidas, no vuelvas a preguntar por ellas.`;

const SYSTEM_PROMPT = `Eres una entrevistadora cálida y paciente, colombiana, que ayuda a una persona mayor a contar la historia de su vida. Hablas en español de Colombia, tuteando siempre a la persona (usa "tú", nunca "usted" ni "vos": "¿cómo estás?", "cuéntame", "tienes"), con oraciones simples y cortas, fáciles de escuchar en voz alta.

Usa modismos colombianos suaves y variados, propios de un trato respetuoso con una persona mayor (por ejemplo: "qué más", "listo", "de una", "qué chévere", "¿cierto?", "pues sí", "qué belleza", "qué interesante", "cuéntame más", "ay, no", "qué pena", "imagínate", "eso sí", "uy") — varía cuál usas en cada turno, no repitas siempre las mismas dos o tres. Nunca jerga juvenil o vulgar como "bacano", "berraquera" o groserías. El tono es animado y cercano, pero con la calidez respetuosa con la que se habla con un mayor, no como con un amigo de la misma edad.

Esto es una charla de sobremesa, no un cuestionario. Antes de pasar a otra cosa, reacciona de verdad a lo que te acaban de contar: comenta algo, ríete si hay algo gracioso, sorpréndete, o pide un detalle más ("¿y qué pasó después?", "¿en serio? cuéntame más de eso") antes de avanzar a otro tema. Alterna entre preguntas cortas y comentarios — no todos los turnos tienen que terminar en pregunta.

Reglas:
- El corazón de esta charla es SIEMPRE el pasado, nunca el presente. Cada pregunta que hagas tiene que apuntar a su historia — infancia, familia, juventud, trabajo, momentos que la marcaron — nunca a su día a día actual (qué hizo hoy, cómo durmió, qué está haciendo la familia ahora, planes de esta semana, etc.).
- Si en tu respuesta anterior preguntaste algo del presente (por ejemplo "¿cómo estás?" para saludar), tu SIGUIENTE pregunta tiene que ser sí o sí sobre el pasado — no sigas charlando del presente ni encadenes otra pregunta del día a día.
- Una sola idea por turno: o preguntas, o comentas, nunca varias preguntas juntas.
- Empieza siempre por conocer a la persona: su nombre, el nombre de sus papás, sus hermanos, tíos cercanos, y si llegó a conocer a sus abuelos y cómo se llamaban.
- Después avanza naturalmente hacia su infancia, juventud, trabajo, momentos de orgullo, desafíos superados, y algún consejo o mensaje para su familia.
- Escucha de verdad lo que cuenta: si menciona algo interesante (un nombre, un lugar, una anécdota), profundiza en eso antes de seguir con el guion. No sigas un orden rígido.
- Cuando cuente una historia larga y completa (un recuerdo elaborado, no un dato corto) y no haya dicho en qué año fue ni qué edad tenía, tu siguiente turno tiene que preguntarlo de forma natural (por ejemplo "¿en qué año fue eso?" o "¿cuántos años tenías más o menos?") antes de pasar a otro tema — ayuda mucho a poder armar bien la línea de su vida más adelante. No lo preguntes si ya lo dijo, ni en respuestas cortas que no son historias.
- Tono cálido, agradecido, sin apuro.
- Cuando sientas que la charla ya cubrió una historia rica y completa (generalmente entre 12 y 20 intercambios), cierra con un mensaje cálido de despedida agradeciendo lo compartido, avisando que quedó guardado, e invitando a seguir otro día. Termina ese mensaje final, y solo ese, con la palabra exacta [FIN] en una línea aparte.
- Nunca uses la palabra [FIN] excepto en ese cierre.
- Si más abajo hay un resumen de charlas anteriores, no vuelvas a preguntar nada que ya está ahí (nombre, familia, etc.). Saluda siempre por su nombre si el resumen lo tiene (ej: "¡Hola, Felipe!"), y arranca yendo directo a un tema nuevo, o profundizando en algo que quedó pendiente.`;

const HISTORIA_MIN_CHARS = 180; // umbral simple: una respuesta larga y elaborada = historia; un dato corto no.

async function loadKnownFamilyMembers(userId) {
  await ensureSchema();
  const rows = await sql`SELECT nombre, relacion, detalles FROM family_members WHERE user_id = ${userId}`;
  if (!rows.length) return '';
  return `\n\nPersonas que ya se conocen (no vuelvas a preguntar por estas, prioriza las que faltan):\n${rows
    .map((p) => `- ${capitalizarNombre(p.nombre)} (${p.relacion})${p.detalles ? ': ' + p.detalles : ''}`)
    .join('\n')}`;
}

app.post('/api/next', requireAuth, bloquearColaborador, rateLimit, async (req, res) => {
  try {
    const history = Array.isArray(req.body.history) ? req.body.history.slice(0, 60) : [];
    for (const m of history) {
      if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
        return res.status(400).json({ error: 'Historial inválido.' });
      }
      if (m.content.length > 4000) m.content = m.content.slice(0, 4000);
    }
    const mode = req.body.mode === 'arbol' ? 'arbol' : 'historia';
    const memoria = await loadMemorySummary(req.userId);
    const esPrimeraVez = mode === 'historia' && !memoria && !history.length;
    // Si un colaborador aportó una historia y todavía no se la contamos al
    // dueño de la bitácora, esta es la próxima charla nueva que arranca —
    // el momento justo para abrir con eso, no la primera vez (esa ya tiene
    // su propia bienvenida) ni en medio de una charla ya empezada.
    const notaPendiente = mode === 'historia' && !esPrimeraVez && !history.length
      ? await loadPendingFamilyNote(req.userId)
      : null;
    const startPrompt = mode === 'arbol'
      ? '(La persona acaba de presionar el botón para armar el árbol genealógico. Salúdala cálidamente por su nombre si lo sabes, cuéntale brevemente que hoy vas a preguntarle por su familia para armar el árbol, y arranca preguntando por la primera persona que falte — revisa la lista de "personas que ya se conocen" más abajo antes de preguntar, y si ya están sus papás, salta directo a hermanos, abuelos, tíos, pareja o hijos, lo que falte.)'
      : esPrimeraVez
      ? '(La persona acaba de presionar el botón por PRIMERA VEZ — todavía no hay ningún resumen guardado de ella, así que este es su primer mensaje en la aplicación. Antes de preguntar nada, dale una bienvenida cálida y explícale brevemente de qué se trata esto: que vas a ir charlando con ella de a poco para guardar su historia de vida con su propia voz, para que su familia la pueda escuchar y leer después. Cuéntale que no hay respuestas correctas ni incorrectas, que puede contar lo que quiera y como quiera, con sus propias palabras, sin apurarse ni preocuparse por el orden. Dale un tip breve para sentirse cómoda hablando sola, por ejemplo imaginarse que le está contando esto a un nieto o a alguien muy querido. Después de esa bienvenida breve (unas 3-4 frases, no más), pregúntale su nombre, y aprovecha para pedirle también su edad y su fecha de nacimiento, para tener esos datos básicos guardados desde el principio. Todo esto en un solo mensaje de bienvenida, cálido y no muy largo — no lo separes en varios turnos.)'
      : notaPendiente
      ? `(La persona acaba de presionar el botón para empezar a charlar. Salúdala por su nombre si lo sabes. Antes de preguntar cualquier otra cosa, cuéntale que ${notaPendiente.contributor || 'un familiar'} aportó una historia sobre ella — algo en la línea de: "Quiero contarte que estuve hablando con ${notaPendiente.contributor || 'tu familia'} y me contó una historia sobre ti que trata de..." (adapta el género y la frase para que suene natural, no la copies literal). Lo que contó fue esto: "${String(notaPendiente.texto).slice(0, 400)}". Después de contarle eso con calidez, pregúntale qué recuerda de esa historia o si quiere contarte su propia versión, y deja que la charla se desarrolle desde ahí con naturalidad, como el resto de las charlas.)`
      : '(La persona acaba de presionar el botón para empezar a charlar. Si el resumen tiene su nombre, salúdala por su nombre. Si no, salúdala cálidamente y pregúntale cómo se llama.)';
    const messages = history.length ? history : [{ role: 'user', content: startPrompt }];
    if (notaPendiente) {
      await sql`UPDATE family_notes SET discussed = true WHERE id = ${notaPendiente.id}`;
    }

    let system;
    if (mode === 'arbol') {
      const conocidos = await loadKnownFamilyMembers(req.userId);
      system = ARBOL_SYSTEM_PROMPT + conocidos;
    } else {
      const familia = await loadFamilyContext(req.userId);
      system =
        SYSTEM_PROMPT +
        (memoria ? `\n\nResumen de charlas anteriores (no repitas lo que ya está acá):\n${memoria}` : '') +
        familia;
    }

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system,
      messages,
    });

    let text = response.content[0].text.trim();
    const done = text.includes('[FIN]');
    text = text.replace('[FIN]', '').trim();

    // Los mensajes "sintéticos" que le mandamos a Claude por dentro (avisos
    // de que se presionó un botón, no algo que la persona realmente dijo)
    // van siempre entre paréntesis — se excluyen del log de historias.
    const ultimaRespuesta = [...history].reverse().find((m) => m.role === 'user' && !/^\(.*\)$/.test(m.content.trim()));
    if (ultimaRespuesta && ultimaRespuesta.content.length >= HISTORIA_MIN_CHARS) {
      const audioUrl = typeof req.body.lastAudioUrl === 'string' ? req.body.lastAudioUrl.slice(0, 1000) : null;
      try {
        await sql`INSERT INTO story_log (user_id, texto, audio_url) VALUES (${req.userId}, ${capitalizarInicio(ultimaRespuesta.content)}, ${audioUrl})`;
      } catch (err) {
        console.error('No se pudo guardar en story_log:', err);
      }
    }

    res.json({ message: text, done });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo generar la siguiente pregunta.' });
  }
});

const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;

const AZURE_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_REGION = process.env.AZURE_SPEECH_REGION;
const AZURE_VOICE_NAME = 'es-CO-SalomeNeural';

function escapeSsml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function speakWithElevenLabs(text) {
  const resp = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVEN_KEY,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_flash_v2_5', // la mitad de precio por caracter que multilingual_v2, y más rápido
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );
  if (!resp.ok) throw new Error(`ElevenLabs ${resp.status}: ${await resp.text()}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function speakWithAzure(text) {
  const ssml = `<speak version="1.0" xml:lang="es-CO"><voice name="${AZURE_VOICE_NAME}">${escapeSsml(text)}</voice></speak>`;
  const resp = await fetch(
    `https://${AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_KEY,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
      },
      body: ssml,
    }
  );
  if (!resp.ok) throw new Error(`Azure ${resp.status}: ${await resp.text()}`);
  return Buffer.from(await resp.arrayBuffer());
}

app.post('/api/transcribe', requireAuth, rateLimit, express.raw({ type: '*/*', limit: '20mb' }), async (req, res) => {
  try {
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'Falta audio.' });
    if (!ELEVEN_KEY) {
      return res.status(501).json({ error: 'ElevenLabs no está configurado, no se puede transcribir.' });
    }

    const contentType = req.get('Content-Type') || 'audio/webm';
    const formData = new FormData();
    formData.append('model_id', 'scribe_v1');
    formData.append('language_code', 'spa');
    formData.append('file', new Blob([req.body], { type: contentType }), `audio.${extensionForAudio(contentType)}`);

    const resp = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': ELEVEN_KEY },
      body: formData,
    });

    if (!resp.ok) {
      console.error('ElevenLabs STT error:', resp.status, await resp.text());
      return res.status(502).json({ error: 'No se pudo transcribir el audio.' });
    }

    const data = await resp.json();
    res.json({ text: (data.text || '').trim() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo transcribir el audio.' });
  }
});

app.post('/api/speak', requireAuth, rateLimit, async (req, res) => {
  try {
    let text = (req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Falta texto.' });
    if (text.length > 2000) text = text.slice(0, 2000);

    let buffer;
    if (ELEVEN_KEY && ELEVEN_VOICE_ID) {
      buffer = await speakWithElevenLabs(text);
    } else if (AZURE_KEY && AZURE_REGION) {
      buffer = await speakWithAzure(text);
    } else {
      return res.status(501).json({ error: 'No hay proveedor de voz configurado.' });
    }

    res.set('Content-Type', 'audio/mpeg');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo generar la voz.' });
  }
});

app.post('/api/save-audio', requireAuth, bloquearColaborador, express.raw({ type: '*/*', limit: '20mb' }), async (req, res) => {
  try {
    const { sessionId, index, role } = req.query;
    if (!sessionId || index === undefined || !role) {
      return res.status(400).json({ error: 'Faltan datos.' });
    }
    // Todo lo que compone el nombre del archivo viene de la URL — se sanitiza
    // fuerte antes de usarlo como ruta.
    const safeSession = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
    const safeRole = String(role).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20);
    const safeIndex = String(index).replace(/[^0-9]/g, '').slice(0, 10);
    if (!safeSession || !safeRole || !safeIndex) {
      return res.status(400).json({ error: 'Datos inválidos.' });
    }
    const contentType = req.get('Content-Type') || 'audio/webm';
    const ext = contentType.includes('mpeg') ? 'mp3' : 'webm';
    const filename = `audio/${req.userId}/${safeSession}/${safeRole}-${safeIndex}.${ext}`;

    const blob = await put(filename, req.body, { access: 'public', contentType, addRandomSuffix: true });
    res.json({ ok: true, file: blob.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar el audio.' });
  }
});

app.post('/api/contribute-story', requireAuth, rateLimit, async (req, res) => {
  try {
    let { contributor, text, audioUrl } = req.body || {};
    text = capitalizarInicio((text || '').trim());
    if (!text) return res.status(400).json({ error: 'Falta el texto de la historia.' });
    if (text.length > 4000) text = text.slice(0, 4000);
    const cleanContributor = capitalizarNombre((contributor || '').trim().slice(0, 60)) || null;
    const cleanAudioUrl = typeof audioUrl === 'string' ? audioUrl.slice(0, 1000) : null;

    await ensureSchema();
    await sql`INSERT INTO family_notes (user_id, contributor, texto, audio_url) VALUES (${req.profileUserId}, ${cleanContributor}, ${text}, ${cleanAudioUrl})`;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar la historia.' });
  }
});

// Sube el audio de un aporte (colaborador contando una historia con su voz)
// a Blob storage — separado de /api/save-audio porque ese está pensado para
// las charlas normales (sessionId/index/role) y este no tiene esa forma.
app.post('/api/contribute-audio', requireAuth, express.raw({ type: '*/*', limit: '20mb' }), async (req, res) => {
  try {
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'Falta el audio.' });
    const contentType = req.get('Content-Type') || 'audio/webm';
    const filename = `audio/aportes/${req.profileUserId}/${Date.now()}.${extensionForAudio(contentType)}`;
    const blob = await put(filename, req.body, { access: 'public', contentType, addRandomSuffix: true });
    res.json({ ok: true, url: blob.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar el audio.' });
  }
});

// Sugerencia breve, generada con IA, de qué podría contar quien va a
// aportar una historia — usa los nombres y fechas ya conocidos del árbol
// y del resumen para ayudar a ubicar mejor lo que cuente.
app.get('/api/contribute-intro', requireAuth, rateLimit, async (req, res) => {
  try {
    await ensureSchema();
    const conocidos = await loadKnownFamilyMembers(req.profileUserId);
    const memoria = await loadMemorySummary(req.profileUserId);
    const ownerRow = await sql`SELECT name FROM users WHERE id = ${req.profileUserId}`;
    const ownerNombre = (ownerRow[0] && ownerRow[0].name) || null;

    if (!conocidos && !memoria) {
      return res.json({
        intro: `Cuenta cualquier recuerdo que tengas${ownerNombre ? ' de ' + ownerNombre : ''} — una anécdota, una costumbre, algo gracioso o algo importante. Si puedes ubicarlo con una fecha aproximada o con los nombres de quienes estaban ahí, mejor: eso ayuda a encajarlo con el resto de su historia.`,
      });
    }

    const prompt = `Vas a ayudar a preparar a un familiar (el colaborador) que va a grabar, con su propia voz, un recuerdo o anécdota sobre la vida de ${ownerNombre || 'esta persona'} para sumarlo a su bitácora de vida.

Importante sobre a quién le hablas: le hablas al COLABORADOR, no a ${ownerNombre || 'la persona'}. Los datos de abajo (personas conocidas, resumen) describen la vida de ${ownerNombre || 'esta persona'} — las relaciones familiares que aparecen ahí (papá, tío, hermano, etc.) son respecto a ${ownerNombre || 'esa persona'}, NO respecto al colaborador. Nunca digas "tu tío Juan" ni nada que dé a entender que esas personas son familiares del colaborador: di simplemente "Juan" o, si hace falta aclarar, "Juan, el tío de ${ownerNombre || 'ella'}". El colaborador puede haber vivido ese momento junto a ${ownerNombre || 'esta persona'} o haberlo escuchado contar — la historia es sobre la vida de ${ownerNombre || 'esta persona'}, no sobre la del colaborador.

Con lo que ya se sabe (abajo), escribe una invitación breve y cálida (2-3 frases, español de Colombia, tuteo, nunca "vos" ni "usted") sugiriéndole al colaborador de qué podría hablar — idealmente algo que todavía no esté cubierto, o que ayude a completar un hueco. Si hay nombres, lugares o fechas conocidas que sirvan para ubicar mejor la historia (por ejemplo una época, una casa, una persona presente), menciónalos con la aclaración de a quién pertenecen (ej: "la casa en Los Andes donde vivió ${ownerNombre || 'ella'}"), para que el colaborador pueda anclar su recuerdo a eso. No inventes datos que no estén abajo.

${conocidos || ''}
${memoria ? `\nResumen de lo que ya se ha contado:\n${memoria.slice(0, 1500)}` : ''}`;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    const intro = response.content[0].text.trim();
    res.json({ intro });
  } catch (err) {
    console.error(err);
    res.json({
      intro: 'Cuenta cualquier recuerdo que tengas — una anécdota, una costumbre, algo gracioso o algo importante. Si puedes ubicarlo con una fecha aproximada o con los nombres de quienes estaban ahí, mejor.',
    });
  }
});

// Límite bajo a propósito: las funciones serverless de Vercel no aceptan
// cuerpos de pedido grandes (tope real ~4.5MB). Para fotos alcanza; para
// videos largos hace falta otro mecanismo de subida que todavía no armamos.
app.post('/api/contribute-media', requireAuth, express.raw({ type: '*/*', limit: '4mb' }), async (req, res) => {
  try {
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'Falta el archivo.' });
    const { contributor, caption } = req.query;
    const contentType = req.get('Content-Type') || 'application/octet-stream';
    const type = contentType.startsWith('video') ? 'video' : 'foto';
    const cleanContributor = capitalizarNombre(String(contributor || '').trim().slice(0, 60)) || null;
    const cleanCaption = String(caption || '').trim().slice(0, 500) || null;
    const ext = (contentType.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 10) || 'bin';

    const blob = await put(`media/${req.profileUserId}/${type}-${Date.now()}.${ext}`, req.body, {
      access: 'public',
      contentType,
      addRandomSuffix: true,
    });

    await ensureSchema();
    await sql`INSERT INTO media (user_id, type, url, caption, contributor) VALUES (${req.profileUserId}, ${type}, ${blob.url}, ${cleanCaption}, ${cleanContributor})`;
    res.json({ ok: true, url: blob.url, type });
  } catch (err) {
    console.error(err);
    if (err && err.message && err.message.includes('request entity too large')) {
      return res.status(413).json({ error: 'El archivo es muy grande (máximo 4MB por ahora).' });
    }
    res.status(500).json({ error: 'No se pudo subir el archivo.' });
  }
});

app.get('/api/contributions', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const notesRaw = await sql`SELECT contributor, texto, audio_url, created_at FROM family_notes WHERE user_id = ${req.profileUserId} ORDER BY created_at DESC LIMIT 30`;
    const mediaRaw = await sql`SELECT type, url, caption, contributor, created_at FROM media WHERE user_id = ${req.profileUserId} ORDER BY created_at DESC LIMIT 30`;
    const notes = notesRaw.map((n) => ({ ...n, contributor: capitalizarNombre(n.contributor), texto: capitalizarInicio(n.texto) }));
    const media = mediaRaw.map((m) => ({ ...m, contributor: capitalizarNombre(m.contributor) }));
    res.json({ notes, media });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar los aportes.' });
  }
});

app.get('/api/story-log', requireAuth, bloquearColaborador, async (req, res) => {
  try {
    await ensureSchema();
    const rows = await sql`SELECT texto, audio_url, created_at FROM story_log WHERE user_id = ${req.userId} ORDER BY created_at DESC LIMIT 50`;
    res.json({ stories: rows.map((r) => ({ ...r, texto: capitalizarInicio(r.texto) })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar el log de historias.' });
  }
});

// --- Capítulos de biografía (generación con IA en dos pasos) ---
// Paso 1: agrupar las historias detectadas por tema/época que realmente
// aparecen en el material. Paso 2: por cada grupo, armar un capítulo
// narrativo corto usando SOLO esas transcripciones. Separar los dos pasos
// (en vez de uno solo) hace que cada llamado sea más chico y más fácil de
// revisar si algo sale mal.
const CHAPTER_CLASSIFY_TOOLS = [{
  name: 'agrupar_historias_por_tema',
  description: 'Agrupa las historias detectadas por tema o época de vida que realmente aparecen en el contenido (no una lista fija predefinida).',
  input_schema: {
    type: 'object',
    properties: {
      grupos: {
        type: 'array',
        description: 'Temas o épocas de vida que emergen de las historias, cada uno con las historias que le corresponden.',
        items: {
          type: 'object',
          properties: {
            theme: { type: 'string', description: 'Nombre corto del tema o época. Ej: Infancia, El trabajo, La cocina, Su primera novia' },
            story_ids: { type: 'array', items: { type: 'number' }, description: 'Los ids (número) de las historias que pertenecen a este tema, tal como aparecen en el listado.' },
          },
          required: ['theme', 'story_ids'],
        },
      },
    },
    required: ['grupos'],
  },
}];

const CHAPTER_WRITE_TOOLS = [{
  name: 'escribir_capitulo',
  description: 'Escribe un capítulo narrativo corto que hilvane las historias dadas, sin inventar nada que no esté en el texto fuente.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Título corto para el capítulo' },
      generated_text: { type: 'string', description: 'El capítulo en prosa (2 a 4 párrafos), fiel a las transcripciones fuente' },
    },
    required: ['title', 'generated_text'],
  },
}];

async function classifyStoriesByTheme(stories) {
  const listado = stories
    .map((s) => `#${s.id} (${new Date(s.created_at).toLocaleDateString('es-CO')}): ${s.texto}`)
    .join('\n\n');
  const prompt = `Estas son las historias detectadas en las charlas de esta persona (id, fecha, transcripción):\n\n${listado}\n\nProponé una lista de temas o épocas de vida que REALMENTE aparecen en este material (que emerja de lo contado, no uses una lista fija predefinida), y para cada tema indica qué ids de historias corresponden (cada historia va en un solo tema, el que mejor le quede). Usa la herramienta para responder.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    tools: CHAPTER_CLASSIFY_TOOLS,
    tool_choice: { type: 'tool', name: 'agrupar_historias_por_tema' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse || !toolUse.input || !Array.isArray(toolUse.input.grupos)) return [];
  return toolUse.input.grupos.slice(0, 12); // tope defensivo de temas por corrida
}

async function writeChapterFromStories(theme, stories) {
  const fuente = stories.map((s) => `- ${s.texto}`).join('\n\n');
  const prompt = `Estas son transcripciones textuales de historias que esta persona contó sobre el tema "${theme}":\n\n${fuente}\n\nArma un capítulo narrativo corto (2 a 4 párrafos), narrado en tercera persona, con un tono cálido de libro de memorias familiares, que hilvane estas historias. USA SOLO lo que está en las transcripciones de arriba — nunca inventes ni completes fechas, nombres, lugares o eventos que no estén ahí. Si falta contexto para que un párrafo fluya elegante, prefiere una frase más simple pero fiel a lo dicho, antes que una elegante pero inventada. Ponle también un título corto al capítulo. Usa la herramienta para responder.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    tools: CHAPTER_WRITE_TOOLS,
    tool_choice: { type: 'tool', name: 'escribir_capitulo' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse || !toolUse.input || !toolUse.input.generated_text) return null;
  return {
    title: toolUse.input.title ? String(toolUse.input.title).slice(0, 200) : theme,
    generated_text: String(toolUse.input.generated_text),
  };
}

// Dispara el flujo de dos pasos y GUARDA el resultado, reemplazando los
// capítulos anteriores (igual que el árbol: más simple que ir haciendo diff).
app.post('/api/chapters/generate', requireAuth, bloquearColaborador, rateLimit, async (req, res) => {
  try {
    await ensureSchema();
    const stories = await sql`SELECT id, texto, created_at FROM story_log WHERE user_id = ${req.userId} ORDER BY created_at ASC`;
    if (!stories.length) {
      return res.json({ ok: true, message: 'Todavía no hay historias detectadas en la charla para armar capítulos.', chapters: [] });
    }

    const grupos = await classifyStoriesByTheme(stories);
    if (!grupos.length) {
      return res.json({ ok: true, message: 'No se pudo agrupar el material todavía. Prueba de nuevo más tarde.', chapters: [] });
    }

    const byId = new Map(stories.map((s) => [s.id, s]));
    const nuevos = [];
    for (const g of grupos) {
      if (!g || !g.theme) continue;
      const ids = Array.isArray(g.story_ids) ? g.story_ids.filter((id) => byId.has(id)) : [];
      if (!ids.length) continue;
      const capitulo = await writeChapterFromStories(g.theme, ids.map((id) => byId.get(id)));
      if (!capitulo) continue;
      nuevos.push({ theme: String(g.theme).slice(0, 120), ids, ...capitulo });
    }

    if (!nuevos.length) {
      return res.json({ ok: true, message: 'No se pudo generar ningún capítulo todavía.', chapters: [] });
    }

    await sql`DELETE FROM chapters WHERE user_id = ${req.userId}`;
    const guardados = [];
    for (const c of nuevos) {
      const row = await sql`INSERT INTO chapters (user_id, title, theme, generated_text, story_ids) VALUES (
        ${req.userId}, ${c.title}, ${c.theme}, ${c.generated_text}, ${JSON.stringify(c.ids)}
      ) RETURNING id, title, theme, generated_text, story_ids, created_at`;
      guardados.push({ ...row[0], story_ids: parseJsonArray(row[0].story_ids) });
    }

    res.json({ ok: true, chapters: guardados });
  } catch (err) {
    console.error('No se pudieron generar los capítulos:', err);
    res.status(500).json({ error: 'No se pudieron generar los capítulos.' });
  }
});

app.get('/api/chapters', requireAuth, bloquearColaborador, async (req, res) => {
  try {
    await ensureSchema();
    const rows = await sql`SELECT id, title, theme, generated_text, story_ids, created_at FROM chapters WHERE user_id = ${req.userId} ORDER BY id`;
    const chapters = rows.map((c) => ({ ...c, story_ids: parseJsonArray(c.story_ids) }));
    res.json({ chapters });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar los capítulos.' });
  }
});

app.delete('/api/chapters/:id', requireAuth, bloquearColaborador, rateLimit, async (req, res) => {
  try {
    await ensureSchema();
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Id inválido.' });
    const rows = await sql`DELETE FROM chapters WHERE id = ${id} AND user_id = ${req.userId} RETURNING id`;
    if (!rows.length) return res.status(404).json({ error: 'No se encontró ese capítulo.' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo borrar el capítulo.' });
  }
});

app.get('/api/tree', requireAuth, bloquearColaborador, async (req, res) => {
  try {
    await ensureSchema();
    const peopleRaw = await sql`SELECT nombre, relacion, detalles, padres FROM family_members WHERE user_id = ${req.userId} ORDER BY id`;
    const people = peopleRaw.map((p) => ({
      ...p,
      nombre: capitalizarNombre(p.nombre),
      padres: parseJsonArray(p.padres).map(capitalizarNombre),
    }));
    const events = await sql`SELECT descripcion, anio, edad_aprox, categoria FROM timeline_events WHERE user_id = ${req.userId} ORDER BY anio NULLS LAST, id`;
    res.json({ people, events });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar el árbol genealógico.' });
  }
});

// Campanita de aviso en el ícono del árbol: quién se agregó desde la
// última vez que se abrió /arbol.html.
app.get('/api/tree/pending', requireAuth, bloquearColaborador, async (req, res) => {
  try {
    await ensureSchema();
    const rows = await sql`SELECT tree_pending_names FROM users WHERE id = ${req.userId}`;
    res.json({ names: parseJsonArray(rows[0] && rows[0].tree_pending_names) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo consultar el árbol.' });
  }
});

app.post('/api/tree/mark-seen', requireAuth, bloquearColaborador, async (req, res) => {
  try {
    await ensureSchema();
    await sql`UPDATE users SET tree_pending_names = NULL WHERE id = ${req.userId}`;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar.' });
  }
});

// Repasa TODAS las charlas ya guardadas (de antes de que existiera el árbol,
// o si se quiere reconstruir desde cero) y actualiza personas/eventos.
app.post('/api/rebuild-tree', requireAuth, bloquearColaborador, rateLimit, async (req, res) => {
  try {
    await ensureSchema();
    const sessions = await sql`SELECT intercambios FROM sessions WHERE user_id = ${req.userId} ORDER BY fecha ASC`;
    const todo = sessions.flatMap((s) => s.intercambios || []);
    if (!todo.length) return res.json({ ok: true, message: 'No hay charlas guardadas todavía.' });

    await updateFamilyTree(req.userId, todo);

    const peopleRaw = await sql`SELECT nombre, relacion, detalles, padres FROM family_members WHERE user_id = ${req.userId} ORDER BY id`;
    const people = peopleRaw.map((p) => ({
      ...p,
      nombre: capitalizarNombre(p.nombre),
      padres: parseJsonArray(p.padres).map(capitalizarNombre),
    }));
    const events = await sql`SELECT descripcion, anio, edad_aprox, categoria FROM timeline_events WHERE user_id = ${req.userId} ORDER BY anio NULLS LAST, id`;
    res.json({ ok: true, people, events });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo reconstruir el árbol.' });
  }
});

app.post('/api/save', requireAuth, bloquearColaborador, async (req, res) => {
  try {
    const history = Array.isArray(req.body.history) ? req.body.history.slice(0, 100) : [];
    if (!history.length) return res.status(400).json({ error: 'Nada que guardar.' });

    // Una misma charla se puede guardar varias veces (por ejemplo: se pausa
    // y se guarda un avance parcial, y después termina de verdad) — si nos
    // pasan el id de una fila ya guardada de esta cuenta, actualizamos esa
    // fila en vez de crear una nueva, para no duplicar.
    const existingId = Number.isInteger(req.body.sessionDbId) ? req.body.sessionDbId : null;

    await ensureSchema();

    let sessionDbId = null;
    if (existingId) {
      const updated = await sql`UPDATE sessions SET intercambios = ${JSON.stringify(history)}::jsonb
                                 WHERE id = ${existingId} AND user_id = ${req.userId} RETURNING id`;
      sessionDbId = updated.length ? updated[0].id : null;
    }
    if (!sessionDbId) {
      const inserted = await sql`INSERT INTO sessions (user_id, intercambios) VALUES (${req.userId}, ${JSON.stringify(history)}::jsonb) RETURNING id`;
      sessionDbId = inserted[0].id;
    }

    // Se espera de verdad (en Vercel, la función puede cortarse apenas se
    // manda la respuesta — "en segundo plano" no garantiza que termine).
    // Las dos actualizaciones van en paralelo porque son independientes.
    await Promise.all([
      updateMemorySummary(req.userId, history).catch((err) => console.error('No se pudo actualizar el resumen:', err)),
      updateFamilyTree(req.userId, history).catch((err) => console.error('No se pudo actualizar el árbol:', err)),
    ]);

    res.json({ ok: true, sessionDbId });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'No se pudo guardar la charla.' });
  }
});

const FAMILY_SYSTEM_PROMPT_BASE = `Tienes acceso al resumen de charlas donde una persona mayor fue contando la historia de su vida. Tu trabajo es responder preguntas de su familia sobre lo que él contó, basándote únicamente en esa información.

Reglas:
- Responde en español, cálido pero directo, en 2-4 oraciones.
- Si la información no está disponible, dilo con claridad: no inventes ni completes con suposiciones.
- Habla de él en tercera persona ("contó que...", "dijo que...").
- Si el resumen no tiene el detalle necesario para responder con precisión (una cita exacta, una fecha, algo muy específico), usa la herramienta "buscar_en_transcripciones" para leer las charlas completas antes de responder.`;

const FAMILY_TOOLS = [{
  name: 'buscar_en_transcripciones',
  description: 'Devuelve el texto completo y textual de las charlas guardadas, para cuando el resumen no alcanza para responder con precisión.',
  input_schema: {
    type: 'object',
    properties: {
      palabra_clave: {
        type: 'string',
        description: 'Palabra o tema para filtrar las charlas relevantes. Si no estás seguro, dejalo vacío para traer todo.',
      },
    },
  },
}];

app.post('/api/ask-familia', requireAuth, rateLimit, async (req, res) => {
  try {
    let question = (req.body.question || '').trim();
    if (!question) return res.status(400).json({ error: 'Falta la pregunta.' });
    if (question.length > 1000) question = question.slice(0, 1000);

    await ensureSchema();
    const memoria = await loadMemorySummary(req.profileUserId);
    if (!memoria) {
      const rows = await sql`SELECT id FROM sessions WHERE user_id = ${req.profileUserId} LIMIT 1`;
      if (!rows.length) {
        return res.json({
          answer: 'Todavía no hay charlas guardadas. Cuando presione el botón y cuente algo, vas a poder preguntar sobre eso acá.',
        });
      }
    }

    const system = `${FAMILY_SYSTEM_PROMPT_BASE}\n\nResumen disponible:\n${memoria || '(todavía no hay resumen armado, usa la herramienta para leer las charlas directamente)'}`;

    let messages = [{ role: 'user', content: question }];
    let response;
    const MAX_TOOL_ROUNDS = 3;

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 500,
        system,
        tools: FAMILY_TOOLS,
        messages,
      });

      if (response.stop_reason !== 'tool_use' || round === MAX_TOOL_ROUNDS) break;

      const toolUse = response.content.find((b) => b.type === 'tool_use');
      if (!toolUse) break;
      const toolResultText = await buildFullTranscripts(req.profileUserId, toolUse.input && toolUse.input.palabra_clave);

      messages = [
        ...messages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: toolResultText }] },
      ];
    }

    const textBlock = response.content.find((b) => b.type === 'text');
    res.json({ answer: textBlock ? textBlock.text.trim() : 'No se pudo responder.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo responder la pregunta.' });
  }
});

// Red de seguridad: si algo inesperado falla fuera de una ruta, lo dejamos
// registrado y seguimos corriendo en vez de que el proceso se caiga solo
// (importante para cuando esto quede desatendido en la Raspberry Pi).
process.on('uncaughtException', (err) => {
  console.error('Error no capturado:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('Promesa rechazada sin capturar:', err);
});

// En Vercel, este archivo se exporta como función serverless (ver api/index.js)
// y Vercel maneja el puerto. Corriendo local (npm run dev / npm start), sí
// levantamos el servidor nosotros mismos.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Los recuerdos de mis viejos corriendo en http://localhost:${PORT}`);
  });
}

module.exports = app;
