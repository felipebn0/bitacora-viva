/* ECO · Estudio del libro. Funciona como un documento de Word: a la izquierda el índice del libro (portada, dedicatoria,
   contenido y capítulos) para recorrerlo, y a la derecha el libro mismo, que se edita directamente. Arriba: "Descargar PDF"
   (hoja A4) y "Descargar libro digital". No modifica las historias originales; lo que se edita queda en el borrador del libro. */
(()=>{'use strict';
const KEY='eco-editorial-borrador-v1';
let chapters=[],stories=[],state={},dialog,book,outline,status,previousFocus=null,primeraApertura=true;
const herramientasAbiertas=new Set();
const byId=id=>document.getElementById(id);
const node=(tag,cls,value)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(value!==undefined)e.textContent=value;return e};
const plain=t=>String(t||'');
function fresh(){return {title:'Mi historia familiar',subtitle:'Recuerdos para las próximas generaciones',dedication:'',order:[],edits:{},media:{},bookPhotos:{},qr:{},qrOff:{}}}
function read(){try{const x=JSON.parse(localStorage.getItem(KEY)||'null');if(x&&typeof x==='object'){return {...fresh(),...x,edits:typeof x.edits==='object'&&x.edits?x.edits:{},order:Array.isArray(x.order)?x.order:[]}}}catch{}return fresh()}
let version=0,saveTimer=null,saving=Promise.resolve(),dirty=false,serverReady=false;
function persist(){
 dirty=true;
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

// El botón "Diseñar mi libro" de la lista de capítulos abre el estudio; al entrar a Mi libro el estudio se abre solo
// (a menos que se haya vuelto a la lista a propósito: la dirección termina en #capitulos).
function init(){const orig=byId('ecoStudioLaunch');if(!orig||byId('ecoEditorialOpen'))return;
 const launch=node('button','eco-editorial-open','Diseñar mi libro');launch.id='ecoEditorialOpen';launch.type='button';orig.hidden=true;orig.insertAdjacentElement('afterend',launch);launch.addEventListener('click',()=>open());
 if(location.hash!=='#capitulos')open({auto:true});
}
function create(){if(dialog)return;
 dialog=node('div','eco-editorial-overlay');dialog.id='ecoEditorialDialog';dialog.hidden=true;
 dialog.innerHTML=`<div class="eco-editorial-shell" role="dialog" aria-modal="true" aria-labelledby="ecoEditorialTitle">
 <div class="eco-editorial-top"><div class="eco-editorial-heading"><small>ECO · MI LIBRO</small><h2 id="ecoEditorialTitle">Mi libro</h2><p id="ecoEditorialStatus" role="status" aria-live="polite"></p></div>
 <div class="eco-editorial-topbuttons"><button id="ecoEditorialIndexToggle" type="button" class="eco-outline-toggle" aria-expanded="false">☰ Índice</button><button id="ecoEditorialPdf" type="button" class="eco-primary">Descargar PDF</button><button id="ecoEditorialDigital" type="button" class="eco-primary">Descargar libro digital</button><button id="ecoEditorialClose" type="button">Capítulos y audios</button></div></div>
 <div class="eco-editorial-layout"><aside class="eco-editorial-sidebar"><nav id="ecoEditorialOutline" aria-label="Índice del libro"></nav></aside>
 <section class="eco-editorial-preview" aria-label="Libro"><div id="ecoEditorialBook" class="eco-editorial-pages"></div></section></div></div>`;
 document.body.appendChild(dialog);book=byId('ecoEditorialBook');outline=byId('ecoEditorialOutline');status=byId('ecoEditorialStatus');
 byId('ecoEditorialClose').addEventListener('click',close);
 byId('ecoEditorialPdf').addEventListener('click',descargarPdf);
 byId('ecoEditorialDigital').addEventListener('click',descargarDigital);
 byId('ecoEditorialIndexToggle').addEventListener('click',()=>alternarIndice());
 dialog.addEventListener('keydown',e=>{if(e.key==='Escape'&&dialog.classList.contains('eco-outline-abierto'))alternarIndice(false);if(e.key==='Tab')trap(e)});
 byId('ecoEditorialBook').parentElement.addEventListener('scroll',marcarSeccionActual,{passive:true});
}
function alternarIndice(abrir){const v=abrir===undefined?!dialog.classList.contains('eco-outline-abierto'):abrir;dialog.classList.toggle('eco-outline-abierto',v);byId('ecoEditorialIndexToggle').setAttribute('aria-expanded',String(v))}
function trap(e){const nodes=[...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),summary,[contenteditable="plaintext-only"],[contenteditable="true"]')].filter(el=>el.getClientRects().length);if(!nodes.length)return;if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1).focus()}else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0].focus()}}
async function open({auto=false}={}){create();previousFocus=document.activeElement;dialog.hidden=false;document.body.classList.add('eco-editorial-open-body');
 if(location.hash==='#capitulos')history.replaceState(null,'',location.pathname+location.search);
 state=fresh();serverReady=false;status.textContent='Cargando libro guardado…';
 try{
 const [r,dr,sr]=await Promise.all([fetch('/api/chapters',{credentials:'same-origin'}),fetch('/api/book-editor/draft',{credentials:'same-origin'}),fetch('/api/story-log',{credentials:'same-origin'})]);
 if(!r.ok||!dr.ok||!sr.ok)throw Error((r.status===401||dr.status===401)?'Inicia sesión para acceder a tu libro.':'No se pudo conectar con el guardado de ECO.');
 const [data,draft,storyData]=await Promise.all([r.json(),dr.json(),sr.json()]);stories=Array.isArray(storyData.stories)?storyData.stories:[];
 chapters=Array.isArray(data.chapters)?data.chapters:[];
 state={...fresh(),...(draft.book||{}),edits:draft.book?.edits||{},order:Array.isArray(draft.book?.order)?draft.book.order:[],media:draft.book?.media||{},bookPhotos:draft.book?.bookPhotos||{},qr:draft.book?.qr||{},qrOff:draft.book?.qrOff||{}};
 version=draft.version||0;serverReady=true;dirty=false;
 status.textContent='Libro sincronizado con tu cuenta ECO ✓';
 autoQr();
 }catch(e){chapters=[];state=read();status.textContent=e.message+' Se cargó el respaldo local cuando estaba disponible.'}
 // Sin capítulos todavía no hay nada que diseñar: si el estudio se abrió solo, se muestra la lista, donde se generan.
 if(auto&&primeraApertura&&!chapters.length&&serverReady){primeraApertura=false;cerrarSinGuardar();return}
 primeraApertura=false;
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
function cerrarSinGuardar(){dialog.hidden=true;document.body.classList.remove('eco-editorial-open-body');history.replaceState(null,'',location.pathname+location.search+'#capitulos')}
function close(){flush();alternarIndice(false);dialog.hidden=true;document.body.classList.remove('eco-editorial-open-body');history.replaceState(null,'',location.pathname+location.search+'#capitulos');(previousFocus?.isConnected&&previousFocus!==document.body?previousFocus:byId('ecoEditorialOpen'))?.focus()}

/* ── Descargas ─────────────────────────────────────────────────────────────── */
async function esperarImagenes(){
 const imgs=[...book.querySelectorAll('img')];
 await Promise.all(imgs.map(im=>im.complete?null:Promise.race([new Promise(ok=>{im.addEventListener('load',ok,{once:true});im.addEventListener('error',ok,{once:true})}),new Promise(ok=>setTimeout(ok,5000))])));
}
async function descargarPdf(){
 const btn=byId('ecoEditorialPdf'),texto=btn.textContent;
 if(!chapters.length){status.textContent='Todavía no tienes capítulos. Genera tus capítulos primero y luego descarga tu libro.';return}
 btn.disabled=true;
 try{
  if(window.EcoLibroCompra&&!(await window.EcoLibroCompra.asegurar())){status.textContent='Para descargar el PDF primero hay que completar la compra de prueba.';return}
  btn.textContent='Preparando…';
  document.activeElement?.blur?.();
  await flush();
  await esperarImagenes();
  status.textContent='Se abrió la ventana de impresión: elige «Guardar como PDF» (la hoja ya está en tamaño A4).';
  window.print();
 }finally{btn.disabled=false;btn.textContent=texto}
}
async function descargarDigital(){
 const btn=byId('ecoEditorialDigital');
 if(!window.EcoLibroDigital){status.textContent='No se pudo preparar el libro digital. Recarga la página e intenta de nuevo.';return}
 await flush();
 await window.EcoLibroDigital.exportar({boton:btn,aviso:(t,error)=>{status.textContent=t||'';status.classList.toggle('eco-editorial-status-error',!!error)}});
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
 p.append(node('small','',`CAPÍTULO ${String(i+1).padStart(2,'0')}`),h2);
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
  vacio.append(node('h2','','Todavía no tienes capítulos'),node('p','','Los capítulos se arman con las historias que cuentas en las charlas. Genera tus capítulos desde «Capítulos y audios» y vuelve aquí para diseñar tu libro.'));
  const ir=node('button','eco-editorial-makeqr','Ir a Capítulos y audios');ir.type='button';ir.addEventListener('click',close);vacio.appendChild(ir);
  book.appendChild(vacio);
 }
}

/* ── Fotos y voz de cada capítulo (debajo del capítulo; no se imprime) ─────── */
function photoOptions(c){return window.EcoLibroFotos.opciones(c,state,stories)}
function herramientas(c){
 const id=String(c.id);
 const caja=node('details','eco-editorial-tools');caja.open=herramientasAbiertas.has(id);
 caja.addEventListener('toggle',()=>{if(caja.open)herramientasAbiertas.add(id);else herramientasAbiertas.delete(id)});
 caja.contentEditable='false';
 caja.appendChild(node('summary','','Fotos y voz de este capítulo'));
 const cuerpo=node('div','eco-editorial-tools-body');caja.appendChild(cuerpo);
 const volver=()=>{herramientasAbiertas.add(id);redibujarCapitulo(c);const nuevo=book.querySelector(`[data-sec="ch-${CSS.escape(id)}"] details.eco-editorial-tools`);if(nuevo)nuevo.open=true};
 cuerpo.appendChild(node('p','eco-editorial-hint','Sube fotografías a este capítulo. La primera va arriba a la derecha, dentro del texto, y el texto la rodea; las demás se reparten en el capítulo. Puedes cambiar el pie de foto. Se guardan en tu cuenta ECO.'));
 const uploader=node('input','eco-editorial-upload-input');uploader.type='file';uploader.accept='image/jpeg,image/png,image/webp';uploader.multiple=true;uploader.id='ecoEditorialUpload-'+id;
 const uploadLabel=node('label','eco-editorial-upload-label','＋ Subir fotografías');uploadLabel.htmlFor=uploader.id;
 const note=node('p','eco-editorial-hint','Hasta 3 MB por foto (JPG, PNG o WebP). Puedes elegir varias.');
 cuerpo.append(uploadLabel,uploader,note);
 uploader.addEventListener('change',async()=>{
  const files=Array.from(uploader.files||[]).slice(0,12);uploader.value='';if(!files.length)return;
  uploadLabel.textContent='Subiendo fotografías…';uploader.disabled=true;
  let count=0,failed=[];
  for(const file of files){
   if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>3*1024*1024){failed.push(file.name+' (formato o tamaño)');continue}
   try{const r=await fetch('/api/book-editor/photo',{method:'POST',headers:{'Content-Type':file.type},credentials:'same-origin',body:file});
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
  wrap.appendChild(controls);cuerpo.appendChild(wrap);
 }
 cuerpo.appendChild(node('h3','','Escucha este recuerdo'));
 const qr=state.qr?.[id];if(qr?.token){const a=node('a','eco-editorial-qr-link','Probar enlace de escucha ↗');a.href=qr.url;a.target='_blank';a.rel='noopener noreferrer';cuerpo.appendChild(a)}
 const msg=node('p','eco-editorial-hint','Cualquier persona que escanee este QR podrá escuchar las grabaciones originales de este capítulo, sin necesidad de cuenta. Puedes retirar el enlace cuando quieras.');
 // Sin QR (se retiró o no se pudo crear solo): botón para crearlo. Con QR ya no hay nada que "comprobar".
 if(!qr?.token){
  const btn=node('button','eco-editorial-makeqr','Crear QR de voz');btn.type='button';
  btn.addEventListener('click',async()=>{btn.disabled=true;msg.textContent='Preparando enlace de voz…';try{const r=await fetch('/api/book-qr/chapters/'+encodeURIComponent(c.id),{method:'POST',credentials:'same-origin'});const d=await r.json();if(!r.ok)throw Error(d.error||'No se pudo generar el QR');
   state.qr??={};state.qr[id]={token:d.token,url:d.url};if(state.qrOff)delete state.qrOff[id];persist();volver();}catch(e){msg.textContent=e.message}finally{btn.disabled=false}});
  cuerpo.appendChild(btn);
 }
 cuerpo.appendChild(msg);
 if(qr?.token){const quitar=node('button','eco-editorial-revokeqr','Retirar el enlace del QR');quitar.type='button';
  quitar.addEventListener('click',async()=>{if(!confirm('Los códigos QR ya impresos de este capítulo dejarán de funcionar. ¿Retirar el enlace?'))return;quitar.disabled=true;
   try{const r=await fetch('/api/book-qr/chapters/'+encodeURIComponent(c.id),{method:'DELETE',credentials:'same-origin'});if(!r.ok)throw Error('No se pudo retirar el enlace.');delete state.qr[id];state.qrOff={...(state.qrOff||{}),[id]:true};persist();volver();}catch(e){msg.textContent=e.message;quitar.disabled=false}});
  cuerpo.append(quitar)}
 return caja;
}
window.addEventListener('pagehide',()=>{if(dirty&&serverReady)flush()});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
