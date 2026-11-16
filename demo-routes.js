/* Demo pública de un minuto (/demo): la persona escribe su nombre y charla con Eco de verdad (misma IA, misma voz)
 * durante un minuto. Al terminar, Eco le cuenta qué más puede hacer con una cuenta y la página muestra el botón de
 * registro. No hay cuenta ni cookie: un token firmado dura lo que dura la prueba.
 *
 * Nada de lo que la persona dice se guarda: el audio y el texto solo viajan a la IA para contestar. Lo único que queda en
 * la base son contadores (demo_cupos): cuántas demos van hoy en total y por red (la IP va como huella, no tal cual).
 *
 * Topes, porque cada demo gasta créditos de Claude y de voz: 3 demos al día por red, 200 al día en total (hora de
 * Colombia), 8 turnos de charla por demo y 4 minutos de vida por token. DEMO_DESACTIVADA=1 en Vercel la apaga.
 */
const crypto = require('crypto');
const path = require('path');
const express = require('express');

const DEMOS_POR_RED_AL_DIA = 3;
const DEMOS_AL_DIA = 200;
const TURNOS_POR_DEMO = 8;
const TRANSCRIPCIONES_POR_DEMO = 12;
const VIDA_TOKEN_MS = 4 * 60 * 1000;
const MAX_NOMBRE = 40;

const INSTRUCCION_DEMO = `

=== MODO PRUEBA DE UN MINUTO (esto pesa más que cualquier otra instrucción de arriba) ===
Esta persona NO tiene cuenta: está probando Eco durante un minuto desde la página web. No hay resumen de charlas anteriores, ni familia registrada, ni fotos, ni árbol: nada de eso existe todavía. No le hables de botones, pausas, capítulos ni otras partes de la app durante la charla.
- Respuestas MUY cortas: una reacción breve y cálida a lo que contó y UNA sola pregunta. Máximo 2 o 3 frases.
- Ve directo a un recuerdo concreto y bonito; nada de pruebas de micrófono ni preguntas de datos.
- No uses las marcas [FIN] ni [PAUSA]: el cierre de esta prueba lo indica un aviso entre paréntesis.
=== FIN DEL MODO PRUEBA ===`;

const inicioDemo = (nombre) => `(La persona se llama ${nombre} y acaba de empezar una prueba de Eco de un minuto, sin cuenta. En 2 frases cortas: salúdala por su nombre con calidez y hazle de una una pregunta fácil y cercana para que empiece a contar un recuerdo de su familia o de su infancia. No le expliques la app.)`;

const CIERRE_DEMO = `(Se acabó el minuto de prueba. Este es tu último mensaje antes de que la app le cuente qué es Eco: en máximo 2 frases cortas y sin ninguna pregunta, reacciona con calidez a lo último que contó y agradécele por su nombre por compartirlo contigo. Si no alcanzó a contar nada, dile con cariño que su historia la está esperando. No expliques la app ni la invites a nada: eso viene justo después.)`;

// Lo que viene después de la despedida es igual para todos: se convierte a voz una sola vez por instancia del servidor
// y el navegador lo pide apenas arranca la demo, así al final no hay que esperar a que se genere.
const PITCH_DEMO = 'Con tu cuenta gratis, Eco sigue charlando contigo de a poco, unos minutos al día, y guarda cada historia con tu propia voz. Con esas historias arma capítulos, el árbol de tu familia y hasta un libro, y tu familia puede escucharte y sumar sus propios recuerdos. Crea tu cuenta con el botón que aparece en la pantalla.';

// Analítica: contadores por día de cada paso (demo_eventos). Solo cuántas veces pasó algo; nunca quién ni qué dijo.
// Los que manda la página (no los puede saber el servidor) van en esta lista; el resto los anota el servidor solo.
const EVENTOS_DE_LA_PAGINA = new Set(['visita', 'mic_negado', 'popup', 'clic_registro', 'ahora_no']);
const EVENTOS = ['visita', 'empezo', 'saludo', 'hablo', 'turno_persona', 'completo', 'popup', 'clic_registro', 'ahora_no', 'mic_negado', 'limite', 'cupo', 'error_ia'];

module.exports = (app, deps) => {
  const {
    sql, ensureSchema, anthropic, MODEL, SYSTEM_PROMPT, SESSION_SECRET, PROVIDER_TIMEOUT_MS, rateLimit,
    extraerMarcaAyuda, contarPreguntas, dejarUnaSolaPregunta, asegurarEspanolColombiano, primerBloqueDeTexto,
    verificarArchivoReal, AUDIO_MIME_PERMITIDOS, hablar, ELEVEN_KEY, requireAuth, requireAdmin,
  } = deps;

  const SYSTEM_DEMO = SYSTEM_PROMPT + INSTRUCCION_DEMO;
  let audioPitch = null;
  // Llave propia para los tokens de la demo: un token de demo nunca sirve como cookie de sesión (ni al revés).
  const LLAVE = crypto.createHmac('sha256', String(SESSION_SECRET || '')).update('eco-demo-v1').digest();

  function firmar(datos) {
    const b64 = Buffer.from(JSON.stringify(datos)).toString('base64url');
    return `${b64}.${crypto.createHmac('sha256', LLAVE).update(b64).digest('base64url')}`;
  }
  function leerToken(token) {
    if (typeof token !== 'string' || token.length > 600) return null;
    const i = token.lastIndexOf('.');
    if (i < 1) return null;
    const b64 = token.slice(0, i);
    const firma = Buffer.from(token.slice(i + 1));
    const esperada = Buffer.from(crypto.createHmac('sha256', LLAVE).update(b64).digest('base64url'));
    if (firma.length !== esperada.length || !crypto.timingSafeEqual(firma, esperada)) return null;
    try {
      const datos = JSON.parse(Buffer.from(b64, 'base64url').toString());
      if (!datos || !datos.demo || typeof datos.id !== 'string' || typeof datos.nombre !== 'string') return null;
      if (typeof datos.iat !== 'number' || Date.now() - datos.iat > VIDA_TOKEN_MS) return null;
      return datos;
    } catch (e) {
      return null;
    }
  }

  // Suma 1 al contador de hoy (hora de Colombia) y devuelve el total. Los de días viejos se borran de paso.
  async function sumar(clave) {
    const filas = await sql`
      INSERT INTO demo_cupos (clave, dia, cuenta)
      VALUES (${clave}, (now() AT TIME ZONE 'America/Bogota')::date, 1)
      ON CONFLICT (clave) DO UPDATE SET
        cuenta = CASE WHEN demo_cupos.dia = EXCLUDED.dia THEN demo_cupos.cuenta + 1 ELSE 1 END,
        dia = EXCLUDED.dia
      RETURNING cuenta`;
    if (Math.random() < 0.05) {
      sql`DELETE FROM demo_cupos WHERE dia < (now() AT TIME ZONE 'America/Bogota')::date - 2`.catch(() => {});
    }
    return (filas[0] && filas[0].cuenta) || 1;
  }
  // Nunca frena ni rompe la demo: si no se puede anotar, se sigue igual.
  function anotar(evento) {
    Promise.resolve().then(() => ensureSchema()).then(() => sql`
      INSERT INTO demo_eventos (dia, evento, cuenta)
      VALUES ((now() AT TIME ZONE 'America/Bogota')::date, ${evento}, 1)
      ON CONFLICT (dia, evento) DO UPDATE SET cuenta = demo_eventos.cuenta + 1`).catch((err) => {
      console.error('[demo] no se pudo anotar el evento:', err.message);
    });
  }

  const huellaRed = (ip) => crypto.createHmac('sha256', LLAVE).update(String(ip || 'desconocida')).digest('hex').slice(0, 32);

  function apagada(res) {
    if (process.env.DEMO_DESACTIVADA === '1') {
      res.status(503).json({ motivo: 'apagada' });
      return true;
    }
    return false;
  }

  function limpiarNombre(v) {
    const n = String(typeof v === 'string' ? v : '').replace(/[\u0000-\u001f<>{}[\]()"`\\]/g, ' ').replace(/\s+/g, ' ').trim();
    return n.slice(0, MAX_NOMBRE).trim();
  }

  app.get(['/demo', '/demo/'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'demo.html')));

  app.post('/api/demo/empezar', rateLimit, async (req, res) => {
    try {
      if (apagada(res)) return;
      const nombre = limpiarNombre(req.body && req.body.nombre);
      if (!nombre) return res.status(400).json({ motivo: 'nombre' });
      await ensureSchema();
      if (await sumar('red:' + huellaRed(req.ip)) > DEMOS_POR_RED_AL_DIA) { anotar('limite'); return res.status(429).json({ motivo: 'limite' }); }
      if (await sumar('total') > DEMOS_AL_DIA) { anotar('cupo'); return res.status(429).json({ motivo: 'cupo' }); }
      const id = crypto.randomBytes(12).toString('base64url');
      anotar('empezo');
      res.json({ token: firmar({ demo: 1, id, nombre, iat: Date.now() }), segundos: 60 });
    } catch (err) {
      console.error('[demo] empezar:', err);
      res.status(500).json({ motivo: 'error' });
    }
  });

  app.post('/api/demo/turno', rateLimit, async (req, res) => {
    try {
      if (apagada(res)) return;
      const datos = leerToken(req.body && req.body.token);
      if (!datos) return res.status(401).json({ motivo: 'vencida' });
      const historial = Array.isArray(req.body.history) ? req.body.history : [];
      if (historial.length > TURNOS_POR_DEMO * 2) return res.status(429).json({ motivo: 'turnos' });
      for (const m of historial) {
        if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
          return res.status(400).json({ motivo: 'historial' });
        }
        m.content = m.content.slice(0, 2000);
      }
      const fin = req.body.fin === true;
      await ensureSchema();
      const numeroDeTurno = await sumar('turnos:' + datos.id);
      if (numeroDeTurno > TURNOS_POR_DEMO + 1) return res.status(429).json({ motivo: 'turnos' });

      // Los avisos entre paréntesis van como mensajes de la persona, igual que en la app.
      const messages = [{ role: 'user', content: inicioDemo(datos.nombre) }];
      for (const m of historial) {
        const ultimo = messages[messages.length - 1];
        if (ultimo.role === m.role) ultimo.content += '\n\n' + m.content;
        else messages.push({ role: m.role, content: m.content });
      }
      if (fin) {
        const ultimo = messages[messages.length - 1];
        if (ultimo.role === 'user') ultimo.content += '\n\n' + CIERRE_DEMO;
        else messages.push({ role: 'user', content: CIERRE_DEMO });
      } else if (messages[messages.length - 1].role !== 'user') {
        return res.status(400).json({ motivo: 'historial' });
      }

      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: fin ? 150 : 250,
        // Igual para todas las demos (el nombre va en los mensajes): el caché de Anthropic se comparte entre ellas.
        system: [{ type: 'text', text: SYSTEM_DEMO, cache_control: { type: 'ephemeral' } }],
        messages,
      }, { timeout: PROVIDER_TIMEOUT_MS });
      const u = response.usage || {};
      console.log(`[demo] turno fin=${fin} entrada=${u.input_tokens || 0} cache-lee=${u.cache_read_input_tokens || 0} cache-escribe=${u.cache_creation_input_tokens || 0} salida=${u.output_tokens || 0}`);

      let texto = (primerBloqueDeTexto(response) || '').replace(/\[(FIN|PAUSA|FALTA_DATO)\]/g, '').trim();
      const marca = extraerMarcaAyuda(texto);
      texto = marca.text;
      if (!texto) throw new Error('Respuesta de la IA sin texto.');
      if (!fin && contarPreguntas(texto) > 1) texto = await dejarUnaSolaPregunta(null, texto);
      texto = await asegurarEspanolColombiano(null, texto);

      let audio = null;
      try {
        const buffer = await hablar(texto);
        if (buffer) audio = Buffer.from(buffer).toString('base64');
      } catch (err) {
        console.error('[demo] voz:', err.message);
      }
      if (fin) anotar('completo');
      else if (numeroDeTurno === 1) anotar('saludo');
      res.json({ texto, audio, ayuda: marca.ayuda || null, fin });
    } catch (err) {
      anotar('error_ia');
      console.error('[demo] turno:', err);
      res.status(500).json({ motivo: 'error' });
    }
  });

  app.post('/api/demo/pitch', rateLimit, async (req, res) => {
    try {
      if (apagada(res)) return;
      if (!leerToken(req.body && req.body.token)) return res.status(401).json({ motivo: 'vencida' });
      if (!audioPitch) {
        audioPitch = Promise.resolve(hablar(PITCH_DEMO)).then((b) => (b ? Buffer.from(b).toString('base64') : null));
        audioPitch.catch(() => {});
      }
      let audio = null;
      try {
        audio = await audioPitch;
      } catch (err) {
        console.error('[demo] voz del pitch:', err.message);
      }
      if (!audio) audioPitch = null;
      res.json({ texto: PITCH_DEMO, audio });
    } catch (err) {
      console.error('[demo] pitch:', err);
      res.status(500).json({ motivo: 'error' });
    }
  });

  app.post('/api/demo/transcribir', rateLimit, express.raw({ type: '*/*', limit: '3mb' }), async (req, res) => {
    try {
      if (apagada(res)) return;
      const datos = leerToken(req.get('X-Demo-Token'));
      if (!datos) return res.status(401).json({ motivo: 'vencida' });
      if (!req.body || !req.body.length) return res.status(400).json({ motivo: 'audio' });
      if (!ELEVEN_KEY) return res.status(501).json({ motivo: 'sin-proveedor' });
      await ensureSchema();
      const numeroDeAudio = await sumar('stt:' + datos.id);
      if (numeroDeAudio > TRANSCRIPCIONES_POR_DEMO) return res.status(429).json({ motivo: 'turnos' });
      const real = await verificarArchivoReal(req.body, AUDIO_MIME_PERMITIDOS);
      if (!real) return res.status(400).json({ motivo: 'audio' });
      const form = new FormData();
      form.append('model_id', 'scribe_v1');
      form.append('language_code', 'spa');
      form.append('file', new Blob([req.body], { type: real.mime }), `audio.${real.ext}`);
      const resp = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: { 'xi-api-key': ELEVEN_KEY },
        body: form,
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      if (!resp.ok) {
        console.error('[demo] STT:', resp.status, await resp.text());
        return res.status(502).json({ motivo: 'error' });
      }
      const data = await resp.json();
      const texto = String(data.text || '').trim().slice(0, 2000);
      if (texto) {
        anotar('turno_persona');
        // «Hablaron»: demos en las que la persona dijo algo al menos una vez (se cuenta la primera vez de cada demo).
        if (await sumar('hablo:' + datos.id) === 1) anotar('hablo');
      }
      res.json({ text: texto });
    } catch (err) {
      console.error('[demo] transcribir:', err);
      res.status(500).json({ motivo: 'error' });
    }
  });

  app.post('/api/demo/evento', rateLimit, (req, res) => {
    const evento = req.body && req.body.evento;
    if (typeof evento !== 'string' || !EVENTOS_DE_LA_PAGINA.has(evento)) return res.status(400).json({ motivo: 'evento' });
    if (process.env.DEMO_DESACTIVADA !== '1') anotar(evento);
    res.status(204).end();
  });

  // Panel de admin: el embudo de la demo por día, más las cuentas creadas desde ella (users.origen_registro = 'demo',
  // que pone el botón del final con ?desde=demo, ver eco-origen.js).
  app.get('/api/admin/demo', requireAuth, requireAdmin, async (req, res) => {
    try {
      const dias = Math.max(1, Math.min(365, parseInt(req.query.dias, 10) || 30));
      await ensureSchema();
      const filas = await sql`
        SELECT to_char(dia, 'YYYY-MM-DD') AS dia, evento, cuenta
        FROM demo_eventos
        WHERE dia > (now() AT TIME ZONE 'America/Bogota')::date - ${dias}::int
        ORDER BY dia DESC`;
      const cuentas = await sql`
        SELECT to_char((created_at AT TIME ZONE 'America/Bogota')::date, 'YYYY-MM-DD') AS dia, count(*)::int AS cuenta
        FROM users
        WHERE origen_registro = 'demo'
          AND (created_at AT TIME ZONE 'America/Bogota')::date > (now() AT TIME ZONE 'America/Bogota')::date - ${dias}::int
        GROUP BY 1`;
      const porDia = {};
      const vacio = () => Object.fromEntries(EVENTOS.concat('cuentas').map((e) => [e, 0]));
      const totales = vacio();
      for (const f of filas) {
        if (!EVENTOS.includes(f.evento)) continue;
        (porDia[f.dia] = porDia[f.dia] || vacio())[f.evento] += Number(f.cuenta) || 0;
        totales[f.evento] += Number(f.cuenta) || 0;
      }
      for (const c of cuentas) {
        (porDia[c.dia] = porDia[c.dia] || vacio()).cuentas += Number(c.cuenta) || 0;
        totales.cuentas += Number(c.cuenta) || 0;
      }
      res.set('Cache-Control', 'no-store');
      res.json({
        dias,
        totales,
        porDia: Object.keys(porDia).sort().reverse().map((dia) => Object.assign({ dia }, porDia[dia])),
        limites: { porRed: DEMOS_POR_RED_AL_DIA, alDia: DEMOS_AL_DIA },
        apagada: process.env.DEMO_DESACTIVADA === '1',
      });
    } catch (err) {
      console.error('[demo] panel:', err);
      res.status(500).json({ error: 'No se pudieron cargar las cifras de la demo.' });
    }
  });

  return { leerToken, firmar };
};
