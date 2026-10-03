/**
 * Tipos de dominio de CocheraFlow.
 *
 * Sin dependencia de Firebase: `Timestamp` se reemplaza por `Date` de JS,
 * que es lo que devuelve el cliente de API tras parsear el ISO 8601 del Worker.
 */

export enum VehicleStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
}

export type EstablishmentRole = 'owner' | 'manager' | 'operator';

export interface Vehicle {
  id?: string;
  plate: string;
  slotId: string;
  vehicleType: 'car' | 'motorcycle';
  entryType: 'daily' | 'monthly';
  entryTime: Date;
  exitTime: Date | null;
  status: VehicleStatus;
  totalAmount: number;
  ownerId: string;
  establishmentId: string;
}

export interface MonthlyPass {
  id?: string;
  plate: string;
  vehicleType: 'car' | 'motorcycle';
  startDate: Date;
  endDate: Date;
  ownerId: string;
  amount: number;
  status: 'active' | 'expired';
  establishmentId: string;
}

export interface MemberInfo {
  userId: string;
  role: EstablishmentRole;
  email: string;
  displayName: string | null;
}

export interface Establishment {
  id?: string;
  name: string;
  address: string;
  ownerId: string;
  /** UIDs de miembros. Vacío en la API por defecto; ver `members` cargados. */
  members: string[];
  settings: ParkingSettings;
  /** Rol del usuario actual en esta cochera. */
  role?: EstablishmentRole;
}

export interface ParkingSettings {
  hourlyRate: number; // legacy default (carHourlyRate)
  carHalfHourRate: number;
  motoDailyRate: number;
  motoHourlyRate: number; // legacy
  monthlyRate: number;
  motoMonthlyRate: number;
  carSlots: number;
  motoSlots: number;
  totalSlots: number; // legacy total
  updatedBy?: string;
  updatedAt?: Date | string;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface DataErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
}
