(async()=>{
 const t=new URLSearchParams(location.search).get('t');
 const box=document.querySelector('#audios'),title=document.querySelector('#titulo'),msg=document.querySelector('#mensaje');
 if(!t||!/^[a-f0-9]{48}$/.test(t)){title.textContent='Enlace inválido';return;}
 try{
  const r=await fetch('/api/book-qr/listen/'+t,{credentials:'same-origin',cache:'no-store'});
  if(r.status===401){title.textContent='Inicia sesión para escuchar';msg.textContent='Este recuerdo es privado. Inicia sesión en ECO y vuelve a escanear el código QR.';return}
  const d=await r.json();if(!r.ok)throw Error(d.error||'No disponible');
  title.textContent=d.title||'Recuerdo familiar';box.replaceChildren();
  for(const u of d.audios||[]){const a=document.createElement('audio');a.controls=true;a.preload='none';a.src=u;box.appendChild(a)}
  if(!(d.audios||[]).length)msg.textContent='No hay grabaciones disponibles.';
 }catch(e){title.textContent='Recuerdo no disponible';msg.textContent=e.message}
})();
