/* Intro de la primera vez: (1) mensaje de regalo con la voz de quien lo dejó, si hay uno,
   (2) qué es Eco en una frase, (3) dos pruebas de micrófono ("di tu nombre", "di hola Eco")
   y (4) empezar. Se puede saltar y se repite desde Cuenta > Opciones avanzadas. */
(() => {
  'use strict';
  const html = document.documentElement;
  html.dataset.ecoIntro = 'consultando'; // eco-tour.js espera a que esto termine

  const E = (tag, clase, texto) => { const x = document.createElement(tag); if (clase) x.className = clase; if (texto !== undefined) x.textContent = texto; return x; };
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  let capa = null, audio = null, flujo = null, mic = null, indice = 0, pasos = [], datos = null;

  function liberar() {
    if (audio) { try { audio.pause(); } catch (e) { /* nada */ } audio = null; }
    if (mic && mic.stream) { mic.stream.getTracks().forEach((t) => t.stop()); }
    mic = null;
  }

  function cerrar(marcar) {
    liberar();
    if (capa) { capa.remove(); capa = null; }
    document.body.style.overflow = '';
    html.dataset.ecoIntro = 'nada';
    if (marcar) fetch('/api/intro/visto', { method: 'POST' }).catch(() => {});
  }

  // --- Pruebas de micrófono -------------------------------------------------
  function errorDeMicrofono(err) {
    const n = (err && err.name) || '';
    if (n === 'NotAllowedError' || n === 'PermissionDeniedError' || n === 'SecurityError') return 'El micrófono está bloqueado. Toca el candado junto a la dirección de la página, permite el micrófono y vuelve a intentarlo.';
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return 'No encontré un micrófono en este aparato.';
    if (n === 'NotReadableError' || n === 'TrackStartError') return 'Otra aplicación está usando el micrófono. Ciérrala e intenta de nuevo.';
    return 'No pude usar el micrófono.';
  }

  async function empezarGrabacion() {
    if (!window.MediaRecorder || !navigator.mediaDevices) throw Object.assign(new Error('sin soporte'), { name: 'SinSoporte' });
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    let rec;
    try { rec = new MediaRecorder(stream, { audioBitsPerSecond: 40000 }); } catch (e) { rec = new MediaRecorder(stream); }
    const trozos = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) trozos.push(e.data); };
    rec.start();
    mic = { stream, rec, trozos, inicio: Date.now() };
  }

  function terminarGrabacion() {
    return new Promise((resolver) => {
      const m = mic;
      if (!m || m.rec.state === 'inactive') { resolver(null); return; }
      const tipo = m.rec.mimeType || 'audio/webm';
      m.rec.onstop = () => { m.stream.getTracks().forEach((t) => t.stop()); resolver({ blob: new Blob(m.trozos, { type: tipo }), ms: Date.now() - m.inicio }); };
      m.rec.stop();
    });
  }

  // Un paso de prueba: botón redondo que graba, transcribe y muestra lo que se entendió.
  function pasoDePrueba({ titulo, texto, valida }) {
    return (cuerpo, api) => {
      cuerpo.append(E('h2', 'ei-titulo', titulo), E('p', 'ei-texto', texto));
      const boton = E('button', 'ei-orbe');
      boton.type = 'button';
      const resultado = E('p', 'ei-resultado');
      resultado.setAttribute('role', 'status');
      resultado.setAttribute('aria-live', 'polite');
      const nota = E('p', 'ei-nota', 'Presiona el botón, habla con calma y vuelve a presionarlo cuando termines.');
      let estado = 'listo';
      const pintar = () => {
        boton.classList.toggle('ei-orbe-grabando', estado === 'grabando');
        boton.disabled = estado === 'procesando';
        boton.textContent = estado === 'grabando' ? 'Te escucho… toca para terminar' : estado === 'procesando' ? 'Un momento…' : 'Presiona para hablar';
      };
      pintar();
      boton.addEventListener('click', async () => {
        resultado.className = 'ei-resultado';
        if (estado === 'procesando') return;
        if (estado === 'listo') {
          try {
            await empezarGrabacion();
            estado = 'grabando'; resultado.textContent = ''; pintar();
          } catch (err) {
            resultado.className = 'ei-resultado ei-error';
            resultado.textContent = err.name === 'SinSoporte' ? 'Este navegador no puede grabar. Puedes seguir y contarle a Eco escribiendo.' : errorDeMicrofono(err);
            api.permitirSeguir();
          }
          return;
        }
        estado = 'procesando'; pintar();
        const grabacion = await terminarGrabacion();
        if (!grabacion || !grabacion.blob.size || grabacion.ms < 500) {
          estado = 'listo'; pintar();
          resultado.className = 'ei-resultado ei-error';
          resultado.textContent = 'No alcancé a oírte. Intenta otra vez, un poco más largo.';
          return;
        }
        try {
          const resp = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': grabacion.blob.type || 'audio/webm', 'X-Audio-Duration-Ms': String(grabacion.ms) }, body: grabacion.blob });
          const d = await resp.json().catch(() => ({}));
          estado = 'listo'; pintar();
          const dicho = String(d.text || '').trim();
          if (resp.ok && dicho) {
            const bien = valida ? valida(dicho) : true;
            resultado.textContent = bien ? `Escuché: «${dicho}». ¡Muy bien!` : `Escuché: «${dicho}». Casi: intenta decir exactamente eso, o sigue si prefieres.`;
            api.permitirSeguir();
          } else if (resp.ok) {
            resultado.className = 'ei-resultado ei-error';
            resultado.textContent = 'No entendí nada. Acércate un poco al micrófono e intenta otra vez.';
          } else {
            resultado.className = 'ei-resultado ei-error';
            resultado.textContent = d.error || 'No pude transcribir tu voz. Intenta otra vez.';
          }
        } catch (err) {
          estado = 'listo'; pintar();
          resultado.className = 'ei-resultado ei-error';
          resultado.textContent = 'No hay conexión. Revisa tu internet e intenta otra vez.';
        }
      });
      cuerpo.append(boton, resultado, nota);
      api.bloquearSeguir('Seguir sin probar');
    };
  }

  // --- Pasos ------------------------------------------------------------------
  function armarPasos() {
    const lista = [];
    if (datos && datos.mensaje) {
      lista.push((cuerpo) => {
        const de = datos.mensaje.de || 'Alguien de tu familia';
        cuerpo.append(E('h2', 'ei-titulo', 'Un regalo para ti'), E('p', 'ei-texto', `${de} te dejó un mensaje con su voz.`));
        const boton = E('button', 'ei-boton', '▶ Escuchar el mensaje');
        boton.type = 'button';
        const nota = E('p', 'ei-nota', 'Sube el volumen de tu aparato para oírlo bien.');
        boton.addEventListener('click', () => {
          if (audio && !audio.paused) { audio.pause(); boton.textContent = '▶ Seguir escuchando'; return; }
          if (!audio) {
            audio = new Audio(datos.mensaje.url);
            audio.addEventListener('ended', () => { boton.textContent = '↻ Volver a escuchar'; });
            audio.addEventListener('error', () => { nota.textContent = 'No pude reproducir el mensaje. Puedes seguir con el tutorial.'; });
          }
          audio.play().then(() => { boton.textContent = '⏸ Pausar'; }).catch(() => { nota.textContent = 'No pude reproducir el mensaje. Puedes seguir con el tutorial.'; });
        });
        cuerpo.append(boton, nota);
      });
    }
    lista.push((cuerpo) => {
      cuerpo.append(E('h2', 'ei-titulo', 'Esto es Eco'), E('p', 'ei-texto', 'Es un chat de voz. Eco te hace preguntas, tú le contestas hablando y Eco te escucha. No tienes que escribir nada.'));
      const orbes = E('div', 'ei-orbes');
      const a = E('div', 'ei-orbe-caja'); a.append(E('div', 'ei-orbe', 'Presiona para hablar'), E('p', '', 'Tu turno: el botón es verde. Habla con calma.'));
      const b = E('div', 'ei-orbe-caja'); b.append(E('div', 'ei-orbe ei-orbe-negro', 'Eco habla'), E('p', '', 'Turno de Eco: el botón se pone negro. Escucha su pregunta.'));
      orbes.append(a, b);
      cuerpo.append(orbes);
    });
    lista.push(pasoDePrueba({ titulo: 'Probemos tu micrófono', texto: 'Presiona el botón y di tu nombre.' }));
    lista.push(pasoDePrueba({ titulo: 'Una más', texto: 'Ahora presiona el botón y di: «Hola Eco».', valida: (t) => /\bhola\b/.test(norm(t)) }));
    lista.push((cuerpo) => {
      cuerpo.append(E('h2', 'ei-titulo', 'Todo listo'), E('p', 'ei-texto', 'Cuando quieras, presiona el botón grande y cuéntale una historia a Eco.'), E('p', 'ei-nota', 'Si quieres ver este tutorial otra vez, está en Cuenta, Opciones avanzadas.'));
    });
    return lista;
  }

  function pintarPaso() {
    liberar();
    const tarjeta = capa.querySelector('.ei-card');
    tarjeta.replaceChildren();
    tarjeta.append(E('p', 'ei-progreso', `Paso ${indice + 1} de ${pasos.length}`));
    const cuerpo = E('div', 'ei-cuerpo');
    const acciones = E('div', 'ei-acciones');
    const ultimo = indice === pasos.length - 1;
    const siguiente = E('button', 'ei-boton', ultimo ? 'Empezar a charlar' : 'Continuar');
    siguiente.type = 'button';
    let etiquetaSaltarPrueba = null;
    const api = {
      bloquearSeguir(etiqueta) { siguiente.disabled = true; etiquetaSaltarPrueba = etiqueta; },
      permitirSeguir() { siguiente.disabled = false; if (saltarPrueba) saltarPrueba.hidden = true; },
    };
    let saltarPrueba = null;
    pasos[indice](cuerpo, api);
    if (etiquetaSaltarPrueba) {
      saltarPrueba = E('button', 'ei-boton-suave', etiquetaSaltarPrueba);
      saltarPrueba.type = 'button';
      saltarPrueba.addEventListener('click', () => { indice++; pintarPaso(); });
    }
    siguiente.addEventListener('click', () => {
      if (ultimo) { cerrar(true); return; }
      indice++; pintarPaso();
    });
    acciones.append(siguiente);
    if (saltarPrueba) acciones.append(saltarPrueba);
    if (indice > 0) {
      const atras = E('button', 'ei-enlace', 'Atrás');
      atras.type = 'button';
      atras.addEventListener('click', () => { indice--; pintarPaso(); });
      acciones.append(atras);
    }
    if (!ultimo) {
      const saltar = E('button', 'ei-enlace', 'Saltar el tutorial');
      saltar.type = 'button';
      saltar.addEventListener('click', () => cerrar(true));
      acciones.append(saltar);
    }
    tarjeta.append(cuerpo, acciones);
    const primero = tarjeta.querySelector('button');
    if (primero) primero.focus({ preventScroll: true });
  }

  function abrirIntro(d) {
    if (capa) return;
    datos = d;
    pasos = armarPasos();
    indice = 0;
    html.dataset.ecoIntro = 'abierto';
    if (!document.querySelector('link[href^="/eco-intro.css"]')) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/eco-intro.css?v=2'; document.head.appendChild(l);
    }
    capa = E('div');
    capa.id = 'ecoIntro';
    capa.setAttribute('role', 'dialog');
    capa.setAttribute('aria-modal', 'true');
    capa.setAttribute('aria-label', 'Bienvenida a Eco');
    capa.append(E('div', 'ei-card'));
    document.body.append(capa);
    document.body.style.overflow = 'hidden';
    capa.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrar(true); });
    pintarPaso();
  }

  // Espera a que se vea la app (no la pantalla de entrada) antes de abrir.
  function cuandoSeVeLaApp(accion) {
    const contenido = document.getElementById('appContent');
    let intentos = 0;
    const t = setInterval(() => {
      intentos++;
      const visible = !contenido || (!contenido.hasAttribute('hidden') && contenido.style.display !== 'none' && contenido.offsetParent !== null);
      if (visible) { clearInterval(t); setTimeout(accion, 400); }
      else if (intentos > 60) { clearInterval(t); html.dataset.ecoIntro = 'nada'; }
    }, 350);
  }

  async function consultar(repetir) {
    const resp = await fetch('/api/intro' + (repetir ? '?repetir=1' : ''));
    if (!resp.ok) return null;
    return resp.json();
  }

  window.EcoIntro = {
    async repetir() {
      try {
        const d = await consultar(true);
        if (d && d.aplica) abrirIntro(d);
      } catch (e) { /* sin conexión: no pasa nada */ }
    },
  };

  function iniciar() {
    const boton = document.getElementById('umTutorialBtn');
    if (boton) boton.addEventListener('click', () => window.EcoIntro.repetir());
    consultar(false).then((d) => {
      if (!d || !d.aplica || !d.pendiente) { html.dataset.ecoIntro = 'nada'; return; }
      cuandoSeVeLaApp(() => abrirIntro(d));
    }).catch(() => { html.dataset.ecoIntro = 'nada'; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
