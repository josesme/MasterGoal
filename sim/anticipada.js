// ============================================================================
// TEST DE DEFENSA ANTICIPADA — MasterGoal
// ----------------------------------------------------------------------------
// Mide si la IA se posiciona para EVITAR que el rival construya una jugada de
// gol, cuando el balón aún NO está en zona crítica (transición/medio campo).
//
// A diferencia de sim/defensa.js (que mide la defensa de emergencia con el balón
// ya en el área), aquí el local tiene posesión en zona MEDIA y la IA debe
// anticiparse: cubrir receptores adelantados, no dejar carriles libres al área.
//
// Métrica: tras la decisión de la IA, simulamos 2 turnos del local (mover+pases,
// luego mover+pases otra vez) para ver si LLEGA a una posición de gol. Una buena
// defensa anticipada retrasa o impide esa progresión.
//
//   node sim/anticipada.js
// ============================================================================

console.log = (() => { const o = console.log; return (...a) => { if (typeof a[0]==='string' && a[0].includes('PERF')) return; o(...a); }; })();

const ia = require('../ia-worker.js');

function base(extra) {
  return Object.assign({
    turno: 'visitante', fase: 'MOVER_JUGADOR', movimientosBalon: 0,
    ultimoPasador: null, turnoExtra: false, marcador: { local: 0, visitante: 0 },
    nivelIA: 'imbatible', potencialRival: 3, estiloVisitante: 'equilibrado',
  }, extra);
}

// Escenarios: local con posesión en zona MEDIA (balón fila 6-8), construyendo.
// La IA defiende anticipándose. Receptores locales adelantados que, si no se
// cubren, recibirán cerca del área.
const ESCENARIOS = [
  {
    nombre: 'Local construye en medio campo, receptor adelantado libre',
    fichas: {
      'l-portero': { fila: 2,  col: 6, equipo: 'local' },
      'l-j1':      { fila: 7,  col: 6, equipo: 'local' },  // poseedor (colindante balón)
      'l-j2':      { fila: 7,  col: 5, equipo: 'local' },  // 2º colindante -> mayoría
      'l-j3':      { fila: 10, col: 7, equipo: 'local' },  // receptor adelantado LIBRE
      'l-j4':      { fila: 9,  col: 4, equipo: 'local' },  // receptor adelantado
      'v-portero': { fila: 12, col: 6, equipo: 'visitante' },
      'v-j1':      { fila: 8,  col: 7, equipo: 'visitante' },  // 1 colindante (minoría)
      'v-j2':      { fila: 9,  col: 8, equipo: 'visitante' },
      'v-j3':      { fila: 10, col: 5, equipo: 'visitante' },
      'v-j4':      { fila: 8,  col: 3, equipo: 'visitante' },
      'balon':     { fila: 8,  col: 6 },
    },
  },
  {
    nombre: 'Local sale jugando, dos carriles hacia el área',
    fichas: {
      'l-portero': { fila: 2,  col: 6, equipo: 'local' },
      'l-j1':      { fila: 6,  col: 6, equipo: 'local' },  // poseedor
      'l-j2':      { fila: 6,  col: 5, equipo: 'local' },  // 2º colindante
      'l-j3':      { fila: 9,  col: 3, equipo: 'local' },  // receptor carril izq
      'l-j4':      { fila: 9,  col: 9, equipo: 'local' },  // receptor carril der
      'v-portero': { fila: 12, col: 6, equipo: 'visitante' },
      'v-j1':      { fila: 7,  col: 7, equipo: 'visitante' },  // 1 colindante (minoría)
      'v-j2':      { fila: 10, col: 5, equipo: 'visitante' },
      'v-j3':      { fila: 10, col: 8, equipo: 'visitante' },
      'v-j4':      { fila: 7,  col: 4, equipo: 'visitante' },
      'balon':     { fila: 7,  col: 6 },
    },
  },
  {
    nombre: 'Local progresa por banda, receptor central peligroso',
    fichas: {
      'l-portero': { fila: 2,  col: 6, equipo: 'local' },
      'l-j1':      { fila: 8,  col: 3, equipo: 'local' },  // poseedor banda
      'l-j2':      { fila: 7,  col: 3, equipo: 'local' },  // 2º colindante
      'l-j3':      { fila: 10, col: 6, equipo: 'local' },  // receptor central LIBRE
      'l-j4':      { fila: 9,  col: 8, equipo: 'local' },  // receptor
      'v-portero': { fila: 12, col: 6, equipo: 'visitante' },
      'v-j1':      { fila: 8,  col: 5, equipo: 'visitante' },  // 1 colindante (minoría)
      'v-j2':      { fila: 10, col: 4, equipo: 'visitante' },
      'v-j3':      { fila: 11, col: 7, equipo: 'visitante' },
      'v-j4':      { fila: 6,  col: 6, equipo: 'visitante' },
      'balon':     { fila: 8,  col: 4 },
    },
  },
];

// Simula N turnos completos del LOCAL (pieza + cadena de balón) usando la propia
// IA espejada, y reporta si llega a gol y la amenaza final.
function progresionLocal(estado, nTurnos) {
  // Reutiliza iaSimularMejorTurnoLocal como proxy de "qué tan cerca del gol
  // queda el local en su próximo turno". Más negativo = más peligro.
  ia.setEstado(JSON.parse(JSON.stringify(estado)));
  return ia.iaSimularMejorTurnoLocal();
}

function validar() {
  let ok = true;
  for (let i = 0; i < ESCENARIOS.length; i++) {
    const f = ESCENARIOS[i].fichas;
    const seen = new Map();
    for (const [id, d] of Object.entries(f)) {
      const k = d.fila + ',' + d.col;
      if (seen.has(k)) { console.log(`⚠️  Esc ${i+1} COLISIÓN: ${id}/${seen.get(k)} en ${k}`); ok = false; }
      seen.set(k, id);
    }
    ia.setEstado(base({ fichas: JSON.parse(JSON.stringify(f)) }));
    if (!ia.equipoTienePosesion('local')) { console.log(`⚠️  Esc ${i+1}: local NO posee`); ok = false; }
  }
  return ok;
}

function main() {
  console.log('\n🧱  TEST DE DEFENSA ANTICIPADA\n');
  console.log('   Local construye desde zona media. La IA debe anticiparse.');
  console.log('   Métrica: amenaza del local tras la defensa (más alto = mejor).\n');

  if (!validar()) { console.log('\n❌ Escenarios inválidos.\n'); return; }
  console.log('');

  for (let i = 0; i < ESCENARIOS.length; i++) {
    const st = base({ fichas: JSON.parse(JSON.stringify(ESCENARIOS[i].fichas)) });
    ia.setEstado(JSON.parse(JSON.stringify(st)));
    const dec = ia.calcularDecisionJugador();
    const mejor = dec ? dec.top5[0] : null;

    // Amenaza ANTES de defender (referencia)
    ia.setEstado(JSON.parse(JSON.stringify(st)));
    const amenazaAntes = Math.round(ia.iaSimularMejorTurnoLocal());

    // Amenaza DESPUÉS de la defensa elegida
    let amenazaDespues = null, mov = 'ninguno';
    if (mejor) {
      const st2 = JSON.parse(JSON.stringify(st));
      st2.fichas[mejor.piezaId].fila = mejor.dest.fila;
      st2.fichas[mejor.piezaId].col = mejor.dest.col;
      ia.setEstado(st2);
      amenazaDespues = Math.round(ia.iaSimularMejorTurnoLocal());
      mov = `${mejor.piezaId}->(${mejor.dest.fila},${mejor.dest.col})`;
    }

    const delta = amenazaDespues - amenazaAntes;
    console.log(`${i + 1}. ${ESCENARIOS[i].nombre}`);
    console.log(`   defensa=${mov}`);
    console.log(`   amenaza antes=${amenazaAntes}  después=${amenazaDespues}  Δ=${delta >= 0 ? '+' : ''}${delta}`);
    console.log(`   ${delta > 0 ? '✅ reduce amenaza' : delta < 0 ? '❌ empeora' : '➖ igual'}\n`);
  }
}

main();
