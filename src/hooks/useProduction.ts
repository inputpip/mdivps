import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ProductionRecord, ProductionInput, BOMItem, ErrorInput } from '@/types/production';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranch } from '@/contexts/BranchContext';

export const useProduction = () => {
  const [productions, setProductions] = useState<ProductionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const { currentBranch } = useBranch();

  // Fetch production history
  const fetchProductions = useCallback(async () => {
    try {
      setIsLoading(true);
      if (!currentBranch?.id) return;

      const { data, error } = await supabase
        .from('production_records')
        .select('*, products (name), profiles (name)')
        .eq('branch_id', currentBranch.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formattedData: ProductionRecord[] = data?.map(record => ({
        id: record.id,
        ref: record.ref,
        productId: record.product_id,
        productName: record.product_id ? (record.products?.name || 'Unknown Product') : 'Bahan Rusak',
        quantity: record.quantity,
        note: record.note,
        consumeBOM: record.consume_bom,
        bomSnapshot: typeof record.bom_snapshot === 'string' ? JSON.parse(record.bom_snapshot) : record.bom_snapshot,
        createdBy: record.created_by,
        createdByName: record.profiles?.name || record.user_input_name || 'Unknown',
        user_input_name: record.user_input_name,
        createdAt: new Date(record.created_at),
        updatedAt: new Date(record.updated_at)
      })) || [];

      setProductions(formattedData);
    } catch (error: any) {
      console.error('Error fetching productions:', error);
    } finally {
      setIsLoading(false);
    }
  }, [currentBranch]);

  // Get BOM for a product
  const getBOM = useCallback(async (productId: string): Promise<BOMItem[]> => {
    try {
      const { data, error } = await supabase
        .from('product_materials')
        .select('*, materials (name, unit)')
        .eq('product_id', productId);

      if (error) throw error;

      return data?.map(item => ({
        id: item.id,
        materialId: item.material_id,
        materialName: item.materials?.name || 'Unknown Material',
        quantity: item.quantity,
        unit: item.materials?.unit || 'pcs',
        notes: item.notes
      })) || [];
    } catch (error) {
      console.error('Error fetching BOM:', error);
      return [];
    }
  }, []);

  // Process Production (Atomic RPC)
  const processProduction = useCallback(async (input: ProductionInput): Promise<boolean> => {
    try {
      setIsLoading(true);
      if (!currentBranch?.id) throw new Error('Branch tidak dipilih');

      const { data, error } = await supabase.rpc('process_production_atomic', {
        p_product_id: input.productId,
        p_quantity: input.quantity,
        p_consume_bom: input.consumeBOM,
        p_note: input.note || null,
        p_branch_id: currentBranch.id,
        p_user_id: input.createdBy,
        p_user_name: user?.name || user?.email || 'Unknown User'
      });

      if (error) throw error;
      const res = Array.isArray(data) ? data[0] : data;
      if (!res?.success) throw new Error(res?.error_message || 'Gagal memproses produksi');

      toast({ title: "Sukses", description: `Produksi berhasil. Ref: ${res.production_ref}` });

      await fetchProductions();
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });

      return true;
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message });
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [toast, user, currentBranch, fetchProductions, queryClient]);

  // Process Spoilage (Atomic RPC)
  const processError = useCallback(async (input: ErrorInput): Promise<boolean> => {
    try {
      setIsLoading(true);
      if (!currentBranch?.id) throw new Error('Branch tidak dipilih');

      const { data, error } = await supabase.rpc('process_spoilage_atomic', {
        p_material_id: input.materialId,
        p_quantity: input.quantity,
        p_note: input.note || null,
        p_branch_id: currentBranch.id,
        p_user_id: input.createdBy,
        p_user_name: user?.name || user?.email || 'Unknown User'
      });

      if (error) throw error;
      const res = Array.isArray(data) ? data[0] : data;
      if (!res?.success) throw new Error(res?.error_message || 'Gagal memproses bahan rusak');

      toast({ title: "Sukses", description: `Bahan rusak ${res.record_ref} berhasil dicatat.` });

      await fetchProductions();
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });

      return true;
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message });
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [toast, user, currentBranch, fetchProductions, queryClient]);

  // Delete Production (Atomic RPC)
  const deleteProduction = useCallback(async (recordId: string): Promise<boolean> => {
    try {
      setIsLoading(true);
      if (!currentBranch?.id) throw new Error('Branch tidak dipilih');

      const { data, error } = await supabase.rpc('void_production_atomic', {
        p_production_id: recordId,
        p_branch_id: currentBranch.id
      });

      if (error) throw error;
      const res = Array.isArray(data) ? data[0] : data;
      if (!res?.success) throw new Error(res?.error_message || 'Gagal menghapus data produksi');

      toast({ title: "Sukses", description: "Data produksi dihapus, stok dikembalikan, dan jurnal dibatalkan" });

      queryClient.invalidateQueries({ queryKey: ['materials'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
      queryClient.invalidateQueries({ queryKey: ['materialMovements'] });

      await fetchProductions();
      return true;
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message });
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [currentBranch, toast, fetchProductions, queryClient]);

  return {
    productions,
    isLoading,
    fetchProductions,
    getBOM,
    processProduction,
    processError,
    deleteProduction
  };
};