/* Recordatorio diario por push (5 pm hora de Colombia) con prueba de mensajes: cada cuenta con avisos activados queda
 * en un tipo (A a E) y rota entre 3 variantes de ese tipo. Se guarda cada envío y si la persona tocó el aviso para
 * abrir Eco, y /api/admin/push-recordatorios compara los tipos. No se manda si ya usó Eco hoy ni más de uno al día.
 */
const crypto = require('crypto');

const TIPOS = ['A', 'B', 'C', 'D', 'E'];
const OFFSET_COLOMBIA_MS = 5 * 3600 * 1000;
const DIA_MS = 24 * 3600 * 1000;

const MENSAJES = {
  A: [
    { title: 'Cinco minutos', body: 'Con cinco minutos alcanza. Cuéntame algo de tu día y lo guardamos.' },
    { title: 'Un ratico para Eco', body: 'Sin afán: una charla corta y queda un recuerdo más en tu libro.' },
    { title: '¿Tienes cinco minutos?', body: 'Hoy puede ser una historia pequeña. Las pequeñas también cuentan.' },
  ],
  B: [
    { title: '¿Cuál fue tu primer trabajo?', body: 'Cuéntamelo hoy. Seguro tiene una buena anécdota.' },
    { title: '¿Qué se cocinaba en tu casa los domingos?', body: 'Ese olor también es un recuerdo.' },
    { title: '¿Quién te enseñó algo que nunca olvidaste?', body: 'Hablemos de esa persona.' },
  ],
  C: [
    { title: 'Alguien va a querer leer esto', body: 'Tus historias son un regalo para tu familia. Hoy podemos escribir una más.' },
    { title: 'Tu familia te lo va a agradecer', body: 'Cuéntame una historia de las que solo tú sabes.' },
    { title: 'Lo que no se cuenta se pierde', body: 'Guardemos hoy un recuerdo antes de que se olvide.' },
  ],
  D: [
    { title: 'Tu libro va creciendo', body: (n) => `Ya tiene ${historias(n)}. ¿Sumamos una hoy?` },
    { title: (n) => `${historias(n)} y contando`, body: 'Hoy puede ser la siguiente.' },
    { title: 'Tu libro te espera', body: (n) => `Vas por la historia ${n}. Vamos por la siguiente cuando quieras.` },
  ],
  E: [
    { title: 'Aquí estoy', body: 'Cuando quieras charlar, sin presión. Me encantaría saber cómo te fue hoy.' },
    { title: '¿Cómo estuvo tu día?', body: 'Cuéntamelo, con calma. Yo te escucho.' },
    { title: 'Te extraño por aquí', body: 'Pasa a charlar un rato cuando puedas.' },
  ],
};

function historias(n) {
  return n === 1 ? '1 historia' : `${n} historias`;
}

function armarMensaje(tipo, variante, nHistorias) {
  const m = MENSAJES[tipo][variante];
  return {
    title: typeof m.title === 'function' ? m.title(nHistorias) : m.title,
    body: typeof m.body === 'function' ? m.body(nHistorias) : m.body,
  };
}

function inicioDelDiaColombia(ahora) {
  const col = new Date(ahora.getTime() - OFFSET_COLOMBIA_MS);
  return new Date(Date.UTC(col.getUTCFullYear(), col.getUTCMonth(), col.getUTCDate()) + OFFSET_COLOMBIA_MS);
}

module.exports = (app, { sql, ensureSchema, requireAuth, requireAdmin, bloquearColaborador, bloquearInvitado, rateLimit, pushWeb }) => {
  async function ready() {
    await ensureSchema();
    await sql`CREATE TABLE IF NOT EXISTS push_recordatorio_cuentas (
      user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      tipo TEXT,
      activo BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS push_recordatorio_envios (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tipo_asignado TEXT NOT NULL,
      tipo_enviado TEXT NOT NULL,
      variante INT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      enviado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      abierto_at TIMESTAMPTZ
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_push_recordatorio_envios_user ON push_recordatorio_envios(user_id, enviado_at)`;
  }

  app.get('/api/push/recordatorio', requireAuth, bloquearColaborador, bloquearInvitado, async (req, res) => {
    try {
      await ready();
      const filas = await sql`SELECT activo FROM push_recordatorio_cuentas WHERE user_id = ${req.userId}`;
      res.json({ activo: filas.length ? filas[0].activo : true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo cargar el recordatorio.' });
    }
  });

  app.post('/api/push/recordatorio', requireAuth, bloquearColaborador, bloquearInvitado, rateLimit, async (req, res) => {
    try {
      const activo = !!(req.body && req.body.activo);
      await ready();
      await sql`INSERT INTO push_recordatorio_cuentas (user_id, activo) VALUES (${req.userId}, ${activo})
        ON CONFLICT (user_id) DO UPDATE SET activo = EXCLUDED.activo`;
      res.json({ ok: true, activo });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo guardar el recordatorio.' });
    }
  });

  // La app lo llama al abrirse con ?av=TOKEN (el que viaja en el aviso). El token es secreto y de un solo uso para medir.
  app.post('/api/push/abierto', rateLimit, async (req, res) => {
    const token = req.body && typeof req.body.token === 'string' && /^[a-f0-9]{24}$/.test(req.body.token) ? req.body.token : null;
    if (!token) return res.status(400).json({ error: 'Falta el aviso.' });
    try {
      await ready();
      await sql`UPDATE push_recordatorio_envios SET abierto_at = now() WHERE token = ${token} AND abierto_at IS NULL`;
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo registrar.' });
    }
  });

  // Vercel Cron, todos los días a las 22:00 UTC (5 pm en Colombia). Mismo CRON_SECRET que los otros crons.
  app.get('/api/cron/recordatorio-push', async (req, res) => {
    try {
      if (!process.env.CRON_SECRET || req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'No autorizado.' });
      }
      if (!pushWeb || !pushWeb.habilitado) return res.json({ ok: true, saltado: 'sin llaves de avisos' });
      await ready();
      const ahora = new Date();
      const inicio = inicioDelDiaColombia(ahora);
      const dia = Math.floor((ahora.getTime() - OFFSET_COLOMBIA_MS) / DIA_MS);

      const cuentas = await sql`
        SELECT s.user_id, c.tipo,
          EXISTS(SELECT 1 FROM push_recordatorio_envios e WHERE e.user_id = s.user_id AND e.enviado_at >= ${inicio}) AS ya_envio,
          EXISTS(SELECT 1 FROM sessions x WHERE x.fecha >= ${inicio} AND (x.user_id = s.user_id OR x.user_id IN (SELECT id FROM users WHERE owner_user_id = s.user_id))) AS uso_hoy,
          (SELECT count(*)::int FROM story_log l WHERE l.user_id = s.user_id) AS historias
        FROM (SELECT DISTINCT user_id FROM push_subscriptions) s
        LEFT JOIN push_recordatorio_cuentas c ON c.user_id = s.user_id
        WHERE COALESCE(c.activo, true)
      `;
      const repartidos = await sql`SELECT tipo, count(*)::int AS total FROM push_recordatorio_cuentas WHERE tipo IS NOT NULL GROUP BY tipo`;
      const conteo = Object.fromEntries(TIPOS.map((t) => [t, (repartidos.find((r) => r.tipo === t) || {}).total || 0]));

      let enviados = 0, yaUsaron = 0, yaTenianAviso = 0;
      for (const cuenta of cuentas) {
        if (cuenta.ya_envio) { yaTenianAviso++; continue; }
        if (cuenta.uso_hoy) { yaUsaron++; continue; }
        let tipo = cuenta.tipo;
        if (!tipo) {
          const minimo = Math.min(...TIPOS.map((t) => conteo[t]));
          const empatados = TIPOS.filter((t) => conteo[t] === minimo);
          tipo = empatados[crypto.randomInt(empatados.length)];
          await sql`INSERT INTO push_recordatorio_cuentas (user_id, tipo) VALUES (${cuenta.user_id}, ${tipo})
            ON CONFLICT (user_id) DO UPDATE SET tipo = COALESCE(push_recordatorio_cuentas.tipo, EXCLUDED.tipo)`;
          conteo[tipo]++;
        }
        const variante = (dia + cuenta.user_id) % 3;
        const tipoEnviado = tipo === 'D' && !(cuenta.historias > 0) ? 'A' : tipo;
        const mensaje = armarMensaje(tipoEnviado, variante, cuenta.historias);
        const token = crypto.randomBytes(12).toString('hex');
        const nuevo = await sql`INSERT INTO push_recordatorio_envios (user_id, tipo_asignado, tipo_enviado, variante, token)
          VALUES (${cuenta.user_id}, ${tipo}, ${tipoEnviado}, ${variante}, ${token}) RETURNING id`;
        const r = await pushWeb.enviarPush(cuenta.user_id, { title: mensaje.title, body: mensaje.body, url: '/app.html?av=' + token, tag: 'eco-recordatorio' });
        if (r.enviados > 0) enviados++;
        else await sql`DELETE FROM push_recordatorio_envios WHERE id = ${nuevo[0].id}`;
      }
      res.json({ ok: true, candidatas: cuentas.length, enviados, yaUsaron, yaTenianAviso });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo correr el recordatorio por push.' });
    }
  });

  // Comparación de tipos para /admin. Se cuenta por el tipo ASIGNADO (así la comparación sigue siendo justa aunque a
  // alguien sin historias se le mande un mensaje de tipo A en vez del D).
  app.get('/api/admin/push-recordatorios', requireAuth, requireAdmin, async (req, res) => {
    try {
      await ready();
      const porTipo = await sql`
        SELECT e.tipo_asignado AS tipo, count(*)::int AS enviados, count(e.abierto_at)::int AS abiertos,
          count(DISTINCT e.user_id)::int AS cuentas,
          (count(*) FILTER (WHERE EXISTS(SELECT 1 FROM sessions x WHERE (x.user_id = e.user_id OR x.user_id IN (SELECT id FROM users WHERE owner_user_id = e.user_id))
            AND x.fecha >= e.enviado_at AND x.fecha < e.enviado_at + interval '24 hours')))::int AS charlas
        FROM push_recordatorio_envios e GROUP BY e.tipo_asignado ORDER BY e.tipo_asignado
      `;
      const porVariante = await sql`
        SELECT e.tipo_enviado AS tipo, e.variante, count(*)::int AS enviados, count(e.abierto_at)::int AS abiertos
        FROM push_recordatorio_envios e GROUP BY e.tipo_enviado, e.variante ORDER BY e.tipo_enviado, e.variante
      `;
      const nombres = (tipo, variante) => armarMensaje(tipo, variante, 3).title;
      res.json({
        tipos: TIPOS.map((t) => ({ tipo: t, ...(porTipo.find((r) => r.tipo === t) || { enviados: 0, abiertos: 0, cuentas: 0, charlas: 0 }) })),
        variantes: porVariante.map((v) => ({ ...v, titulo: nombres(v.tipo, v.variante) })),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo cargar la prueba de recordatorios.' });
    }
  });
};

module.exports.MENSAJES = MENSAJES;
module.exports.armarMensaje = armarMensaje;
module.exports.inicioDelDiaColombia = inicioDelDiaColombia;
