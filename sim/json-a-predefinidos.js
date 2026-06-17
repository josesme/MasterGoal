#!/usr/bin/env node
/**
 * json-a-predefinidos.js
 * ----------------------------------------------------------------------------
 * Convierte un export de equipos (mastergoal-equipos.json) en el bloque de
 * código `EQUIPOS_PREDEFINIDOS` listo para pegar en index.html, y valida que
 * los datos son correctos. Evita el ciclo prueba/error manual.
 *
 * Uso:
 *   node sim/json-a-predefinidos.js <ruta-al-export.json> [--write]
 *
 *   (sin --write)  imprime el bloque por pantalla y el informe de validación.
 *   (con  --write) reemplaza el array EQUIPOS_PREDEFINIDOS dentro de index.html.
 *
 * Qué hace por ti:
 *   - Repara el mojibake de acentos por si el JSON viene mal codificado
 *     (Ã¡->á, Ã©->é, etc.), interpretando los bytes como Latin-1 leídos de UTF-8.
 *   - Valida: ids únicos, patrones/estilos válidos, campos obligatorios.
 *   - Genera el bloque con el formato exacto del array actual.
 * ----------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

const PATRONES = ['solido','v2','banda_v','mangas','v4','v8','sash','pinwheel','diag2','diag1','banda_h','h2','h8','cuadros','h4','hombros'];
const ESTILOS  = ['equilibrado','defensivo','presion','contraataque'];

// Repara mojibake típico de UTF-8 leído como Latin-1 (Ã¡ -> á, etc.).
function repararAcentos(s) {
  if (typeof s !== 'string') return s;
  // Solo intervenir si hay señales de mojibake (carácter Ã / Â).
  if (!/[ÃÂ]/.test(s)) return s;
  try {
    // Reinterpretar: bytes que el JSON guarda como Latin-1 vuelven a UTF-8.
    return Buffer.from(s, 'latin1').toString('utf8');
  } catch { return s; }
}

function validar(equipos) {
  const errores = [];
  const ids = new Set();
  equipos.forEach((e, i) => {
    const ref = `#${i} (${e.id || 'sin id'})`;
    if (!e.id) errores.push(`${ref}: falta id`);
    if (!e.nombre) errores.push(`${ref}: falta nombre`);
    if (ids.has(e.id)) errores.push(`${ref}: id duplicado`);
    ids.add(e.id);
    if (!PATRONES.includes(e.patron)) errores.push(`${ref}: patrón inválido '${e.patron}'`);
    if (!ESTILOS.includes(e.estilo)) errores.push(`${ref}: estilo inválido '${e.estilo}'`);
    if (!(e.potencial >= 1 && e.potencial <= 5)) errores.push(`${ref}: potencial fuera de 1..5`);
    if (e.kit2 && !PATRONES.includes(e.kit2.patron)) errores.push(`${ref}: kit2.patron inválido '${e.kit2.patron}'`);
    // colorPortero es opcional (fallback amarillo), pero avisamos si falta.
    if (!e.colorPortero) errores.push(`${ref}: AVISO sin colorPortero (usará amarillo por defecto)`);
  });
  return errores;
}

function generarBloque(equipos) {
  const q = s => JSON.stringify(s); // comillas dobles, escapa lo necesario
  const lines = equipos.map(e => {
    const k = e.kit2 || { colorPrincipal:'#ffffff', colorSecundario:'#ffffff', colorPantalon:'#212121', patron:'solido' };
    const cp = e.colorPortero ? `, colorPortero: '${e.colorPortero}'` : '';
    return `      { id: '${e.id}', nombre: ${q(e.nombre)}, colorPrincipal: '${e.colorPrincipal}', colorSecundario: '${e.colorSecundario}', colorPantalon: '${e.colorPantalon}', patron: '${e.patron}', estilo: '${e.estilo}', potencial: ${e.potencial}${cp}, kit2: { colorPrincipal: '${k.colorPrincipal}', colorSecundario: '${k.colorSecundario}', colorPantalon: '${k.colorPantalon}', patron: '${k.patron}' }, pj:0,pg:0,pp:0,gf:0,gc:0 },`;
  });
  return '    const EQUIPOS_PREDEFINIDOS = [\n' + lines.join('\n') + '\n    ];';
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const jsonPath = args.find(a => !a.startsWith('--'));
  if (!jsonPath) {
    console.error('Uso: node sim/json-a-predefinidos.js <export.json> [--write]');
    process.exit(1);
  }

  let raw = fs.readFileSync(jsonPath, 'utf8').replace(/^﻿/, ''); // quitar BOM
  let equipos = JSON.parse(raw);
  if (!Array.isArray(equipos)) { console.error('El JSON no es un array de equipos.'); process.exit(1); }

  // Reparar acentos en nombres.
  equipos = equipos.map(e => ({ ...e, nombre: repararAcentos(e.nombre) }));

  const errores = validar(equipos);
  const avisos = errores.filter(x => x.includes('AVISO'));
  const fatales = errores.filter(x => !x.includes('AVISO'));

  console.error(`\n== Validación: ${equipos.length} equipos ==`);
  if (fatales.length) { console.error('ERRORES:'); fatales.forEach(e => console.error('  - ' + e)); }
  if (avisos.length)  { console.error('Avisos:');  avisos.forEach(e => console.error('  - ' + e)); }
  if (!errores.length) console.error('  Todo correcto.');
  if (fatales.length) { console.error('\nAbortado por errores.'); process.exit(2); }

  const bloque = generarBloque(equipos);

  if (!write) {
    console.error('\n== Bloque (no escrito; usa --write para aplicar a index.html) ==\n');
    console.log(bloque);
    return;
  }

  const idxPath = path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(idxPath, 'utf8');
  const pat = /    const EQUIPOS_PREDEFINIDOS = \[[\s\S]*?\n    \];/;
  const n = (html.match(pat) || []).length;
  if (n !== 1) { console.error(`Esperaba 1 array EQUIPOS_PREDEFINIDOS, encontré ${n}. Abortado.`); process.exit(3); }
  const html2 = html.replace(pat, bloque.replace(/\$/g, '$$$$'));
  fs.writeFileSync(idxPath, html2, 'utf8');
  console.error(`\nindex.html actualizado con ${equipos.length} equipos.`);
}

main();
