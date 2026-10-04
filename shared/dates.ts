/**
 * Aritmética de fechas de negocio.
 *
 * Vive en `shared/` porque es lógica pura y testeable sin levantar el Worker
 * (scripts/test-units.mjs la importa directo). Hoy solo la usa el servidor
 * (vigencia de abonos), pero no depende de nada de D1 ni del runtime.
 *
 * ## Por qué el clamp
 *
 * `Date.setMonth()` desborda cuando el día no existe en el mes destino. Sumar
 * un mes al 31/01 no da "fin de febrero", da 3/3: `setMonth` internally pasa a
 * marzo y ese día 31 ya pasó. Con eso, un abono que vence el 31 de enero y se
 * renueva por un mes duraba **un día** y el cliente había pagado un mes.
 *
 * Regla que se aplica: el resultado es el último día del mes destino si el día
 * de origen no existe ahí.
 *   31/01 + 1 mes  -> 28/02   (29/02 en año bisiesto)
 *   30/11 + 1 mes  -> 31/12
 *   31/12 + 2 meses -> 28/02
 */

/** Suma meses a una fecha, clampeando el día al final del mes destino. */
export function sumarMeses(base: Date, meses: number): Date {
  const dia = base.getUTCDate();

  // Se ancla al día 1 antes de mover el mes: es lo que evita el desborde de
  // setUTCMonth. Los getters/setters son UTC a propósito, porque las fechas se
  // guardan como ISO 8601 en UTC y usar la zona horaria local haría que el
  // "día" dependiera del runtime (y saltara con el horario de verano).
  const resultado = new Date(base.getTime());
  resultado.setUTCDate(1);
  resultado.setUTCMonth(resultado.getUTCMonth() + meses);

  // Día 0 del mes siguiente = último día del mes en el que estamos.
  const ultimoDia = new Date(
    Date.UTC(resultado.getUTCFullYear(), resultado.getUTCMonth() + 1, 0)
  ).getUTCDate();

  resultado.setUTCDate(Math.min(dia, ultimoDia));
  return resultado;
}

/** ¿La fecha ya venció? Comparación por instante, no por string. */
export function estaVencida(fin: string | Date, ahora: Date = new Date()): boolean {
  return new Date(fin).getTime() <= ahora.getTime();
}