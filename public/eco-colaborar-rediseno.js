/* ECO · Colaborar compacto, conserva botones y listeners originales. */
(()=>{
'use strict';
function init(){
 const root=document.querySelector('#appContent');
 const header=root?.querySelector('header');
 const sw=root?.querySelector('#collabSwitch');
 const wrap=root?.querySelector('.aportes');
 const orbZone=wrap?.querySelector('.orb-zone');
 const list=root?.querySelector('#aportesLista');
 if(!root||!header||!wrap||!orbZone||root.dataset.ecoColabCompacto)return;
 root.dataset.ecoColabCompacto='1';
 const h2=wrap.querySelector('h2');
 if(h2)h2.textContent='Cuenta tu recuerdo';
 // Barra de acciones compacta encima del panel principal.
 const barra=document.createElement('div');
 barra.className='eco-colab-barra';
 // Selector de bitácora compactado sin sustituir los enlaces originales.
 if(sw){
   // Extraer el enlace "Tengo un código" antes de mover sw al acordeón.
   const codigoEl=Array.from(sw.querySelectorAll('p')).find(p=>p.querySelector('a[href*="unirme"]'));
   if(codigoEl)sw.removeChild(codigoEl);
   const details=document.createElement('details');
   details.className='eco-colab-personas';
   const sum=document.createElement('summary');
   sum.textContent='Cambiar de bitácora';
   const hint=document.createElement('span');
   hint.className='eco-colab-actual';
   sum.appendChild(hint);
   details.append(sum,sw);
   barra.appendChild(details);
   if(codigoEl){codigoEl.className='eco-colab-codigo';barra.appendChild(codigoEl);}
   function sync(){
     const active=sw.querySelector('.collab-switch-list a.active');
     const selected=sw.querySelector('.collab-switch-list select');
     const name=active?.textContent?.trim()||selected?.selectedOptions?.[0]?.textContent?.trim()||'';
     hint.textContent=name?' · '+name:'';
   }
   const watcher=new MutationObserver(sync);
   watcher.observe(sw,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
   sw.addEventListener('change',sync);
   sync();
 }
 if(list){
   const hr=wrap.querySelector('hr');
   const details=document.createElement('details');
   details.className='eco-colab-historial';
   const sum=document.createElement('summary');
   sum.textContent='Ver historias que he aportado';
   details.append(sum);
   if(hr)details.appendChild(hr);
   details.appendChild(list);
   barra.appendChild(details);
   const watch=new MutationObserver(()=>{
     const count=list.querySelectorAll('.item').length;
     sum.textContent='Ver historias que he aportado'+(count?' ('+count+')':'');
   });
   watch.observe(list,{childList:true});
 }
 // Insertar barra antes del panel principal.
 wrap.parentNode.insertBefore(barra,wrap);
 // Agrupa opciones para adjuntar, pero no mueve los inputs ni los controles.
 const audioBtn=orbZone.querySelector('#subirAudioBtn');
 const photoBtn=orbZone.querySelector('#subirFotoBtn');
 if(audioBtn&&photoBtn){
   const actions=document.createElement('div');
   actions.className='eco-colab-adjuntos';
   audioBtn.parentNode.insertBefore(actions,audioBtn);
   actions.append(audioBtn,photoBtn);
 }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

/* ECO: solo cambia el título visible. No recrea elementos ni eventos. */
(()=>{
  function init(){
    const title=document.querySelector('#appContent > header h1');
    if(title) title.textContent='Aportar una historia';
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();
