/* Demo pública de un minuto (/demo). La persona escribe su nombre y charla con Eco de verdad: Eco habla, la persona
 * contesta con su voz y, cuando hace una pausa, Eco responde. Al minuto Eco cierra contando qué es Eco y aparece el
 * botón para crear la cuenta. Rutas del servidor: demo-routes.js. Nada de esto se guarda.
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const pasoNombre = $('pasoNombre');
  const pasoCharla = $('pasoCharla');
  const form = $('formNombre');
  const inputNombre = $('nombre');
  const botonEmpezar = $('botonEmpezar');
  const errorNombre = $('errorNombre');
  const orbe = $('orbe');
  const etiqueta = $('orbeEtiqueta');
  const estado = $('estado');
  const saludo = $('saludo');
  const dicho = $('dicho');
  const ayuda = $('ayuda');
  const nivel = $('nivelMic');
  const barrasNivel = Array.prototype.slice.call(nivel.querySelectorAll('span'));
  const barraTiempo = $('barraTiempo');
  const popup = $('popup');
  const popupTitulo = $('popupTitulo');
  const popupTexto = $('popupTexto');
  const popupRegistro = $('popupRegistro');
  const popupCerrar = $('popupCerrar');
  const barraFinal = $('barraFinal');

  // window.ECO_DEMO_MS solo lo usa la prueba automática (test/demo.playwright.js) para no esperar el minuto entero.
  const DURACION_MS = window.ECO_DEMO_MS || 60 * 1000;
  const SILENCIO_MS = 2000; // pausa que da la respuesta por terminada (igual que la app)
  const SILENCIO_INICIAL_MS = 8000; // si no dice nada en este tiempo, se deja de escuchar
  const MAX_TURNO_MS = 30 * 1000;
  const MAX_EXTRA_MS = 20 * 1000; // si al acabarse el minuto la persona está hablando, se le deja terminar hasta esto
  const UMBRAL_VOZ = 0.035;
  // En los últimos 10 segundos Eco ya no hace preguntas nuevas: lo siguiente que dice es el cierre.
  const CIERRE_ANTES_MS = Math.min(10 * 1000, DURACION_MS / 4);

  const voz = new Audio();
  voz.preload = 'auto';
  let token = null;
  let historial = [];
  let inicio = 0;
  let relojTimer = null;
  let terminada = false;
  let stream = null;
  let ctx = null;
  let grabador = null;
  let trozos = [];
  let vadTimer = null;
  let alTocarOrbe = null;
  let intentosVacios = 0;
  let urlAudio = null;
  let pitch = null; // lo que Eco dice al final sobre la app: se pide apenas arranca, para no esperarlo al cerrar

  // ---------- utilidades ----------
  function ponerEstado(est, textoOrbe, textoEstado, aria) {
    orbe.dataset.state = est;
    etiqueta.textContent = textoOrbe || '';
    estado.textContent = textoEstado || '';
    orbe.setAttribute('aria-label', aria || textoOrbe || '');
  }
  const tiempoAcabado = () => inicio > 0 && Date.now() - inicio >= DURACION_MS;
  const quedaPoco = () => inicio > 0 && Date.now() - inicio >= DURACION_MS - CIERRE_ANTES_MS;

  function arrancarReloj() {
    if (inicio) return;
    inicio = Date.now();
    relojTimer = setInterval(() => {
      const avance = Math.min(1, (Date.now() - inicio) / DURACION_MS);
      barraTiempo.style.transform = 'scaleX(' + avance.toFixed(3) + ')';
      if (avance >= 1) clearInterval(relojTimer);
    }, 250);
  }

  // Un WAV de silencio (blob:, la política de seguridad no deja usar data:) para "desbloquear" el audio en el iPhone
  // dentro del toque de la persona: después Safari deja que ese mismo <audio> suene sin otro toque.
  function silencioWav() {
    const muestras = 800;
    const buf = new ArrayBuffer(44 + muestras * 2);
    const v = new DataView(buf);
    const txt = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    txt(0, 'RIFF'); v.setUint32(4, 36 + muestras * 2, true); txt(8, 'WAVE'); txt(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true);
    v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); txt(36, 'data'); v.setUint32(40, muestras * 2, true);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  function soltarMicrofono() {
    if (vadTimer) clearInterval(vadTimer);
    vadTimer = null;
    if (grabador && grabador.state !== 'inactive') { try { grabador.stop(); } catch (e) {} }
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    nivel.hidden = true;
  }

  async function postJson(url, cuerpo) {
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    let datos = {};
    try { datos = await resp.json(); } catch (e) {}
    return { ok: resp.ok, status: resp.status, datos };
  }

  // ---------- popup ----------
  function mostrarPopup(opciones) {
    const o = opciones || {};
    terminada = true;
    soltarMicrofono();
    if (relojTimer) clearInterval(relojTimer);
    if (o.titulo) popupTitulo.textContent = o.titulo;
    if (o.texto) popupTexto.textContent = o.texto;
    popup.hidden = false;
    barraFinal.hidden = true;
    setTimeout(() => popupRegistro.focus(), 60);
  }
  function cerrarPopup() {
    popup.hidden = true;
    barraFinal.hidden = false;
  }
  popupCerrar.addEventListener('click', cerrarPopup);
  popup.addEventListener('click', (e) => { if (e.target === popup) cerrarPopup(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !popup.hidden) cerrarPopup(); });

  // ---------- Eco habla ----------
  function hablar(texto, audioB64) {
    return new Promise((resolver) => {
      saludo.textContent = texto;
      ponerEstado('speaking', 'Eco habla', '', 'Eco está hablando');
      let hecho = false;
      // Red de seguridad: si el audio nunca avisa que terminó, la charla no se queda pegada.
      const seguro = setTimeout(() => terminar(), 45000);
      function terminar() {
        if (hecho) return;
        hecho = true;
        clearTimeout(seguro);
        resolver();
      }
      function conElNavegador() {
        if (hecho) return;
        voz.onended = null;
        voz.onerror = null;
        leerConElNavegador(texto).then(terminar);
      }
      if (audioB64) {
        try {
          const bytes = Uint8Array.from(atob(audioB64), (c) => c.charCodeAt(0));
          if (urlAudio) URL.revokeObjectURL(urlAudio);
          urlAudio = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
          voz.onended = terminar;
          voz.onerror = conElNavegador;
          voz.src = urlAudio;
          const p = voz.play();
          if (p && p.catch) p.catch(conElNavegador);
          return;
        } catch (e) { /* sigue con la voz del navegador */ }
      }
      conElNavegador();
    });
  }
  function leerConElNavegador(texto) {
    return new Promise((resolver) => {
      const calculo = Math.min(20000, 1500 + texto.length * 70);
      if (!('speechSynthesis' in window)) { setTimeout(resolver, calculo); return; }
      // Algunos navegadores nunca disparan onend: se sigue igual pasado el tiempo que tomaría leerlo.
      const t = setTimeout(resolver, calculo + 3000);
      const u = new SpeechSynthesisUtterance(texto);
      u.lang = 'es-CO';
      u.onend = () => { clearTimeout(t); resolver(); };
      u.onerror = () => { clearTimeout(t); resolver(); };
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    });
  }

  // ---------- turnos ----------
  async function pedirTurno(fin) {
    if (terminada) return;
    if (quedaPoco()) fin = true;
    ponerEstado('thinking', 'Pensando…', '', 'Eco está pensando');
    let r;
    try {
      r = await postJson('/api/demo/turno', { token, history: historial, fin: !!fin });
    } catch (e) {
      r = { ok: false, status: 0, datos: {} };
    }
    if (!r.ok) {
      if (r.status === 401 || r.status === 429) { mostrarPopup(); return; }
      ponerEstado('ended', 'Intentar de nuevo', 'Eco no pudo responder en este momento.', 'Intentar de nuevo');
      alTocarOrbe = () => pedirTurno(fin);
      return;
    }
    const { texto, audio } = r.datos;
    if (r.datos.ayuda) ayuda.hidden = false;
    historial.push({ role: 'assistant', content: texto });
    await hablar(texto, audio);
    if (terminada) return;
    if (fin) {
      const p = pitch ? await pitch : null;
      if (!terminada && p && p.ok && p.datos.texto) await hablar(p.datos.texto, p.datos.audio);
      if (terminada) return;
      ponerEstado('ended', 'Gracias', '', 'La prueba terminó');
      mostrarPopup();
      return;
    }
    if (tiempoAcabado()) { pedirTurno(true); return; }
    escuchar();
  }

  // ---------- la persona habla ----------
  async function asegurarMicrofono() {
    if (stream && stream.active) return true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      return true;
    } catch (e) {
      stream = null;
      return false;
    }
  }

  async function escuchar() {
    if (terminada) return;
    if (!(await asegurarMicrofono())) {
      ponerEstado('ended', 'Activar micrófono', 'Eco necesita el micrófono para escucharte. Revisa el permiso del navegador.', 'Activar el micrófono');
      alTocarOrbe = escuchar;
      return;
    }
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const fuente = ctx.createMediaStreamSource(stream);
    const analizador = ctx.createAnalyser();
    analizador.fftSize = 512;
    fuente.connect(analizador);
    const datos = new Uint8Array(analizador.frequencyBinCount);

    trozos = [];
    try {
      grabador = new MediaRecorder(stream, { audioBitsPerSecond: 40000 });
    } catch (e) {
      grabador = new MediaRecorder(stream);
    }
    grabador.ondataavailable = (e) => { if (e.data && e.data.size) trozos.push(e.data); };
    const empezo = Date.now();
    let ultimoSonido = Date.now();
    let huboVoz = false;
    let cerrado = false;

    const cerrar = (motivo) => {
      if (cerrado) return;
      cerrado = true;
      clearInterval(vadTimer);
      vadTimer = null;
      nivel.hidden = true;
      try { fuente.disconnect(); } catch (e) {}
      alTocarOrbe = null;
      grabador.onstop = () => terminarRespuesta(huboVoz && motivo !== 'nada', Date.now() - empezo);
      try { grabador.stop(); } catch (e) { terminarRespuesta(false, 0); }
    };

    grabador.start(250);
    // El minuto corre desde que Eco terminó su saludo y le toca a la persona, no mientras Eco prepara o dice el saludo.
    arrancarReloj();
    ponerEstado('listening', 'Te escucho', 'Cuando termines, haz una pausa o toca el botón.', 'Te escucho. Toca para terminar de hablar');
    nivel.hidden = false;
    alTocarOrbe = () => cerrar(huboVoz ? 'toque' : 'nada');

    vadTimer = setInterval(() => {
      analizador.getByteTimeDomainData(datos);
      let suma = 0;
      for (let i = 0; i < datos.length; i++) { const x = (datos[i] - 128) / 128; suma += x * x; }
      const rms = Math.sqrt(suma / datos.length);
      const n = Math.min(4, Math.floor(rms / 0.02));
      barrasNivel.forEach((b, i) => { b.className = n > 0 ? 'n' + Math.max(1, n - Math.abs(2 - i)) : ''; });
      const ahora = Date.now();
      if (rms > UMBRAL_VOZ) { ultimoSonido = ahora; huboVoz = true; }
      if (terminada) { cerrar('nada'); return; }
      if (!huboVoz) {
        if (tiempoAcabado() || ahora - empezo > SILENCIO_INICIAL_MS) cerrar('nada');
        return;
      }
      const pasado = inicio && ahora - inicio > DURACION_MS + MAX_EXTRA_MS;
      if (ahora - ultimoSonido > SILENCIO_MS || ahora - empezo > MAX_TURNO_MS || pasado) cerrar('fin');
    }, 100);
  }

  async function terminarRespuesta(conVoz, duracion) {
    if (terminada) return;
    const blob = new Blob(trozos, { type: (grabador && grabador.mimeType) || 'audio/webm' });
    if (!conVoz || duracion < 700 || blob.size < 1500) {
      if (tiempoAcabado()) { pedirTurno(true); return; }
      intentosVacios++;
      ponerEstado('ended', 'Tocar para hablar', 'No te escuché. Toca el botón cuando quieras contar.', 'Tocar para hablar');
      alTocarOrbe = escuchar;
      return;
    }
    ponerEstado('thinking', 'Escuchando…', '', 'Eco está escuchando lo que dijiste');
    let texto = '';
    try {
      const resp = await fetch('/api/demo/transcribir', { method: 'POST', headers: { 'Content-Type': blob.type, 'X-Demo-Token': token }, body: blob });
      if (resp.status === 401 || resp.status === 429) { mostrarPopup(); return; }
      if (resp.ok) texto = String(((await resp.json()) || {}).text || '').trim();
    } catch (e) {}
    if (!texto) {
      if (tiempoAcabado()) { pedirTurno(true); return; }
      intentosVacios++;
      if (intentosVacios >= 2) {
        ponerEstado('ended', 'Tocar para hablar', 'No te entendí bien. Toca el botón y cuéntamelo otra vez.', 'Tocar para hablar');
        alTocarOrbe = escuchar;
      } else {
        estado.textContent = 'No te entendí bien, ¿me lo repites?';
        setTimeout(escuchar, 900);
      }
      return;
    }
    intentosVacios = 0;
    dicho.textContent = '«' + (texto.length > 140 ? texto.slice(0, 137) + '…' : texto) + '»';
    historial.push({ role: 'user', content: texto });
    pedirTurno(tiempoAcabado());
  }

  orbe.addEventListener('click', () => {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (alTocarOrbe) { const f = alTocarOrbe; alTocarOrbe = null; f(); }
  });

  // ---------- inicio ----------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorNombre.textContent = '';
    const nombre = inputNombre.value.replace(/\s+/g, ' ').trim();
    if (!nombre) { errorNombre.textContent = 'Escribe tu nombre para empezar.'; inputNombre.focus(); return; }
    if (!window.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      errorNombre.textContent = 'Este navegador no deja usar el micrófono. Prueba con Chrome o Safari actualizados.';
      return;
    }
    botonEmpezar.disabled = true;
    botonEmpezar.textContent = 'Un momento…';
    // Todo esto dentro del toque: el navegador solo deja activar sonido y micrófono con un gesto de la persona.
    try { voz.src = silencioWav(); voz.play().catch(() => {}); } catch (err) {}
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); ctx.resume().catch(() => {}); } catch (err) {}
    const micOk = await asegurarMicrofono();
    if (!micOk) {
      botonEmpezar.disabled = false;
      botonEmpezar.textContent = 'Empezar la charla';
      errorNombre.textContent = 'Eco necesita el micrófono para escucharte. Permítelo en el navegador y vuelve a intentar.';
      return;
    }
    let r;
    try { r = await postJson('/api/demo/empezar', { nombre }); } catch (err) { r = { ok: false, status: 0, datos: {} }; }
    if (!r.ok) {
      botonEmpezar.disabled = false;
      botonEmpezar.textContent = 'Empezar la charla';
      if (r.status === 429) {
        mostrarPopup({
          titulo: r.datos.motivo === 'cupo' ? 'Hoy ya se acabaron las pruebas' : 'Ya hiciste tus pruebas de hoy',
          texto: 'Crea tu cuenta gratis y sigue charlando con Eco cuando quieras, sin límite de un minuto.',
        });
        return;
      }
      soltarMicrofono();
      errorNombre.textContent = 'Eco no está disponible en este momento. Intenta de nuevo en un rato.';
      return;
    }
    token = r.datos.token;
    pitch = postJson('/api/demo/pitch', { token }).catch(() => null);
    pasoNombre.hidden = true;
    pasoCharla.hidden = false;
    saludo.textContent = 'Hola, ' + nombre + '.';
    pedirTurno(false);
  });

  window.addEventListener('pagehide', soltarMicrofono);
})();
