/* Enlace para compartir el libro digital (/libro/<token>): una página que se ve igual que el libro digital y que se abre en
 * cualquier celular o computador SIN cuenta. La llave es el token (48 hex al azar): quien lo tiene ve el libro y oye los
 * audios; se retira cuando la dueña quiere. Cada vez que se descarga el libro digital el enlace se actualiza (el token no
 * cambia, así que el enlace que ya se mandó a la familia sigue sirviendo). Las fotos y audios se piden por posición, nunca
 * por una dirección que mande el navegador, y solo se guardan los que de verdad son de la dueña del libro.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Pagina = require('./public/eco-libro-digital-pagina.js');

const FUENTES = [
  ['Source Serif 4', 'normal', '200 900', 'source-serif-4-latin-standard-normal.woff2'],
  ['Source Serif 4', 'italic', '200 900', 'source-serif-4-latin-standard-italic.woff2'],
  ['Atkinson Hyperlegible', 'normal', '400', 'atkinson-hyperlegible-latin-400-normal.woff2'],
  ['Atkinson Hyperlegible', 'normal', '700', 'atkinson-hyperlegible-latin-700-normal.woff2'],
];
const CSS_FUENTES = FUENTES.map(([f, e, w, a]) => `@font-face{font-family:"${f}";font-style:${e};font-weight:${w};font-display:swap;src:url(/fonts/files/${a}) format("woff2")}`).join('\n');
const RUTA_PLANTILLA = path.join(__dirname, 'public', 'libro-digital-plantilla.txt');
let plantillaEnMemoria = null;
const plantilla = () => plantillaEnMemoria || (plantillaEnMemoria = fs.readFileSync(RUTA_PLANTILLA, 'utf8'));

const MAX_MEDIOS = 400;
const texto = (v, n) => String(v == null ? '' : v).slice(0, n);

const PAGINA_NO_DISPONIBLE = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Libro no disponible · Eco</title>'
  + '<style>body{margin:0;background:#f3ecdd;color:#1f1b14;font-family:"Source Serif 4",Georgia,serif;display:grid;min-height:100vh;place-items:center;text-align:center;padding:24px}main{max-width:26rem}h1{font-size:26px;margin:0 0 10px}p{font-size:18px;line-height:1.5;margin:0;color:#6b6454}</style></head>'
  + '<body><main><h1>Este libro ya no está disponible</h1><p>Quien lo compartió retiró el enlace o la dirección no es correcta. Pídele que te mande uno nuevo.</p></main></body></html>';

module.exports = (app, { sql, ensureSchema, requireAuth, bloquearColaborador, rateLimit, rateLimitQr, enviarArchivoAlmacenado, datosDelArchivoDeBlob, almacenarArchivo, express }) => {
  const ready = () => ensureSchema();
  const tokenValido = (t) => typeof t === 'string' && /^[a-f0-9]{48}$/.test(t);
  const sinCache = (res) => res.set('Cache-Control', 'private, no-store');
  const jsonDe = (s, vacio) => { try { return JSON.parse(s); } catch (_) { return vacio; } };

  function origen(req) {
    const base = process.env.ECO_QR_PUBLIC_BASE_URL;
    const host = req.get('host') || '';
    return base && /^https:\/\/[\w.-]+(?::\d+)?$/i.test(base) ? base : `${/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host) ? 'http' : 'https'}://${host}`;
  }

  // Deja solo lo que se puede compartir: textos con tope de largo y fotos/audios que de verdad son de esta cuenta (la
  // dueña del archivo va en su propia ruta). Las fotos y audios se guardan una vez en "medios" y el libro los nombra por posición.
  // copias: original -> copia en WAV (los .webm de Chrome no suenan en todos los iPhone); si la hay, el enlace usa la copia.
  function limpiar(crudo, ownerId, copias = new Map()) {
    if (!crudo || typeof crudo !== 'object' || !Array.isArray(crudo.capitulos)) return null;
    const medios = [];
    const urlPropia = (u) => {
      if (typeof u !== 'string' || u.length > 1000 || u.includes('..') || !/^https:\/\//i.test(u)) return false;
      const d = datosDelArchivoDeBlob(u);
      return !!d && d.ownerId === ownerId;
    };
    const posicion = (u) => { let i = medios.indexOf(u); if (i < 0 && medios.length < MAX_MEDIOS) { medios.push(u); i = medios.length - 1; } return i; };
    const capitulos = crudo.capitulos.slice(0, 250).map((c) => {
      const cap = c && typeof c === 'object' ? c : {};
      const fotos = (Array.isArray(cap.fotos) ? cap.fotos : []).slice(0, 12).filter((f) => f && urlPropia(f.url)).map((f) => ({ m: posicion(f.url), pie: texto(f.pie, 180) })).filter((f) => f.m >= 0);
      const audios = (Array.isArray(cap.audios) ? cap.audios : []).slice(0, 40).filter((a) => a && urlPropia(a.url)).map((a) => ({ a, destino: copias.get(a.url) || a.url })).filter((x) => urlPropia(x.destino)).map((x) => ({ m: posicion(x.destino), pregunta: texto(x.a.pregunta, 300) })).filter((a) => a.m >= 0);
      return { id: Number.isSafeInteger(cap.id) ? cap.id : null, titulo: texto(cap.titulo, 200).trim() || 'Capítulo', tema: texto(cap.tema, 120), texto: texto(cap.texto, 120000), fotos, audios };
    });
    return { datos: { titulo: texto(crudo.titulo, 200).trim() || 'Mi libro', subtitulo: texto(crudo.subtitulo, 300), dedicatoria: texto(crudo.dedicatoria, 4000), fecha: texto(crudo.fecha, 40), idioma: crudo.idioma === 'en' ? 'en' : 'es', capitulos }, medios };
  }

  // Crea el enlace del libro o, si ya hay uno activo, lo actualiza con el libro de ahora (mismo enlace).
  app.post('/api/libro-compartido', requireAuth, bloquearColaborador, rateLimit, async (req, res) => {
    sinCache(res);
    try {
      await ready();
      const compra = await sql`SELECT 1 FROM book_demo_purchases WHERE owner_id=${req.profileUserId} AND status='approved'`;
      if (!compra.length) return res.status(402).json({ error: 'Para compartir el libro primero hay que completar la compra.' });
      const filas = await sql`SELECT original_url, wav_url FROM libro_audios WHERE owner_id=${req.profileUserId}`;
      const limpio = limpiar(req.body && req.body.datos, req.profileUserId, new Map(filas.map((f) => [f.original_url, f.wav_url])));
      if (!limpio || !limpio.datos.capitulos.length) return res.status(400).json({ error: 'El libro no tiene capítulos para compartir.' });
      const previo = (await sql`SELECT token FROM libros_compartidos WHERE owner_id=${req.profileUserId} AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`)[0];
      const datos = JSON.stringify(limpio.datos), medios = JSON.stringify(limpio.medios);
      let token;
      if (previo) {
        token = previo.token;
        await sql`UPDATE libros_compartidos SET datos=${datos}, medios=${medios}, updated_at=now() WHERE token=${token} AND owner_id=${req.profileUserId}`;
      } else {
        token = crypto.randomBytes(24).toString('hex');
        await sql`INSERT INTO libros_compartidos(token,owner_id,datos,medios) VALUES(${token},${req.profileUserId},${datos},${medios})`;
      }
      res.json({ ok: true, token, url: `${origen(req)}/libro/${token}`, nuevo: !previo });
    } catch (e) {
      console.error('Enlace del libro', e);
      res.status(500).json({ error: 'No se pudo preparar el enlace para compartir.' });
    }
  });

  // Qué audios ya tienen su copia en WAV (para que el navegador solo convierta los que faltan).
  app.get('/api/libro-compartido/audios', requireAuth, bloquearColaborador, async (req, res) => {
    sinCache(res);
    try {
      await ready();
      const filas = await sql`SELECT original_url, wav_url FROM libro_audios WHERE owner_id=${req.profileUserId}`;
      res.json({ copias: Object.fromEntries(filas.map((f) => [f.original_url, f.wav_url])) });
    } catch (e) {
      console.error('Copias de audio del libro (consulta)', e);
      res.status(500).json({ error: 'No se pudieron consultar los audios.' });
    }
  });

  // Guarda la copia en WAV de un audio de la cuenta (la convierte el navegador, que ya sabe leer el .webm).
  app.put('/api/libro-compartido/audio', requireAuth, bloquearColaborador, rateLimit, express.raw({ type: () => true, limit: '4500kb' }), async (req, res) => {
    sinCache(res);
    const original = typeof req.query.u === 'string' ? req.query.u : '';
    const datos = original.length <= 1000 && !original.includes('..') && /^https:\/\//i.test(original) ? datosDelArchivoDeBlob(original) : null;
    if (!datos || datos.ownerId !== req.profileUserId) return res.status(400).json({ error: 'Ese audio no es de tu cuenta.' });
    const cuerpo = req.body;
    if (!Buffer.isBuffer(cuerpo) || cuerpo.length < 100 || cuerpo.toString('latin1', 0, 4) !== 'RIFF' || cuerpo.toString('latin1', 8, 12) !== 'WAVE') return res.status(400).json({ error: 'El audio no es un WAV válido.' });
    try {
      await ready();
      const guardado = await almacenarArchivo(`media/libros/${req.profileUserId}/audio-${crypto.randomBytes(12).toString('hex')}.wav`, cuerpo, 'audio/wav');
      await sql`INSERT INTO libro_audios(owner_id, original_url, wav_url) VALUES(${req.profileUserId}, ${original}, ${guardado.url}) ON CONFLICT (owner_id, original_url) DO UPDATE SET wav_url = EXCLUDED.wav_url`;
      res.json({ ok: true, url: guardado.url });
    } catch (e) {
      console.error('Copia de audio del libro', e);
      res.status(500).json({ error: 'No se pudo guardar el audio.' });
    }
  });

  // El enlace activo de la cuenta (si lo hay), para mostrarlo en el estudio del libro.
  app.get('/api/libro-compartido', requireAuth, bloquearColaborador, async (req, res) => {
    sinCache(res);
    try {
      await ready();
      const item = (await sql`SELECT token,updated_at FROM libros_compartidos WHERE owner_id=${req.profileUserId} AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`)[0];
      if (!item) return res.json({ activo: false });
      res.json({ activo: true, url: `${origen(req)}/libro/${item.token}`, actualizado: item.updated_at });
    } catch (e) {
      console.error('Enlace del libro (consulta)', e);
      res.status(500).json({ error: 'No se pudo consultar el enlace.' });
    }
  });

  // Deja de compartir: el enlace deja de funcionar para todos.
  app.delete('/api/libro-compartido', requireAuth, bloquearColaborador, rateLimit, async (req, res) => {
    sinCache(res);
    try {
      await ready();
      await sql`UPDATE libros_compartidos SET revoked_at=now() WHERE owner_id=${req.profileUserId} AND revoked_at IS NULL`;
      res.json({ ok: true });
    } catch (e) {
      console.error('Enlace del libro (retirar)', e);
      res.status(500).json({ error: 'No se pudo retirar el enlace.' });
    }
  });

  // Público (sin sesión): la página del libro.
  app.get('/libro/:token', rateLimitQr, async (req, res) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    sinCache(res);
    // SEC-04: la página trae sus propios estilos y scripts inline, así que
    // no se puede usar una CSP con hashes sin riesgo de romperla. Se pone
    // una CSP mínima: permite inline (unsafe-inline) para no romper nada,
    // pero bloquea objetos embebidos, frames de terceros y form-action
    // externo, reduciendo la superficie de ataque frente a inyección.
    res.removeHeader('Content-Security-Policy-Report-Only');
    res.removeHeader('Reporting-Endpoints');
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' blob: data: https:; media-src 'self' https:; connect-src 'self'; frame-src 'none'; object-src 'none'; form-action 'self'; base-uri 'self'");
    if (!tokenValido(req.params.token)) return res.status(404).type('html').send(PAGINA_NO_DISPONIBLE);
    try {
      await ready();
      const item = (await sql`SELECT lc.datos, COALESCE(cuenta.idioma, admin.idioma) AS idioma FROM libros_compartidos lc
        LEFT JOIN users cuenta ON cuenta.id = lc.owner_id
        LEFT JOIN bitacoras b ON b.id = lc.owner_id LEFT JOIN users admin ON admin.id = b.admin_user_id
        WHERE lc.token=${req.params.token} AND lc.revoked_at IS NULL`)[0];
      const datos = item && jsonDe(item.datos, null);
      if (!datos || !Array.isArray(datos.capitulos)) return res.status(404).type('html').send(PAGINA_NO_DISPONIBLE);
      // Enlaces creados antes de guardar el idioma: se usa el de la cuenta.
      if (datos.idioma !== 'en' && datos.idioma !== 'es') datos.idioma = item.idioma === 'en' ? 'en' : 'es';
      const medio = (m) => `/api/libro/${req.params.token}/m/${m}`;
      const paraLaPagina = { ...datos, capitulos: datos.capitulos.map((c) => ({ ...c, fotos: c.fotos.map((f) => ({ src: medio(f.m), pie: f.pie })), audios: c.audios.map((a) => ({ src: medio(a.m), pregunta: a.pregunta })) })) };
      res.type('html').send(Pagina.armar({ plantilla: plantilla(), fuentes: CSS_FUENTES, datos: paraLaPagina, enlace: true }));
    } catch (e) {
      console.error('Página del libro compartido', e);
      res.status(500).type('html').send(PAGINA_NO_DISPONIBLE);
    }
  });

  // Público: una foto o un audio del libro, por posición en la lista guardada.
  app.get('/api/libro/:token/m/:n', rateLimitQr, async (req, res) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    if (!tokenValido(req.params.token) || !/^\d{1,3}$/.test(req.params.n)) return res.status(404).json({ error: 'Enlace no encontrado.' });
    try {
      await ready();
      const item = (await sql`SELECT owner_id,medios FROM libros_compartidos WHERE token=${req.params.token} AND revoked_at IS NULL`)[0];
      const guardado = item ? jsonDe(item.medios, [])[Number(req.params.n)] : null;
      if (typeof guardado !== 'string') return res.status(404).json({ error: 'Este enlace ya no está disponible.' });
      // Defensa extra: el archivo tiene que ser de quien creó el enlace.
      const datos = datosDelArchivoDeBlob(guardado);
      if (!datos || datos.ownerId !== item.owner_id) return res.status(404).json({ error: 'Este enlace ya no está disponible.' });
      await enviarArchivoAlmacenado(req, res, guardado, 'private, no-cache');
    } catch (e) {
      console.error('Archivo del libro compartido', e);
      if (!res.headersSent) res.status(500).json({ error: 'No se pudo cargar el archivo.' });
      else res.destroy();
    }
  });
};
