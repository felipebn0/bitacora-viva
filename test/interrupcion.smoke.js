// Interrumpir a Eco hablando: el detector tiene que ignorar ruidos (ventilador, golpes, toses, el eco de Eco por el altavoz)
// y reaccionar a una voz que se sostiene.
const { crearDetector, razonDeVoz } = require('../public/eco-interrupcion.js');

let pasaron = 0, fallaron = 0;
const ok = (c, m) => { if (c) { pasaron++; console.log('OK  - ' + m); } else { fallaron++; console.error('FAIL - ' + m); } };

const VOZ = 0.8;
const RUIDO_GRAVE = 0.15;
const GOLPE = 0.4;
const HABLA_NORMAL = 0.06;

// Corre el detector con una secuencia [rms, ratio, ms, eco] y dice a los cuántos ms disparó (o null).
function correr(tramos) {
  const d = crearDetector();
  let t = 0;
  for (const [rms, ratioVoz, ms, eco] of tramos) {
    for (let i = 0; i < ms / 50; i++) {
      t += 50;
      if (d.alimentar({ rms, ratioVoz, dt: 50, eco: !!eco })) return t;
    }
  }
  return null;
}

ok(correr([[0.01, 0.5, 5000, false]]) === null, 'el silencio no interrumpe');
ok(correr([[0.09, RUIDO_GRAVE, 8000, false]]) === null, 'un ventilador o un motor (sonido grave y fuerte) no interrumpe');
ok(correr([[GOLPE, 0.4, 150, false], [0.01, 0.5, 3000, false]]) === null, 'un golpe corto no interrumpe');
ok(correr([[0.15, VOZ, 300, true], [0.01, 0.5, 3000, true]]) === null, 'una tos de 0,3 segundos mientras Eco habla no interrumpe');

const pensando = correr([[0.01, 0.5, 1000, false], [0.12, VOZ, 2000, false]]);
ok(pensando !== null && pensando - 1000 >= 300 && pensando - 1000 <= 450, 'mientras Eco piensa, una voz que se sostiene interrumpe en menos de medio segundo');

const hablando = correr([[0.01, 0.5, 500, false], [0.05, VOZ, 4000, true], [0.2, VOZ, 2000, true]]);
ok(hablando !== null && hablando >= 4500 + 350 && hablando <= 4500 + 550, 'mientras Eco habla, la voz de la persona por encima de la fuga interrumpe a los ~0,4 s');

ok(correr([[0.05, VOZ, 8000, true]]) === null, 'el eco de la propia voz de Eco por el altavoz no la interrumpe');
ok(correr([[0.11, VOZ, 8000, true]]) === null, 'ni siquiera cuando el altavoz suena fuerte');
ok(correr([[0.11, VOZ, 3000, true], [0.35, VOZ, 2000, true]]) !== null, 'pero con el altavoz fuerte, una voz mucho más alta que el eco sí interrumpe');

const desdeElInicio = correr([[0.01, 0.5, 500, false], [0.15, VOZ, 3000, true]]);
ok(desdeElInicio !== null, 'si la persona ya estaba hablando cuando Eco empezó, igual lo interrumpe (su voz no contamina el cálculo del eco)');
ok(correr([[0.01, 0.5, 500, false], [HABLA_NORMAL, VOZ, 2000, true]]) === null, 'con el altavoz de Eco sonando igual de fuerte que una voz normal no se confunde (es su propio eco)');
ok(correr([[0.01, 0.5, 500, false], [HABLA_NORMAL, VOZ, 2000, false]]) !== null, 'una voz normal (volumen suave) mientras Eco piensa interrumpe');
ok(correr([[0.12, 0.3, 5000, false]]) === null, 'sonido fuerte pero sin forma de voz (poca energía en el rango de la voz) no interrumpe');

const intermitente = correr([[0.01, 0.5, 500, false], ...Array.from({ length: 40 }, () => [[0.12, VOZ, 100, false], [0.01, 0.5, 300, false]]).flat()]);
ok(intermitente === null, 'ruidos sueltos separados por silencios no se acumulan hasta interrumpir');

// razonDeVoz con espectros sintéticos (48 kHz, FFT de 1024: ~47 Hz por casilla)
const casillas = 512;
const espectro = (f) => Array.from({ length: casillas }, (_, i) => f(i * 48000 / 1024));
const solo = (desde, hasta) => espectro((hz) => (hz >= desde && hz <= hasta ? -30 : -100));
ok(razonDeVoz(solo(300, 3000), 48000, 1024) > 0.95, 'un sonido entre 300 y 3000 Hz se reconoce como voz');
ok(razonDeVoz(solo(50, 150), 48000, 1024) < 0.1, 'un zumbido grave no se reconoce como voz');
ok(razonDeVoz(solo(5000, 7500), 48000, 1024) < 0.1, 'un siseo agudo no se reconoce como voz');
ok(razonDeVoz(espectro(() => -40), 48000, 1024) < 0.5, 'un golpe de todas las frecuencias no se reconoce como voz');

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
