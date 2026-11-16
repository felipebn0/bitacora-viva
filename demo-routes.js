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

const CIERRE_DEMO = `(Se acabó el minuto de prueba. Este es tu último mensaje: despídete de esta charla y cuéntale qué es Eco, en máximo 5 frases cortas, sin hacer ninguna pregunta:
1. Agradécele por su nombre y retoma en una frase algo concreto y bonito que te contó (si no alcanzó a contar nada, dile que su historia está esperando).
2. Cuéntale que con su cuenta gratis Eco sigue charlando con ella de a poco, unos minutos al día, y guarda cada historia con su propia voz.
3. Cuéntale que con esas historias Eco arma capítulos, un árbol de la familia y hasta un libro, y que su familia puede escucharla y sumar sus propios recuerdos.
4. Invítala a crear su cuenta con el botón que le va a aparecer en la pantalla.
Usa el mismo tono cálido de la charla, nada de lenguaje de venta.)`;

module.exports = (app, deps) => {
  const {
    sql, ensureSchema, anthropic, MODEL, SYSTEM_PROMPT, SESSION_SECRET, PROVIDER_TIMEOUT_MS, rateLimit,
    extraerMarcaAyuda, contarPreguntas, dejarUnaSolaPregunta, asegurarEspanolColombiano, primerBloqueDeTexto,
    verificarArchivoReal, AUDIO_MIME_PERMITIDOS, hablar, ELEVEN_KEY,
  } = deps;

  const SYSTEM_DEMO = SYSTEM_PROMPT + INSTRUCCION_DEMO;
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
      if (await sumar('red:' + huellaRed(req.ip)) > DEMOS_POR_RED_AL_DIA) return res.status(429).json({ motivo: 'limite' });
      if (await sumar('total') > DEMOS_AL_DIA) return res.status(429).json({ motivo: 'cupo' });
      const id = crypto.randomBytes(12).toString('base64url');
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
      if (await sumar('turnos:' + datos.id) > TURNOS_POR_DEMO + 1) return res.status(429).json({ motivo: 'turnos' });

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
        max_tokens: fin ? 400 : 250,
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
      res.json({ texto, audio, ayuda: marca.ayuda || null, fin });
    } catch (err) {
      console.error('[demo] turno:', err);
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
      if (await sumar('stt:' + datos.id) > TRANSCRIPCIONES_POR_DEMO) return res.status(429).json({ motivo: 'turnos' });
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
      res.json({ text: String(data.text || '').trim().slice(0, 2000) });
    } catch (err) {
      console.error('[demo] transcribir:', err);
      res.status(500).json({ motivo: 'error' });
    }
  });

  return { leerToken, firmar };
};
