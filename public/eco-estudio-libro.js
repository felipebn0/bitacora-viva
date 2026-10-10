/* ECO Estudio Editorial v2 — revisión correctiva para la rama pruebas.
   Las imágenes nuevas viven temporalmente en esta pestaña y NO se envían al servidor.
   Se conserva el borrador de ubicación de fotos existentes en localStorage. */
(()=>{
'use strict';
const DRAFT='eco-book-studio-v2:';
let overlay,paper,selector,photosBox,photos=[],chapters=[],stories=[],chapter=null,placements={},extraByChapter=new Map();
const src=u=>'/api/media-file?u='+encodeURIComponent(u);
const $=(id)=>document.getElementById(id);
const el=(tag,cls,txt)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(txt!==undefined)x.textContent=txt;return x};
const idOf=c=>String(c.id);
function init(){
 if(!$('lista')||$('ecoStudioLaunch'))return;
 const header=document.querySelector('body>header');if(!header)return;
 const launch=el('button','eco-studio-launch','Diseñar libro PDF');launch.id='ecoStudioLaunch';launch.type='button';header.appendChild(launch);
 launch.addEventListener('click',open);
}
function setup(){
 if(overlay)return;
 overlay=el('div','eco-studio-overlay');overlay.id='ecoStudioOverlay';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','Estudio editorial');
 overlay.innerHTML=`<div class="eco-studio-topbar"><strong>Estudio editorial · ECO</strong><div class="eco-studio-top-actions"><button type="button" id="ecoStudioPrint">Exportar PDF / Imprimir</button><button type="button" id="ecoStudioClose">Cerrar</button></div></div><div class="eco-studio"><section class="eco-studio-controls"><label for="ecoStudioChapterSel">Capítulo</label><select id="ecoStudioChapterSel"></select><p class="eco-studio-notice">Las imágenes nuevas se conservan solo mientras esta pestaña permanezca abierta. Exporta el PDF antes de salir. Las fotos originales de tus historias no se modifican.</p><label class="eco-studio-upload" for="ecoStudioUpload">+ Agregar fotografías desde mi dispositivo</label><input type="file" id="ecoStudioUpload" accept="image/jpeg,image/png,image/webp" multiple><p id="ecoStudioMsg" role="status" aria-live="polite"></p><h2>Fotografías y posición</h2><div id="ecoStudioFotosList"></div></section><section class="eco-studio-preview"><article id="ecoStudioPaper" class="eco-studio-paper"></article></section></div>`;
 document.body.appendChild(overlay);selector=$('ecoStudioChapterSel');photosBox=$('ecoStudioFotosList');paper=$('ecoStudioPaper');
 $('ecoStudioClose').addEventListener('click',close);
 $('ecoStudioPrint').addEventListener('click',printBook);
 selector.addEventListener('change',()=>selectChapter(selector.value));
 $('ecoStudioUpload').addEventListener('change',handleFiles);
 overlay.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
}
async function open(){setup();overlay.classList.add('eco-studio-abierto');document.body.classList.add('eco-studio-active');$('ecoStudioClose').focus();
 selector.replaceChildren(new Option('Cargando capítulos…',''));
 try{
  const [cr,sr]=await Promise.all([fetch('/api/chapters',{credentials:'same-origin'}),fetch('/api/story-log',{credentials:'same-origin'})]);
  if(!cr.ok||!sr.ok)throw Error('No se pudieron cargar capítulos e historias. Comprueba tu sesión.');
  const [cd,sd]=await Promise.all([cr.json(),sr.json()]);chapters=Array.isArray(cd.chapters)?cd.chapters:[];stories=Array.isArray(sd.stories)?sd.stories:[];
  selector.replaceChildren(new Option('Selecciona un capítulo…',''));
  chapters.forEach(c=>selector.add(new Option(c.title||'Capítulo sin título',idOf(c))));
  if(chapters.length){selector.value=idOf(chapters[0]);selectChapter(selector.value)}else{paper.replaceChildren(el('p','eco-studio-empty','Todavía no hay capítulos generados.'))}
 }catch(e){msg(e.message);selector.replaceChildren(new Option('No se pudo cargar',''));}
}
function close(){if(!overlay)return;overlay.classList.remove('eco-studio-abierto');document.body.classList.remove('eco-studio-active');$('ecoStudioLaunch')?.focus()}
function msg(t){$('ecoStudioMsg').textContent=t}
function getDraft(id){try{return JSON.parse(localStorage.getItem(DRAFT+id)||'{}')}catch{return{}}}
function save(){if(!chapter)return;try{const originals={};for(const p of photos){if(p.existing&&placements[p.id])originals[p.id]=placements[p.id]};localStorage.setItem(DRAFT+idOf(chapter),JSON.stringify(originals))}catch{msg('No fue posible guardar las posiciones locales.')}}
function paragraphs(){const t=String(chapter?.generated_text||'').trim();return t?t.split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean):[]}
function selectChapter(id){chapter=chapters.find(c=>idOf(c)===String(id));photos=[];photosBox.replaceChildren();paper.replaceChildren();msg('');if(!chapter)return;
 placements=getDraft(id);
 const ids=new Set((chapter.story_ids||[]).map(Number));const seen=new Set();
 for(const story of stories){if(!ids.has(Number(story.id)))continue;for(const m of (Array.isArray(story.media_urls)?story.media_urls:[])){
  if(!m?.url||m.type==='video'||!/^https:\/\//i.test(m.url)||seen.has(m.url))continue;
  seen.add(m.url);photos.push({id:m.url,url:src(m.url),caption:m.caption||'',existing:true})
 }}
 for(const item of extraByChapter.get(id)||[])photos.push(item);
 updateControls();render();
 if(!photos.length)msg('Puedes agregar fotos con el botón superior. El texto de tu capítulo ya está listo para maquetar.');
}
async function handleFiles(e){if(!chapter){msg('Selecciona primero un capítulo.');return}
 const files=Array.from(e.target.files||[]).slice(0,12);e.target.value='';if(!files.length)return;
 const allowed=['image/jpeg','image/png','image/webp'];let added=0;
 for(const file of files){if(!allowed.includes(file.type)||file.size>10*1024*1024){msg('Se omitieron imágenes de formato no admitido o mayores de 10 MB.');continue}
  try{const url=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file)});
   const id='local:'+crypto.randomUUID();const item={id,url,caption:file.name.replace(/\.[^.]+$/,''),existing:false};
   photos.push(item);const k=idOf(chapter);extraByChapter.set(k,[...(extraByChapter.get(k)||[]),item]);
   placements[id]={pos:'0',size:'full'};added++;
  }catch{msg('No se pudo leer alguna fotografía.')}}
 updateControls();render();if(added)msg(`${added} fotografía(s) agregada(s) a esta vista temporal. Exporta el PDF antes de cerrar la pestaña.`)
}
function updateControls(){photosBox.replaceChildren();const count=paragraphs().length;
 if(!photos.length){photosBox.appendChild(el('p','eco-studio-empty','Todavía no hay fotografías para este capítulo.'));return}
 photos.forEach(p=>{
  const box=el('div','eco-studio-foto-ctrl');const thumb=el('img','eco-studio-foto-thumb');thumb.src=p.url;thumb.alt=p.caption||'Fotografía';box.appendChild(thumb);
  const form=el('div','eco-studio-foto-info');const cap=el('input','');cap.value=placements[p.id]?.caption??p.caption;cap.setAttribute('aria-label','Descripción de fotografía');cap.maxLength=180;
  const pos=el('select');pos.setAttribute('aria-label','Posición de fotografía');pos.add(new Option('No incluir','hide'));pos.add(new Option('Antes del primer párrafo','0'));
  for(let i=1;i<=count;i++)pos.add(new Option(`Después del párrafo ${i}`,String(i)));
  pos.value=String(placements[p.id]?.pos??'0');
  const size=el('select');size.setAttribute('aria-label','Tamaño de fotografía');[['small','Pequeña'],['medium','Mediana'],['full','Grande']].forEach(([v,label])=>size.add(new Option(label,v)));
  size.value=placements[p.id]?.size||'full';
  const change=()=>{placements[p.id]={pos:pos.value,size:size.value,caption:cap.value};save();render()};
  pos.addEventListener('change',change);size.addEventListener('change',change);cap.addEventListener('input',change);
  form.appendChild(cap);form.appendChild(pos);form.appendChild(size);
  if(!p.existing){const del=el('button','','Quitar foto');del.type='button';del.addEventListener('click',()=>{photos=photos.filter(x=>x!==p);extraByChapter.set(idOf(chapter),(extraByChapter.get(idOf(chapter))||[]).filter(x=>x!==p));delete placements[p.id];updateControls();render()});form.appendChild(del)}
  box.appendChild(form);photosBox.appendChild(box)
 });
}
function figure(p){const q=placements[p.id]||{pos:'0',size:'full'};const f=el('figure','eco-paper-foto eco-paper-'+q.size);const img=el('img');img.src=p.url;img.alt=q.caption||p.caption||'Fotografía de la historia';f.appendChild(img);if((q.caption??p.caption)){f.appendChild(el('figcaption','',q.caption??p.caption))}return f}
function render(){paper.replaceChildren();if(!chapter)return;paper.appendChild(el('div','eco-paper-brand','ECO · MEMORIAS DE FAMILIA'));paper.appendChild(el('h1','',chapter.title||'Capítulo'));
 if(chapter.theme)paper.appendChild(el('p','eco-paper-theme',chapter.theme));
 const ps=paragraphs();const insertAt=n=>{for(const p of photos){const q=placements[p.id]||{pos:'0',size:'full'};if(String(q.pos)===String(n))paper.appendChild(figure(p))}};
 insertAt(0);
 if(!ps.length)paper.appendChild(el('p','eco-studio-empty','Este capítulo no tiene texto disponible.'));
 ps.forEach((p,i)=>{paper.appendChild(el('p','eco-paper-paragraph',p));insertAt(i+1)});
 paper.appendChild(el('p','eco-paper-end','✦'));
}
async function printBook(){if(!chapter){msg('Selecciona un capítulo antes de exportar.');return}
 render();const imgs=Array.from(paper.querySelectorAll('img'));
 await Promise.all(imgs.map(x=>x.complete?Promise.resolve():new Promise(res=>{x.addEventListener('load',res,{once:true});x.addEventListener('error',res,{once:true});setTimeout(res,6000)})));
 window.print();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
