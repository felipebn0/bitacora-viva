(async()=>{
 const t=new URLSearchParams(location.search).get('t');
 const box=document.querySelector('#audios'),title=document.querySelector('#titulo'),msg=document.querySelector('#mensaje');
 if(!t||!/^[a-f0-9]{48}$/.test(t)){title.textContent='Enlace inválido';msg.textContent='Revisa que hayas escaneado el código completo.';return;}
 try{
  // Público: no hace falta cuenta ni sesión para escuchar.
  const r=await fetch('/api/book-qr/listen/'+t,{cache:'no-store'});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(d.error||'No disponible');
  title.textContent=d.title||'Recuerdo familiar';box.replaceChildren();
  (d.audios||[]).forEach((u,i)=>{
   const q=(d.preguntas||[])[i];
   if(q){const p=document.createElement('p');p.className='eco-escuchar-pregunta';p.textContent=q;box.appendChild(p)}
   const a=document.createElement('audio');a.controls=true;a.preload='metadata';a.src=u;box.appendChild(a);
   // Si una grabación no carga (la conexión tardó, el servidor estaba dormido), se vuelve a intentar sola; si sigue fallando se avisa.
   const aviso=document.createElement('p');aviso.className='eco-escuchar-error';aviso.hidden=true;aviso.textContent='Esta grabación no cargó. Toca aquí para intentarlo de nuevo.';aviso.tabIndex=0;aviso.setAttribute('role','button');box.appendChild(aviso);
   let intentos=0;
   const reintentar=()=>{intentos++;aviso.hidden=true;a.src=u+(u.includes('?')?'&':'?')+'r='+intentos;a.load()};
   a.addEventListener('error',()=>{if(intentos<2)setTimeout(reintentar,1200*(intentos+1));else aviso.hidden=false});
   a.addEventListener('loadedmetadata',()=>{aviso.hidden=true});
   aviso.addEventListener('click',()=>{intentos=0;reintentar()});aviso.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();aviso.click()}})
  });
  // Solo suena una grabación a la vez: al darle play a una, se pausan las demás.
  box.addEventListener('play',e=>{if(e.target instanceof HTMLAudioElement)box.querySelectorAll('audio').forEach(x=>{if(x!==e.target)x.pause()})},true);
 if(!(d.audios||[]).length)msg.textContent='No hay grabaciones disponibles.';
 }catch(e){title.textContent='Recuerdo no disponible';msg.textContent=e.message}
})();
