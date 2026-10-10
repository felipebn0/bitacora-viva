/* ECO QR v1: private authenticated voice playback. QR points to page, never blob.
 * QRCode vendor by Kazuhiko Arase, MIT licensed; see vendor/LICENCIA.txt.
 */
const crypto = require('crypto');
const QRCode = require('./vendor/QRCode');
const ECL = require('./vendor/QRCode/QRErrorCorrectLevel');
module.exports = (app, { sql, ensureSchema, requireAuth, bloquearColaborador, rateLimit }) => {
  async function ready() {
    await ensureSchema();
    await sql`CREATE TABLE IF NOT EXISTS book_audio_links (
      token TEXT PRIMARY KEY, owner_id INTEGER NOT NULL, chapter_id INTEGER NOT NULL,
      chapter_title TEXT NOT NULL, audio_urls TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      revoked_at TIMESTAMPTZ
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_book_audio_links_owner ON book_audio_links(owner_id,chapter_id)`;
  }
  const jsonArray = s => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } };
  const safeToken = t => typeof t === 'string' && /^[a-f0-9]{48}$/.test(t);
  const forbidCache = res => res.set('Cache-Control', 'private, no-store');
  app.post('/api/book-qr/chapters/:id', requireAuth, bloquearColaborador, rateLimit, async(req,res) => {
    forbidCache(res);
    const id = Number(req.params.id);
    if(!Number.isSafeInteger(id) || id < 1) return res.status(400).json({error:'Capítulo inválido.'});
    try {
      await ready();
      const ch = (await sql`SELECT id,title,story_ids FROM chapters WHERE user_id=${req.profileUserId} AND id=${id}`)[0];
      if (!ch) return res.status(404).json({error:'Capítulo no encontrado.'});
      let old = (await sql`SELECT token,chapter_title FROM book_audio_links WHERE owner_id=${req.profileUserId} AND chapter_id=${id} AND revoked_at IS NULL ORDER BY created_at ASC LIMIT 1`)[0];
      if(!old) {
        const ids = jsonArray(ch.story_ids).map(Number).filter(Number.isSafeInteger);
        const sounds = [];
        for (const storyId of ids) {
          const st = (await sql`SELECT audio_url,audio_urls FROM story_log WHERE user_id=${req.profileUserId} AND id=${storyId}`)[0];
          if (!st) continue;
          for (const u of [st.audio_url,...jsonArray(st.audio_urls)]) {
            if(typeof u==='string' && /^https:\/\//i.test(u) && !sounds.includes(u)) sounds.push(u);
          }
        }
        if(!sounds.length) return res.status(422).json({error:'Este capítulo no tiene grabaciones originales disponibles para crear el QR.'});
        const token=crypto.randomBytes(24).toString('hex');
        await sql`INSERT INTO book_audio_links(token,owner_id,chapter_id,chapter_title,audio_urls) VALUES(${token},${req.profileUserId},${id},${ch.title},${JSON.stringify(sounds)})`;
        old={token,chapter_title:ch.title};
      }
      const base = process.env.ECO_QR_PUBLIC_BASE_URL;
      const origin = base && /^https:\/\/[\w.-]+(?::\d+)?$/i.test(base) ? base : `${req.protocol}://${req.get('host')}`;
      res.json({ok:true,token:old.token,url:`${origin}/escuchar.html?t=${old.token}`,title:old.chapter_title,private:true});
    }catch(e){console.error('Error QR libro',e);res.status(500).json({error:'No se pudo crear el enlace del capítulo.'});}
  });
  app.get('/api/book-qr/listen/:token', requireAuth, bloquearColaborador, async(req,res)=>{
    forbidCache(res);
    if(!safeToken(req.params.token))return res.status(404).json({error:'Enlace no encontrado.'});
    try{
      await ready();
      const item=(await sql`SELECT chapter_title,audio_urls FROM book_audio_links WHERE token=${req.params.token} AND owner_id=${req.profileUserId} AND revoked_at IS NULL`)[0];
      if(!item)return res.status(404).json({error:'No tienes acceso a este recuerdo o el enlace fue retirado.'});
      res.json({title:item.chapter_title,audios:jsonArray(item.audio_urls).map(u=>'/api/media-file?u='+encodeURIComponent(u))});
    }catch(e){console.error('Escuchar libro QR',e);res.status(500).json({error:'No se pudo cargar el recuerdo.'});}
  });
  app.get('/api/book-qr/image/:token.svg', requireAuth, bloquearColaborador, async(req,res)=>{
    forbidCache(res);
    if(!safeToken(req.params.token))return res.status(404).end();
    try{
      await ready();
      const item=(await sql`SELECT token FROM book_audio_links WHERE token=${req.params.token} AND owner_id=${req.profileUserId} AND revoked_at IS NULL`)[0];
      if(!item)return res.status(404).end();
      const base=process.env.ECO_QR_PUBLIC_BASE_URL;
      const origin=base && /^https:\/\/[\w.-]+(?::\d+)?$/i.test(base) ? base : `${req.protocol}://${req.get('host')}`;
      const url=`${origin}/escuchar.html?t=${item.token}`;
      const qr=new QRCode(-1,ECL.M);qr.addData(url);qr.make();
      const n=qr.getModuleCount(),pad=4;
      let path='';for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(qr.isDark(y,x))path+=`M${x+pad} ${y+pad}h1v1h-1z`;
      res.type('image/svg+xml').send(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 ${n+2*pad} ${n+2*pad}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${path}" fill="#17261b"/></svg>`);
    }catch(e){console.error('Imagen QR libro',e);res.status(500).end();}
  });
};
