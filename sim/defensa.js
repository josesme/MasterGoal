// ============================================================================
// TEST DE ESCENARIOS DEFENSIVOS — MasterGoal
// ----------------------------------------------------------------------------
// Mide objetivamente la calidad de la decisión DEFENSIVA de la IA, sin depender
// de que caigan goles en juego aleatorio.
//
// Para cada escenario (turno = visitante = IA, el rival LOCAL amenaza):
//   1. La IA decide su movimiento de pieza (calcularDecisionJugador).
//   2. Aplicamos ese movimiento.
//   3. Medimos la AMENAZA RESIDUAL: simulamos el mejor turno de ataque del local
//      (iaSimularMejorTurnoLocal devuelve el score desde la perspectiva del
//      visitante; cuanto MÁS BAJO, mejor para el local = peor defensa).
//      Además contamos amenazas directas de gol que quedan abiertas.
//
// Comparamos la IA con marcaje (estilo equilibrado) vs sin marcaje (_sin_marcaje).
// Mejor defensa = amenaza residual del local MENOR (score visitante más alto).
//
//   node sim/defensa.js
// ============================================================================

console.log = (() => { const o = console.log; return (...a) => { if (typeof a[0]==='string' && a[0].includes('PERF')) return; o(...a); }; })();

const ia = require('../ia-worker.js');

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

// ---------------------------------------------------------------------------
// ESCENARIOS DEFENSIVOS — el LOCAL (rival, ataca fila 14) amenaza.
// La IA (visitante, defiende fila 14) debe defender bien.
// Variamos: balón con posesión local, balón neutro, receptores libres, etc.
// ---------------------------------------------------------------------------
// IMPORTANTE: en todos, el LOCAL debe tener POSESIÓN real (mayoría de colindantes
// al balón). Se valida en runtime; si no, el escenario se marca como inválido.
const ESCENARIOS = [
  {
    nombre: 'Local posee en zona IA, receptor libre cerca de área',
    fichas: {
      'l-portero': { fila: 2,  col: 6, equipo: 'local' },
      'l-j1':      { fila: 10, col: 6, equipo: 'local' },  // poseedor (colindante balón)
      'l-j2':      { fila: 11, col: 8, equipo: 'local' },  // receptor libre cerca área
      'l-j3':      { fila: 10, col: 7, equipo: 'local' },  // 2º colindante -> mayoría local
      'l-j4':      { fila: 7,  col: 7, equipo: 'local' },
      'v-portero': { fila: 12, col: 6, equipo: 'visitante' },
      'v-j1':      { fila: 10, col: 4, equipo: 'visitante' },  // 1 colindante (minoría)
      'v-j2':      { fila: 8,  col: 8, equipo: 'visitante' },
      'v-j3':      { fila: 8,  col: 5, equipo: 'visitante' },
      'v-j4':      { fila: 7,  col: 3, equipo: 'visitante' },
      'balon':     { fila: 11, col: 6 },
    },
  },
  {
    nombre: 'Local posee avanzado, línea de tiro abierta a portería',
    fichas: {
      'l-portero': { fila: 2,  col: 6, equipo: 'local' },
      'l-j1':      { fila: 11, col: 7, equipo: 'local' },  // poseedor casi área chica
      'l-j2':      { fila: 11, col: 5, equipo: 'local' },  // 2º colindante
      'l-j3':      { fila: 10, col: 8, equipo: 'local' },  // receptor
      'l-j4':      { fila: 9,  col: 6, equipo: 'local' },
      'v-portero': { fila: 12, col: 5, equipo: 'visitante' },
      'v-j1':      { fila: 11, col: 8, equipo: 'visitante' },  // 1 colindante (minoría)
      'v-j2':      { fila: 9,  col: 4, equipo: 'visitante' },
      'v-j3':      { fila: 8,  col: 7, equipo: 'visitante' },
      'v-j4':      { fila: 8,  col: 3, equipo: 'visitante' },
      'balon':     { fila: 11, col: 6 },
    },
  },
  {
    nombre: 'Contraataque local, dos receptores adelantados libres',
    fichas: {
      'l-portero': { fila: 2,  col: 6, equipo: 'local' },
      'l-j1':      { fila: 10, col: 6, equipo: 'local' },  // colindante (poseedor)
      'l-j2':      { fila: 10, col: 5, equipo: 'local' },  // 2º colindante -> mayoría
      'l-j3':      { fila: 11, col: 8, equipo: 'local' },  // receptor adelantado libre
      'l-j4':      { fila: 6,  col: 4, equipo: 'local' },
      'v-portero': { fila: 12, col: 6, equipo: 'visitante' },
      'v-j1':      { fila: 8,  col: 6, equipo: 'visitante' },  // 1 colindante (minoría)
      'v-j2':      { fila: 11, col: 4, equipo: 'visitante' },
      'v-j3':      { fila: 7,  col: 8, equipo: 'visitante' },
      'v-j4':      { fila: 6,  col: 8, equipo: 'visitante' },
      'balon':     { fila: 9,  col: 6 },
    },
  },
  {
    nombre: 'Local posee en banda, receptor en el centro del área',
    fichas: {
      'l-portero': { fila: 2,  col: 6, equipo: 'local' },
      'l-j1':      { fila: 11, col: 3, equipo: 'local' },  // colindante (poseedor) banda
      'l-j2':      { fila: 10, col: 4, equipo: 'local' },  // 2º colindante -> mayoría
      'l-j3':      { fila: 11, col: 7, equipo: 'local' },  // receptor centro área libre
      'l-j4':      { fila: 8,  col: 6, equipo: 'local' },
      'v-portero': { fila: 12, col: 6, equipo: 'visitante' },
      'v-j1':      { fila: 11, col: 5, equipo: 'visitante' },  // 1 colindante (minoría)
      'v-j2':      { fila: 9,  col: 7, equipo: 'visitante' },
      'v-j3':      { fila: 8,  col: 4, equipo: 'visitante' },
      'v-j4':      { fila: 7,  col: 8, equipo: 'visitante' },
      'balon':     { fila: 11, col: 4 },
    },
  },
  {
    nombre: 'Local posee centro, dos receptores en abanico',
    fichas: {
      'l-portero': { fila: 2,  col: 6, equipo: 'local' },
      'l-j1':      { fila: 10, col: 6, equipo: 'local' },  // colindante (poseedor)
      'l-j2':      { fila: 10, col: 7, equipo: 'local' },  // 2º colindante -> mayoría
      'l-j3':      { fila: 11, col: 4, equipo: 'local' },  // receptor
      'l-j4':      { fila: 11, col: 8, equipo: 'local' },  // receptor
      'v-portero': { fila: 12, col: 6, equipo: 'visitante' },
      'v-j1':      { fila: 8,  col: 6, equipo: 'visitante' },  // 1 colindante (minoría)
      'v-j2':      { fila: 7,  col: 5, equipo: 'visitante' },
      'v-j3':      { fila: 7,  col: 4, equipo: 'visitante' },
      'v-j4':      { fila: 7,  col: 8, equipo: 'visitante' },
      'balon':     { fila: 9,  col: 6 },
    },
  },
];

// Evalúa la amenaza residual tras la mejor defensa de la IA.
// Devuelve el score desde la perspectiva del visitante (más alto = mejor defensa)
// y el nº de amenazas de gol directas que quedan.
function amenazaResidual(estado) {
  // Amenaza INICIAL (sin que la IA mueva nada): si ya es <= -100000, la posición
  // estaba perdida de salida y el "gol" no es culpa de la decisión defensiva.
  ia.setEstado(JSON.parse(JSON.stringify(estado)));
  const amenazaInicial = Math.round(ia.iaSimularMejorTurnoLocal());

  ia.setEstado(JSON.parse(JSON.stringify(estado)));
  const dec = ia.calcularDecisionJugador();
  if (!dec) return { score: null, amenazas: null, mov: null, inicial: amenazaInicial };

  // Aplicar la decisión (la mejor según top5, determinista)
  const mejor = dec.top5[0];
  const st = ia.getEstado();
  st.fichas[mejor.piezaId].fila = mejor.dest.fila;
  st.fichas[mejor.piezaId].col  = mejor.dest.col;

  // Amenaza residual: mejor turno de ataque del local tras nuestra defensa.
  // iaSimularMejorTurnoLocal devuelve score perspectiva visitante (alto = bueno
  // para la IA = mala situación para el local = buena defensa).
  const scoreResidual = ia.iaSimularMejorTurnoLocal();

  // Amenazas de gol directas que quedan abiertas (líneas de balón local a fila 14)
  st.turno = 'local';
  const amenazas = ia.iaDetectarAmenazaGol().length;
  st.turno = 'visitante';

  return { score: Math.round(scoreResidual), amenazas, mov: `${mejor.piezaId}->(${mejor.dest.fila},${mejor.dest.col})`, inicial: amenazaInicial };
}

function correr(estilo) {
  const res = [];
  for (const esc of ESCENARIOS) {
    const st = base({ fichas: JSON.parse(JSON.stringify(esc.fichas)), estiloVisitante: estilo });
    res.push(amenazaResidual(st));
  }
  return res;
}

// Valida que cada escenario sea realmente defensivo (el LOCAL posee el balón).
function validarEscenarios() {
  let ok = true;
  for (let i = 0; i < ESCENARIOS.length; i++) {
    const f = ESCENARIOS[i].fichas;
    // Colisiones: dos fichas en la misma casilla
    const vistas = new Map();
    for (const [id, d] of Object.entries(f)) {
      const k = d.fila + ',' + d.col;
      if (vistas.has(k)) {
        console.log(`⚠️  Escenario ${i + 1} COLISIÓN: ${id} y ${vistas.get(k)} en (${k})`);
        ok = false;
      }
      vistas.set(k, id);
    }
    const st = base({ fichas: JSON.parse(JSON.stringify(f)) });
    ia.setEstado(st);
    if (!ia.equipoTienePosesion('local')) {
      console.log(`⚠️  Escenario ${i + 1} INVÁLIDO: el local NO tiene posesión (no es defensivo)`);
      ok = false;
    }
  }
  return ok;
}

function main() {
  console.log('\n🛡️  TEST DE ESCENARIOS DEFENSIVOS\n');
  console.log('   Métrica: score residual perspectiva visitante tras defender.');
  console.log('   MÁS ALTO = mejor defensa (menos amenaza local). Menos amenazas = mejor.\n');

  if (!validarEscenarios()) {
    console.log('\n❌ Hay escenarios no defensivos. Corrige las posiciones antes de medir.\n');
  }
  console.log('');

  const UMBRAL_GOL = -100000;
  // Modo comparativo: equilibrado vs defensivo lado a lado, para ver si el estilo
  // defensivo aporta ventaja real y dónde falla.
  const resEq  = correr('equilibrado');
  const resDef = correr('defensivo');

  const resumen = (res) => {
    let goles = 0, suma = 0;
    res.forEach(r => { suma += r.score; if (r.score <= UMBRAL_GOL) goles++; });
    return { goles, medio: suma / res.length, defendidos: res.length - goles };
  };

  for (let i = 0; i < ESCENARIOS.length; i++) {
    const e = resEq[i], d = resDef[i];
    const vE = e.score <= UMBRAL_GOL ? '❌' : '🛡️ ';
    const vD = d.score <= UMBRAL_GOL ? '❌' : '🛡️ ';
    const yaPerdido = e.inicial <= UMBRAL_GOL;
    console.log(`${i + 1}. ${ESCENARIOS[i].nombre}`);
    console.log(`   amenaza inicial (sin mover): ${e.inicial}${yaPerdido ? '  ⚠️ POSICIÓN YA PERDIDA' : ''}`);
    console.log(`   EQUIL: ${vE} score=${e.score}  amen=${e.amenazas}  ${e.mov}`);
    console.log(`   DEFEN: ${vD} score=${d.score}  amen=${d.amenazas}  ${d.mov}`);
    if (d.mov !== e.mov) console.log(`   ↳ el defensivo ELIGE DISTINTO`);
    console.log('');
  }

  const sE = resumen(resEq), sD = resumen(resDef);
  console.log('─'.repeat(55));
  console.log(`EQUILIBRADO  defendidos ${sE.defendidos}/${ESCENARIOS.length}  goles ${sE.goles}  score medio ${sE.medio.toFixed(0)}`);
  console.log(`DEFENSIVO    defendidos ${sD.defendidos}/${ESCENARIOS.length}  goles ${sD.goles}  score medio ${sD.medio.toFixed(0)}`);
  const delta = sD.medio - sE.medio;
  console.log(`Δ defensivo vs equilibrado: ${delta >= 0 ? '+' : ''}${delta.toFixed(0)} (positivo = el defensivo defiende mejor)`);
  console.log('─'.repeat(55));
}

main();
