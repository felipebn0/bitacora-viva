/* Cuando la persona abre Eco tocando el recordatorio diario (?av=...), lo avisa al servidor para medir qué mensajes funcionan. */
(() => {
  'use strict';
  let token = null;
  try { token = new URL(location.href).searchParams.get('av'); } catch (e) { return; }
  if (!token || !/^[a-f0-9]{24}$/.test(token)) return;
  fetch('/api/push/abierto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ token }) }).catch(() => {});
  try {
    const url = new URL(location.href);
    url.searchParams.delete('av');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch (e) { /* nada */ }
})();
