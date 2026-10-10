/* ECO Historias · Solo cambia la posicion del enlace Volver. Conserva IDs y eventos. */
(() => {
  'use strict';
  function init() {
    const header = document.querySelector('body > header');
    if (!header || header.dataset.ecoHistoriasOrdenado === '1') return;
    const heading = header.querySelector('div');
    const volver = header.querySelector('a.volver[href="/app.html"]');
    if (!heading || !volver) return;
    heading.classList.add('eco-story-heading');
    heading.insertBefore(volver, heading.firstChild);
    header.dataset.ecoHistoriasOrdenado = '1';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
