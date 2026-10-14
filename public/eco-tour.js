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
        selector: 'a.aportar-ahora',
        title: '🎙️ Aportar a una historia',
        text: 'Toca aquí para grabarle un recuerdo a alguien de tu familia. Lo que cuentes queda guardado en su bitácora.'
      },
      {
        selector: '#tabRecibidosBtn',
        title: 'Lo que dijeron de ti',
        text: 'Aquí ves los aportes que familiares y amigos hicieron sobre tus propias historias.'
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
    '/arbol.html': [
      {
        selector: '#stage',
        title: 'Tu árbol genealógico',
        text: 'Aquí se dibuja tu familia. Haz clic en cualquier persona para ver sus vínculos. Puedes arrastrar las tarjetas para organizarlo.'
      },
      {
        selector: '#addPerson',
        title: 'Añadir familiar',
        text: 'Agrega a alguien nuevo con este botón. Solo necesitas nombre y parentesco.'
      },
      {
        selector: '#searchInput',
        title: 'Buscar',
        text: 'Escribe el nombre de cualquier familiar para encontrarlo rápido en el árbol.'
      },
      {
        selector: '#treeBtn',
        title: 'Vista de árbol / lista',
        text: 'Alterna entre ver tu familia como árbol visual o como lista. Elige la que te resulte más cómoda.'
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
      },
      {
        selector: '#ecoEditorialOpen',
        title: 'Diseñar mi libro',
        text: 'Aquí puedes personalizar la portada, el orden de los capítulos, agregar fotos y preparar el libro para imprimir.'
      }
    ]
  };

  /* ─── CSS inyectado ────────────────────────────────────────────────── */
  // Los estilos viven en /eco-tour.css (hoja de estilos, no <style> inline: lo bloquearía la CSP).

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

    // La intro de la primera vez (eco-intro.js) va antes que el recorrido por los botones.
    const intro = document.documentElement.dataset.ecoIntro;
    if (intro === 'consultando' || intro === 'abierto') { setTimeout(buildAndStart, 700); return; }

    // Cargar el CSS (hoja de estilos externa)
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/eco-tour.css?v=1';
    document.head.appendChild(link);

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
