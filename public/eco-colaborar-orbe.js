/* ECO · Unifica el orbe de colaboración con el símbolo de Inicio.
   Mantiene el botón real, su ID, sus eventos y sus estados. */
(()=>{
'use strict';
function init(){
 const orb=document.querySelector('#appContent .orb-zone #orb');
 if(!orb||orb.dataset.ecoLogoColab==='1')return;
 orb.dataset.ecoLogoColab='1';
 const svg=`<svg class="orb-logo" viewBox="16 16 168 168" aria-hidden="true" focusable="false">
 <g class="wave-g w1"><circle class="wave-c" cx="100" cy="100" r="72" pathLength="100" transform="rotate(-34 100 100)"/></g>
 <g class="wave-g w2"><circle class="wave-c" cx="100" cy="100" r="72" pathLength="100" transform="rotate(-34 100 100)"/></g>
 <g class="wave-g w3"><circle class="wave-c" cx="100" cy="100" r="72" pathLength="100" transform="rotate(-34 100 100)"/></g>
 <g class="wave-g w4"><circle class="wave-c" cx="100" cy="100" r="72" pathLength="100" transform="rotate(-34 100 100)"/></g>
 <g class="rg r1"><circle class="ring" cx="100" cy="100" r="28" pathLength="100" transform="rotate(-10 100 100)"/></g>
 <g class="rg r2"><circle class="ring" cx="100" cy="100" r="50" pathLength="100" transform="rotate(-22 100 100)"/></g>
 <g class="rg r3"><circle class="ring" cx="100" cy="100" r="72" pathLength="100" transform="rotate(-34 100 100)"/></g>
 <circle class="dot" cx="100" cy="100" r="13"/>
 <g class="drop"><path class="drop-fill" transform="translate(100 100)" d="M0 -27C3 -17 13 -9 13 0A13 13 0 0 1 -13 0C-13 -9 -3 -17 0 -27Z"/></g>
 </svg>`;
 let changing=false;
 function sync(){
   if(changing||orb.querySelector('.orb-logo'))return;
   changing=true;
   const label=orb.innerHTML; // solo texto del propio botón, escrito por lógica de colaboración
   const text=document.createElement('span');
   text.id='ecoColabOrbLabel';
   // estados originales son literales internos, nunca datos aportados por usuarios
   text.innerHTML=label;
   const template=document.createElement('template');
   template.innerHTML=svg;
   orb.replaceChildren(template.content.cloneNode(true),text);
   changing=false;
 }
 const ob=new MutationObserver(sync);
 ob.observe(orb,{childList:true});
 sync();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
else init();
})();
