/* ECO: saludo horario en la pantalla principal. No modifica el nombre ni la voz. */
(() => {
  'use strict';
  function actualizarSaludo() {
    const titulo = document.querySelector('#appContent .greeting-text');
    if (!titulo) return;
    const hora = new Date().getHours(); // Hora local del dispositivo
    const saludo = hora < 12 ? 'Buenos días' : hora < 18 ? 'Buenas tardes' : 'Buenas noches';
    const nodo = Array.from(titulo.childNodes).find(
      n => n.nodeType === Node.TEXT_NODE && /Hola|Buenos días|Buenas tardes|Buenas noches/.test(n.textContent)
    );
    if (nodo) nodo.textContent = saludo + ', ';
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', actualizarSaludo);
  } else {
    actualizarSaludo();
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) actualizarSaludo();
  });
  setInterval(actualizarSaludo, 60_000);
})();
