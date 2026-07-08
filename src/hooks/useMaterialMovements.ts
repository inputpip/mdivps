import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MaterialMovement, CreateMaterialMovementData } from '@/types/materialMovement'
import { supabase } from '@/integrations/supabase/client'
import { useBranch } from '@/contexts/BranchContext'

// Helper to map from DB (snake_case) to App (camelCase)
const fromDbToApp = (dbMovement: any): MaterialMovement => ({
  id: dbMovement.id,
  materialId: dbMovement.material_id,
  materialName: dbMovement.material_name,
  type: dbMovement.type,
  reason: dbMovement.reason,
  quantity: Number(dbMovement.quantity),
  previousStock: Number(dbMovement.previous_stock),
  newStock: Number(dbMovement.new_stock),
  referenceId: dbMovement.reference_id,
  referenceType: dbMovement.reference_type,
  notes: dbMovement.notes,
  userId: dbMovement.user_id,
  userName: dbMovement.user_name,
  createdAt: dbMovement.created_at,
});

// Helper to map from App (camelCase) to DB (snake_case)
const fromAppToDb = (appMovement: CreateMaterialMovementData) => ({
  material_id: appMovement.materialId,
  material_name: appMovement.materialName,
  type: appMovement.type,
  reason: appMovement.reason,
  quantity: appMovement.quantity,
  previous_stock: appMovement.previousStock,
  new_stock: appMovement.newStock,
  reference_id: appMovement.referenceId,
  reference_type: appMovement.referenceType,
  notes: appMovement.notes,
  user_id: appMovement.userId,
  user_name: appMovement.userName,
  branch_id: appMovement.branchId,
});

export const useMaterialMovements = () => {
  const queryClient = useQueryClient()
  const { currentBranch } = useBranch()

  const { data: stockMovements, isLoading } = useQuery({
    queryKey: ['materialMovements', currentBranch?.id],
    queryFn: async (): Promise<MaterialMovement[]> => {
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
        console.error('Error fetching material movements:', error);
        // If table doesn't exist, return empty array for now
        if (error.code === '42P01' || error.code === 'PGRST205') {
          console.warn('material_stock_movements table does not exist, returning empty array');
          return [];
        }
        throw new Error(error.message);
      }
      return data ? data.map(fromDbToApp) : [];
    },
    enabled: !!currentBranch,
    // Optimized for material movements
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes cache
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    retryDelay: 1000,
  });

  const createMaterialMovement = useMutation({
    mutationFn: async (movementData: CreateMaterialMovementData): Promise<MaterialMovement> => {
      const dbData = {
        ...fromAppToDb(movementData),
        // Override branch_id with current branch if not provided
        branch_id: movementData.branchId || currentBranch?.id || null,
      };
      // Use .order('id').limit(1) and handle array response because our client forces Accept: application/json
      const { data: dataRaw, error } = await supabase
        .from('material_stock_movements')
        .insert(dbData)
        .select()
        .order('id').limit(1);

      if (error) {
        console.error('Error creating material movement:', error);
        throw new Error(error.message);
      }
      const data = Array.isArray(dataRaw) ? dataRaw[0] : dataRaw;
      if (!data) throw new Error('Failed to create material movement');
      return fromDbToApp(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materialMovements'] });
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      queryClient.invalidateQueries({ queryKey: ['receiveGoods'] });
    },
  });

  const getMovementsByMaterial = async (materialId: string): Promise<MaterialMovement[]> => {
    let query = supabase
      .from('material_stock_movements')
      .select('*')
      .eq('material_id', materialId)
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

  const getMovementsByDateRange = async (from: Date, to: Date): Promise<MaterialMovement[]> => {
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

  return {
    stockMovements,
    isLoading,
    createMaterialMovement,
    getMovementsByMaterial,
    getMovementsByDateRange,
  }
}