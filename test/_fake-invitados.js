// Tabla "invitados" en memoria para los smoke tests: contesta las consultas
// que hacen /api/invitaciones, /api/guest-start, /api/invitacion-info y
// requireAuth (sesión de invitado con invitación personal). Cada test la usa
// desde su fakeSql: `const r = fakeInvitados.manejar(text, values); if (r) return r;`
function crearFakeInvitados() {
  const filas = [];
  const copia = (f, campos) => { const o = {}; campos.forEach((c) => { o[c] = f[c]; }); return o; };
  return {
    filas,
    manejar(text, values) {
      if (!text.includes('invitados')) return null;
      if (text.includes('INSERT INTO invitados')) {
        const [id, ownerId, esBitacora, nombre, telefono, codigo, creadoPor] = values;
        const f = { id, owner_id: ownerId, owner_es_bitacora: esBitacora, nombre, telefono, codigo, creado_por: creadoPor, created_at: new Date(), ultimo_ingreso: null, revocado_at: null };
        filas.push(f);
        return Promise.resolve([copia(f, ['id', 'nombre', 'telefono', 'codigo', 'ultimo_ingreso', 'revocado_at'])]);
      }
      if (text.includes('SELECT id FROM invitados WHERE owner_id') && text.includes('telefono')) {
        const f = filas.find((x) => x.owner_id === values[0] && x.telefono === values[1]);
        return Promise.resolve(f ? [{ id: f.id }] : []);
      }
      if (text.includes('UPDATE invitados SET nombre')) {
        const [nombre, codigo, id] = values;
        const f = filas.find((x) => x.id === id);
        if (!f) return Promise.resolve([]);
        f.nombre = nombre; f.codigo = codigo; f.revocado_at = null;
        return Promise.resolve([copia(f, ['id', 'nombre', 'telefono', 'codigo', 'ultimo_ingreso', 'revocado_at'])]);
      }
      if (text.includes('UPDATE invitados SET codigo')) {
        const [codigo, id, ownerId] = values;
        const f = filas.find((x) => x.id === id && x.owner_id === ownerId);
        if (!f) return Promise.resolve([]);
        f.codigo = codigo; f.revocado_at = null;
        return Promise.resolve([copia(f, ['id', 'nombre', 'telefono', 'codigo', 'ultimo_ingreso', 'revocado_at'])]);
      }
      if (text.includes('UPDATE invitados SET revocado_at')) {
        const [id, ownerId] = values;
        const f = filas.find((x) => x.id === id && x.owner_id === ownerId);
        if (!f) return Promise.resolve([]);
        f.revocado_at = new Date();
        return Promise.resolve([{ id: f.id }]);
      }
      if (text.includes('UPDATE invitados SET ultimo_ingreso')) {
        const f = filas.find((x) => x.id === values[0]);
        if (f) f.ultimo_ingreso = new Date();
        return Promise.resolve([]);
      }
      if (text.includes('FROM invitados WHERE codigo')) {
        const f = filas.find((x) => x.codigo === values[0] && !x.revocado_at);
        return Promise.resolve(f ? [copia(f, ['id', 'owner_id', 'owner_es_bitacora', 'nombre'])] : []);
      }
      if (text.includes('SELECT 1 FROM invitados WHERE id')) {
        const f = filas.find((x) => x.id === values[0] && x.owner_id === values[1] && !x.revocado_at);
        return Promise.resolve(f ? [{ '?column?': 1 }] : []);
      }
      if (text.includes('FROM invitados WHERE owner_id') && text.includes('ORDER BY')) {
        return Promise.resolve(filas.filter((x) => x.owner_id === values[0]).map((f) => copia(f, ['id', 'nombre', 'telefono', 'codigo', 'ultimo_ingreso', 'revocado_at'])));
      }
      return Promise.resolve([]);
    },
  };
}
module.exports = { crearFakeInvitados };
