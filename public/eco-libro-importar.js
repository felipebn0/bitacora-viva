/* ECO · Importación de borradores. Complemento independiente: no modifica las historias. */
(()=>{'use strict';
 const $=id=>document.getElementById(id);
 let active=false;
 function install(){
   const dialog=$('ecoEditorialDialog');
   const bar=dialog?.querySelector('.eco-editorial-topbuttons');
   if(!bar||$('ecoEditorialImport'))return;
   const btn=document.createElement('button');btn.id='ecoEditorialImport';btn.type='button';btn.textContent='Importar borrador';
   const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.hidden=true;input.id='ecoEditorialImportFile';
   bar.insertBefore(btn,$('ecoEditorialExport'));bar.appendChild(input);
   const message=document.createElement('div');message.id='ecoEditorialImportNotice';message.setAttribute('role','status');message.className='eco-import-status';
   dialog.querySelector('.eco-editorial-top')?.insertAdjacentElement('afterend',message);
   btn.addEventListener('click',()=>{if(!active)input.click()});
   input.addEventListener('change',async()=>{
     const file=input.files?.[0];input.value='';if(!file)return;
     active=true;btn.disabled=true;message.textContent='Comprobando el borrador…';
     try{await importFile(file,message)}catch(e){message.textContent='No se importó: '+e.message}finally{active=false;btn.disabled=false}
   });
 }
 const isPlain=o=>o&&typeof o==='object'&&!Array.isArray(o);
 const str=(x,n)=>typeof x==='string'?x.slice(0,n):'';
 const validId=x=>/^[1-9]\d{0,11}$/.test(String(x));
 async function json(res){return await res.json().catch(()=>({}))}
 async function importFile(file,message){
  if(file.size>1200000)throw Error('El archivo supera el tamaño admitido (1,2 MB).');
  const raw=JSON.parse(await file.text());
  if(raw?.format!=='eco-editorial-borrador-v1'||!isPlain(raw.book)||!Array.isArray(raw.chapters))throw Error('No es un archivo de respaldo válido del Estudio Editorial ECO.');
  const candidate=raw.book;
  for(const key of ['title','subtitle','dedication'])if(candidate[key]!=null&&typeof candidate[key]!=='string')throw Error('Contenido de portada inválido.');
  for(const key of ['edits','media','bookPhotos','qr'])if(candidate[key]!=null&&!isPlain(candidate[key]))throw Error('Formato incorrecto: '+key);
  if(!Array.isArray(candidate.order||[]))throw Error('Índice inválido.');
  const [cr,dr]=await Promise.all([
    fetch('/api/chapters',{credentials:'same-origin'}),
    fetch('/api/book-editor/draft',{credentials:'same-origin'})
  ]);
  if(!cr.ok||!dr.ok)throw Error('No se pudo validar la cuenta ECO. Inicia sesión de nuevo.');
  const chapterData=await json(cr),draftData=await json(dr);
  const chapters=Array.isArray(chapterData.chapters)?chapterData.chapters:[];
  const current=new Map(chapters.map(c=>[String(c.id),c]));
  const exported=new Map();
  for(const c of raw.chapters){
   if(!isPlain(c)||!validId(c.id))throw Error('Referencia de capítulo inválida.');
   exported.set(String(c.id),str(c.original_title,300));
  }
  if(!exported.size||!chapters.length)throw Error('No hay capítulos compatibles para recuperar.');
  const references=new Set([...(candidate.order||[]).map(String),...Object.keys(candidate.edits||{}),...Object.keys(candidate.media||{}),...Object.keys(candidate.bookPhotos||{}),...Object.keys(candidate.qr||{})]);
  for(const id of references)if(!validId(id)||!exported.has(id)||!current.has(id)||String(current.get(id).title)!==exported.get(id))throw Error('El respaldo contiene capítulos diferentes de los de esta cuenta. No se reemplazó nada.');
  const edits={};
  for(const [id,v] of Object.entries(candidate.edits||{})){
   if(!isPlain(v))throw Error('Edición de capítulo inválida.');
   edits[id]={};
   if(v.title!==undefined)edits[id].title=str(v.title,200);
   if(v.text!==undefined)edits[id].text=str(v.text,120000);
  }
  const photos={},media={},qr={};
  const urls=[];
  for(const [id,items] of Object.entries(candidate.bookPhotos||{})){
   if(!current.has(id)||!Array.isArray(items)||items.length>60)throw Error('Lista de fotos inválida.');
   photos[id]=[];
   for(const item of items){
    if(!isPlain(item)||typeof item.url!=='string'||!/^https:\/\//.test(item.url))throw Error('Fotografía inválida.');
    photos[id].push({url:item.url,caption:str(item.caption,180)});
    urls.push(item.url);
   }
  }
  for(const [id,entries] of Object.entries(candidate.media||{})){
   if(!current.has(id)||!isPlain(entries)||Object.keys(entries).length>60)throw Error('Distribución de fotografías inválida.');
   media[id]={};
   for(const [url,o] of Object.entries(entries)){
    if(!/^https:\/\//.test(url)||!isPlain(o))throw Error('Ubicación de fotografía inválida.');
    media[id][url]={pos:o.pos==='hide'?'hide':/^\d{1,3}$/.test(String(o.pos))?String(o.pos):'0',size:['small','medium','full'].includes(o.size)?o.size:'full',caption:str(o.caption,180)};
    urls.push(url);
   }
  }
  const unique=[...new Set(urls)];
  if(unique.length>100)throw Error('Hay demasiadas fotografías para validar en un solo archivo.');
  message.textContent=`Comprobando acceso a ${unique.length} fotografías…`;
  // No trust paths from JSON: validate every asset against ECO authenticated media proxy.
  for(const url of unique){
   const r=await fetch('/api/media-file?u='+encodeURIComponent(url),{credentials:'same-origin',headers:{Range:'bytes=0-0'}});
   if(!r.ok||!String(r.headers.get('content-type')||'').startsWith('image/')){await r.body?.cancel().catch(()=>{});throw Error('Una fotografía no está disponible para esta cuenta. El borrador se conserva sin cambios.')}
   await r.body?.cancel().catch(()=>{});
  }
  for(const [id,q] of Object.entries(candidate.qr||{})){
   if(!current.has(id)||!isPlain(q)||!/^[a-f0-9]{48}$/.test(q.token||''))throw Error('QR inválido.');
   const r=await fetch('/api/book-qr/listen/'+q.token,{credentials:'same-origin'});
   if(!r.ok)throw Error('Un QR no está autorizado para esta cuenta. No se importó.');
   qr[id]={token:q.token,url:str(q.url,500)};
  }
  const book={
   title:str(candidate.title,200),subtitle:str(candidate.subtitle,300),dedication:str(candidate.dedication,4000),
   order:[...new Set((candidate.order||[]).map(String).filter(id=>current.has(id)))].slice(0,250),
   edits,media,bookPhotos:photos,qr
  };
  const details=`Título: ${book.title||'(sin título)'}\nCapítulos editados: ${Object.keys(edits).length}\nFotografías guardadas: ${unique.length}\nQR: ${Object.keys(qr).length}`;
  if(!confirm('Vas a restaurar este borrador en tu cuenta ECO:\n\n'+details+'\n\nREEMPLAZARÁ el diseño editorial actual, no las historias originales.\n\n¿Deseas continuar?')){message.textContent='Importación cancelada: no se modificó el libro.';return}
  const payload=JSON.stringify({book,version:draftData.version||0});
  const res=await fetch('/api/book-editor/draft',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:payload});
  if(!res.ok){const d=await json(res);throw Error(res.status===409?'Otra sesión cambió el libro. Recarga antes de importar.':d.error||'No se pudo guardar el archivo.')}
  message.textContent='Borrador importado y guardado en ECO. Recargando el estudio…';
  window.location.reload();
 }
 const observer=new MutationObserver(()=>install());
 function start(){observer.observe(document.body,{childList:true,subtree:true});install()}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
