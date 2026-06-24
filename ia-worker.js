// Web Worker para el cálculo de la IA de MasterGoal
// Recibe el estado serializado y devuelve la decisión sin bloquear el hilo principal

// Guard para entorno Node (harness de simulación): el navegador define `self`
// globalmente; en Node lo emulamos para que `self.onmessage = ...` no falle.
if (typeof self === 'undefined') {
  globalThis.self = { onmessage: null, postMessage: function () {} };
}

let estado = null;

// ── CACHÉ DE ENTRADAS DE FICHAS ──────────────────────────────────────────────
// Object.entries(estado.fichas) se llama decenas de miles de veces por decisión
// y reconstruye un array nuevo cada vez (coste + presión de GC + accesos
// megamórficos). Las CLAVES de estado.fichas nunca cambian durante una decisión
// (solo mutan fila/col); el objeto solo se REEMPLAZA en recolocar()/setEstado.
// Cacheamos las entradas por identidad del objeto: si estado.fichas es el mismo
// objeto, devolvemos el array cacheado. 100% equivalente, sin invalidación frágil.
let _fichasRef = null;
let _fichasEntries = null;
function fichasEntries() {
  if (estado.fichas !== _fichasRef) {
    _fichasRef = estado.fichas;
    _fichasEntries = Object.entries(estado.fichas);
  }
  return _fichasEntries;
}

// ── PROFUNDIDAD POR NIVEL ─────────────────────────────────────────────────────
// La profundidad del lookahead es la palanca principal de FUERZA de la IA:
//   - profAtaque  = nº de pases que la IA planea al atacar (iaBestBallSequence).
//   - profDefensa = nº de pases del rival que la IA anticipa al defender
//                   (iaBestBallSequenceLocal dentro de iaSimularMejorTurnoLocal).
// Imbatible ve la cadena completa (4/4) — fuerte pero lento en defensa crítica.
// Los niveles inferiores ven menos: más rápidos y más fáciles de batir. Bajar
// profDefensa hace que la IA no detecte goles largos (defiende peor, como antes
// del fix); bajar profAtaque hace que combine peor de cara a portería.
const IA_PROFUNDIDAD = {
  imbatible:    { profAtaque: 4, profDefensa: 4 },
  leyenda:      { profAtaque: 4, profDefensa: 3 },
  profesional:  { profAtaque: 3, profDefensa: 2 },
  juvenil:      { profAtaque: 2, profDefensa: 2 },
  cadete:       { profAtaque: 2, profDefensa: 1 },
};

function iaGetProfundidad() {
  return IA_PROFUNDIDAD[estado.nivelIA] || IA_PROFUNDIDAD.imbatible;
}

// ── ESTILOS DE JUEGO ─────────────────────────────────────────────────────────
// Cada estilo ajusta multiplicadores sobre los pesos base de iaEvaluarEstado.
// Los valores son factores (1.0 = sin cambio).
const IA_ESTILOS = {
  equilibrado: {
    posBalon:        1.0,   // avance e importancia del balón
    superioridad:    1.0,   // control colindantes al balón
    lineasOfensivas: 1.0,   // líneas de tiro a portería rival
    lineasDefensivas:1.0,   // líneas de peligro propias
    controlCentro:   1.0,   // jugadores en el centro del campo
    avanceJugadores: 1.0,   // bonus por jugadores adelantados
    cercaniaBalon:   1.0,   // bonus por cercanía al balón
    presionZona:     1.0,   // bonus por jugadores cerca del balón en peligro
  },
  // "Autobús": bloque bajo. Todos atrás, tapar centro y líneas, marcar de cerca,
  // sin interés por avanzar el balón (al recuperar, despejar lejos — ver regla en
  // calcularDecisionBalon). Lo opuesto a regalar balón/centro como hacía antes.
  defensivo: {
    posBalon:        0.3,   // casi no le importa avanzar el balón
    superioridad:    1.2,   // mantener control cerca del balón
    lineasOfensivas: 0.5,   // mínima ambición ofensiva
    lineasDefensivas:2.5,   // obsesión con cortar líneas de peligro
    controlCentro:   1.3,   // TAPAR el centro (antes 0.5 lo regalaba)
    avanceJugadores: 0.1,   // jugadores muy retrasados (bloque bajo)
    cercaniaBalon:   1.2,   // acudir a marcar al poseedor/receptor
    presionZona:     1.8,   // agruparse fuerte ante peligro
  },
  presion: {
    posBalon:        1.1,
    superioridad:    1.4,   // dominar colindantes es clave
    lineasOfensivas: 1.3,
    lineasDefensivas:0.7,   // asume riesgo defensivo
    controlCentro:   1.6,   // el centro es vital para la presión
    avanceJugadores: 1.5,   // jugadores muy adelantados
    cercaniaBalon:   1.6,   // todos cerca del balón
    presionZona:     0.8,
  },
  contraataque: {
    posBalon:        1.2,
    superioridad:    1.1,
    lineasOfensivas: 1.4,   // maximizar líneas de tiro cuando ataca
    lineasDefensivas:1.2,   // cuidado defensivo pero no obsesivo
    controlCentro:   0.7,   // equipo escalonado, no compacto en centro
    avanceJugadores: 0.6,   // esperan retrasados para salir en transición
    cercaniaBalon:   0.9,
    presionZona:     1.3,
  },
};

function iaGetEstilo() {
  const id = estado.estiloVisitante || 'equilibrado';
  return IA_ESTILOS[id] || IA_ESTILOS.equilibrado;
}

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
  for (const [id, d] of fichasEntries()) {
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
  for (const [id, d] of fichasEntries()) {
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
  for (const [id, d] of fichasEntries()) {
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
  return esAutopaseConOrigen(filaDest, colDest, actuales);
}

// Variante que recibe los colindantes de origen ya calculados (son idénticos
// para todos los destinos de una misma llamada a obtenerDestinosBalon).
//
// Regla de autopase (con casillas compartidas):
//   - El balón lo mueve un "pasador efectivo": el jugador del equipo colindante
//     al balón que SÍ puede tocarlo. Si el último que tocó (ultimoPasador) está
//     entre los colindantes de origen, NO puede repetir, así que el pasador
//     efectivo es OTRO colindante distinto.
//   - Es autopase si el destino pertenece EXCLUSIVAMENTE a ese pasador efectivo
//     (mover de una casilla suya a otra suya). Si el destino también pertenece a
//     otro compañero (casilla compartida) o es exclusiva de otro, es pase válido.
function esAutopaseConOrigen(filaDest, colDest, actuales) {
  const equipo = estado.turno;
  const destino = obtenerColindantesEquipo(filaDest, colDest, equipo);

  // Pasadores posibles en origen: los colindantes que NO son el último pasador
  // (el último no puede mover de nuevo en este movimiento).
  const posiblesPasadores = estado.ultimoPasador
    ? actuales.filter(id => id !== estado.ultimoPasador)
    : actuales.slice();

  // Si tras excluir al último pasador queda exactamente UN pasador efectivo,
  // el balón lo mueve él. Es autopase si el destino es exclusivamente suyo.
  if (posiblesPasadores.length === 1) {
    const pasador = posiblesPasadores[0];
    if (destino.length === 1 && destino[0] === pasador) return true;
    return false;
  }

  // Si hay varios pasadores posibles (casilla compartida sin restricción de
  // último pasador aplicable), solo es autopase si el destino tiene un único
  // colindante y coincide con el único colindante de origen (caso clásico:
  // ambos extremos pertenecen al mismo y único jugador).
  if (actuales.length === 1 && destino.length === 1 && actuales[0] === destino[0]) return true;

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
      for (const [id, d] of fichasEntries()) {
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
  // Local ataca fila 14, visitante ataca fila 0
  const esGoal = estado.turno === 'local' ? (f === 14 && c >= 4 && c <= 8) : (f === 0 && c >= 4 && c <= 8);
  if (esGoal) return true;
  // Local: córner propio en fila 13; Visitante: córner propio en fila 1
  if (estado.turno === 'local'    && ((f === 13 && c === 1) || (f === 13 && c === 11))) return false;
  if (estado.turno === 'visitante' && ((f === 1 && c === 1) || (f === 1 && c === 11))) return false;
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
  // Pasada única de filtros independientes (antes eran 4 .filter encadenados que
  // creaban 3 arrays intermedios). El orden de los AND no altera el resultado.
  // Local ataca fila 14 (portería propia fila 0); visitante ataca fila 0 (propia 14).
  const esLocal = estado.turno === 'local';
  // Colindantes de origen: idénticos para todos los destinos de esta llamada.
  const colindOrigen = obtenerColindantesEquipo(estado.fichas.balon.fila, estado.fichas.balon.col, estado.turno);
  dest = dest.filter(d => {
    // portería/córner propios
    if (esLocal) {
      if (d.fila === 0) return false;
      if (d.fila === 1 && (d.col === 1 || d.col === 11)) return false;
    } else {
      if (d.fila === 14) return false;
      if (d.fila === 13 && (d.col === 1 || d.col === 11)) return false;
    }
    if (saltaPorteroContrario(f, c, d.fila, d.col)) return false;
    if (saltaJugadorEnAreaChica(f, c, d.fila, d.col)) return false;
    if (esAutopaseConOrigen(d.fila, d.col, colindOrigen)) return false;
    return true;
  });
  if (estado.movimientosBalon === 3) {
    return dest.filter(d => esDestinoValidoCuartoMovimiento(d.fila, d.col));
  }
  const esPorteriaContraria = (f, c) =>
    estado.turno === 'local' ? (f === 14 && c >= 4 && c <= 8) : (f === 0 && c >= 4 && c <= 8);
  const balonOriginal2 = { ...estado.fichas.balon };
  const pasadorOriginal = estado.ultimoPasador;
  // Pasador efectivo de este movimiento: el colindante que NO era el último
  // pasador (el anterior no repite). Si queda uno solo, ese mueve; si quedan
  // varios (casilla compartida sin restricción), null. Misma lógica que mover()
  // en index.html para que ambos motores propaguen el pasador igual.
  const colindantesActuales = obtenerColindantesEquipo(f, c, estado.turno);
  const efectivosEste = pasadorOriginal
    ? colindantesActuales.filter(id => id !== pasadorOriginal)
    : colindantesActuales;
  const pasadorEste = efectivosEste.length === 1 ? efectivosEste[0] : null;
  dest = dest.filter(d => {
    if (esPorteriaContraria(d.fila, d.col)) return true;
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
      if (esPorteriaContraria(d.fila, d.col)) return true;
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
        const bloqueador = fichasEntries().find(([id, d]) => d.fila === nf && d.col === nc);
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
  for (const [id, d] of fichasEntries()) {
    if (id === 'balon' || d.equipo !== equipo) continue;
    if (Math.abs(d.fila - bf) <= 1 && Math.abs(d.col - bc) <= 1) n++;
  }
  return n;
}

function iaErrorRate() {
  // Error base por nivel (imbatible=0, leyenda=0.10, profesional=0.25, juvenil=0.45, cadete=0.65)
  const baseNivel = { imbatible: 0, leyenda: 0.10, profesional: 0.25, juvenil: 0.45, cadete: 0.65 };
  const base = baseNivel[estado.nivelIA] ?? 0.25;
  if (base === 0) return 0;
  // Potencial (1-5): potencial alto reduce el error, potencial bajo lo aumenta
  // Rango de ajuste: ±(base * 0.3), centrado en potencial 3
  const potencial = estado.potencialRival ?? 3;
  const ajuste = base * 0.3 * (3 - potencial) / 2; // potencial 5 → -0.15*base, potencial 1 → +0.15*base
  return Math.max(0, Math.min(0.95, base + ajuste));
}

function iaElegir(candidatos) {
  if (candidatos.length === 0) return null;
  candidatos.sort((a, b) => b.score - a.score);
  if (candidatos.length === 1) return candidatos[0];

  // Error aleatorio según nivel y potencial del rival
  const errorRate = iaErrorRate();
  if (errorRate > 0 && Math.random() < errorRate) {
    return candidatos[Math.floor(Math.random() * candidatos.length)];
  }

  // Sin error: elección ponderada entre los 3 mejores (comportamiento original)
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
  const E  = iaGetEstilo();
  let v = 0;

  // ── 1. POSESIÓN ──────────────────────────────────────────────────────────
  const visitanteTiene = equipoTienePosesion('visitante');
  const localTiene     = equipoTienePosesion('local');
  if (visitanteTiene) v += 3000;
  if (localTiene)     v -= 3000;

  // ── 2. POSICIÓN DEL BALÓN (avance + centralidad) ──────────────────────────
  v += (14 - bf) * 200 * E.posBalon;
  if (bf <= 6) v += (5 - Math.abs(bc - 6)) * 90 * E.posBalon;
  if (bf <= 3) v += ((4 - bf) * 220 + (5 - Math.abs(bc - 6)) * 60) * E.posBalon;
  if (bf >= 9) {
    const peligro = (bf - 8) * 400 + (5 - Math.abs(bc - 6)) * 120;
    v -= peligro * E.lineasDefensivas;
  }

  // ── 3. SUPERIORIDAD NUMÉRICA EN CASILLAS COLINDANTES ─────────────────────
  const rc  = iaColindantesSimulados(bf, bc, 'visitante');
  const lc  = iaColindantesSimulados(bf, bc, 'local');
  v += (rc - lc) * 320 * E.superioridad;
  if (rc - lc >= 2) v += 400 * E.superioridad;

  // ── 4. LÍNEAS DE TIRO A PORTERÍA RIVAL (amenaza ofensiva) ────────────────
  const posLocales = Object.values(estado.fichas).filter(f => f.equipo === 'local');
  const lineasOfensivas = iaLineasAPorteriaCached(bf, bc, 'visitante');
  for (const linea of lineasOfensivas) {
    if (!linea.bloqueadaPorPortero) {
      const bonusLinea = Math.max(0, 600 - linea.dist * 80);
      const centralidad = 5 - Math.abs(linea.colPorteria - 6);
      let cubierta = false;
      for (let d = 1; d <= linea.dist && !cubierta; d++) {
        const tf = bf + linea.df * d, tc = bc + linea.dc * d;
        for (const loc of posLocales) {
          if (Math.abs(loc.fila - tf) <= 1 && Math.abs(loc.col - tc) <= 1 && !(loc.fila === tf && loc.col === tc)) {
            cubierta = true; break;
          }
        }
      }
      v += (cubierta ? (bonusLinea + centralidad * 40) * 0.4 : bonusLinea + centralidad * 40) * E.lineasOfensivas;
    } else {
      v += Math.max(0, 250 - linea.dist * 40) * E.lineasOfensivas;
    }
  }

  // ── 5. LÍNEAS DE PELIGRO RIVALES (presión defensiva) ─────────────────────
  const posVisitantes = Object.values(estado.fichas).filter(f => f.equipo === 'visitante');
  const lineasDefensivas = iaLineasRivalesAbiertas(bf, bc);
  for (const linea of lineasDefensivas) {
    if (!linea.bloqueadaPorPortero) {
      const penalLinea = Math.max(0, 500 - linea.dist * 70);
      const centralidad = 5 - Math.abs(linea.colPorteria - 6);
      let cubierta = false;
      for (let d = 1; d <= linea.dist && !cubierta; d++) {
        const tf = bf + linea.df * d, tc = bc + linea.dc * d;
        for (const vis of posVisitantes) {
          if (Math.abs(vis.fila - tf) <= 1 && Math.abs(vis.col - tc) <= 1 && !(vis.fila === tf && vis.col === tc)) {
            cubierta = true; break;
          }
        }
      }
      v -= (cubierta ? (penalLinea + centralidad * 30) * 0.4 : penalLinea + centralidad * 30) * E.lineasDefensivas;
    } else {
      v -= Math.max(0, 180 - linea.dist * 30) * E.lineasDefensivas;
    }
  }

  // ── 6. CONTROL DEL CENTRO DEL CAMPO ──────────────────────────────────────
  let controlCentroVisitante = 0, controlCentroLocal = 0;
  for (const [id, d] of fichasEntries()) {
    if (id === 'balon' || esPortero(id)) continue;
    if (d.equipo === 'visitante' && d.fila >= 4 && d.fila <= 9 && Math.abs(d.col - 6) <= 2) controlCentroVisitante++;
    if (d.equipo === 'local'     && d.fila >= 5 && d.fila <= 10 && Math.abs(d.col - 6) <= 2) controlCentroLocal++;
  }
  v += (controlCentroVisitante - controlCentroLocal) * 300 * E.controlCentro;

  // ── 7. POSICIONAMIENTO INDIVIDUAL ─────────────────────────────────────────
  const enPeligro = bf >= 8;

  // Defensivo: si va ganando, reforzar posiciones retrasadas
  const marcador = estado.marcador || { visitante: 0, local: 0 };
  const vaGanando = marcador.visitante > marcador.local;
  const extraDefensivo = (estado.estiloVisitante === 'defensivo' && vaGanando) ? 1.4 : 1.0;

  for (const [id, d] of fichasEntries()) {
    if (id === 'balon' || esPortero(id)) continue;
    const distBal      = iaDistancia(d.fila, d.col, bf, bc);
    const esColindante = Math.abs(d.fila - bf) <= 1 && Math.abs(d.col - bc) <= 1;
    const df = d.fila - bf, dc = d.col - bc;
    const enLineaPase = !esColindante && distBal >= 2 && distBal <= 4 &&
      (df === 0 || dc === 0 || Math.abs(df) === Math.abs(dc));

    if (d.equipo === 'visitante') {
      if (enPeligro) {
        v += Math.max(0, 800 - distBal * 160) * E.presionZona;
        if (esColindante) v += 900 * E.presionZona;
      } else {
        v += (14 - d.fila) * 28 * E.avanceJugadores * extraDefensivo;
        v += Math.max(0, 200 - distBal * 40) * E.cercaniaBalon;
        if (esColindante) v += 350 * E.cercaniaBalon;
        if (d.fila <= 7 && Math.abs(d.col - 6) <= 2) v += 150 * E.controlCentro;
        if (enLineaPase) v += 180 * E.cercaniaBalon;
        if (bf <= 6 && d.fila >= 9) v -= 200 * E.avanceJugadores;
      }
    } else {
      v -= Math.max(0, 200 - distBal * 40) * E.cercaniaBalon;
      if (esColindante) v -= 450 * E.cercaniaBalon;
      v -= d.fila * 28 * E.avanceJugadores;
      if (Math.abs(d.col - bc) <= 2 && d.fila > bf) v -= 250 * E.cercaniaBalon;
      if (enLineaPase) v -= 150 * E.cercaniaBalon;
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
  // Pasador efectivo de este nivel: colindante que no era el último pasador
  // (coherente con obtenerDestinosBalon y mover()).
  const colindantesNivel = obtenerColindantesEquipo(f, c, 'visitante');
  const efectivosNivel = oldPasador
    ? colindantesNivel.filter(id => id !== oldPasador)
    : colindantesNivel;
  const pasadorNivel = efectivosNivel.length === 1 ? efectivosNivel[0] : null;

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
    // Límite de tiempo: si se agotó el reloj y ya hay un candidato, cortar la
    // exploración. El balón está en (f,c) aquí (restaurado al final de la
    // iteración previa), así que la restauración posterior al bucle es correcta.
    if (mejorScore > -Infinity && tiempoAgotado()) break;
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
      // Minimax: solo en los últimos 2 movimientos para evitar explosión combinatoria
      const scoreTrasTurnoLocal = movRestantes <= 2
        ? iaMinimaxTurnoLocal(d.fila, d.col)
        : iaSimularMejorTurnoLocal();
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

// ampPiezas: nº de destinos por pieza a explorar. 8 = preciso (uso puntual);
// 3 = rápido pero suficiente para detectar si el local marca (uso en bucle
// defensivo, donde se llama decenas de veces y prof. 4 sería prohibitiva a 8).
function iaSimularMejorTurnoLocal(ampPiezas = 8) {
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
    const top = scored.slice(0, ampPiezas).map(s => s.d);
    for (const dest of top) {
      estado.fichas[pieza.id].fila = dest.fila;
      estado.fichas[pieza.id].col  = dest.col;
      let scoreFinal;
      if (equipoTienePosesion('local')) {
        // Profundidad de DEFENSA según nivel: cuántos pases del rival anticipa.
        // 4 = ve goles de 3-4 pases (Imbatible); valores menores = más ciega a
        // jugadas largas (niveles inferiores defienden peor y calculan más rápido).
        scoreFinal = iaBestBallSequenceLocal(balonF, balonC, iaGetProfundidad().profDefensa) - 2000;
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

// ====== LIBRO DE APERTURAS ══════════════════════════════════════════════════
// Jugadas predefinidas para posiciones reconocibles (p.ej. saque de centro), que
// la IA siempre resolvería igual pero a un coste enorme (el saque de centro son
// ~38s y 4.7M evaluaciones para elegir SIEMPRE lo mismo). Si la posición está en
// el libro, se devuelve el movimiento guardado al instante.
//
// Diseño STATELESS (el worker no guarda estado entre mensajes): cada movimiento
// se indexa por la FIRMA de la posición en la que se aplica. Una apertura es una
// cadena de firmas: la pieza tiene su firma; tras moverla, la posición resultante
// tiene otra firma que mapea al 1er pase de balón; etc. Así cada llamada
// (calcularDecisionJugador / calcularDecisionBalon) consulta su firma actual y,
// si hay match, sirve el movimiento sin calcular.
//
// Estructura: LIBRO_APERTURAS[estilo][firma] = { tipo:'pieza'|'balon', ... }
//   tipo 'pieza': { piezaId, dest:{fila,col} }
//   tipo 'balon': { dest:{fila,col} }
// Se genera con sim/generar-libro.js (captura lo que la IA ya calcula).
// Generado por sim/generar-libro.js (captura la jugada que la IA calcula en
// imbatible para el saque de centro, por estilo). Regenerar si cambia el motor.
const LIBRO_APERTURAS = {
  "equilibrado": {
    // Dictada por el usuario: saca v-j1, deja el balón neutro en la esquina propia
    // (10,11) con recuperación garantizada el próximo turno (v-j2 a 2, v-j4 a 3).
    "visitante|MOVER_JUGADOR|2,6;4,4;4,8;6,3;6,9;12,6;8,3;8,9;10,4;10,8;7,6;": {"tipo":"pieza","piezaId":"v-j1","dest":{"fila":8,"col":5}},
    "visitante|MOVER_BALON|2,6;4,4;4,8;6,3;6,9;12,6;8,5;8,9;10,4;10,8;7,6;": {"tipo":"balon","dest":{"fila":10,"col":9}},
    "visitante|MOVER_BALON|2,6;4,4;4,8;6,3;6,9;12,6;8,5;8,9;10,4;10,8;10,9;": {"tipo":"balon","dest":{"fila":10,"col":11}}
  },
  "defensivo": {
    // Dictada por el usuario: saca un jugador, deja el balón neutro en la esquina
    // de campo propio (10,1) — estructura intacta atrás y recuperación garantizada
    // el próximo turno (v-j1/v-j3 cerca, sin rivales). No regala posesión central.
    "visitante|MOVER_JUGADOR|2,6;4,4;4,8;6,3;6,9;12,6;8,3;8,9;10,4;10,8;7,6;": { "tipo": "pieza", "piezaId": "v-j2", "dest": { "fila": 8, "col": 7 } },
    "visitante|MOVER_BALON|2,6;4,4;4,8;6,3;6,9;12,6;8,3;8,7;10,4;10,8;7,6;": { "tipo": "balon", "dest": { "fila": 10, "col": 3 } },
    "visitante|MOVER_BALON|2,6;4,4;4,8;6,3;6,9;12,6;8,3;8,7;10,4;10,8;10,3;": { "tipo": "balon", "dest": { "fila": 10, "col": 1 } }
  },
  "presion": {
    "visitante|MOVER_JUGADOR|2,6;4,4;4,8;6,3;6,9;12,6;8,3;8,9;10,4;10,8;7,6;": { "tipo": "pieza", "piezaId": "v-j1", "dest": { "fila": 6, "col": 5 } },
    "visitante|MOVER_BALON|2,6;4,4;4,8;6,3;6,9;12,6;6,5;8,9;10,4;10,8;7,6;": { "tipo": "balon", "dest": { "fila": 9, "col": 8 } },
    "visitante|MOVER_BALON|2,6;4,4;4,8;6,3;6,9;12,6;6,5;8,9;10,4;10,8;9,8;": { "tipo": "balon", "dest": { "fila": 9, "col": 9 } },
    "visitante|MOVER_BALON|2,6;4,4;4,8;6,3;6,9;12,6;6,5;8,9;10,4;10,8;9,9;": { "tipo": "balon", "dest": { "fila": 6, "col": 6 } },
    "visitante|MOVER_BALON|2,6;4,4;4,8;6,3;6,9;12,6;6,5;8,9;10,4;10,8;6,6;": { "tipo": "balon", "dest": { "fila": 2, "col": 2 } }
  },
  "contraataque": {
    "visitante|MOVER_JUGADOR|2,6;4,4;4,8;6,3;6,9;12,6;8,3;8,9;10,4;10,8;7,6;": { "tipo": "pieza", "piezaId": "v-j3", "dest": { "fila": 8, "col": 6 } },
    "visitante|MOVER_BALON|2,6;4,4;4,8;6,3;6,9;12,6;8,3;8,9;8,6;10,8;7,6;": { "tipo": "balon", "dest": { "fila": 9, "col": 8 } },
    "visitante|MOVER_BALON|2,6;4,4;4,8;6,3;6,9;12,6;8,3;8,9;8,6;10,8;9,8;": { "tipo": "balon", "dest": { "fila": 9, "col": 7 } },
    "visitante|MOVER_BALON|2,6;4,4;4,8;6,3;6,9;12,6;8,3;8,9;8,6;10,8;9,7;": { "tipo": "balon", "dest": { "fila": 7, "col": 7 } },
    "visitante|MOVER_BALON|2,6;4,4;4,8;6,3;6,9;12,6;8,3;8,9;8,6;10,8;7,7;": { "tipo": "balon", "dest": { "fila": 3, "col": 11 } }
  }
};

// ── LÍMITE DE TIEMPO POR DECISIÓN ─────────────────────────────────────────────
// El lookahead crece exponencialmente; en posiciones muy abiertas (muchas opciones
// parecidas, poda alfa-beta ineficaz) una decisión podía tardar minutos. Para que
// la IA NUNCA se cuelgue, llevamos un cronómetro por decisión: si se agota, se
// devuelve la mejor jugada encontrada hasta ese momento (como los motores de
// ajedrez con reloj). En 9s ya se explora muchísimo, así que apenas pierde fuerza.
let _deadline = Infinity;          // timestamp límite (Date.now())
// Tope por decisión. En Imbatible las posiciones muy abiertas pueden tardar
// minutos; con esto la IA devuelve la mejor jugada hallada al llegar al tope
// (verificado: no pierde fuerza, ya ve goles dentro del límite). Los niveles
// inferiores casi nunca lo alcanzan. Override por env en Node (pruebas): MG_LIMITE_MS.
const LIMITE_MS = (typeof process !== 'undefined' && process.env && process.env.MG_LIMITE_MS)
  ? parseInt(process.env.MG_LIMITE_MS, 10) : 9000;
function _armarReloj() { _deadline = Date.now() + LIMITE_MS; }
function tiempoAgotado() { return Date.now() > _deadline; }

// Firma determinista de la posición actual: turno + fase + posición de cada ficha
// en orden fijo. Coincidencia exacta.
function firmaPosicion() {
  const ids = ['l-portero','l-j1','l-j2','l-j3','l-j4','v-portero','v-j1','v-j2','v-j3','v-j4','balon'];
  let s = estado.turno + '|' + estado.fase + '|';
  for (const id of ids) {
    const d = estado.fichas[id];
    s += d.fila + ',' + d.col + ';';
  }
  return s;
}

// Busca el movimiento del libro para la posición+estilo actuales, o null.
function consultarLibro() {
  const estilo = estado.estiloVisitante || 'equilibrado';
  const porEstilo = LIBRO_APERTURAS[estilo] || LIBRO_APERTURAS.equilibrado;
  if (!porEstilo) return null;
  return porEstilo[firmaPosicion()] || null;
}

// ====== DECISIÓN MOVER JUGADOR ======

function calcularDecisionJugador() {
  // Libro de aperturas: si esta posición tiene movimiento de pieza predefinido,
  // devolverlo al instante.
  const _libro = consultarLibro();
  if (_libro && _libro.tipo === 'pieza') {
    return { piezaId: _libro.piezaId, dest: _libro.dest, top5: [{ piezaId: _libro.piezaId, dest: _libro.dest, score: 0 }] };
  }

  _armarReloj();
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

  // ── MODO DEFENSA CRÍTICA ──────────────────────────────────────────────────
  // Se activa cuando el rival AMENAZA GOL DE VERDAD en su próximo turno, tenga
  // posesión o el balón esté neutro (jugada típica: deja el balón neutro y al
  // turno siguiente lo recoge y marca). El disparador NO es la fila del balón
  // (la amenaza real puede gestarse desde el medio campo, fila 7-8), sino la
  // AMENAZA RESIDUAL medida con iaSimularMejorTurnoLocal: si el local marca seguro
  // (<= -100000) cuando la IA no interviene, defender por proxies (cortar líneas,
  // colindancia) falla — hay que evaluar cada candidato por amenaza real.
  // NO filtramos por fila del balón: una jugada de gol del local puede cruzar
  // todo el campo en 3-4 pases (p.ej. balón neutro en fila 4 que acaba en gol en
  // fila 14). El disparador es la amenaza real, no la posición del balón. La
  // simulación es barata (~2ms) salvo que la IA tenga posesión clara (su turno
  // de ataque), caso en que no hay amenaza local que medir.
  const balonNeutro = !rivalTienePosesion && !visitanteTienePosesion;
  let defensaCritica = false;
  let amenazaBaseSinIntervenir = 0; // amenaza del local si la IA no interviene
  if (rivalTienePosesion || balonNeutro) {
    amenazaBaseSinIntervenir = iaSimularMejorTurnoLocal();
    if (amenazaBaseSinIntervenir <= -100000) defensaCritica = true;
  }

  // Líneas de tiro rivales abiertas ANTES de cualquier movimiento
  // Sirve para valorar cuántas cortamos con cada destino (estrategia bloqueo)
  const lineasRivalesActuales = iaLineasRivalesAbiertas(balonF, balonC);

  // Líneas de tiro propias abiertas antes de mover
  // Sirve para valorar si un movimiento abre una nueva línea ofensiva
  const lineasPropiasAntes = iaLineasAPorteriaCached(balonF, balonC, 'visitante')
    .filter(l => !l.bloqueadaPorPortero).length;

  let candidatos = [];

  // Evalúa la amenaza residual REAL de mover `piezaId` a (df,dc): aplica el
  // movimiento, simula el mejor turno de ataque del local y devuelve ese score
  // (perspectiva visitante: más alto = menos amenaza = mejor defensa). Restaura
  // el tablero. Caro — usar solo en defensa crítica.
  const evaluarDefensaReal = (piezaId, df, dc) => {
    const oF = estado.fichas[piezaId].fila, oC = estado.fichas[piezaId].col;
    estado.fichas[piezaId].fila = df; estado.fichas[piezaId].col = dc;
    // Si recuperamos posesión, el valor lo da nuestra propia jugada; si no,
    // lo que el local pueda hacer en su turno.
    let s;
    if (equipoTienePosesion('visitante')) {
      const resPropio = iaBestBallSequence(balonF, balonC, 4, -Infinity, Infinity);
      s = resPropio.score + 30000; // recuperar bajo amenaza es lo mejor posible
    } else {
      // Amplitud reducida (3): se llama por cada candidato defensivo; mantener
      // profundidad 4 (detecta el gol) con menos ramas para que sea viable.
      s = iaSimularMejorTurnoLocal(3);
    }
    estado.fichas[piezaId].fila = oF; estado.fichas[piezaId].col = oC;
    return s;
  };

  // (amenazaBaseSinIntervenir ya calculado arriba al evaluar defensaCritica —
  // sirve de referencia, en la misma escala, para los candidatos irrelevantes.)

  // Caché de evaluaciones reales por posición-resultante (evita recalcular si dos
  // candidatos dejan el mismo tablero). La defensa crítica solo se activa con gol
  // inminente — no en cada turno — así que aceptamos su coste a cambio de defender
  // bien (decisión de diseño: calidad sobre velocidad en el momento clave).
  const _cacheDefReal = new Map();
  const evaluarDefensaRealCache = (piezaId, df, dc) => {
    const key = piezaId + ',' + df + ',' + dc;
    if (_cacheDefReal.has(key)) return _cacheDefReal.get(key);
    const v = evaluarDefensaReal(piezaId, df, dc);
    _cacheDefReal.set(key, v);
    return v;
  };

  for (const pieza of piezasIA) {
    // Límite de tiempo: si ya tenemos candidatos y se agotó el reloj, parar de
    // explorar más piezas y quedarnos con lo mejor encontrado. (El estado está
    // restaurado aquí: cada iteración de destino restaura la pieza al terminar.)
    if (candidatos.length > 0 && tiempoAgotado()) break;
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
            // RECUPERACIÓN DEFENSIVA: si el rival tenía posesión y el portero se la
            // arrebata (incluso atrapando el balón con el brazo en minoría), es la
            // jugada defensiva más valiosa posible — evita la jugada de ataque rival.
            // El bonus escala con la cercanía del balón a nuestra portería (fila 14):
            // cuanto más cerca, más gol evitamos. Debe dominar cualquier heurística.
            if (rivalTienePosesion) {
              score += 20000 + Math.max(0, (balonF - 7)) * 4000; // hasta +44000 en fila 14
            }
          } else if (esColindanteBalon && !rivalTienePosesion) {
            // Colindante con balón neutro/propio: posición útil (puede atrapar).
            score += 15000;
            score -= Math.abs(dest.col - 6) * 80;
          } else if (esColindanteBalon) {
            // Colindante PERO el rival mantiene posesión (no se la quitamos):
            // el portero se queda pegado al balón sin recuperarlo — NO defiende,
            // deja al rival su jugada. No premiar como antes (era +15000, falso
            // positivo que hacía al portero ignorar a un jugador de campo que sí
            // neutralizaba). Valor neutro/bajo: que compita un compañero mejor.
            score += 500;
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

        // DEFENSA CRÍTICA: sobreescribir con amenaza residual real. El portero
        // dentro del área grande es candidato relevante (puede recuperar o tapar);
        // fuera del área no defiende, recibe la amenaza base (misma escala).
        if (defensaCritica) {
          score = enAreaGrande
            ? evaluarDefensaRealCache(pieza.id, dest.fila, dest.col)
            : amenazaBaseSinIntervenir - 5000; // fuera del área: aún peor
        }

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

      // BALÓN AHOGADO: si este movimiento gana posesión pero deja al balón sin
      // ningún destino legal (todos serían autopase o ilegales — p.ej. ganar el
      // balón con un jugador solo en una esquina), es una jugada que se atasca y
      // pierde el turno. Detectarlo aquí para penalizarla y que la IA no se ahogue.
      let balonAhogado = false;
      if (ganaPosesionAhora) {
        const oldMovsAh = estado.movimientosBalon;
        const oldTurnoAh = estado.turno;
        estado.movimientosBalon = 0;
        estado.turno = 'visitante';
        balonAhogado = obtenerDestinosBalon(balonF, balonC).length === 0;
        estado.movimientosBalon = oldMovsAh;
        estado.turno = oldTurnoAh;
      }

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
        // Recién conseguida la posesión: lookahead ofensivo según nivel
        const resPropio  = iaBestBallSequence(balonF, balonC, iaGetProfundidad().profAtaque, -Infinity, Infinity);
        const scoreRival = iaSimularMejorTurnoLocal();
        scoreTotal = resPropio.score - scoreRival * factorRival;
        // Bonus por haber conseguido la posesión con este movimiento
        // (cuánto más cerca del balón queda el jugador, más sólida la posesión)
        scoreTotal += 3500 + Math.max(0, 400 - distDestBalon * 60);
        if (esColindanteDest) scoreTotal += 600;

      } else if (visitanteTienePosesion) {
        // Ya teníamos posesión: evaluar si este movimiento mejora la posición
        // antes de mover el balón (abre líneas de tiro, mejora ángulo)
        const resPropio  = iaBestBallSequence(balonF, balonC, iaGetProfundidad().profAtaque, -Infinity, Infinity);
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

      // DEFENSA CRÍTICA: para jugadores de campo, sobreescribir con amenaza
      // residual real. Los candidatos colindantes al balón (pueden romper la
      // mayoría local) se evalúan de verdad; el resto recibe la amenaza base
      // (no intervienen en la disputa) para mantener todos en la misma escala.
      if (defensaCritica) {
        scoreTotal = esColindanteDest
          ? evaluarDefensaRealCache(pieza.id, dest.fila, dest.col)
          : amenazaBaseSinIntervenir;
      }

      // Penalización dominante: ganar el balón para ahogarlo (sin destino legal)
      // desperdicia el turno. Nunca debe elegirse si hay cualquier alternativa.
      if (balonAhogado) scoreTotal -= 1000000;

      estado.fichas[pieza.id].fila = pieza.fila;
      estado.fichas[pieza.id].col  = pieza.col;
      candidatos.push({ piezaId: pieza.id, dest, score: scoreTotal });
    }
  }

  candidatos.sort((a, b) => b.score - a.score);
  const elegido = iaElegir(candidatos);
  return elegido ? { piezaId: elegido.piezaId, dest: elegido.dest, top5: candidatos.slice(0, 5) } : null;
}

// AUTOBÚS: elige la "casilla segura" entre los destinos de balón dados.
// Distancia en pasos de REY (Chebyshov = max(|df|,|dc|)), que es como mueven las
// fichas. Una casilla es SEGURA si, tras dejar el balón neutro ahí, mi jugador
// más cercano llega ANTES que el rival contando el turno: como tras soltar el
// balón mueve el rival, hace falta MI_dist < RIVAL_dist (empate = llega el rival).
// Entre las seguras, preferir la que deja al rival más cercano lo MÁS LEJOS
// posible (y, a igualdad, mi jugador más cerca). Si ninguna es segura, devuelve
// la de mayor ventaja (rival - propio); como último criterio, más lejos del rival.
// AUTOBÚS: elige dónde dejar el balón neutro SIMULANDO el turno del local en
// cada casilla candidata. La heurística de un paso (mi jugador más cerca que el
// rival) era ingenua: dejaba el balón en zona donde el local, con superioridad,
// lo recupera y marca igual (causa del 7-1). Aquí, para cada destino, colocamos
// el balón ahí y medimos iaSimularMejorTurnoLocal() = amenaza residual real
// (perspectiva visitante; MÁS ALTO = el local hace menos daño). Elegimos la
// casilla de MAYOR score. Desempate: alejar de la portería propia (fila 14).
function iaCasillaSeguraAutobus(destinos) {
  const balonF0 = estado.fichas.balon.fila, balonC0 = estado.fichas.balon.col;
  let mejor = null, mejorScore = -Infinity, mejorLejos = -Infinity;
  for (const dst of destinos) {
    if (mejor && tiempoAgotado()) break; // acotar coste; ya tenemos candidato
    estado.fichas.balon.fila = dst.fila; estado.fichas.balon.col = dst.col;
    // Amenaza del local si el balón queda neutro aquí (su mejor turno de ataque).
    const score = iaSimularMejorTurnoLocal();
    estado.fichas.balon.fila = balonF0; estado.fichas.balon.col = balonC0;
    const lejos = 14 - dst.fila; // alejar de portería propia (fila 14)
    if (score > mejorScore || (score === mejorScore && lejos > mejorLejos)) {
      mejorScore = score; mejorLejos = lejos; mejor = dst;
    }
  }
  return mejor;
}

// ====== DECISIÓN MOVER BALÓN ======

function calcularDecisionBalon(movRestantes) {
  // Libro de aperturas: si esta posición tiene un paso de balón predefinido,
  // servirlo al instante (validando que sigue siendo un destino legal).
  const _libro = consultarLibro();
  if (_libro && _libro.tipo === 'balon') {
    const dests0 = obtenerDestinosBalon(estado.fichas.balon.fila, estado.fichas.balon.col);
    const ok = dests0.some(d => d.fila === _libro.dest.fila && d.col === _libro.dest.col);
    if (ok) return { dest: _libro.dest, secuencia: [_libro.dest], score: 0 };
    // si por lo que sea no es legal, caer al cálculo normal
  }

  _armarReloj();
  _resetCacheLineas();
  const balonF = estado.fichas.balon.fila;
  const balonC = estado.fichas.balon.col;
  const destinos = obtenerDestinosBalon(balonF, balonC);
  if (destinos.length === 0) return null;

  let primero, secuencia = [], scoreElegido = 0;

  if (equipoTienePosesion('visitante')) {
    // Acotar la planificación de pases por la profundidad de ataque del nivel:
    // niveles inferiores miran menos jugadas adelante (combinan peor de cara a gol).
    const profMov = Math.min(movRestantes, iaGetProfundidad().profAtaque);
    const res = iaBestBallSequence(balonF, balonC, profMov, -Infinity, Infinity);
    primero = res.seq.length > 0 ? res.seq[0] : null;
    secuencia = res.seq;
    scoreElegido = res.score;

    // AUTOBÚS (estilo defensivo): si la jugada planificada NO es de gol claro,
    // priorizar CASILLA SEGURA: dejar el balón neutro donde conservemos el control.
    // Control real = mi jugador llega antes que el rival CONTANDO EL TURNO (tras
    // dejar el balón neutro, mueve el rival; si su distancia <= mi distancia, llega
    // él). Entre las seguras, preferir la que más LEJOS deja al rival más cercano.
    // Si ninguna es segura, la menos mala (máxima ventaja). Evita el "despeje
    // tonto" que regalaba posesión.
    if ((estado.estiloVisitante === 'defensivo') && scoreElegido < 100000) {
      const elegida = iaCasillaSeguraAutobus(destinos);
      if (elegida) { primero = elegida; secuencia = []; scoreElegido = 0; }
    }
    // Fallback greedy si minimax no encontró secuencia (callejón sin salida)
    if (!primero) {
      let mejorScore = -Infinity;
      for (const d of destinos) {
        estado.fichas.balon.fila = d.fila; estado.fichas.balon.col = d.col;
        const s = iaEvaluarEstado();
        estado.fichas.balon.fila = balonF; estado.fichas.balon.col = balonC;
        if (s > mejorScore) { mejorScore = s; primero = d; scoreElegido = s; }
      }
    }
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

  // Error aleatorio en movimiento de balón: elegir destino al azar del pool válido
  const errorRate = iaErrorRate();
  if (primero && errorRate > 0 && Math.random() < errorRate) {
    primero = destinos[Math.floor(Math.random() * destinos.length)];
    secuencia = [];
    scoreElegido = 0;
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

  try {
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
  } catch (err) {
    console.error('IA worker excepción interna:', err);
    // Siempre responder para no dejar el juego congelado
    if (tipo === 'MOVER_JUGADOR') self.postMessage({ tipo: 'DECISION_JUGADOR', decision: null });
    else self.postMessage({ tipo: 'DECISION_BALON', decision: null });
  }
};

// ====== EXPORTACIONES PARA HARNESS NODE ======
// No afecta al Worker del navegador (module no existe allí).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    // setter/getter del estado interno (el harness inyecta el tablero)
    setEstado: (e) => { estado = e; },
    getEstado: () => estado,
    // decisiones de la IA
    calcularDecisionJugador,
    calcularDecisionBalon,
    // reglas puras reutilizables por el harness
    equipoTienePosesion,
    obtenerDestinosBalon,
    obtenerDestinosJugador,
    estaOcupada,
    esPorteria,
    esPortero,
    esCasillaValida,
    iaEvaluarEstado,
    iaSimularMejorTurnoLocal,
    iaDetectarAmenazaGol,
    // libro de aperturas (para el generador sim/generar-libro.js)
    firmaPosicion,
    LIBRO_APERTURAS,
  };
}
