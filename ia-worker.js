// Web Worker para el cálculo de la IA de MasterGoal
// Recibe el estado serializado y devuelve la decisión sin bloquear el hilo principal

let estado = null;

// ====== FUNCIONES DEL TABLERO (copia pura, sin DOM) ======

function esCasillaValida(f, c) {
  return f >= 1 && f <= 13 && c >= 1 && c <= 11;
}

function esPorteria(f, c) {
  return (f === 0 && c >= 4 && c <= 8) || (f === 14 && c >= 4 && c <= 8);
}

function estaOcupada(f, c, exceptoId) {
  for (const [id, d] of Object.entries(estado.fichas)) {
    if (id === exceptoId) continue;
    if (d.fila === f && d.col === c) return true;
  }
  return false;
}

function esColindanteAlBalon(f, c) {
  const b = estado.fichas.balon;
  return Math.abs(f - b.fila) <= 1 && Math.abs(c - b.col) <= 1 && !(f === b.fila && c === b.col);
}

function contarColindantes() {
  let blanco = 0, rojo = 0;
  for (const [id, d] of Object.entries(estado.fichas)) {
    if (id === 'balon') continue;
    if (esColindanteAlBalon(d.fila, d.col)) {
      if (d.equipo === 'blanco') blanco++;
      else rojo++;
    }
  }
  return { blanco, rojo };
}

function equipoTienePosesion(equipo) {
  const c = contarColindantes();
  if (equipo === 'blanco') return c.blanco > c.rojo;
  return c.rojo > c.blanco;
}

function esPortero(id) {
  return id === 'b-portero' || id === 'r-portero';
}

function obtenerColindantesEquipo(balonF, balonC, equipo) {
  const colindantes = [];
  for (const [id, d] of Object.entries(estado.fichas)) {
    if (id === 'balon') continue;
    if (d.equipo === equipo && Math.abs(d.fila - balonF) <= 1 && Math.abs(d.col - balonC) <= 1 && !(d.fila === balonF && d.col === balonC)) {
      colindantes.push(id);
    }
  }
  return colindantes;
}

function esAutopase(filaDest, colDest) {
  const equipo = estado.turno;
  const actuales = obtenerColindantesEquipo(estado.fichas.balon.fila, estado.fichas.balon.col, equipo);
  const destino = obtenerColindantesEquipo(filaDest, colDest, equipo);
  if (actuales.length === 1 && destino.length === 1 && actuales[0] === destino[0]) return true;
  return false;
}

function obtenerCasillasPortero(porteroId) {
  const portero = estado.fichas[porteroId];
  const esBlanco = porteroId === 'b-portero';
  const casillas = [{ fila: portero.fila, col: portero.col, tipo: 'portero' }];
  const brazoIzq = { fila: portero.fila, col: portero.col - 1, tipo: 'brazo' };
  const brazoDer = { fila: portero.fila, col: portero.col + 1, tipo: 'brazo' };
  const enAreaGrande = (f, c) => {
    if (esBlanco) return f >= 1 && f <= 4 && c >= 2 && c <= 10;
    else return f >= 10 && f <= 13 && c >= 2 && c <= 10;
  };
  if (enAreaGrande(brazoIzq.fila, brazoIzq.col)) casillas.push(brazoIzq);
  if (enAreaGrande(brazoDer.fila, brazoDer.col)) casillas.push(brazoDer);
  return casillas;
}

function saltaPorteroContrario(fOrigen, cOrigen, fDest, cDest) {
  const equipo = estado.turno;
  const rival = equipo === 'blanco' ? 'rojo' : 'blanco';
  const idPorteroRival = rival === 'blanco' ? 'b-portero' : 'r-portero';
  const casillasPortero = obtenerCasillasPortero(idPorteroRival);
  const df = Math.sign(fDest - fOrigen);
  const dc = Math.sign(cDest - cOrigen);
  let cf = fOrigen + df, cc = cOrigen + dc;
  while (cf !== fDest || cc !== cDest) {
    for (const casilla of casillasPortero) {
      if (cf === casilla.fila && cc === casilla.col) return true;
    }
    cf += df; cc += dc;
  }
  return false;
}

function saltaJugadorEnAreaChica(fOrigen, cOrigen, fDest, cDest) {
  const df = Math.sign(fDest - fOrigen);
  const dc = Math.sign(cDest - cOrigen);
  let cf = fOrigen + df, cc = cOrigen + dc;
  while (cf !== fDest || cc !== cDest) {
    const enAreaChica = (cf >= 1 && cf <= 2 && cc >= 3 && cc <= 9) ||
                        (cf >= 12 && cf <= 13 && cc >= 3 && cc <= 9);
    if (enAreaChica) {
      const equipoRival = estado.turno === 'blanco' ? 'rojo' : 'blanco';
      for (const [id, d] of Object.entries(estado.fichas)) {
        if (id === 'balon') continue;
        if (d.equipo !== equipoRival) continue;
        if (d.fila === cf && d.col === cc) return true;
      }
    }
    cf += df; cc += dc;
  }
  return false;
}

function esBrazoPorteroRival(f, c) {
  const equipo = estado.turno;
  const rival = equipo === 'blanco' ? 'rojo' : 'blanco';
  const idPorteroRival = rival === 'blanco' ? 'b-portero' : 'r-portero';
  const portero = estado.fichas[idPorteroRival];
  const esBrazoIzq = (f === portero.fila && c === portero.col - 1);
  const esBrazoDer = (f === portero.fila && c === portero.col + 1);
  if (!esBrazoIzq && !esBrazoDer) return false;
  const esBlanco = rival === 'blanco';
  const enAreaGrande = esBlanco
    ? (f >= 1 && f <= 4 && c >= 2 && c <= 10)
    : (f >= 10 && f <= 13 && c >= 2 && c <= 10);
  return enAreaGrande;
}

function obtenerDestinosJugador(f, c) {
  const dest = [];
  const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  for (const [df, dc] of dirs) {
    let f1 = f + df, c1 = c + dc;
    if (esCasillaValida(f1, c1) && !esBrazoPorteroRival(f1, c1)) {
      dest.push({ fila: f1, col: c1 });
    }
    let f2 = f + df * 2, c2 = c + dc * 2;
    if (esCasillaValida(f2, c2) && !estaOcupada(f1, c1, null) && !esBrazoPorteroRival(f2, c2)) {
      dest.push({ fila: f2, col: c2 });
    }
  }
  return dest;
}

function esDestinoValidoCuartoMovimiento(f, c) {
  if (esPorteria(f, c)) return true;
  if (estado.turno === 'blanco' && ((f === 1 && c === 1) || (f === 1 && c === 11))) return false;
  if (estado.turno === 'rojo'   && ((f === 13 && c === 1) || (f === 13 && c === 11))) return false;
  if (estado.turno === 'blanco') {
    if (f >= 1 && f <= 4 && c >= 2 && c <= 10) return false;
  } else {
    if (f >= 10 && f <= 13 && c >= 2 && c <= 10) return false;
  }
  const balonOriginal = { ...estado.fichas.balon };
  estado.fichas.balon.fila = f;
  estado.fichas.balon.col = c;
  const nadaTienePosesion = !equipoTienePosesion('blanco') && !equipoTienePosesion('rojo');
  estado.fichas.balon.fila = balonOriginal.fila;
  estado.fichas.balon.col = balonOriginal.col;
  return nadaTienePosesion;
}

function obtenerDestinosBalon(f, c) {
  let dest = [];
  const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  for (const [df, dc] of dirs) {
    for (let dist = 1; dist <= 4; dist++) {
      let nf = f + df * dist, nc = c + dc * dist;
      if (esCasillaValida(nf, nc) || esPorteria(nf, nc)) {
        if (!estaOcupada(nf, nc, 'balon')) {
          dest.push({ fila: nf, col: nc, dist });
        }
      } else {
        break;
      }
    }
  }
  dest = dest.filter(d => !saltaPorteroContrario(f, c, d.fila, d.col));
  dest = dest.filter(d => !saltaJugadorEnAreaChica(f, c, d.fila, d.col));
  dest = dest.filter(d => {
    if (estado.turno === 'blanco') {
      if (d.fila === 0) return false;
      if (d.fila === 1 && (d.col === 1 || d.col === 11)) return false;
    }
    if (estado.turno === 'rojo') {
      if (d.fila === 14) return false;
      if (d.fila === 13 && (d.col === 1 || d.col === 11)) return false;
    }
    return true;
  });
  dest = dest.filter(d => !esAutopase(d.fila, d.col));
  if (estado.movimientosBalon === 3) {
    return dest.filter(d => esDestinoValidoCuartoMovimiento(d.fila, d.col));
  }
  const balonOriginal2 = { ...estado.fichas.balon };
  dest = dest.filter(d => {
    if (esPorteria(d.fila, d.col)) return true;
    estado.fichas.balon.fila = d.fila;
    estado.fichas.balon.col = d.col;
    const siguePosesion = equipoTienePosesion(estado.turno);
    const valido = siguePosesion || esDestinoValidoCuartoMovimiento(d.fila, d.col);
    estado.fichas.balon.fila = balonOriginal2.fila;
    estado.fichas.balon.col = balonOriginal2.col;
    return valido;
  });
  if (estado.movimientosBalon < 3) {
    const movsActual = estado.movimientosBalon;
    dest = dest.filter(d => {
      if (esPorteria(d.fila, d.col)) return true;
      estado.fichas.balon.fila = d.fila;
      estado.fichas.balon.col = d.col;
      estado.movimientosBalon = movsActual + 1;
      const siguientes = obtenerDestinosBalon(d.fila, d.col);
      estado.fichas.balon.fila = balonOriginal2.fila;
      estado.fichas.balon.col = balonOriginal2.col;
      estado.movimientosBalon = movsActual;
      if (siguientes.length > 0) return true;
      estado.fichas.balon.fila = d.fila;
      estado.fichas.balon.col = d.col;
      const puedeTerminar = !equipoTienePosesion(estado.turno) && esDestinoValidoCuartoMovimiento(d.fila, d.col);
      estado.fichas.balon.fila = balonOriginal2.fila;
      estado.fichas.balon.col = balonOriginal2.col;
      return puedeTerminar;
    });
  }
  return dest;
}

// ====== FUNCIONES IA ======

function iaDistancia(f1, c1, f2, c2) {
  return Math.abs(f1 - f2) + Math.abs(c1 - c2);
}

function iaColindantesSimulados(bf, bc, equipo) {
  let n = 0;
  for (const [id, d] of Object.entries(estado.fichas)) {
    if (id === 'balon' || d.equipo !== equipo) continue;
    if (Math.abs(d.fila - bf) <= 1 && Math.abs(d.col - bc) <= 1) n++;
  }
  return n;
}

function iaElegir(candidatos) {
  if (candidatos.length === 0) return null;
  candidatos.sort((a, b) => b.score - a.score);
  if (candidatos.length === 1) return candidatos[0];
  const mejor = candidatos[0].score;
  const segundo = candidatos[1].score;
  if (mejor > segundo * 1.1 || mejor - segundo > 100) return candidatos[0];
  const pool = candidatos.slice(0, Math.min(3, candidatos.length));
  const total = pool.reduce((s, c) => s + Math.max(c.score, 1), 0);
  let r = Math.random() * total;
  for (const c of pool) {
    r -= Math.max(c.score, 1);
    if (r <= 0) return c;
  }
  return pool[0];
}

function iaEvaluarEstado() {
  const bf = estado.fichas.balon.fila;
  const bc = estado.fichas.balon.col;
  let v = 0;
  const rojoTiene = equipoTienePosesion('rojo');
  const blancoTiene = equipoTienePosesion('blanco');
  if (rojoTiene)   v += 3000;
  if (blancoTiene) v -= 3000;
  v += (14 - bf) * 200;
  if (bf <= 6) v += (6 - Math.abs(bc - 6)) * 80;
  if (bf <= 3) v += (4 - bf) * 200;
  if (bf >= 9) {
    const peligro = (bf - 8) * 400 + (6 - Math.abs(bc - 6)) * 100;
    v -= peligro;
  }
  const rc = iaColindantesSimulados(bf, bc, 'rojo');
  const bc2 = iaColindantesSimulados(bf, bc, 'blanco');
  v += (rc - bc2) * 300;
  const enPeligro = bf >= 8;
  for (const [id, d] of Object.entries(estado.fichas)) {
    if (id === 'balon' || esPortero(id)) continue;
    const distBal = iaDistancia(d.fila, d.col, bf, bc);
    const esColindante = Math.abs(d.fila - bf) <= 1 && Math.abs(d.col - bc) <= 1;
    if (d.equipo === 'rojo') {
      if (enPeligro) {
        v += Math.max(0, 500 - distBal * 120);
        if (esColindante) v += 600;
      } else {
        v += (14 - d.fila) * 10;
        v += Math.max(0, 100 - distBal * 25);
        if (esColindante) v += 200;
      }
    } else {
      v -= Math.max(0, 100 - distBal * 25);
      if (esColindante) v -= 300;
      v -= d.fila * 10;
      if (Math.abs(d.col - bc) <= 2 && d.fila > bf) v -= 150;
    }
  }
  return v;
}

function iaBestBallSequence(f, c, movRestantes, alpha, beta) {
  const oldF = estado.fichas.balon.fila, oldC = estado.fichas.balon.col;
  const oldTurno = estado.turno, oldMovs = estado.movimientosBalon;
  estado.fichas.balon.fila = f; estado.fichas.balon.col = c;
  estado.turno = 'rojo';
  estado.movimientosBalon = 4 - movRestantes;
  if (movRestantes === 0) {
    const s = iaEvaluarEstado();
    estado.fichas.balon.fila = oldF; estado.fichas.balon.col = oldC;
    estado.turno = oldTurno; estado.movimientosBalon = oldMovs;
    return { score: s, seq: [] };
  }
  const destinos = obtenerDestinosBalon(f, c);
  if (destinos.length === 0) {
    const s = iaEvaluarEstado();
    estado.fichas.balon.fila = oldF; estado.fichas.balon.col = oldC;
    estado.turno = oldTurno; estado.movimientosBalon = oldMovs;
    return { score: s, seq: [] };
  }
  const scored = destinos.map(d => {
    estado.fichas.balon.fila = d.fila; estado.fichas.balon.col = d.col;
    const s = iaEvaluarEstado();
    estado.fichas.balon.fila = f; estado.fichas.balon.col = c;
    return { d, s };
  });
  scored.sort((a, b) => b.s - a.s);
  let mejorScore = -Infinity, mejorSeq = [];
  for (const { d } of scored) {
    if (d.fila === 0 && d.col >= 4 && d.col <= 8) {
      const descuentoGolDirecto = (4 - movRestantes) * 1200;
      estado.fichas.balon.fila = oldF; estado.fichas.balon.col = oldC;
      estado.turno = oldTurno; estado.movimientosBalon = oldMovs;
      return { score: 500000 - descuentoGolDirecto, seq: [d] };
    }
    estado.fichas.balon.fila = d.fila; estado.fichas.balon.col = d.col;
    const sigueRojo = equipoTienePosesion('rojo');
    const scoreAqui = iaEvaluarEstado();
    const blancosColindantes = iaColindantesSimulados(d.fila, d.col, 'blanco');
    const rojosColindantes = iaColindantesSimulados(d.fila, d.col, 'rojo');
    const penalExposicion = (!sigueRojo && blancosColindantes > rojosColindantes) ? -600 : 0;
    const margenPosesion = rojosColindantes - blancosColindantes;
    const penalMargenFino = (sigueRojo && margenPosesion === 1 && movRestantes > 1) ? -400 : 0;
    let resultado;
    if (sigueRojo && movRestantes > 1) {
      const subRes = iaBestBallSequence(d.fila, d.col, movRestantes - 1, alpha, beta);
      const descuentoProfundidad = subRes.score >= 490000 ? (4 - movRestantes) * 1200 : 0;
      resultado = { score: subRes.score + penalMargenFino - descuentoProfundidad, seq: [d, ...subRes.seq] };
    } else if (!sigueRojo && movRestantes > 1) {
      const penalPerdidaPosesion = 800 + (movRestantes - 1) * 600;
      const subRes = iaBestBallSequence(d.fila, d.col, movRestantes - 1, alpha, beta);
      resultado = { score: subRes.score - penalPerdidaPosesion + penalExposicion, seq: [d, ...subRes.seq] };
    } else {
      resultado = { score: scoreAqui + penalExposicion, seq: [d] };
    }
    estado.fichas.balon.fila = f; estado.fichas.balon.col = c;
    if (resultado.score > mejorScore) { mejorScore = resultado.score; mejorSeq = resultado.seq; }
    alpha = Math.max(alpha, mejorScore);
    if (beta <= alpha) break;
  }
  estado.fichas.balon.fila = oldF; estado.fichas.balon.col = oldC;
  estado.turno = oldTurno; estado.movimientosBalon = oldMovs;
  return { score: mejorScore, seq: mejorSeq };
}

function iaBestBallSequenceBlanco(f, c, movRestantes) {
  const oldF = estado.fichas.balon.fila, oldC = estado.fichas.balon.col;
  const oldTurno = estado.turno, oldMovs = estado.movimientosBalon;
  estado.fichas.balon.fila = f; estado.fichas.balon.col = c;
  estado.turno = 'blanco';
  estado.movimientosBalon = 4 - movRestantes;
  if (movRestantes === 0) {
    const s = iaEvaluarEstado();
    estado.fichas.balon.fila = oldF; estado.fichas.balon.col = oldC;
    estado.turno = oldTurno; estado.movimientosBalon = oldMovs;
    return s;
  }
  const destinos = obtenerDestinosBalon(f, c);
  if (destinos.length === 0) {
    const s = iaEvaluarEstado();
    estado.fichas.balon.fila = oldF; estado.fichas.balon.col = oldC;
    estado.turno = oldTurno; estado.movimientosBalon = oldMovs;
    return s;
  }
  const scored = destinos.map(d => {
    estado.fichas.balon.fila = d.fila; estado.fichas.balon.col = d.col;
    const s = iaEvaluarEstado();
    estado.fichas.balon.fila = f; estado.fichas.balon.col = c;
    return { d, s };
  });
  scored.sort((a, b) => a.s - b.s);
  let mejorScore = Infinity;
  for (const { d } of scored) {
    if (d.fila === 14) {
      estado.fichas.balon.fila = oldF; estado.fichas.balon.col = oldC;
      estado.turno = oldTurno; estado.movimientosBalon = oldMovs;
      return -500000 + (4 - movRestantes) * 1200;
    }
    estado.fichas.balon.fila = d.fila; estado.fichas.balon.col = d.col;
    const sigueBlanco = equipoTienePosesion('blanco');
    estado.fichas.balon.fila = f; estado.fichas.balon.col = c;
    let resultado;
    if (sigueBlanco && movRestantes > 1) {
      resultado = iaBestBallSequenceBlanco(d.fila, d.col, movRestantes - 1);
    } else {
      estado.fichas.balon.fila = d.fila; estado.fichas.balon.col = d.col;
      resultado = iaEvaluarEstado();
      estado.fichas.balon.fila = f; estado.fichas.balon.col = c;
    }
    if (resultado < mejorScore) mejorScore = resultado;
  }
  estado.fichas.balon.fila = oldF; estado.fichas.balon.col = oldC;
  estado.turno = oldTurno; estado.movimientosBalon = oldMovs;
  return mejorScore;
}

function iaSimularMejorTurnoBlanco() {
  const piezasBlanco = Object.entries(estado.fichas)
    .filter(([id, d]) => d.equipo === 'blanco')
    .map(([id, d]) => ({ id, fila: d.fila, col: d.col }));
  const balonF = estado.fichas.balon.fila, balonC = estado.fichas.balon.col;
  let peorParaRojo = Infinity;
  for (const pieza of piezasBlanco) {
    const destinos = obtenerDestinosJugador(pieza.fila, pieza.col)
      .filter(d => !estaOcupada(d.fila, d.col, pieza.id));
    const scored = destinos.map(d => {
      const distBal = iaDistancia(d.fila, d.col, balonF, balonC);
      const avance = d.fila;
      return { d, heuristica: -distBal * 2 + avance };
    });
    scored.sort((a, b) => b.heuristica - a.heuristica);
    const top = scored.slice(0, 8).map(s => s.d);
    for (const dest of top) {
      estado.fichas[pieza.id].fila = dest.fila;
      estado.fichas[pieza.id].col  = dest.col;
      let scoreFinal;
      if (equipoTienePosesion('blanco')) {
        scoreFinal = iaBestBallSequenceBlanco(balonF, balonC, 4) - 2000;
      } else {
        scoreFinal = iaEvaluarEstado();
      }
      if (scoreFinal < peorParaRojo) peorParaRojo = scoreFinal;
      estado.fichas[pieza.id].fila = pieza.fila;
      estado.fichas[pieza.id].col  = pieza.col;
    }
  }
  return peorParaRojo === Infinity ? iaEvaluarEstado() : peorParaRojo;
}

function iaDetectarAmenazaGol() {
  const balonF = estado.fichas.balon.fila;
  const balonC = estado.fichas.balon.col;
  const amenazas = [];
  const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  for (const [df, dc] of dirs) {
    for (let dist = 1; dist <= 4; dist++) {
      const nf = balonF + df * dist;
      const nc = balonC + dc * dist;
      if (nf === 14 && nc >= 4 && nc <= 8) {
        amenazas.push({ fila: nf, col: nc });
        break;
      }
      if (estaOcupada(nf, nc, 'balon')) {
        const ocupante = Object.values(estado.fichas).find(f => f.fila === nf && f.col === nc);
        if (ocupante && ocupante.equipo === 'rojo') break;
      }
      if (!esCasillaValida(nf, nc) && !esPorteria(nf, nc)) break;
    }
  }
  return amenazas;
}

function iaCasillasBloqueo(balonF, balonC, goF, goC) {
  const df = Math.sign(goF - balonF);
  const dc = Math.sign(goC - balonC);
  const bloqueos = [];
  let f = balonF + df, c = balonC + dc;
  while (f !== goF || c !== goC) {
    if (esCasillaValida(f, c)) bloqueos.push({ fila: f, col: c });
    f += df; c += dc;
  }
  return bloqueos;
}

function iaJugadoresBlancosPorPeligro() {
  return Object.entries(estado.fichas)
    .filter(([id, d]) => d.equipo === 'blanco' && id !== 'balon')
    .map(([id, d]) => ({ id, fila: d.fila, col: d.col }))
    .sort((a, b) => b.fila - a.fila);
}

// ====== DECISIÓN MOVER JUGADOR ======

function calcularDecisionJugador() {
  const balonF = estado.fichas.balon.fila;
  const balonC = estado.fichas.balon.col;
  const rivalTienePosesion = equipoTienePosesion('blanco');
  const piezasIA = Object.entries(estado.fichas)
    .filter(([id, d]) => d.equipo === 'rojo')
    .map(([id, d]) => ({ id, ...d }));

  const amenazasGolActuales = iaDetectarAmenazaGol();
  const bloqueosPorAmenaza = [];
  for (const gol of amenazasGolActuales) {
    for (const b of iaCasillasBloqueo(balonF, balonC, gol.fila, gol.col)) {
      bloqueosPorAmenaza.push(b);
    }
  }
  const hayAmenazaGol = amenazasGolActuales.length > 0;

  let candidatos = [];

  for (const pieza of piezasIA) {
    const esPorteroIA = esPortero(pieza.id);
    const destinos = obtenerDestinosJugador(pieza.fila, pieza.col)
      .filter(d => !estaOcupada(d.fila, d.col, pieza.id));

    if (esPorteroIA) {
      const porteroCol = pieza.col;
      const descentrado = Math.abs(porteroCol - 6);
      const balonEnArea = balonF >= 9;
      const balonLejos = balonF <= 8;
      const rojoTienePosesionAhora = equipoTienePosesion('rojo');

      for (const dest of destinos) {
        let score = 0;
        const enAreaGrande = dest.fila >= 9 && dest.fila <= 13 && dest.col >= 2 && dest.col <= 10;
        if (!enAreaGrande) { score -= 5000; }
        else if (hayAmenazaGol) {
          if (bloqueosPorAmenaza.some(b => b.fila === dest.fila && b.col === dest.col)) score += 50000;
          const colMedia = Math.round(amenazasGolActuales.reduce((s, g) => s + g.col, 0) / amenazasGolActuales.length);
          score -= Math.abs(dest.col - colMedia) * 80;
          score -= Math.abs(dest.fila - 13) * 30;
        } else if (balonEnArea && rojoTienePosesionAhora) {
          const mejoraCentrado = Math.abs(dest.col - 6) < descentrado;
          const esColindanteBalon = Math.abs(dest.fila - balonF) <= 1 && Math.abs(dest.col - balonC) <= 1;
          if (esColindanteBalon) score += 15000;
          if (mejoraCentrado) score += descentrado * 400;
          score -= Math.abs(dest.col - 6) * 50;
          score -= Math.abs(dest.fila - 13) * 20;
        } else if (balonEnArea) {
          // Balón en área sin posesión: portero debe intentar cogerlo
          const esColindanteBalon = Math.abs(dest.fila - balonF) <= 1 && Math.abs(dest.col - balonC) <= 1;
          if (esColindanteBalon) {
            score += 15000;
            // Si cogerlo lo descentra mucho, penalizar proporcionalmente para que prefiera
            // posiciones colindantes que no lo alejen demasiado del centro
            score -= Math.abs(dest.col - 6) * 80;
          } else {
            score -= Math.abs(dest.col - balonC) * 30;
            score -= Math.abs(dest.fila - 13) * 10;
            // Tendencia al centro si está descentrado y no puede coger el balón
            if (descentrado >= 3) score -= Math.abs(dest.col - 6) * 40;
          }
        } else if (balonLejos && descentrado >= 3) {
          score -= Math.abs(dest.col - 6) * 60;
          score -= Math.abs(dest.fila - 13) * 10;
          if (Math.abs(dest.col - 6) < descentrado) score += 800;
        } else {
          score -= Math.abs(dest.col - balonC) * 20;
          score -= Math.abs(dest.col - 6) * 40;
          score -= Math.abs(dest.fila - 13) * 10;
        }
        candidatos.push({ piezaId: pieza.id, dest, score });
      }
      continue;
    }

    const rojoTienePosesion = equipoTienePosesion('rojo');
    const destsOrdenados = destinos.slice().sort((a, b) => {
      if (!rojoTienePosesion) {
        return iaDistancia(a.fila, a.col, balonF, balonC) - iaDistancia(b.fila, b.col, balonF, balonC);
      }
      const colA = (Math.abs(a.fila - balonF) <= 1 && Math.abs(a.col - balonC) <= 1) ? 1 : 0;
      const colB = (Math.abs(b.fila - balonF) <= 1 && Math.abs(b.col - balonC) <= 1) ? 1 : 0;
      return (colB * 100 + (14 - b.fila)) - (colA * 100 + (14 - a.fila));
    }).slice(0, 10);

    for (const dest of destsOrdenados) {
      estado.fichas[pieza.id].fila = dest.fila;
      estado.fichas[pieza.id].col  = dest.col;

      let scoreTotal;
      const ganaPosesionAhora = equipoTienePosesion('rojo');
      const distDestBalon = iaDistancia(dest.fila, dest.col, balonF, balonC);
      const esColindanteDest = Math.abs(dest.fila - balonF) <= 1 && Math.abs(dest.col - balonC) <= 1;

      if (rojoTienePosesion || ganaPosesionAhora) {
        const resPropio = iaBestBallSequence(balonF, balonC, 4, -Infinity, Infinity);
        const scoreRival = iaSimularMejorTurnoBlanco();
        scoreTotal = resPropio.score - scoreRival * 0.8;
        if (ganaPosesionAhora && !rojoTienePosesion) scoreTotal += 2000;
        scoreTotal += Math.max(0, 500 - distDestBalon * 50);
        if (esColindanteDest) scoreTotal += 300;
      } else {
        scoreTotal = Math.max(0, 5000 - distDestBalon * 500);
        if (esColindanteDest) scoreTotal += 3000;
        const scoreRival = iaSimularMejorTurnoBlanco();
        if (scoreRival < -1000) scoreTotal += scoreRival * 0.3;
        const quitaPosesion = rivalTienePosesion && !equipoTienePosesion('blanco');
        if (quitaPosesion) scoreTotal += 4000;
        const rojosColindantesActuales = piezasIA.filter(p =>
          p.id !== pieza.id &&
          Math.abs(p.fila - balonF) <= 1 && Math.abs(p.col - balonC) <= 1
        ).length;
        const blancosColindantesActuales = Object.values(estado.fichas).filter(d =>
          d.equipo === 'blanco' &&
          Math.abs(d.fila - balonF) <= 1 && Math.abs(d.col - balonC) <= 1
        ).length;
        if (rojosColindantesActuales >= 1 && blancosColindantesActuales >= 1) {
          const distBlancoCercano = Math.min(...Object.values(estado.fichas)
            .filter(d => d.equipo === 'blanco' &&
              !(Math.abs(d.fila - balonF) <= 1 && Math.abs(d.col - balonC) <= 1))
            .map(d => iaDistancia(d.fila, d.col, balonF, balonC))
            .concat([99])
          );
          if (esColindanteDest) {
            scoreTotal += 10000;
          } else if (distDestBalon < distBlancoCercano) {
            scoreTotal += 3000;
          } else {
            scoreTotal -= 1000;
          }
        } else if (rojosColindantesActuales >= 1 && esColindanteDest) {
          scoreTotal += 8000;
        }
      }

      estado.fichas[pieza.id].fila = pieza.fila;
      estado.fichas[pieza.id].col  = pieza.col;
      candidatos.push({ piezaId: pieza.id, dest, score: scoreTotal });
    }
  }

  candidatos.sort((a, b) => b.score - a.score);
  const elegido = iaElegir(candidatos);
  return elegido ? { piezaId: elegido.piezaId, dest: elegido.dest, top5: candidatos.slice(0, 5) } : null;
}

// ====== DECISIÓN MOVER BALÓN ======

function calcularDecisionBalon(movRestantes) {
  const balonF = estado.fichas.balon.fila;
  const balonC = estado.fichas.balon.col;
  const destinos = obtenerDestinosBalon(balonF, balonC);
  if (destinos.length === 0) return null;

  let primero, secuencia = [], scoreElegido = 0;

  if (equipoTienePosesion('rojo')) {
    const res = iaBestBallSequence(balonF, balonC, movRestantes, -Infinity, Infinity);
    primero = res.seq.length > 0 ? res.seq[0] : null;
    secuencia = res.seq;
    scoreElegido = res.score;
  } else {
    let mejorScore = -Infinity;
    for (const d of destinos) {
      if (d.fila === 0 && d.col >= 4 && d.col <= 8) { primero = d; scoreElegido = 500000; break; }
      estado.fichas.balon.fila = d.fila; estado.fichas.balon.col = d.col;
      const s = iaEvaluarEstado();
      estado.fichas.balon.fila = balonF; estado.fichas.balon.col = balonC;
      if (s > mejorScore) { mejorScore = s; primero = d; scoreElegido = s; }
    }
  }

  return primero ? { dest: primero, secuencia, score: scoreElegido } : null;
}

// ====== ENTRADA DEL WORKER ======

self.onmessage = function(e) {
  const { tipo, estadoJuego, movRestantes } = e.data;
  estado = estadoJuego; // estado recibido como copia serializada

  if (tipo === 'MOVER_JUGADOR') {
    const decision = calcularDecisionJugador();
    self.postMessage({ tipo: 'DECISION_JUGADOR', decision });
  } else if (tipo === 'MOVER_BALON') {
    const decision = calcularDecisionBalon(movRestantes);
    self.postMessage({ tipo: 'DECISION_BALON', decision });
  }
};
