/* ECO · Tour de bienvenida.
   Muestra un tour paso a paso la primera vez que un usuario visita cada página.
   Usa spotlight (4 paneles oscuros) + tooltip flotante.
   Guarda el estado en localStorage para no repetirlo. */
(() => {
  'use strict';

  /* ─── Pasos por página ─────────────────────────────────────────────── */
  const TOURS = {
    '/app.html': [
      {
        selector: 'button.orb',
        title: 'Háblale a ECO',
        text: 'Presiona este botón y cuéntale una historia. ECO escucha, pregunta y guarda todo lo que dices.'
      },
      {
        selector: '#userMenuBtn',
        title: 'Tu cuenta',
        text: 'Aquí puedes cambiar tu nombre, ajustar la voz de ECO y más opciones personales.'
      },
      {
        selector: 'a[href="/colaboraciones.html"]',
        title: 'Colaboración 🤝',
        text: 'Invita a familiares para que cuenten su versión de tus historias. Todo queda guardado.'
      },
      {
        selector: 'a[href="/capitulos.html"]',
        title: 'Mi libro 📖',
        text: 'ECO convierte tus conversaciones en capítulos. Tu historia, en un libro que crece solo.'
      }
    ],
    '/colaboraciones.html': [
      {
        selector: '#tabRecibidosBtn',
        title: 'Lo que dijeron de ti',
        text: 'Aquí ves los aportes que familiares y amigos hicieron sobre tus historias.'
      },
      {
        selector: '#invitarToggle',
        title: 'Invitar familiares',
        text: 'Invita a alguien por WhatsApp para que cuente su versión. Recibirá un enlace directo.'
      },
      {
        selector: '#tabDadosBtn',
        title: 'Lo que aportaste tú',
        text: 'También puedes ver las historias que tú contaste en bitácoras de otras personas.'
      }
    ],
    '/capitulos.html': [
      {
        selector: '#lista',
        title: 'Tus capítulos',
        text: 'Aquí aparecen los capítulos que ECO arma con tus conversaciones. Toca uno para leerlo.'
      },
      {
        selector: '#generarBtn',
        title: 'Generar capítulos',
        text: 'Cuando tengas historias nuevas, presiona aquí para actualizar tu libro.'
      },
      {
        selector: '#personaSelect',
        title: 'Voz narrativa',
        text: 'Elige cómo se cuenta el libro: en primera persona ("yo") o en tercera ("él / ella").'
      }
    ]
  };

  /* ─── CSS inyectado ────────────────────────────────────────────────── */
  const CSS = `
#eco-tour-overlay {
  position: fixed;
  inset: 0;
  z-index: 99998;
  pointer-events: none;
}
.eco-tour-shade {
  position: fixed;
  background: rgba(0,0,0,0.58);
  pointer-events: all;
  z-index: 99998;
}
.eco-tour-ring {
  position: fixed;
  z-index: 99999;
  border-radius: 10px;
  box-shadow: 0 0 0 3px #C4A96A, 0 0 0 6px rgba(196,169,106,0.3);
  pointer-events: none;
  transition: top .25s ease, left .25s ease, width .25s ease, height .25s ease;
}
.eco-tour-tip {
  position: fixed;
  z-index: 100000;
  background: #FBF6EA;
  border: 1.5px solid #E7DFCC;
  border-radius: 16px;
  padding: 18px 20px 14px;
  box-shadow: 0 8px 32px rgba(43,36,28,0.18);
  font-family: "Atkinson Hyperlegible", "Segoe UI", Arial, sans-serif;
  max-width: 300px;
  min-width: 240px;
  pointer-events: all;
  animation: eco-tip-in .2s ease;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .eco-tour-tip {
    background: #2B241C;
    border-color: #4A3F30;
    color: #F5EFE2;
  }
}
:root[data-theme="dark"] .eco-tour-tip {
  background: #2B241C;
  border-color: #4A3F30;
  color: #F5EFE2;
}
@keyframes eco-tip-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.eco-tour-counter {
  font-size: 0.75rem;
  color: #9B8A72;
  letter-spacing: .04em;
  margin-bottom: 6px;
}
.eco-tour-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: #2B241C;
  margin-bottom: 6px;
  font-family: "Source Serif 4", Georgia, serif;
}
:root[data-theme="dark"] .eco-tour-title,
@media (prefers-color-scheme:dark) { :root:not([data-theme="light"]) .eco-tour-title }
{
  color: #F5EFE2;
}
.eco-tour-text {
  font-size: 0.9rem;
  color: #5B4D3A;
  line-height: 1.5;
  margin-bottom: 14px;
}
:root[data-theme="dark"] .eco-tour-text {
  color: #C4B49A;
}
.eco-tour-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.eco-tour-skip {
  background: none;
  border: none;
  color: #9B8A72;
  font-size: 0.82rem;
  cursor: pointer;
  padding: 6px 2px;
  font-family: inherit;
  text-decoration: underline;
}
.eco-tour-skip:hover { color: #5B4D3A; }
.eco-tour-next {
  background: #5B6B45;
  color: #FBF6EA;
  border: none;
  border-radius: 10px;
  padding: 9px 18px;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
  transition: background .15s;
}
.eco-tour-next:hover { background: #4A5937; }
`;

  /* ─── Estado ───────────────────────────────────────────────────────── */
  const page = location.pathname;
  const STEPS = TOURS[page];
  if (!STEPS) return;

  const STORAGE_KEY = 'eco_tour_done_' + page.replace(/\W/g, '_');

  let tourEl = null;
  let shadeT, shadeB, shadeL, shadeR, ring;

  /* ─── Inicialización ───────────────────────────────────────────────── */
  function init() {
    try { if (localStorage.getItem(STORAGE_KEY)) return; } catch (e) {}

    if (page === '/app.html') {
      // Esperar a que appContent sea visible (tras el login)
      const appContent = document.getElementById('appContent');
      if (!appContent) return;
      let polling = setInterval(() => {
        if (!appContent.hasAttribute('hidden') && appContent.style.display !== 'none') {
          clearInterval(polling);
          setTimeout(buildAndStart, 900);
        }
      }, 350);
    } else {
      setTimeout(buildAndStart, 500);
    }
  }

  /* ─── Construcción del DOM del tour ───────────────────────────────── */
  function buildAndStart() {
    try { if (localStorage.getItem(STORAGE_KEY)) return; } catch (e) {}

    // Inyectar CSS
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    // Contenedor principal (solo como referencia; los hijos son position:fixed)
    tourEl = document.createElement('div');
    tourEl.id = 'eco-tour-overlay';

    shadeT = makeShade(); shadeB = makeShade();
    shadeL = makeShade(); shadeR = makeShade();
    ring   = document.createElement('div');
    ring.className = 'eco-tour-ring';

    tourEl.append(shadeT, shadeB, shadeL, shadeR, ring);
    document.body.appendChild(tourEl);

    showStep(0);
  }

  function makeShade() {
    const d = document.createElement('div');
    d.className = 'eco-tour-shade';
    return d;
  }

  /* ─── Mostrar paso ─────────────────────────────────────────────────── */
  function showStep(i) {
    // Limpiar tooltip anterior
    const oldTip = document.getElementById('eco-tour-tip');
    if (oldTip) oldTip.remove();

    if (i >= STEPS.length) { endTour(); return; }

    const step = STEPS[i];
    const target = document.querySelector(step.selector);

    if (!target) {
      // Elemento no encontrado en esta sesión: saltar paso
      showStep(i + 1);
      return;
    }

    // Scroll suave al elemento
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });

    setTimeout(() => renderStep(target, step, i), 320);
  }

  function renderStep(target, step, i) {
    const M = 10; // margen alrededor del elemento
    const rect = target.getBoundingClientRect();
    const ww = window.innerWidth;
    const wh = window.innerHeight;

    const t = Math.max(0, rect.top    - M);
    const b = Math.min(wh, rect.bottom + M);
    const l = Math.max(0, rect.left   - M);
    const r = Math.min(ww, rect.right  + M);

    // 4 paneles oscuros
    setPos(shadeT, { top:0, left:0, right:0, height: t });
    setPos(shadeB, { top: b, left:0, right:0, bottom:0 });
    setPos(shadeL, { top: t, left:0, width: l, height: b - t });
    setPos(shadeR, { top: t, left: r, right:0, height: b - t });

    // Anillo dorado
    ring.style.top    = t + 'px';
    ring.style.left   = l + 'px';
    ring.style.width  = (r - l) + 'px';
    ring.style.height = (b - t) + 'px';

    // Tooltip
    const tip = document.createElement('div');
    tip.id = 'eco-tour-tip';
    tip.className = 'eco-tour-tip';

    tip.innerHTML =
      '<div class="eco-tour-counter">' + (i + 1) + ' de ' + STEPS.length + '</div>' +
      '<div class="eco-tour-title">'   + step.title + '</div>' +
      '<div class="eco-tour-text">'    + step.text  + '</div>' +
      '<div class="eco-tour-actions">' +
        '<button class="eco-tour-skip" type="button">Saltar</button>' +
        '<button class="eco-tour-next" type="button">' +
          (i < STEPS.length - 1 ? 'Siguiente →' : '¡Entendido!') +
        '</button>' +
      '</div>';

    // Posición del tooltip: preferir debajo; si no cabe, arriba
    const TIP_H = 160;
    const TIP_W = Math.min(300, ww - 32);
    let tipTop = b + 14;
    if (tipTop + TIP_H > wh - 16) tipTop = t - TIP_H - 14;
    tipTop = Math.max(10, Math.min(tipTop, wh - TIP_H - 10));

    let tipLeft = l;
    tipLeft = Math.max(16, Math.min(tipLeft, ww - TIP_W - 16));

    tip.style.top   = tipTop + 'px';
    tip.style.left  = tipLeft + 'px';
    tip.style.width = TIP_W + 'px';

    document.body.appendChild(tip);

    tip.querySelector('.eco-tour-skip').addEventListener('click', endTour);
    tip.querySelector('.eco-tour-next').addEventListener('click', () => showStep(i + 1));
  }

  function setPos(el, p) {
    el.style.top    = p.top    != null ? p.top    + 'px' : '';
    el.style.left   = p.left   != null ? p.left   + 'px' : '';
    el.style.right  = p.right  != null ? p.right  + 'px' : '';
    el.style.bottom = p.bottom != null ? p.bottom + 'px' : '';
    el.style.width  = p.width  != null ? p.width  + 'px' : '';
    el.style.height = p.height != null ? p.height + 'px' : '';
  }

  /* ─── Fin del tour ─────────────────────────────────────────────────── */
  function endTour() {
    const tip = document.getElementById('eco-tour-tip');
    if (tip) tip.remove();
    if (tourEl) { tourEl.remove(); tourEl = null; }
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch (e) {}
  }

  /* ─── Arranque ─────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
