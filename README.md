# 🏆 MASTERGOAL - Proyecto de Digitalización

> **Juego de mesa clásico de fútbol (GOALMIND S.A., 1992)** - Ahora disponible para jugar online

![Estado](https://img.shields.io/badge/estado-documentaci%C3%B3n%20completa-green)
![Jugadores](https://img.shields.io/badge/jugadores-2--8-orange)
![Complejidad](https://img.shields.io/badge/complejidad-media-blue)

---

## 📖 DESCRIPCIÓN

**MasterGoal** es un juego de mesa de fútbol descatalogado, originalmente publicado por **GOALMIND S.A. en 1992**.

Este proyecto tiene como objetivo **preservar y digitalizar** el juego para que pueda ser jugado online con amigos.

### 🎯 Objetivo del Juego

**Introducir el Balón en las casillas de la Portería contraria** mediante una combinación estratégica de movimientos de jugadores y pases.

---

## 📁 ESTRUCTURA DEL PROYECTO

```
MasterGoal/
├── docs/
│   ├── TRANSCRIPCION_COMPLETA_MANUAL.md    # Texto literal del manual original
│   ├── REGLAS_COMPLETAS.md                 # Reglas oficiales estructuradas
│   ├── REFERENCIA_RAPIDA.md                # Guía rápida de consulta
│   └── ESPECIFICACION_TECNICA.md           # Documentación para desarrollo
├── assets/                                  # Imágenes y recursos
│   └── reglas_1.png, reglas_2.png, reglas_3.png
├── src/                                     # Código fuente (pendiente)
│   ├── frontend/
│   └── backend/
└── README.md                                # Este archivo
```

---

## 📚 DOCUMENTACIÓN DISPONIBLE

| Documento | Descripción | Estado |
|-----------|-------------|--------|
| [TRANSCRIPCION_COMPLETA_MANUAL.md](docs/TRANSCRIPCION_COMPLETA_MANUAL.md) | **Texto literal completo** de las 3 páginas del manual original © GOALMIND S.A. 1992 | ✅ Completo |
| [REGLAS_COMPLETAS.md](docs/REGLAS_COMPLETAS.md) | **Reglas oficiales organizadas** con todos los detalles del juego | ✅ Completo |
| [REFERENCIA_RAPIDA.md](docs/REFERENCIA_RAPIDA.md) | **Guía rápida** de consulta durante partidas | ✅ Completo |
| [ESPECIFICACION_TECNICA.md](docs/ESPECIFICACION_TECNICA.md) | **Documentación técnica** para implementación digital | ✅ Actualizado |

---

## 🎮 COMPONENTES DEL JUEGO

### Tablero

| Elemento | Medidas | Casillas |
|----------|---------|----------|
| **Tablero completo** | 15 filas × 11 columnas | 165 + porterías |
| **Terreno de juego** | 13 filas × 11 columnas | 143 casillas |
| **Porterías** | 2 zonas exteriores (P1 y P2) | 5 casillas cada una |

### Fichas

| Ficha | Cantidad | Movimiento | Direcciones |
|-------|----------|------------|-------------|
| **Jugador** | 4 por equipo | 1-2 casillas | 8 (incluye diagonales) |
| **Portero** | 1 por equipo | 1-2 casillas | 8 (en su área) |
| **Balón** | 1 (compartido) | 1-4 casillas | Línea recta únicamente |

---

## 📍 SISTEMA DE COORDENADAS

**Formato:** `fila-columna` (ej: `7-6`)

### Coordenadas Principales

| Elemento | Coordenadas |
|----------|-------------|
| **Centro** | 7-6 |
| **Córners** | 1-1, 1-11, 13-1, 13-11 |
| **Portería P1** (superior) | P1-4 a P1-8 |
| **Portería P2** (inferior) | P2-4 a P2-8 |
| **Área Grande P1** | Filas 1-4, Columnas 2-10 |
| **Área Chica P1** | Filas 1-2, Columnas 3-9 |
| **Área Grande P2** | Filas 10-13, Columnas 2-10 |
| **Área Chica P2** | Filas 12-13, Columnas 3-9 |

### Posiciones Iniciales

**Equipo Superior (defiende P1):**
| Ficha | Coordenadas |
|-------|-------------|
| Portero | 2-6 |
| Jugadores | 4-4, 4-8, 6-3, 6-9 |

**Equipo Inferior (defiende P2):**
| Ficha | Coordenadas |
|-------|-------------|
| Portero | 12-6 |
| Jugadores | 8-3, 8-9, 10-4, 10-8 |

**Balón:** 7-6

---

## 🎯 MECÁNICAS PRINCIPALES

### 1. Movimiento

```
Jugador:  1-2 casillas → 8 direcciones → Línea recta
Portero:  1-2 casillas → 8 direcciones → Línea recta
Balón:    1-4 casillas → Línea recta únicamente
```

**Reglas importantes:**
- ✅ Todos los movimientos son **siempre en línea recta** (no pueden cambiar de dirección)
- ✅ Solo el **balón puede saltar** sobre jugadores (con excepciones)
- ✅ Solo el **balón puede entrar** en casillas de portería
- ❌ El balón **NUNCA** puede saltar sobre:
  - El portero **contrario** cuando está en su **área grande**
  - Jugadores que estén **defendiendo en el área chica** (ningún equipo)
- ✅ El balón **SÍ PUEDE** saltar sobre:
  - **Propio portero** en área grande (pase entre compañeros del mismo equipo)

### 2. Turnos y Posesión

```
1. Mover Jugador o Portero (obligatorio)
   │
2. ¿Consigue posesión del balón?
   ├── NO → Fin del turno, pasa al otro equipo
   └── SÍ → Debe mover el balón (obligatorio)
        │
3. Mover Balón (1-4 casillas, línea recta)
   │
4. ¿Más movimientos? (máximo 4 movimientos de balón)
   ├── SÍ → Vuelve al paso 1
   └── NO → Fin del turno
```

**Reglas clave:**
- ✅ **Siempre** hay que mover un Jugador o Portero en tu turno
- ✅ Si **nadie consigue posesión** del Balón → fin del turno
- ✅ El Balón se puede mover **máximo 4 veces** sucesivamente
- ✅ **No es obligatorio** agotar los 4 movimientos si el Balón se deja correctamente

### 3. Cadena de Pases

**Cómo mover el balón 4 veces en el mismo turno:**

```
Jugador A → Balón → Jugador B → Balón → Jugador C → Balón → GOL
```

**Reglas de pase:**
- ✅ El balón puede ser enviado en **cualquier dirección**
- ✅ Desde casilla colindante a un Jugador → casilla colindante a otro Jugador
- ✅ El Jugador que recibe puede **continuar o desviar** la dirección
- ❌ **NO** se puede hacer **autopase** (misma casilla de origen y destino)
- ✅ Las casillas por **mayoría de Jugadores** se usan en los pases

### 4. Casillas Especiales

| Tipo | Coordenadas | Efecto |
|------|-------------|--------|
| **Puntos amarillos** | Línea de fondo contraria | Turno extra al colocar el Balón |
| **Córner** | 1-1, 1-11, 13-1, 13-11 | Prohibido enviar el Balón (equipo propietario) |
| **Casillas neutras** | Variables | Se resuelven por mayoría de jugadores |

### 5. El Gol

**Se produce Gol cuando el Balón logra entrar en las casillas de Portería.**

- ✅ **Válido:** Entrada por diagonal
- ✅ **Válido:** Entrada por movimiento frontal

**Después del Gol:**
1. Todas las fichas vuelven a posición inicial
2. El equipo que recibió el gol mueve primero

---

## 🚩 MODALIDADES DE JUEGO

| Modalidad | Descripción | Victoria |
|-----------|-------------|----------|
| **A dos goles** | Gana el primero en llegar a 2 goles | Resultados: 1-0 ó 2-0 |
| **A tiempo pactado** | Se juega durante un tiempo acordado | Mayor número de goles |

---

## 👥 PARTIDA CON MÁS DE 2 PERSONAS

**Cuando en un mismo equipo interviene más de una persona:**

1. **El Portero y los cuatro jugadores deben ser "repartidos" entre ellas**
2. **Se elige un capitán del equipo**, quien decidirá **qué jugador ha de mover, pero no cómo va a mover**
3. **Los pases también son privativos de cada Jugador que posee el Balón**

---

## 🛠️ TECNOLOGÍAS PROPUESTAS

### Stack Principal (Web App)

| Capa | Tecnología |
|------|------------|
| **Frontend** | React + TypeScript + HTML5 Canvas |
| **Backend** | Node.js + Express |
| **Real-time** | Socket.io |
| **Base de datos** | MongoDB (opcional, para guardar partidas) |
| **Hosting** | Vercel (frontend) + Railway (backend) |

### Alternativa (Python para IA/Prototipo)

| Capa | Tecnología |
|------|------------|
| **Interfaz** | Pygame |
| **IA** | Python + Minimax/MCTS |
| **Server** | WebSocket-server |

---

## 🚀 ROADMAP

### Fase 1: Documentación ✅ COMPLETADA
- [x] Transcripción literal del manual original
- [x] Reglas completas estructuradas
- [x] Guía rápida de referencia
- [x] Especificación técnica documentada
- [x] Sistema de coordenadas definido
- [x] Posiciones iniciales validadas

### Fase 2: Prototipo (PENDIENTE)
- [ ] Tablero interactivo básico (HTML/JS)
- [ ] Lógica de movimientos (1-2 casillas jugador, 1-4 balón)
- [ ] Sistema de turnos y posesión
- [ ] Detección de gol (frontal y diagonal)
- [ ] Validación de saltos del balón (con excepciones)

### Fase 3: Multiplayer (PENDIENTE)
- [ ] Servidor WebSocket
- [ ] Clientes conectados
- [ ] Sincronización de estado
- [ ] Chat entre jugadores
- [ ] Sistema de salas

### Fase 4: IA (OPCIONAL)
- [ ] IA básica (movimientos aleatorios válidos)
- [ ] IA intermedia (heurística de posición)
- [ ] IA avanzada (Minimax/MCTS)
- [ ] Niveles de dificultad ajustables

### Fase 5: Pulido (PENDIENTE)
- [ ] Interfaz gráfica mejorada
- [ ] Sonidos y efectos
- [ ] Historial de partidas
- [ ] Sistema de rankings
- [ ] Modalidades de juego (2 goles, tiempo pactado)

---

## ⚖️ LEGAL

**MasterGoal** es una marca registrada de **GOALMIND S.A. (1992)**.

**© GOALMIND S.A. 1992** - Todos los derechos reservados.

Este proyecto es **sin ánimo de lucro** y tiene fines exclusivos de:
- Preservación histórica
- Educación
- Uso personal entre amigos

**ESTA OBRA NO PUEDE SER REPRODUCIDA NI EN TODO NI EN PARTE, EN NINGUNA FORMA NI POR NINGÚN MEDIO (YA SEA MECÁNICO O POR FOTOCOPIA O POR CUALQUIER OTRO), SIN EL PREVIO PERMISO EXPRESO Y POR ESCRITO DE GOALMIND S.A.**

---

## 🔗 ENLACES DE INTERÉS

- [BoardGameGeek - MasterGoal](https://boardgamegeek.com/boardgame/21879/mastergoal)
- [Manual original (Scribd)](https://es.scribd.com/document/396563399/Reglas-Mastergoal)
- [Foro de discusión (LaBSK)](https://labsk.net/index.php?topic=199946.0)

---

## 👥 CÓMO CONTRIBUIR

Este es un proyecto abierto para preservación de juegos clásicos. Puedes contribuir:

1. **Reportando errores** en las reglas documentadas
2. **Sugiriendo mejoras** a la implementación
3. **Desarrollando** alguna de las fases pendientes
4. **Compartiendo** información sobre el juego original

---

*Proyecto creado con ❤️ para preservar los juegos de mesa clásicos españoles*

**Última actualización:** Mayo 2026  
**Estado:** Documentación completa ✅ | Desarrollo: Pendiente ⏳
