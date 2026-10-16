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

  // Botón redondo de ECO para contar la nota de voz en vez de escribirla: graba, transcribe con
  // /api/transcribe y va dejando lo que se entendió en el textarea (que queda escondido y solo se
  // muestra si este aparato no puede usar el micrófono).
  function botonVoz(texto, max) {
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
    const pintar = () => {
      boton.classList.toggle('grabando', estado === 'grabando');
      boton.disabled = estado === 'procesando';
      boton.textContent = estado === 'grabando' ? 'Te escucho… toca para terminar'
        : estado === 'procesando' ? 'Un momento…'
        : texto.value.trim() ? 'Toca para contar más' : 'Toca y cuéntalo';
      const hay = !!texto.value.trim();
      dicho.hidden = borrar.hidden = !hay;
      dicho.textContent = hay ? '«' + texto.value.trim() + '»' : '';
    };
    const avisar = (t, error) => { msg.textContent = t || ''; msg.classList.toggle('error', !!error); };
    const usarTeclado = (t) => {
      avisar(t, true);
      texto.hidden = false;
      boton.hidden = true;
      dicho.hidden = borrar.hidden = true;
    };
    function soltarMic() {
      if (mic) { try { mic.stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* nada */ } }
      mic = null;
    }

    boton.addEventListener('click', async () => {
      if (estado === 'procesando') return;
      if (estado === 'listo') {
        if (!window.MediaRecorder || !navigator.mediaDevices) { usarTeclado('Este navegador no puede grabar. Escribe la nota aquí abajo.'); return; }
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
          else usarTeclado('No pude usar el micrófono. Escribe la nota aquí abajo.');
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
        const r = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': grabacion.blob.type || 'audio/webm', 'X-Audio-Duration-Ms': String(grabacion.ms) }, body: grabacion.blob });
        const d = await r.json().catch(() => ({}));
        const nuevo = String(d.text || '').trim();
        if (r.ok && nuevo) {
          texto.value = (texto.value.trim() ? texto.value.trim() + ' ' : '') + nuevo;
          texto.value = texto.value.slice(0, max || 600);
          avisar('');
        } else if (r.ok) {
          avisar('No entendí nada. Acércate un poco al micrófono e intenta otra vez.', true);
        } else {
          avisar(d.error || 'No pude entender el audio. Intenta otra vez.', true);
        }
      } catch (e) {
        avisar('No hay conexión. Revisa tu internet e intenta otra vez.', true);
      }
      estado = 'listo';
      pintar();
    });
    borrar.addEventListener('click', () => { texto.value = ''; avisar(''); pintar(); });
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

  window.EcoBebeComun = { subirFoto, guardarEntrada, etiqueta, edadTexto, fechaLarga, botonVoz };
})();
