require('dotenv').config({ quiet: true });
const express = require('express');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { neon } = require('@neondatabase/serverless');
const { put } = require('@vercel/blob');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Limitador simple por IP: evita que alguien con el link (por ejemplo un
// túnel de ngrok abierto, o la URL pública de Vercel) gaste crédito de
// Claude/ElevenLabs a lo loco.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30; // pedidos por minuto por IP, a las rutas que cuestan dinero
const rateLimitHits = new Map();

function rateLimit(req, res, next) {
  const ip = req.ip || 'desconocida';
  const now = Date.now();
  const hits = (rateLimitHits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Demasiados pedidos, esperá un momento.' });
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
      await sql`CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
        intercambios JSONB NOT NULL
      )`;
      await sql`CREATE TABLE IF NOT EXISTS resumen (
        id INT PRIMARY KEY DEFAULT 1,
        texto TEXT NOT NULL DEFAULT '',
        actualizado TIMESTAMPTZ
      )`;
      await sql`INSERT INTO resumen (id, texto) VALUES (1, '') ON CONFLICT (id) DO NOTHING`;
    })();
  }
  return schemaReady;
}

async function loadMemorySummary() {
  await ensureSchema();
  const rows = await sql`SELECT texto FROM resumen WHERE id = 1`;
  return (rows[0] && rows[0].texto) || '';
}

async function buildFullTranscripts(keyword) {
  await ensureSchema();
  const rows = await sql`SELECT fecha, intercambios FROM sessions ORDER BY fecha ASC`;
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

async function updateMemorySummary(newExchanges) {
  try {
    const anterior = await loadMemorySummary();
    const nuevaCharla = (newExchanges || [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => (m.role === 'assistant' ? 'Entrevistadora: ' : 'Él contó: ') + m.content)
      .join('\n');

    if (!nuevaCharla.trim()) return;

    const prompt = `Resumen actual de la vida de esta persona (puede estar vacío si es la primera charla):\n${anterior || '(ninguno todavía)'}\n\nCharla nueva para integrar:\n${nuevaCharla}\n\nGenerá un resumen actualizado, compacto (máximo 400 palabras), en español, en tercera persona, organizado en viñetas cortas por tema (identidad y familia, infancia, trabajo, momentos importantes, valores o consejos). Integrá lo nuevo con lo anterior sin perder datos importantes ya guardados.`;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }],
    });

    const texto = response.content[0].text.trim();
    await ensureSchema();
    await sql`UPDATE resumen SET texto = ${texto}, actualizado = now() WHERE id = 1`;
  } catch (err) {
    console.error('No se pudo actualizar el resumen:', err);
  }
}

const SYSTEM_PROMPT = `Eres una entrevistadora cálida y paciente, colombiana, que ayuda a una persona mayor a contar la historia de su vida. Hablas en español de Colombia, tuteando siempre a la persona (usa "tú", nunca "usted" ni "vos": "¿cómo estás?", "cuéntame", "tienes"), con oraciones simples y cortas, fáciles de escuchar en voz alta.

Usa modismos colombianos suaves y variados, propios de un trato respetuoso con una persona mayor (por ejemplo: "qué más", "listo", "de una", "qué chévere", "¿cierto?", "pues sí", "qué belleza", "qué interesante", "cuéntame más" — nunca jerga juvenil o vulgar como "bacano", "berraquera" o groserías). El tono es animado y cercano, pero con la calidez respetuosa con la que se habla con un mayor, no como con un amigo de la misma edad.

Esto es una charla de sobremesa, no un cuestionario. Antes de pasar a otra cosa, reacciona de verdad a lo que te acaban de contar: comenta algo, ríete si hay algo gracioso, sorpréndete, o pide un detalle más ("¿y qué pasó después?", "¿en serio? cuéntame más de eso") antes de avanzar a otro tema. Alterna entre preguntas cortas y comentarios — no todos los turnos tienen que terminar en pregunta.

Reglas:
- Una sola idea por turno: o preguntas, o comentas, nunca varias preguntas juntas.
- Empieza siempre por conocer a la persona: su nombre, el nombre de sus papás, sus hermanos, tíos cercanos, y si llegó a conocer a sus abuelos y cómo se llamaban.
- Después avanza naturalmente hacia su infancia, juventud, trabajo, momentos de orgullo, desafíos superados, y algún consejo o mensaje para su familia.
- Escucha de verdad lo que cuenta: si menciona algo interesante (un nombre, un lugar, una anécdota), profundiza en eso antes de seguir con el guion. No sigas un orden rígido.
- Tono cálido, agradecido, sin apuro.
- Cuando sientas que la charla ya cubrió una historia rica y completa (generalmente entre 12 y 20 intercambios), cierra con un mensaje cálido de despedida agradeciendo lo compartido, avisando que quedó guardado, e invitando a seguir otro día. Termina ese mensaje final, y solo ese, con la palabra exacta [FIN] en una línea aparte.
- Nunca uses la palabra [FIN] excepto en ese cierre.
- Si más abajo hay un resumen de charlas anteriores, no vuelvas a preguntar nada que ya está ahí (nombre, familia, etc.). Saluda siempre por su nombre si el resumen lo tiene (ej: "¡Hola, Felipe!"), y arranca yendo directo a un tema nuevo, o profundizando en algo que quedó pendiente.`;

app.post('/api/next', rateLimit, async (req, res) => {
  try {
    const history = Array.isArray(req.body.history) ? req.body.history.slice(0, 60) : [];
    for (const m of history) {
      if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
        return res.status(400).json({ error: 'Historial inválido.' });
      }
      if (m.content.length > 4000) m.content = m.content.slice(0, 4000);
    }
    const messages = history.length
      ? history
      : [{
          role: 'user',
          content: '(La persona acaba de presionar el botón para empezar a charlar. Si el resumen tiene su nombre, saludala por su nombre. Si no, saludala cálidamente y preguntale cómo se llama.)',
        }];

    const memoria = await loadMemorySummary();
    const system = memoria
      ? `${SYSTEM_PROMPT}\n\nResumen de charlas anteriores (no repitas lo que ya está acá):\n${memoria}`
      : SYSTEM_PROMPT;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system,
      messages,
    });

    let text = response.content[0].text.trim();
    const done = text.includes('[FIN]');
    text = text.replace('[FIN]', '').trim();

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
        model_id: 'eleven_multilingual_v2',
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

app.post('/api/transcribe', rateLimit, express.raw({ type: '*/*', limit: '20mb' }), async (req, res) => {
  try {
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'Falta audio.' });
    if (!ELEVEN_KEY) {
      return res.status(501).json({ error: 'ElevenLabs no está configurado, no se puede transcribir.' });
    }

    const contentType = req.get('Content-Type') || 'audio/webm';
    const formData = new FormData();
    formData.append('model_id', 'scribe_v1');
    formData.append('language_code', 'spa');
    formData.append('file', new Blob([req.body], { type: contentType }), 'audio.webm');

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

app.post('/api/speak', rateLimit, async (req, res) => {
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

app.post('/api/save-audio', express.raw({ type: '*/*', limit: '20mb' }), async (req, res) => {
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
    const filename = `audio/${safeSession}/${safeRole}-${safeIndex}.${ext}`;

    const blob = await put(filename, req.body, { access: 'public', contentType, addRandomSuffix: true });
    res.json({ ok: true, file: blob.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar el audio.' });
  }
});

app.post('/api/save', async (req, res) => {
  try {
    const history = Array.isArray(req.body.history) ? req.body.history.slice(0, 100) : [];
    if (!history.length) return res.status(400).json({ error: 'Nada que guardar.' });

    await ensureSchema();
    await sql`INSERT INTO sessions (intercambios) VALUES (${JSON.stringify(history)}::jsonb)`;
    res.json({ ok: true });

    // se actualiza en segundo plano, no hace esperar al usuario
    updateMemorySummary(history).catch((err) => console.error('No se pudo actualizar el resumen:', err));
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'No se pudo guardar la charla.' });
  }
});

const FAMILY_SYSTEM_PROMPT_BASE = `Tenés acceso al resumen de charlas donde una persona mayor fue contando la historia de su vida. Tu trabajo es responder preguntas de su familia sobre lo que él contó, basándote únicamente en esa información.

Reglas:
- Respondé en español, cálido pero directo, en 2-4 oraciones.
- Si la información no está disponible, decilo con claridad: no inventes ni completes con suposiciones.
- Hablá de él en tercera persona ("contó que...", "dijo que...").
- Si el resumen no tiene el detalle necesario para responder con precisión (una cita exacta, una fecha, algo muy específico), usá la herramienta "buscar_en_transcripciones" para leer las charlas completas antes de responder.`;

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

app.post('/api/ask-familia', rateLimit, async (req, res) => {
  try {
    let question = (req.body.question || '').trim();
    if (!question) return res.status(400).json({ error: 'Falta la pregunta.' });
    if (question.length > 1000) question = question.slice(0, 1000);

    const memoria = await loadMemorySummary();
    if (!memoria) {
      const rows = await sql`SELECT id FROM sessions LIMIT 1`;
      if (!rows.length) {
        return res.json({
          answer: 'Todavía no hay charlas guardadas. Cuando presione el botón y cuente algo, vas a poder preguntar sobre eso acá.',
        });
      }
    }

    const system = `${FAMILY_SYSTEM_PROMPT_BASE}\n\nResumen disponible:\n${memoria || '(todavía no hay resumen armado, usá la herramienta para leer las charlas directamente)'}`;

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
      const toolResultText = await buildFullTranscripts(toolUse.input && toolUse.input.palabra_clave);

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
    console.log(`Bitácora Viva corriendo en http://localhost:${PORT}`);
  });
}

module.exports = app;
