// ============================================================================
// HARNESS DE AUTO-JUEGO — MasterGoal
// ----------------------------------------------------------------------------
// Enfrenta la IA contra sí misma en partidas headless (sin DOM) para medir
// objetivamente el impacto de cambios en el motor de decisión.
//
// La IA de ia-worker.js está hardcodeada para jugar SIEMPRE como 'visitante'
// (ataca fila 0, defiende fila 14). Para que el 'local' use el mismo cerebro,
// el harness ESPEJA el tablero en el turno del local: voltea filas (f -> 14-f)
// e intercambia equipos, pide la decisión "como visitante", y desvoltea el
// resultado. Así ambos bandos juegan con idéntica lógica y la comparación es
// justa.
//
// Uso:
//   node sim/harness.js [nPartidas] [maxTurnos]
//   node sim/harness.js 50 400
// ============================================================================

// Silenciar los logs de PERF del worker (uno por turno) — ruido masivo en batch.
const _origLog = console.log;
console.log = function (...args) {
  if (typeof args[0] === 'string' && args[0].includes('PERF')) return;
  _origLog.apply(console, args);
};

const ia = require('../ia-worker.js');

// ---------------------------------------------------------------------------
// Posiciones iniciales (copiadas de index.html, estado.fichas)
// ---------------------------------------------------------------------------
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

function clonarFichas(f) { return JSON.parse(JSON.stringify(f)); }

// ---------------------------------------------------------------------------
// ESPEJADO — voltea el tablero verticalmente e intercambia equipos.
// El local (ataca fila 14) se convierte en visitante (ataca fila 0).
// Las IDs de pieza también se intercambian l<->v para mantener coherencia
// con esPortero() y los filtros por equipo dentro del worker.
// ---------------------------------------------------------------------------
function espejarId(id) {
  if (!id) return id;
  if (id === 'balon') return 'balon';
  if (id.startsWith('l-')) return 'v-' + id.slice(2);
  if (id.startsWith('v-')) return 'l-' + id.slice(2);
  return id;
}

function espejarFichas(fichas) {
  const out = {};
  for (const [id, d] of Object.entries(fichas)) {
    const nid = espejarId(id);
    out[nid] = {
      fila: 14 - d.fila,
      col: d.col,
    };
    if (d.equipo) out[nid].equipo = d.equipo === 'local' ? 'visitante' : 'local';
  }
  return out;
}

// Desvoltea una coordenada {fila,col} de vuelta al marco real
function desespejarCoord(c) {
  return { fila: 14 - c.fila, col: c.col };
}

// ---------------------------------------------------------------------------
// MOTOR DE REGLAS (puro, sin DOM) — replica el bucle de turno de index.html
// ---------------------------------------------------------------------------

// Construye el objeto `estado` que el worker espera, desde la perspectiva del
// equipo que mueve. Si el que mueve es el local, espeja todo.
function construirEstadoParaIA(estadoReal, turnoReal) {
  const esLocal = turnoReal === 'local';
  const fichas = esLocal ? espejarFichas(estadoReal.fichas) : clonarFichas(estadoReal.fichas);
  return {
    fichas,
    turno: 'visitante', // la IA siempre razona como visitante
    fase: estadoReal.fase,
    movimientosBalon: estadoReal.movimientosBalon,
    ultimoPasador: esLocal ? espejarId(estadoReal.ultimoPasador) : estadoReal.ultimoPasador,
    turnoExtra: estadoReal.turnoExtra,
    marcador: esLocal
      ? { visitante: estadoReal.marcador.local, local: estadoReal.marcador.visitante }
      : { visitante: estadoReal.marcador.visitante, local: estadoReal.marcador.local },
    nivelIA: 'imbatible',     // sin error aleatorio para medir la calidad pura
    potencialRival: 3,
    estiloVisitante: estadoReal.estiloVisitante || 'equilibrado',
  };
}

// Aplica el resultado de la IA (que vino en marco "visitante") al estado real,
// desvolteando si el que movía era el local.
function decisionAlMarcoReal(decision, turnoReal, tipo) {
  const esLocal = turnoReal === 'local';
  if (!decision) return null;
  if (tipo === 'JUGADOR') {
    const piezaId = esLocal ? espejarId(decision.piezaId) : decision.piezaId;
    const dest = esLocal ? desespejarCoord(decision.dest) : decision.dest;
    return { piezaId, dest };
  } else {
    const dest = esLocal ? desespejarCoord(decision.dest) : decision.dest;
    const secuencia = (decision.secuencia || []).map(s => esLocal ? desespejarCoord(s) : s);
    return { dest, secuencia };
  }
}

// Cuenta colindantes reales (sin espejar) para decidir posesión en el marco real
function contarColindantesReal(fichas) {
  const b = fichas.balon;
  let local = 0, visitante = 0;
  for (const [id, d] of Object.entries(fichas)) {
    if (id === 'balon') continue;
    const col = Math.abs(d.fila - b.fila) <= 1 && Math.abs(d.col - b.col) <= 1
      && !(d.fila === b.fila && d.col === b.col);
    if (!col) continue;
    if (d.equipo === 'local') local++; else visitante++;
  }
  return { local, visitante };
}

function tienePosesionReal(fichas, equipo) {
  const c = contarColindantesReal(fichas);
  if (equipo === 'local') return c.local > c.visitante;
  return c.visitante > c.local;
}

// ¿El balón está en portería? fila 0 => gol del visitante; fila 14 => gol del local
function golEn(fichas) {
  const b = fichas.balon;
  if (b.fila === 0 && b.col >= 4 && b.col <= 8) return 'visitante';
  if (b.fila === 14 && b.col >= 4 && b.col <= 8) return 'local';
  return null;
}

// Casilla especial (amarilla): cols 1,4-8,11 en la línea de fondo contraria
// local ataca fila 13, visitante fila 1; pierde condición si está ocupada
function esCasillaEspecialReal(fichas, f, c, equipo) {
  if (c !== 1 && (c < 4 || c > 8) && c !== 11) return false;
  for (const [id, d] of Object.entries(fichas)) {
    if (id === 'balon') continue;
    if (d.fila === f && d.col === c) return false;
  }
  return equipo === 'local' ? f === 13 : f === 1;
}

// ---------------------------------------------------------------------------
// SIMULACIÓN DE UNA PARTIDA
// ---------------------------------------------------------------------------
function jugarPartida(maxTurnos, estiloVisitante, estiloLocal) {
  const estadoReal = {
    fichas: clonarFichas(POSICIONES_INICIALES),
    turno: Math.random() < 0.5 ? 'local' : 'visitante',
    fase: 'MOVER_JUGADOR',
    movimientosBalon: 0,
    ultimoPasador: null,
    turnoExtra: false,
    marcador: { local: 0, visitante: 0 },
  };

  const stats = {
    turnos: 0,
    movsJugadorLocal: 0, movsJugadorVis: 0,
    posesionLocal: 0, posesionVis: 0,
    secuenciasPaseLocal: 0, secuenciasPaseVis: 0,
  };

  const DEBUG = process.env.HARNESS_DEBUG === '1';

  for (let t = 0; t < maxTurnos; t++) {
    stats.turnos++;
    const turno = estadoReal.turno;
    const _tt = Date.now();
    estadoReal.estiloVisitante = turno === 'visitante' ? estiloVisitante : estiloLocal;
    estadoReal.fase = 'MOVER_JUGADOR';
    estadoReal.movimientosBalon = 0;
    estadoReal.ultimoPasador = null;

    // ── FASE 1: mover una pieza ──────────────────────────────────────────
    const estIA = construirEstadoParaIA(estadoReal, turno);
    ia.setEstado(estIA);
    const _tj = Date.now();
    const decJ = ia.calcularDecisionJugador();
    if (DEBUG) _origLog(`  turno ${t} (${turno}) jugador: ${Date.now() - _tj}ms`);
    const movJ = decisionAlMarcoReal(decJ, turno, 'JUGADOR');
    if (!movJ) { // sin movimiento posible: cambia turno
      estadoReal.turno = turno === 'local' ? 'visitante' : 'local';
      continue;
    }
    estadoReal.fichas[movJ.piezaId].fila = movJ.dest.fila;
    estadoReal.fichas[movJ.piezaId].col  = movJ.dest.col;
    if (turno === 'local') stats.movsJugadorLocal++; else stats.movsJugadorVis++;

    // ── FASE 2: ¿consigue posesión? entonces mueve el balón ──────────────
    if (!tienePosesionReal(estadoReal.fichas, turno)) {
      estadoReal.turno = turno === 'local' ? 'visitante' : 'local';
      continue;
    }
    if (turno === 'local') stats.posesionLocal++; else stats.posesionVis++;

    // Cadena de hasta 4 movimientos de balón
    let movRestantes = 4;
    let turnoExtra = false;
    let movioBalon = false;
    while (movRestantes > 0) {
      estadoReal.movimientosBalon = 4 - movRestantes;
      const estB = construirEstadoParaIA(estadoReal, turno);
      ia.setEstado(estB);
      const decB = ia.calcularDecisionBalon(movRestantes);
      const movB = decisionAlMarcoReal(decB, turno, 'BALON');
      if (!movB || !movB.dest) break;

      // Mover el balón
      estadoReal.fichas.balon.fila = movB.dest.fila;
      estadoReal.fichas.balon.col  = movB.dest.col;
      movioBalon = true;
      movRestantes--;

      // ¿Gol?
      const g = golEn(estadoReal.fichas);
      if (g) {
        estadoReal.marcador[g]++;
        // recolocar; saca el equipo al que le marcaron
        estadoReal.fichas = clonarFichas(POSICIONES_INICIALES);
        estadoReal.turno = g === 'visitante' ? 'local' : 'visitante';
        movioBalon = false;
        break;
      }

      // ¿Sigue con posesión? si no, fin de la cadena
      if (!tienePosesionReal(estadoReal.fichas, turno)) break;

      // ¿Casilla especial? turno extra
      const b = estadoReal.fichas.balon;
      if (esCasillaEspecialReal(estadoReal.fichas, b.fila, b.col, turno)) {
        turnoExtra = true;
      }
    }
    if (turno === 'local') stats.secuenciasPaseLocal++; else stats.secuenciasPaseVis++;

    // Si hubo gol, ya se fijó el turno en el bloque de gol
    if (golEn(estadoReal.fichas)) continue; // no debería, ya recolocado

    // Turno extra por casilla especial: mismo equipo repite
    if (turnoExtra) {
      // mismo turno
    } else {
      estadoReal.turno = turno === 'local' ? 'visitante' : 'local';
    }

    // Fin por goleada o decisión (a 2 goles diferencia, opcional)
  }

  return { marcador: estadoReal.marcador, stats };
}

// ---------------------------------------------------------------------------
// RUNNER
// ---------------------------------------------------------------------------
function main() {
  const nPartidas = parseInt(process.argv[2] || '20', 10);
  const maxTurnos = parseInt(process.argv[3] || '300', 10);
  const estiloVis = process.argv[4] || 'equilibrado';
  const estiloLoc = process.argv[5] || 'equilibrado';

  console.log(`\n🏟️  HARNESS MasterGoal — ${nPartidas} partidas, máx ${maxTurnos} turnos`);
  console.log(`    visitante: ${estiloVis}  vs  local: ${estiloLoc}\n`);

  let golesVis = 0, golesLoc = 0;
  let ganaVis = 0, ganaLoc = 0, empates = 0;
  const t0 = Date.now();

  for (let i = 0; i < nPartidas; i++) {
    const r = jugarPartida(maxTurnos, estiloVis, estiloLoc);
    golesVis += r.marcador.visitante;
    golesLoc += r.marcador.local;
    if (r.marcador.visitante > r.marcador.local) ganaVis++;
    else if (r.marcador.local > r.marcador.visitante) ganaLoc++;
    else empates++;
    process.stdout.write(`  partida ${i + 1}/${nPartidas}: ${r.marcador.visitante}-${r.marcador.local}   \r`);
  }

  const ms = Date.now() - t0;
  console.log('\n');
  console.log('─'.repeat(50));
  console.log(`Goles  visitante: ${golesVis}   local: ${golesLoc}`);
  console.log(`Media  visitante: ${(golesVis / nPartidas).toFixed(2)}   local: ${(golesLoc / nPartidas).toFixed(2)}`);
  console.log(`Result visitante: ${ganaVis}W   local: ${ganaLoc}W   empates: ${empates}`);
  console.log(`Tiempo: ${(ms / 1000).toFixed(1)}s  (${(ms / nPartidas).toFixed(0)}ms/partida)`);
  console.log('─'.repeat(50));
}

main();
