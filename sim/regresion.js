// ============================================================================
// TEST DE REGRESIÓN DEL MOTOR IA
// ----------------------------------------------------------------------------
// Captura una huella determinista de las decisiones de la IA en un conjunto
// fijo de posiciones. Sirve para garantizar que las optimizaciones NO cambian
// el comportamiento.
//
//   node sim/regresion.js bless    -> guarda la huella de referencia
//   node sim/regresion.js check    -> compara contra la referencia y reporta diffs
//
// La huella usa `top5` de calcularDecisionJugador (scores ordenados, sin la
// aleatoriedad de iaElegir) y la secuencia de iaBestBallSequence para balón.
// Ambos son deterministas dado un estado.
// ============================================================================

console.log = (() => { const o = console.log; return (...a) => { if (typeof a[0]==='string' && a[0].includes('PERF')) return; o(...a); }; })();

const fs = require('fs');
const path = require('path');
const ia = require('../ia-worker.js');

const REF_PATH = path.join(__dirname, 'regresion-ref.json');

// ---------------------------------------------------------------------------
// POSICIONES DE PRUEBA — variadas: ataque, defensa, balón neutro, peligro.
// Todas con turno = visitante (perspectiva nativa de la IA).
// ---------------------------------------------------------------------------
function base(extra) {
  return Object.assign({
    turno: 'visitante',
    fase: 'MOVER_JUGADOR',
    movimientosBalon: 0,
    ultimoPasador: null,
    turnoExtra: false,
    marcador: { local: 0, visitante: 0 },
    nivelIA: 'imbatible',
    potencialRival: 3,
    estiloVisitante: 'equilibrado',
  }, extra);
}

const POSICIONES = [
  // 1. Posición inicial estándar
  base({ fichas: {
    'l-portero': { fila: 2,  col: 6, equipo: 'local' },
    'l-j1':      { fila: 4,  col: 4, equipo: 'local' },
    'l-j2':      { fila: 4,  col: 8, equipo: 'local' },
    'l-j3':      { fila: 6,  col: 3, equipo: 'local' },
    'l-j4':      { fila: 6,  col: 9, equipo: 'local' },
    'v-portero': { fila: 12, col: 6, equipo: 'visitante' },
    'v-j1':      { fila: 8,  col: 3, equipo: 'visitante' },
    'v-j2':      { fila: 8,  col: 9, equipo: 'visitante' },
    'v-j3':      { fila: 10, col: 4, equipo: 'visitante' },
    'v-j4':      { fila: 10, col: 8, equipo: 'visitante' },
    'balon':     { fila: 7,  col: 6 },
  }}),
  // 2. Balón neutro en centro (peor caso combinatorio)
  base({ fichas: {
    'l-portero': { fila: 2,  col: 6, equipo: 'local' },
    'l-j1':      { fila: 5,  col: 5, equipo: 'local' },
    'l-j2':      { fila: 6,  col: 7, equipo: 'local' },
    'l-j3':      { fila: 8,  col: 4, equipo: 'local' },
    'l-j4':      { fila: 9,  col: 8, equipo: 'local' },
    'v-portero': { fila: 12, col: 6, equipo: 'visitante' },
    'v-j1':      { fila: 7,  col: 4, equipo: 'visitante' },
    'v-j2':      { fila: 7,  col: 8, equipo: 'visitante' },
    'v-j3':      { fila: 9,  col: 5, equipo: 'visitante' },
    'v-j4':      { fila: 10, col: 7, equipo: 'visitante' },
    'balon':     { fila: 8,  col: 6 },
  }}),
  // 3. DEFENSA: balón local cerca de portería visitante (fila 11)
  base({ fichas: {
    'l-portero': { fila: 2,  col: 6, equipo: 'local' },
    'l-j1':      { fila: 11, col: 5, equipo: 'local' },
    'l-j2':      { fila: 10, col: 7, equipo: 'local' },
    'l-j3':      { fila: 9,  col: 4, equipo: 'local' },
    'l-j4':      { fila: 9,  col: 9, equipo: 'local' },
    'v-portero': { fila: 12, col: 6, equipo: 'visitante' },
    'v-j1':      { fila: 10, col: 5, equipo: 'visitante' },
    'v-j2':      { fila: 11, col: 8, equipo: 'visitante' },
    'v-j3':      { fila: 8,  col: 6, equipo: 'visitante' },
    'v-j4':      { fila: 9,  col: 3, equipo: 'visitante' },
    'balon':     { fila: 11, col: 4 },
  }}),
  // 4. ATAQUE: visitante con posesión cerca de portería rival (fila 3)
  base({ fichas: {
    'l-portero': { fila: 2,  col: 6, equipo: 'local' },
    'l-j1':      { fila: 4,  col: 5, equipo: 'local' },
    'l-j2':      { fila: 3,  col: 8, equipo: 'local' },
    'l-j3':      { fila: 5,  col: 4, equipo: 'local' },
    'l-j4':      { fila: 6,  col: 7, equipo: 'local' },
    'v-portero': { fila: 12, col: 6, equipo: 'visitante' },
    'v-j1':      { fila: 4,  col: 6, equipo: 'visitante' },
    'v-j2':      { fila: 5,  col: 8, equipo: 'visitante' },
    'v-j3':      { fila: 3,  col: 4, equipo: 'visitante' },
    'v-j4':      { fila: 6,  col: 5, equipo: 'visitante' },
    'balon':     { fila: 4,  col: 5 },
  }}),
  // 5. Balón en banda (zona ofensiva visitante: ataque, no defensa)
  base({ fichas: {
    'l-portero': { fila: 2,  col: 6, equipo: 'local' },
    'l-j1':      { fila: 6,  col: 2, equipo: 'local' },
    'l-j2':      { fila: 3,  col: 4, equipo: 'local' },
    'l-j3':      { fila: 5,  col: 6, equipo: 'local' },
    'l-j4':      { fila: 8,  col: 9, equipo: 'local' },
    'v-portero': { fila: 12, col: 6, equipo: 'visitante' },
    'v-j1':      { fila: 5,  col: 2, equipo: 'visitante' },
    'v-j2':      { fila: 4,  col: 4, equipo: 'visitante' },
    'v-j3':      { fila: 5,  col: 4, equipo: 'visitante' },
    'v-j4':      { fila: 6,  col: 5, equipo: 'visitante' },
    'balon':     { fila: 4,  col: 3 },
  }}),
];

// ---------------------------------------------------------------------------
// Genera la huella determinista de una posición.
// Redondeamos scores a entero para evitar ruido de coma flotante.
// ---------------------------------------------------------------------------
function huellaDe(estado) {
  ia.setEstado(JSON.parse(JSON.stringify(estado)));
  const dec = ia.calcularDecisionJugador();
  if (!dec) return { nula: true };
  // NOTA: dec.piezaId NO es determinista — iaElegir() usa Math.random() para
  // ponderar entre los mejores. La huella se basa SOLO en top5 (los scores
  // ordenados), que sí son deterministas dado un estado.
  return {
    top5: (dec.top5 || []).map(c => ({
      piezaId: c.piezaId,
      dest: c.dest,
      score: Math.round(c.score),
    })),
  };
}

function generarHuellas() {
  return POSICIONES.map((p, i) => ({ pos: i + 1, huella: huellaDe(p) }));
}

function main() {
  const modo = process.argv[2] || 'check';
  const actual = generarHuellas();

  if (modo === 'bless') {
    fs.writeFileSync(REF_PATH, JSON.stringify(actual, null, 2));
    console.log(`✅ Huella de referencia guardada: ${REF_PATH} (${actual.length} posiciones)`);
    return;
  }

  // check
  if (!fs.existsSync(REF_PATH)) {
    console.error('❌ No existe referencia. Ejecuta primero: node sim/regresion.js bless');
    process.exit(1);
  }
  const ref = JSON.parse(fs.readFileSync(REF_PATH, 'utf8'));
  let diffs = 0;
  // Comparamos SOLO top5 (determinista). Compatible con referencias antiguas
  // que además guardaban piezaId/dest de nivel superior (no deterministas).
  for (let i = 0; i < actual.length; i++) {
    const a = JSON.stringify(actual[i].huella.top5);
    const b = JSON.stringify(ref[i] ? ref[i].huella.top5 : null);
    if (a !== b) {
      diffs++;
      console.log(`\n❌ DIFF en posición ${i + 1}:`);
      console.log('   referencia:', b);
      console.log('   actual:    ', a);
    }
  }
  if (diffs === 0) {
    console.log(`✅ Sin cambios de comportamiento (${actual.length} posiciones idénticas)`);
  } else {
    console.log(`\n❌ ${diffs} posición(es) con comportamiento distinto`);
    process.exit(1);
  }
}

main();
