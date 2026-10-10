/* ECO · Estudio integrado - fase de prueba. No modifica API ni historias originales. */
(()=>{'use strict';
const KEY='eco-editorial-borrador-v1';
let chapters=[],stories=[],state={},activeId='',dialog,book,form,list,status,mode='cover',previousFocus=null;
const byId=id=>document.getElementById(id);
const node=(tag,cls,value)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(value!==undefined)e.textContent=value;return e};
const plain=t=>String(t||'');
function fresh(){return {title:'Mi historia familiar',subtitle:'Recuerdos para las próximas generaciones',dedication:'',order:[],edits:{},media:{},bookPhotos:{},qr:{}}}
function read(){try{const x=JSON.parse(localStorage.getItem(KEY)||'null');if(x&&typeof x==='object'){return {...fresh(),...x,edits:typeof x.edits==='object'&&x.edits?x.edits:{},order:Array.isArray(x.order)?x.order:[]}}}catch{}return fresh()}
let version=0,saveTimer=null,saving=Promise.resolve(),dirty=false,serverReady=false;
function persist(){
 dirty=true;
 try{localStorage.setItem(KEY,JSON.stringify(state))}catch{}
 if(!serverReady){status.textContent='Sin conexión con el guardado en ECO. Exporta una copia de respaldo.';return}
 status.textContent='Cambios pendientes de guardar…';
 clearTimeout(saveTimer);
 saveTimer=setTimeout(flush,750);
}
function flush(){
 clearTimeout(saveTimer);
 if(!dirty||!serverReady)return saving;
 dirty=false;
 const snapshot=JSON.parse(JSON.stringify(state));
 saving=saving.then(async()=>{
   const r=await fetch('/api/book-editor/draft',{method:'PUT',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({book:snapshot,version})});
   const d=await r.json().catch(()=>({}));
   if(r.status===409){serverReady=false;dirty=true;status.textContent='Hay una versión más nueva en otro dispositivo. Exporta tu copia antes de recargar.';return}
   if(!r.ok)throw Error(d.error||'No se pudieron guardar los cambios.');
   version=d.version;
   status.textContent=dirty?'Hay nuevos cambios pendientes…':'Guardado en tu cuenta ECO ✓';
 }).catch(e=>{dirty=true;status.textContent='No se guardó en ECO: '+e.message+' Descarga el borrador como respaldo.'});
 return saving;
}
function saveField(k,v){state[k]=v;persist();drawBook()}
function getOrder(){const ids=chapters.map(c=>String(c.id));return [...state.order.filter(x=>ids.includes(String(x))).map(String),...ids.filter(x=>!state.order.includes(x))]}
function ordered(){return getOrder().map(id=>chapters.find(c=>String(c.id)===id)).filter(Boolean)}
function entry(c){return state.edits[String(c.id)]||{}}
function init(){const orig=byId('ecoStudioLaunch');if(!orig||byId('ecoEditorialOpen'))return;
 const launch=node('button','eco-editorial-open','Diseñar mi libro');launch.id='ecoEditorialOpen';launch.type='button';orig.hidden=true;orig.insertAdjacentElement('afterend',launch);launch.addEventListener('click',open);
}
function create(){if(dialog)return;
 dialog=node('div','eco-editorial-overlay');dialog.id='ecoEditorialDialog';dialog.hidden=true;
 dialog.innerHTML=`<div class="eco-editorial-shell" role="dialog" aria-modal="true" aria-labelledby="ecoEditorialTitle"><div class="eco-editorial-top"><div><small>ECO · ESTUDIO EDITORIAL</small><h2 id="ecoEditorialTitle">Diseña tu libro</h2></div><div class="eco-editorial-topbuttons"><button id="ecoEditorialExport" type="button">Exportar borrador</button><button id="ecoEditorialPrint" type="button" class="eco-primary">Vista para imprimir</button><button id="ecoEditorialClose" type="button" aria-label="Cerrar estudio">Cerrar ×</button></div></div><p class="eco-editorial-warning">El libro se guarda en tu cuenta ECO cuando hay conexión. Las historias originales no se modifican. Puedes exportar una copia de respaldo.</p><div class="eco-editorial-layout"><aside class="eco-editorial-sidebar"><nav aria-label="Secciones del libro"><button type="button" data-view="cover" class="selected">01 · Portada y dedicatoria</button><button type="button" data-view="index">02 · Índice y orden</button><button type="button" data-view="chapter">03 · Editar un capítulo</button><button type="button" data-view="media">04 · Fotos y voces</button><button type="button" data-view="preview">05 · Vista del libro completo</button></nav><div id="ecoEditorialForm"></div><p id="ecoEditorialStatus" role="status" aria-live="polite"></p></aside><section class="eco-editorial-preview" aria-label="Vista previa"><div id="ecoEditorialBook" class="eco-editorial-pages"></div></section></div></div>`;
 document.body.appendChild(dialog);book=byId('ecoEditorialBook');form=byId('ecoEditorialForm');status=byId('ecoEditorialStatus');
 dialog.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{mode=b.dataset.view;choose()}));
 byId('ecoEditorialClose').addEventListener('click',close);byId('ecoEditorialPrint').addEventListener('click',()=>{mode='preview';choose();window.setTimeout(()=>window.print(),100)});
 byId('ecoEditorialExport').addEventListener('click',exportDraft);
 dialog.addEventListener('click',e=>{if(e.target===dialog)close()});dialog.addEventListener('keydown',e=>{if(e.key==='Escape')close();if(e.key==='Tab')trap(e)});
}
function trap(e){const nodes=[...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled])')].filter(el=>el.getClientRects().length);if(!nodes.length)return;if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1).focus()}else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0].focus()}}
async function open(){create();previousFocus=document.activeElement;dialog.hidden=false;document.body.classList.add('eco-editorial-open-body');state=fresh();serverReady=false;status.textContent='Cargando libro guardado…';
 try{
 const [r,dr,sr]=await Promise.all([fetch('/api/chapters',{credentials:'same-origin'}),fetch('/api/book-editor/draft',{credentials:'same-origin'}),fetch('/api/story-log',{credentials:'same-origin'})]);
 if(!r.ok||!dr.ok||!sr.ok)throw Error((r.status===401||dr.status===401)?'Inicia sesión para acceder a tu libro.':'No se pudo conectar con el guardado de ECO.');
 const [data,draft,storyData]=await Promise.all([r.json(),dr.json(),sr.json()]);stories=Array.isArray(storyData.stories)?storyData.stories:[];
 chapters=Array.isArray(data.chapters)?data.chapters:[];
 state={...fresh(),...(draft.book||{}),edits:draft.book?.edits||{},order:Array.isArray(draft.book?.order)?draft.book.order:[],media:draft.book?.media||{},bookPhotos:draft.book?.bookPhotos||{},qr:draft.book?.qr||{}};
 version=draft.version||0;serverReady=true;dirty=false;
 activeId=String(ordered()[0]?.id||'');
 status.textContent='Libro sincronizado con tu cuenta ECO ✓';
 }catch(e){chapters=[];state=read();status.textContent=e.message+' Se cargó el respaldo local cuando estaba disponible.'}
 mode='cover';choose();byId('ecoEditorialClose').focus()}
function close(){flush();dialog.hidden=true;document.body.classList.remove('eco-editorial-open-body');(previousFocus?.isConnected?previousFocus:byId('ecoEditorialOpen'))?.focus()}
function field(label,val,fn,multi=false){const wrap=node('label','eco-editorial-field');wrap.appendChild(node('span','',label));const input=node(multi?'textarea':'input');if(multi)input.rows=6;input.value=val;input.addEventListener('input',()=>fn(input.value));wrap.appendChild(input);return wrap}
function choose(){dialog.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('selected',b.dataset.view===mode));form.replaceChildren();
 if(mode==='cover'){form.append(field('Título de tu libro',state.title,v=>saveField('title',v)),field('Subtítulo',state.subtitle,v=>saveField('subtitle',v)),field('Dedicatoria',state.dedication,v=>saveField('dedication',v),true));}
 if(mode==='index'){form.appendChild(node('h3','','Organiza los capítulos'));if(!chapters.length)form.appendChild(node('p','','Genera capítulos primero desde Mi libro.'));
 const order=getOrder();order.forEach((id,i)=>{const c=chapters.find(x=>String(x.id)===id);if(!c)return;const row=node('div','eco-editorial-order');row.appendChild(node('span','',`${i+1}. ${entry(c).title||c.title||'Sin título'}`));for(const [delta,symbol,title] of [[-1,'↑','Subir'],[1,'↓','Bajar']]){const b=node('button','',symbol);b.type='button';b.title=title;b.setAttribute('aria-label',`${title} ${c.title}`);b.disabled=i+delta<0||i+delta>=order.length;b.addEventListener('click',()=>{const a=[...order];[a[i],a[i+delta]]=[a[i+delta],a[i]];state.order=a;persist();choose()});row.appendChild(b)}form.appendChild(row)})}
 if(mode==='chapter'){const select=node('select');select.setAttribute('aria-label','Seleccionar capítulo');ordered().forEach(c=>select.add(new Option(entry(c).title||c.title||'Sin título',String(c.id))));if(activeId&&!ordered().some(c=>String(c.id)===activeId))activeId=String(ordered()[0]?.id||'');select.value=activeId;select.addEventListener('change',()=>{activeId=select.value;choose()});form.appendChild(select);const c=chapters.find(x=>String(x.id)===activeId);if(c){const ed=entry(c);form.append(field('Título del capítulo',ed.title??plain(c.title),v=>edit(c,'title',v)),field('Texto del capítulo',ed.text??plain(c.generated_text),v=>edit(c,'text',v),true));form.appendChild(node('p','eco-editorial-hint','Estos cambios forman parte del borrador editorial, no reemplazan el capítulo original.'))}else form.appendChild(node('p','','Todavía no hay capítulos para editar.'))}
 if(mode==='media')mediaPanel();
 if(mode==='preview')form.append(node('p','eco-editorial-hint','Vista completa del borrador, lista para revisar. Para la impresión definitiva todavía falta validar el tamaño, los saltos de página y las fotografías.'));
 drawBook()}
function photoOptions(c){
 const ids=new Set((c.story_ids||[]).map(String)),seen=new Set(),a=[];
 for(const st of stories){if(!ids.has(String(st.id)))continue;
  for(const m of Array.isArray(st.media_urls)?st.media_urls:[]){if(!m||m.type==='video'||typeof m.url!=='string'||!/^https:\/\//i.test(m.url)||seen.has(m.url))continue;
   seen.add(m.url);a.push({url:m.url,caption:String(m.caption||'').slice(0,180)});
  }
 }for(const p of (state.bookPhotos?.[String(c.id)]||[])){if(p&&typeof p.url==='string'&&/^https:\/\//.test(p.url)&&!seen.has(p.url)){seen.add(p.url);a.push({url:p.url,caption:p.caption||'',uploaded:true})}}return a;
}
function mediaPanel(){
 form.appendChild(node('h3','','Fotografías y voces'));
 const sel=node('select');sel.setAttribute('aria-label','Capítulo para fotografías y voces');ordered().forEach(c=>sel.add(new Option(entry(c).title||c.title||'Capítulo',String(c.id))));
 if(!ordered().some(c=>String(c.id)===activeId))activeId=String(ordered()[0]?.id||'');sel.value=activeId;
 sel.addEventListener('change',()=>{activeId=sel.value;choose()});form.appendChild(sel);
 const c=chapters.find(x=>String(x.id)===activeId);if(!c){form.appendChild(node('p','','Genera capítulos primero.'));return}
 form.appendChild(node('p','eco-editorial-hint','Sube fotografías directamente a este capítulo. Puedes elegir su tamaño, posición y pie de foto. Se guardan en tu cuenta ECO.'));
 const uploader=node('input','eco-editorial-upload-input');uploader.type='file';uploader.accept='image/jpeg,image/png,image/webp';uploader.multiple=true;uploader.id='ecoEditorialUpload';
 const uploadLabel=node('label','eco-editorial-upload-label','＋ Subir fotografías');uploadLabel.htmlFor=uploader.id;
 const note=node('p','eco-editorial-hint','Hasta 3 MB por foto (JPG, PNG o WebP). Puedes elegir varias.');
 form.append(uploadLabel,uploader,note);
 uploader.addEventListener('change',async()=>{
  const files=Array.from(uploader.files||[]).slice(0,12);uploader.value='';if(!files.length)return;
  uploadLabel.textContent='Subiendo fotografías…';uploader.disabled=true;
  let count=0,failed=[];
  for(const file of files){
   if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>3*1024*1024){failed.push(file.name+' (formato o tamaño)');continue}
   try{const r=await fetch('/api/book-editor/photo',{method:'POST',headers:{'Content-Type':file.type},credentials:'same-origin',body:file});
    const d=await r.json().catch(()=>({}));if(!r.ok||!d.url)throw Error(d.error||'No se pudo subir');
    state.bookPhotos??={};state.bookPhotos[activeId]??=[];
    if(!state.bookPhotos[activeId].some(p=>p.url===d.url))state.bookPhotos[activeId].push({url:d.url,caption:file.name.replace(/\.[^.]+$/,'').slice(0,180)});
    state.media??={};state.media[activeId]??={};state.media[activeId][d.url]={pos:'0',size:'full',caption:file.name.replace(/\.[^.]+$/,'').slice(0,180)};
    persist();count++;
   }catch(e){failed.push(file.name+' ('+e.message+')')}
  }
  uploadLabel.textContent='＋ Subir fotografías';uploader.disabled=false;
  if(count)choose();
  if(failed.length){const error=node('p','eco-editorial-hint','No se subieron: '+failed.join(', '));form.prepend(error)}
 });
 const images=photoOptions(c),chosen=state.media?.[activeId]||{};
 if(!images.length)form.appendChild(node('p','eco-editorial-hint','Todavía no hay fotografías. Puedes subirlas aquí mismo.'));
 const count=String(entry(c).text??c.generated_text??'').split(/\n\s*\n/).filter(Boolean).length;
 for(const img of images){const wrap=node('div','eco-editorial-photo-config');const thumb=node('img');thumb.src='/api/media-file?u='+encodeURIComponent(img.url);thumb.alt=img.caption||'Foto de la historia';thumb.loading='lazy';wrap.appendChild(thumb);
 const controls=node('div','eco-editorial-photo-fields');const label=node('label');const chk=node('input');chk.type='checkbox';chk.checked=chosen[img.url]?.pos!=='hide';label.append(chk,node('span','',' Incluir esta fotografía'));
 const position=node('select');position.setAttribute('aria-label','Posición en el capítulo');position.add(new Option('Antes del texto','0'));
 for(let i=1;i<=count;i++)position.add(new Option('Después del párrafo '+i,String(i)));
 position.value=chosen[img.url]?.pos&&chosen[img.url].pos!=='hide'?chosen[img.url].pos:'0';
 const caption=node('input');caption.setAttribute('aria-label','Pie de fotografía');caption.maxLength=180;caption.placeholder='Pie de foto';caption.value=chosen[img.url]?.caption??img.caption;
 const size=node('select');size.setAttribute('aria-label','Tamaño de fotografía');[['small','Pequeña'],['medium','Mediana'],['full','Grande']].forEach(([v,t])=>size.add(new Option(t,v)));size.value=chosen[img.url]?.size||'full';
 const save=()=>{state.media??={};state.media[activeId]??={};state.media[activeId][img.url]={pos:chk.checked?position.value:'hide',caption:caption.value,size:size.value};persist();drawBook()};
 [chk,position,size].forEach(x=>x.addEventListener('change',save));caption.addEventListener('input',save);controls.append(label,position,size,caption);
 if(img.uploaded){const remove=node('button','eco-editorial-remove-photo','Quitar del libro');remove.type='button';
 remove.addEventListener('click',()=>{if(!confirm('¿Quitar esta fotografía del libro? No se borrará de los archivos de ECO.'))return;
 state.bookPhotos[activeId]=state.bookPhotos[activeId].filter(x=>x.url!==img.url);
 if(state.media?.[activeId])delete state.media[activeId][img.url];persist();choose()});controls.appendChild(remove)}
 wrap.appendChild(controls);form.appendChild(wrap);
 }
 const title=node('h3','','Escucha este recuerdo');form.appendChild(title);
 const qr=state.qr?.[activeId];if(qr?.token){const a=node('a','eco-editorial-qr-link','Probar enlace de escucha ↗');a.href=qr.url;a.target='_blank';a.rel='noopener noreferrer';form.appendChild(a)}
 const btn=node('button','eco-editorial-makeqr',qr?'Volver a comprobar el QR':'Crear QR de voz');btn.type='button';
 const msg=node('p','eco-editorial-hint','El audio seguirá protegido: para escucharlo se necesita una sesión autorizada. Usa un dominio permanente antes de imprimir.');
 btn.addEventListener('click',async()=>{btn.disabled=true;msg.textContent='Preparando enlace de voz…';try{const r=await fetch('/api/book-qr/chapters/'+encodeURIComponent(c.id),{method:'POST',credentials:'same-origin'});const d=await r.json();if(!r.ok)throw Error(d.error||'No se pudo generar el QR');
 state.qr??={};state.qr[activeId]={token:d.token,url:d.url};persist();choose();}catch(e){msg.textContent=e.message}finally{btn.disabled=false}});
 form.append(btn,msg);
}
function appendMedia(page,c){const id=String(c.id),allowed=photoOptions(c),choice=state.media?.[id]||{},text=String(entry(c).text??c.generated_text??'');
 const paragraphs=text.split(/\n\s*\n/).filter(Boolean);
 function addAt(n){for(const p of allowed){const opts=choice[p.url]||{pos:'0',size:'full',caption:p.caption};if(opts.pos==='hide'||String(opts.pos)!==String(n))continue;
 const fig=node('figure','eco-editorial-figure eco-editorial-photo-'+(opts.size||'full'));const img=node('img');img.src='/api/media-file?u='+encodeURIComponent(p.url);img.alt=opts.caption||p.caption||'Foto familiar';fig.appendChild(img);
 if(opts.caption??p.caption)fig.appendChild(node('figcaption','',opts.caption??p.caption));page.appendChild(fig);
 }}
 addAt(0);paragraphs.forEach((t,i)=>{page.appendChild(node('p','eco-editorial-paragraph',t));addAt(i+1)});
 const qr=state.qr?.[id];if(qr?.token&&/^[a-f0-9]{48}$/.test(qr.token)){
 const aside=node('div','eco-editorial-qr');const image=node('img');image.src='/api/book-qr/image/'+qr.token+'.svg';image.alt='QR para escuchar la voz original';const line=node('div');line.append(node('strong','','Escucha la voz original'),node('p','','Escanea con un dispositivo autorizado para escuchar la grabación.'));aside.append(image,line);page.appendChild(aside);
 }
}
function edit(c,k,v){state.edits[String(c.id)]={...entry(c),[k]:v};persist();drawBook()}
function page(){return node('article','eco-editorial-page')}
function drawBook(){book.replaceChildren();const cover=page();cover.classList.add('eco-editorial-cover');cover.append(node('div','eco-editorial-cover-brand','ECO · BITÁCORA VIVA'),node('h1','',state.title||'Mi historia familiar'),node('p','',state.subtitle||''),node('span','eco-editorial-cover-mark','✦'));book.appendChild(cover);
 if(state.dedication?.trim()){const d=page();d.append(node('small','','DEDICATORIA'),node('p','eco-editorial-dedication',state.dedication));book.appendChild(d)}
 const index=page();index.appendChild(node('h2','','Contenido'));ordered().forEach((c,i)=>index.appendChild(node('p','eco-editorial-indexrow',`${String(i+1).padStart(2,'0')}   ${entry(c).title??c.title??'Capítulo'}`)));if(!chapters.length)index.appendChild(node('p','','Los capítulos aparecerán aquí cuando los generes.'));book.appendChild(index);
 ordered().forEach((c,i)=>{const p=page();p.append(node('small','',`CAPÍTULO ${String(i+1).padStart(2,'0')}`),node('h2','',entry(c).title??c.title??'Capítulo'));appendMedia(p,c);book.appendChild(p)})}
function exportDraft(){flush();const exportObject={format:'eco-editorial-borrador-v1',saved_at:new Date().toISOString(),book:state,chapters:chapters.map(c=>({id:c.id,original_title:c.title}))};const blob=new Blob([JSON.stringify(exportObject,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=node('a');a.href=url;a.download='ECO-mi-libro-borrador.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);status.textContent='Borrador exportado. Guárdalo como copia de seguridad.'}
window.addEventListener('pagehide',()=>{if(dirty&&serverReady)flush()});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
