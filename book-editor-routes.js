/* ECO · Borrador editorial persistente, aislado de chapters y story_log.
   Solo rama de pruebas hasta validar. */
'use strict';
module.exports=(app,{sql,ensureSchema,requireAuth,bloquearColaborador,rateLimit})=>{
 const guard=[requireAuth,bloquearColaborador];
 const clean=(b)=>{
  if(!b||typeof b!=='object'||Array.isArray(b))throw Error('Formato de libro inválido.');
  const string=(v,n)=>String(v??'').slice(0,n);
  const edits={};
  if(b.edits&&typeof b.edits==='object'&&!Array.isArray(b.edits)){
   for(const [k,v] of Object.entries(b.edits).slice(0,250)){
    if(!/^\d{1,12}$/.test(k)||!v||typeof v!=='object')continue;
    edits[k]={};
    if(Object.prototype.hasOwnProperty.call(v,'title'))edits[k].title=string(v.title,200);
    if(Object.prototype.hasOwnProperty.call(v,'text'))edits[k].text=string(v.text,120000);
   }
  }
  return {title:string(b.title,200),subtitle:string(b.subtitle,300),
    dedication:string(b.dedication,4000),
    order:Array.isArray(b.order)?b.order.filter(v=>/^\d{1,12}$/.test(String(v))).slice(0,250).map(String):[],
    edits,media:cleanMedia(b.media),qr:cleanQr(b.qr)};
 };
 function cleanMedia(raw){const out={};if(!raw||typeof raw!=='object'||Array.isArray(raw))return out;
 for(const [chapter,items] of Object.entries(raw).slice(0,250)){if(!/^\d{1,12}$/.test(chapter)||!items||typeof items!=='object')continue;
  out[chapter]={};for(const [url,opts] of Object.entries(items).slice(0,60)){
   if(!/^https:\/\//i.test(url)||url.length>2200||!opts||typeof opts!=='object')continue;
   out[chapter][url]={pos:opts.pos==='hide'?'hide':(/^\d{1,3}$/.test(String(opts.pos))?String(opts.pos):'0'),size:['small','medium','full'].includes(opts.size)?opts.size:'full',caption:String(opts.caption||'').slice(0,180)};
  }
 }return out;}
 function cleanQr(raw){const out={};if(!raw||typeof raw!=='object'||Array.isArray(raw))return out;
 for(const [chapter,qr] of Object.entries(raw).slice(0,250)){
  if(!/^\d{1,12}$/.test(chapter)||!qr||!/^[a-f0-9]{48}$/.test(qr.token||''))continue;
  out[chapter]={token:qr.token,url:typeof qr.url==='string'&&/^https:\/\//.test(qr.url)?qr.url.slice(0,500):''};
 }return out;}
 async function schema(){
  await ensureSchema();
  await sql`CREATE TABLE IF NOT EXISTS book_editor_drafts (
   owner_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
   draft JSONB NOT NULL DEFAULT '{}'::jsonb,
   version INTEGER NOT NULL DEFAULT 1,
   updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
 }
 app.get('/api/book-editor/draft',...guard,async(req,res)=>{
  try{await schema();
   const rows=await sql`SELECT draft,version,updated_at FROM book_editor_drafts WHERE owner_id=${req.profileUserId}`;
   return res.json({book:rows[0]?.draft??null,version:rows[0]?.version??0,updated_at:rows[0]?.updated_at??null});
  }catch(e){console.error('book-editor GET',e);res.status(500).json({error:'No se pudo cargar el libro.'})}
 });
 app.put('/api/book-editor/draft',...guard,rateLimit,async(req,res)=>{
  try{
   const raw=JSON.stringify(req.body??{});
   if(raw.length>1250000)return res.status(413).json({error:'El borrador supera el límite de tamaño.'});
   const draft=clean(req.body?.book);
   const incoming=Number(req.body?.version);
   if(!Number.isInteger(incoming)||incoming<0)return res.status(400).json({error:'Versión inválida.'});
   await schema();
   // Compare-and-swap con VERSION: jamás pisa silenciosamente cambios de otro dispositivo.
   if(incoming>0){const existing=await sql`SELECT version FROM book_editor_drafts WHERE owner_id=${req.profileUserId}`;
    if(!existing.length)return res.status(409).json({error:'El borrador remoto no existe. Recarga y verifica antes de guardar.'});}
   const json=JSON.stringify(draft);
   const rows=await sql`
    INSERT INTO book_editor_drafts (owner_id,draft,version)
    VALUES (${req.profileUserId},${json}::jsonb,1)
    ON CONFLICT (owner_id) DO UPDATE
     SET draft=EXCLUDED.draft,version=book_editor_drafts.version+1,updated_at=now()
     WHERE book_editor_drafts.version=${incoming} AND ${incoming}>0
    RETURNING version,updated_at`;
   if(!rows.length)return res.status(409).json({error:'La versión cambió. Descarga tu respaldo antes de recargar.'});
   res.json({ok:true,version:rows[0].version,updated_at:rows[0].updated_at});
  }catch(e){console.error('book-editor PUT',e);res.status(500).json({error:'No se pudo guardar el borrador.'})}
 });
};
