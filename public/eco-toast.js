/* eco-toast.js — Toast de feedback global.
   Expone window.showToast(msg, type) donde type es:
     'success' (default) | 'error' | 'info'
   Auto-inyecta su CSS; solo necesitas incluir este <script>. */
(() => {
  'use strict';

  // Los estilos viven en /eco-toast.css (se carga como hoja de estilos, no como <style> inline,
  // que la política de seguridad CSP bloquearía).

  if (!document.getElementById('eco-toast-css')) {
    const link = document.createElement('link');
    link.id = 'eco-toast-css';
    link.rel = 'stylesheet';
    link.href = '/eco-toast.css';
    document.head.appendChild(link);
  }

  /* ─── Lógica ─────────────────────────────────────────────────────── */
  let current = null;

  window.showToast = function showToast(msg, type = 'success') {
    if (current) { dismissEl(current); current = null; }

    const t = document.createElement('div');
    t.className = 'eco-toast eco-toast--' + type;
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    t.textContent = msg;
    document.body.appendChild(t);
    current = t;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => t.classList.add('eco-toast--in'));
    });

    const tid = setTimeout(() => dismissEl(t), 3000);
    t.addEventListener('click', () => { clearTimeout(tid); dismissEl(t); });
  };

  function dismissEl(el) {
    el.classList.remove('eco-toast--in');
    el.classList.add('eco-toast--out');
    el.addEventListener('transitionend', () => {
      el.remove();
      if (current === el) current = null;
    }, { once: true });
  }
})();
