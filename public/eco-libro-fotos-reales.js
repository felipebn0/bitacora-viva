/* ECO · Fotos reales de las historias dentro del lector editorial.
   Solo lectura. No guarda cambios ni publica audio. */
(()=>{
 'use strict';
 function init(){
   const reader=document.getElementById('ecoReader');
   const storyList=document.getElementById('lista');
   if(!reader||!storyList||document.getElementById('ecoFotosStatus'))return;
   const text=reader.querySelector('#ecoReaderText');
   const title=reader.querySelector('#ecoReaderTitle');
   if(!text||!title)return;
   const status=document.createElement('p');
   status.id='ecoFotosStatus';
   status.className='eco-fotos-status';
   status.setAttribute('role','status');
   const region=document.createElement('div');
   region.id='ecoFotosRegion';
   region.className='eco-fotos-region';
   text.insertAdjacentElement('afterend',region);
   region.appendChild(status);
   let chapters=null,stories=null,token=0;
   const getData=async()=>{
     if(chapters&&stories)return;
     const [cr,sr]=await Promise.all([fetch('/api/chapters',{credentials:'same-origin'}),fetch('/api/story-log',{credentials:'same-origin'})]);
     if(!cr.ok||!sr.ok)throw Error('No se pudieron recuperar las fotografías de las historias.');
     const [cd,sd]=await Promise.all([cr.json(),sr.json()]);
     chapters=Array.isArray(cd.chapters)?cd.chapters:[];
     stories=Array.isArray(sd.stories)?sd.stories:[];
   };
   const mediaSrc=url=>'/api/media-file?u='+encodeURIComponent(url);
   function renderPhotos(list){
     region.replaceChildren();
     let count=0;
     const safe=list.filter(m=>m && m.type!=='video' && typeof m.url==='string' && /^https:\/\/[^ ]+/i.test(m.url));
     if(!safe.length){
       status.textContent='Este capítulo todavía no tiene fotografías asociadas.';
       region.appendChild(status);
       return;
     }
     const intro=document.createElement('p');
     intro.className='eco-photo-intro';
     intro.textContent='Fotografías originales de las historias de este capítulo';
     region.appendChild(intro);
     const grid=document.createElement('div');grid.className='eco-fotos-grid';
     for(const m of safe){
       const figure=document.createElement('figure');figure.className='eco-foto';
       const img=document.createElement('img');
       img.loading='lazy';img.decoding='async';
       img.src=mediaSrc(m.url);
       img.alt=typeof m.caption==='string'&&m.caption?m.caption:'Fotografía del recuerdo';
       img.addEventListener('error',()=>{figure.classList.add('eco-foto-error');img.alt='Fotografía no disponible'});
       figure.appendChild(img);
       if(m.caption){const cap=document.createElement('figcaption');cap.textContent=String(m.caption);figure.appendChild(cap)}
       grid.appendChild(figure);count++;
     }
     region.appendChild(grid);
     const note=document.createElement('p');
     note.className='eco-fotos-nota';
     note.textContent='Estas fotografías vienen de tus historias originales. Próximamente podrás decidir su tamaño y posición para el libro impreso.';
     region.appendChild(note);
   }
   async function syncReader(){
     if(reader.hidden){region.replaceChildren();return}
     const current=++token;
     region.replaceChildren();
     status.textContent='Buscando fotografías de este capítulo…';
     region.appendChild(status);
     try{
       await getData();
       if(current!==token||reader.hidden)return;
       const currentTitle=title.textContent?.trim();
       const matches=chapters.filter(c=>c.title?.trim()===currentTitle);
       if(matches.length!==1){
         status.textContent='No fue posible asociar de forma segura las fotografías a este capítulo.';
         return;
       }
       const ids=new Set((matches[0].story_ids||[]).map(Number));
       const images=[];
       for(const s of stories){
         if(!ids.has(Number(s.id)))continue;
         if(!Array.isArray(s.media_urls))continue;
         for(const m of s.media_urls){
           if(m&&m.type!=='video'&&typeof m.url==='string'&&!images.some(x=>x.url===m.url))images.push(m);
         }
       }
       renderPhotos(images);
     }catch(_){
       if(current===token)status.textContent='No fue posible cargar las fotografías. Puedes seguir leyendo el capítulo.';
     }
   }
   const observer=new MutationObserver(syncReader);
   observer.observe(reader,{attributes:true,attributeFilter:['hidden']});
   reader.querySelector('#ecoReaderClose')?.addEventListener('click',()=>{token++});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
