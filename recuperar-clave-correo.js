/* ECO restablecer la clave: se pide el correo, se envía un enlace de un solo uso (vence en 30 minutos)
 * y con ese enlace se escribe la clave nueva dos veces. Sin el enlace del correo no se puede cambiar
 * la clave de nadie. La respuesta a "olvidé mi clave" es la misma exista o no la cuenta.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const VIDA_ENLACE_MIN = 30;
const BASE_URL_FIJA = 'https://mieco.app';
const MENSAJE_GENERICO = 'Si ese correo tiene una cuenta, te enviamos un enlace para crear una clave nueva. Revisa también el correo no deseado. El enlace dura 30 minutos.';

module.exports = (app, { sql, ensureSchema, rateLimit, limitePorClave, enviarCorreo, claveDemasiadoLarga }) => {
  const sinCache = (res) => res.set('Cache-Control', 'no-store');
  const hashDe = (token) => crypto.createHash('sha256').update(token).digest('hex');
  const tokenValido = (t) => typeof t === 'string' && /^[a-f0-9]{64}$/.test(t);
  const escapar = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Nunca se arma con el Host del pedido: un Host falseado metería un enlace a otro dominio en el correo.
  // Solo vale si de verdad es una dirección web: un valor mal pegado en Vercel (por ejemplo "PUBLIC_BASE_URL=https://...")
  // dejaba el enlace del correo roto y sin poder tocarse. Si no sirve, se usa la dirección fija.
  const base = () => {
    const configurada = String(process.env.PUBLIC_BASE_URL || '').trim();
    return (/^https?:\/\/[^\s=]+$/i.test(configurada) ? configurada : BASE_URL_FIJA).replace(/\/+$/, '');
  };

  app.get('/api/clave/estado', (req, res) => {
    sinCache(res);
    res.json({ porCorreo: true });
  });

  app.post('/api/clave/olvide', rateLimit, async (req, res) => {
    sinCache(res);
    try {
      const entrada = String((req.body && req.body.correo) || '').trim().toLowerCase().slice(0, 200);
      if (entrada.length < 3) return res.status(400).json({ error: 'Escribe tu correo.' });
      const { permitido, retryAfterSegundos } = await limitePorClave(`olvide:${entrada}`, 60 * 60 * 1000, 3);
      if (!permitido) {
        res.setHeader('Retry-After', String(retryAfterSegundos));
        return res.status(429).json({ error: 'Ya pediste varios enlaces. Espera un rato e intenta de nuevo.' });
      }
      await ensureSchema();
      const filas = await sql`SELECT id, email, name FROM users WHERE (lower(email) = ${entrada} OR username = ${entrada}) AND email IS NOT NULL ORDER BY id LIMIT 1`;
      if (filas.length) {
        const u = filas[0];
        const token = crypto.randomBytes(32).toString('hex');
        await sql`DELETE FROM password_resets WHERE user_id = ${u.id}`;
        await sql`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (${hashDe(token)}, ${u.id}, now() + ${VIDA_ENLACE_MIN + ' minutes'}::interval)`;
        const enlace = `${base()}/restablecer.html?t=${token}`;
        try {
          await enviarCorreo({
            to: u.email,
            subject: 'Crea una clave nueva para Eco',
            html: `<p>Hola${u.name ? ' ' + escapar(u.name) : ''},</p><p>Pediste crear una clave nueva para tu cuenta de Eco. Toca el botón y escríbela dos veces:</p><table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0"><tr><td bgcolor="#4F5D3A" style="background-color:#4F5D3A;border-radius:10px"><a href="${escapar(enlace)}" style="display:inline-block;padding:13px 24px;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none">Crear clave nueva</a></td></tr></table><p style="font-size:14px;color:#444444">Si el botón no se ve, copia y pega este enlace en tu navegador:<br><a href="${escapar(enlace)}" style="color:#2F5D8A;word-break:break-all">${escapar(enlace)}</a></p><p>El enlace sirve una sola vez y dura ${VIDA_ENLACE_MIN} minutos. Si no fuiste tú, ignora este correo: tu clave actual sigue igual.</p>`,
          });
        } catch (err) {
          console.error('No se pudo enviar el correo para restablecer la clave:', err.message);
          await sql`DELETE FROM password_resets WHERE user_id = ${u.id}`;
        }
      }
      res.json({ ok: true, mensaje: MENSAJE_GENERICO });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo procesar el pedido. Intenta de nuevo.' });
    }
  });

  app.get('/api/clave/verificar', rateLimit, async (req, res) => {
    sinCache(res);
    try {
      const t = req.query && req.query.t;
      if (!tokenValido(t)) return res.json({ valido: false });
      await ensureSchema();
      const filas = await sql`SELECT 1 FROM password_resets WHERE token_hash = ${hashDe(t)} AND used_at IS NULL AND expires_at > now()`;
      res.json({ valido: filas.length > 0 });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo revisar el enlace.' });
    }
  });

  app.post('/api/clave/restablecer', rateLimit, async (req, res) => {
    sinCache(res);
    try {
      const { token, clave, claveConfirmar } = req.body || {};
      if (!tokenValido(token)) return res.status(400).json({ error: 'El enlace no sirve o ya venció. Pide uno nuevo.' });
      if (typeof clave !== 'string' || clave.length < 6) return res.status(400).json({ error: 'La clave debe tener al menos 6 caracteres.' });
      if (claveDemasiadoLarga(clave)) return res.status(400).json({ error: 'La clave es demasiado larga (máximo 72 caracteres).' });
      if (clave !== claveConfirmar) return res.status(400).json({ error: 'Las dos claves no coinciden.' });
      await ensureSchema();
      const hash = await bcrypt.hash(clave, 12);
      // El enlace se gasta aquí, de forma atómica: dos pedidos a la vez no pueden usarlo los dos.
      const gastado = await sql`UPDATE password_resets SET used_at = now() WHERE token_hash = ${hashDe(token)} AND used_at IS NULL AND expires_at > now() RETURNING user_id`;
      if (!gastado.length) return res.status(400).json({ error: 'El enlace no sirve o ya venció. Pide uno nuevo.' });
      // token_version + 1 cierra cualquier sesión abierta con la clave vieja.
      await sql`UPDATE users SET password_hash = ${hash}, token_version = token_version + 1 WHERE id = ${gastado[0].user_id}`;
      console.log(`[clave] restablecida por enlace userId=${gastado[0].user_id} fecha=${new Date().toISOString()}`);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo cambiar la clave. Intenta de nuevo.' });
    }
  });
};
