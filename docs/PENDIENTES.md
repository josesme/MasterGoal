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
