(()=>{'use strict';
function init(){
 const trigger=document.getElementById('ecoEditorialOpen');
 if(!trigger)return;
 const setup=()=>{
  const dialog=document.getElementById('ecoEditorialDialog'),book=document.getElementById('ecoEditorialBook');
  if(!dialog||!book||dialog.dataset.printFix6)return;
  dialog.dataset.printFix6='1';
  const original=document.getElementById('ecoPrint4Go');
  const printBtn=original||document.getElementById('ecoEditorialPrint');
  if(!printBtn)return;
  printBtn.addEventListener('click',async e=>{
   // Abort default print from legacy handler only if book is actually empty.
   const pages=[...book.querySelectorAll('.eco-editorial-page')];
   if(!pages.length||!book.textContent.trim()){
    e.preventDefault();e.stopImmediatePropagation();
    alert('No se encontraron páginas del libro. Cierra y vuelve a abrir el estudio antes de imprimir.');
    return;
   }
   dialog.classList.add('eco-print-fix-active');
  },{capture:true});
  window.addEventListener('afterprint',()=>dialog.classList.remove('eco-print-fix-active'));
 };
 trigger.addEventListener('click',()=>setTimeout(setup,0));
 setup();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
