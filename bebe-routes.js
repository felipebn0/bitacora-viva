/* ECO diario de un bebé: modo especial dentro de la sesión (por ejemplo "Rafaela").
 * La persona guarda el nombre del bebé, sube fotos y escribe notas del día; los familiares que
 * invitó (colaboradores o invitados con enlace) pueden VER ese diario, nunca editarlo.
 * Lo que se conversa por voz en este modo va al libro de siempre y no se publica en el diario.
 * Las notas del diario se cuentan por voz: se guarda el audio original (audio_urls) y su
 * transcripción (texto), y la entrada se va completando sola (PATCH) a medida que se habla.
 */
const express = require('express');

const MAX_NOMBRE = 40;
const MAX_NOTA = 600;
const MAX_AUDIOS = 10;
const GENEROS = new Set(['femenino', 'masculino']);

module.exports = (app, {
  sql, ensureSchema, requireAuth, rateLimit, bloquearEscritura, resolveProfileUserId,
  almacenarArchivo, verificarArchivoReal, MEDIA_MIME_PERMITIDOS, AUDIO_MIME_PERMITIDOS, enviarArchivoAlmacenado,
  datosDelArchivoDeBlob, borrarArchivosBlob,
}) => {
  const sinCache = (res) => res.set('Cache-Control', 'private, no-store');

  const fechaValida = (valor) => {
    if (valor === null || valor === undefined || valor === '') return null;
    if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return undefined;
    const t = Date.parse(valor + 'T12:00:00Z');
    if (Number.isNaN(t)) return undefined;
    const hoy = Date.now();
    if (t > hoy + 3 * 86400000 || t < hoy - 12 * 366 * 86400000) return undefined;
    return valor;
  };

  const leerAudios = (raw) => {
    try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v.filter((u) => typeof u === 'string') : []; } catch (e) { return []; }
  };
  // Un archivo subido por esta misma bitácora a su carpeta del diario (foto o nota de voz).
  const esArchivoDelDiario = (url, pid) => {
    const datos = typeof url === 'string' && datosDelArchivoDeBlob(url);
    return !!datos && datos.ownerId === pid && datos.pathname.startsWith(`media/${pid}/bebe/`);
  };
  // La grabación de una entrada "de la charla" es la misma del libro (audio/<id>/…): se puede
  // escuchar desde el diario, pero nunca se borra desde aquí.
  const esAudioDeLaCharla = (url, pid) => {
    const datos = typeof url === 'string' && datosDelArchivoDeBlob(url);
    return !!datos && datos.ownerId === pid && datos.pathname.startsWith(`audio/${pid}/`);
  };
  const soloDelDiario = (urls, pid) => urls.filter((u) => esArchivoDelDiario(u, pid));
  const formatearEntrada = (f, pid) => ({
    id: f.id,
    deCharla: f.origen === 'charla',
    texto: f.texto || '',
    fotoUrl: f.media_url ? `/api/bebe/foto/${f.id}?owner=${pid}` : null,
    audios: leerAudios(f.audio_urls).map((_, i) => `/api/bebe/audio/${f.id}/${i}?owner=${pid}`),
    creadaEn: f.created_at,
  });

  const formatearConfig = (fila) => fila ? {
    nombre: fila.nombre,
    genero: fila.genero || null,
    nacioEn: fila.nacio_en || null,
    estado: fila.nacio_en ? 'nacida' : 'en_camino',
  } : null;

  const leerConfig = async (profileUserId) => {
    const filas = await sql`SELECT nombre, genero, to_char(nacio_en, 'YYYY-MM-DD') AS nacio_en FROM diario_bebe WHERE profile_user_id = ${profileUserId} AND archived_at IS NULL`;
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
        ? await sql`SELECT id, texto, media_url, audio_urls, origen, created_at FROM diario_bebe_entradas WHERE profile_user_id = ${pid} ORDER BY created_at DESC, id DESC LIMIT 200`
        : [];
      const puedeEditar = !req.isCollaborator && !req.isGuest && pid === req.profileUserId;
      res.json({
        config,
        puedeEditar,
        dueno: pid,
        entradas: filas.map((f) => formatearEntrada(f, pid)),
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
        ON CONFLICT (profile_user_id) DO UPDATE SET nombre = EXCLUDED.nombre, genero = EXCLUDED.genero, nacio_en = EXCLUDED.nacio_en, archived_at = NULL, updated_at = now()`;
      res.json({ ok: true, config: formatearConfig(await leerConfig(req.profileUserId)) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo guardar.' });
    }
  });

  // Archivar el diario de tu propia bitácora: deja de verse en la pantalla principal y en Perfiles; no se
  // borra nada (crearlo de nuevo con el mismo botón lo recupera).
  app.post('/api/bebe/archivar', requireAuth, bloquearEscritura[0], rateLimit, async (req, res) => {
    sinCache(res);
    try {
      await ensureSchema();
      const filas = await sql`UPDATE diario_bebe SET archived_at = now() WHERE profile_user_id = ${req.userId} AND archived_at IS NULL RETURNING profile_user_id`;
      if (!filas.length) return res.status(404).json({ error: 'No hay un diario para archivar.' });
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo archivar.' });
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

  // Nota de voz original del diario: se guarda tal cual, aparte de su transcripción.
  app.post('/api/bebe/audio', requireAuth, ...bloquearEscritura, rateLimit, express.raw({ type: '*/*', limit: '4mb' }), async (req, res) => {
    sinCache(res);
    try {
      if (!req.body || !req.body.length) return res.status(400).json({ error: 'Falta el audio.' });
      const real = await verificarArchivoReal(req.body, AUDIO_MIME_PERMITIDOS);
      if (!real) return res.status(400).json({ error: 'El archivo no parece ser un audio válido.' });
      await ensureSchema();
      if (!(await leerConfig(req.profileUserId))) return res.status(409).json({ error: 'Primero crea el diario.' });
      const sufijo = Math.random().toString(36).slice(2, 8);
      const { url } = await almacenarArchivo(`media/${req.profileUserId}/bebe/voz-${Date.now()}-${sufijo}.${real.ext}`, req.body, real.mime);
      res.json({ ok: true, url });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo guardar la nota de voz.' });
    }
  });

  // Completa una entrada ya guardada: cambia el texto, suma una nota de voz o borra todas las notas
  // de voz (para "borrar y volver a contar").
  app.patch('/api/bebe/entradas/:id', requireAuth, ...bloquearEscritura, rateLimit, async (req, res) => {
    sinCache(res);
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Entrada inválida.' });
      const cuerpo = req.body || {};
      const agregar = cuerpo.agregarAudio;
      if (agregar !== undefined && agregar !== null && !esArchivoDelDiario(agregar, req.profileUserId)) return res.status(400).json({ error: 'Esa nota de voz no se puede usar.' });
      await ensureSchema();
      const filas = await sql`SELECT id, texto, media_url, audio_urls, origen, created_at FROM diario_bebe_entradas WHERE id = ${id} AND profile_user_id = ${req.profileUserId}`;
      if (!filas.length) return res.status(404).json({ error: 'No se encontró.' });
      const fila = filas[0];
      let audios = leerAudios(fila.audio_urls);
      const sobran = [];
      if (cuerpo.borrarAudios === true) { sobran.push(...audios); audios = []; }
      if (agregar) {
        if (audios.length >= MAX_AUDIOS) return res.status(400).json({ error: 'Esta nota ya tiene muchas grabaciones. Empieza una nota nueva.' });
        audios.push(agregar);
      }
      const texto = typeof cuerpo.texto === 'string' ? cuerpo.texto.trim().slice(0, MAX_NOTA) : (fila.texto || '');
      const actualizadas = await sql`UPDATE diario_bebe_entradas SET texto = ${texto || null}, audio_urls = ${audios.length ? JSON.stringify(audios) : null}
        WHERE id = ${id} AND profile_user_id = ${req.profileUserId} RETURNING id, texto, media_url, audio_urls, origen, created_at`;
      const borrables = soloDelDiario(sobran, req.profileUserId);
      if (borrables.length) await borrarArchivosBlob(borrables);
      res.json({ ok: true, entrada: formatearEntrada(actualizadas[0], req.profileUserId) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo guardar.' });
    }
  });

  app.get('/api/bebe/audio/:id/:n', requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const n = Number(req.params.n);
      if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(n) || n < 0) return res.status(400).json({ error: 'Audio inválido.' });
      const pid = await resolveProfileUserId(req);
      if (!pid) return res.status(403).json({ error: 'No tienes acceso a este audio.' });
      await ensureSchema();
      const filas = await sql`SELECT audio_urls FROM diario_bebe_entradas WHERE id = ${id} AND profile_user_id = ${pid}`;
      const url = filas.length ? leerAudios(filas[0].audio_urls)[n] : null;
      if (!url || !(esArchivoDelDiario(url, pid) || esAudioDeLaCharla(url, pid))) return res.status(404).json({ error: 'No se encontró.' });
      await enviarArchivoAlmacenado(req, res, url, 'private, max-age=300');
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: 'No se pudo abrir el audio.' });
    }
  });

  app.post('/api/bebe/entradas', requireAuth, ...bloquearEscritura, rateLimit, async (req, res) => {
    sinCache(res);
    try {
      const texto = String((req.body && req.body.texto) || '').trim().slice(0, MAX_NOTA);
      let fotoUrl = req.body && req.body.fotoUrl;
      if (fotoUrl !== undefined && fotoUrl !== null && typeof fotoUrl !== 'string') return res.status(400).json({ error: 'Foto inválida.' });
      fotoUrl = fotoUrl || null;
      if (fotoUrl && !esArchivoDelDiario(fotoUrl, req.profileUserId)) return res.status(400).json({ error: 'Esa foto no se puede usar.' });
      const audioUrl = req.body && req.body.audioUrl;
      if (audioUrl !== undefined && audioUrl !== null && !esArchivoDelDiario(audioUrl, req.profileUserId)) return res.status(400).json({ error: 'Esa nota de voz no se puede usar.' });
      const audios = audioUrl ? [audioUrl] : [];
      if (!texto && !fotoUrl && !audios.length) return res.status(400).json({ error: 'Sube una foto o cuenta algo.' });
      await ensureSchema();
      if (!(await leerConfig(req.profileUserId))) return res.status(409).json({ error: 'Primero crea el diario.' });
      const filas = await sql`INSERT INTO diario_bebe_entradas (profile_user_id, texto, media_url, audio_urls) VALUES (${req.profileUserId}, ${texto || null}, ${fotoUrl}, ${audios.length ? JSON.stringify(audios) : null}) RETURNING id, texto, media_url, audio_urls, origen, created_at`;
      res.json({ ok: true, entrada: formatearEntrada(filas[0], req.profileUserId) });
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
      const filas = await sql`DELETE FROM diario_bebe_entradas WHERE id = ${id} AND profile_user_id = ${req.profileUserId} RETURNING media_url, audio_urls`;
      if (!filas.length) return res.status(404).json({ error: 'No se encontró.' });
      // Solo lo que vive en la carpeta del diario: la grabación de la charla sigue en el libro.
      const archivos = soloDelDiario([filas[0].media_url, ...leerAudios(filas[0].audio_urls)].filter(Boolean), req.profileUserId);
      if (archivos.length) await borrarArchivosBlob(archivos);
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
