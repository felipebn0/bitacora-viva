// Orden jerárquico del árbol completo (public/eco-arbol-layout.js): abuelos arriba, luego
// padres, luego hijos; las parejas en la misma fila; sin tarjetas encima de otras.
const { compute, pista } = require('../public/eco-arbol-layout.js');

let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

const P = (id, nombre, relacion, extra) => Object.assign({ id, nombre, relacion, es_principal: false }, extra || {});
const padres = (hijo, ...ps) => ps.map((p) => ({ a: p, b: hijo, type: 'parent' }));
const nivelesDe = (r, ids) => ids.map((i) => r.levels[i]);
function sinSolapes(r, people) {
  const cajas = people.map((p) => r.positions[p.id]);
  for (let i = 0; i < cajas.length; i++) for (let j = i + 1; j < cajas.length; j++) {
    if (cajas[i].y === cajas[j].y && Math.abs(cajas[i].x - cajas[j].x) < 200) return false;
  }
  return true;
}

// --- Familia típica: la mamá no tiene padres registrados, el papá sí ---
const gente = [
  P(1, 'Felipe', 'Yo', { es_principal: true }),
  P(2, 'Carlos Bernal', 'Papá'), P(3, 'Marta Nisperuza', 'Mamá'),
  P(4, 'Abuelo Pedro', 'Abuelo'), P(5, 'Abuela Rosa', 'Abuela'),
  P(6, 'Tío Luis', 'Tío'), P(7, 'Primo Juan', 'Primo'),
  P(8, 'Hermana Ana', 'Hermana'),
];
const aristas = [
  ...padres(1, 2, 3), ...padres(8, 2, 3), ...padres(2, 4, 5), ...padres(6, 4, 5), ...padres(7, 6),
];
const r = compute(gente, aristas);
ok(r.levels[4] === 0 && r.levels[5] === 0, 'los abuelos quedan en la fila de arriba');
ok(r.levels[2] === 1 && r.levels[3] === 1, 'papá y mamá en la segunda fila, aunque la mamá no tenga padres registrados');
ok(r.levels[6] === 1, 'el tío (hijo de los abuelos) queda en la fila de los padres');
ok(r.levels[1] === 2 && r.levels[8] === 2 && r.levels[7] === 2, 'la persona principal, su hermana y su primo en la tercera fila');
ok(r.positions[2].y < r.positions[1].y && r.positions[4].y < r.positions[2].y, 'más arriba en pantalla = más antiguo (y menor)');
ok(r.positions[2].x !== r.positions[3].x && Math.abs(r.positions[2].x - r.positions[3].x) === 228, 'los padres quedan juntos, uno al lado del otro');
ok(sinSolapes(r, gente), 'ninguna tarjeta queda encima de otra');
ok(r.sinUbicar.length === 0, 'todos quedaron ubicados');
const xPadres = (r.positions[2].x + r.positions[3].x) / 2;
const xHijos = (r.positions[1].x + r.positions[8].x) / 2;
ok(Math.abs(xPadres - xHijos) < 230, 'los hijos quedan más o menos bajo sus padres');

// --- Sin vínculos: se usa la relación con la persona principal ---
const sueltos = [
  P(1, 'Felipe', 'Yo', { es_principal: true }), P(2, 'Papá', 'Papá'), ...[]
];
sueltos.push(P(3, 'Abuela Lola', 'Abuela materna'), P(4, 'Tía Eva', 'Tía'), P(5, 'Hijo Nico', 'Hijo'), P(6, 'Nieta Sol', 'Nieta'), P(7, 'Don Fulano', ''), P(8, 'Bisabuelo Tomás', 'Bisabuelo'));
const r2 = compute(sueltos, padres(1, 2));
ok(r2.levels[3] < r2.levels[2], 'una abuela sin vínculos pero con relación "Abuela" queda arriba de los padres');
ok(r2.levels[8] < r2.levels[3], 'un bisabuelo queda arriba de los abuelos');
ok(r2.levels[4] === r2.levels[2], 'una tía sin vínculos queda en la fila de los padres');
ok(r2.levels[5] === r2.levels[1] + 1 && r2.levels[6] === r2.levels[1] + 2, 'hijo y nieta sin vínculos quedan debajo de la persona principal');
ok(r2.levels[7] === Math.max(...Object.values(r2.levels)) && r2.sinUbicar.includes(7), 'quien no tiene vínculos ni relación conocida va en una fila final "sin ubicar"');
ok(sinSolapes(r2, sueltos), 'sin tarjetas encima de otras con personas sueltas');

// --- Una pareja registrada une las filas aunque no compartan hijos ---
const r3 = compute([P(1, 'A', 'Yo', { es_principal: true }), P(2, 'B', 'Esposa'), P(3, 'Madre de A', 'Mamá')], [{ a: 1, b: 2, type: 'partner' }, ...padres(1, 3)]);
ok(r3.levels[1] === r3.levels[2] && r3.levels[3] < r3.levels[1], 'la pareja queda en la misma fila y la madre arriba');

// --- Datos raros: ciclos, ids repetidos en aristas, referencias a personas que no existen ---
const r4 = compute([P(1, 'A', 'Yo', { es_principal: true }), P(2, 'B', 'Papá')], [...padres(1, 2), ...padres(2, 1), { a: 99, b: 1, type: 'parent' }, { a: 1, b: 1, type: 'parent' }]);
ok(Object.keys(r4.positions).length === 2 && Number.isFinite(r4.positions[1].x) && Number.isFinite(r4.positions[2].y), 'un ciclo de padres o referencias rotas no rompen el cálculo');
const r5 = compute([], []);
ok(Object.keys(r5.positions).length === 0 && r5.width >= 1100, 'sin personas devuelve un lienzo vacío');

// --- Dos familias sin conexión, alineadas con la principal por su relación ---
const r6 = compute([
  P(1, 'Yo', 'Yo', { es_principal: true }), P(2, 'Papá', 'Papá'), P(3, 'Tía Clara', 'Tía'), P(4, 'Primo Beto', 'Primo'),
], [...padres(1, 2), ...padres(4, 3)]);
ok(r6.levels[3] === r6.levels[2] && r6.levels[4] === r6.levels[1], 'otra rama sin conexión (tía y primo) se alinea por generación con la principal');

// --- Hijos de dos parejas (medios hermanos): el papá comparte fila con las dos mamás ---
const r7 = compute([P(1, 'Yo', 'Yo', { es_principal: true }), P(2, 'Papá', 'Papá'), P(3, 'Mamá', 'Mamá'), P(4, 'Madrastra', 'Madrastra'), P(5, 'Medio hermano', 'Hermano')], [...padres(1, 2, 3), ...padres(5, 2, 4)]);
ok(r7.levels[2] === 0 && r7.levels[3] === 0 && r7.levels[4] === 0 && r7.levels[1] === 1 && r7.levels[5] === 1, 'medios hermanos: papá y las dos mamás en la misma fila, hijos en la siguiente');

// --- Las pistas de relación ---
ok(pista('Abuela materna') === -2 && pista('Bisabuelo') === -3 && pista('Mamá') === -1 && pista('Tío abuelo') === -2 && pista('Prima') === 0 && pista('Sobrino') === 1 && pista('Nieto') === 2 && pista('amigo de la familia') === null, 'pistas: abuelos -2, bisabuelos -3, padres -1, primos 0, sobrinos +1, nietos +2, otros nada');


// --- Hermanos juntos e hijos cerca de sus padres (árboles armados al azar, siempre los mismos) ---
function azar(semilla) { let x = semilla; return () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; }; }
let violaciones = 0, solapes = 0, lejos = 0, arboles = 0, familias = 0;
for (let semilla = 1; semilla <= 120; semilla++) {
  const rnd = azar(semilla);
  const gente2 = [], aristas2 = [];
  let id = 0;
  const nueva = (relacion, extra) => { id++; const p = P(id, 'Persona ' + String(id).padStart(3, '0') + String.fromCharCode(97 + Math.floor(rnd() * 20)), relacion, extra); gente2.push(p); return p; };
  const hermanosDe = new Map(); // id -> [ids de sus hermanos incluido él]
  const parejaDe = new Map();
  const nucleos = [];
  const principal = nueva('Yo', { es_principal: true });
  const familia = (padresIds, cuantos, profundidad) => {
    const hijos = [];
    for (let i = 0; i < cuantos; i++) {
      const h = i === 0 && profundidad === 'principal' ? principal : nueva('Familiar');
      padresIds.forEach((pid) => aristas2.push({ a: pid, b: h.id, type: 'parent' }));
      hijos.push(h.id);
    }
    hijos.forEach((h) => hermanosDe.set(h, hijos));
    return hijos;
  };
  const abuelos = [nueva('Abuelo').id, nueva('Abuela').id];
  const hijosAbuelos = familia(abuelos, 3 + Math.floor(rnd() * 3), 'nada');
  hijosAbuelos.forEach((h, i) => {
    const pareja = nueva('Pareja');
    aristas2.push({ a: h, b: pareja.id, type: 'partner' }); parejaDe.set(pareja.id, h);
    const nietos = familia([h, pareja.id], i === 0 ? 3 + Math.floor(rnd() * 2) : Math.floor(rnd() * 3), i === 0 ? 'principal' : 'nada');
    nietos.forEach((n) => { if (rnd() < 0.4) { const q = nueva('Pareja'); aristas2.push({ a: n, b: q.id, type: 'partner' }); parejaDe.set(q.id, n); familia([n, q.id], Math.floor(rnd() * 3), 'nada'); } });
  });
  const res = compute(gente2, aristas2);
  arboles++;
  // 1) Nadie se cuela entre hermanos (salvo sus propias parejas)
  const vistos = new Set();
  hermanosDe.forEach((grupo) => {
    const llave = grupo.join(',');
    if (vistos.has(llave) || grupo.length < 2) return;
    vistos.add(llave);
    const fila = res.levels[grupo[0]];
    if (grupo.some((h) => res.levels[h] !== fila)) return;
    const xs = grupo.map((h) => res.positions[h].x);
    const lo = Math.min(...xs), hi = Math.max(...xs);
    const propios = new Set(grupo.concat(Array.from(parejaDe.entries()).filter(([, h]) => grupo.includes(h)).map(([q]) => q)));
    const colados = gente2.filter((p) => res.levels[p.id] === fila && !propios.has(p.id) && res.positions[p.id].x > lo && res.positions[p.id].x < hi);
    if (colados.length) violaciones++;
  });
  if (!sinSolapes(res, gente2)) solapes++;
  // 2) Los hijos quedan cerca de sus padres: el centro de cada familia de hermanos a menos de 3 tarjetas del de sus padres
  hermanosDe.forEach((grupo, h) => {
    const padres2 = aristas2.filter((e) => e.type === 'parent' && e.b === h).map((e) => e.a);
    if (grupo[0] !== h || !padres2.length) return;
    familias++;
    const cx = (ids) => ids.reduce((s, i) => s + res.positions[i].x, 0) / ids.length;
    if (Math.abs(cx(grupo) - cx(padres2)) > 3 * 228) lejos++;
  });
}
ok(arboles === 120 && violaciones === 0, 'en 120 árboles al azar, ningún primo ni otro pariente se cuela entre hermanos (' + violaciones + ' casos)');
ok(solapes === 0, 'y ninguna tarjeta queda encima de otra (' + solapes + ' casos)');
ok(lejos <= familias * 0.05, 'los hijos quedan cerca de sus padres: solo ' + lejos + ' de ' + familias + ' familias quedan a más de 3 tarjetas del centro de sus padres (antes eran muchas más)');

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
