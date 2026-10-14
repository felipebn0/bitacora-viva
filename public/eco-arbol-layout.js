/* Orden jerárquico del árbol completo: abuelos arriba, luego padres, luego hijos.
   Una sola función para arbol.html (posiciones iniciales) y para el botón "Organizar árbol".
   compute(people, edges) -> { positions: {id:{x,y}}, levels: {id:nivel}, width, height, sinUbicar: [id] }
   - people: [{id, nombre, relacion, es_principal}]
   - edges: [{a, b, type}] con type "parent" (a es padre o madre de b), "partner" o "sibling".
   Reglas:
   1. Las parejas (y quienes comparten un hijo, o son hermanos por vínculo) van en la misma fila, juntos.
   2. Cada hijo queda una fila más abajo que sus padres. Quien no tiene padres registrados se sube o baja
      para quedar justo encima de sus hijos (así una madre sin padres registrados queda a la altura del papá).
   3. Quien no tiene ningún vínculo se ubica según su relación con la persona principal (abuelo, tío, primo...);
      si no se puede saber, va en una fila final "sin ubicar".
   4. Dentro de cada fila, las familias se ordenan para que los hijos queden bajo sus padres. */
(function (raiz) {
  'use strict';
  var PASO_X = 228, PASO_Y = 165, MARGEN_X = 40, MARGEN_Y = 55, HUECO = 24;

  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase(); }

  // Cuántas generaciones arriba (-) o abajo (+) de la persona principal está alguien según su "relacion".
  var PISTAS = [
    [/tatarabuel/, -4], [/bisabuel/, -3], [/abuel/, -2], [/suegr/, -1],
    [/\b(papa|mama|padre|madre|padrastro|madrastra|ti[oa]s?)\b/, -1],
    [/bisniet/, 3], [/niet[oa]/, 2], [/\b(hij[oa]s?|hijastr[oa]|sobrin[oa]s?|yerno|nuera)\b/, 1],
    [/\b(hermano|hermana|hermanastr[oa]|medio hermano|media hermana|prim[oa]s?|cunad[oa]|espos[oa]|pareja|compan[ae]r[oa]|novi[oa]|yo|principal)\b/, 0]
  ];
  function pista(relacion) {
    var r = norm(relacion);
    if (!r) return null;
    for (var i = 0; i < PISTAS.length; i++) if (PISTAS[i][0].test(r)) return PISTAS[i][1];
    return null;
  }

  function mediana(nums) {
    var a = nums.slice().sort(function (x, y) { return x - y; });
    return a[Math.floor((a.length - 1) / 2)];
  }

  function compute(people, edges) {
    var clave = function (id) { return String(id); };
    var porClave = new Map();
    people.forEach(function (p) { porClave.set(clave(p.id), p); });

    var padresDe = new Map();
    people.forEach(function (p) { padresDe.set(clave(p.id), new Set()); });
    var uniones = [];
    (edges || []).forEach(function (e) {
      var a = clave(e.a), b = clave(e.b);
      if (a === b || !porClave.has(a) || !porClave.has(b)) return;
      if (e.type === 'parent') padresDe.get(b).add(a);
      else if (e.type === 'partner' || e.type === 'sibling') uniones.push([a, b]);
    });

    // 1) Grupos de la misma fila: parejas, hermanos por vínculo y quienes comparten un hijo.
    var jefe = new Map();
    people.forEach(function (p) { jefe.set(clave(p.id), clave(p.id)); });
    function raiz_(x) { while (jefe.get(x) !== x) { jefe.set(x, jefe.get(jefe.get(x))); x = jefe.get(x); } return x; }
    function unir(a, b) { var ra = raiz_(a), rb = raiz_(b); if (ra !== rb) jefe.set(rb, ra); }
    uniones.forEach(function (u) { unir(u[0], u[1]); });
    padresDe.forEach(function (ps) {
      var arr = Array.from(ps);
      for (var i = 1; i < arr.length; i++) unir(arr[0], arr[i]);
    });

    var grupos = new Map();
    people.forEach(function (p) {
      var g = raiz_(clave(p.id));
      if (!grupos.has(g)) grupos.set(g, []);
      grupos.get(g).push(clave(p.id));
    });
    var gids = Array.from(grupos.keys());
    gids.forEach(function (g) {
      grupos.get(g).sort(function (a, b) { return String(porClave.get(a).nombre).localeCompare(String(porClave.get(b).nombre), 'es'); });
    });

    // 2) Aristas entre grupos (padres -> hijos), sin ciclos.
    var gPadres = new Map(), gHijos = new Map();
    gids.forEach(function (g) { gPadres.set(g, new Set()); gHijos.set(g, new Set()); });
    padresDe.forEach(function (ps, hijo) {
      var gh = raiz_(hijo);
      ps.forEach(function (padre) {
        var gp = raiz_(padre);
        if (gp !== gh) { gPadres.get(gh).add(gp); gHijos.get(gp).add(gh); }
      });
    });
    var orden = [], pendientes = new Set(gids), entrada = new Map();
    gids.forEach(function (g) { entrada.set(g, gPadres.get(g).size); });
    var cola = gids.filter(function (g) { return entrada.get(g) === 0; });
    while (orden.length < gids.length) {
      if (!cola.length) {
        // Ciclo en los datos (por ejemplo A es padre de B y B de A): se corta el vínculo de menos peso.
        var peor = null;
        pendientes.forEach(function (g) { if (peor === null || entrada.get(g) < entrada.get(peor)) peor = g; });
        gPadres.get(peor).forEach(function (p) { if (pendientes.has(p)) { gPadres.get(peor).delete(p); gHijos.get(p).delete(peor); } });
        entrada.set(peor, 0);
        cola.push(peor);
      }
      var g = cola.shift();
      if (!pendientes.has(g)) continue;
      pendientes.delete(g);
      orden.push(g);
      gHijos.get(g).forEach(function (h) {
        entrada.set(h, entrada.get(h) - 1);
        if (entrada.get(h) === 0 && pendientes.has(h)) cola.push(h);
      });
    }

    // 3) Niveles: del más antiguo al más joven, y luego cada fila sin padres baja hasta quedar pegada a sus hijos.
    var nivel = new Map();
    orden.forEach(function (g) {
      var m = -1;
      gPadres.get(g).forEach(function (p) { m = Math.max(m, nivel.get(p)); });
      nivel.set(g, m + 1);
    });
    for (var i = orden.length - 1; i >= 0; i--) {
      var gg = orden[i];
      if (!gHijos.get(gg).size) continue;
      var minHijo = Infinity;
      gHijos.get(gg).forEach(function (h) { minHijo = Math.min(minHijo, nivel.get(h)); });
      if (minHijo - 1 > nivel.get(gg)) nivel.set(gg, minHijo - 1);
    }

    // 4) Componentes (familias sin conexión entre sí) y su altura respecto a la persona principal.
    var comp = new Map(), comps = [];
    gids.forEach(function (g) {
      if (comp.has(g)) return;
      var id = comps.length, pila = [g], miembros = [];
      comp.set(g, id);
      while (pila.length) {
        var x = pila.pop();
        miembros.push(x);
        var vecinos = Array.from(gPadres.get(x)).concat(Array.from(gHijos.get(x)));
        vecinos.forEach(function (v) { if (!comp.has(v)) { comp.set(v, id); pila.push(v); } });
      }
      comps.push(miembros);
    });
    var principal = people.find(function (p) { return p.es_principal; });
    var gPrincipal = principal ? raiz_(clave(principal.id)) : null;
    var nivelPrincipal = gPrincipal !== null ? nivel.get(gPrincipal) : null;
    var compPrincipal = gPrincipal !== null ? comp.get(gPrincipal) : null;
    var sinUbicar = [];
    var desfase = new Map(); // componente -> cuánto se mueve
    var minPrincipal = null;
    if (compPrincipal !== null) {
      desfase.set(compPrincipal, 0);
      minPrincipal = Math.min.apply(null, comps[compPrincipal].map(function (g) { return nivel.get(g); }));
    }
    comps.forEach(function (miembros, id) {
      if (id === compPrincipal) return;
      var votos = [];
      if (nivelPrincipal !== null) {
        miembros.forEach(function (g) {
          grupos.get(g).forEach(function (k) {
            var h = pista(porClave.get(k).relacion);
            if (h !== null) votos.push(nivelPrincipal + h - nivel.get(g));
          });
        });
      }
      var soloUno = miembros.length === 1 && grupos.get(miembros[0]).length === 1 && !gPadres.get(miembros[0]).size && !gHijos.get(miembros[0]).size;
      if (votos.length) desfase.set(id, mediana(votos));
      else if (soloUno) desfase.set(id, null); // sin vínculos ni pista: fila final
      else {
        var minC = Math.min.apply(null, miembros.map(function (g) { return nivel.get(g); }));
        desfase.set(id, minPrincipal !== null ? minPrincipal - minC : -minC);
      }
    });
    var ubicados = [];
    gids.forEach(function (g) {
      var d = desfase.get(comp.get(g));
      if (d === null) { grupos.get(g).forEach(function (k) { sinUbicar.push(k); }); return; }
      nivel.set(g, nivel.get(g) + d);
      ubicados.push(g);
    });
    var minNivel = ubicados.length ? Math.min.apply(null, ubicados.map(function (g) { return nivel.get(g); })) : 0;
    var maxNivel = 0;
    ubicados.forEach(function (g) { nivel.set(g, nivel.get(g) - minNivel); maxNivel = Math.max(maxNivel, nivel.get(g)); });

    // 5) Orden dentro de cada fila: familias juntas y los hijos bajo sus padres (promedios hacia abajo y hacia arriba).
    var filas = [];
    for (var n = 0; n <= maxNivel; n++) filas.push([]);
    ubicados.forEach(function (g) { filas[nivel.get(g)].push(g); });
    var nombreGrupo = function (g) { return String(porClave.get(grupos.get(g)[0]).nombre); };
    // Las familias sin ningún vínculo (ubicadas solo por su relación) van al final de su fila.
    var suelto = function (g) { return !gPadres.get(g).size && !gHijos.get(g).size ? 1 : 0; };
    filas.forEach(function (fila) { fila.sort(function (a, b) { return suelto(a) - suelto(b) || nombreGrupo(a).localeCompare(nombreGrupo(b), 'es'); }); });
    var indice = new Map();
    function reindexar() { filas.forEach(function (fila) { fila.forEach(function (g, i) { indice.set(g, i); }); }); }
    reindexar();
    function barrer(desde, hasta, paso, vecinosDe) {
      for (var l = desde; l !== hasta; l += paso) {
        var clavesFila = new Map();
        filas[l].forEach(function (g) {
          var vs = Array.from(vecinosDe(g)).filter(function (v) { return nivel.has(v) && ubicados.indexOf(v) !== -1; });
          clavesFila.set(g, vs.length ? vs.reduce(function (s, v) { return s + indice.get(v); }, 0) / vs.length : indice.get(g) + (suelto(g) ? 1e6 : 0));
        });
        filas[l].sort(function (a, b) { return clavesFila.get(a) - clavesFila.get(b) || nombreGrupo(a).localeCompare(nombreGrupo(b), 'es'); });
        filas[l].forEach(function (g, i) { indice.set(g, i); });
      }
    }
    for (var vuelta = 0; vuelta < 3; vuelta++) {
      barrer(1, filas.length, 1, function (g) { return gPadres.get(g); });
      barrer(filas.length - 2, -1, -1, function (g) { return gHijos.get(g); });
    }

    // 6) Coordenadas: de abajo hacia arriba, cada familia centrada sobre sus hijos sin pisar a su vecina.
    var centro = new Map(), inicio = new Map();
    for (var f = filas.length - 1; f >= 0; f--) {
      var cursor = null;
      filas[f].forEach(function (g) {
        var ancho = grupos.get(g).length * PASO_X;
        var hijos = Array.from(gHijos.get(g)).filter(function (h) { return centro.has(h); });
        var deseado = hijos.length ? hijos.reduce(function (s, h) { return s + centro.get(h); }, 0) / hijos.length : null;
        var x0 = cursor === null ? (deseado === null ? 0 : deseado - ancho / 2) : (deseado === null ? cursor : Math.max(cursor, deseado - ancho / 2));
        inicio.set(g, x0);
        centro.set(g, x0 + ancho / 2);
        cursor = x0 + ancho + HUECO;
      });
    }
    var minX = Infinity;
    inicio.forEach(function (x) { minX = Math.min(minX, x); });
    if (!isFinite(minX)) minX = 0;

    var positions = {}, levels = {}, maxX = 0;
    filas.forEach(function (fila, l) {
      fila.forEach(function (g) {
        grupos.get(g).forEach(function (k, i) {
          var p = porClave.get(k);
          var x = Math.round(inicio.get(g) - minX + MARGEN_X + i * PASO_X);
          positions[p.id] = { x: x, y: MARGEN_Y + l * PASO_Y };
          levels[p.id] = l;
          maxX = Math.max(maxX, x);
        });
      });
    });
    var filaFinal = maxNivel + 1;
    sinUbicar.sort(function (a, b) { return String(porClave.get(a).nombre).localeCompare(String(porClave.get(b).nombre), 'es'); });
    sinUbicar.forEach(function (k, i) {
      var p = porClave.get(k);
      positions[p.id] = { x: MARGEN_X + i * PASO_X, y: MARGEN_Y + filaFinal * PASO_Y };
      levels[p.id] = filaFinal;
      maxX = Math.max(maxX, positions[p.id].x);
    });
    var filasTotales = sinUbicar.length ? filaFinal + 1 : filas.length;
    return {
      positions: positions,
      levels: levels,
      sinUbicar: sinUbicar.map(function (k) { return porClave.get(k).id; }),
      width: Math.max(1100, maxX + 250),
      height: Math.max(700, MARGEN_Y + (filasTotales - 1) * PASO_Y + 175)
    };
  }

  var api = { compute: compute, pista: pista, PASO_X: PASO_X, PASO_Y: PASO_Y };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  raiz.EcoArbolLayout = api;
})(typeof window !== 'undefined' ? window : globalThis);
