// La regla de despedida está en los dos prompts de charla (historias y árbol): si la persona se despide con la voz,
// Eco cierra con [FIN] como el botón «Fin». Antes [FIN] solo se permitía tras una historia larga.
const fs = require('fs');
const path = require('path');
const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };
ok(/const REGLA_CIERRE_POR_DESPEDIDA = `[^`]*se despide[^`]*como si hubiera tocado el botón «Fin»[^`]*\[FIN\][^`]*`/.test(s), 'existe la regla: si se despide, cerrar como el botón «Fin», con [FIN]');
ok(/REGLA_CIERRE_POR_DESPEDIDA = `[^`]*"eso es todo" o "ya terminé"[^`]*no cierres/.test(s), 'y aclara que «eso es todo» tras una historia no cierra la charla');
const arbol = s.slice(s.indexOf('const ARBOL_SYSTEM_PROMPT = `'), s.indexOf('`', s.indexOf('const ARBOL_SYSTEM_PROMPT = `') + 40) + 1);
const charla = s.slice(s.indexOf('const SYSTEM_PROMPT = `'));
ok(/\$\{REGLA_CIERRE_POR_DESPEDIDA\}\n- Nunca uses \[FIN\] excepto en esos cierres\./.test(arbol), 'la tiene el prompt del árbol');
ok(/\$\{REGLA_CIERRE_POR_DESPEDIDA\}\n- Nunca uses la palabra \[FIN\] excepto en esos cierres\./.test(charla), 'la tiene el prompt de las historias');
ok(s.indexOf('const REGLA_CIERRE_POR_DESPEDIDA') < s.indexOf('const ARBOL_SYSTEM_PROMPT'), 'se define antes de los prompts que la usan');
console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
