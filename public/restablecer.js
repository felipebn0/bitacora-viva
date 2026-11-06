/* Restablecer la clave: se pide el correo, llega un enlace de un solo uso y con ese enlace se escribe la clave nueva.
 * Si el servidor todavía no puede enviar correos, la página solo explica cómo pedir ayuda. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const msg = $('msg');
  const aviso = (t, error) => { msg.textContent = t || ''; msg.classList.toggle('error', !!error); };
  const vistas = ['vistaAyuda', 'vistaPedir', 'vistaEnviado', 'vistaNueva', 'vistaListo'];
  const mostrar = (id) => vistas.forEach((v) => { $(v).hidden = v !== id; });
  const token = new URLSearchParams(location.search).get('t') || '';
  const json = (resp) => resp.json().catch(() => ({}));

  $('verClave').addEventListener('click', () => {
    const ver = $('clave').type === 'password';
    $('clave').type = $('clave2').type = ver ? 'text' : 'password';
    $('verClave').textContent = ver ? 'Ocultar' : 'Mostrar';
    $('verClave').setAttribute('aria-pressed', ver ? 'true' : 'false');
  });

  $('formPedir').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const correo = $('correo').value.trim();
    if (correo.length < 3) { aviso('Escribe tu correo.', true); $('correo').focus(); return; }
    $('btnPedir').disabled = true;
    aviso('Enviando…');
    try {
      const resp = await fetch('/api/clave/olvide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo }) });
      const datos = await json(resp);
      if (!resp.ok) { aviso(datos.error || 'No se pudo enviar el enlace.', true); return; }
      aviso('');
      mostrar('vistaEnviado');
    } catch (e) {
      aviso('Hubo un problema para conectar. Intenta de nuevo.', true);
    } finally {
      $('btnPedir').disabled = false;
    }
  });

  $('formNueva').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const clave = $('clave').value;
    if (clave.length < 6) { aviso('La clave debe tener al menos 6 caracteres.', true); $('clave').focus(); return; }
    if (clave !== $('clave2').value) { aviso('Las dos claves no coinciden.', true); $('clave2').focus(); return; }
    $('btnNueva').disabled = true;
    aviso('Guardando…');
    try {
      const resp = await fetch('/api/clave/restablecer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, clave, claveConfirmar: $('clave2').value }) });
      const datos = await json(resp);
      if (!resp.ok) { aviso(datos.error || 'No se pudo cambiar la clave.', true); return; }
      $('clave').value = $('clave2').value = '';
      aviso('');
      mostrar('vistaListo');
      $('volver').hidden = true;
    } catch (e) {
      aviso('Hubo un problema para conectar. Intenta de nuevo.', true);
    } finally {
      $('btnNueva').disabled = false;
    }
  });

  (async () => {
    try {
      const estado = await json(await fetch('/api/clave/estado'));
      if (!estado.porCorreo) {
        if (estado.mensaje) $('ayudaTexto').textContent = estado.mensaje;
        mostrar('vistaAyuda');
        return;
      }
      if (!token) { mostrar('vistaPedir'); return; }
      const v = await json(await fetch('/api/clave/verificar?t=' + encodeURIComponent(token)));
      if (v.valido) { mostrar('vistaNueva'); return; }
      aviso('El enlace no sirve o ya venció. Pide uno nuevo.', true);
      mostrar('vistaPedir');
    } catch (e) {
      aviso('Hubo un problema para conectar. Intenta de nuevo.', true);
      mostrar('vistaAyuda');
    }
  })();
})();
