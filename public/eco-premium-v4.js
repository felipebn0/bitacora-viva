/* ECO V4 subtle motion; no changes to auth, form or data. */
(()=>{'use strict';
 if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 document.documentElement.classList.add('eco4-motion');
 function run(){
   if(!('IntersectionObserver' in window)){
     document.querySelectorAll('.reveal').forEach(el=>el.classList.add('show'));return;
   }
   const io=new IntersectionObserver(entries=>entries.forEach(e=>{
     if(e.isIntersecting){e.target.classList.add('show');io.unobserve(e.target)}
   }),{rootMargin:'0px 0px -7% 0px',threshold:.07});
   document.querySelectorAll('.reveal').forEach(el=>{if(el.getBoundingClientRect().top<window.innerHeight*.92)el.classList.add('show');else io.observe(el)});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
})();
