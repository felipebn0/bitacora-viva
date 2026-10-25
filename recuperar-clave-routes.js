/* ECO restablecer la clave, versión simple (decisión de Felipe, 2026-10-25): quien olvidó su clave
 * escribe su correo o usuario y la clave nueva dos veces. OJO: aquí NO se comprueba que sea la dueña
 * de la cuenta, así que cualquiera que sepa un correo puede cambiar esa clave. Es temporal: la versión
 * con enlace por correo está en recuperar-clave-correo.pendiente.js (BACKLOG #22).
 * Guardas que sí hay: las cuentas de administrador no se pueden restablecer así, tope de intentos por IP y
 * por cuenta, y cada cambio cierra las sesiones abiertas y queda en el log.
 */
const bcrypt = require('bcryptjs');

module.exports = (app, { sql, ensureSchema, rateLimit, limitePorClave, claveDemasiadoLarga }) => {
  app.post('/api/clave/restablecer', rateLimit, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const { usuario, clave, claveConfirmar } = req.body || {};
      const entrada = String(usuario || '').trim().toLowerCase().slice(0, 200);
      if (entrada.length < 3) return res.status(400).json({ error: 'Escribe tu correo o usuario.' });
      if (typeof clave !== 'string' || clave.length < 6) return res.status(400).json({ error: 'La clave debe tener al menos 6 caracteres.' });
      if (claveDemasiadoLarga(clave)) return res.status(400).json({ error: 'La clave es demasiado larga (máximo 72 caracteres).' });
      if (clave !== claveConfirmar) return res.status(400).json({ error: 'Las dos claves no coinciden.' });
      const { permitido, retryAfterSegundos } = await limitePorClave(`restablecer:${entrada}`, 60 * 60 * 1000, 5);
      if (!permitido) {
        res.setHeader('Retry-After', String(retryAfterSegundos));
        return res.status(429).json({ error: 'Ya hiciste varios intentos con esta cuenta. Espera un rato e intenta de nuevo.' });
      }
      await ensureSchema();
      const filas = await sql`SELECT id, is_admin FROM users WHERE username = ${entrada} OR lower(email) = ${entrada} ORDER BY id LIMIT 1`;
      if (!filas.length) return res.status(404).json({ error: 'No encontramos una cuenta con ese correo o usuario.' });
      if (filas[0].is_admin) return res.status(403).json({ error: 'Esta cuenta no se puede restablecer desde aquí. Escríbenos y te ayudamos.' });
      const hash = await bcrypt.hash(clave, 12);
      // token_version + 1 cierra las sesiones que estuvieran abiertas con la clave vieja.
      await sql`UPDATE users SET password_hash = ${hash}, token_version = token_version + 1 WHERE id = ${filas[0].id}`;
      console.log(`[clave] restablecida SIN verificación userId=${filas[0].id} ip=${req.ip} fecha=${new Date().toISOString()}`);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo cambiar la clave. Intenta de nuevo.' });
    }
  });
};
