/* Progressive, accessible motion. Never hide actual content behind JavaScript. */
(()=>{'use strict';if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const init=()=>{const panels=[...document.querySelectorAll('.eco5-feature,.eco5-ai')];if(!('IntersectionObserver' in window)){panels.forEach(x=>x.classList.add('is-visible'));return}
  const observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){e.target.classList.add('is-visible');observer.unobserve(e.target)}},{threshold:.15});panels.forEach(x=>observer.observe(x));
 };if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
