/* ECO QR: el QR impreso apunta a una página pública (/escuchar.html?t=<token>): quien lo escanea
 * escucha las grabaciones SIN cuenta. El token (48 hex, 192 bits al azar) es la llave: se puede
 * retirar (revoked_at) y solo sirve los audios de ese capítulo. El QR nunca apunta al archivo.
 * QRCode vendor by Kazuhiko Arase, MIT licensed; see vendor/LICENCIA.txt.
 */
const crypto = require('crypto');
const QRCode = require('./vendor/QRCode');
const ECL = require('./vendor/QRCode/QRErrorCorrectLevel');
module.exports = (app, { sql, ensureSchema, requireAuth, bloquearColaborador, rateLimit, rateLimitQr, enviarArchivoAlmacenado, datosDelArchivoDeBlob }) => {
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
      const host = req.get('host') || '';
      const origin = base && /^https:\/\/[\w.-]+(?::\d+)?$/i.test(base) ? base : `${/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host) ? 'http' : 'https'}://${host}`;
      res.json({ok:true,token:old.token,url:`${origin}/escuchar.html?t=${old.token}`,title:old.chapter_title,private:true});
    }catch(e){console.error('Error QR libro',e);res.status(500).json({error:'No se pudo crear el enlace del capítulo.'});}
  });
  // Público (sin sesión): lo que abre quien escanea el QR del libro.
  app.get('/api/book-qr/listen/:token', rateLimitQr, async(req,res)=>{
    res.set('Cache-Control','no-store');
    res.set('X-Robots-Tag','noindex, nofollow');
    if(!safeToken(req.params.token))return res.status(404).json({error:'Enlace no encontrado.'});
    try{
      await ready();
      const item=(await sql`SELECT chapter_title,audio_urls FROM book_audio_links WHERE token=${req.params.token} AND revoked_at IS NULL`)[0];
      if(!item)return res.status(404).json({error:'Este enlace ya no está disponible.'});
      const audios=jsonArray(item.audio_urls).map((_,i)=>`/api/book-qr/audio/${req.params.token}/${i}`);
      res.json({title:item.chapter_title,audios});
    }catch(e){console.error('Escuchar libro QR',e);res.status(500).json({error:'No se pudo cargar el recuerdo.'});}
  });
  // Público: entrega UNA grabación del capítulo (por posición, nunca por URL que mande el navegador).
  app.get('/api/book-qr/audio/:token/:n', rateLimitQr, async(req,res)=>{
    res.set('X-Robots-Tag','noindex, nofollow');
    if(!safeToken(req.params.token)||!/^\d{1,3}$/.test(req.params.n))return res.status(404).json({error:'Enlace no encontrado.'});
    try{
      await ready();
      const item=(await sql`SELECT owner_id,audio_urls FROM book_audio_links WHERE token=${req.params.token} AND revoked_at IS NULL`)[0];
      const guardado=item?jsonArray(item.audio_urls)[Number(req.params.n)]:null;
      if(typeof guardado!=='string')return res.status(404).json({error:'Este enlace ya no está disponible.'});
      // Defensa extra: el archivo tiene que ser de quien creó el enlace.
      const datos=datosDelArchivoDeBlob(guardado);
      if(!datos||datos.ownerId!==item.owner_id)return res.status(404).json({error:'Este enlace ya no está disponible.'});
      await enviarArchivoAlmacenado(req,res,guardado,'private, max-age=300');
    }catch(e){console.error('Audio libro QR',e);if(!res.headersSent)res.status(500).json({error:'No se pudo cargar la grabación.'});else res.destroy();}
  });
  // Solo la cuenta dueña: comprueba que un token es suyo (lo usa la importación de borradores).
  app.get('/api/book-qr/owned/:token', requireAuth, bloquearColaborador, async(req,res)=>{
    forbidCache(res);
    if(!safeToken(req.params.token))return res.status(404).json({error:'Enlace no encontrado.'});
    try{
      await ready();
      const item=(await sql`SELECT 1 FROM book_audio_links WHERE token=${req.params.token} AND owner_id=${req.profileUserId} AND revoked_at IS NULL`)[0];
      if(!item)return res.status(404).json({error:'Este código QR no es de tu cuenta o ya fue retirado.'});
      res.json({ok:true});
    }catch(e){console.error('QR libro propio',e);res.status(500).json({error:'No se pudo comprobar el código.'});}
  });
  // Retira el enlace público de un capítulo: los QR ya impresos dejan de funcionar.
  app.delete('/api/book-qr/chapters/:id', requireAuth, bloquearColaborador, rateLimit, async(req,res)=>{
    forbidCache(res);
    const id=Number(req.params.id);
    if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Capítulo inválido.'});
    try{
      await ready();
      await sql`UPDATE book_audio_links SET revoked_at=now() WHERE owner_id=${req.profileUserId} AND chapter_id=${id} AND revoked_at IS NULL`;
      res.json({ok:true});
    }catch(e){console.error('Retirar QR libro',e);res.status(500).json({error:'No se pudo retirar el enlace.'});}
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
