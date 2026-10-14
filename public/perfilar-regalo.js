/* Mensaje de regalo con la voz de quien administra el subperfil (se oye en la intro de la primera vez). */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const id = parseInt(new URLSearchParams(location.search).get('id'), 10);
  const caja = $('regaloBox');
  if (!id || !caja) return;
  const MAX_MS = 120000;
  const audio = $('regaloAudio'), estado = $('regaloEstado'), msg = $('regaloMsg');
  const grabar = $('regaloGrabar'), guardar = $('regaloGuardar'), quitar = $('regaloQuitar');
  let existe = false, stream = null, rec = null, trozos = [], inicio = 0, tope = null, pendiente = null, urlLocal = null;

  const fechaLarga = (iso) => { try { return new Date(iso).toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' }); } catch (e) { return ''; } };
  const aviso = (texto, error) => { msg.textContent = texto || ''; msg.classList.toggle('error', !!error); };

  function pintar(info) {
    existe = !!(info && info.existe);
    if (existe) {
      audio.src = info.url; audio.hidden = false;
      estado.textContent = 'Mensaje guardado' + (info.grabadoEn ? ' el ' + fechaLarga(info.grabadoEn) : '') + '. Puedes escucharlo aquí.';
    } else if (!pendiente) {
      audio.hidden = true; audio.removeAttribute('src');
      estado.textContent = 'Todavía no hay un mensaje.';
    }
    grabar.textContent = existe || pendiente ? 'Grabar de nuevo' : 'Grabar mensaje';
    quitar.hidden = !existe;
    guardar.hidden = !pendiente;
  }

  async function cargar() {
    try {
      const nombre = await fetch('/api/subprofiles/' + id + '/onboarding').then((r) => r.json()).catch(() => ({}));
      if (nombre && nombre.nombre) $('regaloNombre').textContent = nombre.nombre;
      const r = await fetch('/api/subprofiles/' + id + '/mensaje-regalo');
      if (!r.ok) return;
      pintar(await r.json());
      caja.hidden = false;
    } catch (e) { /* sin conexión: la tarjeta queda oculta */ }
  }

  function soltar() { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; clearTimeout(tope); }

  function terminar() {
    return new Promise((resolver) => {
      if (!rec || rec.state === 'inactive') { resolver(null); return; }
      const tipoMime = rec.mimeType || 'audio/webm';
      rec.onstop = () => { soltar(); resolver(new Blob(trozos, { type: tipoMime })); };
      rec.stop();
    });
  }

  async function alternarGrabacion() {
    if (rec && rec.state === 'recording') {
      const blob = await terminar();
      grabar.textContent = 'Grabar de nuevo';
      if (!blob || !blob.size || Date.now() - inicio < 1000) { aviso('No alcancé a oír nada. Intenta de nuevo.', true); return; }
      pendiente = blob;
      if (urlLocal) URL.revokeObjectURL(urlLocal);
      urlLocal = URL.createObjectURL(blob);
      audio.src = urlLocal; audio.hidden = false;
      estado.textContent = 'Escúchalo y, si te gusta, guárdalo.';
      guardar.hidden = false;
      aviso('');
      return;
    }
    if (!window.MediaRecorder || !navigator.mediaDevices) { aviso('Este navegador no puede grabar audio.', true); return; }
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { aviso('No se pudo usar el micrófono. Revisa el permiso en los ajustes del navegador.', true); return; }
    trozos = [];
    try { rec = new MediaRecorder(stream, { audioBitsPerSecond: 40000 }); } catch (e) { rec = new MediaRecorder(stream); }
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) trozos.push(e.data); };
    rec.start();
    inicio = Date.now();
    pendiente = null; guardar.hidden = true;
    grabar.textContent = 'Terminar de grabar';
    estado.textContent = 'Grabando… habla con calma (hasta 2 minutos).';
    aviso('');
    tope = setTimeout(() => { if (rec && rec.state === 'recording') alternarGrabacion(); }, MAX_MS);
  }

  grabar.addEventListener('click', alternarGrabacion);

  guardar.addEventListener('click', async () => {
    if (!pendiente) return;
    guardar.disabled = true; aviso('Guardando…');
    try {
      const r = await fetch('/api/subprofiles/' + id + '/mensaje-regalo', { method: 'POST', headers: { 'Content-Type': pendiente.type || 'audio/webm' }, body: pendiente });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { aviso(d.error || 'No se pudo guardar el mensaje.', true); guardar.disabled = false; return; }
      pendiente = null;
      if (urlLocal) { URL.revokeObjectURL(urlLocal); urlLocal = null; }
      pintar({ existe: true, url: d.url, grabadoEn: new Date().toISOString() });
      aviso('Listo. Lo va a oír cuando abra su chat por primera vez.');
    } catch (e) { aviso('No se pudo conectar. Intenta de nuevo.', true); }
    guardar.disabled = false;
  });

  quitar.addEventListener('click', async () => {
    if (!confirm('¿Quitar el mensaje de regalo?')) return;
    try {
      const r = await fetch('/api/subprofiles/' + id + '/mensaje-regalo', { method: 'DELETE' });
      if (!r.ok) { aviso('No se pudo quitar el mensaje.', true); return; }
      pendiente = null;
      pintar({ existe: false });
      aviso('Mensaje quitado.');
    } catch (e) { aviso('No se pudo conectar. Intenta de nuevo.', true); }
  });

  window.addEventListener('beforeunload', soltar);
  cargar();
})();
