/* Recuerda de dónde llegó la persona (la etiqueta ?desde=... del enlace) para guardarla cuando cree su cuenta. Así se puede
   medir cuántas cuentas salen de cada estrategia, por ejemplo «colaboracion» = el botón al final de un aporte de invitado.
   Solo guarda una palabra corta; no identifica a nadie. */
(() => {
  'use strict';
  try {
    const desde = new URLSearchParams(location.search).get('desde');
    if (desde && /^[a-z0-9_-]{1,30}$/i.test(desde)) localStorage.setItem('eco_origen', desde.toLowerCase());
  } catch (e) { /* sin almacenamiento: no pasa nada */ }
  window.ecoOrigen = () => {
    try { return localStorage.getItem('eco_origen') || null; } catch (e) { return null; }
  };
})();
