/* Estadísticas de visitas con Vercel Web Analytics: sin cookies y sin datos personales. Es lo mismo que hace
 * inject() del paquete @vercel/analytics, pero escrito a mano porque las páginas son HTML sin bundler.
 * Solo corre en el sitio real (en local no existe /_vercel/insights). Para que cuente hay que activar
 * "Web Analytics" en el panel de Vercel del proyecto. */
(() => {
  'use strict';
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  const s = document.createElement('script');
  s.defer = true;
  s.src = '/_vercel/insights/script.js';
  document.head.appendChild(s);
})();
