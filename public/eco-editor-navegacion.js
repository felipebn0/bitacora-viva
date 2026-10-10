/* ECO · Navegación entre selección y página de capítulo (sin cambiar guardado). */
(()=>{'use strict';
function init(){
 const launch=document.getElementById('ecoEditorialOpen');if(!launch)return;
 let btn=null;
 function connect(){
  const dlg=document.getElementById('ecoEditorialDialog');if(!dlg||dlg.dataset.ecoNavFixed)return;
  dlg.dataset.ecoNavFixed='1';
  const form=dlg.querySelector('#ecoEditorialForm'),preview=dlg.querySelector('.eco-editorial-preview'),pages=dlg.querySelector('#ecoEditorialBook');
  if(!form||!preview||!pages)return;
  btn=document.createElement('button');btn.type='button';btn.className='eco-book-return-controls';btn.textContent='↑ Volver a las opciones';
  btn.addEventListener('click',()=>{const target=form.querySelector('select')||dlg.querySelector('.eco-editorial-sidebar nav');target?.scrollIntoView({behavior:'smooth',block:'start'});});
  preview.insertBefore(btn,pages);
  function locate(){
   const select=form.querySelector('select[aria-label="Capítulo para fotografías y voces"],select[aria-label="Seleccionar capítulo"]');
   if(!select)return;
   const title=select.selectedOptions[0]?.textContent?.trim();if(!title)return;
   const headings=[...pages.querySelectorAll('.eco-editorial-page h2')];
   const h=headings.find(x=>x.textContent.trim()===title);
   if(!h)return;
   const page=h.closest('.eco-editorial-page');if(!page)return;
   requestAnimationFrame(()=>{
    if(matchMedia('(max-width: 850px)').matches){page.scrollIntoView({behavior:'smooth',block:'start'})}
    else {preview.scrollTo({top:Math.max(0,page.offsetTop-preview.offsetTop-12),behavior:'smooth'});}
   });
  }
  form.addEventListener('change',e=>{if(e.target.matches('select[aria-label="Capítulo para fotografías y voces"],select[aria-label="Seleccionar capítulo"]'))setTimeout(locate,70)});
  // Al entrar al apartado de edición o fotos se lleva la vista al capítulo elegido.
  dlg.querySelectorAll('button[data-view="chapter"],button[data-view="media"]').forEach(b=>b.addEventListener('click',()=>setTimeout(locate,80)));
 }
 launch.addEventListener('click',()=>setTimeout(connect,30));
 connect();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
