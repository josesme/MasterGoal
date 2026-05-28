# 📊 ESTADO DEL PROYECTO - MASTERGOAL

*Última actualización: Mayo 2026*

---

## ✅ FASE 1: DOCUMENTACIÓN COMPLETADA

### Documentos Oficiales

| Documento | Estado | Descripción |
|-----------|--------|-------------|
| [TRANSCRIPCION_COMPLETA_MANUAL.md](TRANSCRIPCION_COMPLETA_MANUAL.md) | ✅ **COMPLETO** | Texto literal de las 3 páginas del manual original © GOALMIND S.A. 1992 |
| [REGLAS_COMPLETAS.md](REGLAS_COMPLETAS.md) | ✅ **COMPLETO** | Reglas oficiales organizadas y estructuradas (439 líneas) |
| [REFERENCIA_RAPIDA.md](REFERENCIA_RAPIDA.md) | ✅ **COMPLETO** | Guía rápida de consulta durante partidas |
| [ESPECIFICACION_TECNICA.md](ESPECIFICACION_TECNICA.md) | ✅ **ACTUALIZADO** | Documentación técnica para desarrollo digital |
| [README.md](../README.md) | ✅ **ACTUALIZADO** | Visión general del proyecto |

### Información Extraída y Validada

#### ✅ Dimensiones del Tablero
- **Tablero completo:** 15 filas × 11 columnas
- **Terreno de juego:** 13 filas × 11 columnas (143 casillas)
- **Porterías:** 2 zonas exteriores (P1 y P2), 5 casillas cada una
- **Sistema de coordenadas:** `fila-columna` (ej: 7-6)

#### ✅ Posiciones Iniciales
**Equipo Superior (defiende P1):**
- Portero: 2-6
- Jugadores: 4-4, 4-8, 6-3, 6-9

**Equipo Inferior (defiende P2):**
- Portero: 12-6
- Jugadores: 8-3, 8-9, 10-4, 10-8

**Balón:** 7-6

#### ✅ Movimientos
| Ficha | Distancia | Direcciones | Restricciones |
|-------|-----------|-------------|---------------|
| Jugador | 1-2 casillas | 8 (incluye diagonales) | Línea recta, no salta |
| Portero | 1-2 casillas | 8 (en su área) | Línea recta, no salta |
| Balón | 1-4 casillas | Línea recta | Salta con excepciones |

#### ✅ Reglas de Salto del Balón
| Situación | ¿Puede saltar? |
|-----------|----------------|
| Jugador en campo libre | ✅ Sí |
| Jugador en área grande (no portero) | ✅ Sí |
| Portero **contrario** en área grande | ❌ **NO** |
| **Propio portero** en área grande | ✅ **SÍ** (mismo equipo) |
| Jugador en área chica (cualquier equipo) | ❌ **NO** |

#### ✅ Turnos y Posesión
- ✅ Siempre hay que mover Jugador o Portero (obligatorio)
- ✅ Si nadie consigue posesión → fin del turno
- ✅ Si consigue posesión → debe mover balón (obligatorio)
- ✅ Máximo 4 movimientos de balón sucesivamente
- ✅ No es obligatorio agotar los 4 movimientos
- ✅ Cadena de pases entre jugadores del mismo equipo

#### ✅ Casillas Especiales
- ✅ **Puntos amarillos:** Turno extra al colocar el balón
- ✅ **Córner:** Prohibido para equipo propietario
- ✅ **Casillas neutras:** Se resuelven por mayoría

#### ✅ El Gol
- ✅ Válido: Entrada por diagonal
- ✅ Válido: Entrada por movimiento frontal
- ✅ Después del gol: Recolocación inicial + mueve quien recibió

#### ✅ Modalidades de Juego
- ✅ **A dos goles:** Resultados posibles 1-0 ó 2-0
- ✅ **A tiempo pactado:** Tiempo acordado previamente

#### ✅ Partida con +2 Personas
- ✅ Portero y 4 jugadores se reparten entre jugadores
- ✅ Se elige capitán (decide qué jugador mover, no cómo)
- ✅ Pases son privativos de cada jugador que posee el balón

---

## ⏳ FASE 2: PROTOTIPO (PENDIENTE)

### Tareas Pendientes

- [ ] Tablero interactivo básico (HTML5 Canvas)
- [ ] Lógica de movimientos de jugadores (1-2 casillas)
- [ ] Lógica de movimientos de balón (1-4 casillas, línea recta)
- [ ] Sistema de turnos básico
- [ ] Detección de gol (frontal y diagonal)
- [ ] Validación de saltos del balón (con excepciones)
- [ ] Casillas neutras y resolución por mayoría
- [ ] Cadena de pases (máximo 4 movimientos)
- [ ] Brazos del portero y restricciones
- [ ] Casillas especiales (puntos amarillos, córner)

**Estimación:** 2-4 semanas

---

## ⏳ FASE 3: MULTIPLAYER (PENDIENTE)

### Tareas Pendientes

- [ ] Servidor WebSocket
- [ ] Clientes conectados
- [ ] Sincronización de estado
- [ ] Sistema de salas
- [ ] Chat entre jugadores

**Estimación:** 2-3 semanas

---

## ⏳ FASE 4: IA (OPCIONAL)

### Tareas Pendientes

- [ ] IA básica (movimientos aleatorios válidos)
- [ ] IA intermedia (heurística de posición)
- [ ] IA avanzada (Minimax/MCTS)
- [ ] Niveles de dificultad ajustables

**Estimación:** 3-4 semanas

---

## ⏳ FASE 5: PULIDO (PENDIENTE)

### Tareas Pendientes

- [ ] Interfaz gráfica mejorada
- [ ] Sonidos y efectos
- [ ] Historial de partidas
- [ ] Sistema de rankings
- [ ] Modalidades de juego implementadas
- [ ] Responsive design (móvil/tablet)

**Estimación:** 2-3 semanas

---

## 📋 DECISIONES DE DISEÑO CONSENSUADAS

### Sistema de Coordenadas
- **Formato:** `fila-columna` (ej: `7-6`)
- **Filas:** 1-13 (terreno de juego)
- **Columnas:** 1-11 (terreno de juego)
- **Porterías:** P1 y P2 (fuera de la numeración)

### Movimientos
- **Jugador:** 1-2 casillas máximo (CORREGIDO de 5 a 2)
- **Balón:** 1-4 casillas máximo
- **Todos en línea recta:** Sin cambiar de dirección

### Excepciones de Salto
- ✅ **Sí puede** saltar sobre propio portero en área grande
- ❌ **Nunca** salta sobre portero contrario en área grande
- ❌ **Nunca** salta sobre área chica (ningún equipo)

### Turnos
- ✅ No es obligatorio agotar 4 movimientos
- ✅ Si nadie consigue posesión → fin del turno
- ✅ Después de gol → recolocación + mueve quien recibió

---

## 🎯 PRÓXIMOS PASOS INMEDIATOS

### Semana 1
1. Configurar repositorio Git
2. Crear estructura básica del proyecto
3. Implementar tablero HTML5 Canvas
4. Dibujar grid 15×11
5. Implementar sistema de coordenadas

### Semana 2
6. Implementar movimiento de jugadores (1-2 casillas)
7. Implementar movimiento de balón (1-4 casillas)
8. Validar línea recta en movimientos
9. Implementar sistema de turnos básico

### Semana 3
10. Implementar detección de gol
11. Implementar validación de saltos del balón
12. Implementar casillas neutras
13. Pruebas y corrección de bugs

---

## 📊 MÉTRICAS DEL PROYECTO

### Documentación
- **Total documentos:** 5
- **Líneas de documentación:** ~2000
- **Reglas documentadas:** 50+
- **Casos de prueba identificados:** 30+

### Complejidad
- **Jugadores:** 2-8
- **Casillas:** 143 (terreno) + 10 (porterías)
- **Fichas:** 10 (8 jugadores + 2 porteros) + 1 balón
- **Estados del juego:** 8
- **Reglas de movimiento:** 15+
- **Excepciones:** 5

---

## 🔗 ENLACES RÁPIDOS

### Documentos Principales
- [Reglas Completas](docs/REGLAS_COMPLETAS.md)
- [Referencia Rápida](docs/REFERENCIA_RAPIDA.md)
- [Especificación Técnica](docs/ESPECIFICACION_TECNICA.md)
- [Transcripción del Manual](docs/TRANSCRIPCION_COMPLETA_MANUAL.md)

### Recursos Externos
- [BoardGameGeek - MasterGoal](https://boardgamegeek.com/boardgame/21879/mastergoal)
- [Manual original (Scribd)](https://es.scribd.com/document/396563399/Reglas-Mastergoal)

---

## 📝 NOTAS IMPORTANTES

### Correcciones Realizadas
1. ❌ **Movimiento de jugador:** Era 5 casillas → **Correcto: 1-2 casillas**
2. ❌ **Salto sobre portero:** Era "nunca" → **Correcto: sí sobre propio portero**
3. ❌ **Obligatorio agotar 4 movimientos:** Era "sí" → **Correcto: no es obligatorio**
4. ❌ **Casillas neutras:** Parcial → **Correcto: completo con ejemplos**
5. ❌ **Pases:** Básico → **Correcto: 5 reglas completas**

### Información Validada
- ✅ Todas las reglas están extraídas del manual oficial
- ✅ Las posiciones iniciales están validadas con las imágenes
- ✅ Las dimensiones del tablero están confirmadas (15×11)
- ✅ El sistema de coordenadas está consensuado (fila-columna)

---

## ⚖️ LICENCIA Y LEGAL

**MasterGoal** es una marca registrada de **GOALMIND S.A. (1992)**.

**© GOALMIND S.A. 1992** - Todos los derechos reservados.

Este proyecto es **sin ánimo de lucro** con fines de:
- Preservación histórica
- Educación
- Uso personal entre amigos

---

*Documento de estado del proyecto MasterGoal - Digitalización y preservación*

**Última actualización:** Mayo 2026  
**Estado:** Documentación completa ✅ | Desarrollo: Pendiente ⏳
