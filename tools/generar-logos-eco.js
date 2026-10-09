// Genera los logos de Eco (manual de marca, octubre 2026) a partir de su
// geometría: grilla de 200, 3 anillos concéntricos de radio 28, 50 y 72, trazo
// de 12 con puntas redondeadas, abertura del 28% girada 12° hacia afuera en cada
// anillo, y un punto central de radio 13. La palabra "Eco" (Fraunces SemiBold)
// va convertida a trazos, para no depender de la fuente.
//
//   node tools/generar-logos-eco.js
//
// Escribe los SVG en public/images/eco/ y los PNG (favicons, ícono de la app,
// logo para el navegador) en public/images/. Los PNG se dibujan con Playwright.
const fs = require('fs');
const path = require('path');

const COLORES = {
  musgo: '#4F5D3A',
  crema: '#F6EEDC',
  dorado: '#D9A441',
  ocre: '#B7791F',
  tinta: '#1A1A1A',
};

// "Eco" en Fraunces SemiBold, a trazos (2000 unidades por em, ya con el eje y hacia abajo).
const PALABRA_ECO = fs.readFileSync(path.join(__dirname, 'eco-palabra.txt'), 'utf8').trim();

// Cada anillo: [radio, ángulo de arranque en grados, medido desde arriba y hacia la derecha].
// El arco recorre 72% de la vuelta (el 28% restante es la abertura).
const ANILLOS = [[28, 80], [50, 68], [72, 56]];
const BARRIDO = 360 * 0.72;
const punto = (r, grados) => {
  const a = (grados * Math.PI) / 180;
  return [100 + r * Math.sin(a), 100 - r * Math.cos(a)];
};
const f = (n) => Number(n.toFixed(2));

function anillos(color) {
  return ANILLOS.map(([r, inicio]) => {
    const [x0, y0] = punto(r, inicio);
    const [x1, y1] = punto(r, inicio + BARRIDO);
    return `<path d="M${f(x0)} ${f(y0)}A${r} ${r} 0 1 1 ${f(x1)} ${f(y1)}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"/>`;
  }).join('');
}
const simboloInterno = (anillo, centro) => `${anillos(anillo)}<circle cx="100" cy="100" r="13" fill="${centro}"/>`;

const svg = (viewBox, cuerpo, titulo) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${titulo}"><title>${titulo}</title>${cuerpo}</svg>\n`;

// Palabra: origen en la línea base, a 162 unidades de la grilla por em (0.081 por unidad de la fuente).
const palabra = (color) => `<path transform="translate(219.7 157.9) scale(0.081)" d="${PALABRA_ECO}" fill="${color}"/>`;
const HORIZONTAL_VB = '16 16 496 168';

const SVGS = {
  'eco-icono.svg': svg('0 0 200 200', `<rect width="200" height="200" rx="44" fill="${COLORES.musgo}"/>${simboloInterno(COLORES.crema, COLORES.dorado)}`, 'Eco'),
  'eco-icono-cuadrado.svg': svg('0 0 200 200', `<rect width="200" height="200" fill="${COLORES.musgo}"/>${simboloInterno(COLORES.crema, COLORES.dorado)}`, 'Eco'),
  'eco-icono-invertido.svg': svg('0 0 200 200', `<rect width="200" height="200" rx="44" fill="${COLORES.crema}"/>${simboloInterno(COLORES.musgo, COLORES.ocre)}`, 'Eco'),
  'eco-icono-minimo.svg': svg('0 0 200 200', `<rect width="200" height="200" rx="44" fill="${COLORES.musgo}"/><circle cx="100" cy="100" r="46" fill="${COLORES.dorado}"/>`, 'Eco'),
  'eco-simbolo.svg': svg('0 0 200 200', simboloInterno(COLORES.musgo, COLORES.ocre), 'Eco'),
  'eco-simbolo-claro.svg': svg('0 0 200 200', simboloInterno(COLORES.crema, COLORES.dorado), 'Eco'),
  'eco-simbolo-una-tinta.svg': svg('0 0 200 200', simboloInterno(COLORES.tinta, COLORES.tinta), 'Eco'),
  'eco-horizontal.svg': svg(HORIZONTAL_VB, `${simboloInterno(COLORES.musgo, COLORES.ocre)}${palabra(COLORES.musgo)}`, 'Eco'),
  'eco-horizontal-claro.svg': svg(HORIZONTAL_VB, `${simboloInterno(COLORES.crema, COLORES.dorado)}${palabra(COLORES.crema)}`, 'Eco'),
  'eco-horizontal-una-tinta.svg': svg(HORIZONTAL_VB, `${simboloInterno(COLORES.tinta, COLORES.tinta)}${palabra(COLORES.tinta)}`, 'Eco'),
};

const PNGS = [
  // [archivo, svg de origen, ancho, alto]
  ['favicon-16.png', 'eco-icono.svg', 16, 16],
  ['favicon-32.png', 'eco-icono.svg', 32, 32],
  ['favicon-192.png', 'eco-icono.svg', 192, 192],
  ['favicon-512.png', 'eco-icono.svg', 512, 512],
  ['apple-touch-icon.png', 'eco-icono-cuadrado.svg', 180, 180],
  ['logo-icon.png', 'eco-simbolo.svg', 600, 600],
  ['logo-full.png', 'eco-horizontal.svg', 1488, 504],
];

(async () => {
  const dirSvg = path.join(__dirname, '..', 'public', 'images', 'eco');
  const dirPng = path.join(__dirname, '..', 'public', 'images');
  fs.mkdirSync(dirSvg, { recursive: true });
  for (const [nombre, contenido] of Object.entries(SVGS)) fs.writeFileSync(path.join(dirSvg, nombre), contenido);
  console.log(`${Object.keys(SVGS).length} SVG en public/images/eco/`);

  const { chromium } = require('playwright');
  const navegador = await chromium.launch();
  const pagina = await navegador.newPage();
  for (const [archivo, origen, ancho, alto] of PNGS) {
    const contenido = SVGS[origen];
    await pagina.setViewportSize({ width: ancho, height: alto });
    await pagina.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${ancho}px;height:${alto}px}</style>${contenido}`);
    await pagina.screenshot({ path: path.join(dirPng, archivo), omitBackground: true, clip: { x: 0, y: 0, width: ancho, height: alto } });
  }
  await navegador.close();
  console.log(`${PNGS.length} PNG en public/images/`);
})();
