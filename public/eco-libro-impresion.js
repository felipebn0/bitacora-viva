/* ECO · Fase 4 · Maquetación imprimible. No cambia datos ni rutas. */
(()=>{'use strict';
 const $=id=>document.getElementById(id);
 let config={size:'A5',type:'interior'};
 const options={A5:{w:'148mm',h:'210mm'},'6x9':{w:'152.4mm',h:'228.6mm'},A4:{w:'210mm',h:'297mm'}};
 function init(){
  const launch=$('ecoEditorialOpen');
  if(!launch)return;
  launch.addEventListener('click',()=>setTimeout(attach,0));
  if($('ecoEditorialPrint'))attach();
 }
 function attach(){
  const btn=$('ecoEditorialPrint'),dialog=$('ecoEditorialOverlay')||document.querySelector('.eco-editorial-overlay');
  if(!btn||!dialog||btn.dataset.ecoPrint4)return;
  btn.dataset.ecoPrint4='1';
  btn.textContent='Preparar PDF para impresión';
  const top=dialog.querySelector('.eco-editorial-topbuttons');
  const settings=document.createElement('section');settings.className='eco-print4-settings';settings.id='ecoPrint4Settings';
  settings.innerHTML='<div class="eco-print4-header"><strong>Preparar el libro para impresión</strong><button type="button" id="ecoPrint4Close" aria-label="Cerrar opciones de impresión">×</button></div><label>Tamaño de página <select id="ecoPrint4Size"><option value="A5">A5 · 14,8 × 21 cm</option><option value="6x9">6 × 9 pulgadas · 15,24 × 22,86 cm</option><option value="A4">A4 · 21 × 29,7 cm</option></select></label><p class="eco-print4-help">Incluye portada interior, dedicatoria, índice, capítulos, fotos y QR existentes. Genera un PDF desde Imprimir → Guardar como PDF.</p><div id="ecoPrint4Checks" role="status"></div><button type="button" id="ecoPrint4Go" class="eco-print4-primary">Vista previa / Guardar PDF</button><p class="eco-print4-help">Prueba editorial. No es un archivo listo para imprenta: faltan cubierta exterior, lomo, sangrados, fuentes incrustadas y validación con proveedor.</p>';
  (top||dialog).insertAdjacentElement('afterend',settings);
  const style=document.createElement('style');style.id='ecoPrint4Page';document.head.appendChild(style);
  function sync(){const q=options[config.size];style.textContent=`@page{size:${q.w} ${q.h};margin:0}`;document.documentElement.dataset.ecoPrint4=config.size;}
  sync();
  $('ecoPrint4Size').addEventListener('change',e=>{config.size=e.target.value;sync();check()});
  btn.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();settings.classList.add('eco-print4-visible');check()},{capture:true});
  $('ecoPrint4Close').addEventListener('click',()=>settings.classList.remove('eco-print4-visible'));
  $('ecoPrint4Go').addEventListener('click',async()=>{
   const print=$('ecoEditorialBook');
   if(!print)return;
   const images=[...print.querySelectorAll('img')];
   $('ecoPrint4Checks').textContent='Comprobando fotografías y QR…';
   await Promise.all(images.map(im=>{
    if(im.complete)return Promise.resolve();
    return Promise.race([new Promise(ok=>{im.addEventListener('load',ok,{once:true});im.addEventListener('error',ok,{once:true})}),new Promise(ok=>setTimeout(ok,5000))]);
   }));
   check();
   window.print();
  });
  dialog.addEventListener('click',e=>{if(e.target.closest('#ecoEditorialClose'))settings.classList.remove('eco-print4-visible')});
  function check(){
   const pages=$('ecoEditorialBook');
   const imgs=[...(pages?.querySelectorAll('img')||[])];
   const bad=imgs.filter(i=>i.complete&&i.naturalWidth===0).length;
   const qr=imgs.filter(i=>i.src.includes('/api/book-qr/')).length;
   const chapters=pages?.querySelectorAll('.eco-editorial-page:not(.eco-editorial-cover)').length||0;
   const missing=qr===0?' No hay QR en esta vista.':'';
   $('ecoPrint4Checks').textContent=`Documento preparado: ${chapters} secciones interiores · ${imgs.length} imágenes · ${qr} QR.${bad?' '+bad+' imágenes no cargaron.':''}${missing} Antes de imprimir, verifica permisos y dominio de los QR.`;
  }
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
