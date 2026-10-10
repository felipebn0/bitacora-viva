/* ECO — Ventana de invitaciones estable. No cambia rutas ni eventos originales. */
(() => {
  'use strict';
  function init() {
    const trigger = document.getElementById('inviteToggle');
    const row = document.getElementById('inviteRow');
    if (!trigger || !row || document.getElementById('ecoInviteModal')) return;

    const personal = row.querySelector('.invite-personal');
    if (!personal) return;
    const code = document.createElement('div');
    code.className = 'eco-invite-code';
    Array.from(row.children).filter(el => el !== personal).forEach(el => code.appendChild(el));
    row.appendChild(code);

    const modal = document.createElement('div');
    modal.id = 'ecoInviteModal';
    modal.className = 'eco-invite-overlay';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="eco-invite-dialog" role="dialog" aria-modal="true" aria-labelledby="ecoInviteTitle">
        <div class="eco-invite-heading">
          <div><h2 id="ecoInviteTitle">Invitar a mi círculo</h2><p>Elige cómo quieres compartir ECO.</p></div>
          <button id="ecoInviteClose" type="button" class="eco-invite-close" aria-label="Cerrar invitaciones">×</button>
        </div>
        <div class="eco-invite-choices" id="ecoInviteChoices">
          <button class="eco-invite-choice" type="button" data-view="whatsapp"><span class="eco-invite-choice-icon" aria-hidden="true">↗</span><span><strong>Invitar por WhatsApp</strong><small>Un enlace personal para aportar recuerdos sin crear cuenta.</small></span><span aria-hidden="true">›</span></button>
          <button class="eco-invite-choice" type="button" data-view="codigo"><span class="eco-invite-choice-icon" aria-hidden="true">#</span><span><strong>Compartir código familiar</strong><small>Para que alguien con su propia cuenta se una a tu bitácora.</small></span><span aria-hidden="true">›</span></button>
        </div>
        <div class="eco-invite-detail" id="ecoInviteDetail" hidden>
          <button id="ecoInviteBack" type="button" class="eco-invite-back">← Elegir otra opción</button>
          <h3 id="ecoInviteDetailTitle"></h3>
          <div id="ecoInviteMount"></div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const choices = modal.querySelector('#ecoInviteChoices');
    const detail = modal.querySelector('#ecoInviteDetail');
    const heading = modal.querySelector('#ecoInviteDetailTitle');
    modal.querySelector('#ecoInviteMount').appendChild(row);
    let previousFocus = null;

    function choose(view) {
      choices.hidden = true;
      detail.hidden = false;
      personal.hidden = view !== 'whatsapp';
      code.hidden = view !== 'codigo';
      heading.textContent = view === 'whatsapp' ? 'Invitación personal' : 'Código familiar';
      const focusTarget = view === 'whatsapp' ? document.getElementById('inviteNombre') : document.getElementById('inviteCopyBtn');
      focusTarget?.focus();
    }
    function showChoices() {
      choices.hidden = false;
      detail.hidden = true;
      personal.hidden = true;
      code.hidden = true;
      modal.querySelector('[data-view]')?.focus();
    }
    function open() {
      if (!modal.hidden) return;
      previousFocus = document.activeElement;
      modal.hidden = false;
      document.body.classList.add('eco-invite-open');
      showChoices();
    }
    function close() {
      modal.hidden = true;
      document.body.classList.remove('eco-invite-open');
      row.style.display = 'none';
      trigger.setAttribute('aria-expanded', 'false');
      try { sessionStorage.removeItem('invitarAbierto'); } catch (_) {}
      (previousFocus?.isConnected ? previousFocus : trigger).focus();
    }
    // IMPORTANTE: abrir antes que el handler original (que consulta
    // getComputedStyle del formulario) y mantener ese handler para cargar
    // el código familiar y sus invitaciones reales.
    trigger.addEventListener('click', () => {
      if (modal.hidden) {
        row.style.display = 'none'; // evita que el handler original lo cierre
        open();
      }
    }, {capture:true});

    modal.querySelector('#ecoInviteClose').addEventListener('click', close);
    modal.querySelector('#ecoInviteBack').addEventListener('click', showChoices);
    modal.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => choose(btn.dataset.view)));
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    document.addEventListener('keydown', e => {
      if (modal.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      const candidates = [...modal.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]')]
        .filter(el => el.getClientRects().length > 0);
      if (!candidates.length) return;
      const first = candidates[0], last = candidates[candidates.length-1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    // El código original puede restaurar el panel al volver de WhatsApp.
    // Aseguramos que la restauración abra también esta ventana.
    const observer = new MutationObserver(() => {
      if (modal.hidden && row.style.display === 'block') open();
    });
    observer.observe(row, {attributes:true, attributeFilter:['style']});
    if (row.style.display === 'block') open();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
