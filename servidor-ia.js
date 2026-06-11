// Servidor IA de MasterGoal — Node.js
// Arranca con: node servidor-ia.js
// Usa exactamente el mismo código que ia-worker.js, sin Worker API.

const http = require('http');
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const PORT = 3001;

// ── Cargar ia-worker.js como módulo Node ────────────────────────
const workerPath = path.join(__dirname, 'ia-worker.js');
let workerCode = fs.readFileSync(workerPath, 'utf8');

// Quitar el bloque self.onmessage (todo lo que viene después)
workerCode = workerCode.replace(/\bself\.onmessage\s*=[\s\S]*$/, '');
// Eliminar cualquier referencia residual a 'self'
workerCode = workerCode.replace(/\bself\b/g, 'globalThis');

// Añadir función helper para asignar estado desde fuera del contexto VM
workerCode += '\nfunction __setEstado(e) { estado = e; }';

// Ejecutar en un contexto Node compartido
const ctx = vm.createContext({ ...global, console });
vm.runInContext(workerCode, ctx);

// ── Servidor HTTP ────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method !== 'POST' || req.url !== '/decision') {
    res.writeHead(req.url === '/' ? 200 : 404);
    res.end(req.url === '/' ? 'MasterGoal IA server OK' : '');
    return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const { tipo, estadoJuego, movRestantes } = JSON.parse(body);

      // Inyectar estado dentro del scope del motor vía la función helper
      ctx.__setEstado(estadoJuego);
      ctx._cntEvaluar = 0; ctx._cntLineas = 0;
      ctx._cntBestBall = 0; ctx._cntBestBallLocal = 0; ctx._cntAmenaza = 0;

      const t0 = Date.now();
      let decision = null;

      if (tipo === 'MOVER_JUGADOR') {
        decision = ctx.calcularDecisionJugador();
      } else if (tipo === 'MOVER_BALON') {
        decision = ctx.calcularDecisionBalon(movRestantes);
      }

      const ms = Date.now() - t0;
      console.log(`[${tipo}] ${ms}ms | evaluar:${ctx._cntEvaluar} lineas:${ctx._cntLineas} bestBall:${ctx._cntBestBall}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ decision }));
    } catch (err) {
      console.error('Error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ decision: null, error: err.message }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n🤖 Servidor IA MasterGoal — http://localhost:${PORT}`);
  console.log(`   Motor: ${workerPath}`);
  console.log(`   Ctrl+C para detener.\n`);
});
