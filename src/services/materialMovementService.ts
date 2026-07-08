import { supabase } from '@/integrations/supabase/client'
import { Transaction } from '@/types/transaction'
import { Material } from '@/types/material'
import { MaterialMovement, CreateMaterialMovementData } from '@/types/materialMovement'

// ============================================================================
// MATERIAL MOVEMENT SERVICE
// ============================================================================
// This service is for REPORTING/AUDIT only.
// Actual stock updates should go through MaterialStockService using FIFO RPC.
// materials.stock is DEPRECATED - use v_material_current_stock VIEW instead.
// ============================================================================

export class MaterialMovementService {

  /**
   * @deprecated Use MaterialStockService.processProductionStockChanges instead
   * This function creates movements AND updates stock - causing double writes.
   *
   * Generate material movements from a completed transaction
   * This should be called when transaction status changes to 'Proses Produksi' or 'Pesanan Selesai'
   */
  static async generateMovementsFromTransaction(
    transaction: Transaction,
    materials: Material[]
  ): Promise<void> {
    console.warn('⚠️ generateMovementsFromTransaction is DEPRECATED - use MaterialStockService.processProductionStockChanges');

    const movements: CreateMaterialMovementData[] = [];

    // Process each item in the transaction
    for (const item of transaction.items) {
      if (!item.product.materials || item.product.materials.length === 0) {
        continue; // Skip products without BOM
      }

      // Calculate material consumption for each material in the BOM
      for (const productMaterial of item.product.materials) {
        const material = materials.find(m => m.id === productMaterial.materialId);
        if (!material) continue;

        const totalMaterialUsed = productMaterial.quantity * item.quantity;

        const movement: CreateMaterialMovementData = {
          materialId: productMaterial.materialId,
          materialName: material.name,
          type: 'OUT',
          reason: 'PRODUCTION_CONSUMPTION',
          quantity: totalMaterialUsed,
          previousStock: 0, // Not tracking absolute stock anymore
          newStock: 0, // Stock derived from batches
          referenceId: transaction.id,
          referenceType: 'transaction',
          notes: `Digunakan untuk produksi ${item.product.name} (${item.quantity} unit) - Order: ${transaction.id}`,
          userId: transaction.cashierId,
          userName: transaction.cashierName,
        };

        movements.push(movement);
      }
    }

    // Save movements for audit trail only
    // DO NOT update material stock - that's handled by MaterialStockService FIFO
    if (movements.length > 0) {
      await this.createMaterialMovements(movements);
      // REMOVED: await this.updateMaterialStocks(movements);
      // Stock updates now handled via FIFO RPC in MaterialStockService
    }
  }

  /**
   * Create material movement records in database
   */
  private static async createMaterialMovements(movements: CreateMaterialMovementData[]): Promise<void> {
    const dbMovements = movements.map(movement => ({
      material_id: movement.materialId,
      material_name: movement.materialName,
      type: movement.type,
      reason: movement.reason,
      quantity: movement.quantity,
      previous_stock: movement.previousStock,
      new_stock: movement.newStock,
      reference_id: movement.referenceId,
      reference_type: movement.referenceType,
      notes: movement.notes,
      user_id: movement.userId,
      user_name: movement.userName,
    }));

    const { error } = await supabase
      .from('material_stock_movements')
      .insert(dbMovements);

    if (error) {
      console.error('Failed to create material movements:', error);
      throw new Error(`Failed to create material movements: ${error.message}`);
    }
  }

  /**
   * @deprecated DO NOT USE - materials.stock is deprecated
   * Stock is derived from inventory_batches via v_material_current_stock
   * Use MaterialStockService with FIFO RPC instead
   */
  private static async _updateMaterialStocks_DEPRECATED(_movements: CreateMaterialMovementData[]): Promise<void> {
    console.warn('⚠️ updateMaterialStocks is DEPRECATED - stock managed via inventory_batches FIFO');
    // No-op: we no longer update materials.stock directly
  }

  /**
   * Get material movements with transaction data for reporting
   */
  static async getMaterialMovementsWithTransactions(
    dateFrom?: Date,
    dateTo?: Date
  ): Promise<any[]> {
    // Note: PostgREST doesn't support !inner, using regular nested select
    let query = supabase
      .from('material_stock_movements')
      .select(`
        *,
        materials(name, type, unit, price_per_unit)
      `)
      .order('created_at', { ascending: false });

    if (dateFrom) {
      query = query.gte('created_at', dateFrom.toISOString());
    }
    if (dateTo) {
      query = query.lte('created_at', dateTo.toISOString());
    }

    const { data: rawMovements, error } = await query;

    // Filter out movements without materials (simulating !inner behavior)
    const movements = (rawMovements || []).filter((m: any) => m.materials !== null);
    
    if (error) {
      console.error('Error fetching material movements:', error);
      return [];
    }

    // Enrich with transaction data
    const enrichedMovements = await Promise.all(
      (movements || []).map(async (movement) => {
        let transactionData = null;
        
        if (movement.reference_type === 'transaction' && movement.reference_id) {
          // Use .order('id').limit(1) instead of .single() because our client forces Accept: application/json
          const { data: transactionRaw } = await supabase
            .from('transactions')
            .select('id, customer_name, order_date, status')
            .eq('id', movement.reference_id)
            .order('id').limit(1);

          transactionData = Array.isArray(transactionRaw) ? transactionRaw[0] : transactionRaw;
        }

        return {
          ...movement,
          transactionData,
          materialName: movement.material_name,
        };
      })
    );

    return enrichedMovements;
  }
}