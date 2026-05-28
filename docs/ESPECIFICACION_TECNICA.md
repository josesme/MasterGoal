# ESPECIFICACIÓN TÉCNICA - MASTERGOAL DIGITAL

*Documento técnico para implementación digital basado en las reglas oficiales © GOALMIND S.A. 1992*

---

## 📋 RESUMEN DEL JUEGO

| Parámetro | Valor |
|-----------|-------|
| **Jugadores** | 2-8 (2-4 por equipo) |
| **Duración** | 15-30 minutos |
| **Complejidad** | Media |
| **Edad** | 8+ |
| **Tablero** | 15 filas × 11 columnas (143 casillas terreno + porterías) |

---

## 🎯 MECÁNICAS PRINCIPALES

### 1. Sistema de Movimiento

```javascript
// Movimiento de Jugador/Portero
const movimientoJugador = {
  tipo: "jugador",
  maxDistancia: 2,           // 1-2 casillas máximo
  minDistancia: 1,
  direcciones: 8,            // incluye diagonales
  restriccion: "linea_recta", // no puede cambiar de dirección
  puedeSaltar: false,        // no puede saltar sobre otras fichas
  entraEnPorteria: false     // no puede entrar en casillas de portería
}

// Movimiento del Balón
const movimientoBalon = {
  tipo: "balon",
  maxDistancia: 4,           // 1-4 casillas máximo
  minDistancia: 1,
  direcciones: 8,            // todas las direcciones
  restriccion: "linea_recta", // no puede cambiar de dirección
  puedeSaltar: true,         // puede saltar sobre jugadores
  entraEnPorteria: true,     // único que puede entrar en portería
  restriccionesSalto: [
    "nunca_sobre_portero_contrario_en_area_grande",  // ❌ Nunca saltar sobre portero contrario en área grande
    "puede_sobre_propio_portero_en_area_grande",     // ✅ Sí puede sobre propio portero (mismo equipo)
    "nunca_sobre_jugadores_en_area_chica"            // ❌ Nunca saltar sobre jugadores en área chica (sin excepciones)
  ]
}
```

### 2. Sistema de Posesión

```javascript
const ESTADOS_POSESION = {
  LIBRE: "libre",           // Balón sin jugador colindante
  EN_POSESION: "posesion",  // Jugador en casilla adyacente
  NEUTRA: "neutra",         // Igual número de jugadores de ambos equipos alrededor
  DEL_PORTERO: "portero"    // En casillas de brazos del portero
}
```

### 3. Cadena de Pases

```javascript
// MÁXIMO 4 MOVIMIENTOS DE BALÓN POR TURNO
const cadenaPases = {
  maxMovimientosBalon: 4,
  movimientosRestantes: 4,
  
  // Secuencia válida:
  // 1. Mover Jugador A → Consigue posesión
  // 2. Mover Balón → Pase a Jugador B
  // 3. Mover Jugador B → Nueva posición
  // 4. Mover Balón → Pase a Jugador C
  // 5. Mover Jugador C → Nueva posición
  // 6. Mover Balón → ¡GOL!
  
  reglas: {
    direccion: "cualquier_direccion",
    noAutopase: true,      // No puede pasar de casilla propia a casilla propia
    casillasMayoria: true, // Casillas por mayoría se usan en pases
    continuarODesviar: true // Jugador puede continuar o desviar dirección
  }
}
```

---

## 🏟️ ESTRUCTURA DEL TABLERO

### Grid 15×11 (con zonas de portería)

**Sistema de coordenadas:** `fila-columna` (ej: 7-6)

```javascript
const tablero = {
  // Terreno de juego: 13 filas × 11 columnas
  terrenoJuego: {
    filas: { min: 1, max: 13 },    // 13 filas
    columnas: { min: 1, max: 11 }   // 11 columnas
  },
  // Porterías: fuera del terreno
  porterias: {
    P1: { fila: 'P1', columnas: [4, 5, 6, 7, 8] },  // Superior
    P2: { fila: 'P2', columnas: [4, 5, 6, 7, 8] }   // Inferior
  },
  // Áreas
  areas: {
    P1: {
      grande: {
        filas: { min: 1, max: 4 },
        columnas: { min: 2, max: 10 }
      },
      chica: {
        filas: { min: 1, max: 2 },
        columnas: { min: 3, max: 9 }
      }
    },
    P2: {
      grande: {
        filas: { min: 10, max: 13 },
        columnas: { min: 2, max: 10 }
      },
      chica: {
        filas: { min: 12, max: 13 },
        columnas: { min: 3, max: 9 }
      }
    }
  },
  centro: { fila: 7, columna: 6 },
  corners: [
    { fila: 1, columna: 1 },
    { fila: 1, columna: 11 },
    { fila: 13, columna: 1 },
    { fila: 13, columna: 11 }
  ],
  totalCasillasTerreno: 143
}
```

### Zonas Especiales

| Zona | Coordenadas (fila-columna) | Función |
|------|---------------------------|---------|
| **Córner** | 1-1, 1-11, 13-1, 13-11 | Esquinas del terreno |
| **Terreno de juego** | Filas 1-13, Columnas 1-11 | Área de juego principal |
| **Portería P1 (superior)** | P1-4 a P1-8 | Zona de gol (5 casillas) |
| **Portería P2 (inferior)** | P2-4 a P2-8 | Zona de gol (5 casillas) |
| **Área Grande (P1)** | Filas 1-4, Columnas 2-10 | Zona del portero (incluye área chica) |
| **Área Chica (P1)** | Filas 1-2, Columnas 3-9 | Zona protegida superior |
| **Área Grande (P2)** | Filas 10-13, Columnas 2-10 | Zona del portero (incluye área chica) |
| **Área Chica (P2)** | Filas 12-13, Columnas 3-9 | Zona protegida inferior |
| **Centro** | 7-6 | Saque inicial |
| **Puntos Verdes** | Centro del tablero | Posiciones iniciales |
| **Puntos Amarillos** | Línea de fondo contraria | Casillas especiales (turno extra) |

---

## ♟️ FICHAS Y ESTADOS

### Estructura de Ficha

```javascript
class Ficha {
  constructor(tipo, equipo, id, posicion) {
    this.tipo = tipo;         // "jugador" | "portero" | "balon"
    this.equipo = equipo;     // 1 | 2
    this.id = id;
    this.posicion = {         // { fila: number, columna: number }
      fila: posicion.fila,
      columna: posicion.columna
    };
    this.enMovimiento = false;
  }
}
```

### Posiciones Iniciales

```javascript
const posicionesIniciales = {
  equipo1: [  // Defiende portería P1 (superior)
    { tipo: "portero", fila: 2, columna: 6 },
    { tipo: "jugador", fila: 4, columna: 4 },
    { tipo: "jugador", fila: 4, columna: 8 },
    { tipo: "jugador", fila: 6, columna: 3 },
    { tipo: "jugador", fila: 6, columna: 9 }
  ],
  equipo2: [  // Defiende portería P2 (inferior)
    { tipo: "portero", fila: 12, columna: 6 },
    { tipo: "jugador", fila: 8, columna: 3 },
    { tipo: "jugador", fila: 8, columna: 9 },
    { tipo: "jugador", fila: 10, columna: 4 },
    { tipo: "jugador", fila: 10, columna: 8 }
  ],
  balon: { fila: 7, columna: 6 }  // Centro del terreno
}
```

---

## 🎮 ESTADOS DEL JUEGO

### Máquina de Estados

```javascript
const ESTADOS_JUEGO = {
  INICIO: "inicio",               // Configuración inicial
  SORTEO: "sorteo",               // Decidiendo qué equipo comienza
  TURNO_JUGADOR: "turno_jugador", // Moviendo jugador/portero
  TURNO_BALON: "turno_balon",     // Moviendo balón
  ESPERANDO: "esperando",         // Entre movimientos
  GOL: "gol",                     // Gol marcado
  RECOLOCACION: "recolocacion",   // Después del gol
  BALON_AHOGADO: "balon_ahogado", // Balón sin movimientos válidos
  FIN_PARTIDO: "fin_partido"      // Partido terminado
}
```

### Flujo de Turno

```
┌─────────────────┐
│   INICIO TURNO  │
└────────┬────────
         │
         ▼
┌─────────────────┐
│ MOVER JUGADOR   │───→ ¿Posesión del balón?
│   O PORTERO     │         │
└────────────────┘         ▼
         │          ┌─────────────────┐
         │          │ MOVER BALÓN     │
         │          │ (obligatorio)   │
         │          ────────┬────────
         │                  │
         │                  ▼
         │          ¿Más movimientos?
         │          (máximo 4)
         │          │
         │    ┌────┴────┐
         │    │         │
         │   SÍ         NO
         │    │         │
         │    │         ▼
         │    │  ┌─────────────────┐
         │    │  │ FIN TURNO       │
         │    │  │ (pasa al otro   │
         │    │  │  equipo)        │
         │    │  └─────────────────┘
         │    │
         │    ▼
         │  ┌─────────────────┐
         │  │ MOVER JUGADOR   │
         │  │ (siguiente)     │
         │  └─────────────────┘
         │
         ▼
┌─────────────────┐
│   FIN TURNO     │
└─────────────────┘
```

---

## ⚽ DETECCIÓN DE GOL

### Validación de Gol

```javascript
function esGol(movimiento, tablero) {
  const { destino, direccion } = movimiento;
  
  // 1. Verificar si entra en zona de portería (P1 o P2)
  const esPorteria = (
    (destino.fila === 'P1' || destino.fila === 'P2') &&  // Filas de portería
    (destino.columna >= 4 && destino.columna <= 8)       // 5 casillas centradas
  );
  
  if (!esPorteria) return false;
  
  // 2. Verificar dirección válida (frontal o diagonal)
  const direccionValida = (
    direccion === "frontal" || 
    direccion === "diagonal"
  );
  
  if (!direccionValida) return false;
  
  // 3. Verificar que no salta sobre portero contrario en área grande
  const noSaltaPorteroContrario = !obstaculoEnCamino(
    movimiento, 
    "portero_contrario_area_grande",
    movimiento.equipo
  );
  
  if (!noSaltaPorteroContrario) return false;
  
  // 4. Verificar que no salta sobre jugadores en área chica
  const noSaltaJugadorAreaChica = !obstaculoEnCamino(
    movimiento, 
    "jugador_area_chica"
  );
  
  if (!noSaltaJugadorAreaChica) return false;
  
  // 5. Verificar que solo el balón puede entrar en portería
  const soloBalonEnPorteria = (movimiento.ficha === "balon");
  
  return soloBalonEnPorteria;
}
```

### Después del Gol

```javascript
function despuesDelGol(equipoQueRecibioGol, tablero) {
  // 1. Recolocar todas las fichas en posición inicial
  tablero.recolocarFichas(posicionesIniciales);
  
  // 2. El equipo que recibió el gol mueve primero
  tablero.equipoTurno = equipoQueRecibioGol;
  
  // 3. Actualizar marcador
  marcador.registrarGol(equipoQueAnoto, "gol");
  
  // 4. Verificar si se alcanzaron los 2 goles (modalidad a dos goles)
  if (config.modalidad === "2_goles") {
    const ganador = marcador.verificarVictoria(config);
    if (ganador) {
      estado = ESTADOS_JUEGO.FIN_PARTIDO;
    }
  }
}
```

---

## 🥅 LÓGICA DEL PORTERO

### Brazos del Portero

```javascript
class Portero extends Ficha {
  constructor(equipo, posicion) {
    super("portero", equipo, posicion);
    this.brazos = this.calcularBrazos(posicion);
  }
  
  calcularBrazos(posicion) {
    // Brazos laterales del portero (casillas adyacentes)
    return [
      { fila: posicion.fila, columna: posicion.columna - 1 }, // Brazo izquierdo
      { fila: posicion.fila, columna: posicion.columna + 1 }  // Brazo derecho
    ];
  }
  
  esCasillaBrazo(casilla) {
    return this.brazos.some(b => 
      b.fila === casilla.fila && b.columna === casilla.columna
    );
  }
  
  // El balón en casillas de brazos siempre pertenece al portero
  poseeBalonEnBrazos(balon) {
    return this.esCasillaBrazo(balon.posicion);
  }
  
  // Verificar si portero está en el límite del área grande
  estaEnLimiteArea() {
    const areaGrande = this.equipo === 1 ? areas.P1.grande : areas.P2.grande;
    return (
      this.posicion.fila === areaGrande.filas.max ||  // Borde inferior área
      this.posicion.fila === areaGrande.filas.min     // Borde superior área
    );
  }
  
  // Si está en el límite, solo vale el brazo dentro del área
  getBrazosValidos() {
    if (!this.estaEnLimiteArea()) {
      return this.brazos;
    }
    
    // Filtrar solo el brazo que está dentro del área
    const areaChica = this.equipo === 1 ? areas.P1.chica : areas.P2.chica;
    return this.brazos.filter(b => 
      b.fila >= areaChica.filas.min &&
      b.fila <= areaChica.filas.max &&
      b.columna >= areaChica.columnas.min &&
      b.columna <= areaChica.columnas.max
    );
  }
}
```

### Restricciones del Portero

| Acción | Permitida | Notas |
|--------|-----------|-------|
| Moverse en su área | ✅ | Máximo 2 casillas |
| Bloquear balón con brazos | ✅ | Automático |
| Salir del área grande | ✅ | Pero pierde características especiales |
| Atravesado por balón contrario | ❌ | Brazos inviolables |
| Salto sobre propio portero | ✅ | Compañeros pueden saltar |
| Salto sobre portero contrario | ❌ | Equipo contrario no puede saltar |

---

## 🟩 CASILLAS ESPECIALES - LÓGICA

### Casillas Neutras

```javascript
function esCasillaNeutra(balon, tablero) {
  const colindantes = obtenerColindantes(balon.posicion);
  
  let equipo1 = 0;
  let equipo2 = 0;
  
  colindantes.forEach(casilla => {
    const ficha = tablero.getCasilla(casilla);
    if (ficha && ficha.tipo !== "balon") {
      if (ficha.equipo === 1) equipo1++;
      else if (ficha.equipo === 2) equipo2++;
    }
  });
  
  // Neutral si igual número de jugadores de ambos equipos
  return equipo1 === equipo2 && equipo1 > 0;
}

function resolverNeutralidad(balon, equipoTurno, tablero) {
  // El equipo con turno coloca un jugador para establecer mayoría
  // El balón pasa a ser de ese equipo
  return {
    posesion: equipoTurno,
    debeMoverBalon: true
  };
}
```

### Casillas de Córner

```javascript
function puedeEnviarACorner(ficha, destino, tablero) {
  const esCorner = (
    (destino.fila === 1 && (destino.columna === 1 || destino.columna === 11)) ||
    (destino.fila === 13 && (destino.columna === 1 || destino.columna === 11))
  );
  
  if (!esCorner) return true;
  
  // Determinar a qué equipo pertenece el córner
  const cornerEquipo = (destino.fila === 1) ? 2 : 1;
  
  // Prohibido para el equipo propietario enviar el balón
  return cornerEquipo !== ficha.equipo;
}
```

### Puntos Amarillos (Turno Extra)

```javascript
function esPuntoAmarillo(casilla, tablero) {
  // Puntos amarillos están en línea de fondo contraria
  return casilla.tipo === "punto_amarillo";
}

function aplicarBonusPuntoAmarillo(jugador, tablero) {
  if (esPuntoAmarillo(jugador.posicion, tablero)) {
    return { turnoExtra: true };
  }
  return { turnoExtra: false };
}
```

---

## 🎮 MODALIDADES DE JUEGO

### Configuración de Partida

```javascript
const CONFIGURACION_PARTIDA = {
  modalidad: "2_goles",       // "2_goles" | "tiempo_pactado"
  golesParaGanar: 2,
  tiempoLimite: null,         // null o minutos
  jugadoresPorEquipo: 1,      // 1-4 jugadores humanos por equipo
  iaActivada: false
}
```

### Sistema de Puntuación

```javascript
class Marcador {
  constructor() {
    this.equipo1 = 0;
    this.equipo2 = 0;
    this.historial = [];
  }
  
  registrarGol(equipo, tipo, turno) {
    if (equipo === 1) this.equipo1++;
    else this.equipo2++;
    
    this.historial.push({
      equipo,
      tipo, // "frontal" | "diagonal"
      turno,
      marcador: { 
        equipo1: this.equipo1, 
        equipo2: this.equipo2 
      }
    });
  }
  
  verificarVictoria(config) {
    if (config.modalidad === "2_goles") {
      if (this.equipo1 >= config.golesParaGanar) return 1;
      if (this.equipo2 >= config.golesParaGanar) return 2;
      return null;
    }
    // Para tiempo pactado, se verifica al finalizar el tiempo
    return null;
  }
  
  obtenerGanador() {
    if (this.equipo1 > this.equipo2) return 1;
    if (this.equipo2 > this.equipo1) return 2;
    return null; // Empate
  }
}
```

---

## 🤖 IA - ARQUITECTURA (OPCIONAL)

### Niveles de Dificultad

```javascript
const NIVELES_IA = {
  FACIL: {
    profundidad: 1,
    aleatoriedad: 0.3,
    priorizarGol: false,
    movimientosValidosAleatorios: true
  },
  MEDIO: {
    profundidad: 2,
    aleatoriedad: 0.1,
    priorizarGol: true,
    heuristicas: ["posicion_balon", "cercania_porteria"]
  },
  DIFICIL: {
    profundidad: 3,
    aleatoriedad: 0.0,
    priorizarGol: true,
    usarMinimax: true,
    podaAlphaBeta: true,
    heuristicas: [
      "posicion_balon",
      "cercania_porteria",
      "control_casillas",
      "cadena_pases"
    ]
  }
}
```

---

## 🌐 MULTIPLAYER ONLINE

### Arquitectura Cliente-Servidor

```
┌─────────────┐      WebSocket      ┌─────────────┐
│  Cliente 1  │ ◄─────────────────► │   Servidor  │
│  (Jugador)  │                     │   (Node.js) │
└─────────────┘                     ──────┬──────┘
                                           │
┌─────────────┐      WebSocket              │
│  Cliente 2  │ ◄───────────────────────────┘
│  (Jugador)  │
└─────────────┘
```

### Eventos WebSocket

```javascript
// Cliente → Servidor
const EVENTOS_CLIENTE = {
  UNIRSE_PARTIDA: "unirse_partida",
  CREAR_PARTIDA: "crear_partida",
  MOVER_FICHA: "mover_ficha",
  MOVER_BALON: "mover_balon",
  ABANDONAR: "abandonar",
  CHAT: "chat",
  PAUSA: "pausa"
}

// Servidor → Cliente
const EVENTOS_SERVIDOR = {
  PARTIDA_CREADA: "partida_creada",
  PARTIDA_INICIADA: "partida_iniciada",
  TURNO_ACTUAL: "turno_actual",
  MOVIMIENTO_REALIZADO: "movimiento_realizado",
  MOVIMIENTO_INVALIDO: "movimiento_invalido",
  GOL_MARCADO: "gol_marcado",
  PARTIDA_FINALIZADA: "partida_finalizada",
  ERROR: "error",
  CHAT_MENSAJE: "chat_mensaje"
}
```

### Estado del Servidor

```javascript
class ServidorPartida {
  constructor() {
    this.partidas = new Map();
    this.salas = new Map();
  }
  
  crearPartida(config) {
    const partida = {
      id: generarId(),
      estado: ESTADOS_JUEGO.INICIO,
      configuracion: config,
      tablero: new Tablero(),
      marcador: new Marcador(),
      jugadores: [],
      equipoTurno: null,
      movimientosBalon: 0,
      historial: []
    };
    
    this.partidas.set(partida.id, partida);
    return partida;
  }
  
  validarMovimiento(partida, movimiento) {
    // 1. Verificar que es el turno del jugador
    if (movimiento.equipo !== partida.equipoTurno) {
      return { valido: false, error: "No es tu turno" };
    }
    
    // 2. Verificar que el movimiento es válido (línea recta, distancia, etc.)
    if (!esMovimientoValido(movimiento, partida.tablero)) {
      return { valido: false, error: "Movimiento inválido" };
    }
    
    // 3. Verificar restricciones de salto del balón
    if (movimiento.ficha === "balon") {
      if (obstaculoEnCamino(movimiento, "portero_contrario_area_grande", movimiento.equipo)) {
        return { valido: false, error: "No puede saltar sobre portero contrario" };
      }
      if (obstaculoEnCamino(movimiento, "jugador_area_chica")) {
        return { valido: false, error: "No puede saltar sobre área chica" };
      }
    }
    
    return { valido: true };
  }
}
```

---

## 📱 INTERFAZ DE USUARIO

### Elementos Necesarios

| Elemento | Función |
|----------|---------|
| Tablero interactivo | Grid 15×11 con casillas clickeables |
| Fichas drag&drop | Arrastrar para mover |
| Indicador de turno | Mostrar equipo actual |
| Contador de movimientos | Movimientos restantes de balón (0-4) |
| Marcador | Goles de cada equipo |
| Historial | Últimos movimientos |
| Botón deshacer | Revertir último movimiento (opcional) |
| Chat | Comunicación entre jugadores |
| Botón abandonar | Salir de la partida |

### Flujo de Interacción

```
1. Click en jugador/portero → Resaltar movimientos válidos (1-2 casillas)
2. Click en destino → Mover jugador/portero
3. Si posesión → Resaltar movimientos de balón (1-4 casillas, línea recta)
4. Click en destino balón → Mover balón
5. Repetir hasta 4 movimientos o gol
6. Fin de turno → Pasar al siguiente jugador
```

---

## 🛠️ STACK TECNOLÓGICO RECOMENDADO

### Opción A: Web App (Recomendada)

| Capa | Tecnología | Justificación |
|------|------------|---------------|
| **Frontend** | React + TypeScript | Tipado estático, componentes reutilizables |
| **Renderizado** | HTML5 Canvas o SVG | Rendimiento para tablero interactivo |
| **Estado** | Redux o Zustand | Gestión de estado compleja |
| **Backend** | Node.js + Express | JavaScript en ambos lados |
| **Real-time** | Socket.io | Comunicación bidireccional |
| **Base de datos** | MongoDB (opcional) | Guardar partidas, usuarios |
| **Hosting FE** | Vercel | Gratuito, fácil deploy |
| **Hosting BE** | Railway | Gratuito para empezar |

### Opción B: Python (IA/Prototipo)

| Capa | Tecnología | Justificación |
|------|------------|---------------|
| **Interfaz** | Pygame | Fácil de implementar |
| **IA** | Python puro + Minimax | Bibliotecas de IA disponibles |
| **Server** | WebSocket-server | Multiplayer básico |

---

## 📝 PRÓXIMOS PASOS

### Prioridad 1: Prototipo Básico
1. [ ] Tablero interactivo (HTML5 Canvas)
2. [ ] Movimiento de jugadores (1-2 casillas)
3. [ ] Movimiento de balón (1-4 casillas, línea recta)
4. [ ] Sistema de turnos básico
5. [ ] Detección de gol (frontal y diagonal)

### Prioridad 2: Reglas Completas
6. [ ] Validación de saltos del balón (con excepciones)
7. [ ] Casillas neutras y resolución por mayoría
8. [ ] Cadena de pases (máximo 4 movimientos)
9. [ ] Brazos del portero y restricciones
10. [ ] Casillas especiales (puntos amarillos, córner)

### Prioridad 3: Multiplayer
11. [ ] Servidor WebSocket básico
12. [ ] Clientes conectados
13. [ ] Sincronización de estado
14. [ ] Sistema de salas

### Prioridad 4: IA y Pulido
15. [ ] IA básica (movimientos aleatorios válidos)
16. [ ] Interfaz gráfica mejorada
17. [ ] Modalidades de juego (2 goles, tiempo pactado)
18. [ ] Historial de partidas

---

## 📚 REFERENCIAS

- [REGLAS_COMPLETAS.md](REGLAS_COMPLETAS.md) - Reglas oficiales estructuradas
- [REFERENCIA_RAPIDA.md](REFERENCIA_RAPIDA.md) - Guía rápida de consulta
- [TRANSCRIPCION_COMPLETA_MANUAL.md](TRANSCRIPCION_COMPLETA_MANUAL.md) - Texto literal del manual

---

*Documento de especificación técnica para implementación digital de MasterGoal*

**© GOALMIND S.A. 1992** - Todos los derechos reservados.

*Documento creado para fines educativos y de preservación del juego MasterGoal*

**Última actualización:** Mayo 2026
