/* Avisos push en el celular (Web Push, sin cuenta de Apple Developer): la persona activa los avisos desde Eco
 * (instalada en la pantalla de inicio en iPhone) y cada vez que un familiar termina un aporte le llega una
 * notificación. Las llaves VAPID van en las variables de entorno VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (y
 * opcional VAPID_SUBJECT); sin ellas esto queda apagado y no pasa nada.
 */
const webpush = require('web-push');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'https://mieco.app';
const HABILITADO = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (HABILITADO) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const MAX_POR_CUENTA = 10;
const ESPERA_MAXIMA_MS = 4000;

module.exports = (app, { sql, ensureSchema, requireAuth, bloquearColaborador, bloquearInvitado, rateLimit }) => {
  let fkQuitada = false;
  async function ready() {
    await ensureSchema();
    await sql`CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id)`;
    // El narrador de un subperfil no tiene fila en "users": sus avisos se guardan con el id del subperfil.
    if (!fkQuitada) {
      await sql`ALTER TABLE push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_user_id_fkey`;
      fkQuitada = true;
    }
  }

  // Quién recibe los avisos de esta sesión: la cuenta que entró o, si es el narrador de un subperfil, ese subperfil.
  const idDeAvisos = (req) => req.userId || (req.isNarradorLink ? req.profileUserId : null);
  // Mismo veto que bloquearInvitado, salvo para el narrador de un subperfil.
  function soloCuentaONarrador(req, res, next) {
    if (req.isGuest && !req.isNarradorLink) return bloquearInvitado(req, res, next);
    next();
  }

  async function limpiar(id) {
    await ready();
    await sql`DELETE FROM push_subscriptions WHERE user_id = ${id}`;
  }

  const textoCorto = (v, max) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

  // Solo se mandan avisos a los servicios de push de los navegadores (Chrome/Android, Firefox, Safari/iPhone, Edge). Antes
  // se aceptaba cualquier dirección https, y el servidor podía terminar enviando pedidos a una dirección interna (SSRF).
  // Reemplaza a una lista de rangos privados que también bloqueaba fcm.googleapis.com (empieza por «fc», como las IPv6
  // privadas): con ella nadie en Chrome o Android podía activar los avisos.
  const HOSTS_PUSH = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/,
    /^web\.push\.apple\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];
  const destinoPermitido = (endpoint) => {
    try {
      const u = new URL(endpoint);
      return u.protocol === 'https:' && !u.port && !u.username && !u.password && HOSTS_PUSH.some((re) => re.test(u.hostname.toLowerCase()));
    } catch (e) { return false; }
  };
  const suscripcionValida = (s) => {
    if (!s || typeof s !== 'object') return null;
    const endpoint = textoCorto(s.endpoint, 800);
    const p256dh = textoCorto(s.keys && s.keys.p256dh, 200);
    const auth = textoCorto(s.keys && s.keys.auth, 100);
    if (!endpoint || !p256dh || !auth || !destinoPermitido(endpoint)) return null;
    return { endpoint, p256dh, auth };
  };

  // Manda el aviso a todos los celulares de esa cuenta. Nunca lanza: un aviso que falla no debe romper el guardado
  // del aporte. Las suscripciones que el servicio de avisos ya no reconoce (404/410) se borran.
  async function enviarPush(userId, aviso) {
    if (!HABILITADO || !userId) return { enviados: 0 };
    try {
      await ready();
      const filas = await sql`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ${userId}`;
      let enviados = 0;
      const carga = JSON.stringify({ title: aviso.title, body: aviso.body, url: aviso.url || '/app.html', tag: aviso.tag || 'eco-aviso' });
      await Promise.all(filas.map(async (f) => {
        // Una suscripción guardada antes de la lista de destinos permitidos y que no esté en ella no se usa nunca.
        if (!destinoPermitido(f.endpoint)) return;
        try {
          await Promise.race([
            webpush.sendNotification({ endpoint: f.endpoint, keys: { p256dh: f.p256dh, auth: f.auth } }, carga, { TTL: 86400 }),
            new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('tiempo')), ESPERA_MAXIMA_MS)),
          ]);
          enviados++;
        } catch (err) {
          if (err && (err.statusCode === 404 || err.statusCode === 410)) {
            await sql`DELETE FROM push_subscriptions WHERE id = ${f.id}`;
          } else {
            console.error('No se pudo mandar un aviso push:', (err && err.message) || err);
          }
        }
      }));
      return { enviados };
    } catch (err) {
      console.error('Error en los avisos push:', err);
      return { enviados: 0 };
    }
  }

  app.get('/api/push/clave', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ habilitado: HABILITADO, clave: HABILITADO ? VAPID_PUBLIC_KEY : null });
  });

  app.post('/api/push/suscribir', requireAuth, bloquearColaborador, soloCuentaONarrador, rateLimit, async (req, res) => {
    if (!HABILITADO) return res.status(503).json({ error: 'Los avisos todavía no están disponibles.' });
    const s = suscripcionValida(req.body && req.body.subscription);
    if (!s) return res.status(400).json({ error: 'La suscripción no es válida.' });
    try {
      await ready();
      await sql`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (${idDeAvisos(req)}, ${s.endpoint}, ${s.p256dh}, ${s.auth})
        ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`;
      // Tope por cuenta: se conservan las más recientes.
      await sql`DELETE FROM push_subscriptions WHERE user_id = ${idDeAvisos(req)} AND id NOT IN (SELECT id FROM push_subscriptions WHERE user_id = ${idDeAvisos(req)} ORDER BY id DESC LIMIT ${MAX_POR_CUENTA})`;
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudieron activar los avisos.' });
    }
  });

  app.post('/api/push/baja', requireAuth, bloquearColaborador, soloCuentaONarrador, rateLimit, async (req, res) => {
    const endpoint = textoCorto(req.body && req.body.endpoint, 800);
    if (!endpoint) return res.status(400).json({ error: 'Falta el celular.' });
    try {
      await ready();
      await sql`DELETE FROM push_subscriptions WHERE user_id = ${idDeAvisos(req)} AND endpoint = ${endpoint}`;
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudieron apagar los avisos.' });
    }
  });

  app.post('/api/push/prueba', requireAuth, bloquearColaborador, soloCuentaONarrador, rateLimit, async (req, res) => {
    if (!HABILITADO) return res.status(503).json({ error: 'Los avisos todavía no están disponibles.' });
    const r = await enviarPush(idDeAvisos(req), { title: 'Eco', body: req.isNarradorLink ? 'Así te voy a recordar cuando sea un buen momento para charlar.' : 'Así te voy a avisar cuando un familiar cuente una historia.', url: '/app.html', tag: 'eco-prueba' });
    res.json({ ok: true, enviados: r.enviados });
  });

  return { enviarPush, habilitado: HABILITADO, idDeAvisos, soloCuentaONarrador, limpiar };
};
