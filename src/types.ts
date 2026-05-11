import { Timestamp } from 'firebase/firestore';

export enum VehicleStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
}

export interface Vehicle {
  id?: string;
  plate: string;
  slotId: string;
  vehicleType: 'car' | 'motorcycle';
  entryType: 'daily' | 'monthly';
  entryTime: Timestamp;
  exitTime: Timestamp | null;
  status: VehicleStatus;
  totalAmount: number;
  ownerId: string;
  establishmentId: string;
}

export interface MonthlyPass {
  id?: string;
  plate: string;
  vehicleType: 'car' | 'motorcycle';
  startDate: Timestamp;
  endDate: Timestamp;
  ownerId: string;
  amount: number;
  status: 'active' | 'expired';
  establishmentId: string;
}

export interface Establishment {
  id?: string;
  name: string;
  address: string;
  ownerId: string;
  members: string[];
  settings: ParkingSettings;
}

export interface ParkingSettings {
  hourlyRate: number; // legacy default
  motoHourlyRate: number;
  monthlyRate: number;
  motoMonthlyRate: number;
  carSlots: number;
  motoSlots: number;
  totalSlots: number; // legacy total
  updatedBy: string;
  updatedAt: Timestamp;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  };
}
