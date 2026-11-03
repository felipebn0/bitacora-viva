(() => {
  'use strict';
  const popup = document.getElementById('ecoPopup');
  if (!popup || typeof popup.showModal !== 'function') return;
  const video = document.getElementById('ecoPopupVideo');
  const cerrar = document.getElementById('ecoPopupCerrar');
  const botonSonido = document.getElementById('ecoPopupSonido');
  const CLAVE = 'ecoPopupVisto';

  function yaVisto() {
    try { return window.sessionStorage.getItem(CLAVE) === '1'; } catch (e) { return false; }
  }
  function marcarVisto() {
    try { window.sessionStorage.setItem(CLAVE, '1'); } catch (e) { /* sin almacenamiento: se muestra de nuevo */ }
  }

  // Quien llega con intención de registrarse (enlace con #...) no debe ver el popup.
  if (window.location.hash || yaVisto()) return;

  const reducirMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function actualizarBotonSonido() {
    botonSonido.textContent = video.muted ? 'Activar sonido' : 'Silenciar';
    botonSonido.setAttribute('aria-pressed', String(!video.muted));
  }

  function abrir() {
    if (popup.open) return;
    video.muted = true;
    video.src = video.dataset.src;
    actualizarBotonSonido();
    popup.showModal();
    if (!reducirMovimiento) {
      const intento = video.play();
      if (intento && typeof intento.catch === 'function') intento.catch(() => {});
    }
  }

  popup.addEventListener('close', () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
    marcarVisto();
  });

  cerrar.addEventListener('click', () => popup.close());
  // Un clic en el fondo oscuro (fuera de la caja) también cierra.
  popup.addEventListener('click', (ev) => { if (ev.target === popup) popup.close(); });
  botonSonido.addEventListener('click', () => {
    video.muted = !video.muted;
    actualizarBotonSonido();
    if (video.paused) { const p = video.play(); if (p && typeof p.catch === 'function') p.catch(() => {}); }
  });
  video.addEventListener('volumechange', actualizarBotonSonido);
  popup.querySelector('.eco-popup__pie .btn').addEventListener('click', marcarVisto);

  window.setTimeout(abrir, 1200);
})();
