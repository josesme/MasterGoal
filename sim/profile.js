// Perfilado de una sola decisión de pieza en imbatible.
// Monta un estado representativo de media partida y mide tiempos + contadores.
console.log = (() => { const o = console.log; return (...a) => { if (typeof a[0]==='string' && a[0].includes('PERF')) return; o(...a); }; })();
const ia = require('../ia-worker.js');

// Estado de media partida: balón en campo, piezas dispersas, sin posesión clara
const estado = {
  fichas: {
    'l-portero': { fila: 2,  col: 6, equipo: 'local' },
    'l-j1':      { fila: 5,  col: 5, equipo: 'local' },
    'l-j2':      { fila: 6,  col: 7, equipo: 'local' },
    'l-j3':      { fila: 8,  col: 4, equipo: 'local' },
    'l-j4':      { fila: 9,  col: 8, equipo: 'local' },
    'v-portero': { fila: 12, col: 6, equipo: 'visitante' },
    'v-j1':      { fila: 7,  col: 4, equipo: 'visitante' },
    'v-j2':      { fila: 7,  col: 8, equipo: 'visitante' },
    'v-j3':      { fila: 9,  col: 5, equipo: 'visitante' },
    'v-j4':      { fila: 10, col: 7, equipo: 'visitante' },
    'balon':     { fila: 8,  col: 6 },
  },
  turno: 'visitante',
  fase: 'MOVER_JUGADOR',
  movimientosBalon: 0,
  ultimoPasador: null,
  turnoExtra: false,
  marcador: { local: 0, visitante: 0 },
  nivelIA: 'imbatible',
  potencialRival: 3,
  estiloVisitante: 'equilibrado',
};

const N = parseInt(process.argv[2] || '5', 10);
let total = 0;
for (let i = 0; i < N; i++) {
  ia.setEstado(JSON.parse(JSON.stringify(estado)));
  const t0 = Date.now();
  ia.calcularDecisionJugador();
  const ms = Date.now() - t0;
  total += ms;
  console.log(`  decisión ${i + 1}: ${ms}ms`);
}
console.log(`\nMedia: ${(total / N).toFixed(0)}ms por decisión de pieza\n`);
