# Pendientes y mejoras futuras — MasterGoal

## IA — Optimizaciones de rendimiento

### Sacar `iaLineasRivalesAbiertas` de `iaEvaluarEstado`
- **Qué**: `iaEvaluarEstado` se llama dentro del lookahead recursivo. Las líneas rivales se recalculan en cada nodo del árbol aunque el balón esté en posición simulada distinta.
- **Riesgo**: si se fija fuera del árbol se pierde precisión táctica (las líneas rivales dependen de dónde está el balón). Necesita diseño cuidadoso — quizá pasar la posición del balón como parámetro y cachear por (bf, bc).
- **Beneficio esperado**: medio. El coste es lineal, no exponencial como el árbol.

### Limitar casillas simuladas en `iaAmenazaPotencialEnDest`
- **Qué**: actualmente simula las 8 casillas colindantes al destino del jugador. Podría limitarse a las que están en campo rival (filas ≤ 7) ya que la amenaza ofensiva solo tiene sentido táctico real ahí.
- **Riesgo**: ninguno de músculo. Pequeño ahorro lineal.
- **Beneficio esperado**: bajo-medio.

---

## IA — Estrategias tácticas

### Triángulo / forma de equipo
- **Qué**: posicionar jugadores en formación triangular alrededor del balón para garantizar mayoría y múltiples ángulos de pase. Hoy la IA busca colindantes y líneas pero no anticipa la "forma" del equipo para el siguiente turno.
- **Cómo atacarlo**: añadir en `iaEvaluarEstado` un bonus por jugadores que forman triángulo (ninguno en la misma fila/columna que otro, todos a distancia 1-2 del balón).
- **Coste**: medio-alto.

### La "pared" (pase + reposicionamiento)
- **Qué**: secuencia jugador→balón→jugador en dos turnos. La IA no planifica entre turnos porque el worker solo recibe un turno cada vez y no tiene memoria entre ellos.
- **Cómo atacarlo**: pasar historial del último movimiento de jugador al worker, o hacer lookahead conjunto jugador+balón en un solo turno.
- **Coste**: alto. Requiere cambio arquitectural en cómo el worker recibe el estado.

---

## Reglas — Pendientes de validar/implementar

### Verificar regla de balón ahogado
- **Decisión tomada**: si un movimiento dejaría el balón sin salidas válidas, ese movimiento se invalida (no se permite). Las reglas oficiales dicen terminar el partido con el marcador actual, pero se descartó por favorecer juego antideportivo.
- **Estado**: implementado con nuestra variante. Documentado como decisión consciente.

---

## UX / Visual

### Identificación visual de jugadores en fichas
- Los documentos "Estudiosos" proponen símbolos en fichas (triángulo, círculo, cruz...) para diferenciar jugadores dentro del mismo equipo.
- Decidido no implementar por ahora: el usuario ya está acostumbrado al sistema actual (numeración local/visitante).
- Queda como mejora opcional si se añade modo de edición de equipos avanzado.

---

## Online (Firebase Realtime DB)

### Estado actual (implementado y validado)
- **Sync fiable**: cola de eventos append-only (push + child_added) con corte temporal al re-suscribirse. Sin desincronizaciones de tablero.
- **Reconexión/reanudación**: presencia (heartbeat + onDisconnect), snapshot autoritativo del estado en Firebase, overlay "rival desconectado". (Re)entrar reconstruye el estado real, no el saque inicial.
- **Reconexión del creador** con su propio código (rol persistido en localStorage).
- **Selección de equipos**: el creador elige su equipo (local) + encuentro; el que se une elige su equipo (visitante) tras conectar, sin poder repetir el del creador.
- **Robustez del lobby**: códigos únicos por transacción, limpieza de salas por TTL (2h), poda de la cola de eventos (>15s).

### Pendiente — Validación de movimientos del rival (anti-cheat) [D]
- **Qué**: hoy `aplicarMovimientoRemoto` aplica el movimiento del rival sin re-validar su legalidad. Un cliente modificado podría enviar movimientos ilegales.
- **Decisión**: dejado en backlog. Con Firebase como mero buzón (sin servidor autoritativo) el anti-cheat tiene techo: se puede validar/rechazar en cliente para frenar trampeo casual, pero no protege de un cliente malicioso determinado. No prioritario.
- **Si se retoma**: validar el destino recibido con las reglas (mismo motor que valida los movimientos propios) antes de aplicar; ignorar y avisar si es ilegal.

### Pendiente — Pulido UX (no prioritario)
- Indicador "turno del rival / esperando su jugada".
- Revancha online más visible, estados de conexión más claros, timeouts de sala en espera.

### Fase futura — Torneos y ligas multijugador online

**Punto de partida**: lo desarrollado hoy es un **1v1 entre dos dispositivos**. Torneo/liga online es un problema cualitativamente distinto, no una extensión. Hoy `torneoJugarPartido` / `ligaJugarPartido` solo conocen `'pvp'` (mismo dispositivo, "pasa el dispositivo") o `'vsIA'`; **no contemplan `'online'`**, y el flujo "pasa el dispositivo" asume a todos los jugadores físicamente presentes en la misma pantalla. La estructura del torneo/liga vive hoy en `localStorage` de un solo dispositivo.

**Qué reutiliza** (cimiento ya resuelto y probado): la capa de transporte 1v1 — cómo dos remotos sincronizan un tablero (cola de eventos, snapshot, presencia, reconexión, selección de equipos). Eso vale mucho y no hay que reinventarlo.

**Qué falta construir** (la capa de orquestación multijugador, comparable en esfuerzo a TODO el bloque online de hoy):
1. **Lobby persistente de N jugadores** (no 2): crear el torneo, que 4-8 personas se unan con un código, esperar a todos.
2. **Estructura del torneo/liga compartida en Firebase** (bracket/calendario en la nube, no en localStorage), sincronizada entre todos los participantes.
3. **Emparejamiento remoto**: para cada partido del bracket, juntar a los dos jugadores remotos concretos, gestionar que el resto espere, y qué pasa si uno no está conectado cuando le toca.
4. **Propagación de resultados**: el resultado de cada partido actualiza el bracket/tabla de todos, recalculando en la nube.
5. **Ciclo de vida largo**: una liga puede durar días → ¿partidas asíncronas?, ¿persistencia de pendientes? Multiplica la complejidad.

**Estimación**: la pieza difícil de bajo nivel (sincronizar un partido entre dos remotos) ya está. Falta toda la orquestación, que es un proyecto en sí mismo, no un retoque final.

**Vía intermedia (acorta distancia)**: modo híbrido — la estructura del torneo/liga la lleva un "anfitrión" en su dispositivo (como ahora, en local), pero los enfrentamientos individuales se juegan online con el 1v1 actual, reportando resultados manual o semi-automáticamente. No es multijugador puro, pero reutiliza el 1v1 sin construir toda la orquestación.
