/* ECO · Colaborar compacto, conserva botones y listeners originales. */
(()=>{
'use strict';
function init(){
 const root=document.querySelector('#appContent');
 const header=root?.querySelector('header');
 const sw=root?.querySelector('#collabSwitch');
 const wrap=root?.querySelector('.aportes');
 const chat=root?.querySelector('#aporteChat');
 const orbZone=wrap?.querySelector('.orb-zone');
 const list=root?.querySelector('#aportesLista');
 if(!root||!header||!wrap||!orbZone||!chat||root.dataset.ecoColabCompacto)return;
 root.dataset.ecoColabCompacto='1';
 // El micrófono siempre es lo primero: mover el log existente sin recrearlo.
 orbZone.insertAdjacentElement('afterend',chat);
 const h2=wrap.querySelector('h2');
 if(h2)h2.textContent='Cuenta tu recuerdo';
 // Selector de bitácora compactado sin sustituir los enlaces originales.
 if(sw){
   const details=document.createElement('details');
   details.className='eco-colab-personas';
   const sum=document.createElement('summary');
   sum.textContent='Cambiar de bitácora';
   const hint=document.createElement('span');
   hint.className='eco-colab-actual';
   sum.appendChild(hint);
   sw.parentNode.insertBefore(details,sw);
   details.append(sum,sw);
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
   wrap.appendChild(details);
   const watch=new MutationObserver(()=>{
     const count=list.querySelectorAll('.item').length;
     sum.textContent='Ver historias que he aportado'+(count?' ('+count+')':'');
   });
   watch.observe(list,{childList:true});
 }
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
