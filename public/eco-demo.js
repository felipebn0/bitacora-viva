(() => {
  'use strict';
  const seccion = document.getElementById('demo');
  const caja = document.getElementById('demoCaja');
  const orbe = document.getElementById('demoOrbe');
  if (!seccion || !caja || !orbe) return;
  const etiquetaOrbe = document.getElementById('demoOrbeEtiqueta');
  const botonFin = document.getElementById('demoFin');
  const textoEstado = document.getElementById('demoEstado');
  const nivel = document.getElementById('demoNivel');
  const barrasNivel = Array.prototype.slice.call(nivel.querySelectorAll('span'));
  const chat = document.getElementById('demoChat');
  const accion = document.getElementById('demoAccion');
  const barras = Array.prototype.slice.call(caja.querySelectorAll('.demo-eco__progreso li'));
  const botonSonido = document.getElementById('demoSonido');
  const reducir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const voz = new Audio();
  voz.preload = 'auto';
  let timers = [];
  let sonido = true;
  let mic = null;
  let permisoMic = null;
  let respuestaUrl = null;
  let finActual = null;
  let alTocarOrbe = null;
  let sesion = null;
  let epoca = 0;

  function esperar(ms, fn) { timers.push(window.setTimeout(fn, ms)); }
  function limpiar() {
    epoca += 1;
    timers.forEach((t) => { window.clearTimeout(t); window.clearInterval(t); });
    timers = [];
    voz.onended = null;
    voz.pause();
    finActual = null;
    alTocarOrbe = null;
    if (sesion) { sesion.cancelar(); sesion = null; }
  }

  function el(tag, clase, texto) {
    const e = document.createElement(tag);
    if (clase) e.className = clase;
    if (texto != null) e.textContent = texto;
    return e;
  }

  function progreso(n) { barras.forEach((b, i) => b.classList.toggle('is-on', i < n)); }

  function enfasis(on) {
    seccion.classList.toggle('is-enfasis', on);
    chat.classList.toggle('is-atenuado', on && chat.children.length > 0);
  }

  // Estados del orbe, los mismos de la app: idle, listening, speaking, thinking.
  function estado(siguiente, etiquetaHtml, texto) {
    orbe.dataset.state = siguiente;
    orbe.disabled = siguiente === 'speaking' || siguiente === 'thinking';
    etiquetaOrbe.innerHTML = etiquetaHtml;
    textoEstado.textContent = texto || '';
    const reposo = siguiente === 'idle';
    botonFin.style.display = reposo ? 'none' : 'inline';
    orbe.setAttribute('aria-label', reposo ? 'Presionar para comenzar la charla' : (siguiente === 'listening' ? 'Presionar para terminar tu respuesta' : 'Eco está hablando'));
    if (siguiente !== 'listening') nivel.hidden = true;
  }

  function escribir(nodo, texto, msTotal, listo) {
    if (reducir) { nodo.textContent = texto; if (listo) listo(); return 0; }
    const paso = Math.max(18, Math.min(60, msTotal / texto.length));
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      nodo.textContent = texto.slice(0, i);
      if (i >= texto.length) { window.clearInterval(id); if (listo) listo(); }
    }, paso);
    timers.push(id);
    return id;
  }

  function hablar(clave, texto, nodo, listo) {
    let terminado = false;
    let escritura = 0;
    estado('speaking', '···', 'Hablando…');
    const fin = () => {
      if (terminado) return;
      terminado = true;
      window.clearInterval(escritura);
      finActual = null;
      nodo.textContent = texto;
      if (listo) listo();
    };
    finActual = fin;
    const sinAudio = () => { window.clearInterval(escritura); escritura = escribir(nodo, texto, texto.length * 48, fin); };
    if (!sonido) { sinAudio(); return; }
    voz.onended = fin;
    voz.onerror = sinAudio;
    voz.src = '/audio-demo/' + clave + '.mp3';
    const intento = voz.play();
    if (intento && typeof intento.then === 'function') {
      intento.then(() => {
        const dur = (voz.duration && isFinite(voz.duration) ? voz.duration : texto.length * 0.055) * 1000;
        escritura = escribir(nodo, texto, dur * 0.85, null);
      }).catch(sinAudio);
    }
  }

  function burbujaEco(clave, texto, listo) {
    const b = el('div', 'demo-eco__burbuja demo-eco__burbuja--eco');
    chat.appendChild(b);
    hablar(clave, texto, b, listo);
  }

  function burbujaTuVoz() { chat.appendChild(el('div', 'demo-eco__burbuja demo-eco__burbuja--tu', 'Tu voz')); }

  function liberarMic() {
    permisoMic = null;
    if (!mic) return;
    try { mic.stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* ya detenido */ }
    if (mic.ctx && mic.ctx.state !== 'closed') { try { mic.ctx.close(); } catch (e) { /* ya cerrado */ } }
    mic = null;
  }

  function liberarRespuesta() {
    if (respuestaUrl) { URL.revokeObjectURL(respuestaUrl); respuestaUrl = null; }
  }

  // Pide el micrófono en cuanto la persona toca el orbe, igual que la app.
  function pedirMic() {
    permisoMic = (async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') return false;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        let ctx = null;
        let analizador = null;
        try {
          const Contexto = window.AudioContext || window.webkitAudioContext;
          ctx = new Contexto();
          analizador = ctx.createAnalyser();
          analizador.fftSize = 256;
          ctx.createMediaStreamSource(stream).connect(analizador);
        } catch (e) { analizador = null; }
        mic = { stream, ctx, analizador };
        return true;
      } catch (e) { return false; }
    })();
  }

  // Turno de la persona: el orbe pasa a "listening", se mide el nivel de voz y se
  // termina al tocarlo, al hacer una pausa después de hablar, o al agotarse el tiempo.
  async function escuchar(segundos, conservar, alTerminar) {
    if (!permisoMic) pedirMic();
    const mio = epoca;
    const hayMic = await permisoMic;
    if (mio !== epoca) return;
    const mia = {};
    sesion = mia;
    let fin = false;
    let grabador = null;
    const trozos = [];
    let marco = 0;
    let resta = segundos;

    const cerrar = (blob) => {
      if (fin) return;
      fin = true;
      window.cancelAnimationFrame(marco);
      if (sesion === mia) sesion = null;
      alTocarOrbe = null;
      estado('thinking', '···', 'Pensando…');
      esperar(900, () => alTerminar(blob));
    };
    mia.cancelar = () => {
      fin = true;
      window.cancelAnimationFrame(marco);
      if (grabador && grabador.state !== 'inactive') { grabador.onstop = null; try { grabador.stop(); } catch (e) { /* ya detenido */ } }
    };
    const detener = () => {
      if (grabador && grabador.state !== 'inactive') grabador.stop();
      else cerrar(null);
    };

    if (hayMic) {
      try {
        grabador = new MediaRecorder(mic.stream);
        grabador.ondataavailable = (ev) => { if (ev.data && ev.data.size) trozos.push(ev.data); };
        grabador.onstop = () => cerrar(conservar && trozos.length ? new Blob(trozos, { type: grabador.mimeType || 'audio/mp4' }) : null);
        grabador.start();
      } catch (e) { grabador = null; }
    }
    if (!grabador) {
      estado('idle', 'Presiona<br>para seguir', 'No pudimos usar tu micrófono. Toca el círculo para seguir.');
      alTocarOrbe = () => { alTocarOrbe = null; cerrar(null); };
      return;
    }

    estado('listening', 'Escuchando<br>…', 'Escuchando… toca el círculo cuando termines · ' + resta + ' s');
    nivel.hidden = false;
    alTocarOrbe = detener;
    const reloj = window.setInterval(() => {
      resta -= 1;
      textoEstado.textContent = 'Escuchando… toca el círculo cuando termines · ' + Math.max(resta, 0) + ' s';
      if (resta <= 0) { window.clearInterval(reloj); detener(); }
    }, 1000);
    timers.push(reloj);

    let habloMs = 0;
    let silencioMs = 0;
    let ultimo = performance.now();
    const medir = () => {
      const ahora = performance.now();
      const dt = ahora - ultimo;
      ultimo = ahora;
      if (mic && mic.analizador) {
        const datos = new Uint8Array(mic.analizador.fftSize);
        mic.analizador.getByteTimeDomainData(datos);
        let suma = 0;
        for (let i = 0; i < datos.length; i++) { const v = (datos[i] - 128) / 128; suma += v * v; }
        const rms = Math.sqrt(suma / datos.length);
        barrasNivel.forEach((barra, i) => {
          const h = Math.max(3, Math.round(rms * 4 * 60 * (1 - Math.abs(i - 2) * 0.18)));
          barra.style.height = Math.min(h, 18) + 'px';
        });
        if (rms > 0.05) { habloMs += dt; silencioMs = 0; } else if (habloMs > 400) { silencioMs += dt; }
        if (habloMs > 400 && silencioMs > 2000) { detener(); return; }
      }
      marco = window.requestAnimationFrame(medir);
    };
    medir();
  }

  function inicio() {
    limpiar();
    liberarMic();
    liberarRespuesta();
    chat.textContent = '';
    accion.textContent = '';
    enfasis(false);
    progreso(0);
    estado('idle', 'Presiona<br>para hablar', '');
    alTocarOrbe = bienvenida;
    accion.appendChild(el('p', 'demo-eco__nota', 'Dura cerca de un minuto. Eco habla y tú le contestas con tu voz. Tu micrófono se usa solo en tu dispositivo: nada se envía ni se guarda.'));
  }

  function bienvenida() {
    alTocarOrbe = null;
    accion.textContent = '';
    progreso(1);
    pedirMic();
    if (!reducir) caja.scrollIntoView({ block: 'center', behavior: 'smooth' });
    burbujaEco('bienvenida', 'Hola, soy Eco. Qué bueno que estés aquí.', () => esperar(500, pedirNombre));
  }

  function pedirNombre() {
    progreso(2);
    burbujaEco('nombre', 'Antes de empezar, cuéntame, ¿cómo te llamas?', () => {
      escuchar(8, false, () => { burbujaTuVoz(); esperar(300, saludo); });
    });
  }

  function saludo() {
    burbujaEco('gusto', 'Mucho gusto. Qué bueno tenerte aquí.', () => esperar(700, pregunta));
  }

  function pregunta() {
    progreso(3);
    enfasis(true);
    const bloque = el('div', 'demo-eco__pregunta');
    bloque.appendChild(el('small', null, 'Eco te pregunta'));
    const p = el('p');
    bloque.appendChild(p);
    chat.appendChild(bloque);
    hablar('pregunta', '¿Qué historia de tu familia no quisieras que se perdiera?', p, () => {
      escuchar(20, true, seguimiento);
    });
  }

  function seguimiento(blob) {
    progreso(4);
    enfasis(false);
    chat.textContent = '';
    if (blob) {
      liberarRespuesta();
      respuestaUrl = URL.createObjectURL(blob);
      burbujaTuVoz();
    }
    esperar(300, () => {
      burbujaEco('seguimiento', 'Gracias por contármelo. ¿Quién más estaba ahí? Cuéntame un detalle: cómo sonaba, o cómo olía, ese momento.', () => esperar(700, cierre));
    });
  }

  function cierre() {
    progreso(5);
    enfasis(false);
    liberarMic();
    accion.textContent = '';
    const tarjeta = el('div', 'demo-eco__guardado');
    tarjeta.appendChild(el('span', null, 'Recuerdo guardado (ejemplo)'));
    if (respuestaUrl) {
      tarjeta.appendChild(el('p', null, 'Así quedó tu voz:'));
      const reproductor = el('audio');
      reproductor.controls = true;
      reproductor.src = respuestaUrl;
      tarjeta.appendChild(reproductor);
    } else {
      tarjeta.appendChild(el('p', null, '“La casa de los abuelos, los domingos, el olor del café…”'));
    }
    accion.appendChild(tarjeta);
    const dicho = el('div', 'demo-eco__burbuja demo-eco__burbuja--eco');
    chat.appendChild(dicho);
    hablar('cierre', 'Así empieza un recuerdo. Con tu familia es igual: ellos cuentan, y yo pregunto.', dicho, () => {
      esperar(700, () => {
        const final = el('div', 'demo-eco__burbuja demo-eco__burbuja--final');
        chat.appendChild(final);
        hablar('cierre2', 'Imagina volver a escuchar su voz dentro de veinte años: cómo se reía, cómo contaba. Empieza hoy, mientras todavía puedes preguntarle. Por ahora, es gratis.', final, () => {
          estado('idle', 'Presiona<br>para otra charla', '');
          alTocarOrbe = () => inicio();
          accion.appendChild(el('p', 'demo-eco__nota', 'Tu grabación está solo en esta pantalla y desaparece al cerrar la página. No se guardó nada.'));
          const fila = el('div', 'demo-eco__fila');
          const crear = el('a', 'btn btn-primary', 'Guardar su primera historia');
          crear.href = '/index-portada.html#registro-form';
          fila.appendChild(crear);
          accion.appendChild(fila);
        });
      });
    });
  }

  orbe.addEventListener('click', () => { if (alTocarOrbe) alTocarOrbe(); });

  botonFin.addEventListener('click', () => {
    limpiar();
    chat.textContent = '';
    cierre();
  });

  if (botonSonido) {
    botonSonido.addEventListener('click', () => {
      sonido = !sonido;
      botonSonido.setAttribute('aria-pressed', String(sonido));
      botonSonido.textContent = sonido ? 'Sonido: activado' : 'Sonido: apagado';
      if (!sonido) { voz.pause(); if (finActual) finActual(); }
    });
  }

  window.addEventListener('pagehide', () => { limpiar(); liberarMic(); liberarRespuesta(); });

  inicio();
})();
