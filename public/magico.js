/* Canje del enlace de entrada que llega por correo. El token viaja en el fragmento (#t=…), que el navegador no
   manda al servidor: se lee aquí, se borra de la barra y se canjea con un POST a /api/magic-login. */
(() => {
  'use strict';
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get('t') || '';
  const pedido = params.get('next') || '/app.html';
  const next = pedido.startsWith('/') && !pedido.startsWith('//') ? pedido : '/app.html';
  history.replaceState(null, '', location.pathname + location.search);
  const ir = (motivo) => location.replace('/app.html?magic=' + encodeURIComponent(motivo));
  if (!token) { ir('vencido'); return; }
  fetch('/api/magic-login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, next }),
  })
    .then((r) => r.json().catch(() => ({})).then((datos) => ({ ok: r.ok, datos })))
    .then(({ ok, datos }) => {
      if (ok && datos.redirect) location.replace(datos.redirect);
      else ir(datos.motivo || 'error');
    })
    .catch(() => ir('error'));
})();
