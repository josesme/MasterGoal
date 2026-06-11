// Web Worker para el cálculo de la IA de MasterGoal
// Recibe el estado serializado y devuelve la decisión sin bloquear el hilo principal

let estado = null;

// Caché de iaLineasAPorteria — válida solo dentro de un turno de IA.
// Clave: "bf,bc,equipo". Se resetea al inicio de cada calcularDecision*.
// Justificación: dentro del lookahead recursivo, iaLineasAPorteria se llama
// decenas de veces con los mismos argumentos. El resultado solo depende de
// la posición del balón, el equipo atacante y las posiciones de las fichas —
// estas últimas NO cambian durante el lookahead de balón (solo mueve el balón),
// así que el resultado es idéntico y cacheable sin pérdida de precisión.
let _cacheLineas = null;

function _resetCacheLineas() { _cacheLineas = new Map(); }

function iaLineasAPorteriaCached(bf, bc, equipo) {
  _cntLineas++;
  const key = bf + ',' + bc + ',' + equipo;
  if (_cacheLineas && _cacheLineas.has(key)) return _cacheLineas.get(key);
  const resultado = iaLineasAPorteria(bf, bc, equipo);
  if (_cacheLineas) _cacheLineas.set(key, resultado);
  return resultado;
}

// ====== FUNCIONES DEL TABLERO (copia pura, sin DOM) ======

function esCasillaValida(f, c) {
  return f >= 1 && f <= 13 && c >= 1 && c <= 11;
}

function esCornerPropio(f, c, equipo) {
  if (equipo === 'local')     return (f === 1  && (c === 1 || c === 11));
  if (equipo === 'visitante') return (f === 13 && (c === 1 || c === 11));
  return false;
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

function equipoConBalonEnBrazo() {
  const b = estado.fichas.balon;
  for (const id of ['l-portero', 'v-portero']) {
    const p = estado.fichas[id];
    if (b.fila === p.fila && Math.abs(b.col - p.col) === 1) {
      const casillas = obtenerCasillasPortero(id);
      if (casillas.some(c => c.tipo === 'brazo' && c.fila === b.fila && c.col === b.col)) {
        return id === 'l-portero' ? 'local' : 'visitante';
      }
    }
  }
  return null;
}

function contarColindantes() {
  const b = estado.fichas.balon;
  let local = 0, visitante = 0;
  for (const [id, d] of Object.entries(estado.fichas)) {
    if (id === 'balon') continue;
    if (esColindanteAlBalon(d.fila, d.col)) {
      if (id === 'l-portero' || id === 'v-portero') {
        const casillasPortero = obtenerCasillasPortero(id);
        const esBalonEnBrazoReal = casillasPortero.some(c => c.tipo === 'brazo' && c.fila === b.fila && c.col === b.col);
        if (esBalonEnBrazoReal) continue;
      }
      if (d.equipo === 'local') local++;
      else visitante++;
    }
  }
  return { local, visitante };
}

function equipoTienePosesion(equipo) {
  const equipoBrazo = equipoConBalonEnBrazo();
  if (equipoBrazo !== null) return equipo === equipoBrazo;
  const c = contarColindantes();
  if (equipo === 'local') return c.local > c.visitante;
  return c.visitante > c.local;
}

function esPortero(id) {
  return id === 'l-portero' || id === 'v-portero';
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
  const destino  = obtenerColindantesEquipo(filaDest, colDest, equipo);

  // Caso clásico: mismo único colindante en origen y destino
  if (actuales.length === 1 && destino.length === 1 && actuales[0] === destino[0]) return true;

  // Caso extendido: el último pasador no puede ser el único responsable del siguiente pase
  if (estado.ultimoPasador && destino.length === 1 && destino[0] === estado.ultimoPasador) return true;

  return false;
}

function obtenerCasillasPortero(porteroId) {
  const portero = estado.fichas[porteroId];
  const esBlanco = porteroId === 'l-portero';
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
  const rival = equipo === 'local' ? 'visitante' : 'local';
  const idPorteroRival = rival === 'local' ? 'l-portero' : 'v-portero';
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
      const equipoRival = estado.turno === 'local' ? 'visitante' : 'local';
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
  const rival = equipo === 'local' ? 'visitante' : 'local';
  const idPorteroRival = rival === 'local' ? 'l-portero' : 'v-portero';
  const portero = estado.fichas[idPorteroRival];
  const esBrazoIzq = (f === portero.fila && c === portero.col - 1);
  const esBrazoDer = (f === portero.fila && c === portero.col + 1);
  if (!esBrazoIzq && !esBrazoDer) return false;
  const esBlanco = rival === 'local';
  const enAreaGrande = esBlanco
    ? (f >= 1 && f <= 4 && c >= 2 && c <= 10)
    : (f >= 10 && f <= 13 && c >= 2 && c <= 10);
  return enAreaGrande;
}

function obtenerDestinosJugador(f, c, equipo) {
  const dest = [];
  const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  for (const [df, dc] of dirs) {
    let f1 = f + df, c1 = c + dc;
    if (esCasillaValida(f1, c1) && !esBrazoPorteroRival(f1, c1) && !esCornerPropio(f1, c1, equipo)) {
      dest.push({ fila: f1, col: c1 });
    }
    let f2 = f + df * 2, c2 = c + dc * 2;
    if (esCasillaValida(f2, c2) && !estaOcupada(f1, c1, null) && !esBrazoPorteroRival(f2, c2) && !esCornerPropio(f2, c2, equipo)) {
      dest.push({ fila: f2, col: c2 });
    }
  }
  return dest;
}

function esDestinoValidoCuartoMovimiento(f, c) {
  if (esPorteria(f, c)) return true;
  if (estado.turno === 'local'    && ((f === 1 && c === 1) || (f === 1 && c === 11))) return false;
  if (estado.turno === 'visitante' && ((f === 13 && c === 1) || (f === 13 && c === 11))) return false;
  if (estado.turno === 'local') {
    if (f >= 1 && f <= 4 && c >= 2 && c <= 10) return false;
  } else {
    if (f >= 10 && f <= 13 && c >= 2 && c <= 10) return false;
  }
  const balonOriginal = { ...estado.fichas.balon };
  estado.fichas.balon.fila = f;
  estado.fichas.balon.col = c;
  const nadaTienePosesion = !equipoTienePosesion('local') && !equipoTienePosesion('visitante');
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
    if (estado.turno === 'local') {
      if (d.fila === 0) return false;
      if (d.fila === 1 && (d.col === 1 || d.col === 11)) return false;
    }
    if (estado.turno === 'visitante') {
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
  const pasadorOriginal = estado.ultimoPasador;
  // Calcular el pasador de este movimiento (el único colindante actual, si lo hay)
  const colindantesActuales = obtenerColindantesEquipo(f, c, estado.turno);
  const pasadorEste = colindantesActuales.length === 1 ? colindantesActuales[0] : null;
  dest = dest.filter(d => {
    if (esPorteria(d.fila, d.col)) return true;
    estado.fichas.balon.fila = d.fila;
    estado.fichas.balon.col = d.col;
    estado.ultimoPasador = pasadorEste;
    const siguePosesion = equipoTienePosesion(estado.turno);
    const valido = siguePosesion || esDestinoValidoCuartoMovimiento(d.fila, d.col);
    estado.fichas.balon.fila = balonOriginal2.fila;
    estado.fichas.balon.col = balonOriginal2.col;
    estado.ultimoPasador = pasadorOriginal;
    return valido;
  });
  if (estado.movimientosBalon < 3) {
    const movsActual = estado.movimientosBalon;
    dest = dest.filter(d => {
      if (esPorteria(d.fila, d.col)) return true;
      estado.fichas.balon.fila = d.fila;
      estado.fichas.balon.col = d.col;
      estado.ultimoPasador = pasadorEste;
      estado.movimientosBalon = movsActual + 1;
      const siguientes = obtenerDestinosBalon(d.fila, d.col);
      estado.fichas.balon.fila = balonOriginal2.fila;
      estado.fichas.balon.col = balonOriginal2.col;
      estado.movimientosBalon = movsActual;
      estado.ultimoPasador = pasadorOriginal;
      if (siguientes.length > 0) return true;
      estado.fichas.balon.fila = d.fila;
      estado.fichas.balon.col = d.col;
      estado.ultimoPasador = pasadorEste;
      const puedeTerminar = !equipoTienePosesion(estado.turno) && esDestinoValidoCuartoMovimiento(d.fila, d.col);
      estado.fichas.balon.fila = balonOriginal2.fila;
      estado.fichas.balon.col = balonOriginal2.col;
      estado.ultimoPasador = pasadorOriginal;
      return puedeTerminar;
    });
  }
  return dest;
}

// ====== FUNCIONES IA ======

function iaDistancia(f1, c1, f2, c2) {
  return Math.abs(f1 - f2) + Math.abs(c1 - c2);
}

// Devuelve las líneas abiertas desde (bf,bc) hacia la portería de 'equipoAtacante'.
// Cada línea es { df, dc, dist, colPorteria } donde dist es cuántas casillas hay libres
// hasta la portería. Una línea "abierta" llega a portería sin bloquearse.
// Una línea "parcialmente abierta" tiene porteroRival en medio (bloqueada por portero).
function iaLineasAPorteria(bf, bc, equipoAtacante) {
  const porteroRivalId = equipoAtacante === 'visitante' ? 'l-portero' : 'v-portero';
  const porteroRival   = estado.fichas[porteroRivalId];
  const casillasPorteroRival = obtenerCasillasPortero(porteroRivalId);
  // Portería rival: fila 0 (cols 4-8) para visitante, fila 14 para local
  const filaPorteria = equipoAtacante === 'visitante' ? 0 : 14;
  const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  const lineas = [];

  for (const [df, dc] of dirs) {
    let bloqueada = false;
    let bloqueadaPorPortero = false;
    for (let dist = 1; dist <= 14; dist++) {
      const nf = bf + df * dist;
      const nc = bc + dc * dist;
      // ¿Llegamos a portería?
      if (nf === filaPorteria && nc >= 4 && nc <= 8) {
        lineas.push({ df, dc, dist, colPorteria: nc, bloqueadaPorPortero });
        break;
      }
      // Fuera del tablero sin llegar a portería
      if (!esCasillaValida(nf, nc) && nf !== filaPorteria) break;
      // Bloqueada por jugador (no portero)
      if (estaOcupada(nf, nc, 'balon')) {
        const bloqueador = Object.entries(estado.fichas).find(([id, d]) => d.fila === nf && d.col === nc);
        if (bloqueador) {
          const [bid] = bloqueador;
          if (bid === porteroRivalId) {
            bloqueadaPorPortero = true; // el portero bloquea pero la línea sigue siendo relevante
            continue;
          }
          // Brazos del portero rival también bloquean
          if (casillasPorteroRival.some(c => c.fila === nf && c.col === nc)) {
            bloqueadaPorPortero = true;
            continue;
          }
          break; // jugador normal bloquea definitivamente
        }
      }
    }
  }
  return lineas;
}

// Devuelve líneas abiertas que el rival (local) tiene hacia nuestra portería (fila 14).
// Misma lógica pero desde la posición actual del balón mirando a portería visitante.
function iaLineasRivalesAbiertas(bf, bc) {
  return iaLineasAPorteriaCached(bf, bc, 'local');
}

// Dado un jugador en (jf,jc), ¿cuántas líneas de balón del rival corta si se mueve ahí?
// Una casilla "corta" una línea si cae en la trayectoria entre el balón y la portería local.
function iaLineasCortadasEnDest(jf, jc, lineasRivales, bf, bc) {
  let cortadas = 0;
  for (const linea of lineasRivales) {
    for (let dist = 1; dist <= linea.dist; dist++) {
      const nf = bf + linea.df * dist;
      const nc = bc + linea.dc * dist;
      if (nf === jf && nc === jc) { cortadas++; break; }
    }
  }
  return cortadas;
}

// ¿Mover un jugador a (jf,jc) abre o ayuda una línea de tiro hacia portería rival?
// Devuelve el número de líneas hacia portería local que el visitante tendría desde (bf,bc)
// si ese jugador estuviera en (jf,jc) — lo usamos para bonus de amenaza.
function iaLineasAbiertasTrasMovimiento(jf, jc, piezaId, bf, bc) {
  const oldF = estado.fichas[piezaId].fila;
  const oldC = estado.fichas[piezaId].col;
  estado.fichas[piezaId].fila = jf;
  estado.fichas[piezaId].col  = jc;
  const lineas = iaLineasAPorteriaCached(bf, bc, 'visitante');
  estado.fichas[piezaId].fila = oldF;
  estado.fichas[piezaId].col  = oldC;
  return lineas.filter(l => !l.bloqueadaPorPortero).length;
}

// Valora cuántas líneas directas a portería rival existen si el jugador (piezaId)
// se mueve a (jf, jc) Y el balón estuviera en cada una de las casillas colindantes
// a (jf, jc). Es decir: ¿desde qué posiciones colindantes al destino habría tiro?
// Esto mide la "amenaza potencial": aunque no tenga el balón ahora, al posicionarse
// aquí presiona al rival porque cualquier balón cercano se convierte en peligro.
function iaAmenazaPotencialEnDest(jf, jc, piezaId) {
  _cntAmenaza++;
  const oldF = estado.fichas[piezaId].fila;
  const oldC = estado.fichas[piezaId].col;
  estado.fichas[piezaId].fila = jf;
  estado.fichas[piezaId].col  = jc;

  let amenazaTotal = 0;
  const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  for (const [df, dc] of dirs) {
    const bf = jf + df, bc = jc + dc;
    if (!esCasillaValida(bf, bc)) continue;
    // Simular que el balón está ahí y ver qué líneas a portería hay
    const balonOldF = estado.fichas.balon.fila, balonOldC = estado.fichas.balon.col;
    estado.fichas.balon.fila = bf; estado.fichas.balon.col = bc;
    const lineas = iaLineasAPorteriaCached(bf, bc, 'visitante').filter(l => !l.bloqueadaPorPortero);
    // Solo cuenta si el jugador en (jf,jc) podría ser el que ejecuta (es colindante al balón simulado)
    // y la línea tiene recorrido corto (tiro factible, dist <= 5)
    for (const l of lineas) {
      if (l.dist <= 5) amenazaTotal += Math.max(0, 300 - l.dist * 50);
    }
    estado.fichas.balon.fila = balonOldF; estado.fichas.balon.col = balonOldC;
  }

  estado.fichas[piezaId].fila = oldF;
  estado.fichas[piezaId].col  = oldC;
  return amenazaTotal;
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
  _cntEvaluar++;
  const bf = estado.fichas.balon.fila;
  const bc = estado.fichas.balon.col;
  let v = 0;

  // ── 1. POSESIÓN ──────────────────────────────────────────────────────────
  const visitanteTiene = equipoTienePosesion('visitante');
  const localTiene     = equipoTienePosesion('local');
  if (visitanteTiene) v += 3000;
  if (localTiene)     v -= 3000;

  // ── 2. POSICIÓN DEL BALÓN (avance + centralidad) ──────────────────────────
  // El balón cuanto más cerca de portería rival (fila 0) mejor para visitante
  v += (14 - bf) * 200;
  // Centralidad en campo propio: balón en el centro amenaza más ángulos
  if (bf <= 6) v += (5 - Math.abs(bc - 6)) * 90;
  // Balón en zona de tiro (filas 1-3): bonus extra por centralidad y cercanía
  if (bf <= 3) v += (4 - bf) * 220 + (5 - Math.abs(bc - 6)) * 60;
  // Balón en zona de peligro propio (filas 8-13)
  if (bf >= 9) {
    const peligro = (bf - 8) * 400 + (5 - Math.abs(bc - 6)) * 120;
    v -= peligro;
  }

  // ── 3. SUPERIORIDAD NUMÉRICA EN CASILLAS COLINDANTES ─────────────────────
  const rc  = iaColindantesSimulados(bf, bc, 'visitante');
  const lc  = iaColindantesSimulados(bf, bc, 'local');
  v += (rc - lc) * 320;
  // Bonus adicional por tener mayoría clara (no solo +1): indica control sólido
  if (rc - lc >= 2) v += 400;

  // ── 4. LÍNEAS DE TIRO A PORTERÍA RIVAL (amenaza ofensiva) ────────────────
  // Precalcular posiciones locales para detección de cobertura
  const posLocales = Object.values(estado.fichas).filter(f => f.equipo === 'local');
  const lineasOfensivas = iaLineasAPorteriaCached(bf, bc, 'visitante');
  for (const linea of lineasOfensivas) {
    if (!linea.bloqueadaPorPortero) {
      const bonusLinea = Math.max(0, 600 - linea.dist * 80);
      const centralidad = 5 - Math.abs(linea.colPorteria - 6);
      // Reducir valor si un local está colindante a la trayectoria (puede tapar el siguiente turno)
      let cubierta = false;
      for (let d = 1; d <= linea.dist && !cubierta; d++) {
        const tf = bf + linea.df * d, tc = bc + linea.dc * d;
        for (const loc of posLocales) {
          if (Math.abs(loc.fila - tf) <= 1 && Math.abs(loc.col - tc) <= 1 && !(loc.fila === tf && loc.col === tc)) {
            cubierta = true; break;
          }
        }
      }
      v += cubierta ? (bonusLinea + centralidad * 40) * 0.4 : bonusLinea + centralidad * 40;
    } else {
      const bonusLinea = Math.max(0, 250 - linea.dist * 40);
      v += bonusLinea;
    }
  }

  // ── 5. LÍNEAS DE PELIGRO RIVALES (presión defensiva) ─────────────────────
  const posVisitantes = Object.values(estado.fichas).filter(f => f.equipo === 'visitante');
  const lineasDefensivas = iaLineasRivalesAbiertas(bf, bc);
  for (const linea of lineasDefensivas) {
    if (!linea.bloqueadaPorPortero) {
      const penalLinea = Math.max(0, 500 - linea.dist * 70);
      const centralidad = 5 - Math.abs(linea.colPorteria - 6);
      // Reducir penalización si un visitante cubre la trayectoria
      let cubierta = false;
      for (let d = 1; d <= linea.dist && !cubierta; d++) {
        const tf = bf + linea.df * d, tc = bc + linea.dc * d;
        for (const vis of posVisitantes) {
          if (Math.abs(vis.fila - tf) <= 1 && Math.abs(vis.col - tc) <= 1 && !(vis.fila === tf && vis.col === tc)) {
            cubierta = true; break;
          }
        }
      }
      v -= cubierta ? (penalLinea + centralidad * 30) * 0.4 : penalLinea + centralidad * 30;
    } else {
      v -= Math.max(0, 180 - linea.dist * 30);
    }
  }

  // ── 6. CONTROL DEL CENTRO DEL CAMPO ──────────────────────────────────────
  let controlCentroVisitante = 0, controlCentroLocal = 0;
  for (const [id, d] of Object.entries(estado.fichas)) {
    if (id === 'balon' || esPortero(id)) continue;
    if (d.equipo === 'visitante' && d.fila >= 4 && d.fila <= 9 && Math.abs(d.col - 6) <= 2) controlCentroVisitante++;
    if (d.equipo === 'local'     && d.fila >= 5 && d.fila <= 10 && Math.abs(d.col - 6) <= 2) controlCentroLocal++;
  }
  v += (controlCentroVisitante - controlCentroLocal) * 300;

  // ── 7. POSICIONAMIENTO INDIVIDUAL ─────────────────────────────────────────
  // Precalcular destinos de balón alcanzables desde posición actual (para bonus cobertura)
  const destinosBalon = obtenerDestinosBalon(bf, bc);
  const enPeligro = bf >= 8;

  for (const [id, d] of Object.entries(estado.fichas)) {
    if (id === 'balon' || esPortero(id)) continue;
    const distBal      = iaDistancia(d.fila, d.col, bf, bc);
    const esColindante = Math.abs(d.fila - bf) <= 1 && Math.abs(d.col - bc) <= 1;

    if (d.equipo === 'visitante') {
      if (enPeligro) {
        // En peligro: priorizar recuperar el balón
        v += Math.max(0, 800 - distBal * 160);
        if (esColindante) v += 900;
      } else {
        // En ataque: avance hacia portería rival (fila 0)
        v += (14 - d.fila) * 28;
        // Proximidad al balón
        v += Math.max(0, 200 - distBal * 40);
        // Colindante al balón: puede recibir pase inmediato
        if (esColindante) v += 350;
        // Control de columnas centrales en zona ofensiva
        if (d.fila <= 7 && Math.abs(d.col - 6) <= 2) v += 150;
        // Bonus por estar en línea de pase directa desde balón actual
        // (cobertura ofensiva: el jugador está donde puede recibir el próximo pase)
        const enLineaPase = destinosBalon.some(dest =>
          Math.abs(dest.fila - d.fila) <= 1 && Math.abs(dest.col - d.col) <= 1
        );
        if (enLineaPase && !esColindante) v += 180;
        // Penalizar jugadores muy retrasados cuando el balón está en campo rival
        if (bf <= 6 && d.fila >= 9) v -= 200;
      }
    } else {
      // Jugadores locales: penalizar su proximidad, avance y cobertura
      v -= Math.max(0, 200 - distBal * 40);
      if (esColindante) v -= 450;
      v -= d.fila * 28;
      // Penalizar local en columna del balón por delante (bloquea línea)
      if (Math.abs(d.col - bc) <= 2 && d.fila > bf) v -= 250;
      // Penalizar local en línea de pase directa
      const enLineaPaseRival = destinosBalon.some(dest =>
        Math.abs(dest.fila - d.fila) <= 1 && Math.abs(dest.col - d.col) <= 1
      );
      if (enLineaPaseRival) v -= 150;
    }
  }

  return v;
}

function iaBestBallSequence(f, c, movRestantes, alpha, beta) {
  _cntBestBall++;
  const oldF = estado.fichas.balon.fila, oldC = estado.fichas.balon.col;
  const oldTurno = estado.turno, oldMovs = estado.movimientosBalon;
  const oldPasador = estado.ultimoPasador;
  estado.fichas.balon.fila = f; estado.fichas.balon.col = c;
  estado.turno = 'visitante';
  estado.movimientosBalon = 4 - movRestantes;
  // Calcular el pasador de este nivel (único colindante en f,c)
  const colindantesNivel = obtenerColindantesEquipo(f, c, 'visitante');
  const pasadorNivel = colindantesNivel.length === 1 ? colindantesNivel[0] : null;

  if (movRestantes === 0) {
    const s = iaEvaluarEstado();
    estado.fichas.balon.fila = oldF; estado.fichas.balon.col = oldC;
    estado.turno = oldTurno; estado.movimientosBalon = oldMovs;
    estado.ultimoPasador = oldPasador;
    return { score: s, seq: [] };
  }
  const destinos = obtenerDestinosBalon(f, c);
  if (destinos.length === 0) {
    const s = iaEvaluarEstado();
    estado.fichas.balon.fila = oldF; estado.fichas.balon.col = oldC;
    estado.turno = oldTurno; estado.movimientosBalon = oldMovs;
    estado.ultimoPasador = oldPasador;
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
      estado.fichas.balon.fila = oldF; estado.fichas.balon.col = oldC;
      estado.turno = oldTurno; estado.movimientosBalon = oldMovs;
      estado.ultimoPasador = oldPasador;
      return { score: 500000, seq: [d] };
    }
    // Actualizar pasador para el siguiente nivel antes de la llamada recursiva
    estado.ultimoPasador = pasadorNivel;
    estado.fichas.balon.fila = d.fila; estado.fichas.balon.col = d.col;
    const sigueVisitante = equipoTienePosesion('visitante');
    const scoreAqui = iaEvaluarEstado();
    const localesColindantes    = iaColindantesSimulados(d.fila, d.col, 'local');
    const visitantesColindantes = iaColindantesSimulados(d.fila, d.col, 'visitante');
    const margenColindantes     = visitantesColindantes - localesColindantes;

    // Penalización de exposición: escala con cuántos rivales más que propios hay alrededor.
    // Un margen de -1 (empate roto a favor del rival) es tolerable; -2 o más es peligroso.
    const penalExposicion = !sigueVisitante
      ? Math.min(0, margenColindantes) * 350   // negativo si locales > visitantes
      : 0;

    // Posesión frágil (margen justo de +1 con movimientos restantes): riesgo de perderla
    // en el siguiente pase si el rival mueve un jugador. Penalizar sutilmente.
    const penalMargenFino = (sigueVisitante && margenColindantes === 1 && movRestantes > 1)
      ? -300
      : 0;

    // Bonus por posición post-pase con líneas de tiro abiertas desde el nuevo punto del balón
    // Solo si seguimos con posesión (podemos aprovecharlo en el siguiente movimiento)
    let bonusLineasPostPase = 0;
    if (sigueVisitante) {
      const lineasTras = iaLineasAPorteriaCached(d.fila, d.col, 'visitante');
      const libresTras = lineasTras.filter(l => !l.bloqueadaPorPortero).length;
      // Cada línea libre abierta vale más cuanto más cerca de portería está el balón
      const cercania = Math.max(0, 8 - d.fila); // 0 en mitad campo, 8 justo bajo portería
      bonusLineasPostPase = libresTras * (80 + cercania * 30);
    }

    let resultado;
    if (sigueVisitante && movRestantes > 1) {
      const subRes = iaBestBallSequence(d.fila, d.col, movRestantes - 1, alpha, beta);
      resultado = { score: subRes.score + penalMargenFino + bonusLineasPostPase, seq: [d, ...subRes.seq] };
    } else if (!sigueVisitante && movRestantes > 1) {
      // Minimax: el local toma el control — simula su mejor turno completo (jugador + balón)
      const scoreTrasTurnoLocal = iaMinimaxTurnoLocal(d.fila, d.col);
      resultado = { score: scoreTrasTurnoLocal + penalExposicion, seq: [d] };
    } else {
      resultado = { score: scoreAqui + penalExposicion + bonusLineasPostPase, seq: [d] };
    }
    estado.fichas.balon.fila = f; estado.fichas.balon.col = c;
    estado.ultimoPasador = oldPasador;
    if (resultado.score > mejorScore) { mejorScore = resultado.score; mejorSeq = resultado.seq; }
    alpha = Math.max(alpha, mejorScore);
    if (beta <= alpha) break;
  }
  estado.fichas.balon.fila = oldF; estado.fichas.balon.col = oldC;
  estado.turno = oldTurno; estado.movimientosBalon = oldMovs;
  estado.ultimoPasador = oldPasador;
  return { score: mejorScore, seq: mejorSeq };
}

function iaBestBallSequenceLocal(f, c, movRestantes) {
  _cntBestBallLocal++;
  const oldF = estado.fichas.balon.fila, oldC = estado.fichas.balon.col;
  const oldTurno = estado.turno, oldMovs = estado.movimientosBalon;
  estado.fichas.balon.fila = f; estado.fichas.balon.col = c;
  estado.turno = 'local';
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
      return -500000;
    }
    estado.fichas.balon.fila = d.fila; estado.fichas.balon.col = d.col;
    const sigueLocal = equipoTienePosesion('local');
    estado.fichas.balon.fila = f; estado.fichas.balon.col = c;
    let resultado;
    if (sigueLocal && movRestantes > 1) {
      resultado = iaBestBallSequenceLocal(d.fila, d.col, movRestantes - 1);
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

// Minimax turno completo del local: mueve su mejor jugador y luego su mejor balón (prof 2).
// Devuelve el score desde la perspectiva del visitante (cuanto más bajo, peor para visitante).
function iaMinimaxTurnoLocal(balonF, balonC) {
  const oldTurno = estado.turno;
  estado.turno = 'local';
  const piezasLocal = Object.entries(estado.fichas)
    .filter(([id, d]) => d.equipo === 'local')
    .map(([id, d]) => ({ id, fila: d.fila, col: d.col }));
  let peorParaVisitante = Infinity;

  for (const pieza of piezasLocal) {
    const destinos = obtenerDestinosJugador(pieza.fila, pieza.col, 'local')
      .filter(d => !estaOcupada(d.fila, d.col, pieza.id));

    // Ordenar candidatos: prioriza los que dan posesión al local
    const scored = destinos.map(d => {
      estado.fichas[pieza.id].fila = d.fila;
      estado.fichas[pieza.id].col  = d.col;
      const consiguePosesion = equipoTienePosesion('local') ? 1 : 0;
      estado.fichas[pieza.id].fila = pieza.fila;
      estado.fichas[pieza.id].col  = pieza.col;
      const distBal = iaDistancia(d.fila, d.col, balonF, balonC);
      return { d, h: consiguePosesion * 2000 - distBal * 2 + d.fila };
    });
    scored.sort((a, b) => b.h - a.h);
    const top = scored.slice(0, 6);

    for (const { d: dest } of top) {
      estado.fichas[pieza.id].fila = dest.fila;
      estado.fichas[pieza.id].col  = dest.col;

      let scoreFinal;
      if (equipoTienePosesion('local')) {
        // Local consiguió posesión: simula su mejor secuencia de balón (prof 2)
        scoreFinal = iaBestBallSequenceLocal(balonF, balonC, 2) - 1500;
      } else {
        scoreFinal = iaEvaluarEstado();
      }

      if (scoreFinal < peorParaVisitante) peorParaVisitante = scoreFinal;

      estado.fichas[pieza.id].fila = pieza.fila;
      estado.fichas[pieza.id].col  = pieza.col;
    }
  }
  estado.turno = oldTurno;
  return peorParaVisitante === Infinity ? iaEvaluarEstado() : peorParaVisitante;
}

function iaSimularMejorTurnoLocal() {
  const piezasLocal = Object.entries(estado.fichas)
    .filter(([id, d]) => d.equipo === 'local')
    .map(([id, d]) => ({ id, fila: d.fila, col: d.col }));
  const balonF = estado.fichas.balon.fila, balonC = estado.fichas.balon.col;
  let peorParaVisitante = Infinity;
  for (const pieza of piezasLocal) {
    const destinos = obtenerDestinosJugador(pieza.fila, pieza.col, 'local')
      .filter(d => !estaOcupada(d.fila, d.col, pieza.id));
    const scored = destinos.map(d => {
      const distBal = iaDistancia(d.fila, d.col, balonF, balonC);
      const avance = d.fila;
      // Simular posesión tras mover: priorizar destinos que dan posesión al local
      estado.fichas[pieza.id].fila = d.fila;
      estado.fichas[pieza.id].col  = d.col;
      const consiguePosesion = equipoTienePosesion('local') ? 1 : 0;
      estado.fichas[pieza.id].fila = pieza.fila;
      estado.fichas[pieza.id].col  = pieza.col;
      return { d, heuristica: consiguePosesion * 2000 - distBal * 2 + avance };
    });
    scored.sort((a, b) => b.heuristica - a.heuristica);
    const top = scored.slice(0, 8).map(s => s.d);
    for (const dest of top) {
      estado.fichas[pieza.id].fila = dest.fila;
      estado.fichas[pieza.id].col  = dest.col;
      let scoreFinal;
      if (equipoTienePosesion('local')) {
        scoreFinal = iaBestBallSequenceLocal(balonF, balonC, 2) - 2000;
      } else {
        scoreFinal = iaEvaluarEstado();
      }
      if (scoreFinal < peorParaVisitante) peorParaVisitante = scoreFinal;
      estado.fichas[pieza.id].fila = pieza.fila;
      estado.fichas[pieza.id].col  = pieza.col;
    }
  }
  return peorParaVisitante === Infinity ? iaEvaluarEstado() : peorParaVisitante;
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
        if (ocupante && ocupante.equipo === 'visitante') break;
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

function iaJugadoresLocalesPorPeligro() {
  return Object.entries(estado.fichas)
    .filter(([id, d]) => d.equipo === 'local' && id !== 'balon')
    .map(([id, d]) => ({ id, fila: d.fila, col: d.col }))
    .sort((a, b) => b.fila - a.fila);
}

// ====== DECISIÓN MOVER JUGADOR ======

function calcularDecisionJugador() {
  _resetCacheLineas();
  const balonF = estado.fichas.balon.fila;
  const balonC = estado.fichas.balon.col;
  const rivalTienePosesion  = equipoTienePosesion('local');
  const visitanteTienePosesion = equipoTienePosesion('visitante');
  const piezasIA = Object.entries(estado.fichas)
    .filter(([id, d]) => d.equipo === 'visitante')
    .map(([id, d]) => ({ id, ...d }));

  // Detección de amenaza de gol local (hacia portería visitante fila 14)
  const amenazasGolActuales = iaDetectarAmenazaGol();
  const bloqueosPorAmenaza = [];
  for (const gol of amenazasGolActuales) {
    for (const b of iaCasillasBloqueo(balonF, balonC, gol.fila, gol.col)) {
      bloqueosPorAmenaza.push(b);
    }
  }
  const hayAmenazaGol = amenazasGolActuales.length > 0;

  // Líneas de tiro rivales abiertas ANTES de cualquier movimiento
  // Sirve para valorar cuántas cortamos con cada destino (estrategia bloqueo)
  const lineasRivalesActuales = iaLineasRivalesAbiertas(balonF, balonC);

  // Líneas de tiro propias abiertas antes de mover
  // Sirve para valorar si un movimiento abre una nueva línea ofensiva
  const lineasPropiasAntes = iaLineasAPorteriaCached(balonF, balonC, 'visitante')
    .filter(l => !l.bloqueadaPorPortero).length;

  let candidatos = [];

  for (const pieza of piezasIA) {
    const esPorteroIA = esPortero(pieza.id);
    const destinos = obtenerDestinosJugador(pieza.fila, pieza.col, 'visitante')
      .filter(d => !estaOcupada(d.fila, d.col, pieza.id));

    // ── PORTERO ──────────────────────────────────────────────────────────────
    if (esPorteroIA) {
      const porteroCol  = pieza.col;
      const descentrado = Math.abs(porteroCol - 6);
      const balonEnArea = balonF >= 9;
      const balonLejos  = balonF <= 8;

      for (const dest of destinos) {
        let score = 0;
        const enAreaGrande = dest.fila >= 9 && dest.fila <= 13 && dest.col >= 2 && dest.col <= 10;
        if (!enAreaGrande) { score -= 5000; }
        else if (hayAmenazaGol) {
          // Antes de bloquear: comprobar si el portero puede ganar posesión.
          // Recuperar el balón es siempre mejor que bloquear una línea.
          const esColindanteBalon = Math.abs(dest.fila - balonF) <= 1 && Math.abs(dest.col - balonC) <= 1;
          estado.fichas[pieza.id].fila = dest.fila;
          estado.fichas[pieza.id].col  = dest.col;
          const ganaPosesionPortero = equipoTienePosesion('visitante');
          estado.fichas[pieza.id].fila = pieza.fila;
          estado.fichas[pieza.id].col  = pieza.col;

          if (esColindanteBalon && ganaPosesionPortero) {
            // Portero recupera el balón: lookahead completo, tiene prioridad sobre bloqueo
            estado.fichas[pieza.id].fila = dest.fila;
            estado.fichas[pieza.id].col  = dest.col;
            const resPropio  = iaBestBallSequence(balonF, balonC, 4, -Infinity, Infinity);
            const scoreRival = iaSimularMejorTurnoLocal();
            estado.fichas[pieza.id].fila = pieza.fila;
            estado.fichas[pieza.id].col  = pieza.col;
            score = resPropio.score - scoreRival * (0.8 + Math.max(0, (balonF - 7) / 7) * 0.4) + 8000;
          } else {
            // No puede recuperar: valorar cuántas líneas de amenaza bloquea desde este destino.
            // Simular el portero en dest y redetectar amenazas: las que desaparezcan = bloqueadas.
            // Esto premia naturalmente acercarse al balón (achicar ángulo) porque una casilla
            // próxima intersecta más trayectorias simultáneamente que una pegada a la línea de gol.
            estado.fichas[pieza.id].fila = dest.fila;
            estado.fichas[pieza.id].col  = dest.col;
            const amenazasTras = iaDetectarAmenazaGol();
            estado.fichas[pieza.id].fila = pieza.fila;
            estado.fichas[pieza.id].col  = pieza.col;
            const lineasCortadas = amenazasGolActuales.length - amenazasTras.length;
            // Cada línea cortada vale mucho; bonus adicional por acercarse al balón
            const distDestBalon = iaDistancia(dest.fila, dest.col, balonF, balonC);
            score += lineasCortadas * 18000;
            score += Math.max(0, 3000 - distDestBalon * 600); // bonus por achique de ángulo
            // Pequeña penalización si no corta ninguna línea y se aleja del balón
            if (lineasCortadas === 0) score -= distDestBalon * 200;
          }
        } else if (balonEnArea) {
          const esColindanteBalon = Math.abs(dest.fila - balonF) <= 1 && Math.abs(dest.col - balonC) <= 1;
          estado.fichas[pieza.id].fila = dest.fila;
          estado.fichas[pieza.id].col  = dest.col;
          const ganaPosesionPortero = equipoTienePosesion('visitante');
          estado.fichas[pieza.id].fila = pieza.fila;
          estado.fichas[pieza.id].col  = pieza.col;

          if (esColindanteBalon && ganaPosesionPortero) {
            estado.fichas[pieza.id].fila = dest.fila;
            estado.fichas[pieza.id].col  = dest.col;
            const resPropio  = iaBestBallSequence(balonF, balonC, 4, -Infinity, Infinity);
            const scoreRival = iaSimularMejorTurnoLocal();
            estado.fichas[pieza.id].fila = pieza.fila;
            estado.fichas[pieza.id].col  = pieza.col;
            score = resPropio.score - scoreRival * (0.8 + Math.max(0, (balonF - 7) / 7) * 0.4) + 8000;
          } else if (esColindanteBalon) {
            score += 15000;
            score -= Math.abs(dest.col - 6) * 80;
          } else {
            score -= Math.abs(dest.col - balonC) * 30;
            score -= Math.abs(dest.fila - 13) * 10;
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

        // Bloqueo de líneas rivales también aplica al portero
        const lineasCortadas = iaLineasCortadasEnDest(dest.fila, dest.col, lineasRivalesActuales, balonF, balonC);
        score += lineasCortadas * 600;

        candidatos.push({ piezaId: pieza.id, dest, score });
      }
      continue;
    }

    // ── JUGADORES DE CAMPO ────────────────────────────────────────────────────

    // Preordenar destinos: si no hay posesión, priorizar los más cercanos al balón;
    // si hay posesión, priorizar los que ya son colindantes o que más avanzan.
    const destsOrdenados = destinos.slice().sort((a, b) => {
      if (!visitanteTienePosesion) {
        return iaDistancia(a.fila, a.col, balonF, balonC) - iaDistancia(b.fila, b.col, balonF, balonC);
      }
      const colA = (Math.abs(a.fila - balonF) <= 1 && Math.abs(a.col - balonC) <= 1) ? 1 : 0;
      const colB = (Math.abs(b.fila - balonF) <= 1 && Math.abs(b.col - balonC) <= 1) ? 1 : 0;
      return (colB * 100 + (14 - b.fila)) - (colA * 100 + (14 - a.fila));
    }).slice(0, 12);

    for (const dest of destsOrdenados) {
      estado.fichas[pieza.id].fila = dest.fila;
      estado.fichas[pieza.id].col  = dest.col;

      const ganaPosesionAhora  = equipoTienePosesion('visitante');
      const distDestBalon      = iaDistancia(dest.fila, dest.col, balonF, balonC);
      const esColindanteDest   = Math.abs(dest.fila - balonF) <= 1 && Math.abs(dest.col - balonC) <= 1;

      let scoreTotal = 0;

      // ── ESTRATEGIA 1: MAYORÍA PRIMERO ──────────────────────────────────────
      // Si el visitante no tenía posesión pero con este movimiento la consigue,
      // es la jugada más valiosa de todas: abre el turno de balón completo.
      // Distinguimos tres niveles: recuperar posesión, empatar (neutro→posesión),
      // y simplemente acercarse.
      // Factor rival: cuanto más cerca está el balón de nuestra portería (fila 14),
      // más peso damos a lo que puede hacer el local en su turno.
      const factorRival = 0.8 + Math.max(0, (balonF - 7) / 7) * 0.4; // 0.8 a 1.2

      if (!visitanteTienePosesion && ganaPosesionAhora) {
        // Recién conseguida la posesión: lookahead completo del balón
        const resPropio  = iaBestBallSequence(balonF, balonC, 4, -Infinity, Infinity);
        const scoreRival = iaSimularMejorTurnoLocal();
        scoreTotal = resPropio.score - scoreRival * factorRival;
        // Bonus por haber conseguido la posesión con este movimiento
        // (cuánto más cerca del balón queda el jugador, más sólida la posesión)
        scoreTotal += 3500 + Math.max(0, 400 - distDestBalon * 60);
        if (esColindanteDest) scoreTotal += 600;

      } else if (visitanteTienePosesion) {
        // Ya teníamos posesión: evaluar si este movimiento mejora la posición
        // antes de mover el balón (abre líneas de tiro, mejora ángulo)
        const resPropio  = iaBestBallSequence(balonF, balonC, 4, -Infinity, Infinity);
        const scoreRival = iaSimularMejorTurnoLocal();
        scoreTotal = resPropio.score - scoreRival * factorRival;
        scoreTotal += Math.max(0, 500 - distDestBalon * 50);
        if (esColindanteDest) scoreTotal += 300;

        // ── ESTRATEGIA 2 (dentro de posesión): ABRIR LÍNEAS DE TIRO ──────────
        // Si al moverse este jugador (por ejemplo salir de la trayectoria) se abren
        // más líneas hacia portería rival, bonus significativo
        const lineasDespues = iaLineasAbiertasTrasMovimiento(dest.fila, dest.col, pieza.id, balonF, balonC);
        const lineasNuevas  = lineasDespues - lineasPropiasAntes;
        if (lineasNuevas > 0) scoreTotal += lineasNuevas * 700;

      } else {
        // Sin posesión, sin conseguirla: evaluación completa del estado + heurísticas
        scoreTotal = iaEvaluarEstado();
        scoreTotal += Math.max(0, 2000 - distDestBalon * 200);
        if (esColindanteDest) scoreTotal += 3000;

        // Quitar posesión al rival es muy valioso aunque no la ganemos nosotros
        const quitaPosesion = rivalTienePosesion && !equipoTienePosesion('local');
        if (quitaPosesion) scoreTotal += 4500;

        // Si hay varios visitantes ya colindantes, el siguiente que llegue da mayoría
        const visitantesColindantesActuales = piezasIA.filter(p =>
          p.id !== pieza.id &&
          Math.abs(p.fila - balonF) <= 1 && Math.abs(p.col - balonC) <= 1
        ).length;
        const localesColindantesActuales = Object.values(estado.fichas).filter(d =>
          d.equipo === 'local' &&
          Math.abs(d.fila - balonF) <= 1 && Math.abs(d.col - balonC) <= 1
        ).length;
        if (visitantesColindantesActuales >= 1 && localesColindantesActuales >= 1) {
          const distLocalCercano = Math.min(...Object.values(estado.fichas)
            .filter(d => d.equipo === 'local' &&
              !(Math.abs(d.fila - balonF) <= 1 && Math.abs(d.col - balonC) <= 1))
            .map(d => iaDistancia(d.fila, d.col, balonF, balonC))
            .concat([99])
          );
          if (esColindanteDest) scoreTotal += 10000;
          else if (distDestBalon < distLocalCercano) scoreTotal += 3000;
          else scoreTotal -= 1000;
        } else if (visitantesColindantesActuales >= 1 && esColindanteDest) {
          scoreTotal += 8000;
        }

        // PRESIÓN CON AMENAZA POTENCIAL: aunque no tengamos el balón ahora,
        // posicionarse en casillas desde las que cualquier balón cercano sería tiro
        // a portería obliga al rival a defender y es tácticamente valioso.
        // Solo se activa en campo rival (balonF <= 9) para no desperdiciar
        // movimientos defensivos que lo computan también.
        if (balonF <= 9) {
          const amenaza = iaAmenazaPotencialEnDest(dest.fila, dest.col, pieza.id);
          // Escalar por lo ofensiva que es la posición del balón: más cerca, más urgente amenazar
          const factorOfensivo = Math.max(0.3, (10 - balonF) / 10);
          scoreTotal += amenaza * factorOfensivo;
        }
      }

      // ── ESTRATEGIA 3: BLOQUEO DE LÍNEAS RIVALES ────────────────────────────
      // Independientemente del contexto: si al moverse aquí se cortan líneas
      // de tiro del rival, es un bonus táctico importante.
      // Solo aplica cuando el balón está en zona de peligro (campo propio fila 7+)
      // o cuando hay amenaza de gol activa, para no penalizar avances ofensivos.
      if (balonF >= 7 || hayAmenazaGol) {
        const lineasCortadas = iaLineasCortadasEnDest(dest.fila, dest.col, lineasRivalesActuales, balonF, balonC);
        if (lineasCortadas > 0) {
          // El valor de cortar una línea crece si el balón está más cerca de nuestra portería
          const urgencia = Math.max(1, balonF - 6);
          scoreTotal += lineasCortadas * 500 * (urgencia / 7);
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
  _resetCacheLineas();
  const balonF = estado.fichas.balon.fila;
  const balonC = estado.fichas.balon.col;
  const destinos = obtenerDestinosBalon(balonF, balonC);
  if (destinos.length === 0) return null;

  let primero, secuencia = [], scoreElegido = 0;

  if (equipoTienePosesion('visitante')) {
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

// ====== INSTRUMENTACIÓN DE RENDIMIENTO ======
// Contadores globales para las funciones internas
let _cntEvaluar = 0, _cntLineas = 0, _cntBestBall = 0, _cntBestBallLocal = 0, _cntAmenaza = 0;

self.onmessage = function(e) {
  const { tipo, estadoJuego, movRestantes } = e.data;
  estado = estadoJuego;

  _cntEvaluar = 0; _cntLineas = 0; _cntBestBall = 0; _cntBestBallLocal = 0; _cntAmenaza = 0;
  const _t0 = Date.now();

  if (tipo === 'MOVER_JUGADOR') {
    const decision = calcularDecisionJugador();
    const ms = Date.now() - _t0;
    console.log(
      '⏱ PERF [JUGADOR] ' + ms + 'ms |' +
      ' evaluar:' + _cntEvaluar +
      ' lineas:' + _cntLineas +
      ' bestBall:' + _cntBestBall +
      ' bestBallLocal:' + _cntBestBallLocal +
      ' amenaza:' + _cntAmenaza
    );
    self.postMessage({ tipo: 'DECISION_JUGADOR', decision });
  } else if (tipo === 'MOVER_BALON') {
    const decision = calcularDecisionBalon(movRestantes);
    const ms = Date.now() - _t0;
    console.log(
      '⏱ PERF [BALON] ' + ms + 'ms |' +
      ' evaluar:' + _cntEvaluar +
      ' lineas:' + _cntLineas +
      ' bestBall:' + _cntBestBall
    );
    self.postMessage({ tipo: 'DECISION_BALON', decision });
  }
};
