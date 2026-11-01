/* ECO · compra del libro digital, modo demostración. No procesa dinero. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
let approved=false,loaded=false,busy=false,dialog,esperando=null,exigeCompra=false;
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
function close(){dialog.hidden=true;if(esperando){const r=esperando;esperando=null;r(exigeCompra?false:approved)}}
function show(){createModal();$('ecoDemoMessage').textContent='';$('ecoDemoConfirm').hidden=approved;dialog.hidden=false;$('ecoDemoClose').focus()}
async function status(){
 try{const data=await request('/api/book-demo/status');loaded=true;approved=!!data.approved;return approved}
 catch(e){loaded=false;approved=false;$('ecoDemoMessage')&&( $('ecoDemoMessage').textContent=e.message );return false}
}
async function buy(){
 if(busy)return;busy=true;const btn=$('ecoDemoConfirm');btn.disabled=true;$('ecoDemoMessage').textContent='Registrando compra de demostración…';
 try{
  const data=await request('/api/book-demo/purchase',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  if(!data.approved)throw Error('La compra no fue aprobada.');
  approved=true;loaded=true;$('ecoDemoMessage').textContent='Compra de prueba aprobada. No se cobró dinero.';
  // Con la compra aprobada se descarga de una vez: se cierra la ventana y sigue la exportación del PDF.
  const quienEspera=esperando;esperando=null;dialog.hidden=true;
  if(quienEspera)quienEspera(true);else window.dispatchEvent(new Event('eco:compra-aprobada'));
 }catch(e){$('ecoDemoMessage').textContent=e.message}
 finally{busy=false;btn.disabled=false}
}
// Para quien necesite estar seguro de que la compra está aprobada (las descargas de Mi libro): si ya lo está responde true;
// si no, abre la ventana de compra y responde cuando se aprueba (true) o se cierra (false). Con { siempre: true } la ventana de
// compra se muestra aunque ya se haya aprobado antes (cada descarga pasa por la pantalla de pago).
window.EcoLibroCompra={
 async asegurar({siempre=false}={}){
  if(!loaded)await status();
  if(approved&&!siempre)return true;
  exigeCompra=siempre;
  createModal();$('ecoDemoMessage').textContent='';$('ecoDemoConfirm').hidden=false;dialog.hidden=false;$('ecoDemoClose').focus();
  return new Promise(r=>{esperando=r});
 }
};
})();
