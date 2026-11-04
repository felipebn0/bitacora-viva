const { quitarPadresDeOtraGeneracion } = require('../arbol-generaciones');
let ok = 0, mal = 0;
const check = (n, c) => { if (c) { ok++; console.log('OK  - ' + n); } else { mal++; console.log('FAIL - ' + n); } };

const base = () => [
  { nombre: 'Eugenio Nisperuza', relacion: 'Abuelo Materno', padres: [] },
  { nombre: 'Lourdes Florez', relacion: 'Abuela Materna', padres: [] },
  { nombre: 'Marta', relacion: 'mamá', padres: ['Eugenio Nisperuza', 'Lourdes Florez'] },
  { nombre: 'Mario', relacion: 'tío materno', padres: ['Eugenio Nisperuza', 'Lourdes Florez'] },
  { nombre: 'Hermana de mi mamá', relacion: 'tía materna', padres: ['Eugenio Nisperuza', 'Lourdes Florez'] },
  { nombre: 'Carolina', relacion: 'prima', padres: ['Lourdes Florez'] },
  { nombre: 'Sharon', relacion: 'prima', padres: ['Mario'] },
  { nombre: 'Alina', relacion: 'sobrina', padres: ['Oscar', 'Paula Franco'] },
  { nombre: 'Óscar Jr', relacion: 'sobrino', padres: ['lourdes  florez'] },
];
const r = quitarPadresDeOtraGeneracion(base());
const por = (n) => r.find((p) => p.nombre === n);
check('una prima ya no queda como hija de la abuela', por('Carolina').padres.length === 0);
check('un sobrino tampoco, aunque el nombre venga con otro espaciado o mayúsculas', por('Óscar Jr').padres.length === 0);
check('una prima hija de un tío se queda igual', JSON.stringify(por('Sharon').padres) === '["Mario"]');
check('una sobrina hija de sus papás se queda igual', por('Alina').padres.length === 2);
check('los hijos de los abuelos (mamá, tíos) conservan a sus padres', por('Marta').padres.length === 2 && por('Mario').padres.length === 2 && por('Hermana de mi mamá').padres.length === 2);
const mezcla = [
  { nombre: 'Lourdes Florez', relacion: 'Abuela Materna', padres: [] },
  { nombre: 'Gordo', relacion: 'tío materno', padres: [] },
  { nombre: 'Natalia', relacion: 'prima', padres: ['Gordo', 'Lourdes Florez'] },
];
quitarPadresDeOtraGeneracion(mezcla);
check('si tenía un padre bueno y una abuela, solo se quita la abuela', JSON.stringify(mezcla[2].padres) === '["Gordo"]');
check('sin abuelos en la lista no toca nada', JSON.stringify(quitarPadresDeOtraGeneracion([{ nombre: 'A', relacion: 'prima', padres: ['B'] }])[0].padres) === '["B"]');
console.log(`\n${ok} pasaron, ${mal} fallaron`);
process.exit(mal ? 1 : 0);
