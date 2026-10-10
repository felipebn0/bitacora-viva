/* ECO QR voces v3 · único acceso desde «Diseñar libro PDF». */
(()=>{
 'use strict';
 function init(){
   const launch=document.getElementById('ecoStudioLaunch');
   if(!launch)return;
   // Limpia el acceso separado de versiones anteriores si siguiera presente.
   const extra=document.getElementById('ecoQrLaunch');
   if(extra)extra.remove();
   mountEditor();
 }
 function mountEditor(){
   const overlay=document.getElementById('ecoStudioOverlay');
   if(!overlay||overlay.dataset.ecoQrV2)return;
   const bar=overlay.querySelector('.eco-studio-top-actions')||overlay.querySelector('.eco-studio-topbar');
   const print=overlay.querySelector('#ecoStudioPrint');
   const select=overlay.querySelector('#ecoStudioChapterSel');
   const paper=overlay.querySelector('#ecoStudioPaper');
   if(!bar||!print||!select||!paper)return;
   overlay.dataset.ecoQrV2='1';
   const btn=document.createElement('button');btn.type='button';btn.id='ecoMakeQr';
   btn.textContent='Crear QR de voz';btn.className='eco-qr-create';
   print.insertAdjacentElement('beforebegin',btn);
   const status=document.createElement('p');status.id='ecoQrStatus';status.setAttribute('role','status');
   status.className='eco-qr-status';
   const controls=overlay.querySelector('.eco-studio-controls');
   (controls||bar).appendChild(status);
   let details=null,chapterId='';
   function renderQr(){
     const old=paper.querySelector('#ecoBookQrFoot');if(old)old.remove();
     if(!details||chapterId!==select.value)return;
     const foot=document.createElement('aside');foot.id='ecoBookQrFoot';foot.className='eco-book-qr-foot';
     const image=document.createElement('img');
     image.src='/api/book-qr/image/'+details.token+'.svg';image.width=125;image.height=125;
     image.alt='QR para escuchar este capítulo';
     const copy=document.createElement('div');
     const heading=document.createElement('strong');heading.textContent='Escucha la voz original';
     const description=document.createElement('p');
     description.textContent='Escanea el código con un teléfono autorizado para escuchar las grabaciones originales de ECO.';
     const url=document.createElement('a');url.href=details.url;url.textContent='Probar el enlace de escucha';
     url.target='_blank';url.rel='noopener';
     copy.append(heading,description,url);foot.append(image,copy);paper.append(foot);
   }
   select.addEventListener('change',()=>{details=null;chapterId='';status.textContent='';paper.querySelector('#ecoBookQrFoot')?.remove()});
   const observer=new MutationObserver(()=>{
     if(details&&chapterId===select.value&&!paper.querySelector('#ecoBookQrFoot'))renderQr();
   });
   observer.observe(paper,{childList:true});
   btn.addEventListener('click',async()=>{
     const id=select.value;
     if(!/^\d+$/.test(id)){status.textContent='Primero elige un capítulo.';select.focus();return}
     btn.disabled=true;btn.textContent='Creando QR…';status.textContent='';
     try{
       const r=await fetch('/api/book-qr/chapters/'+encodeURIComponent(id),{method:'POST',credentials:'same-origin'});
       const data=await r.json();
       if(!r.ok)throw Error(data.error||'No se pudo crear el QR.');
       if(!data.token||!data.url)throw Error('La respuesta del servidor está incompleta.');
       details=data;chapterId=id;
       renderQr();
       status.textContent='QR agregado a la vista imprimible. Comprueba el enlace desde tu celular.';
     }catch(e){status.textContent=e.message||'No se pudo crear el QR.'}
     finally{btn.disabled=false;btn.textContent='Crear QR de voz'}
   });
 }
 const mo=new MutationObserver(init);
 mo.observe(document.documentElement,{childList:true,subtree:true});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
