(() => {
  'use strict';
  const dec = document.getElementById('navFontDecBtn');
  const inc = document.getElementById('navFontIncBtn');
  const valor = document.getElementById('navFontSizeValue');
  if (dec && inc && valor && window.bitacoraFontSize) {
    const actualizar = () => {
      const v = window.bitacoraFontSize.get();
      valor.textContent = v + '%';
      dec.disabled = v <= window.bitacoraFontSize.min;
      inc.disabled = v >= window.bitacoraFontSize.max;
    };
    actualizar();
    dec.addEventListener('click', () => { window.bitacoraFontSize.decrease(); actualizar(); });
    inc.addEventListener('click', () => { window.bitacoraFontSize.increase(); actualizar(); });
  }

  const nav = document.querySelector('nav');
  if (nav) {
    if (window.ResizeObserver) {
      const medir = () => { document.documentElement.style.scrollPaddingTop = (nav.offsetHeight + 16) + 'px'; };
      new ResizeObserver(medir).observe(nav);
      medir();
    }
    let programado = false;
    const compactar = () => { programado = false; nav.classList.toggle('is-compact', window.scrollY > 30); };
    window.addEventListener('scroll', () => {
      if (programado) return;
      programado = true;
      requestAnimationFrame(compactar);
    }, { passive: true });
    compactar();
  }

  const play = document.getElementById('playDemo');
  const onda = document.getElementById('waveDemo');
  if (play && onda) {
    let sonando = false;
    play.addEventListener('click', () => {
      sonando = !sonando;
      play.textContent = sonando ? '❚❚' : '▶';
      onda.style.opacity = sonando ? '.95' : '.55';
      onda.style.transform = sonando ? 'scaleY(1.18)' : 'scaleY(1)';
      onda.style.transition = 'all .25s ease';
    });
  }

  const io = new IntersectionObserver((entradas) => {
    entradas.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('show'); io.unobserve(e.target); }
    });
  }, { threshold: .12 });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
})();
