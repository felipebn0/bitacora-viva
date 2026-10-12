/* ECO · Upgrade de <audio controls> a reproductor personalizado.
   Reemplaza el elemento nativo con una UI propia y conecta el audio real.
   Usa MutationObserver para elementos insertados dinámicamente. */
(() => {
  'use strict';
  if (document.body.dataset.ecoAudioPlayer) return;
  document.body.dataset.ecoAudioPlayer = '1';

  // Tarjetas que reciben footer pegado al borde inferior
  const CARD_SEL = '.aporte-item, .chapter';

  function fmt(s) {
    return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  }

  function buildPlayerRow(audio) {
    const row = document.createElement('div');
    row.className = 'eco-player-row';

    const btn = document.createElement('button');
    btn.className = 'eco-play-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Reproducir');
    btn.innerHTML =
      '<svg class="ico-play" viewBox="0 0 16 16"><path d="M4 2.5l10 5.5-10 5.5z"/></svg>' +
      '<svg class="ico-pause" viewBox="0 0 16 16">' +
      '<rect x="3" y="2" width="4" height="12" rx="1"/>' +
      '<rect x="9" y="2" width="4" height="12" rx="1"/></svg>';

    const area = document.createElement('div');
    area.className = 'eco-track-area';

    const bar = document.createElement('div');
    bar.className = 'eco-track-bar';

    const fill = document.createElement('div');
    fill.className = 'eco-track-fill';

    const thumb = document.createElement('div');
    thumb.className = 'eco-track-thumb';

    bar.appendChild(fill);
    bar.appendChild(thumb);

    const times = document.createElement('div');
    times.className = 'eco-track-times';
    const cur = document.createElement('span');
    cur.textContent = '0:00';
    const dur = document.createElement('span');
    dur.textContent = '0:00';
    times.appendChild(cur);
    times.appendChild(dur);

    area.appendChild(bar);
    area.appendChild(times);
    row.appendChild(btn);
    row.appendChild(area);

    // Conectar al <audio> real
    if (audio.readyState >= 1 && audio.duration) {
      dur.textContent = fmt(audio.duration);
    }
    audio.addEventListener('loadedmetadata', () => {
      dur.textContent = fmt(audio.duration);
    });
    audio.addEventListener('timeupdate', () => {
      if (!audio.duration) return;
      const pct = (audio.currentTime / audio.duration * 100).toFixed(1) + '%';
      fill.style.width = pct;
      thumb.style.left = pct;
      cur.textContent = fmt(audio.currentTime);
    });
    audio.addEventListener('ended', () => {
      btn.classList.remove('playing');
      btn.setAttribute('aria-label', 'Reproducir');
      fill.style.width = '0%';
      thumb.style.left = '0%';
      cur.textContent = '0:00';
    });
    audio.addEventListener('play', () => {
      btn.classList.add('playing');
      btn.setAttribute('aria-label', 'Pausar');
    });
    audio.addEventListener('pause', () => {
      btn.classList.remove('playing');
      btn.setAttribute('aria-label', 'Reproducir');
    });
    btn.addEventListener('click', () => {
      if (audio.paused) audio.play();
      else audio.pause();
    });
    bar.addEventListener('click', e => {
      if (!audio.duration) return;
      const { left, width } = bar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - left) / width));
      audio.currentTime = pct * audio.duration;
    });

    return row;
  }

  function upgradeCardAudios(card) {
    const audios = Array.from(card.querySelectorAll('audio:not([data-eco-up])'));
    if (!audios.length) return;

    let footer = card.querySelector(':scope > .eco-player-footer');
    if (!footer) {
      footer = document.createElement('div');
      footer.className = 'eco-player-footer';
      card.appendChild(footer);
    }

    audios.forEach((audio, i) => {
      audio.dataset.ecoUp = '1';
      audio.removeAttribute('controls');
      audio.style.cssText = 'display:none!important';

      const row = buildPlayerRow(audio);
      if (audios.length > 1) {
        const lbl = document.createElement('span');
        lbl.className = 'eco-track-label';
        lbl.textContent = i + 1;
        row.insertBefore(lbl, row.firstChild);
      }
      footer.appendChild(row);
    });
  }

  function upgradeInlineAudio(audio) {
    if (audio.dataset.ecoUp) return;
    audio.dataset.ecoUp = '1';
    audio.removeAttribute('controls');
    audio.style.cssText = 'display:none!important';

    const wrap = document.createElement('div');
    wrap.className = 'eco-player-inline';
    wrap.appendChild(buildPlayerRow(audio));
    if (audio.parentNode) audio.parentNode.insertBefore(wrap, audio.nextSibling);
  }

  // Set de tarjetas con upgrade pendiente (para el setTimeout)
  const pendingCards = new Set();
  // Set de audios inline con upgrade pendiente
  const pendingInline = new Set();

  function scheduleAudio(audio) {
    if (audio.dataset.ecoUp || audio.dataset.ecoSkip) return;
    const card = audio.closest(CARD_SEL);
    if (card) {
      if (!pendingCards.has(card)) {
        pendingCards.add(card);
        setTimeout(() => {
          pendingCards.delete(card);
          upgradeCardAudios(card);
        }, 0);
      }
    } else {
      if (!pendingInline.has(audio)) {
        pendingInline.add(audio);
        setTimeout(() => {
          pendingInline.delete(audio);
          // Re-revisar: puede que ahora sí esté en una tarjeta
          const c = audio.closest(CARD_SEL);
          if (c) {
            if (!pendingCards.has(c)) {
              pendingCards.add(c);
              // Otro setTimeout para que otros audios del mismo card también apliquen
              setTimeout(() => {
                pendingCards.delete(c);
                upgradeCardAudios(c);
              }, 0);
            }
          } else {
            upgradeInlineAudio(audio);
          }
        }, 0);
      }
    }
  }

  function scanAddedNode(n) {
    if (n.nodeType !== 1) return;
    if (n.tagName === 'AUDIO') {
      scheduleAudio(n);
    } else {
      n.querySelectorAll('audio').forEach(scheduleAudio);
    }
  }

  // Audios ya presentes al cargar
  document.querySelectorAll('audio').forEach(scheduleAudio);

  // Audios añadidos dinámicamente
  const obs = new MutationObserver(muts => {
    muts.forEach(m => m.addedNodes.forEach(scanAddedNode));
  });
  obs.observe(document.body, { childList: true, subtree: true });
})();
