// ============================================================================
// GENERADOR DEL LIBRO DE APERTURAS — MasterGoal
// ----------------------------------------------------------------------------
// Para cada estilo y cada posición de apertura conocida, corre la IA y captura
// el TURNO COMPLETO (movimiento de pieza + cadena de pases de balón), indexando
// cada movimiento por la FIRMA de la posición en la que se aplica.
//
// Vuelca un objeto LIBRO_APERTURAS listo para pegar en ia-worker.js.
//
//   node sim/generar-libro.js
//
// Es lento (en imbatible, el saque de centro son ~38s por estilo) pero se corre
// UNA vez en desarrollo; en partida el libro responde al instante.
// ============================================================================

// Silenciar el ruido de PERF del worker
console.log = (() => { const o = console.log; return (...a) => { if (typeof a[0]==='string' && a[0].includes('PERF')) return; o(...a); }; })();

const ia = require('../ia-worker.js');

// Posiciones iniciales estándar (saque de centro). Copiado de index.html.
const POSICIONES_INICIALES = {
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
};

// Aperturas a capturar. De momento, el saque de centro (la IA siempre como
// visitante). Ampliable con más posiciones.
const APERTURAS = [
  { nombre: 'saque-centro', fichas: POSICIONES_INICIALES },
];

// Estilos para los que generar (la IA juega como visitante).
const ESTILOS = ['equilibrado', 'defensivo', 'presion', 'contraataque'];

const NIVEL = 'imbatible'; // el libro captura la mejor jugada (máxima profundidad)

function clon(o) { return JSON.parse(JSON.stringify(o)); }

function estadoBase(fichas, estilo, fase) {
  return {
    fichas: clon(fichas),
    turno: 'visitante',
    fase: fase || 'MOVER_JUGADOR',
    movimientosBalon: 0,
    ultimoPasador: null,
    turnoExtra: false,
    marcador: { local: 0, visitante: 0 },
    nivelIA: NIVEL,
    potencialRival: 3,
    estiloVisitante: estilo,
  };
}

// Captura el turno completo de la IA desde una posición, para un estilo.
// Devuelve un mapa { firma: movimiento } con la pieza y cada paso de balón.
function capturarTurno(fichas, estilo) {
  const movimientos = {};
  let st = estadoBase(fichas, estilo, 'MOVER_JUGADOR');
  ia.setEstado(st);

  // 1) Movimiento de pieza
  const firmaPieza = ia.firmaPosicion();
  const t0 = Date.now();
  const decJ = ia.calcularDecisionJugador();
  process.stderr.write(`    pieza: ${Date.now() - t0}ms\n`);
  if (!decJ) return movimientos;
  movimientos[firmaPieza] = { tipo: 'pieza', piezaId: decJ.piezaId, dest: { fila: decJ.dest.fila, col: decJ.dest.col } };

  // Aplicar el movimiento de pieza
  st.fichas[decJ.piezaId].fila = decJ.dest.fila;
  st.fichas[decJ.piezaId].col  = decJ.dest.col;

  // 2) Si ganó posesión, cadena de balón
  st.fase = 'MOVER_BALON';
  st.movimientosBalon = 0;
  st.ultimoPasador = null;
  ia.setEstado(st);
  if (!ia.equipoTienePosesion('visitante')) return movimientos; // sin posesión: turno acaba

  for (let mov = 0; mov < 4; mov++) {
    st.movimientosBalon = mov;
    ia.setEstado(st);
    const firmaBalon = ia.firmaPosicion();
    const tb = Date.now();
    const decB = ia.calcularDecisionBalon(4 - mov);
    process.stderr.write(`    balón mov${mov + 1}: ${Date.now() - tb}ms\n`);
    if (!decB || !decB.dest) break;
    movimientos[firmaBalon] = { tipo: 'balon', dest: { fila: decB.dest.fila, col: decB.dest.col } };
    // Aplicar el paso de balón
    st.fichas.balon.fila = decB.dest.fila;
    st.fichas.balon.col  = decB.dest.col;
    // ¿Gol o pérdida de posesión? entonces la cadena termina
    const g = (decB.dest.fila === 0 && decB.dest.col >= 4 && decB.dest.col <= 8);
    if (g) break;
    ia.setEstado(st);
    if (!ia.equipoTienePosesion('visitante')) break;
  }
  return movimientos;
}

function main() {
  const libro = {}; // libro[estilo][firma] = movimiento
  for (const estilo of ESTILOS) {
    libro[estilo] = {};
    for (const ap of APERTURAS) {
      process.stderr.write(`Capturando ${ap.nombre} / ${estilo}...\n`);
      const movs = capturarTurno(ap.fichas, estilo);
      Object.assign(libro[estilo], movs);
    }
  }

  // Volcar como JS pegable en ia-worker.js
  const json = JSON.stringify(libro, null, 2);
  console.log('\n// ====== LIBRO GENERADO (pegar el contenido en const LIBRO_APERTURAS) ======');
  console.log('const LIBRO_APERTURAS = ' + json + ';');
  console.log('// ====== FIN LIBRO GENERADO ======\n');
}

main();
