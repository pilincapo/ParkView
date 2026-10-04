/**
 * Tests unitarios de la lógica pura: fechas de abono y tarifas.
 *
 * No necesitan servidor ni base, importan los `.ts` de `shared/` directo
 * (Node 22 quita los tipos al vuelo). Es lo que cubre los bordes que el smoke
 * end-to-end no alcanza: el renewal a fin de mes solo se puede provocar
 * forzando la fecha en la base, que acá es un `new Date()`.
 *
 *   node scripts/test-units.mjs
 */

import { sumarMeses, estaVencida } from '../shared/dates.ts';
import { calcularImporte, DEFAULT_TARIFAS } from '../shared/pricing.ts';

let pass = 0;
let fail = 0;
const fallos = [];

function check(nombre, condicion, detalle = '') {
  if (condicion) {
    pass++;
    console.log(`  ok   ${nombre}`);
  } else {
    fail++;
    fallos.push(nombre);
    console.log(`  FAIL ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  }
}

const iso = (d) => d.toISOString();
const T = (s) => new Date(s);

/* -------------------------------------------------------------------------- */
/* sumarMeses: el clamp de fin de mes                                           */
/* -------------------------------------------------------------------------- */

console.log('\nshared/dates.ts — sumarMeses\n');

// Este es el bug: setMonth(1) sobre el 31/01 da 3/3 y se salta febrero.
check(
  '31/01 + 1 mes = 28/02 (no 03/03)',
  iso(sumarMeses(T('2026-01-31T12:00:00.000Z'), 1)) === '2026-02-28T12:00:00.000Z',
  iso(sumarMeses(T('2026-01-31T12:00:00.000Z'), 1))
);

check(
  '31/01 + 1 mes en año bisiesto = 29/02',
  iso(sumarMeses(T('2028-01-31T12:00:00.000Z'), 1)) === '2028-02-29T12:00:00.000Z',
  iso(sumarMeses(T('2028-01-31T12:00:00.000Z'), 1))
);

check(
  '30/11 + 1 mes = 30/12 (el día 30 existe ahí, no se clampea)',
  iso(sumarMeses(T('2026-11-30T00:00:00.000Z'), 1)) === '2026-12-30T00:00:00.000Z',
  iso(sumarMeses(T('2026-11-30T00:00:00.000Z'), 1))
);

check(
  '31/01 + 1 mes = 28/02 es exactamente un mes de cobertura',
  (() => {
    const fin = sumarMeses(T('2026-01-31T12:00:00.000Z'), 1);
    return fin.getTime() - T('2026-01-31T12:00:00.000Z').getTime() >= 27 * 864e5;
  })(),
  iso(sumarMeses(T('2026-01-31T12:00:00.000Z'), 1))
);

check(
  '31/12 + 2 meses = 28/02',
  iso(sumarMeses(T('2026-12-31T00:00:00.000Z'), 2)) === '2027-02-28T00:00:00.000Z',
  iso(sumarMeses(T('2026-12-31T00:00:00.000Z'), 2))
);

check(
  '31/01 + 24 meses = 31/01 de dos años después',
  iso(sumarMeses(T('2026-01-31T12:00:00.000Z'), 24)) === '2028-01-31T12:00:00.000Z',
  iso(sumarMeses(T('2026-01-31T12:00:00.000Z'), 24))
);

// Renovar dos veces desde el 31 no debe perder meses: el segundo renewal
// arranca desde el 28/02 que dejó el primero.
const r1 = sumarMeses(T('2026-01-31T12:00:00.000Z'), 1);
const r2 = sumarMeses(r1, 1);
check('renovar dos veces desde el 31 llega a marzo, no a mayo', iso(r2) === '2026-03-28T12:00:00.000Z', iso(r2));

check(
  'un mes con día existente se mantiene exacto',
  iso(sumarMeses(T('2026-03-15T08:30:00.000Z'), 1)) === '2026-04-15T08:30:00.000Z',
  iso(sumarMeses(T('2026-03-15T08:30:00.000Z'), 1))
);

check(
  'conserva la hora, no la midnight',
  sumarMeses(T('2026-01-31T23:45:00.000Z'), 1).getUTCHours() === 23
);

check('no muta la fecha base', iso(T('2026-01-31T12:00:00.000Z')) === '2026-01-31T12:00:00.000Z');

check('0 meses devuelve la misma fecha', iso(sumarMeses(T('2026-01-31T12:00:00.000Z'), 0)) === '2026-01-31T12:00:00.000Z');

check(
  'es independiente de la zona horaria del proceso',
  (() => {
    const antes = process.env.TZ;
    process.env.TZ = 'America/Sao_Paulo';
    const resultado = iso(sumarMeses(T('2026-01-31T12:00:00.000Z'), 1));
    process.env.TZ = antes;
    return resultado === '2026-02-28T12:00:00.000Z';
  })()
);

/* -------------------------------------------------------------------------- */
/* estaVencida                                                                 */
/* -------------------------------------------------------------------------- */

console.log('\nshared/dates.ts — estaVencida\n');

const ahora = T('2026-06-15T12:00:00.000Z');
check('una fecha pasada está vencida', estaVencida('2026-06-15T11:59:59.000Z', ahora));
check('una fecha futura no está vencida', !estaVencida('2026-06-15T12:00:00.001Z', ahora));
check('acepta Date además de ISO', estaVencida(T('2020-01-01T00:00:00.000Z'), ahora));

/* -------------------------------------------------------------------------- */
/* calcularImporte: los bordes que el smoke no puede forzar                    */
/* -------------------------------------------------------------------------- */

console.log('\nshared/pricing.ts — calcularImporte\n');

const entrada = '2026-06-15T12:00:00.000Z';
const minutos = (n) => T(new Date(T(entrada).getTime() + n * 60_000).toISOString());
const importe = (m, extra = {}) =>
  calcularImporte({
    entryTime: entrada,
    entryType: 'daily',
    vehicleType: 'car',
    settings: DEFAULT_TARIFAS,
    now: minutos(m),
    ...extra,
  });

check('1 minuto cobra la hora completa', importe(1) === 1000, String(importe(1)));
check('60 minutos exactos cobra una hora', importe(60) === 1000, String(importe(60)));
check('90 minutos cobra hora y media', importe(90) === 1600, String(importe(90)));
check('91 minutos ya cobra hora completa', importe(91) === 2000, String(importe(91)));
check('5 horas = 5 horas completas', importe(300) === 5000, String(importe(300)));

check(
  'un abono no cobra nada',
  calcularImporte({ entryTime: entrada, entryType: 'monthly', vehicleType: 'car', settings: DEFAULT_TARIFAS, now: minutos(600) }) === 0
);

check(
  'la moto cobra el diario fijo aunque se pase el día',
  calcularImporte({ entryTime: entrada, entryType: 'daily', vehicleType: 'motorcycle', settings: DEFAULT_TARIFAS, now: minutos(60 * 30) }) === 500
);

check(
  'un reloj corrido hacia adelante no genera importe negativo',
  calcularImporte({ entryTime: entrada, entryType: 'daily', vehicleType: 'car', settings: DEFAULT_TARIFAS, now: T('2026-06-15T11:00:00.000Z') }) === 1000
);

check('sin tarifas devuelve 0', calcularImporte({ entryTime: entrada, entryType: 'daily', vehicleType: 'car', settings: null, now: minutos(60) }) === 0);

/* -------------------------------------------------------------------------- */

console.log(`\nPASS=${pass} FAIL=${fail}`);
if (fail > 0) console.log(`fallos: ${fallos.join(' | ')}`);
process.exit(fail > 0 ? 1 : 0);