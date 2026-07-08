export type MaterialMovementType = 'IN' | 'OUT' | 'ADJUSTMENT';
export type MaterialMovementReason = 'PURCHASE' | 'PRODUCTION_CONSUMPTION' | 'PRODUCTION_ACQUISITION' | 'ADJUSTMENT' | 'RETURN';

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