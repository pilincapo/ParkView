import { Timestamp } from 'firebase/firestore';

export enum VehicleStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
}

export interface Vehicle {
  id?: string;
  plate: string;
  slotId: string;
  entryTime: Timestamp;
  exitTime: Timestamp | null;
  status: VehicleStatus;
  totalAmount: number;
  ownerId: string;
}

export interface ParkingSettings {
  hourlyRate: number;
  totalSlots: number;
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
