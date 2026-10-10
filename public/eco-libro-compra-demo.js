/* ECO · compra del libro digital, modo demostración. No procesa dinero. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
let approved=false,loaded=false,busy=false,dialog;
const request=async(path,opts)=>{
  const res=await fetch(path,{credentials:'same-origin',cache:'no-store',...opts});
  const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(data.error||'No fue posible conectar con ECO.');return data;
};
function createModal(){
 if(dialog)return;
 dialog=document.createElement('div');dialog.id='ecoDemoPay';dialog.hidden=true;
 dialog.innerHTML=`<section class="eco-demo-panel" role="dialog" aria-modal="true" aria-labelledby="ecoDemoTitle">
 <button class="eco-demo-x" type="button" aria-label="Cerrar" id="ecoDemoClose">×</button>
 <small>ECO · EDICIÓN DIGITAL</small><h2 id="ecoDemoTitle">Conserva tu libro familiar</h2>
 <p>Revisa tu libro gratis. Cuando esté listo, puedes completar la compra de demostración para habilitar su exportación.</p>
 <div class="eco-demo-product"><div><strong>Libro digital PDF</strong><span>Edición completa con fotografías y voces QR</span></div><strong>$49.900 COP</strong></div>
 <p class="eco-demo-note">MODO DE PRUEBA · No se solicitará tarjeta ni se cobrará dinero. La operación se registra solo como simulación.</p>
 <p id="ecoDemoMessage" role="status"></p>
 <button type="button" id="ecoDemoConfirm" class="eco-demo-main">Simular compra gratis</button>
 <button type="button" id="ecoDemoContinue" class="eco-demo-light">Seguir revisando mi libro</button>
 </section>`;
 document.body.appendChild(dialog);
 $('ecoDemoClose').addEventListener('click',close);$('ecoDemoContinue').addEventListener('click',close);
 dialog.addEventListener('click',e=>{if(e.target===dialog)close()});
 $('ecoDemoConfirm').addEventListener('click',buy);
}
function close(){dialog.hidden=true;const launch=$('ecoEditorialPrint');launch?.focus()}
function show(){createModal();$('ecoDemoMessage').textContent='';$('ecoDemoConfirm').hidden=approved;dialog.hidden=false;$('ecoDemoClose').focus()}
async function status(){
 try{const data=await request('/api/book-demo/status');loaded=true;approved=!!data.approved;update();return approved}
 catch(e){loaded=false;approved=false;update();$('ecoDemoMessage')&&( $('ecoDemoMessage').textContent=e.message );return false}
}
function update(){
 const btn=$('ecoEditorialPrint');if(!btn)return;
 btn.textContent=approved?'Descargar libro digital':'Obtener mi libro digital';
 btn.setAttribute('aria-label',approved?'Imprimir o guardar libro digital en PDF':'Simular compra de libro digital');
 const info=$('ecoDemoBadge');if(info)info.textContent=approved?'Compra de prueba aprobada · PDF desbloqueado':'Vista previa gratuita · pago de prueba';
}
async function buy(){
 if(busy)return;busy=true;const btn=$('ecoDemoConfirm');btn.disabled=true;$('ecoDemoMessage').textContent='Registrando compra de demostración…';
 try{
  const data=await request('/api/book-demo/purchase',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  if(!data.approved)throw Error('La compra no fue aprobada.');
  approved=true;loaded=true;update();$('ecoDemoMessage').textContent='Compra de prueba aprobada. No se cobró dinero.';
  btn.hidden=true;const cont=$('ecoDemoContinue');cont.textContent='Volver al libro y descargar';
 }catch(e){$('ecoDemoMessage').textContent=e.message}
 finally{busy=false;btn.disabled=false}
}
function attach(){
 const btn=$('ecoEditorialPrint'),ed=$('ecoEditorialDialog');if(!btn||!ed||btn.dataset.demoPay)return;
 btn.dataset.demoPay='1';createModal();
 const badge=document.createElement('p');badge.id='ecoDemoBadge';badge.className='eco-demo-badge';ed.querySelector('.eco-editorial-warning')?.insertAdjacentElement('afterend',badge);
 // Capture phase stops legacy print listeners unless purchase is approved.
 btn.addEventListener('click',async e=>{
  if(!approved){e.preventDefault();e.stopImmediatePropagation();show();if(!loaded)await status();}
 },true);
 update();status();
}
function init(){
 const observer=new MutationObserver(()=>{if($('ecoEditorialPrint')&&!$('ecoEditorialPrint').dataset.demoPay)attach()});
 observer.observe(document.body,{childList:true,subtree:true});attach();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
