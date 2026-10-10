'use strict';
// Compra de DEMOSTRACION: NO conecta con Wava y no representa dinero recibido.
module.exports = function registerBookPurchaseDemo(app, { sql, ensureSchema, requireAuth, bloquearColaborador, rateLimit }) {
  const guard = [requireAuth, bloquearColaborador];
  async function schema() {
    await ensureSchema();
    await sql`CREATE TABLE IF NOT EXISTS book_demo_purchases (
      owner_id INTEGER PRIMARY KEY,
      product_code TEXT NOT NULL DEFAULT 'eco-digital-book',
      mode TEXT NOT NULL DEFAULT 'simulated',
      status TEXT NOT NULL DEFAULT 'approved',
      price_cop INTEGER NOT NULL DEFAULT 49900,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  }
  app.get('/api/book-demo/status', ...guard, async (req, res) => {
    try {
      await schema();
      const rows = await sql`SELECT status,mode,price_cop,created_at FROM book_demo_purchases WHERE owner_id=${req.profileUserId}`;
      res.set('Cache-Control','private, no-store');
      res.json({ ok:true, simulated:true, approved:rows[0]?.status==='approved' && rows[0]?.mode==='simulated', price_cop:49900, purchased_at:rows[0]?.created_at||null });
    } catch (error) {console.error('book-demo/status',error);res.status(500).json({error:'No se pudo consultar la compra de prueba.'});}
  });
  app.post('/api/book-demo/purchase', ...guard, rateLimit, async (req,res) => {
    try {
      await schema();
      // Solo habilitado explícitamente. Se puede mantener en main durante las pruebas.
      if (process.env.ECO_BOOK_DEMO_MODE !== 'enabled') return res.status(403).json({error:'Las compras de demostración no están habilitadas.'});
      const count = await sql`SELECT COUNT(*)::int AS count FROM book_editor_drafts WHERE owner_id=${req.profileUserId}`;
      if (!count[0]?.count) return res.status(400).json({error:'Guarda primero tu libro en el Estudio Editorial.'});
      await sql`INSERT INTO book_demo_purchases (owner_id,product_code,mode,status,price_cop)
       VALUES (${req.profileUserId},'eco-digital-book','simulated','approved',49900)
       ON CONFLICT (owner_id) DO UPDATE SET status='approved',mode='simulated',updated_at=now()`;
      res.set('Cache-Control','private, no-store');
      return res.json({ok:true,simulated:true,approved:true,message:'Compra de prueba aprobada. No se realizó ningún cobro.'});
    } catch(error) {console.error('book-demo/purchase',error);res.status(500).json({error:'No se pudo completar la simulación.'});}
  });
};
