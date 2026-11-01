/* Carrusel curvo de personas mayores contándole sus recuerdos a Eco: se desplaza solo de derecha a izquierda y se puede arrastrar con el dedo o el mouse. */
(() => {
  'use strict';
  const banda = document.getElementById('ecoVoces');
  if (!banda) return;
  const FOTOS = ['/images/voces/voz-1.jpg', '/images/voces/voz-2.jpg', '/images/voces/voz-3.jpg', '/images/voces/voz-4.jpg'];
  const ORDEN = [0, 1, 2, 3, 1, 2, 3, 0, 2, 3];
  const ALT = [
    'Una abuela de pelo plateado cuenta un recuerdo en voz alta desde su sala',
    'Un abuelo con sombrero de paja habla con su celular en el jardín',
    'Una mujer mayor se ríe mientras le cuenta una historia a su celular en la cocina',
    'Un abuelo con gafas habla a su celular sentado en una mecedora',
  ];
  const N = 10, PASO = 196, L = N * PASO, RADIO = 15;
  const reducir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const movil = window.matchMedia('(max-width: 820px)');
  const MICRO = '<svg viewBox="0 0 24 24" fill="none" stroke="#FFFDF6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

  const tarjetas = [];
  for (let i = 0; i < N; i++) {
    const el = document.createElement('div');
    el.className = 'eco-voces__tarjeta';
    const im = document.createElement('img');
    const f = ORDEN[i];
    im.src = FOTOS[f];
    im.alt = ALT[f];
    im.loading = i < 7 ? 'eager' : 'lazy';
    im.decoding = 'async';
    im.draggable = false;
    im.style.animationDelay = (-i * 2.3) + 's';
    if (i > 3) im.style.objectPosition = (35 + (i * 13) % 40) + '% ' + (30 + (i * 7) % 30) + '%';
    const micro = document.createElement('div');
    micro.className = 'eco-voces__micro';
    micro.setAttribute('aria-hidden', 'true');
    micro.innerHTML = MICRO;
    el.append(im, micro);
    banda.appendChild(el);
    tarjetas.push({ el, micro });
  }

  let u = 1, cy0 = 230, mitad = 706, scroll = 0, vel = 0;

  function medir() {
    const ancho = banda.clientWidth;
    if (movil.matches) { u = ancho / 640; mitad = 306; cy0 = 125 / u + 8; }
    else { u = Math.min(1, ancho / 1440); mitad = 706; banda.style.height = Math.round(470 * u) + 'px'; cy0 = 235; }
    if (movil.matches) banda.style.height = '';
  }

  function redondeado(p, r) {
    let d = '';
    const n = p.length;
    for (let k = 0; k < n; k++) {
      const a = p[(k + n - 1) % n], b = p[k], c = p[(k + 1) % n];
      const ab = Math.hypot(a[0] - b[0], a[1] - b[1]), cb = Math.hypot(c[0] - b[0], c[1] - b[1]);
      const ra = Math.min(r, ab / 2), rc = Math.min(r, cb / 2);
      const s = [b[0] + (a[0] - b[0]) / ab * ra, b[1] + (a[1] - b[1]) / ab * ra];
      const e = [b[0] + (c[0] - b[0]) / cb * rc, b[1] + (c[1] - b[1]) / cb * rc];
      d += (k ? 'L' : 'M') + s[0].toFixed(1) + ' ' + s[1].toFixed(1) + 'Q' + b[0].toFixed(1) + ' ' + b[1].toFixed(1) + ' ' + e[0].toFixed(1) + ' ' + e[1].toFixed(1);
    }
    return d + 'Z';
  }

  function pintar() {
    const centroX = banda.clientWidth / 2;
    for (let i = 0; i < N; i++) {
      const t = (((i * PASO - scroll) % L) + L + L / 2) % L - L / 2;
      const x = t * (1 + 0.083 * Math.pow(t / 706, 2));
      const d = Math.min(Math.abs(x) / mitad, 1.9);
      const w = 170 + 48 * d * d;
      const xl = x - w / 2, xr = x + w / 2;
      const ql = Math.min(Math.abs(xl) / mitad, 2.1), qr = Math.min(Math.abs(xr) / mitad, 2.1);
      const hl = 280 + 92 * Math.pow(ql, 2.6), hr = 280 + 92 * Math.pow(qr, 2.6);
      const cy = cy0 - 12 * d * d;
      const H = Math.max(hl, hr);
      const px = centroX + xl * u, py = (cy - H / 2) * u, wp = w * u, hp = H * u;
      const yl = (H - hl) / 2, yr = (H - hr) / 2;
      const pts = [[0, yl * u], [wp, yr * u], [wp, (yr + hr) * u], [0, (yl + hl) * u]];
      const tj = tarjetas[i];
      tj.el.style.width = wp + 'px';
      tj.el.style.height = hp + 'px';
      tj.el.style.transform = 'translate(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px)';
      tj.el.style.clipPath = 'path("' + redondeado(pts, RADIO * u) + '")';
      tj.micro.style.transform = 'translate(' + (14 * u).toFixed(1) + 'px,' + ((yl + hl) * u - 14 * u - tj.micro.offsetHeight).toFixed(1) + 'px)';
    }
  }

  let arrastrando = false, ultimoX = 0, ultimoT = 0, velArrastre = 0, previo = performance.now(), visible = true, corriendo = false;
  banda.addEventListener('pointerdown', (e) => {
    arrastrando = true; ultimoX = e.clientX; ultimoT = performance.now(); velArrastre = 0; vel = 0;
    banda.classList.add('arrastrando');
    try { banda.setPointerCapture(e.pointerId); } catch (err) { /* nada */ }
  });
  banda.addEventListener('pointermove', (e) => {
    if (!arrastrando) return;
    const ahora = performance.now(), dx = (e.clientX - ultimoX) / u, dt = Math.max(1, ahora - ultimoT) / 1000;
    scroll -= dx;
    velArrastre = 0.6 * velArrastre + 0.4 * (-dx / dt);
    ultimoX = e.clientX; ultimoT = ahora;
  });
  function soltar() {
    if (!arrastrando) return;
    arrastrando = false; banda.classList.remove('arrastrando');
    vel = Math.abs(performance.now() - ultimoT) > 120 ? 0 : velArrastre;
  }
  banda.addEventListener('pointerup', soltar);
  banda.addEventListener('pointercancel', soltar);
  banda.addEventListener('lostpointercapture', soltar);

  function cuadro(ahora) {
    const dt = Math.min(0.05, (ahora - previo) / 1000);
    previo = ahora;
    if (!arrastrando) { scroll += ((reducir ? 0 : 50) + vel) * dt; vel *= Math.pow(0.05, dt); }
    pintar();
    if (visible) requestAnimationFrame(cuadro); else corriendo = false;
  }
  function arrancar() { if (corriendo) return; corriendo = true; previo = performance.now(); requestAnimationFrame(cuadro); }

  medir();
  pintar();
  window.addEventListener('resize', () => { medir(); pintar(); });
  if (movil.addEventListener) movil.addEventListener('change', () => { medir(); pintar(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) arrancar(); }).observe(banda);
  }
  arrancar();
})();
