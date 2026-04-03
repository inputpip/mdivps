import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { StockMovement, CreateStockMovementData, StockConsumptionReport } from '@/types/stockMovement'
import { supabase } from '@/integrations/supabase/client'
import { startOfMonth, endOfMonth } from 'date-fns'
import { useBranch } from '@/contexts/BranchContext'

// Helper to map from DB (snake_case) to App (camelCase)
// Note: Now using material_stock_movements table
const fromDbToApp = (dbMovement: any): StockMovement => ({
  id: dbMovement.id,
  productId: dbMovement.material_id, // material_id maps to productId for compatibility
  productName: dbMovement.material_name, // material_name maps to productName
  type: dbMovement.type,
  reason: dbMovement.reason,
  quantity: Number(dbMovement.quantity),
  previousStock: Number(dbMovement.previous_stock),
  newStock: Number(dbMovement.new_stock),
  notes: dbMovement.notes,
  referenceId: dbMovement.reference_id,
  referenceType: dbMovement.reference_type,
  userId: dbMovement.user_id,
  userName: dbMovement.user_name,
  createdAt: new Date(dbMovement.created_at),
});

// Helper to map from App (camelCase) to DB (snake_case)
// Note: Now using material_stock_movements table schema
const fromAppToDb = (appMovement: CreateStockMovementData) => ({
  material_id: appMovement.productId, // productId maps to material_id
  material_name: appMovement.productName, // productName maps to material_name
  type: appMovement.type,
  reason: appMovement.reason,
  quantity: appMovement.quantity,
  previous_stock: appMovement.previousStock,
  new_stock: appMovement.newStock,
  notes: appMovement.notes,
  reference_id: appMovement.referenceId,
  reference_type: appMovement.referenceType,
  user_id: appMovement.userId,
  user_name: appMovement.userName,
});

export const useStockMovements = () => {
  const queryClient = useQueryClient()
  const { currentBranch } = useBranch()

  const { data: movements, isLoading } = useQuery({
    queryKey: ['stockMovements', currentBranch?.id],
    queryFn: async (): Promise<StockMovement[]> => {
      let query = supabase
        .from('material_stock_movements')
        .select('*')
        .order('created_at', { ascending: false });

      // Apply branch filter - ALWAYS filter by selected branch
      if (currentBranch?.id) {
        query = query.eq('branch_id', currentBranch.id);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching stock movements:', error);
        // If table doesn't exist, return empty array instead of throwing
        if (error.code === '42P01' || error.code === 'PGRST205') {
          console.warn('material_stock_movements table does not exist, returning empty array');
          return [];
        }
        throw new Error(error.message);
      }
      return data ? data.map(fromDbToApp) : [];
    },
    enabled: !!currentBranch,
    // Optimized for stock movements
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes cache
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    retryDelay: 1000,
  });

  const createStockMovement = useMutation({
    mutationFn: async (movementData: CreateStockMovementData): Promise<StockMovement> => {
      const dbData = fromAppToDb(movementData);
      // Use .order('id').limit(1) and handle array response because our client forces Accept: application/json
      const { data: dataRaw, error } = await supabase
        .from('material_stock_movements')
        .insert(dbData)
        .select()
        .order('id').limit(1);

      if (error) {
        console.error('Error creating stock movement:', error);
        throw new Error(error.message);
      }
      const data = Array.isArray(dataRaw) ? dataRaw[0] : dataRaw;
      if (!data) throw new Error('Failed to create stock movement');
      return fromDbToApp(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stockMovements'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  const getMovementsByProduct = async (productId: string): Promise<StockMovement[]> => {
    let query = supabase
      .from('material_stock_movements')
      .select('*')
      .eq('material_id', productId) // Updated to material_id
      .order('created_at', { ascending: false });

    // Apply branch filter
    if (currentBranch?.id) {
      query = query.eq('branch_id', currentBranch.id);
    }

    const { data, error } = await query;

    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') {
        return [];
      }
      throw new Error(error.message);
    }
    return data ? data.map(fromDbToApp) : [];
  };

  const getMovementsByDateRange = async (from: Date, to: Date): Promise<StockMovement[]> => {
    let query = supabase
      .from('material_stock_movements')
      .select('*')
      .gte('created_at', from.toISOString())
      .lte('created_at', to.toISOString())
      .order('created_at', { ascending: false });

    // Apply branch filter
    if (currentBranch?.id) {
      query = query.eq('branch_id', currentBranch.id);
    }

    const { data, error } = await query;

    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') {
        return [];
      }
      throw new Error(error.message);
    }
    return data ? data.map(fromDbToApp) : [];
  };

  const getMonthlyConsumptionReport = async (year: number, month: number): Promise<StockConsumptionReport[]> => {
    const startDate = startOfMonth(new Date(year, month - 1));
    const endDate = endOfMonth(new Date(year, month - 1));

    // Get all movements for the month
    const movements = await getMovementsByDateRange(startDate, endDate);

    // Get all materials with branch filter
    let materialsQuery = supabase
      .from('materials')
      .select('id, name, type, unit');

    // Apply branch filter
    if (currentBranch?.id) {
      materialsQuery = materialsQuery.eq('branch_id', currentBranch.id);
    }

    const { data: materials, error: materialsError } = await materialsQuery;

    if (materialsError) throw new Error(materialsError.message);

    // Fetch actual stock from v_material_current_stock VIEW for accurate FIFO count
    let stockQuery = supabase.from('v_material_current_stock').select('material_id, current_stock');
    if (currentBranch?.id) {
      stockQuery = stockQuery.or(`branch_id.eq.${currentBranch.id},branch_id.is.null`);
    }

    const { data: stockData } = await stockQuery;
    const stockMap = new Map<string, number>();
    if (stockData) {
      stockData.forEach((s: any) => stockMap.set(s.material_id, Number(s.current_stock) || 0));
    }

    // Group movements by material
    const materialMovements = movements.reduce((acc, movement) => {
      if (!acc[movement.productId]) { // productId is actually materialId now
        acc[movement.productId] = [];
      }
      acc[movement.productId].push(movement);
      return acc;
    }, {} as Record<string, StockMovement[]>);

    // Create report for each material that had movements
    const reports: StockConsumptionReport[] = [];

    for (const material of materials || []) {
      const materialMovs = materialMovements[material.id] || [];
      
      if (materialMovs.length > 0 || material.type !== 'Jasa') {
        const totalIn = materialMovs
          .filter(m => m.type === 'IN')
          .reduce((sum, m) => sum + m.quantity, 0);
          
        const totalOut = materialMovs
          .filter(m => m.type === 'OUT')
          .reduce((sum, m) => sum + m.quantity, 0);

        const netMovement = totalIn - totalOut;
        const endingStock = stockMap.get(material.id) || 0;
        const startingStock = endingStock - netMovement;

        reports.push({
          productId: material.id,
          productName: material.name,
          productType: material.type || 'Stock',
          unit: material.unit || 'pcs',
          totalIn,
          totalOut,
          netMovement,
          startingStock,
          endingStock,
          movements: materialMovs
        });
      }
    }

    return reports.sort((a, b) => a.productName.localeCompare(b.productName));
  };

  return {
    movements,
    isLoading,
    createStockMovement,
    getMovementsByProduct,
    getMovementsByDateRange,
    getMonthlyConsumptionReport,
  }
}