/* ECO · Estudio del libro. Funciona como un documento de Word: a la izquierda el índice del libro (portada, dedicatoria,
   contenido y capítulos) para recorrerlo, y a la derecha el libro mismo, que se edita directamente. Arriba: "Descargar PDF"
   (hoja A4) y "Compartir libro digital". No modifica las historias originales; lo que se edita queda en el borrador del libro. */
(()=>{'use strict';
const KEY='eco-editorial-borrador-v1';
let chapters=[],stories=[],state={},dialog,book,outline,status;
const herramientasAbiertas=new Set();
const byId=id=>document.getElementById(id);
const node=(tag,cls,value)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(value!==undefined)e.textContent=value;return e};
const plain=t=>String(t||'');
function fresh(){const en=document.documentElement.lang==='en';return {title:en?'My family story':'Mi historia familiar',subtitle:en?'Memories for the generations to come':'Recuerdos para las próximas generaciones',dedication:'',order:[],edits:{},media:{},bookPhotos:{},qr:{},qrOff:{}}}
function read(){try{const x=JSON.parse(localStorage.getItem(KEY)||'null');if(x&&typeof x==='object'){return {...fresh(),...x,edits:typeof x.edits==='object'&&x.edits?x.edits:{},order:Array.isArray(x.order)?x.order:[]}}}catch{}return fresh()}
let version=0,saveTimer=null,saving=Promise.resolve(),dirty=false,serverReady=false,enlaceActivo=false,enlaceTimer=null,enlaceEnCurso=false;
function persist(){
 dirty=true;
 programarEnlace();
 try{localStorage.setItem(KEY,JSON.stringify(state))}catch{}
 if(!serverReady){status.textContent='Sin conexión con el guardado en ECO. Descarga una copia de respaldo.';return}
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
   if(r.status===409){serverReady=false;dirty=true;status.textContent='Hay una versión más nueva en otro dispositivo. Recarga la página para verla.';return}
   if(!r.ok)throw Error(d.error||'No se pudieron guardar los cambios.');
   version=d.version;
   status.textContent=dirty?'Hay nuevos cambios pendientes…':'Guardado en tu cuenta ECO ✓';
 }).catch(e=>{dirty=true;status.textContent='No se guardó en ECO: '+e.message});
 return saving;
}
function getOrder(){const ids=chapters.map(c=>String(c.id));return [...state.order.filter(x=>ids.includes(String(x))).map(String),...ids.filter(x=>!state.order.includes(x))]}
function ordered(){return getOrder().map(id=>chapters.find(c=>String(c.id)===id)).filter(Boolean)}
function entry(c){return state.edits[String(c.id)]||{}}
const tituloDe=c=>entry(c).title??c.title??'Capítulo';
const textoDe=c=>String(entry(c).text??c.generated_text??'');
function edit(c,k,v){state.edits[String(c.id)]={...entry(c),[k]:v};persist()}

// Mi libro es este estudio: al entrar a la página se abre solo.
function init(){if(byId('ecoEditorialDialog'))return;open()}
function create(){if(dialog)return;
 dialog=node('div','eco-editorial-overlay');dialog.id='ecoEditorialDialog';dialog.hidden=true;
 dialog.innerHTML=`<div class="eco-editorial-shell" role="dialog" aria-modal="true" aria-labelledby="ecoEditorialTitle">
 <div class="eco-editorial-top"><div class="eco-editorial-heading"><small>ECO · MI LIBRO</small><h2 id="ecoEditorialTitle">Mi libro</h2><p id="ecoEditorialStatus" role="status" aria-live="polite"></p></div>
 <div class="eco-editorial-topbuttons"><button id="ecoEditorialIndexToggle" type="button" class="eco-outline-toggle" aria-expanded="false">☰ Índice</button><button id="ecoEditorialPdf" type="button" class="eco-primary">Descargar PDF</button><button id="ecoEditorialDigital" type="button" class="eco-primary">Compartir libro digital</button><a id="ecoEditorialBack" class="eco-editorial-back" href="/app.html">← Volver a la bitácora</a></div></div>
 <div class="eco-editorial-layout"><aside class="eco-editorial-sidebar"><nav id="ecoEditorialOutline" aria-label="Índice del libro"></nav>
 <div class="eco-outline-update"><label for="ecoEditorialVoz">Voz del libro</label><select id="ecoEditorialVoz"><option value="tercera">tercera persona («contó que…»)</option><option value="primera">primera persona («yo conté…»)</option></select><button id="ecoEditorialUpdate" type="button">Actualizar libro</button><p class="eco-editorial-hint">Vuelve a escribir los capítulos con tus historias más recientes. Se pierden los cambios que hiciste a los capítulos.</p></div>
 <div class="eco-outline-share" id="ecoEditorialShare" hidden><label for="ecoEditorialShareUrl">Enlace de tu libro</label><div class="eco-share-box" id="ecoEditorialShareBox"><input id="ecoEditorialShareUrl" type="text" readonly aria-label="Enlace para compartir tu libro"><button id="ecoEditorialShareCopy" type="button">Copiar enlace</button><button id="ecoEditorialShareSend" type="button" hidden>Compartir…</button><button id="ecoEditorialShareRefresh" type="button">Actualizar ahora</button><button id="ecoEditorialShareStop" type="button" class="eco-share-stop">Dejar de compartir</button></div><p class="eco-editorial-hint">Cualquiera que tenga este enlace ve tu libro y oye los audios, en el celular o el computador, sin cuenta. Se actualiza solo cuando cambias tu libro.</p></div></aside>
 <section class="eco-editorial-preview" aria-label="Libro"><div id="ecoEditorialBook" class="eco-editorial-pages"></div></section></div></div>`;
 document.body.appendChild(dialog);book=byId('ecoEditorialBook');outline=byId('ecoEditorialOutline');status=byId('ecoEditorialStatus');
 byId('ecoEditorialUpdate').addEventListener('click',actualizarLibro);
 byId('ecoEditorialShareCopy').addEventListener('click',copiarEnlace);
 byId('ecoEditorialShareSend').addEventListener('click',compartirEnlace);
 byId('ecoEditorialShareStop').addEventListener('click',dejarDeCompartir);
 byId('ecoEditorialShareRefresh').addEventListener('click',()=>prepararEnlace(byId('ecoEditorialShareRefresh'),'Actualizando…'));
 byId('ecoEditorialShareUrl').addEventListener('focus',e=>e.target.select());
 if(navigator.share)byId('ecoEditorialShareSend').hidden=false;
 byId('ecoEditorialPdf').addEventListener('click',descargarPdf);
 byId('ecoEditorialDigital').addEventListener('click',compartirEnLinea);
 byId('ecoEditorialIndexToggle').addEventListener('click',()=>alternarIndice());
 dialog.addEventListener('keydown',e=>{if(e.key==='Escape'&&dialog.classList.contains('eco-outline-abierto'))alternarIndice(false);if(e.key==='Tab')trap(e)});
 byId('ecoEditorialBook').parentElement.addEventListener('scroll',marcarSeccionActual,{passive:true});
}
function alternarIndice(abrir){const v=abrir===undefined?!dialog.classList.contains('eco-outline-abierto'):abrir;dialog.classList.toggle('eco-outline-abierto',v);byId('ecoEditorialIndexToggle').setAttribute('aria-expanded',String(v))}
function trap(e){const nodes=[...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),summary,[contenteditable="plaintext-only"],[contenteditable="true"]')].filter(el=>el.getClientRects().length);if(!nodes.length)return;if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1).focus()}else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0].focus()}}
async function open(){create();dialog.hidden=false;document.body.classList.add('eco-editorial-open-body');
 state=fresh();serverReady=false;status.textContent='Cargando libro guardado…';
 try{
 const [r,dr,sr]=await Promise.all([fetch('/api/chapters',{credentials:'same-origin'}),fetch('/api/book-editor/draft',{credentials:'same-origin'}),fetch('/api/story-log',{credentials:'same-origin'})]);
 if(!r.ok||!dr.ok||!sr.ok)throw Error((r.status===401||dr.status===401)?'Inicia sesión para acceder a tu libro.':'No se pudo conectar con el guardado de ECO.');
 const [data,draft,storyData]=await Promise.all([r.json(),dr.json(),sr.json()]);stories=Array.isArray(storyData.stories)?storyData.stories:[];
 chapters=Array.isArray(data.chapters)?data.chapters:[];
 state={...fresh(),...(draft.book||{}),edits:draft.book?.edits||{},order:Array.isArray(draft.book?.order)?draft.book.order:[],media:draft.book?.media||{},bookPhotos:draft.book?.bookPhotos||{},qr:draft.book?.qr||{},qrOff:draft.book?.qrOff||{}};
 version=draft.version||0;serverReady=true;dirty=false;
 status.textContent='Libro sincronizado con tu cuenta ECO ✓';
 if(chapters[0]?.persona==='primera')byId('ecoEditorialVoz').value='primera';
 // PRI-01: no crear QR públicos automáticamente al abrir el editor.
 // El usuario puede crearlos manualmente cuando lo decida.
 consultarEnlace();
 }catch(e){chapters=[];state=read();status.textContent=e.message+' Se cargó el respaldo local cuando estaba disponible.'}
 drawBook();renderOutline();dialog.querySelector('.eco-editorial-preview').scrollTop=0;marcarSeccionActual();byId('ecoEditorialPdf').focus()}
// Por defecto, todos los capítulos que tienen grabaciones llevan su QR de voz; quien retiró uno a propósito
// (qrOff) no lo vuelve a recibir solo.
let autoQrEnCurso=false;
async function autoQr(){
 if(autoQrEnCurso)return;autoQrEnCurso=true;
 try{
  let cambio=false;
  for(const c of chapters){
   const id=String(c.id);
   if(!Array.isArray(c.audios)||!c.audios.length||state.qr?.[id]?.token||state.qrOff?.[id])continue;
   try{
    const r=await fetch('/api/book-qr/chapters/'+encodeURIComponent(c.id),{method:'POST',credentials:'same-origin'});
    const d=await r.json();
    if(!r.ok||!d.token||!d.url)continue;
    state.qr??={};state.qr[id]={token:d.token,url:d.url};cambio=true;
   }catch(e){/* ese capítulo queda sin QR; se puede crear a mano */}
  }
  if(cambio){persist();if(!dialog.hidden){drawBook();renderOutline()}}
 }finally{autoQrEnCurso=false}
}

/* ── Enlace para compartir el libro ────────────────────────────────────────── */
function mostrarEnlace(url){byId('ecoEditorialShareUrl').value=url||'';byId('ecoEditorialShare').hidden=!url;enlaceActivo=!!url}
// Si el enlace ya existe y la compra está hecha, solo se muestra: el enlace no cambia, así que no hay nada que volver a armar.
async function compartirEnLinea(){
 const btn=byId('ecoEditorialDigital');
 if(!window.EcoLibroDigital||!window.EcoLibroDigital.compartirEnLinea){status.textContent='No se pudo preparar el enlace. Recarga la página e intenta de nuevo.';return}
 if(!chapters.length){status.textContent='Todavía no tienes capítulos. Genera tus capítulos primero y luego comparte tu libro.';return}
 if(!(await pagado())){status.textContent='Para compartir el libro digital primero hay que completar la compra de prueba.';return}
 if(!enlaceActivo)await consultarEnlace();
 if(enlaceActivo){
  status.classList.remove('eco-editorial-status-error');
  alternarIndice(true);byId('ecoEditorialShareUrl').focus();
  status.textContent='Este es el enlace de tu libro (a la izquierda). Es siempre el mismo y se actualiza solo cuando cambias tu libro.';
  return;
 }
 await prepararEnlace(btn,'Preparando tu enlace…');
}
// Arma el libro y deja listo (o actualiza) el enlace. Es lo pesado: reduce fotos y convierte audios.
async function prepararEnlace(btn,textoOcupado){
 const texto=btn.textContent;
 status.classList.remove('eco-editorial-status-error');
 btn.disabled=true;btn.textContent=textoOcupado;
 try{
  await flush();
  const url=await window.EcoLibroDigital.compartirEnLinea({aviso:t=>{status.textContent=t}});
  if(!url)throw Error('No se pudo preparar el enlace. Intenta de nuevo.');
  mostrarEnlace(url);alternarIndice(true);status.textContent='Listo: copia el enlace de tu libro (a la izquierda) y mándalo. Se actualiza solo cuando cambias tu libro.';
 }catch(e){status.textContent=e.message;status.classList.add('eco-editorial-status-error')}
 finally{btn.disabled=false;btn.textContent=texto}
}
// Si el libro ya está en línea, cada cambio lo actualiza solo (unos segundos después del último cambio).
function programarEnlace(){
 if(!enlaceActivo)return;
 clearTimeout(enlaceTimer);
 enlaceTimer=setTimeout(async()=>{
  if(!enlaceActivo)return;
  if(enlaceEnCurso)return programarEnlace();
  enlaceEnCurso=true;
  try{await flush();if(await window.EcoLibroDigital.compartirEnLinea())status.textContent='Guardado ✓ El enlace de tu libro quedó al día.'}catch{/* se reintenta con el próximo cambio */}
  finally{enlaceEnCurso=false}
 },5000);
}
async function consultarEnlace(){
 try{const r=await fetch('/api/libro-compartido',{credentials:'same-origin'});const d=await r.json().catch(()=>({}));mostrarEnlace(r.ok&&d.activo?d.url:'')}catch{/* sin enlace a la vista */}
}
async function copiarEnlace(){
 const campo=byId('ecoEditorialShareUrl'),btn=byId('ecoEditorialShareCopy'),texto=btn.textContent;
 let copiado=false;
 try{await navigator.clipboard.writeText(campo.value);copiado=true}catch{campo.focus();campo.select();try{copiado=document.execCommand('copy')}catch{}}
 btn.textContent=copiado?'¡Copiado!':'Selecciona y copia el enlace';
 setTimeout(()=>{btn.textContent=texto},2200);
}
async function compartirEnlace(){
 try{await navigator.share({title:state.title||'Mi libro',text:'Mi libro de recuerdos, hecho con Eco',url:byId('ecoEditorialShareUrl').value})}catch{/* la persona cerró el menú de compartir */}
}
async function dejarDeCompartir(){
 if(!confirm('Quien tenga el enlace dejará de poder ver tu libro. ¿Dejar de compartir?'))return;
 try{const r=await fetch('/api/libro-compartido',{method:'DELETE',credentials:'same-origin'});if(!r.ok)throw Error();mostrarEnlace('');status.classList.remove('eco-editorial-status-error');status.textContent='Dejaste de compartir el libro: el enlace ya no abre.'}
 catch{status.textContent='No se pudo retirar el enlace. Intenta de nuevo.';status.classList.add('eco-editorial-status-error')}
}

/* ── Descargas ─────────────────────────────────────────────────────────────── */
async function descargarPdf(){
 const btn=byId('ecoEditorialPdf'),texto=btn.textContent;
 if(!chapters.length){status.textContent='Todavía no tienes capítulos. Genera tus capítulos primero y luego descarga tu libro.';return}
 if(!window.EcoLibroPdf||!window.EcoLibroDigital){status.textContent='No se pudo preparar el PDF. Recarga la página e intenta de nuevo.';return}
 btn.disabled=true;
 try{
  if(!(await pagar())){status.textContent='Para descargar el PDF primero hay que completar la compra de prueba.';return}
  btn.textContent='Preparando…';status.classList.remove('eco-editorial-status-error');
  status.textContent='Preparando tu PDF: reduciendo las fotos y armando las páginas…';
  document.activeElement?.blur?.();
  await flush();
  const datos=await window.EcoLibroDigital.armarDatos({conAudios:false});
  const r=await window.EcoLibroPdf.descargar(datos,state.qr||{});
  status.textContent='Listo: se descargó tu PDF en hoja A4 ('+(r.bytes/1048576).toFixed(1)+' MB).';
 }catch(e){status.textContent=e.message||'No se pudo preparar el PDF.';status.classList.add('eco-editorial-status-error')}
 finally{btn.disabled=false;btn.textContent=texto}
}
// El PDF muestra la pantalla de pago (compra de prueba) en cada descarga.
const pagar=async()=>!window.EcoLibroCompra||(await window.EcoLibroCompra.asegurar({siempre:true}));
// El enlace del libro solo pide la compra la primera vez: con la compra hecha no vuelve a mostrar la pantalla de pago.
const pagado=async()=>!window.EcoLibroCompra||(await window.EcoLibroCompra.asegurar());

/* ── Actualizar el libro y eliminar capítulos ──────────────────────────────── */
// Vuelve a escribir los capítulos con las historias más recientes. Los capítulos nuevos tienen otros números, así que lo que
// colgaba de los viejos (ediciones, orden, fotos y QR) se limpia; el título, el subtítulo y la dedicatoria se conservan.
async function actualizarLibro(){
 const btn=byId('ecoEditorialUpdate'),texto=btn.textContent;
 const hay=chapters.length>0;
 if(hay&&!confirm('Se volverán a escribir todos los capítulos con tus historias más recientes.\n\nSe pierden los cambios que hiciste a los capítulos (textos, orden y fotos). El título, el subtítulo y la dedicatoria se conservan.\n\n¿Actualizar el libro?'))return;
 btn.disabled=true;btn.textContent='Actualizando…';status.classList.remove('eco-editorial-status-error');
 status.textContent='Actualizando tu libro… puede tardar unos minutos, no cierres esta pestaña.';
 try{
  const r=await fetch('/api/chapters/generate',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({persona:byId('ecoEditorialVoz').value})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(r.status===401?'Tu sesión venció: recarga la página para volver a entrar.':(d.error||'No se pudo actualizar el libro.'));
  if(!(d.chapters&&d.chapters.length)){status.textContent=d.message||'No se pudo generar ningún capítulo todavía.';return}
  const rc=await fetch('/api/chapters',{credentials:'same-origin'});
  chapters=rc.ok?((await rc.json()).chapters||[]):d.chapters;
  state={...state,order:[],edits:{},media:{},bookPhotos:{},qr:{},qrOff:{}};
  herramientasAbiertas.clear();
  persist();drawBook();renderOutline();book.parentElement.scrollTop=0;
  status.textContent='Libro actualizado ✓ ('+chapters.length+(chapters.length===1?' capítulo)':' capítulos)');
 }catch(e){status.textContent=e.message;status.classList.add('eco-editorial-status-error')}
 finally{btn.disabled=false;btn.textContent=texto}
}
async function eliminarCapitulo(c){
 if(!confirm('¿Eliminar el capítulo «'+(tituloDe(c)||'Sin título')+'»? No se puede deshacer.'))return;
 const id=String(c.id);
 try{
  const r=await fetch('/api/chapters/'+encodeURIComponent(c.id),{method:'DELETE',credentials:'same-origin'});
  if(!r.ok)throw Error((await r.json().catch(()=>({}))).error||'No se pudo eliminar el capítulo.');
  chapters=chapters.filter(x=>String(x.id)!==id);
  state.order=state.order.filter(x=>String(x)!==id);
  for(const k of ['edits','media','bookPhotos','qr','qrOff'])if(state[k])delete state[k][id];
  herramientasAbiertas.delete(id);
  persist();drawBook();renderOutline();
 }catch(e){status.textContent=e.message;status.classList.add('eco-editorial-status-error')}
}

/* ── Índice de la izquierda ────────────────────────────────────────────────── */
function renderOutline(){
 outline.replaceChildren();
 const item=(sec,texto,cls)=>{const b=node('button','eco-outline-item'+(cls?' '+cls:''),texto);b.type='button';b.dataset.go=sec;b.addEventListener('click',()=>{irA(sec);alternarIndice(false)});return b};
 outline.append(item('cover','Portada'),item('dedication','Dedicatoria'),item('index','Contenido'));
 outline.appendChild(node('p','eco-outline-title','Capítulos'));
 if(!chapters.length)outline.appendChild(node('p','eco-outline-empty','Todavía no hay capítulos.'));
 const lista=ordered();
 lista.forEach((c,i)=>{
  const fila=node('div','eco-outline-row');
  const b=item('ch-'+c.id,'','eco-outline-chapter');
  b.append(node('span','eco-outline-n',String(i+1)),node('span','eco-outline-t',tituloDe(c)||'Sin título'));
  const mover=node('span','eco-outline-mover');
  for(const [delta,simbolo,titulo] of [[-1,'↑','Subir'],[1,'↓','Bajar']]){
   const m=node('button','',simbolo);m.type='button';m.title=titulo+' este capítulo';m.setAttribute('aria-label',`${titulo} el capítulo ${tituloDe(c)}`);m.disabled=i+delta<0||i+delta>=lista.length;
   m.addEventListener('click',()=>moverCapitulo(c,delta));mover.appendChild(m);
  }
  fila.append(b,mover);outline.appendChild(fila);
 });
 marcarSeccionActual();
}
function moverCapitulo(c,delta){
 const orden=getOrder(),i=orden.indexOf(String(c.id)),j=i+delta;
 if(i<0||j<0||j>=orden.length)return;
 [orden[i],orden[j]]=[orden[j],orden[i]];state.order=orden;persist();
 drawBook();renderOutline();irA('ch-'+c.id,false);
}
function irA(sec,suave=true){
 const destino=book.querySelector(`[data-sec="${CSS.escape(sec)}"]`);if(!destino)return;
 const panel=book.parentElement;
 panel.scrollTo({top:Math.max(0,destino.offsetTop-20),behavior:suave&&!matchMedia('(prefers-reduced-motion: reduce)').matches?'smooth':'auto'});
}
let espiaPendiente=false;
function marcarSeccionActual(){
 if(espiaPendiente||!book||!outline)return;espiaPendiente=true;
 requestAnimationFrame(()=>{
  espiaPendiente=false;
  const panel=book.parentElement,tope=panel.scrollTop+60;
  let actual=null;
  for(const p of book.querySelectorAll('[data-sec]')){if(p.offsetTop<=tope)actual=p.dataset.sec;else break}
  actual=actual||'cover';
  // Al llegar al final del libro queda marcada la última sección, aunque no alcance a subir hasta el borde de arriba.
  if(panel.scrollTop+panel.clientHeight>=panel.scrollHeight-4){const todas=book.querySelectorAll('[data-sec]');if(todas.length)actual=todas[todas.length-1].dataset.sec}
  outline.querySelectorAll('.eco-outline-item').forEach(b=>{const on=b.dataset.go===actual;b.classList.toggle('selected',on);if(on)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current')});
  const sel=outline.querySelector('.eco-outline-item.selected');
  if(sel&&!dialog.classList.contains('eco-outline-abierto')){const r=sel.getBoundingClientRect(),s=outline.parentElement.getBoundingClientRect();if(r.top<s.top||r.bottom>s.bottom)sel.scrollIntoView({block:'nearest'})}
 });
}

/* ── El libro (documento editable) ─────────────────────────────────────────── */
// Texto editable sin formato: lo que se escribe queda como texto simple. Enter deja una línea en blanco (así se separan
// los párrafos, igual que en el resto de Eco); al salir del texto el capítulo se vuelve a armar con sus párrafos y fotos.
function editable(el,{ph='',unaLinea=false,alCambiar}={}){
 try{el.contentEditable='plaintext-only'}catch{el.contentEditable='true'}
 el.spellcheck=true;el.lang='es';el.dataset.ph=ph;el.setAttribute('role','textbox');el.setAttribute('aria-multiline',String(!unaLinea));
 el.addEventListener('input',()=>alCambiar(el));
 el.addEventListener('keydown',e=>{
  if(e.key!=='Enter'||e.isComposing)return;
  e.preventDefault();
  if(!unaLinea)document.execCommand('insertText',false,'\n\n');
 });
 el.addEventListener('paste',e=>{e.preventDefault();const t=(e.clipboardData||window.clipboardData).getData('text/plain');document.execCommand('insertText',false,unaLinea?t.replace(/\s*\n\s*/g,' '):t)});
 return el;
}
const textoPlano=el=>el.innerText.replace(/\u00a0/g,' ').replace(/\n+$/,'');
function page(sec){const p=node('article','eco-editorial-page');if(sec)p.dataset.sec=sec;return p}
function paginaPortada(){
 const cover=page('cover');cover.classList.add('eco-editorial-cover');
 const h1=editable(node('h1','',state.title||''),{ph:'Título de tu libro',unaLinea:true,alCambiar:el=>{state.title=textoPlano(el);persist()}});
 const sub=editable(node('p','eco-editorial-subtitle',state.subtitle||''),{ph:'Subtítulo',unaLinea:true,alCambiar:el=>{state.subtitle=textoPlano(el);persist()}});
 cover.append(node('div','eco-editorial-cover-brand','ECO · BITÁCORA VIVA'),h1,sub,node('span','eco-editorial-cover-mark','✦'));
 return cover;
}
function paginaDedicatoria(){
 const d=page('dedication');
 const p=editable(node('p','eco-editorial-dedication',state.dedication||''),{ph:'Escribe aquí tu dedicatoria…',alCambiar:el=>{state.dedication=textoPlano(el);d.classList.toggle('eco-editorial-vacia',!state.dedication.trim());persist()}});
 d.append(node('small','','DEDICATORIA'),p);d.classList.toggle('eco-editorial-vacia',!(state.dedication||'').trim());
 return d;
}
function filasContenido(contenedor){
 contenedor.replaceChildren();
 ordered().forEach((c,i)=>{const f=node('p','eco-editorial-indexrow',`${String(i+1).padStart(2,'0')}   ${tituloDe(c)}`);f.tabIndex=0;f.setAttribute('role','link');f.addEventListener('click',()=>irA('ch-'+c.id));f.addEventListener('keydown',e=>{if(e.key==='Enter')irA('ch-'+c.id)});contenedor.appendChild(f)});
 if(!chapters.length)contenedor.appendChild(node('p','','Los capítulos aparecerán aquí cuando los generes.'));
}
function paginaContenido(){
 const index=page('index');index.appendChild(node('h2','','Contenido'));
 const filas=node('div','eco-editorial-indexrows');filasContenido(filas);index.appendChild(filas);
 return index;
}
function actualizarTitulosEnIndice(){
 const filas=book.querySelector('.eco-editorial-indexrows');if(filas)filasContenido(filas);
 outline.querySelectorAll('.eco-outline-chapter .eco-outline-t').forEach((t,i)=>{const c=ordered()[i];if(c)t.textContent=tituloDe(c)||'Sin título'});
}
function paginaCapitulo(c,i){
 const id=String(c.id),p=page('ch-'+id);p.dataset.chapterId=id;
 const h2=editable(node('h2','',tituloDe(c)),{ph:'Título del capítulo',unaLinea:true,alCambiar:el=>{edit(c,'title',textoPlano(el));actualizarTitulosEnIndice()}});
 const cabecera=node('div','eco-editorial-pagehead');
 const borrar=node('button','eco-editorial-delete','Eliminar capítulo');borrar.type='button';borrar.contentEditable='false';borrar.addEventListener('click',()=>eliminarCapitulo(c));
 cabecera.append(node('small','',`CAPÍTULO ${String(i+1).padStart(2,'0')}`),borrar);
 p.append(cabecera,h2);
 const cuerpo=node('div','eco-editorial-body');
 window.EcoLibroFotos.armarTexto(cuerpo,textoDe(c),window.EcoLibroFotos.incluidas(c,state,stories),'eco-editorial-paragraph');
 cuerpo.querySelectorAll('figure').forEach(f=>f.contentEditable='false');
 let pendiente=false;
 const guardarTexto=()=>{pendiente=true;edit(c,'text',[...cuerpo.querySelectorAll('p.eco-editorial-paragraph')].map(textoPlano).join('\n\n').replace(/\n{3,}/g,'\n\n'))};
 cuerpo.querySelectorAll('p.eco-editorial-paragraph').forEach(par=>editable(par,{alCambiar:guardarTexto}));
 if(!cuerpo.querySelector('p.eco-editorial-paragraph')){const par=editable(node('p','eco-editorial-paragraph',''),{ph:'Escribe aquí el texto del capítulo…',alCambiar:guardarTexto});cuerpo.insertBefore(par,cuerpo.querySelector('.eco-foto-fin'))}
 cuerpo.addEventListener('focusout',()=>setTimeout(()=>{if(pendiente&&!cuerpo.contains(document.activeElement)){pendiente=false;redibujarCapitulo(c)}},0));
 p.appendChild(cuerpo);
 const qr=state.qr?.[id];
 if(qr?.token&&/^[a-f0-9]{48}$/.test(qr.token)){
  const aside=node('div','eco-editorial-qr');aside.contentEditable='false';const image=node('img');image.src='/api/book-qr/image/'+qr.token+'.svg';image.alt='QR para escuchar la voz original';const line=node('div');line.append(node('strong','','Escucha la voz original'),node('p','','Escanea con tu teléfono para escuchar la grabación.'));aside.append(image,line);p.appendChild(aside);
 }
 p.appendChild(herramientas(c));
 return p;
}
function redibujarCapitulo(c){
 const viejo=book.querySelector(`[data-sec="ch-${CSS.escape(String(c.id))}"]`);if(!viejo)return;
 const i=ordered().findIndex(x=>String(x.id)===String(c.id));
 viejo.replaceWith(paginaCapitulo(c,i));
}
function drawBook(){
 book.replaceChildren();
 book.append(paginaPortada(),paginaDedicatoria(),paginaContenido());
 ordered().forEach((c,i)=>book.appendChild(paginaCapitulo(c,i)));
 if(!chapters.length){
  const vacio=page();vacio.classList.add('eco-editorial-sin-capitulos');
  vacio.append(node('h2','','Todavía no tienes capítulos'),node('p','','Los capítulos se arman con las historias que cuentas en las charlas. Cuando ya hayas contado algunas, toca «Actualizar libro» y aquí aparecerán para que los diseñes.'));
  const ir=node('button','eco-editorial-makeqr','Actualizar libro');ir.type='button';ir.addEventListener('click',actualizarLibro);vacio.appendChild(ir);
  book.appendChild(vacio);
 }
}

/* ── Fotos y voz de cada capítulo (debajo del capítulo; no se imprime) ─────── */
function photoOptions(c){return window.EcoLibroFotos.opciones(c,state,stories)}
// Las fotos del celular (sobre todo las de un iPhone Pro) pesan varios MB: se reducen aquí, antes de subirlas, a un máximo de
// 2000 px de lado y menos de ~2,8 MB, que es lo que acepta el libro. Una foto que ya es liviana se sube tal cual.
const FOTO_LADO_MAX=2000,FOTO_PESO_MAX=2.8*1024*1024;
async function reducirFoto(file){
 if(['image/jpeg','image/png','image/webp'].includes(file.type)&&file.size<=1.5*1024*1024)return file;
 let origen,ancho,alto,liberar=()=>{};
 try{origen=await createImageBitmap(file,{imageOrientation:'from-image'});ancho=origen.width;alto=origen.height;liberar=()=>origen.close&&origen.close()}
 catch{origen=await new Promise((ok,mal)=>{const url=URL.createObjectURL(file),im=new Image();im.onload=()=>{URL.revokeObjectURL(url);ok(im)};im.onerror=()=>{URL.revokeObjectURL(url);mal(Error('no se pudo leer'))};im.src=url});ancho=origen.naturalWidth;alto=origen.naturalHeight}
 let k=Math.min(1,FOTO_LADO_MAX/Math.max(ancho,alto)),calidad=.86,blob=null;
 const lienzo=document.createElement('canvas');
 for(let intento=0;intento<6;intento++){
  lienzo.width=Math.max(1,Math.round(ancho*k));lienzo.height=Math.max(1,Math.round(alto*k));
  const cx=lienzo.getContext('2d');cx.fillStyle='#fff';cx.fillRect(0,0,lienzo.width,lienzo.height);cx.drawImage(origen,0,0,lienzo.width,lienzo.height);
  blob=await new Promise(ok=>lienzo.toBlob(ok,'image/jpeg',calidad));
  if(blob&&blob.size<=FOTO_PESO_MAX)break;
  if(calidad>.6)calidad-=.1;else k*=.8;
 }
 liberar();
 if(!blob||blob.size>FOTO_PESO_MAX)throw Error('sigue pesando mucho');
 return blob;
}
function herramientas(c){
 const id=String(c.id);
 const caja=node('details','eco-editorial-tools');caja.open=herramientasAbiertas.has(id);
 caja.addEventListener('toggle',()=>{if(caja.open)herramientasAbiertas.add(id);else herramientasAbiertas.delete(id)});
 caja.contentEditable='false';
 caja.appendChild(node('summary','','Fotos y voz de este capítulo'));
 const cuerpo=node('div','eco-editorial-tools-body');caja.appendChild(cuerpo);
 const volver=()=>{herramientasAbiertas.add(id);redibujarCapitulo(c);const nuevo=book.querySelector(`[data-sec="ch-${CSS.escape(id)}"] details.eco-editorial-tools`);if(nuevo)nuevo.open=true};
 cuerpo.appendChild(node('p','eco-editorial-hint','Sube fotografías a este capítulo. La primera va arriba a la derecha, dentro del texto, y el texto la rodea; las demás se reparten en el capítulo. Puedes cambiar el pie de foto. Se guardan en tu cuenta ECO.'));
 const uploader=node('input','eco-editorial-upload-input');uploader.type='file';uploader.accept='image/*';uploader.multiple=true;uploader.id='ecoEditorialUpload-'+id;
 const uploadLabel=node('label','eco-editorial-upload-label','＋ Subir fotografías');uploadLabel.htmlFor=uploader.id;
 const note=node('p','eco-editorial-hint','Puedes elegir varias, directo del celular o del computador: las fotos grandes se reducen solas para que no pesen tanto.');
 cuerpo.append(uploadLabel,uploader,note);
 uploader.addEventListener('change',async()=>{
  const files=Array.from(uploader.files||[]).slice(0,12);uploader.value='';if(!files.length)return;
  uploadLabel.textContent='Preparando y subiendo fotografías…';uploader.disabled=true;
  let count=0,failed=[];
  for(const file of files){
   if(!file.type.startsWith('image/')){failed.push(file.name+' (no es una foto)');continue}
   try{const lista=await reducirFoto(file);
    const r=await fetch('/api/book-editor/photo',{method:'POST',headers:{'Content-Type':lista.type||'image/jpeg'},credentials:'same-origin',body:lista});
    const d=await r.json().catch(()=>({}));if(!r.ok||!d.url)throw Error(d.error||'No se pudo subir');
    state.bookPhotos??={};state.bookPhotos[id]??=[];
    if(!state.bookPhotos[id].some(p=>p.url===d.url))state.bookPhotos[id].push({url:d.url,caption:file.name.replace(/\.[^.]+$/,'').slice(0,180)});
    state.media??={};state.media[id]??={};state.media[id][d.url]={pos:'0',size:'full',caption:file.name.replace(/\.[^.]+$/,'').slice(0,180)};
    persist();count++;
   }catch(e){failed.push(file.name+' ('+e.message+')')}
  }
  uploadLabel.textContent='＋ Subir fotografías';uploader.disabled=false;
  if(count)volver();
  else if(failed.length)cuerpo.prepend(node('p','eco-editorial-hint','No se subieron: '+failed.join(', ')));
  if(count&&failed.length)book.querySelector(`[data-sec="ch-${CSS.escape(id)}"] .eco-editorial-tools-body`)?.prepend(node('p','eco-editorial-hint','No se subieron: '+failed.join(', ')));
 });
 const images=photoOptions(c),chosen=state.media?.[id]||{};
 if(!images.length)cuerpo.appendChild(node('p','eco-editorial-hint','Todavía no hay fotografías. Puedes subirlas aquí mismo.'));
 for(const img of images){const wrap=node('div','eco-editorial-photo-config');const thumb=node('img');thumb.src='/api/media-file?u='+encodeURIComponent(img.url);thumb.alt=img.caption||'Foto de la historia';thumb.loading='lazy';wrap.appendChild(thumb);
  const controls=node('div','eco-editorial-photo-fields');const label=node('label');const chk=node('input');chk.type='checkbox';chk.checked=chosen[img.url]?.pos!=='hide';label.append(chk,node('span','',' Incluir esta fotografía'));
  const caption=node('input');caption.setAttribute('aria-label','Pie de foto');caption.maxLength=180;caption.placeholder='Pie de foto';caption.value=chosen[img.url]?.caption??img.caption;
  const save=()=>{state.media??={};state.media[id]??={};state.media[id][img.url]={pos:chk.checked?'0':'hide',caption:caption.value,size:'medium'};persist()};
  chk.addEventListener('change',()=>{save();volver()});caption.addEventListener('input',save);caption.addEventListener('change',volver);controls.append(label,caption);
  if(img.uploaded){const remove=node('button','eco-editorial-remove-photo','Quitar del libro');remove.type='button';
   remove.addEventListener('click',()=>{if(!confirm('¿Quitar esta fotografía del libro? No se borrará de los archivos de ECO.'))return;
    state.bookPhotos[id]=state.bookPhotos[id].filter(x=>x.url!==img.url);
    if(state.media?.[id])delete state.media[id][img.url];persist();volver()});controls.appendChild(remove)}
  else if(chk.checked){const remove=node('button','eco-editorial-remove-photo','Quitar del libro');remove.type='button';
   remove.addEventListener('click',()=>{chk.checked=false;save();volver()});controls.appendChild(remove)}
  wrap.appendChild(controls);cuerpo.appendChild(wrap);
 }
 const grabaciones=(Array.isArray(c.audios)?c.audios:[]).filter(u=>typeof u==='string'&&/^https?:\/\//.test(u));
 if(grabaciones.length){
  cuerpo.appendChild(node('h3','',grabaciones.length===1?'Nota de voz original':'Notas de voz originales'));
  grabaciones.forEach((u,k)=>{const q=(c.preguntas||[])[k];if(typeof q==='string'&&q)cuerpo.appendChild(node('p','eco-editorial-pregunta',q));const au=node('audio');au.controls=true;au.preload='metadata';au.src='/api/media-file?u='+encodeURIComponent(u);cuerpo.appendChild(au)});
 }
 return caja;
}
// Solo suena una nota de voz a la vez.
document.addEventListener('play',e=>{if(e.target instanceof HTMLAudioElement&&dialog)dialog.querySelectorAll('audio').forEach(a=>{if(a!==e.target)a.pause()})},true);
window.addEventListener('pagehide',()=>{if(dirty&&serverReady)flush()});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
