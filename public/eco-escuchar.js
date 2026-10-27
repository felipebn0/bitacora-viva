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
   const a=document.createElement('audio');a.controls=true;a.preload='metadata';a.src=u;box.appendChild(a)
  });
  if(!(d.audios||[]).length)msg.textContent='No hay grabaciones disponibles.';
 }catch(e){title.textContent='Recuerdo no disponible';msg.textContent=e.message}
})();
