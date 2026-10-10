/* ECO · Mi libro: lector editorial accesible, no reemplaza las funciones de capítulos. */
(() => {
 'use strict';
 function init(){
   const lista=document.getElementById('lista');
   if(!lista||document.getElementById('ecoReader'))return;
   const overlay=document.createElement('div');
   overlay.id='ecoReader';
   overlay.className='eco-reader-overlay';
   overlay.hidden=true;
   overlay.innerHTML=`
    <div class="eco-reader" role="dialog" aria-modal="true" aria-labelledby="ecoReaderTitle">
      <div class="eco-reader-toolbar">
        <button type="button" id="ecoReaderClose" class="eco-reader-back">← Mis capítulos</button>
        <div class="eco-reader-fonts" role="group" aria-label="Tamaño de texto">
          <button type="button" id="ecoReaderSmaller" aria-label="Reducir tamaño de texto">A−</button>
          <button type="button" id="ecoReaderLarger" aria-label="Aumentar tamaño de texto">A+</button>
        </div>
      </div>
      <article class="eco-reader-page">
        <p id="ecoReaderTheme" class="eco-reader-kicker"></p>
        <h2 id="ecoReaderTitle"></h2>
        <p id="ecoReaderMeta" class="eco-reader-meta"></p>
        <div id="ecoReaderText" class="eco-reader-text"></div>
        <div id="ecoReaderAudios" class="eco-reader-audios"></div>
        <p class="eco-reader-end">✦</p>
      </article>
    </div>`;
   document.body.appendChild(overlay);
   const text=overlay.querySelector('#ecoReaderText');
   const audios=overlay.querySelector('#ecoReaderAudios');
   let lastFocus=null;
   const fontKey='eco-book-reader-font-size';
   let fontSize=Number.parseInt(localStorage.getItem(fontKey)||'19',10);
   fontSize=Math.max(16,Math.min(26,fontSize||19));
   function applyFont(){text.style.fontSize=fontSize+'px';try{localStorage.setItem(fontKey,String(fontSize))}catch(e){}}
   applyFont();
   function open(card){
     const source=card.querySelector('.text');
     if(!source)return;
     lastFocus=document.activeElement;
     overlay.querySelector('#ecoReaderTheme').textContent=card.querySelector('.theme')?.textContent||'';
     overlay.querySelector('#ecoReaderTitle').textContent=card.querySelector('h2')?.textContent||'Capítulo';
     overlay.querySelector('#ecoReaderMeta').textContent=card.querySelector('.meta')?.textContent||'';
     text.textContent=source.textContent||'';
     audios.replaceChildren();
     const tracks=Array.from(card.querySelectorAll('audio'));
     if(tracks.length){
       const heading=document.createElement('h3');
       heading.textContent=tracks.length===1?'Escucha la historia original':'Escucha las historias originales';
       audios.appendChild(heading);
       tracks.forEach(a=>{
         const copy=document.createElement('audio');
         copy.controls=true;copy.preload='none';copy.src=a.currentSrc||a.src;
         audios.appendChild(copy);
       });
     }
     overlay.hidden=false;document.body.classList.add('eco-reader-open');
     overlay.querySelector('#ecoReaderClose').focus();
   }
   function close(){
     audios.querySelectorAll('audio').forEach(a=>a.pause());
     audios.replaceChildren();
     overlay.hidden=true;document.body.classList.remove('eco-reader-open');
     if(lastFocus&&lastFocus.isConnected)lastFocus.focus();
   }
   overlay.querySelector('#ecoReaderClose').addEventListener('click',close);
   overlay.querySelector('#ecoReaderSmaller').addEventListener('click',()=>{fontSize=Math.max(16,fontSize-1);applyFont()});
   overlay.querySelector('#ecoReaderLarger').addEventListener('click',()=>{fontSize=Math.min(26,fontSize+1);applyFont()});
   overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
   document.addEventListener('keydown',e=>{
     if(overlay.hidden)return;
     if(e.key==='Escape'){e.preventDefault();close();return}
     if(e.key==='Tab'){
       const controls=Array.from(overlay.querySelectorAll('button,a[href],audio[controls]')).filter(x=>x.getClientRects().length);
       if(!controls.length)return;
       if(e.shiftKey&&document.activeElement===controls[0]){e.preventDefault();controls.at(-1).focus()}
       else if(!e.shiftKey&&document.activeElement===controls.at(-1)){e.preventDefault();controls[0].focus()}
     }
   });
   function updateCards(){
     lista.querySelectorAll('.chapter:not([data-eco-editorial])').forEach(card=>{
       const content=card.querySelector('.text');
       if(!content)return;
       card.dataset.ecoEditorial='1';
       const preview=document.createElement('p');
       preview.className='eco-chapter-excerpt';
       const raw=(content.textContent||'').replace(/\s+/g,' ').trim();
       preview.textContent=raw.slice(0,195)+(raw.length>195?'…':'');
       const btn=document.createElement('button');
       btn.type='button';btn.className='eco-read-btn';btn.textContent='Leer capítulo →';
       btn.addEventListener('click',()=>open(card));
       content.insertAdjacentElement('beforebegin',preview);
       content.hidden=true;
       card.querySelectorAll('audio').forEach(a=>{a.hidden=true});
       const meta=card.querySelector('.meta');
       if(meta)meta.insertAdjacentElement('afterend',btn);
       else card.appendChild(btn);
     });
   }
   new MutationObserver(updateCards).observe(lista,{childList:true,subtree:false});
   updateCards();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
