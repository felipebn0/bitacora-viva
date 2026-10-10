/* ECO · Una misma etiqueta para volver a Inicio. Nunca sustituye enlaces. */
(() => {
  'use strict';
  function apply() {
    document.querySelectorAll('body > header a.volver[href^="/app.html"], #appContent #ownTopbar a.volver[href^="/app.html"]').forEach(link => {
      if (link.textContent.trim() !== '← Volver a mi bitácora') {
        link.textContent = '← Volver a mi bitácora';
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
})();
