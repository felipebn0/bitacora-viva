'use strict';
// Rutas de RAÍZ V4. Se registran desde server.js para reutilizar autenticación, Neon y permisos existentes.
module.exports = function registerTreeV4(app, { sql, ensureSchema, requireAuth, bloquearColaborador, rateLimit }) {
  const protect = [requireAuth, bloquearColaborador];
  const editor = (req,res,next) => req.isGuest ? res.status(403).json({error:'Solo el administrador de la bitácora puede editar este árbol.'}) : next();
  const MAX_PHOTO = 110000;
  const jsonOk = value => value && typeof value === 'object' && !Array.isArray(value);
  function cleanState(source) {
    if (!jsonOk(source)) throw Error('Datos incorrectos.');
    const result = { positions: {}, links: [], hiddenPeople: [], photos: {} };
    if (jsonOk(source.positions)) for (const [id,pos] of Object.entries(source.positions)) {
      if (!/^\d{1,12}$/.test(id) || !jsonOk(pos) || !Number.isFinite(pos.x)||!Number.isFinite(pos.y)) continue;
      result.positions[id] = {x:Math.max(0,Math.min(30000,Math.round(pos.x))),y:Math.max(0,Math.min(30000,Math.round(pos.y)))};
    }
    if (Array.isArray(source.hiddenPeople)) result.hiddenPeople = [...new Set(source.hiddenPeople.map(Number).filter(Number.isSafeInteger))].slice(0,500);
    if (Array.isArray(source.links)) for (const l of source.links.slice(0,1000)) {
      if (!jsonOk(l) || !Number.isSafeInteger(Number(l.a)) || !Number.isSafeInteger(Number(l.b)) || Number(l.a)===Number(l.b)) continue;
      if (!['other','partner','sibling'].includes(l.type)) continue;
      const label=String(l.label||'').trim().slice(0,100); if(!label) continue;
      result.links.push({a:Number(l.a),b:Number(l.b),type:l.type,label});
    }
    if (jsonOk(source.photos)) for (const [id,data] of Object.entries(source.photos)) {
      if (!/^\d{1,12}$/.test(id) || typeof data!=='string'|| data.length>MAX_PHOTO) continue;
      if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(data)) continue;
      result.photos[id]=data;
    }
    if (JSON.stringify(result).length>900000) throw Error('El árbol supera el tamaño permitido. Reduce el tamaño de algunas fotografías.');
    return result;
  }
  async function table(){await ensureSchema();await sql`CREATE TABLE IF NOT EXISTS tree_v4_state (profile_user_id INTEGER PRIMARY KEY, state JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`}
  app.get('/api/tree/v4-state', ...protect, async(req,res)=>{
    try {await table(); const rows=await sql`SELECT state FROM tree_v4_state WHERE profile_user_id=${req.profileUserId}`;res.setHeader('Cache-Control','no-store');res.json({state:rows[0]?.state||null});}
    catch(err){console.error(err);res.status(500).json({error:'No se pudo obtener el diseño del árbol.'})}
  });
  app.put('/api/tree/v4-state', ...protect, editor, rateLimit, async(req,res)=>{
    try {
      const state=cleanState(req.body?.state);
      await table();
      const ids=[...new Set([...Object.keys(state.positions),...Object.keys(state.photos),...state.hiddenPeople,...state.links.flatMap(l=>[l.a,l.b])].map(Number))];
      const owned=await sql`SELECT id FROM family_members WHERE user_id=${req.profileUserId}`;
      const allowed=new Set(owned.map(x=>Number(x.id)));
      if(ids.some(id=>!allowed.has(id)))return res.status(403).json({error:'No puedes modificar familiares ajenos a tu bitácora.'});
      const serialized=JSON.stringify(state);
      await sql`INSERT INTO tree_v4_state(profile_user_id,state,updated_at) VALUES(${req.profileUserId},${serialized}::jsonb,now()) ON CONFLICT(profile_user_id) DO UPDATE SET state=EXCLUDED.state,updated_at=now()`;
      res.json({ok:true});
    } catch(err){if(err.message?.includes('Datos incorrectos')||err.message?.includes('tamaño permitido'))return res.status(400).json({error:err.message});console.error(err);res.status(500).json({error:'No se pudo guardar el árbol.'})}
  });
  app.post('/api/tree/person', ...protect, editor, rateLimit, async(req,res)=>{
    try{
      const nombre=String(req.body?.nombre||'').trim().slice(0,120);
      const relacion=String(req.body?.relacion||'').trim().slice(0,80);
      const padres=Array.isArray(req.body?.padres)?req.body.padres.map(x=>String(x).trim().slice(0,120)).filter(Boolean).slice(0,2):[];
      if(!nombre||!relacion)return res.status(400).json({error:'Nombre y parentesco son obligatorios.'});
      await ensureSchema();
      const people=await sql`SELECT nombre FROM family_members WHERE user_id=${req.profileUserId}`;
      if(people.some(p=>p.nombre.trim().toLocaleLowerCase('es')===nombre.toLocaleLowerCase('es')))return res.status(409).json({error:'Ya existe un familiar con ese nombre. Edítalo en lugar de duplicarlo.'});
      if(padres.some(n=>!people.some(p=>p.nombre.trim().toLocaleLowerCase('es')===n.toLocaleLowerCase('es'))))return res.status(400).json({error:'Selecciona padres que ya estén registrados.'});
      const rows=await sql`INSERT INTO family_members(user_id,nombre,relacion,padres,detalles) VALUES(${req.profileUserId},${nombre},${relacion},${JSON.stringify(padres)},${'Añadido manualmente desde el árbol'}) RETURNING id`;
      res.status(201).json({ok:true,id:rows[0].id});
    }catch(err){console.error(err);res.status(500).json({error:'No se pudo agregar al familiar.'})}
  });
};
