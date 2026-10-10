/* ECO · Estudio integrado v2 – sincroniza con servidor (CAS); localStorage como respaldo. */
(()=>{'use strict';
const KEY='eco-editorial-borrador-v1';
let chapters=[],state={},activeId='',dialog,book,form,list,status,mode='cover',previousFocus=null;
let version=0,saveTimer=null,saving=false,dirty=false,serverReady=false;
const byId=id=>document.getElementById(id);
const node=(tag,cls,value)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(value!==undefined)e.textContent=value;return e};
const plain=t=>String(t||'');
function fresh(){return {title:'Mi historia familiar',subtitle:'Recuerdos para las próximas generaciones',dedication:'',order:[],edits:{}}}
function read(){try{const x=JSON.parse(localStorage.getItem(KEY)||'null');if(x&&typeof x==='object'){return {...fresh(),...x,edits:typeof x.edits==='object'&&x.edits?x.edits:{},order:Array.isArray(x.order)?x.order:[]}}}catch{}return fresh()}
function persist(){
  try{localStorage.setItem(KEY,JSON.stringify(state));}catch{}
  if(serverReady){dirty=true;clearTimeout(saveTimer);saveTimer=setTimeout(flush,750);if(status)status.textContent='Guardando…';}
  else if(status)status.textContent='Borrador guardado en este navegador. No está sincronizado con tu cuenta.';}
async function flush(){
  if(!dirty||!serverReady)return;
  if(saving){saveTimer=setTimeout(flush,500);return;}
  saving=true;dirty=false;
  try{
    const r=await fetch('/api/book-editor/draft',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({version,draft:state})});
    if(r.ok){const d=await r.json();version=d.version||version;if(status)status.textContent='Borrador guardado en tu cuenta.';}
    else if(r.status===409){
      try{const rd=await r.json();if(rd.draft&&typeof rd.draft==='object'){state={...fresh(),...rd.draft,edits:typeof rd.draft.edits==='object'&&rd.draft.edits?rd.draft.edits:{},order:Array.isArray(rd.draft.order)?rd.draft.order:[]};version=rd.version||version;try{localStorage.setItem(KEY,JSON.stringify(state))}catch{}if(book)drawBook();if(status)status.textContent='Borrador actualizado desde otro dispositivo.';}}catch{}
    }else{dirty=true;if(status)status.textContent='No se pudo guardar en el servidor. Tu borrador sigue en este navegador.';}
  }catch{dirty=true;if(status)status.textContent='Sin conexión. El borrador sigue en este navegador.';}
  saving=false;}
function saveField(k,v){state[k]=v;persist();drawBook()}
function getOrder(){const ids=chapters.map(c=>String(c.id));return [...state.order.filter(x=>ids.includes(String(x))).map(String),...ids.filter(x=>!state.order.includes(x))]}
function ordered(){return getOrder().map(id=>chapters.find(c=>String(c.id)===id)).filter(Boolean)}
function entry(c){return state.edits[String(c.id)]||{}}
function init(){const orig=byId('ecoStudioLaunch');if(!orig||byId('ecoEditorialOpen'))return;
 const launch=node('button','eco-editorial-open','Diseñar mi libro');launch.id='ecoEditorialOpen';launch.type='button';orig.hidden=true;orig.insertAdjacentElement('afterend',launch);launch.addEventListener('click',open);
}
function create(){if(dialog)return;
 dialog=node('div','eco-editorial-overlay');dialog.id='ecoEditorialDialog';dialog.hidden=true;
 dialog.innerHTML=`<div class="eco-editorial-shell" role="dialog" aria-modal="true" aria-labelledby="ecoEditorialTitle"><div class="eco-editorial-top"><div><small>ECO · ESTUDIO EDITORIAL</small><h2 id="ecoEditorialTitle">Diseña tu libro</h2></div><div class="eco-editorial-topbuttons"><button id="ecoEditorialExport" type="button">Exportar borrador</button><button id="ecoEditorialPrint" type="button" class="eco-primary">Vista para imprimir</button><button id="ecoEditorialClose" type="button" aria-label="Cerrar estudio">Cerrar ×</button></div></div><p class="eco-editorial-warning">Versión de prueba: las historias originales no se modifican. Los cambios se sincronizan con tu cuenta.</p><div class="eco-editorial-layout"><aside class="eco-editorial-sidebar"><nav aria-label="Secciones del libro"><button type="button" data-view="cover" class="selected">01 · Portada y dedicatoria</button><button type="button" data-view="index">02 · Índice y orden</button><button type="button" data-view="chapter">03 · Editar un capítulo</button><button type="button" data-view="preview">04 · Vista del libro completo</button></nav><div id="ecoEditorialForm"></div><p id="ecoEditorialStatus" role="status" aria-live="polite"></p></aside><section class="eco-editorial-preview" aria-label="Vista previa"><div id="ecoEditorialBook" class="eco-editorial-pages"></div></section></div></div>`;
 document.body.appendChild(dialog);book=byId('ecoEditorialBook');form=byId('ecoEditorialForm');status=byId('ecoEditorialStatus');
 dialog.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{mode=b.dataset.view;choose()}));
 byId('ecoEditorialClose').addEventListener('click',close);byId('ecoEditorialPrint').addEventListener('click',()=>{mode='preview';choose();window.setTimeout(()=>window.print(),100)});
 byId('ecoEditorialExport').addEventListener('click',exportDraft);
 dialog.addEventListener('click',e=>{if(e.target===dialog)close()});dialog.addEventListener('keydown',e=>{if(e.key==='Escape')close();if(e.key==='Tab')trap(e)});
}
function trap(e){const nodes=[...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled])')].filter(el=>el.getClientRects().length);if(!nodes.length)return;if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1).focus()}else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0].focus()}}
async function open(){
 create();previousFocus=document.activeElement;dialog.hidden=false;document.body.classList.add('eco-editorial-open-body');
 state=read();version=0;serverReady=false;dirty=false;
 status.textContent='Cargando…';
 try{
  const [chapR,draftR]=await Promise.all([
   fetch('/api/chapters',{credentials:'same-origin'}),
   fetch('/api/book-editor/draft',{credentials:'same-origin'})
  ]);
  if(!chapR.ok)throw Error(chapR.status===401?'Inicia sesión para acceder a tus capítulos.':'No se pudieron cargar los capítulos.');
  const chapData=await chapR.json();chapters=Array.isArray(chapData.chapters)?chapData.chapters:[];
  activeId=String(ordered()[0]?.id||'');
  if(draftR.ok){
   const dd=await draftR.json();
   if(dd.draft&&typeof dd.draft==='object'){
    state={...fresh(),...dd.draft,edits:typeof dd.draft.edits==='object'&&dd.draft.edits?dd.draft.edits:{},order:Array.isArray(dd.draft.order)?dd.draft.order:[]};
    try{localStorage.setItem(KEY,JSON.stringify(state))}catch{}
   }
   version=dd.version||0;serverReady=true;
   status.textContent='Borrador cargado desde tu cuenta.';
  }else{
   serverReady=false;status.textContent='Borrador local; no sincronizado entre dispositivos.';
  }
 }catch(e){chapters=[];serverReady=false;status.textContent=e.message;}
 mode='cover';choose();byId('ecoEditorialClose').focus();}
function close(){
 flush();
 dialog.hidden=true;document.body.classList.remove('eco-editorial-open-body');
 (previousFocus?.isConnected?previousFocus:byId('ecoEditorialOpen'))?.focus();}
function field(label,val,fn,multi=false){const wrap=node('label','eco-editorial-field');wrap.appendChild(node('span','',label));const input=node(multi?'textarea':'input');if(multi)input.rows=6;input.value=val;input.addEventListener('input',()=>fn(input.value));wrap.appendChild(input);return wrap}
function choose(){dialog.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('selected',b.dataset.view===mode));form.replaceChildren();
 if(mode==='cover'){form.append(field('Título de tu libro',state.title,v=>saveField('title',v)),field('Subtítulo',state.subtitle,v=>saveField('subtitle',v)),field('Dedicatoria',state.dedication,v=>saveField('dedication',v),true));}
 if(mode==='index'){form.appendChild(node('h3','','Organiza los capítulos'));if(!chapters.length)form.appendChild(node('p','','Genera capítulos primero desde Mi libro.'));
 const order=getOrder();order.forEach((id,i)=>{const c=chapters.find(x=>String(x.id)===id);if(!c)return;const row=node('div','eco-editorial-order');row.appendChild(node('span','',`${i+1}. ${entry(c).title||c.title||'Sin título'}`));for(const [delta,symbol,title] of [[-1,'↑','Subir'],[1,'↓','Bajar']]){const b=node('button','',symbol);b.type='button';b.title=title;b.setAttribute('aria-label',`${title} ${c.title}`);b.disabled=i+delta<0||i+delta>=order.length;b.addEventListener('click',()=>{const a=[...order];[a[i],a[i+delta]]=[a[i+delta],a[i]];state.order=a;persist();choose()});row.appendChild(b)}form.appendChild(row)})}
 if(mode==='chapter'){const select=node('select');select.setAttribute('aria-label','Seleccionar capítulo');ordered().forEach(c=>select.add(new Option(entry(c).title||c.title||'Sin título',String(c.id))));if(activeId&&!ordered().some(c=>String(c.id)===activeId))activeId=String(ordered()[0]?.id||'');select.value=activeId;select.addEventListener('change',()=>{activeId=select.value;choose()});form.appendChild(select);const c=chapters.find(x=>String(x.id)===activeId);if(c){const ed=entry(c);form.append(field('Título del capítulo',ed.title??plain(c.title),v=>edit(c,'title',v)),field('Texto del capítulo',ed.text??plain(c.generated_text),v=>edit(c,'text',v),true));form.appendChild(node('p','eco-editorial-hint','Estos cambios forman parte del borrador editorial, no reemplazan el capítulo original.'))}else form.appendChild(node('p','','Todavía no hay capítulos para editar.'))}
 if(mode==='preview')form.append(node('p','eco-editorial-hint','Vista completa del borrador, lista para revisar. Para la impresión definitiva todavía falta validar el tamaño, los saltos de página y las fotografías.'));
 drawBook()}
function edit(c,k,v){state.edits[String(c.id)]={...entry(c),[k]:v};persist();drawBook()}
function page(){return node('article','eco-editorial-page')}
function drawBook(){book.replaceChildren();const cover=page();cover.classList.add('eco-editorial-cover');cover.append(node('div','eco-editorial-cover-brand','ECO · BITÁCORA VIVA'),node('h1','',state.title||'Mi historia familiar'),node('p','',state.subtitle||''),node('span','eco-editorial-cover-mark','✦'));book.appendChild(cover);
 if(state.dedication?.trim()){const d=page();d.append(node('small','','DEDICATORIA'),node('p','eco-editorial-dedication',state.dedication));book.appendChild(d)}
 const index=page();index.appendChild(node('h2','','Contenido'));ordered().forEach((c,i)=>index.appendChild(node('p','eco-editorial-indexrow',`${String(i+1).padStart(2,'0')}   ${entry(c).title??c.title??'Capítulo'}`)));if(!chapters.length)index.appendChild(node('p','','Los capítulos aparecerán aquí cuando los generes.'));book.appendChild(index);
 ordered().forEach((c,i)=>{const p=page();p.append(node('small','',`CAPÍTULO ${String(i+1).padStart(2,'0')}`),node('h2','',entry(c).title??c.title??'Capítulo'));const txt=entry(c).text??c.generated_text??'';String(txt).split(/\n\s*\n/).filter(Boolean).forEach(part=>p.appendChild(node('p','eco-editorial-paragraph',part)));book.appendChild(p)})}
function exportDraft(){
 flush();
 const exportObject={format:'eco-editorial-borrador-v1',saved_at:new Date().toISOString(),book:state,chapters:chapters.map(c=>({id:c.id,original_title:c.title}))};const blob=new Blob([JSON.stringify(exportObject,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=node('a');a.href=url;a.download='ECO-mi-libro-borrador.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);status.textContent='Borrador exportado. Guárdalo como copia de seguridad.';}
window.addEventListener('pagehide',()=>{flush();});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
