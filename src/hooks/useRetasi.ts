import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Retasi, RetasiItem, CreateRetasiData, UpdateRetasiData, ReturnItemsData, CreateRetasiItemData } from '@/types/retasi';
import { useBranch } from '@/contexts/BranchContext';
import { useAuth } from './useAuth';
import { useTimezone } from '@/contexts/TimezoneContext';
import { getOfficeDateString } from '@/utils/officeTime';

// Database to App mapping for RetasiItem
// Note: Database uses returned_qty/error_qty, App uses returned_quantity/error_quantity
const fromDbItem = (dbItem: any): RetasiItem => ({
  id: dbItem.id,
  retasi_id: dbItem.retasi_id,
  delivery_id: dbItem.delivery_id,
  product_id: dbItem.product_id,
  product_name: dbItem.product_name,
  quantity: dbItem.quantity || 0,
  returned_quantity: dbItem.returned_qty || dbItem.returned_quantity || 0,
  sold_quantity: dbItem.sold_qty || dbItem.sold_quantity || 0,
  error_quantity: dbItem.error_qty || dbItem.error_quantity || 0,
  unsold_quantity: dbItem.unsold_qty || dbItem.unsold_quantity || 0,
  weight: dbItem.weight,
  volume: dbItem.volume,
  notes: dbItem.notes,
  created_at: dbItem.created_at ? new Date(dbItem.created_at) : new Date(),
});

// Database to App mapping
const fromDb = (dbRetasi: any): Retasi => ({
  id: dbRetasi.id,
  retasi_number: dbRetasi.retasi_number,
  truck_number: dbRetasi.truck_number,
  driver_name: dbRetasi.driver_name,
  helper_id: dbRetasi.helper_id,
  helper_name: dbRetasi.helper_name,
  helper_id_2: dbRetasi.helper_id_2,
  helper_name_2: dbRetasi.helper_name_2,
  helper_id_3: dbRetasi.helper_id_3,
  helper_name_3: dbRetasi.helper_name_3,
  departure_date: new Date(dbRetasi.departure_date),
  departure_time: dbRetasi.departure_time,
  route: dbRetasi.route,
  total_items: dbRetasi.total_items || 0,
  total_weight: dbRetasi.total_weight,
  notes: dbRetasi.notes,
  retasi_ke: dbRetasi.retasi_ke || 1,
  is_returned: dbRetasi.is_returned || false,
  returned_items_count: dbRetasi.returned_items_count || 0,
  error_items_count: dbRetasi.error_items_count || 0,
  barang_laku: dbRetasi.barang_laku || 0, // Jumlah barang yang laku terjual
  barang_tidak_laku: dbRetasi.barang_tidak_laku || 0, // Jumlah barang yang tidak laku
  return_notes: dbRetasi.return_notes,
  created_by: dbRetasi.created_by,
  created_at: new Date(dbRetasi.created_at),
  updated_at: new Date(dbRetasi.updated_at),
});

// App to Database mapping
// Note: This function doesn't have access to timezone context,
// so departure_date conversion is handled in createRetasi mutation
const toDb = (appRetasi: CreateRetasiData | UpdateRetasiData, overrideDate?: string) => {
  const dbData: any = { ...appRetasi };

  if ('departure_date' in appRetasi && appRetasi.departure_date) {
    const depDate = appRetasi.departure_date;
    // Use overrideDate if provided (from office timezone), otherwise use local date
    if (overrideDate) {
      dbData.departure_date = overrideDate;
    } else {
      // Fallback to local date format
      const year = depDate.getFullYear();
      const month = String(depDate.getMonth() + 1).padStart(2, '0');
      const day = String(depDate.getDate()).padStart(2, '0');
      dbData.departure_date = `${year}-${month}-${day}`;
    }

    // Auto-set departure_time from departure_date if not provided
    if (!dbData.departure_time) {
      const hours = depDate.getHours().toString().padStart(2, '0');
      const minutes = depDate.getMinutes().toString().padStart(2, '0');
      dbData.departure_time = `${hours}:${minutes}`;
    }
  }

  return dbData;
};

// Hook to check if a driver has any retasi records (legacy - kept for backward compatibility)
export const useDriverHasRetasi = (driverName?: string) => {
  return useQuery<boolean>({
    queryKey: ['driver-has-retasi', driverName],
    queryFn: async () => {
      if (!driverName) return false;

      const { data, error } = await supabase
        .from('retasi')
        .select('id')
        .eq('driver_name', driverName)
        .order('id').limit(1);

      if (error) {
        console.error('[useDriverHasRetasi] Error checking driver retasi:', error);
        return false;
      }

      return (data && data.length > 0) || false;
    },
    enabled: !!driverName,
  });
};

// Hook to get active retasi for a driver (is_returned = false)
// Uses case-insensitive matching with ILIKE to handle name variations
export const useActiveRetasi = (driverName?: string) => {
  return useQuery<Retasi | null>({
    queryKey: ['active-retasi', driverName],
    queryFn: async () => {
      if (!driverName) return null;

      const trimmedName = driverName.trim();
      console.log('[useActiveRetasi] Checking active retasi for driver:', trimmedName);
      console.log('[useActiveRetasi] Original name:', driverName, '| Trimmed:', trimmedName);

      // First try exact match
      let { data, error } = await supabase
        .from('retasi')
        .select('*')
        .eq('driver_name', trimmedName)
        .eq('is_returned', false)
        .maybeSingle();

      // If no exact match, try case-insensitive match
      if (!data && !error) {
        console.log('[useActiveRetasi] No exact match, trying case-insensitive...');
        const { data: ilikData, error: ilikError } = await supabase
          .from('retasi')
          .select('*')
          .ilike('driver_name', trimmedName)
          .eq('is_returned', false)
          .maybeSingle();

        data = ilikData;
        error = ilikError;
      }

      if (error) {
        console.error('[useActiveRetasi] Error fetching active retasi:', error);
        return null;
      }

      console.log('[useActiveRetasi] Active retasi found:', data);

      return data ? fromDb(data) : null;
    },
    enabled: !!driverName,
  });
};

export const useRetasi = (filters?: {
  is_returned?: boolean;
  driver_name?: string;
  date_from?: string;
  date_to?: string;
}) => {
  const queryClient = useQueryClient();
  const { currentBranch } = useBranch();
  const { user } = useAuth();
  const { timezone } = useTimezone();

  // Get all retasi with items
  const { data: retasiList, isLoading, refetch: refetchRetasiList } = useQuery<(Retasi & { items?: RetasiItem[] })[]>({
    queryKey: ['retasi', currentBranch?.id, filters],
    queryFn: async () => {
      console.log('[useRetasi] Fetching retasi list with branch:', currentBranch?.id, 'filters:', filters);

      let query = supabase
        .from('retasi')
        .select(`
          *,
          retasi_items (
            id,
            product_id,
            product_name,
            quantity,
            returned_qty,
            sold_qty,
            error_qty,
            unsold_qty
          )
        `)
        .order('created_at', { ascending: false });

      // Apply branch filter - filter by branch if available
      // Also include records with NULL branch_id (legacy data or data created before branch was set)
      if (currentBranch?.id) {
        // Use OR to include both matching branch_id AND null branch_id
        query = query.or(`branch_id.eq.${currentBranch.id},branch_id.is.null`);
      }

      if (filters?.is_returned !== undefined) {
        query = query.eq('is_returned', filters.is_returned);
      }
      if (filters?.driver_name && filters.driver_name !== 'all') {
        query = query.eq('driver_name', filters.driver_name);
      }
      if (filters?.date_from) {
        query = query.gte('departure_date', filters.date_from);
      }
      if (filters?.date_to) {
        query = query.lte('departure_date', filters.date_to);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching retasi:', error);
        throw new Error(error.message);
      }

      return data ? data.map(r => ({
        ...fromDb(r),
        items: r.retasi_items?.map(fromDbItem) || []
      })) : [];
    },
    enabled: !!currentBranch,
    // Reduced staleTime to ensure data appears immediately after mutations
    staleTime: 30 * 1000, // 30 seconds - short enough for real-time updates
    gcTime: 5 * 60 * 1000, // 5 minutes cache
    refetchOnWindowFocus: true, // Refetch when user returns to tab
    refetchOnReconnect: true,
    retry: 1,
    retryDelay: 1000,
  });

  // Get retasi statistics
  const { data: stats } = useQuery({
    queryKey: ['retasi-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('retasi')
        .select('is_returned, departure_date');

      if (error) {
        console.error('Error fetching retasi stats:', error);
        throw new Error(error.message);
      }

      const today = getOfficeDateString(timezone);
      const stats = {
        total_retasi: data.length,
        active_retasi: data.filter(d => !d.is_returned).length,
        returned_retasi: data.filter(d => d.is_returned).length,
        today_retasi: data.filter(d => d.departure_date === today).length,
      };

      return stats;
    }
  });

  // Check if driver has unreturned retasi - simple table query
  const checkDriverAvailability = async (driverName: string): Promise<boolean> => {
    console.log('[useRetasi] === CHECKING DRIVER AVAILABILITY ===');
    console.log('[useRetasi] Driver name:', driverName);

    try {
      const { data, error } = await supabase
        .from('retasi')
        .select('id, retasi_number, is_returned, driver_name')
        .eq('driver_name', driverName)
        .eq('is_returned', false);

      console.log('[useRetasi] Query result:', { data, error });

      if (error) {
        console.error('[useRetasi] Database error:', error);
        // If table doesn't exist, assume no active retasi
        if (error.code === 'PGRST116' || error.message.includes('does not exist')) {
          console.log('[useRetasi] Retasi table does not exist, returning available=true');
          return true;
        }
        throw new Error(`Database error: ${error.message}`);
      }

      const activeRetasiList = data || [];
      const hasActiveRetasi = activeRetasiList.length > 0;
      const isAvailable = !hasActiveRetasi;

      console.log('[useRetasi] Active retasi found:', activeRetasiList);
      console.log('[useRetasi] Has active retasi:', hasActiveRetasi);
      console.log('[useRetasi] Driver is available:', isAvailable);
      console.log('[useRetasi] === END CHECK ===');

      return isAvailable; // Return true if driver is AVAILABLE (no unreturned retasi)
    } catch (err) {
      console.error('[useRetasi] Unexpected error in checkDriverAvailability:', err);
      throw err;
    }
  };

  // Create retasi - Simplified via RPC
  const createRetasi = useMutation({
    mutationFn: async (retasiData: CreateRetasiData): Promise<Retasi> => {
      if (!currentBranch?.id) throw new Error('Branch ID is required');

      console.log('🚀 Creating Retasi via Atomic RPC...', retasiData.driver_name);

      const { items, ...mainData } = retasiData;

      // Auto-generate departure_time if not provided
      let departureTime = mainData.departure_time;
      if (!departureTime) {
        const now = new Date();
        departureTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      }

      const { data: rpcResultRaw, error: rpcError } = await supabase
        .rpc('create_retasi_atomic', {
          p_branch_id: currentBranch.id,
          p_driver_name: mainData.driver_name,
          p_helper_name: mainData.helper_name || null,
          p_helper_id: mainData.helper_id || null,
          p_helper_name_2: mainData.helper_name_2 || null,
          p_helper_id_2: mainData.helper_id_2 || null,
          p_helper_name_3: mainData.helper_name_3 || null,
          p_helper_id_3: mainData.helper_id_3 || null,
          p_truck_number: mainData.truck_number || null,
          p_route: mainData.route || null,
          p_departure_date: mainData.departure_date instanceof Date ? mainData.departure_date.toISOString().split('T')[0] : mainData.departure_date,
          p_departure_time: departureTime,
          p_notes: mainData.notes || '',
          p_items: (items || []).map(item => ({
            product_id: item.product_id,
            product_name: item.product_name,
            quantity: item.quantity,
            weight: item.weight || 0,
            notes: item.notes || ''
          })),
          p_created_by: user?.id || null
        });

      if (rpcError) {
        console.error('❌ RPC Error:', rpcError);
        throw new Error(`Gagal membuat retasi: ${rpcError.message}`);
      }

      const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;
      if (!rpcResult?.success) {
        throw new Error(rpcResult?.error_message || 'Gagal membuat retasi');
      }

      console.log('✅ Retasi Created via RPC:', rpcResult.retasi_number, 'ID:', rpcResult.retasi_id);

      // Fetch the created retasi to return full object
      const { data: retasiRaw } = await supabase
        .from('retasi')
        .select('*')
        .eq('id', rpcResult.retasi_id)
        .single();

      if (!retasiRaw) throw new Error('Retasi created but not found');
      return fromDb(retasiRaw);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'retasi'
      });
      queryClient.invalidateQueries({ queryKey: ['retasi-stats'] });
      queryClient.invalidateQueries({ queryKey: ['retasi-items'] });
      queryClient.invalidateQueries({ queryKey: ['active-retasi'] });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    }
  });

  // Mark retasi as returned - atomic via RPC
  // Perhitungan HANYA di RPC (Single Source of Truth)
  const markRetasiReturned = useMutation({
    mutationFn: async ({ retasiId, ...returnData }: ReturnItemsData & { retasiId: string }): Promise<void> => {
      if (!currentBranch?.id) throw new Error('Branch ID is required');

      console.log('🏁 Processing Retasi Return via RPC...', retasiId);

      const hasItemDetails = returnData.item_returns && returnData.item_returns.length > 0;

      const { data: rpcResultRaw, error: rpcError } = await supabase
        .rpc('mark_retasi_returned_atomic', {
          p_branch_id: currentBranch.id,
          p_retasi_id: retasiId,
          p_return_notes: returnData.return_notes || '',
          p_item_returns: hasItemDetails
            ? returnData.item_returns!.map(ir => ({
              item_id: ir.item_id,
              returned_qty: ir.returned_quantity,
              sold_qty: ir.sold_quantity,
              error_qty: ir.error_quantity,
              unsold_qty: ir.unsold_quantity
            }))
            : [],
          // Untuk data lama tanpa item details, kirim manual totals
          p_manual_kembali: hasItemDetails ? null : returnData.returned_items_count,
          p_manual_laku: hasItemDetails ? null : returnData.barang_laku,
          p_manual_tidak_laku: hasItemDetails ? null : returnData.barang_tidak_laku,
          p_manual_error: hasItemDetails ? null : returnData.error_items_count,
        });

      if (rpcError) {
        console.error('❌ RPC Error:', rpcError);
        throw new Error(`Gagal memproses pengembalian retasi: ${rpcError.message}`);
      }

      const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;
      if (!rpcResult?.success) {
        throw new Error(rpcResult?.error_message || 'Gagal memproses pengembalian retasi');
      }

      console.log('✅ Retasi Return Success via RPC. Kembali:', rpcResult.returned_items_count, 'Laku:', rpcResult.barang_laku);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['retasi'] });
      queryClient.invalidateQueries({ queryKey: ['retasi-stats'] });
      queryClient.invalidateQueries({ queryKey: ['retasi-items'] });
      queryClient.invalidateQueries({ queryKey: ['active-retasi'] });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    }
  });

  // Update retasi (simple update - no stock changes)
  const updateRetasi = useMutation({
    mutationFn: async (data: { id: string } & Partial<CreateRetasiData>): Promise<Retasi> => {
      const { id, items, ...updateData } = data;

      // Update main retasi record
      const dbData: Record<string, any> = {};
      if (updateData.driver_name !== undefined) dbData.driver_name = updateData.driver_name;
      if (updateData.helper_name !== undefined) dbData.helper_name = updateData.helper_name;
      if (updateData.helper_id !== undefined) dbData.helper_id = updateData.helper_id;
      if (updateData.helper_name_2 !== undefined) dbData.helper_name_2 = updateData.helper_name_2;
      if (updateData.helper_id_2 !== undefined) dbData.helper_id_2 = updateData.helper_id_2;
      if (updateData.helper_name_3 !== undefined) dbData.helper_name_3 = updateData.helper_name_3;
      if (updateData.helper_id_3 !== undefined) dbData.helper_id_3 = updateData.helper_id_3;
      if (updateData.truck_number !== undefined) dbData.truck_number = updateData.truck_number;
      if (updateData.route !== undefined) dbData.route = updateData.route;
      if (updateData.departure_date !== undefined) {
        dbData.departure_date = updateData.departure_date instanceof Date
          ? updateData.departure_date.toISOString().split('T')[0]
          : updateData.departure_date;
      }
      if (updateData.departure_time !== undefined) dbData.departure_time = updateData.departure_time;
      if (updateData.notes !== undefined) dbData.notes = updateData.notes;

      const { data: updated, error } = await supabase
        .from('retasi')
        .update(dbData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return fromDb(updated);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['retasi'] });
      queryClient.invalidateQueries({ queryKey: ['retasi-stats'] });
    }
  });

  // Delete retasi
  const deleteRetasi = useMutation({
    mutationFn: async (retasiId: string): Promise<void> => {
      const { error } = await supabase
        .from('retasi')
        .delete()
        .eq('id', retasiId);

      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['retasi'] });
      queryClient.invalidateQueries({ queryKey: ['retasi-stats'] });
    }
  });

  // Get retasi items by retasi_id
  const getRetasiItems = async (retasiId: string): Promise<RetasiItem[]> => {
    const { data, error } = await supabase
      .from('retasi_items')
      .select('*')
      .eq('retasi_id', retasiId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching retasi items:', error);
      return [];
    }

    return data ? data.map(fromDbItem) : [];
  };

  return {
    retasiList,
    stats,
    isLoading,
    createRetasi,
    updateRetasi,
    markRetasiReturned,
    deleteRetasi,
    checkDriverAvailability,
    getRetasiItems,
    refetchRetasiList,
  };
};

// Hook to get retasi items for a specific retasi
export const useRetasiItems = (retasiId?: string) => {
  return useQuery<RetasiItem[]>({
    queryKey: ['retasi-items', retasiId],
    queryFn: async () => {
      if (!retasiId) return [];

      const { data, error } = await supabase
        .from('retasi_items')
        .select('*')
        .eq('retasi_id', retasiId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching retasi items:', error);
        return [];
      }

      return data ? data.map(fromDbItem) : [];
    },
    enabled: !!retasiId,
  });
};

// Interface for retasi transaction with items
export interface RetasiTransaction {
  id: string;
  transaction_number: string;
  customer_name: string;
  customer_phone?: string;
  total_amount: number;
  paid_amount: number;
  created_at: Date;
  items: {
    product_name: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
  }[];
}

// Hook to get transactions (sales) for a specific retasi
export const useRetasiTransactions = (retasiId?: string) => {
  return useQuery<RetasiTransaction[]>({
    queryKey: ['retasi-transactions', retasiId],
    queryFn: async () => {
      if (!retasiId) return [];

      // Column mapping: id=transaction_number, total=total_amount
      const { data, error } = await supabase
        .from('transactions')
        .select('id, customer_id, customer_name, total, paid_amount, items, created_at')
        .eq('retasi_id', retasiId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching retasi transactions:', error);
        return [];
      }

      // Get customer details for phone numbers
      const customerIds = [...new Set((data || []).map(t => t.customer_id).filter(Boolean))];
      let customersMap: Record<string, { phone?: string }> = {};
      if (customerIds.length > 0) {
        const { data: customers } = await supabase
          .from('customers')
          .select('id, phone')
          .in('id', customerIds);
        customersMap = (customers || []).reduce((acc, c) => {
          acc[c.id] = { phone: c.phone };
          return acc;
        }, {} as Record<string, { phone?: string }>);
      }

      return data ? data.map(tx => ({
        id: tx.id,
        transaction_number: tx.id,  // id is used as transaction number
        customer_name: tx.customer_name || 'Walk-in Customer',
        customer_phone: customersMap[tx.customer_id]?.phone,
        total_amount: tx.total || 0,  // 'total' not 'total_amount'
        paid_amount: tx.paid_amount || 0,
        created_at: new Date(tx.created_at),
        items: (tx.items || []).map((item: any) => ({
          product_name: item.productName || item.product_name || 'Unknown',
          quantity: item.quantity || 0,
          unit_price: item.unitPrice || item.unit_price || 0,
          subtotal: (item.quantity || 0) * (item.unitPrice || item.unit_price || 0),
        })),
      })) : [];
    },
    enabled: !!retasiId,
  });
};