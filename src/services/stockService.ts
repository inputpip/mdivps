import { supabase } from '@/integrations/supabase/client'
import { Product } from '@/types/product'
import { StockMovementType, StockMovementReason, CreateStockMovementData } from '@/types/stockMovement'
import { TransactionItem } from '@/types/transaction'

// ============================================================================
// FIFO BATCH MANAGEMENT FUNCTIONS (Now Fully RPC)
// ============================================================================

/**
 * Result type from FIFO RPC functions
 */
interface FIFOConsumeResult {
  success: boolean;
  total_hpp: number;
  batches_consumed: any[];
  error_message: string | null;
}

interface FIFORestoreResult {
  success: boolean;
  batch_id: string | null;
  error_message: string | null;
}

/**
 * Consume stock using FIFO method via database RPC
 * Maps to: consume_inventory_fifo(p_product_id, p_branch_id, p_quantity, p_reference_id)
 */
export async function consumeStockFIFO(
  productId: string,
  quantity: number,
  referenceId: string,
  referenceType: string,
  branchId?: string | null,
  reason: string = 'usage',
  notes?: string,
  userId?: string,
  userName?: string
): Promise<FIFOConsumeResult> {
  if (quantity <= 0 || !productId) {
    return {
      success: true,
      total_hpp: 0,
      batches_consumed: [],
      error_message: null
    };
  }

  if (!branchId) {
    console.error('[consumeStockFIFO] Branch ID is REQUIRED');
    return {
      success: false,
      total_hpp: 0,
      batches_consumed: [],
      error_message: 'Branch ID is required for stock operations'
    };
  }

  try {
    const { data: rpcResultRaw, error } = await supabase.rpc('consume_inventory_fifo', {
      p_product_id: productId,
      p_branch_id: branchId,
      p_quantity: quantity,
      p_reference_id: `${referenceType}:${referenceId}`,
      p_reason: reason,
      p_notes: notes || null,
      p_user_id: userId || null,
      p_user_name: userName || null
    });

    if (error) {
      console.error('[consumeStockFIFO] RPC error:', error);
      return {
        success: false,
        total_hpp: 0,
        batches_consumed: [],
        error_message: error.message
      };
    }

    const result = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;

    // Log details if successful
    if (result?.success) {
      console.log(`📦 FIFO Consume (RPC): Product ${productId.substring(0, 8)}, Qty: ${quantity}, HPP: ${result.total_hpp}`);
    } else {
      console.warn(`⚠️ FIFO Consume (RPC) Failed: ${result?.error_message}`);
    }

    return {
      success: result?.success ?? false,
      total_hpp: result?.total_hpp ?? 0,
      batches_consumed: result?.batches_consumed ?? [],
      error_message: result?.error_message ?? null
    };
  } catch (err: any) {
    console.error('[consumeStockFIFO] Exception:', err);
    return {
      success: false,
      total_hpp: 0,
      batches_consumed: [],
      error_message: err.message
    };
  }
}

/**
 * Restore stock using FIFO method via database RPC
 * Maps to: restore_inventory_fifo(p_product_id, p_branch_id, p_quantity, p_unit_cost, p_reference_id)
 */
export async function restoreStockFIFO(
  productId: string,
  quantity: number,
  referenceId: string,
  referenceType: string,
  branchId?: string | null,
  unitCost: number = 0,
  reason: string = 'restock',
  notes?: string,
  userId?: string,
  userName?: string
): Promise<FIFORestoreResult> {
  if (quantity <= 0 || !productId) {
    return {
      success: true,
      batch_id: null,
      error_message: null
    };
  }

  if (!branchId) {
    console.error('[restoreStockFIFO] Branch ID is REQUIRED');
    return {
      success: false,
      batch_id: null,
      error_message: 'Branch ID is required for stock operations'
    };
  }

  try {
    const { data: rpcResultRaw, error } = await supabase.rpc('restore_inventory_fifo', {
      p_product_id: productId,
      p_branch_id: branchId,
      p_quantity: quantity,
      p_reference_id: `${referenceType}:${referenceId}`,
      p_unit_cost: unitCost,
      p_reason: reason,
      p_notes: notes || null,
      p_user_id: userId || null,
      p_user_name: userName || null
    });

    if (error) {
      console.error('[restoreStockFIFO] RPC error:', error);
      return {
        success: false,
        batch_id: null,
        error_message: error.message
      };
    }

    const result = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;

    if (result?.success) {
      console.log(`📦 FIFO Restore (RPC): Product ${productId.substring(0, 8)}, Qty: ${quantity}, Batch: ${result.batch_id}`);
    } else {
      console.warn(`⚠️ FIFO Restore (RPC) Failed: ${result?.error_message}`);
    }

    return {
      success: result?.success ?? false,
      batch_id: result?.batch_id ?? null,
      error_message: result?.error_message ?? null
    };
  } catch (err: any) {
    console.error('[restoreStockFIFO] Exception:', err);
    return {
      success: false,
      batch_id: null,
      error_message: err.message
    };
  }
}

// ============================================================================

export class StockService {

  /**
   * Process stock movements when a transaction is created or when items are delivered
   */
  static async processTransactionStock(
    referenceId: string,
    items: TransactionItem[],
    userId: string,
    userName: string,
    referenceType: 'transaction' | 'delivery' = 'transaction'
  ): Promise<void> {
    const movements: CreateStockMovementData[] = [];

    for (const item of items) {
      const product = item.product;
      // Note: product.currentStock is DEPRECATED and unreliable from frontend 
      // We rely on RPC results for actual stock state

      let movementType: StockMovementType;
      let reason: StockMovementReason = 'PRODUCTION_CONSUMPTION';

      if (item.quantity < 0) {
        movementType = 'IN';
        reason = 'ADJUSTMENT'; // Restoring stock
      } else {
        movementType = 'OUT';
        reason = 'PRODUCTION_CONSUMPTION'; // Consuming stock
      }

      // Create stock movement record (audit trail)
      // Note: Actual stock update happens below via RPC
      const movement: CreateStockMovementData = {
        productId: product.id,
        productName: product.name,
        type: movementType,
        reason,
        quantity: Math.abs(item.quantity),
        previousStock: 0, // Placeholder, as we don't know real stock here
        newStock: 0, // Placeholder
        notes: referenceType === 'delivery'
          ? `Pengantaran: ${referenceId} - ${item.notes || ''}`
          : `Transaksi: ${referenceId} - ${item.notes || ''}`,
        referenceId: referenceId,
        referenceType: referenceType,
        userId,
        userName,
      };

      movements.push(movement);

      // STOCK UPDATE LOGIC
      const isOfficeSale = (item as any).isOfficeSale === true;
      const shouldUpdateStock = referenceType === 'delivery' ||
        (referenceType === 'transaction' && isOfficeSale);
      const branchId = (item as any).branchId || null;

      if (shouldUpdateStock) {
        console.log(`📦 Processing stock via RPC: ${product.name} (${movementType} ${Math.abs(item.quantity)})`);

        if (item.quantity > 0) {
          // Consume stock (OUT)
          const result = await consumeStockFIFO(
            product.id,
            item.quantity,
            referenceId,
            referenceType,
            branchId
          );

          if (!result.success) {
            console.error(`❌ [processTransactionStock] Deduct failed for ${product.name}: ${result.error_message}`);
            // No rollback strategy here yet - relying on caller to handle failure
          }
        } else if (item.quantity < 0) {
          // Restore stock (IN)
          const result = await restoreStockFIFO(
            product.id,
            Math.abs(item.quantity),
            referenceId,
            referenceType,
            branchId
          );

          if (!result.success) {
            console.error(`❌ [processTransactionStock] Restore failed for ${product.name}: ${result.error_message}`);
          }
        }
      }
    }

    // Save audit logs
    if (movements.length > 0) {
      await StockService.createStockMovements(movements, referenceType);
    }
  }

  /**
   * @deprecated DO NOT USE - stock is managed via inventory_batches
   */
  static async updateProductStock(_productId: string, _newStock: number): Promise<void> {
    console.warn('⚠️ updateProductStock is DEPRECATED and currently does nothing. Stock is managed via RPCs.');
  }

  /**
   * Create stock movement records
   */
  static async createStockMovements(movements: CreateStockMovementData[], referenceType: string = 'transaction'): Promise<void> {
    // Audit logging logic remains same...
    // (Kept as is for audit purposes, though strictly this is "side effect" logic)

    if (referenceType === 'transaction') {
      // Transaction movements are typically inferred from items, but we log if needed
    }

    // Check table existence first
    const { error: tableError } = await supabase
      .from('material_stock_movements')
      .select('id')
      .order('id').limit(1);

    if (tableError) return;

    // Get valid product IDs
    const productIds = movements.map(m => m.productId);
    const { data: existingMaterials } = await supabase
      .from('materials')
      .select('id')
      .in('id', productIds);

    const existingMaterialIds = new Set((existingMaterials || []).map(m => m.id));
    const validMovements = movements.filter(m => existingMaterialIds.has(m.productId));

    if (validMovements.length === 0) return;

    const dbMovements = validMovements.map(movement => ({
      material_id: movement.productId,
      quantity: movement.quantity,
      previous_stock: movement.previousStock,
      new_stock: movement.newStock,
      user_name: movement.userName,
      notes: movement.notes || `Stock movement for ${movement.productName}`,
      material_name: movement.productName,
      type: movement.type,
      reason: movement.reason,
      reference_id: movement.referenceId,
      reference_type: movement.referenceType,
      user_id: movement.userId
    }));

    const { error } = await supabase.from('material_stock_movements').insert(dbMovements);
    if (error) console.error('Stock movements insert error:', error);
  }

  /**
   * Get products with low stock
   * Uses v_product_current_stock VIEW as SOLE source of truth
   */
  static async getLowStockProducts(): Promise<Product[]> {
    // 1. Get accurate stock from VIEW
    const { data: stockData, error: stockError } = await supabase
      .from('v_product_current_stock')
      .select('product_id, product_name, current_stock, branch_id');

    if (stockError) {
      console.error('❌ Failed to fetch low stock from VIEW:', stockError);
      throw new Error('Gagal mengambil data stok dari view.');
      // WE DO NOT FALLBACK TO PRODUCTS TABLE - IT IS UNRELIABLE
    }

    if (!stockData || stockData.length === 0) return [];

    // 2. Get product definitions (min_stock)
    const { data: productsData } = await supabase
      .from('products')
      .select('id, name, min_stock, unit, category, type, base_price, initial_stock, min_order, description, created_at, updated_at');

    const productsMap = new Map((productsData || []).map(p => [p.id, p]));

    // 3. Filter and map
    return stockData
      .filter(s => {
        const product = productsMap.get(s.product_id);
        if (!product) return false;
        return (s.current_stock || 0) < (Number(product.min_stock) || 0);
      })
      .map(s => {
        const product = productsMap.get(s.product_id)!;
        return {
          id: product.id,
          name: product.name,
          category: product.category,
          type: product.type || 'Stock',
          basePrice: Number(product.base_price) || 0,
          unit: product.unit || 'pcs',
          initialStock: Number(product.initial_stock) || 0,
          currentStock: s.current_stock, // FROM VIEW
          minStock: Number(product.min_stock) || 0,
          minOrder: Number(product.min_order) || 1,
          description: product.description || '',
          specifications: [],
          materials: [],
          createdAt: new Date(product.created_at),
          updatedAt: new Date(product.updated_at),
        } as Product;
      });
  }

  /**
   * Manual stock adjustment - NOW USES RPC
   */
  static async adjustStock(
    productId: string,
    productName: string,
    currentStock: number,
    newStock: number,
    reason: string,
    userId: string,
    userName: string,
    branchId?: string | null
  ): Promise<void> {
    const quantity = Math.abs(newStock - currentStock);
    const movementType: StockMovementType = newStock > currentStock ? 'IN' : 'OUT';

    console.log(`📦 Adjusting stock for ${productName}: ${currentStock} -> ${newStock} (${movementType})`);

    if (!branchId) {
      console.error('Branch ID is required for stock adjustment');
      throw new Error('Branch ID is required for stock adjustment');
    }

    if (newStock > currentStock) {
      // INCREASE STOCK -> Use restore_inventory_fifo (Creating a new batch)
      // This is effectively "Adding Stock"
      const result = await restoreStockFIFO(
        productId,
        quantity,
        `ADJ-${Date.now()}`,
        'adjustment',
        branchId,
        0,
        'MANUAL_ADJUSTMENT',
        reason,
        userId,
        userName
      );

      if (!result.success) {
        throw new Error(`Failed to increase stock: ${result.error_message}`);
      }
    } else {
      // DECREASE STOCK -> Use consume_inventory_fifo
      const result = await consumeStockFIFO(
        productId,
        quantity,
        `ADJ-${Date.now()}`,
        'adjustment',
        branchId,
        'MANUAL_ADJUSTMENT',
        reason,
        userId,
        userName
      );

      if (!result.success) {
        throw new Error(`Failed to decrease stock: ${result.error_message}`);
      }
    }
  }

  // ============================================================================
  // FIFO HPP CALCULATION
  // ============================================================================

  static async calculateFIFOHpp(productId: string, quantity: number = 1): Promise<number> {
    try {
      // Direct query to batches table is still needed here as strictly read-only helper
      const { data: batches, error } = await supabase
        .from('inventory_batches')
        .select('remaining_quantity, unit_cost')
        .eq('product_id', productId)
        .gt('remaining_quantity', 0)
        .order('batch_date', { ascending: true });

      if (error || !batches || batches.length === 0) {
        return await StockService.getFallbackHpp(productId);
      }

      let remainingQty = quantity;
      let totalCost = 0;
      let totalQtyUsed = 0;

      for (const batch of batches) {
        if (remainingQty <= 0) break;
        const batchRemaining = batch.remaining_quantity || 0;
        const batchCost = batch.unit_cost || 0;
        const qtyFromBatch = Math.min(batchRemaining, remainingQty);

        if (qtyFromBatch > 0) {
          totalCost += qtyFromBatch * batchCost;
          totalQtyUsed += qtyFromBatch;
          remainingQty -= qtyFromBatch;
        }
      }

      if (totalQtyUsed > 0) {
        return totalCost / totalQtyUsed;
      }

      return await StockService.getFallbackHpp(productId);
    } catch (err) {
      console.error('[calculateFIFOHpp] Exception:', err);
      return await StockService.getFallbackHpp(productId);
    }
  }

  static async getFallbackHpp(productId: string): Promise<number> {
    try {
      const { data: product } = await supabase
        .from('products')
        .select('cost_price, type')
        .eq('id', productId)
        .single();

      if (product?.cost_price && product.cost_price > 0) return Number(product.cost_price);

      if (product?.type === 'Produksi') {
        const bomCost = await StockService.calculateBOMCost(productId);
        if (bomCost > 0) return bomCost;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  static async calculateBOMCost(productId: string): Promise<number> {
    try {
      const { data: bomItems } = await supabase
        .from('product_materials')
        .select('quantity, material_id')
        .eq('product_id', productId);

      if (!bomItems) return 0;

      let totalCost = 0;
      for (const item of bomItems) {
        // Warning: This recursion could be expensive, but logic stands
        const materialHpp = await StockService.getFallbackHpp(item.material_id);
        totalCost += materialHpp * item.quantity;
      }
      return totalCost;
    } catch {
      return 0;
    }
  }
}