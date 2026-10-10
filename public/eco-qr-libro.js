/* Botón del editor existente: prepara QR privado para el capítulo seleccionado. */
(()=>{
 function init(){
  const overlay=document.querySelector('#ecoStudioOverlay');
  if(!overlay||overlay.dataset.ecoQr)return;
  overlay.dataset.ecoQr='1';
  const bar=overlay.querySelector('.eco-studio-topbar');
  const print=overlay.querySelector('#ecoStudioPrint');
  const select=overlay.querySelector('#ecoStudioChapterSel');
  const paper=overlay.querySelector('#ecoStudioPaper');
  if(!bar||!print||!select||!paper)return;
  const btn=document.createElement('button');btn.type='button';btn.id='ecoMakeQr';btn.textContent='Crear QR de voz';btn.className='eco-studio-print';bar.insertBefore(btn,print);
  let selectedId=null,details=null,working=false;
  const sync=()=>{
   const prev=paper.querySelector('#ecoBookQrFoot');if(prev)return;
   if(!details||selectedId!==select.value)return;
   const foot=document.createElement('aside');foot.id='ecoBookQrFoot';foot.className='eco-book-qr-foot';
   const img=document.createElement('img');img.src='/api/book-qr/image/'+details.token+'.svg';img.width=125;img.height=125;img.alt='Código QR para escuchar el capítulo';
   const txt=document.createElement('div');const h=document.createElement('strong');h.textContent='Escucha la voz original';
   const p=document.createElement('p');p.textContent='Escanea el QR para escuchar esta historia en ECO. Requiere acceso a la bitácora.';
   txt.append(h,p);foot.append(img,txt);paper.append(foot);
  };
  new MutationObserver(()=>{if(!working && !paper.querySelector('#ecoBookQrFoot'))sync()}).observe(paper,{childList:true});
  select.addEventListener('change',()=>{details=null;selectedId=null});
  btn.addEventListener('click',async()=>{
    const id=select.value;if(!/^\d+$/.test(id)){alert('Primero elige un capítulo.');return}
    btn.disabled=true;btn.textContent='Preparando QR…';
    try{
     const r=await fetch('/api/book-qr/chapters/'+id,{method:'POST',credentials:'same-origin'});
     const d=await r.json();if(!r.ok)throw Error(d.error||'No se pudo crear el QR');
     details=d;selectedId=id;working=true;sync();working=false;
     btn.textContent='QR agregado al PDF';
    }catch(e){alert(e.message);btn.textContent='Crear QR de voz'}finally{btn.disabled=false}
  });
 }
 const mo=new MutationObserver(init);mo.observe(document.documentElement,{childList:true,subtree:true});init();
})();
