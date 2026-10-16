/* Diario de un bebé: piezas que comparten la sesión (app.html) y la página del diario. */
(() => {
  'use strict';
  const MAX_BYTES = 4 * 1024 * 1024;
  const LADO_MAXIMO = 1600;

  async function comprimir(archivo) {
    if (archivo.size <= 1.5 * 1024 * 1024 && /^image\/(jpeg|png|webp)$/.test(archivo.type)) return archivo;
    try {
      const bmp = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
      const escala = Math.min(1, LADO_MAXIMO / Math.max(bmp.width, bmp.height));
      const lienzo = document.createElement('canvas');
      lienzo.width = Math.max(1, Math.round(bmp.width * escala));
      lienzo.height = Math.max(1, Math.round(bmp.height * escala));
      lienzo.getContext('2d').drawImage(bmp, 0, 0, lienzo.width, lienzo.height);
      const blob = await new Promise((ok) => lienzo.toBlob(ok, 'image/jpeg', 0.85));
      if (blob) return blob;
    } catch (e) { /* se intenta con el archivo original */ }
    if (archivo.size <= MAX_BYTES) return archivo;
    throw new Error('Esa foto pesa demasiado. Prueba con otra.');
  }

  async function subirFoto(archivo, texto) {
    if (!archivo || !/^image\//.test(archivo.type || '')) throw new Error('Elige una foto.');
    const listo = await comprimir(archivo);
    const r1 = await fetch('/api/bebe/foto', { method: 'POST', headers: { 'Content-Type': listo.type || 'image/jpeg' }, body: listo });
    const d1 = await r1.json().catch(() => ({}));
    if (!r1.ok) throw new Error(d1.error || 'No se pudo subir la foto.');
    return guardarEntrada({ texto, fotoUrl: d1.url });
  }

  async function guardarEntrada(cuerpo) {
    const r = await fetch('/api/bebe/entradas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se pudo guardar.');
    return d.entrada;
  }

  function edadTexto(nacioEn) {
    const dias = Math.floor((Date.now() - Date.parse(nacioEn + 'T12:00:00')) / 86400000);
    if (dias <= 0) return 'nació hoy';
    if (dias === 1) return '1 día';
    if (dias < 14) return dias + ' días';
    if (dias < 90) return Math.floor(dias / 7) + ' semanas';
    const meses = Math.floor(dias / 30.4);
    return meses === 1 ? '1 mes' : meses + ' meses';
  }

  function etiqueta(config) {
    if (!config) return '';
    if (config.estado === 'nacida') {
      const edad = edadTexto(config.nacioEn);
      return config.nombre + ', ya llegó' + (edad === 'nació hoy' ? ' hoy' : ' (' + edad + ')');
    }
    return config.nombre + ', en camino';
  }

  function fechaLarga(iso) {
    try { return new Date(iso).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return ''; }
  }

  async function subirAudio(blob) {
    const r = await fetch('/api/bebe/audio', { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se pudo guardar la nota de voz.');
    return d.url;
  }

  async function transcribir(blob, ms) {
    const r = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm', 'X-Audio-Duration-Ms': String(ms) }, body: blob });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No pude entender el audio.');
    return String(d.text || '').trim();
  }

  async function actualizarEntrada(id, cuerpo) {
    const r = await fetch('/api/bebe/entradas/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se pudo guardar.');
    return d.entrada;
  }

  // Botón redondo de ECO para contar la nota por voz. Al terminar de hablar, sube la grabación
  // original y su transcripción, y la deja guardada sola en el diario: en la entrada que diga
  // entrada() (por ejemplo la foto que se acaba de subir) o, si no hay ninguna, en una nueva.
  // La caja de texto queda escondida y solo aparece si este aparato no puede usar el micrófono
  // (ahí se guarda sola al salir de la caja).
  //   opciones.entrada()        -> la entrada a completar, o null
  //   opciones.alGuardar(e)     -> avisa la entrada creada o actualizada
  function botonVoz(texto, opciones) {
    const max = 600;
    const E = (tag, clase, contenido) => { const x = document.createElement(tag); if (clase) x.className = clase; if (contenido !== undefined) x.textContent = contenido; return x; };
    const caja = E('div', 'eco-bebe-voz');
    const boton = E('button', 'eco-bebe-orbe');
    boton.type = 'button';
    const dicho = E('p', 'eco-bebe-dicho');
    dicho.hidden = true;
    const borrar = E('button', 'eco-bebe-revoz', 'Borrar y volver a contar');
    borrar.type = 'button';
    borrar.hidden = true;
    const msg = E('p', 'eco-bebe-voz-msg');
    msg.setAttribute('role', 'status');
    msg.setAttribute('aria-live', 'polite');
    caja.append(boton, msg, dicho, borrar);
    texto.hidden = true;

    let estado = 'listo';
    let mic = null;
    let teclado = false;
    const pintar = () => {
      boton.classList.toggle('grabando', estado === 'grabando');
      boton.disabled = estado === 'procesando';
      boton.textContent = estado === 'grabando' ? 'Te escucho… toca para terminar'
        : estado === 'procesando' ? 'Guardando…'
        : texto.value.trim() ? 'Toca para contar más' : 'Toca y cuéntalo';
      const hay = !!texto.value.trim() && !teclado;
      dicho.hidden = borrar.hidden = !hay;
      dicho.textContent = hay ? '«' + texto.value.trim() + '»' : '';
    };
    const avisar = (t, error) => { msg.textContent = t || ''; msg.classList.toggle('error', !!error); };
    const usarTeclado = (t) => {
      teclado = true;
      avisar(t, true);
      texto.hidden = false;
      boton.hidden = true;
      pintar();
    };
    function soltarMic() {
      if (mic) { try { mic.stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* nada */ } }
      mic = null;
    }

    // Guarda en el diario: completa la entrada en curso o crea una nueva.
    async function guardar(cuerpo) {
      const actual = opciones.entrada();
      let entrada;
      if (actual) {
        entrada = await actualizarEntrada(actual.id, cuerpo);
      } else {
        entrada = await guardarEntrada({ texto: cuerpo.texto || '', audioUrl: cuerpo.agregarAudio || null });
      }
      opciones.alGuardar(entrada);
      return entrada;
    }

    boton.addEventListener('click', async () => {
      if (estado === 'procesando') return;
      if (estado === 'listo') {
        if (!window.MediaRecorder || !navigator.mediaDevices) { usarTeclado('Este navegador no puede grabar. Escribe la nota aquí abajo y se guarda sola.'); return; }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          let rec;
          try { rec = new MediaRecorder(stream, { audioBitsPerSecond: 40000 }); } catch (e) { rec = new MediaRecorder(stream); }
          const trozos = [];
          rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) trozos.push(e.data); };
          rec.start();
          mic = { stream, rec, trozos, inicio: Date.now() };
          estado = 'grabando';
          avisar('');
          pintar();
        } catch (err) {
          const n = (err && err.name) || '';
          if (n === 'NotAllowedError' || n === 'PermissionDeniedError' || n === 'SecurityError') avisar('El micrófono está bloqueado. Permítelo en el candado junto a la dirección de la página y vuelve a tocar.', true);
          else usarTeclado('No pude usar el micrófono. Escribe la nota aquí abajo y se guarda sola.');
        }
        return;
      }
      estado = 'procesando';
      pintar();
      const m = mic;
      const grabacion = await new Promise((ok) => {
        if (!m || m.rec.state === 'inactive') { ok(null); return; }
        const tipo = m.rec.mimeType || 'audio/webm';
        m.rec.onstop = () => ok({ blob: new Blob(m.trozos, { type: tipo }), ms: Date.now() - m.inicio });
        m.rec.stop();
      });
      soltarMic();
      if (!grabacion || !grabacion.blob.size || grabacion.ms < 500) {
        estado = 'listo'; pintar();
        avisar('No alcancé a oírte. Intenta otra vez, un poco más largo.', true);
        return;
      }
      try {
        // El audio original se guarda aunque la transcripción falle o salga vacía.
        const [audioUrl, nuevo] = await Promise.all([
          subirAudio(grabacion.blob),
          transcribir(grabacion.blob, grabacion.ms).catch(() => ''),
        ]);
        const completo = ((texto.value.trim() ? texto.value.trim() + ' ' : '') + nuevo).trim().slice(0, max);
        await guardar({ texto: completo, agregarAudio: audioUrl });
        texto.value = completo;
        avisar(nuevo ? 'Guardado en el diario.' : 'Guardé tu nota de voz, pero no alcancé a entender las palabras.', !nuevo);
      } catch (e) {
        avisar(e.message || 'No se pudo guardar. Revisa tu internet e intenta otra vez.', true);
      }
      estado = 'listo';
      pintar();
    });

    borrar.addEventListener('click', async () => {
      const actual = opciones.entrada();
      if (!actual) { texto.value = ''; pintar(); return; }
      borrar.disabled = true;
      try {
        await guardar({ texto: '', borrarAudios: true });
        texto.value = '';
        avisar('Listo, cuéntalo otra vez.');
      } catch (e) {
        avisar(e.message || 'No se pudo borrar. Intenta otra vez.', true);
      }
      borrar.disabled = false;
      pintar();
    });

    texto.addEventListener('change', async () => {
      if (!teclado) return;
      const valor = texto.value.trim().slice(0, max);
      if (!valor && !opciones.entrada()) return;
      try {
        await guardar({ texto: valor });
        avisar('Guardado en el diario.');
      } catch (e) {
        avisar(e.message || 'No se pudo guardar.', true);
      }
    });
    pintar();

    return {
      caja,
      ocupado: () => estado !== 'listo',
      reiniciar() {
        if (mic && mic.rec.state !== 'inactive') { try { mic.rec.stop(); } catch (e) { /* nada */ } }
        soltarMic();
        estado = 'listo';
        texto.value = '';
        avisar('');
        pintar();
      },
    };
  }

  // Si el bebé es niño, la misma paleta tenue pero en azul clarito (clase en <html>, ver eco-bebe.css).
  function aplicarColor(config) {
    document.documentElement.classList.toggle('eco-bebe-azul', !!config && config.genero === 'masculino');
  }

  window.EcoBebeComun = { subirFoto, guardarEntrada, etiqueta, edadTexto, fechaLarga, botonVoz, aplicarColor };
})();
