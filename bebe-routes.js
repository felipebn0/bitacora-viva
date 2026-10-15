/* ECO diario de un bebé: modo especial dentro de la sesión (por ejemplo "Rafaela").
 * La persona guarda el nombre del bebé, sube fotos y escribe notas del día; los familiares que
 * invitó (colaboradores o invitados con enlace) pueden VER ese diario, nunca editarlo.
 * Lo que se conversa por voz en este modo va al libro de siempre y no se publica en el diario.
 */
const express = require('express');

const MAX_NOMBRE = 40;
const MAX_NOTA = 600;
const GENEROS = new Set(['femenino', 'masculino']);

module.exports = (app, {
  sql, ensureSchema, requireAuth, rateLimit, bloquearEscritura, resolveProfileUserId,
  almacenarArchivo, verificarArchivoReal, MEDIA_MIME_PERMITIDOS, enviarArchivoAlmacenado,
  datosDelArchivoDeBlob, borrarArchivosBlob,
}) => {
  const sinCache = (res) => res.set('Cache-Control', 'private, no-store');

  const fechaValida = (valor) => {
    if (valor === null || valor === undefined || valor === '') return null;
    if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return undefined;
    const t = Date.parse(valor + 'T12:00:00Z');
    if (Number.isNaN(t)) return undefined;
    const hoy = Date.now();
    if (t > hoy + 3 * 86400000 || t < hoy - 3 * 365 * 86400000) return undefined;
    return valor;
  };

  const formatearConfig = (fila) => fila ? {
    nombre: fila.nombre,
    genero: fila.genero || null,
    nacioEn: fila.nacio_en || null,
    estado: fila.nacio_en ? 'nacida' : 'en_camino',
  } : null;

  const leerConfig = async (profileUserId) => {
    const filas = await sql`SELECT nombre, genero, to_char(nacio_en, 'YYYY-MM-DD') AS nacio_en FROM diario_bebe WHERE profile_user_id = ${profileUserId}`;
    return filas[0] || null;
  };

  app.get('/api/bebe', requireAuth, async (req, res) => {
    sinCache(res);
    try {
      const pid = await resolveProfileUserId(req);
      if (!pid) return res.status(403).json({ error: 'No tienes acceso a este diario.' });
      await ensureSchema();
      const config = formatearConfig(await leerConfig(pid));
      const filas = config
        ? await sql`SELECT id, texto, media_url, created_at FROM diario_bebe_entradas WHERE profile_user_id = ${pid} ORDER BY created_at DESC, id DESC LIMIT 200`
        : [];
      const puedeEditar = !req.isCollaborator && !req.isGuest && pid === req.profileUserId;
      res.json({
        config,
        puedeEditar,
        dueno: pid,
        entradas: filas.map((f) => ({
          id: f.id,
          texto: f.texto || '',
          fotoUrl: f.media_url ? `/api/bebe/foto/${f.id}?owner=${pid}` : null,
          creadaEn: f.created_at,
        })),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo abrir el diario.' });
    }
  });

  app.put('/api/bebe', requireAuth, ...bloquearEscritura, rateLimit, async (req, res) => {
    sinCache(res);
    try {
      const nombre = String((req.body && req.body.nombre) || '').replace(/\s+/g, ' ').trim();
      if (!nombre) return res.status(400).json({ error: 'Escribe el nombre.' });
      if (nombre.length > MAX_NOMBRE) return res.status(400).json({ error: `El nombre es muy largo (máximo ${MAX_NOMBRE} letras).` });
      const genero = GENEROS.has(req.body && req.body.genero) ? req.body.genero : null;
      const nacioEn = fechaValida(req.body && req.body.nacioEn);
      if (nacioEn === undefined) return res.status(400).json({ error: 'La fecha no es válida.' });
      await ensureSchema();
      await sql`INSERT INTO diario_bebe (profile_user_id, nombre, genero, nacio_en)
        VALUES (${req.profileUserId}, ${nombre}, ${genero}, ${nacioEn})
        ON CONFLICT (profile_user_id) DO UPDATE SET nombre = EXCLUDED.nombre, genero = EXCLUDED.genero, nacio_en = EXCLUDED.nacio_en, updated_at = now()`;
      res.json({ ok: true, config: formatearConfig(await leerConfig(req.profileUserId)) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo guardar.' });
    }
  });

  app.post('/api/bebe/foto', requireAuth, ...bloquearEscritura, rateLimit, express.raw({ type: '*/*', limit: '4mb' }), async (req, res) => {
    sinCache(res);
    try {
      if (!req.body || !req.body.length) return res.status(400).json({ error: 'Falta la foto.' });
      const real = await verificarArchivoReal(req.body, MEDIA_MIME_PERMITIDOS);
      if (!real || !real.mime.startsWith('image/')) return res.status(400).json({ error: 'El archivo no parece ser una foto.' });
      await ensureSchema();
      if (!(await leerConfig(req.profileUserId))) return res.status(409).json({ error: 'Primero crea el diario.' });
      const { url } = await almacenarArchivo(`media/${req.profileUserId}/bebe/foto-${Date.now()}.${real.ext}`, req.body, real.mime);
      res.json({ ok: true, url });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo subir la foto.' });
    }
  });

  app.post('/api/bebe/entradas', requireAuth, ...bloquearEscritura, rateLimit, async (req, res) => {
    sinCache(res);
    try {
      const texto = String((req.body && req.body.texto) || '').trim().slice(0, MAX_NOTA);
      let fotoUrl = req.body && req.body.fotoUrl;
      if (fotoUrl !== undefined && fotoUrl !== null && typeof fotoUrl !== 'string') return res.status(400).json({ error: 'Foto inválida.' });
      fotoUrl = fotoUrl || null;
      if (fotoUrl) {
        const datos = datosDelArchivoDeBlob(fotoUrl);
        if (!datos || datos.ownerId !== req.profileUserId || !datos.pathname.startsWith(`media/${req.profileUserId}/bebe/`)) {
          return res.status(400).json({ error: 'Esa foto no se puede usar.' });
        }
      }
      if (!texto && !fotoUrl) return res.status(400).json({ error: 'Sube una foto o escribe una nota.' });
      await ensureSchema();
      if (!(await leerConfig(req.profileUserId))) return res.status(409).json({ error: 'Primero crea el diario.' });
      const filas = await sql`INSERT INTO diario_bebe_entradas (profile_user_id, texto, media_url) VALUES (${req.profileUserId}, ${texto || null}, ${fotoUrl}) RETURNING id, created_at`;
      res.json({
        ok: true,
        entrada: {
          id: filas[0].id,
          texto,
          fotoUrl: fotoUrl ? `/api/bebe/foto/${filas[0].id}?owner=${req.profileUserId}` : null,
          creadaEn: filas[0].created_at,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo guardar.' });
    }
  });

  app.delete('/api/bebe/entradas/:id', requireAuth, ...bloquearEscritura, rateLimit, async (req, res) => {
    sinCache(res);
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Entrada inválida.' });
      await ensureSchema();
      const filas = await sql`DELETE FROM diario_bebe_entradas WHERE id = ${id} AND profile_user_id = ${req.profileUserId} RETURNING media_url`;
      if (!filas.length) return res.status(404).json({ error: 'No se encontró.' });
      if (filas[0].media_url) await borrarArchivosBlob([filas[0].media_url]);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo borrar.' });
    }
  });

  app.get('/api/bebe/foto/:id', requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Foto inválida.' });
      const pid = await resolveProfileUserId(req);
      if (!pid) return res.status(403).json({ error: 'No tienes acceso a esta foto.' });
      await ensureSchema();
      const filas = await sql`SELECT media_url FROM diario_bebe_entradas WHERE id = ${id} AND profile_user_id = ${pid}`;
      if (!filas.length || !filas[0].media_url) return res.status(404).json({ error: 'No se encontró.' });
      const datos = datosDelArchivoDeBlob(filas[0].media_url);
      if (!datos || datos.ownerId !== pid) return res.status(404).json({ error: 'No se encontró.' });
      await enviarArchivoAlmacenado(req, res, filas[0].media_url, 'private, max-age=300');
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: 'No se pudo abrir la foto.' });
    }
  });
};
