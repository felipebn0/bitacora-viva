'use strict';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');

const ES_ABUELO = /^(tatarabuel|bisabuel|abuel)/;
const ES_DE_MI_GENERACION_O_MENOR = /^(prim[oa]s?|sobrin[oa]s?|hij[oa]s?|niet[oa]s?|bisniet[oa]s?)\b/;

// Una prima, un sobrino, un hijo o un nieto no pueden ser hijos de un abuelo: si el modelo (o una charla confusa, por ejemplo
// una "tía Lourdes" que comparte nombre con la abuela) dejó a un abuelo como padre de alguien de esas relaciones, se quita ese
// padre. Si no, el árbol dibuja a esa persona como hermana de sus propios padres o tíos.
function quitarPadresDeOtraGeneracion(personas) {
  const abuelos = new Set(personas.filter((p) => ES_ABUELO.test(norm(p.relacion))).map((p) => norm(p.nombre)));
  if (!abuelos.size) return personas;
  personas.forEach((p) => {
    if (!Array.isArray(p.padres) || !p.padres.length) return;
    if (!ES_DE_MI_GENERACION_O_MENOR.test(norm(p.relacion))) return;
    const restantes = p.padres.filter((n) => !abuelos.has(norm(n)));
    if (restantes.length !== p.padres.length) p.padres = restantes;
  });
  return personas;
}

module.exports = { quitarPadresDeOtraGeneracion };
