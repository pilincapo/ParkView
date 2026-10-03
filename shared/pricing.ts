/**
 * Cálculo de tarifa — fuente única de verdad para cliente y servidor.
 *
 * El Worker lo usa como valor por defecto al confirmar una salida; el cliente
 * lo usa para pintar el importe en vivo. Si divergen, el operador ve un número
 * y se cobra otro, así que vive en un solo archivo importado por ambos.
 */

export type VehicleType = 'car' | 'motorcycle';
export type EntryType = 'daily' | 'monthly';

export interface TarifaSettings {
  hourlyRate: number; // tarifa por hora completa (auto)
  carHalfHourRate: number;
  motoDailyRate: number;
  motoHourlyRate: number; // legacy, se conserva por compatibilidad
  monthlyRate: number;
  motoMonthlyRate: number;
  carSlots: number;
  motoSlots: number;
  totalSlots: number;
}

export const DEFAULT_TARIFAS: TarifaSettings = {
  hourlyRate: 1000,
  carHalfHourRate: 600,
  motoDailyRate: 500,
  motoHourlyRate: 500,
  monthlyRate: 25000,
  motoMonthlyRate: 12000,
  carSlots: 40,
  motoSlots: 20,
  totalSlots: 60,
};

const MS_POR_MINUTO = 1000 * 60;

/**
 * Importe a cobrar por una estadía.
 *
 * - Abonos (`entryType === 'monthly'`) no pagan: 0.
 * - Moto: ticket diario fijo, sin importar la duración (regla de negocio actual).
 * - Auto: primera hora siempre completa; después, horas fraccionadas.
 *   El excedente se redondea a media hora y, pasados 30 min, a hora completa.
 */
export function calcularImporte(params: {
  entryTime: Date | number | string;
  entryType: EntryType;
  vehicleType: VehicleType;
  settings: TarifaSettings | null | undefined;
  now?: Date | number | string;
}): number {
  const { entryType, vehicleType, settings } = params;
  if (!settings) return 0;
  if (entryType === 'monthly') return 0;

  const entry = toMs(params.entryTime);
  const now = params.now !== undefined ? toMs(params.now) : Date.now();
  if (Number.isNaN(entry)) return 0;

  // Mínimo facturable: 1 minuto.
  const diffMinutes = Math.max(1, Math.ceil((now - entry) / MS_POR_MINUTO));

  if (vehicleType === 'motorcycle') {
    return settings.motoDailyRate || 500;
  }

  const hourlyRate = settings.hourlyRate || 1000;
  const halfHourRate = settings.carHalfHourRate || Math.ceil(hourlyRate / 2);

  // Primera hora siempre completa.
  if (diffMinutes <= 60) return hourlyRate;

  let total = hourlyRate;
  const extraMinutes = diffMinutes - 60;
  const extraFullHours = Math.floor(extraMinutes / 60);
  const remainingExtraMinutes = extraMinutes % 60;

  total += extraFullHours * hourlyRate;

  if (remainingExtraMinutes > 30) {
    total += hourlyRate;
  } else if (remainingExtraMinutes > 0) {
    total += halfHourRate;
  }

  return total;
}

function toMs(value: Date | number | string): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? NaN : parsed;
}
