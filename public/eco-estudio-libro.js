/* ECO · Estudio del libro — maquetación de fotos para impresión/PDF. Solo lectura. */
(()=>{
 'use strict';
 const DRAFT_KEY='eco-book-studio-draft-v1';
 function init(){
   const header=document.querySelector('body > header');
   if(!header||document.getElementById('ecoStudioLaunch'))return;
   const btn=document.createElement('button');
   btn.id='ecoStudioLaunch';btn.className='eco-studio-launch';btn.type='button';
   btn.textContent='Diseñar libro PDF';
   header.appendChild(btn);
   btn.addEventListener('click',abrirEstudio);
 }
 let overlay=null,paper=null,chapterSel=null,fotosListEl=null;
 let chapters=[],stories=[],placements={};
 function buildOverlay(){
   if(overlay)return;
   overlay=document.createElement('div');
   overlay.id='ecoStudioOverlay';overlay.className='eco-studio-overlay';
   overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');
   overlay.setAttribute('aria-label','Estudio del libro');
   overlay.innerHTML=`
<div class="eco-studio-topbar">
  <p class="eco-studio-topbar-title">Estudio del libro</p>
  <button class="eco-studio-print" id="ecoStudioPrint" type="button">Exportar PDF / Imprimir</button>
  <button class="eco-studio-close" id="ecoStudioClose" type="button">Cerrar</button>
</div>
<div class="eco-studio">
  <div class="eco-studio-controls">
    <h2>Capítulo</h2>
    <select class="eco-studio-chapter-sel" id="ecoStudioChapterSel"><option value="">Cargando…</option></select>
    <h2>Fotografías</h2>
    <div class="eco-studio-fotos-list" id="ecoStudioFotosList"><p class="eco-studio-empty">Elige un capítulo.</p></div>
  </div>
  <div class="eco-studio-preview">
    <article class="eco-studio-paper" id="ecoStudioPaper"><p class="eco-studio-empty">Elige un capítulo para ver la vista previa.</p></article>
  </div>
</div>`;
   document.body.appendChild(overlay);
   paper=overlay.querySelector('#ecoStudioPaper');
   chapterSel=overlay.querySelector('#ecoStudioChapterSel');
   fotosListEl=overlay.querySelector('#ecoStudioFotosList');
   overlay.querySelector('#ecoStudioClose').addEventListener('click',cerrar);
   overlay.querySelector('#ecoStudioPrint').addEventListener('click',()=>window.print());
   overlay.addEventListener('keydown',e=>{if(e.key==='Escape')cerrar();});
   chapterSel.addEventListener('change',()=>renderChapter(chapterSel.value));
 }
 const mediaSrc=u=>'/api/media-file?u='+encodeURIComponent(u);
 async function fetchData(){
   if(chapters.length&&stories.length)return;
   const[cr,sr]=await Promise.all([
     fetch('/api/chapters',{credentials:'same-origin'}),
     fetch('/api/story-log',{credentials:'same-origin'})
   ]);
   if(!cr.ok||!sr.ok)throw new Error('No se pudieron cargar los datos.');
   const[cd,sd]=await Promise.all([cr.json(),sr.json()]);
   chapters=Array.isArray(cd.chapters)?cd.chapters:[];
   stories=Array.isArray(sd.stories)?sd.stories:[];
 }
 let lastFocus=null;
 async function abrirEstudio(){
   lastFocus=document.activeElement;
   buildOverlay();
   overlay.classList.add('eco-studio-abierto');
   overlay.querySelector('#ecoStudioClose').focus();
   try{
     await fetchData();
     chapterSel.innerHTML='<option value="">— elige un capítulo —</option>';
     chapters.forEach(c=>{
       const opt=document.createElement('option');
       opt.value=c.id??c.title;opt.textContent=c.title||'(sin título)';
       chapterSel.appendChild(opt);
     });
   }catch(_){
     chapterSel.innerHTML='<option value="">No se pudieron cargar los capítulos.</option>';
   }
 }
 function cerrar(){
   if(!overlay)return;
   overlay.classList.remove('eco-studio-abierto');
   lastFocus?.focus();
 }
 function loadDraft(chapId){
   try{return JSON.parse(localStorage.getItem(DRAFT_KEY+':'+chapId)||'{}');}catch(_){return{};}
 }
 function saveDraft(chapId){
   try{localStorage.setItem(DRAFT_KEY+':'+chapId,JSON.stringify(placements));}catch(_){}
 }
 function renderChapter(chapId){
   paper.innerHTML='';fotosListEl.innerHTML='';
   if(!chapId){
     paper.innerHTML='<p class="eco-studio-empty">Elige un capítulo para ver la vista previa.</p>';
     fotosListEl.innerHTML='<p class="eco-studio-empty">Elige un capítulo.</p>';
     return;
   }
   const chap=chapters.find(c=>(c.id??c.title)===chapId||(c.id??c.title)==Number(chapId));
   if(!chap){paper.innerHTML='<p class="eco-studio-empty">Capítulo no encontrado.</p>';return;}
   placements=loadDraft(chapId);
   const ids=new Set((chap.story_ids||[]).map(Number));
   const images=[];
   for(const s of stories){
     if(!ids.has(Number(s.id)))continue;
     if(!Array.isArray(s.media_urls))continue;
     for(const m of s.media_urls){
       if(m&&m.type!=='video'&&typeof m.url==='string'&&/^https:\/\/[^ ]+/i.test(m.url)
          &&!images.some(x=>x.url===m.url))images.push(m);
     }
   }
   buildControls(chap,chapId,images);
   renderPreview(chap,images);
 }
 function buildControls(chap,chapId,images){
   fotosListEl.innerHTML='';
   if(!images.length){
     fotosListEl.innerHTML='<p class="eco-studio-empty">Este capítulo no tiene fotografías.</p>';
     return;
   }
   images.forEach((m,i)=>{
     const id='eco-foto-'+i;
     const cur=placements[m.url]||{pos:'ocultar',size:'media'};
     const wrap=document.createElement('div');wrap.className='eco-studio-foto-ctrl';
     const thumb=document.createElement('img');
     thumb.className='eco-studio-foto-thumb';thumb.loading='lazy';
     thumb.src=mediaSrc(m.url);thumb.alt=m.caption||'Foto';
     const info=document.createElement('div');info.className='eco-studio-foto-info';
     const cap=document.createElement('p');cap.className='eco-studio-foto-caption';
     cap.textContent=m.caption||'(sin descripción)';
     const posDiv=document.createElement('div');posDiv.className='eco-studio-foto-pos';
     const posSelect=document.createElement('select');posSelect.innerHTML=`
<option value="ocultar"${cur.pos==='ocultar'?' selected':''}>Ocultar</option>
<option value="inicio"${cur.pos==='inicio'?' selected':''}>Al inicio</option>
<option value="inline"${cur.pos==='inline'?' selected':''}>Con el texto</option>
<option value="fin"${cur.pos==='fin'?' selected':''}>Al final</option>`;
     const sizeSelect=document.createElement('select');sizeSelect.innerHTML=`
<option value="media"${cur.size==='media'?' selected':''}>Mitad</option>
<option value="completa"${cur.size==='completa'?' selected':''}>Completa</option>`;
     const update=()=>{
       placements[m.url]={pos:posSelect.value,size:sizeSelect.value};
       saveDraft(chapId);renderPreview(chap,images);
     };
     posSelect.addEventListener('change',update);sizeSelect.addEventListener('change',update);
     const posLabel=document.createElement('label');posLabel.textContent='Posición ';posLabel.appendChild(posSelect);
     const sizeLabel=document.createElement('label');sizeLabel.textContent='Tamaño ';sizeLabel.appendChild(sizeSelect);
     posDiv.appendChild(posLabel);posDiv.appendChild(sizeLabel);
     info.appendChild(cap);info.appendChild(posDiv);
     wrap.appendChild(thumb);wrap.appendChild(info);
     fotosListEl.appendChild(wrap);
   });
 }
 function makeFotoEl(m){
   const pl=placements[m.url]||{pos:'ocultar',size:'media'};
   if(pl.pos==='ocultar')return null;
   const fig=document.createElement('figure');
   fig.className='eco-paper-foto'+(pl.size==='completa'?' eco-paper-foto-full':' eco-paper-foto-half');
   const img=document.createElement('img');
   img.src=mediaSrc(m.url);img.alt=m.caption||'Fotografía';img.loading='lazy';
   fig.appendChild(img);
   if(m.caption){const fc=document.createElement('figcaption');fc.textContent=m.caption;fig.appendChild(fc);}
   return fig;
 }
 function renderPreview(chap,images){
   paper.innerHTML='';
   const h1=document.createElement('h1');h1.textContent=chap.title||'(sin título)';
   paper.appendChild(h1);
   const inicio=images.map(m=>({...m,_pl:placements[m.url]||{pos:'ocultar',size:'media'}})).filter(m=>m._pl.pos==='inicio');
   inicio.forEach(m=>{const el=makeFotoEl(m);if(el)paper.appendChild(el);});
   const bodyDiv=document.createElement('div');bodyDiv.className='eco-paper-body';
   bodyDiv.textContent=chap.body||chap.content||'(contenido no disponible)';
   const inline=images.map(m=>({...m,_pl:placements[m.url]||{pos:'ocultar',size:'media'}})).filter(m=>m._pl.pos==='inline');
   if(inline.length){
     const half=Math.ceil((bodyDiv.textContent.length/2));
     const beforeText=bodyDiv.textContent.slice(0,half);
     const afterText=bodyDiv.textContent.slice(half);
     const b1=document.createElement('div');b1.className='eco-paper-body';b1.textContent=beforeText;
     paper.appendChild(b1);
     inline.forEach(m=>{const el=makeFotoEl(m);if(el)paper.appendChild(el);});
     const b2=document.createElement('div');b2.className='eco-paper-body';b2.textContent=afterText;
     paper.appendChild(b2);
   }else{
     paper.appendChild(bodyDiv);
   }
   const fin=images.map(m=>({...m,_pl:placements[m.url]||{pos:'ocultar',size:'media'}})).filter(m=>m._pl.pos==='fin');
   fin.forEach(m=>{const el=makeFotoEl(m);if(el)paper.appendChild(el);});
   if(paper.children.length<=1){
     const empty=document.createElement('p');empty.className='eco-studio-empty';
     empty.textContent='Elige las posiciones de las fotografías en el panel izquierdo.';
     paper.appendChild(empty);
   }
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
