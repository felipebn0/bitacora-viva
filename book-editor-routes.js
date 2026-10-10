'use strict';
module.exports = (app, { sql, ensureSchema, requireAuth, bloquearColaborador, rateLimit }) => {
  const guard = [requireAuth, bloquearColaborador];

  function clean(b) {
    if (!b || typeof b !== 'object') return {};
    const safe = {};
    if (typeof b.title === 'string') safe.title = b.title.slice(0, 200);
    if (typeof b.subtitle === 'string') safe.subtitle = b.subtitle.slice(0, 200);
    if (typeof b.dedication === 'string') safe.dedication = b.dedication.slice(0, 2000);
    if (Array.isArray(b.order)) safe.order = b.order.filter(x => typeof x === 'number' || typeof x === 'string').slice(0, 500);
    if (b.edits && typeof b.edits === 'object' && !Array.isArray(b.edits)) {
      const edits = {};
      for (const [k, v] of Object.entries(b.edits)) {
        if (typeof v !== 'object' || !v) continue;
        const ed = {};
        if (typeof v.title === 'string') ed.title = v.title.slice(0, 200);
        if (typeof v.text === 'string') ed.text = v.text.slice(0, 40000);
        edits[String(k).slice(0, 20)] = ed;
      }
      safe.edits = edits;
    }
    return safe;
  }

  async function schema() {
    await ensureSchema();
    await sql`
      CREATE TABLE IF NOT EXISTS book_editor_drafts (
        owner_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        draft      JSONB NOT NULL DEFAULT '{}'::jsonb,
        version    INTEGER NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
  }

  app.get('/api/book-editor/draft', ...guard, async (req, res) => {
    try {
      await schema();
      const rows = await sql`
        SELECT draft, version FROM book_editor_drafts WHERE owner_id = ${req.user.id}
      `;
      if (!rows.length) return res.json({ draft: null, version: 0 });
      res.json({ draft: rows[0].draft, version: rows[0].version });
    } catch (e) {
      console.error('GET /api/book-editor/draft', e);
      res.status(500).json({ error: 'Error al cargar el borrador.' });
    }
  });

  app.put('/api/book-editor/draft', ...guard, rateLimit, async (req, res) => {
    try {
      await schema();
      const incoming = parseInt(req.body?.version, 10);
      const draft = clean(req.body?.draft);

      if (incoming === 0) {
        // First save — INSERT or replace only if no row exists yet
        await sql`
          INSERT INTO book_editor_drafts (owner_id, draft, version, updated_at)
          VALUES (${req.user.id}, ${JSON.stringify(draft)}, 1, now())
          ON CONFLICT (owner_id) DO NOTHING
        `;
        const rows = await sql`
          SELECT version FROM book_editor_drafts WHERE owner_id = ${req.user.id}
        `;
        return res.json({ version: rows[0]?.version || 1 });
      }

      // CAS update
      const result = await sql`
        UPDATE book_editor_drafts
        SET draft = ${JSON.stringify(draft)}, version = version + 1, updated_at = now()
        WHERE owner_id = ${req.user.id} AND version = ${incoming}
        RETURNING version
      `;

      if (!result.length) {
        // Version mismatch — return current server state
        const rows = await sql`
          SELECT draft, version FROM book_editor_drafts WHERE owner_id = ${req.user.id}
        `;
        return res.status(409).json({
          error: 'conflict',
          draft: rows[0]?.draft || null,
          version: rows[0]?.version || 0
        });
      }

      res.json({ version: result[0].version });
    } catch (e) {
      console.error('PUT /api/book-editor/draft', e);
      res.status(500).json({ error: 'Error al guardar el borrador.' });
    }
  });
};
