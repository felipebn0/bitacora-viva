(() => {
  'use strict';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const fotos = Array.prototype.slice.call(document.querySelectorAll('.portada-bloque__foto'));
  if (!fotos.length) return;
  let pendiente = false;
  function mover() {
    pendiente = false;
    const alto = window.innerHeight;
    fotos.forEach((foto) => {
      const r = foto.parentElement.getBoundingClientRect();
      if (r.bottom < 0 || r.top > alto) return;
      const p = (r.top + r.height / 2 - alto / 2) / (alto / 2 + r.height / 2);
      foto.style.transform = 'translate3d(0,' + (p * -6).toFixed(2) + '%,0)';
    });
  }
  function pedir() {
    if (pendiente) return;
    pendiente = true;
    window.requestAnimationFrame(mover);
  }
  window.addEventListener('scroll', pedir, { passive: true });
  window.addEventListener('resize', pedir);
  mover();
})();
