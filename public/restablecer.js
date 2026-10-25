/* Restablecer la clave: correo o usuario y la clave nueva escrita dos veces. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const msg = $('msg');
  const aviso = (t, error) => { msg.textContent = t || ''; msg.classList.toggle('error', !!error); };

  $('verClave').addEventListener('click', () => {
    const ver = $('clave').type === 'password';
    $('clave').type = $('clave2').type = ver ? 'text' : 'password';
    $('verClave').textContent = ver ? 'Ocultar' : 'Mostrar';
    $('verClave').setAttribute('aria-pressed', ver ? 'true' : 'false');
  });

  $('formNueva').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const usuario = $('usuario').value.trim();
    const clave = $('clave').value;
    if (usuario.length < 3) { aviso('Escribe tu correo o usuario.', true); $('usuario').focus(); return; }
    if (clave.length < 6) { aviso('La clave debe tener al menos 6 caracteres.', true); $('clave').focus(); return; }
    if (clave !== $('clave2').value) { aviso('Las dos claves no coinciden.', true); $('clave2').focus(); return; }
    $('btnNueva').disabled = true;
    aviso('Guardando…');
    try {
      const resp = await fetch('/api/clave/restablecer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario, clave, claveConfirmar: $('clave2').value }) });
      const datos = await resp.json().catch(() => ({}));
      if (!resp.ok) { aviso(datos.error || 'No se pudo cambiar la clave.', true); return; }
      $('clave').value = $('clave2').value = '';
      aviso('');
      $('vistaNueva').hidden = true;
      $('vistaListo').hidden = false;
      $('volver').hidden = true;
    } catch (e) {
      aviso('Hubo un problema para conectar. Intenta de nuevo.', true);
    } finally {
      $('btnNueva').disabled = false;
    }
  });
})();
