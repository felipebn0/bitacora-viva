/* eco-confirm.js — Diálogo de confirmación accesible.
   Sustituye window.confirm() con un modal que soporta teclado y lector de pantalla.

   Uso:
     const ok = await window.ecoConfirm('¿Eliminar esta historia?', { danger: true });
     if (ok) { ... }

   Opciones:
     confirmText  — texto del botón confirmar (default: 'Confirmar')
     cancelText   — texto del botón cancelar  (default: 'Cancelar')
     danger       — true → botón confirmar en rojo
*/
(() => {
  'use strict';

  if (!document.getElementById('eco-confirm-css')) {
    const link = document.createElement('link');
    link.id = 'eco-confirm-css';
    link.rel = 'stylesheet';
    link.href = '/eco-confirm.css';
    document.head.appendChild(link);
  }

  window.ecoConfirm = function ecoConfirm(msg, opts = {}) {
    const { confirmText = 'Confirmar', cancelText = 'Cancelar', danger = false } = opts;

    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'eco-confirm-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', msg);

      const box = document.createElement('div');
      box.className = 'eco-confirm-box';

      const p = document.createElement('p');
      p.className = 'eco-confirm-msg';
      p.textContent = msg;

      const actions = document.createElement('div');
      actions.className = 'eco-confirm-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'eco-confirm-cancel';
      cancelBtn.textContent = cancelText;

      const okBtn = document.createElement('button');
      okBtn.className = 'eco-confirm-ok' + (danger ? ' eco-confirm-ok--danger' : '');
      okBtn.textContent = confirmText;

      actions.appendChild(cancelBtn);
      actions.appendChild(okBtn);
      box.appendChild(p);
      box.appendChild(actions);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      // Prev focus
      const prevFocus = document.activeElement;

      // Animate in
      requestAnimationFrame(() => {
        requestAnimationFrame(() => overlay.classList.add('eco-confirm-overlay--in'));
      });

      // Focus el botón cancel por defecto (más seguro para acciones destructivas)
      cancelBtn.focus();

      function close(result) {
        overlay.classList.remove('eco-confirm-overlay--in');
        overlay.addEventListener('transitionend', () => {
          overlay.remove();
          if (prevFocus && prevFocus.focus) prevFocus.focus();
          resolve(result);
        }, { once: true });
      }

      // Focus trap
      overlay.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); close(false); return; }
        if (e.key === 'Enter' && document.activeElement === okBtn) { e.preventDefault(); close(true); return; }
        if (e.key !== 'Tab') return;
        const focusables = [cancelBtn, okBtn];
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      });

      cancelBtn.addEventListener('click', () => close(false));
      okBtn.addEventListener('click',     () => close(true));

      // Click outside = cancel
      overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
    });
  };
})();
