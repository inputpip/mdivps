import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Material } from '@/types/material'
import { supabase } from '@/integrations/supabase/client'
import { useBranch } from '@/contexts/BranchContext'
// journalService removed - now using RPC for all journal operations

const fromDbToApp = (dbMaterial: any): Material => ({
  id: dbMaterial.id,
  name: dbMaterial.name,
  type: dbMaterial.type || 'Stock', // Default to Stock if not set (field may not exist yet)
  unit: dbMaterial.unit,
  pricePerUnit: dbMaterial.price_per_unit,
  stock: dbMaterial.stock,
  minStock: dbMaterial.min_stock,
  description: dbMaterial.description,
  createdAt: new Date(dbMaterial.created_at),
  updatedAt: new Date(dbMaterial.updated_at),
});

const fromAppToDb = (appMaterial: Partial<Omit<Material, 'id' | 'createdAt' | 'updatedAt'>>) => {
  const { pricePerUnit, minStock, type, ...rest } = appMaterial;
  const dbData: any = { ...rest };
  if (pricePerUnit !== undefined) {
    dbData.price_per_unit = pricePerUnit;
  }
  if (minStock !== undefined) {
    dbData.min_stock = minStock;
  }
  // Field type exists in DB
  if (type !== undefined) {
    dbData.type = type;
  }
  return dbData;
};

export const useMaterials = () => {
  const queryClient = useQueryClient();
  const { currentBranch, canAccessAllBranches } = useBranch();

  const { data: materials, isLoading } = useQuery<Material[]>({
    queryKey: ['materials', currentBranch?.id],
    queryFn: async () => {
      // 1. Fetch materials
      let query = supabase
        .from('materials')
        .select('*');

      // Apply branch filter - include branch-specific OR shared materials (branch_id is null)
      if (currentBranch?.id) {
        query = query.or(`branch_id.eq.${currentBranch.id},branch_id.is.null`);
      }

      const { data: materialsData, error: materialsError } = await query;
      if (materialsError) throw new Error(materialsError.message);

      // 2. Fetch actual stock from v_material_current_stock VIEW for accurate FIFO count
      let stockQuery = supabase.from('v_material_current_stock').select('material_id, current_stock');
      if (currentBranch?.id) {
        stockQuery = stockQuery.or(`branch_id.eq.${currentBranch.id},branch_id.is.null`);
      }

      const { data: stockData } = await stockQuery;

      // 3. Create stock map for quick lookup
      const stockMap = new Map<string, number>();
      if (stockData) {
        stockData.forEach((s: any) => stockMap.set(s.material_id, Number(s.current_stock) || 0));
      }

      // 4. Map and override with View data (Source of Truth)
      return materialsData ? materialsData.map(m => {
        const material = fromDbToApp(m);
        // Override stock with value from VIEW (FIFO)
        material.stock = stockMap.get(m.id) ?? 0;
        return material;
      }) : [];
    },
    enabled: !!currentBranch,
    // Optimized for material management pages
    staleTime: 5 * 60 * 1000, // 5 minutes - materials change more frequently than products
    gcTime: 10 * 60 * 1000, // 10 minutes cache
    refetchOnWindowFocus: false, // Don't refetch on window focus
    refetchOnReconnect: false, // Don't refetch on reconnect
    retry: 1, // Only retry once
    retryDelay: 1000,
  });

  const addStock = useMutation({
    mutationFn: async ({ materialId, quantity }: { materialId: string, quantity: number }): Promise<void> => {
      if (!currentBranch?.id) throw new Error('Branch required');

      console.log('[addStock] Calling add_material_batch RPC:', { materialId, quantity });

      const { data: rpcResultRaw, error } = await supabase.rpc('add_material_batch', {
        p_material_id: materialId,
        p_branch_id: currentBranch.id,
        p_quantity: quantity,
        p_unit_cost: 0, // Manual adjustment cost 0
        p_reference_id: 'manual_adjustment',
        p_notes: 'Manual stock adjustment (add)'
      });

      if (error) {
        console.error('[addStock] RPC error:', error);
        throw new Error(error.message);
      }

      const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;
      if (!rpcResult?.success) throw new Error(rpcResult?.error_message || 'Failed to add material stock');

      console.log('[addStock] Stock added successfully');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });

  const upsertMaterial = useMutation({
    mutationFn: async (material: Partial<Material>): Promise<Material> => {
      const dbData = {
        ...fromAppToDb(material),
        branch_id: currentBranch?.id || null,
      };

      const isUpdate = !!material.id;
      let existing: any = null;

      if (isUpdate) {
        const { data: currentRaw } = await supabase
          .from('materials')
          .select('stock, price_per_unit, name')
          .eq('id', material.id!)
          .single();
        existing = currentRaw;

        // materials.stock is DEPRECATED - do not overwrite with calculated view value
        delete dbData.stock;

        const { error } = await supabase
          .from('materials')
          .update(dbData)
          .eq('id', material.id!);
        if (error) throw error;
      } else {
        // For new materials, treated similarly to products
        const materialToInsert = { ...dbData };
        // Ensure stock has a value (default 0) to satisfy NOT NULL constraint
        if (materialToInsert.stock === undefined || materialToInsert.stock === null) {
          materialToInsert.stock = 0;
        }

        const { data: dataRaw, error } = await supabase
          .from('materials')
          .insert(materialToInsert)
          .select();
        if (error) throw error;
        // Handle PostgREST array response
        const insertedData = Array.isArray(dataRaw) ? dataRaw[0] : dataRaw;
        if (!insertedData?.id) throw new Error('Failed to create material - no ID returned');
        material.id = insertedData.id;
      }

      // Fetch final state
      const { data: finalRaw } = await supabase.from('materials').select('*').eq('id', material.id!);
      // Handle PostgREST array response
      const finalData = Array.isArray(finalRaw) ? finalRaw[0] : finalRaw;
      if (!finalData) throw new Error('Failed to fetch created material');
      const finalMaterial = fromDbToApp(finalData);

      // ============================================================================
      // SYNC INITIAL STOCK via RPC
      // ============================================================================
      // Note: materials.stock in this app seems to be used as "initial/current stock" in some flows
      const newStock = Number(finalMaterial.stock) || 0;
      const oldStock = existing ? Number(existing.stock) : 0;
      const pricePerUnit = Number(finalMaterial.pricePerUnit) || 0;

      if (newStock > 0 || (existing && newStock !== oldStock)) {
        if (!currentBranch?.id) throw new Error('Branch required');

        const { data: rpcResultRaw, error: rpcError } = await supabase.rpc('sync_material_initial_stock_atomic', {
          p_material_id: finalMaterial.id,
          p_branch_id: currentBranch.id,
          p_new_initial_stock: newStock,
          p_unit_cost: pricePerUnit
        });

        if (rpcError) throw rpcError;
        const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;
        if (!rpcResult?.success) throw new Error(rpcResult?.error_message || 'Failed to sync material stock');
        // Note: Journal creation is handled by the RPC function
      }

      return finalMaterial;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });

  const deleteMaterial = useMutation({
    mutationFn: async (materialId: string): Promise<void> => {
      const { error } = await supabase
        .from('materials')
        .delete()
        .eq('id', materialId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materials'] });
    },
  });

  // Listen for production completion events to refresh materials
  useEffect(() => {
    const handleProductionComplete = () => {
      console.log('Production completed, refreshing materials...');
      queryClient.invalidateQueries({ queryKey: ['materials'] });
    };

    window.addEventListener('production-completed', handleProductionComplete);
    return () => {
      window.removeEventListener('production-completed', handleProductionComplete);
    };
  }, [queryClient]);

  const adjustStock = useMutation({
    mutationFn: async ({ materialId, quantityChange, reason, unitCost }: { materialId: string, quantityChange: number, reason: string, unitCost?: number }): Promise<void> => {
      if (!currentBranch?.id) throw new Error('Branch required');

      console.log('[adjustStock] Calling create_material_stock_adjustment_atomic RPC:', { materialId, quantityChange, reason });

      const { data: rpcResultRaw, error } = await supabase.rpc('create_material_stock_adjustment_atomic', {
        p_material_id: materialId,
        p_branch_id: currentBranch.id,
        p_quantity_change: quantityChange,
        p_reason: reason,
        p_unit_cost: unitCost || 0
      });

      if (error) {
        console.error('[adjustStock] RPC error:', error);
        throw new Error(error.message);
      }

      const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;
      if (!rpcResult?.success) throw new Error(rpcResult?.error_message || 'Failed to adjust material stock');

      console.log('[adjustStock] Stock adjusted successfully');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });

  return {
    materials,
    isLoading,
    addStock,
    adjustStock,
    upsertMaterial,
    deleteMaterial,
  }
}