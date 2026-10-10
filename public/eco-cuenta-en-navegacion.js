/* ECO — Cuenta como cuarta opción. Mueve el elemento original: no duplica controles. */
(() => {
  'use strict';
  function iniciar() {
    const app = document.getElementById('appContent');
    const nav = app?.querySelector('nav.topbar');
    const header = app?.querySelector('.greeting-bar');
    const userMenu = header?.querySelector('.user-menu');
    if (!nav || !userMenu || nav.dataset.ecoCuatroOpciones === '1') return;
    userMenu.classList.add('eco-cuenta-en-nav');
    nav.appendChild(userMenu);
    nav.dataset.ecoCuatroOpciones = '1';
    header.classList.add('eco-header-sin-cuenta');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
