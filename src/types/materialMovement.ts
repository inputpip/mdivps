export type MaterialMovementType = 'IN' | 'OUT' | 'ADJUSTMENT';
export type MaterialMovementReason = 'PURCHASE' | 'PRODUCTION_CONSUMPTION' | 'PRODUCTION_ACQUISITION' | 'ADJUSTMENT' | 'RETURN' | 'PRODUCTION_ERROR' | 'PRODUCTION_DELETE_RESTORE';

export interface MaterialMovement {
  id: string;
  materialId: string;
  materialName: string;
  type: MaterialMovementType;
  reason: MaterialMovementReason;
  quantity: number;
  previousStock: number;
  newStock: number;
  referenceId?: string;
  referenceType?: string;
  notes?: string;
  userId: string;
  userName: string;
  createdAt: string;
  branchId?: string | null;
  isVoided?: boolean;
  voidedAt?: string | null;
  voidedBy?: string | null;
  voidedByName?: string | null;
  voidReason?: string | null;
}

export interface CreateMaterialMovementData {
  materialId: string;
  materialName: string;
  type: MaterialMovementType;
  reason: MaterialMovementReason;
  quantity: number;
  previousStock: number;
  newStock: number;
  referenceId?: string;
  referenceType?: string;
  notes?: string;
  userId: string;
  userName: string;
  branchId?: string | null;
}