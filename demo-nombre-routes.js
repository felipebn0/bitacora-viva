/* Demo pública de la portada: la persona dice su nombre y Eco la saluda con él. Recibe un audio corto, lo transcribe,
 * saca el nombre y devuelve el saludo hablado con la voz de Eco. No exige cuenta ni guarda nada: por eso tiene tres topes
 * (por IP en el minuto, por IP en la hora y uno global al día) para que nadie gaste el crédito de voz.
 */
const MAX_AUDIO_BYTES = 600 * 1024;
const POR_IP_HORA = 8;
const GLOBAL_DIA = 400;
const ESPERA_MS = 12000;

const SALUDOS = /^(hola|holi|buenas|buenos|buen|dias|días|tardes|noches|hey|eh|este|pues|bueno|mira|ah|mmm|um)$/i;
const PARA_NOMBRE = /(?:me llamo|mi nombre es|mi nombre|me dicen|me llaman|ll[aá]mame|yo soy|soy)\s+(.+)/i;
const CORTE = /^(me|mi|llamo|nombre|es|y|e|de|del|la|el|tengo|vivo|estoy|soy|pero|que|un|una|año|años|aquí|aqui|mucho|encantado|encantada)$/i;
const NO_NOMBRES = /^(no|si|sí|nada|gracias|ok|okay|listo|bueno|pues|nose|hola)$/i;
const PALABRA = /^[\p{L}][\p{L}'’-]{1,23}$/u;

function extraerNombre(texto) {
  const limpio = String(texto || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/[^\p{L}\s'’-]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!limpio) return null;
  const marcado = PARA_NOMBRE.exec(limpio);
  let palabras = (marcado ? marcado[1] : limpio).split(' ');
  while (palabras.length && SALUDOS.test(palabras[0])) palabras.shift();
  if (!marcado && palabras.length > 3) return null;
  const nombre = [];
  for (const p of palabras.slice(0, 2)) {
    if (CORTE.test(p) || !PALABRA.test(p)) break;
    if (nombre.length && !/^\p{Lu}/u.test(p)) break;
    nombre.push(p);
  }
  if (!nombre.length || (nombre.length === 1 && NO_NOMBRES.test(nombre[0]))) return null;
  return nombre.map((p) => p.charAt(0).toLocaleUpperCase('es') + p.slice(1).toLocaleLowerCase('es')).join(' ');
}

module.exports = (app, { rateLimit, limitePorClave, verificarArchivoReal, AUDIO_MIME_PERMITIDOS, speakWithElevenLabs, elevenKey, express }) => {
  async function transcribir(buffer, real) {
    const formData = new FormData();
    formData.append('model_id', 'scribe_v1');
    formData.append('language_code', 'spa');
    formData.append('file', new Blob([buffer], { type: real.mime }), `audio.${real.ext}`);
    const resp = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': elevenKey },
      body: formData,
      signal: AbortSignal.timeout(ESPERA_MS),
    });
    if (!resp.ok) throw new Error(`ElevenLabs STT ${resp.status}`);
    const data = await resp.json();
    return String(data.text || '').trim();
  }

  app.post('/api/demo-nombre', rateLimit, express.raw({ type: '*/*', limit: MAX_AUDIO_BYTES }), async (req, res) => {
    try {
      if (!elevenKey) return res.status(501).json({ error: 'La voz no está configurada.' });
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Falta audio.' });
      const real = await verificarArchivoReal(req.body, AUDIO_MIME_PERMITIDOS);
      if (!real) return res.status(400).json({ error: 'El archivo no parece ser un audio válido.' });

      const ip = await limitePorClave('demo-nombre:ip:' + (req.ip || 'desconocida'), 60 * 60 * 1000, POR_IP_HORA);
      const global = ip.permitido ? await limitePorClave('demo-nombre:global', 24 * 60 * 60 * 1000, GLOBAL_DIA) : ip;
      if (!global.permitido) {
        res.set('Retry-After', String(global.retryAfterSegundos));
        return res.status(429).json({ error: 'Demasiados intentos por ahora.' });
      }

      const nombre = extraerNombre(await transcribir(req.body, real));
      if (!nombre) return res.status(204).end();

      const voz = await speakWithElevenLabs(`Mucho gusto, ${nombre}. Qué bueno tenerte aquí.`);
      res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Nombre': encodeURIComponent(nombre) });
      res.send(voz);
    } catch (err) {
      console.error('Demo del nombre falló:', err.message);
      res.status(502).json({ error: 'No se pudo preparar el saludo.' });
    }
  });
};

module.exports.extraerNombre = extraerNombre;
