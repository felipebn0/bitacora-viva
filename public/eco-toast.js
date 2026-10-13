/* eco-toast.js — Toast de feedback global.
   Expone window.showToast(msg, type) donde type es:
     'success' (default) | 'error' | 'info'
   Auto-inyecta su CSS; solo necesitas incluir este <script>. */
(() => {
  'use strict';

  /* ─── CSS ────────────────────────────────────────────────────────── */
  const CSS = `
.eco-toast {
  position: fixed;
  bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  left: 50%;
  transform: translateX(-50%) translateY(20px);
  background: #2B241C;
  color: #FBF6EA;
  padding: 12px 22px 12px 16px;
  border-radius: 12px;
  font-size: 0.9rem;
  font-family: "Atkinson Hyperlegible", "Segoe UI", Arial, sans-serif;
  box-shadow: 0 4px 24px rgba(43,36,28,0.28);
  z-index: 99995;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.22s ease, transform 0.22s ease;
  max-width: calc(100vw - 48px);
  pointer-events: all;
  display: flex;
  align-items: center;
  gap: 8px;
  line-height: 1.4;
}
.eco-toast--in  { opacity: 1; transform: translateX(-50%) translateY(0); }
.eco-toast--out { opacity: 0; transform: translateX(-50%) translateY(20px); }
.eco-toast--success::before { content: '✓'; font-weight: 700; flex-shrink: 0; }
.eco-toast--error   { background: #6B2020; }
.eco-toast--error::before   { content: '⚠'; flex-shrink: 0; }
.eco-toast--info::before    { content: 'ℹ'; flex-shrink: 0; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .eco-toast        { background: #F0E8D8; color: #2B241C; }
  :root:not([data-theme="light"]) .eco-toast--error { background: #F5D5D5; color: #6B2020; }
}
:root[data-theme="dark"] .eco-toast        { background: #F0E8D8; color: #2B241C; }
:root[data-theme="dark"] .eco-toast--error { background: #F5D5D5; color: #6B2020; }
`;

  const style = document.createElement('style');
  style.id = 'eco-toast-css';
  style.textContent = CSS;
  document.head.appendChild(style);

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
