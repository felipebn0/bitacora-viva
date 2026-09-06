// Smoke test para la ronda 4 del camino hacia CSP en enforce (2026-09-06):
// convertir los atributos style="" inline de las páginas de public/ a
// clases, porque style-src 'self' (ya pedido desde la cuarta ronda) no
// admite unsafe-inline y CSP no tiene mecanismo de hash para atributos
// style="" (solo para bloques <style>/<script> completos) — la única
// forma real de llegar a enforce en algún momento es que no quede
// ninguno.
//
// No vuelve a listar los valores/clases exactas (eso sería frágil ante
// cualquier retoque de diseño futuro) — solo verifica la condición que
// de verdad importa para CSP: que ninguna página siga teniendo un
// atributo style="" real en su HTML. También reconstruye, para las
// clases que sí quedaron (extraídas de esos atributos), que llevan
// !important — sin eso, una regla existente con más especificidad que
// una clase sola (hay un caso real: `.login p.sub` en app.html/
// colaborar.html) le vuelve a ganar, algo que el atributo style="" inline
// original nunca permitía.
const fs = require('fs');
const path = require('path');

const publicDir = path.resolve(__dirname, '..', 'public');
const PAGINAS = fs.readdirSync(publicDir).filter((f) => f.endsWith('.html'));

let pasaron = 0;
let fallaron = 0;
function check(nombre, cond) {
  if (cond) { pasaron++; console.log('OK  -', nombre); }
  else { fallaron++; console.log('FAIL -', nombre); }
}

// Un atributo style="" real: precedido de espacio/tag, no parte de un
// comentario o de texto suelto mencionando la palabra.
const STYLE_ATRIBUTO_REAL = /<[a-zA-Z][a-zA-Z0-9]*(?:\s+[^<>]*?)?\sstyle="[^"]*"[^<>]*>/;

for (const pagina of PAGINAS) {
  const contenido = fs.readFileSync(path.join(publicDir, pagina), 'utf8');
  check(`${pagina}: no le queda ningún atributo style="" real`, !STYLE_ATRIBUTO_REAL.test(contenido));

  // Si esta página tiene clases extraídas de inline (prefijo pc-), cada
  // declaración debe llevar !important -- EXCEPTO "display": esa
  // propiedad la alternan en runtime varios toggles JS de este código
  // (elemento.style.display = 'block'/'none'), y un inline plano puesto
  // por JS no le gana a una regla con !important -- si "display" también
  // llevara !important, esos toggles dejarían de funcionar.
  const reglas = [...contenido.matchAll(/\.pc-[0-9a-f]{8}\{([^}]*)\}/g)];
  if (reglas.length) {
    const todasCorrectas = reglas.every(([, decls]) => {
      const partes = decls.split(';').map((p) => p.trim()).filter(Boolean);
      return partes.length > 0 && partes.every((p) => {
        const prop = p.split(':')[0].trim().toLowerCase();
        return prop === 'display' ? !/!important/i.test(p) : /!important$/i.test(p);
      });
    });
    check(`${pagina}: las ${reglas.length} clases extraídas de inline llevan !important salvo en "display" (para no romper los toggles de JS)`, todasCorrectas);
  }
}

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
