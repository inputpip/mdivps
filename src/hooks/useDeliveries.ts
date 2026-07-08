import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Delivery, DeliveryInput, DeliveryItem, DeliveryUpdateInput, TransactionDeliveryInfo } from '@/types/delivery';
import { useToast } from '@/hooks/use-toast';
import { useBranch } from '@/contexts/BranchContext';
import { PhotoUploadService } from '@/services/photoUploadService';
import { format } from 'date-fns';

// Type for delivery employees
interface DeliveryEmployee {
  id: string;
  name: string;
  role: string;
}


const fromDbToDelivery = (dbData: any): Delivery => {
  // Helper to calculate ordered and remaining quantity if transaction data is available
  const getTransactionItemInfo = (productId: string, isBonus: boolean) => {
    if (!dbData.transactions?.items || !Array.isArray(dbData.transactions.items)) {
      return { ordered: 0, remaining: 0 };
    }

    // Find ordered quantity from transaction items
    const txnItems = dbData.transactions.items;
    const txnItem = txnItems.find((ti: any) => {
      const pId = ti.product_id || ti.productId || ti.product?.id;
      // Check bonus status match
      const tiIsBonus = ti.is_bonus || ti.isBonus ||
        (ti.product_name || '').toLowerCase().includes('bonus') ||
        (ti.product_name || '').toLowerCase().includes('free');

      return pId === productId && !!tiIsBonus === !!isBonus;
    });

    const ordered = Number(txnItem?.quantity || txnItem?.orderedQuantity || 0);

    // Calculate total delivered from all deliveries if available (for remaining quantity)
    let totalDelivered = 0;
    if (dbData.transactions.deliveries && Array.isArray(dbData.transactions.deliveries)) {
      dbData.transactions.deliveries.forEach((d: any) => {
        if (d.delivery_items && Array.isArray(d.delivery_items)) {
          d.delivery_items.forEach((di: any) => {
            if (di.product_id === productId && !!di.is_bonus === !!isBonus) {
              totalDelivered += Number(di.quantity_delivered || 0);
            }
          });
        }
      });
    }

    const remaining = Math.max(0, ordered - totalDelivered);

    return { ordered, remaining };
  };

  return {
    id: dbData.id,
    transactionId: dbData.transaction_id,
    deliveryNumber: dbData.delivery_number,
    customerName: dbData.customer_name,
    customerAddress: dbData.customer_address || dbData.transactions?.customer?.address, // Try to find address in joined transaction if missing in delivery
    customerPhone: dbData.customer_phone,
    driverId: dbData.driver_id,
    driverName: dbData.driver?.full_name || dbData.driver_name || dbData.driverName, // Map from joined profile
    helperId: dbData.helper_id,
    helperName: dbData.helper?.full_name || dbData.helper_name || dbData.helperName, // Map from joined profile
    helperId2: dbData.helper_id_2,
    helperName2: dbData.helper2?.full_name || dbData.helper_name_2 || dbData.helperName2,
    helperId3: dbData.helper_id_3,
    helperName3: dbData.helper3?.full_name || dbData.helper_name_3 || dbData.helperName3,
    deliveryDate: new Date(dbData.delivery_date),
    status: dbData.status,
    photoUrl: dbData.photo_url,
    notes: dbData.notes,
    transactionTotal: dbData.transactions?.total || 0, // Map total from joined transaction
    cashierName: dbData.transactions?.cashier_name, // Map cashier name
    transactionIsCancelled: dbData.transactions?.is_cancelled || false,
    transactionIsVoided: dbData.transactions?.is_voided || false,
    createdAt: new Date(dbData.created_at),
    updatedAt: dbData.updated_at ? new Date(dbData.updated_at) : new Date(dbData.created_at),
    items: dbData.delivery_items?.map((item: any) => {
      const { ordered, remaining } = getTransactionItemInfo(item.product_id, item.is_bonus);
      return {
        id: item.id,
        productId: item.product_id,
        productName: item.product_name,
        quantityDelivered: Number(item.quantity_delivered),
        unit: item.unit,
        isBonus: item.is_bonus,
        width: item.width,
        height: item.height,
        notes: item.notes,
        orderedQuantity: ordered > 0 ? ordered : undefined,
        remainingQuantity: dbData.transactions?.deliveries ? remaining : undefined,
      };
    }) || [],
  };
};

export const useDeliveries = (transactionId?: string) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { currentBranch } = useBranch();

  const { data: deliveries, isLoading } = useQuery<Delivery[]>({
    queryKey: ['deliveries', transactionId, currentBranch?.id],
    queryFn: async () => {
      let query = supabase
        .from('deliveries')
        // Join transactions for total, and profiles for driver/helper names
        // Note: Assuming FKs are properly set up. If not, names might still be missing.
        .select(`
          *,
          delivery_items(*),
          transactions(
            total, 
            cashier_name,
            customer:customer_id(address)
          ),
          driver:driver_id(full_name),
          helper:helper_id(full_name),
          helper2:helper_id_2(full_name),
          helper3:helper_id_3(full_name)
        `);

      if (transactionId) {
        query = query.eq('transaction_id', transactionId);
      }

      if (currentBranch?.id) {
        query = query.eq('branch_id', currentBranch.id);
      }

      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(fromDbToDelivery);
    },
    enabled: !!currentBranch,
  });

  const createDelivery = useMutation({
    mutationFn: async (input: DeliveryInput) => {
      if (!currentBranch?.id) throw new Error('Branch tidak dipilih');

      // 1. Upload Photo if present
      let finalPhotoUrl = input.photoUrl;

      if (input.photo) {
        try {
          // Use a descriptive name for the file
          const customerName = input.customerName || 'UMUM';
          const tanggal = format(new Date(), 'yyyyMMdd_HHmmss');
          const referenceName = `DR-${input.transactionId.substring(0, 8)} - ${customerName} - ${tanggal}`;
          const uploadResult = await PhotoUploadService.uploadPhoto(
            input.photo,
            referenceName,
            'deliveries',
            true
          );

          finalPhotoUrl = uploadResult.webViewLink;
          console.log('[useDeliveries] Photo uploaded successfully:', finalPhotoUrl);
        } catch (uploadError) {
          console.error('[useDeliveries] Photo upload failed:', uploadError);
          // Optional: decide whether to throw error or proceed without photo
          // For now, we'll throw to ensure data integrity per user requirement "Foto pengantaran wajib"
          throw new Error('Gagal mengupload foto pengantaran: ' + (uploadError as Error).message);
        }
      }

      // Filter out material items - materials are sold directly and don't go through delivery
      // Materials are processed at transaction time: record revenue + consume raw material stock
      // Detection: product_id starts with 'material-' OR product name contains '(Bahan)'
      const isMaterialItem = (item: { productId: string; productName?: string }) =>
        item.productId?.startsWith('material-') ||
        (item.productName || '').toLowerCase().includes('(bahan)');
      const nonMaterialItems = input.items.filter(item => !isMaterialItem(item));

      if (nonMaterialItems.length === 0 && input.items.length > 0) {
        throw new Error('Item ini adalah material/bahan. Material langsung dijual tanpa pengantaran.');
      }

      const { data, error } = await supabase.rpc('process_delivery_atomic', {
        p_transaction_id: input.transactionId,
        p_branch_id: currentBranch.id,
        p_items: nonMaterialItems.map(item => ({
          product_id: item.productId,
          quantity: item.quantityDelivered,
          is_bonus: item.isBonus,
          notes: item.notes,
          width: item.width,
          height: item.height,
          unit: item.unit,
          product_name: item.productName
        })),
        p_driver_id: input.driverId || null,  // Empty string -> null for UUID
        p_helper_id: input.helperId || null,  // Empty string -> null for UUID
        p_helper_id_2: input.helperId2 || null,
        p_helper_id_3: input.helperId3 || null,
        p_delivery_date: input.deliveryDate.toISOString(),
        p_notes: input.notes,
        p_photo_url: finalPhotoUrl
      });

      if (error) throw error;
      const res = Array.isArray(data) ? data[0] : data;
      if (!res?.success) throw new Error(res?.error_message || 'Gagal membuat pengiriman');
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
      queryClient.invalidateQueries({ queryKey: ['commissionEntries'] });
      queryClient.invalidateQueries({ queryKey: ['transactionsReadyForDelivery'] });
      toast({ title: 'Sukses', description: 'Pengiriman berhasil diproses' });
    },
  });

  const createDeliveryNoStock = useMutation({
    mutationFn: async (input: DeliveryInput) => {
      if (!currentBranch?.id) throw new Error('Branch tidak dipilih');

      // Filter out material items - materials are sold directly and don't go through delivery
      // Materials are processed at transaction time: record revenue + consume raw material stock
      const isMaterialItem = (item: { productId: string; productName?: string }) =>
        item.productId?.startsWith('material-') ||
        (item.productName || '').toLowerCase().includes('(bahan)');
      const nonMaterialItems = input.items.filter(item => !isMaterialItem(item));

      if (nonMaterialItems.length === 0 && input.items.length > 0) {
        throw new Error('Item ini adalah material/bahan. Material langsung dijual tanpa pengantaran.');
      }

      const { data, error } = await supabase.rpc('process_delivery_atomic_no_stock', {
        p_transaction_id: input.transactionId,
        p_branch_id: currentBranch.id,
        p_items: nonMaterialItems.map(item => ({
          product_id: item.productId,
          quantity: item.quantityDelivered,
          is_bonus: item.isBonus,
          notes: item.notes,
          width: item.width,
          height: item.height,
          unit: item.unit,
          product_name: item.productName
        })),
        p_driver_id: input.driverId || null,  // Empty string -> null for UUID
        p_helper_id: input.helperId || null,  // Empty string -> null for UUID
        p_helper_id_2: input.helperId2 || null,
        p_helper_id_3: input.helperId3 || null,
        p_delivery_date: input.deliveryDate.toISOString(),
        p_notes: input.notes,
        p_photo_url: input.photoUrl
      });

      if (error) throw error;
      const res = Array.isArray(data) ? data[0] : data;
      if (!res?.success) throw new Error(res?.error_message || 'Gagal membuat pengiriman (Migrasi)');
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      // No invalidation for products/journals/commissions needed as they weren't touched
      queryClient.invalidateQueries({ queryKey: ['transactionsReadyForDelivery'] });
      toast({ title: 'Sukses', description: 'Pengiriman migrasi berhasil dicatat' });
    },
  });

  const updateDelivery = useMutation({
    mutationFn: async (input: DeliveryUpdateInput) => {
      if (!currentBranch?.id) throw new Error('Branch tidak dipilih');

      // Filter out material items - materials are sold directly and don't go through delivery
      // Materials are processed at transaction time: record revenue + consume raw material stock
      const isMaterialItem = (item: { productId: string; productName?: string }) =>
        item.productId?.startsWith('material-') ||
        (item.productName || '').toLowerCase().includes('(bahan)');
      const nonMaterialItems = input.items.filter(item => !isMaterialItem(item));

      if (nonMaterialItems.length === 0 && input.items.length > 0) {
        throw new Error('Item ini adalah material/bahan. Material langsung dijual tanpa pengantaran.');
      }

      const { data, error } = await supabase.rpc('update_delivery_atomic', {
        p_delivery_id: input.id,
        p_branch_id: currentBranch.id,
        p_items: nonMaterialItems.map(item => ({
          product_id: item.productId,
          quantity: item.quantityDelivered,
          is_bonus: item.isBonus,
          notes: item.notes,
          width: item.width,
          height: item.height,
          unit: item.unit,
          product_name: item.productName
        })),
        p_driver_id: input.driverId || null,  // Empty string -> null for UUID
        p_helper_id: input.helperId || null,  // Empty string -> null for UUID
        p_helper_id_2: input.helperId2 || null,
        p_helper_id_3: input.helperId3 || null,
        p_delivery_date: input.deliveryDate ? input.deliveryDate.toISOString() : new Date().toISOString(),
        p_notes: input.notes,
        p_photo_url: input.photoUrl
      });

      if (error) throw error;
      const res = Array.isArray(data) ? data[0] : data;
      if (!res?.success) throw new Error(res?.error_message || 'Gagal mengupdate pengiriman');
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
      queryClient.invalidateQueries({ queryKey: ['commissionEntries'] });
      queryClient.invalidateQueries({ queryKey: ['transactionsReadyForDelivery'] });
      toast({ title: 'Sukses', description: 'Pengiriman berhasil diupdate' });
    },
  });

  const deleteDelivery = useMutation({
    mutationFn: async (id: string) => {
      if (!currentBranch?.id) throw new Error('Branch tidak dipilih');

      // Fetch the delivery's photo_url before we delete the record
      const { data: deliveryData } = await supabase
        .from('deliveries')
        .select('photo_url')
        .eq('id', id)
        .single();

      const photoUrlToDelete = deliveryData?.photo_url;

      const { data, error } = await supabase.rpc('void_delivery_atomic', {
        p_delivery_id: id,
        p_branch_id: currentBranch.id,
        p_reason: 'Delivery deleted by user'
      });

      if (error) throw error;
      const res = Array.isArray(data) ? data[0] : data;
      if (!res?.success) throw new Error(res?.error_message || 'Gagal membatalkan pengiriman');

      // Finally delete the record if RPC success (void_delivery_atomic in 07_void.sql doesn't delete the record)
      const { error: deleteError } = await supabase.from('deliveries').delete().eq('id', id);
      if (deleteError) throw deleteError;

      // Actually delete the physical delivery photo from the VPS
      if (photoUrlToDelete) {
        try {
          const filename = photoUrlToDelete.split('/').pop();
          // EXTRA SAFETY CHECK: Pastikan filename valid, bukan string kosong, dan minimal 5 karakter (eg. abc.jpg)
          if (filename && filename.trim().length > 5 && !filename.includes('/') && filename.includes('.')) {
            await PhotoUploadService.deletePhoto(filename, 'deliveries');
            console.log(`[deleteDelivery] Deleted physical photo: ${filename}`);
          }
        } catch (e) {
          console.error(`[deleteDelivery] Failed to delete photo ${photoUrlToDelete}:`, e);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
      queryClient.invalidateQueries({ queryKey: ['commissionEntries'] });
      queryClient.invalidateQueries({ queryKey: ['transactionsReadyForDelivery'] });
      toast({ title: 'Sukses', description: 'Pengiriman berhasil dihapus & stok dikembalikan' });
    },
  });

  return { deliveries, isLoading, createDelivery, createDeliveryNoStock, updateDelivery, deleteDelivery };
};

// Hook to get employees that can do delivery (drivers and helpers)
export const useDeliveryEmployees = () => {
  const { currentBranch } = useBranch();

  return useQuery<DeliveryEmployee[]>({
    queryKey: ['deliveryEmployees', currentBranch?.id],
    queryFn: async () => {
      // Use profiles table (localhost) - employees table is only on production
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('branch_id', currentBranch?.id)
        .in('role', ['supir', 'helper', 'driver', 'kernet'])
        .eq('status', 'Aktif');

      if (error) throw error;
      // Map full_name to name for compatibility
      return (data || []).map(emp => ({
        id: emp.id,
        name: emp.full_name || '',
        role: emp.role || ''
      }));
    },
    enabled: !!currentBranch,
  });
};

// Hook to get delivery history
export const useDeliveryHistory = () => {
  const { currentBranch } = useBranch();

  return useQuery<Delivery[]>({
    queryKey: ['deliveryHistory', currentBranch?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deliveries')
        .select(`
          *,
          delivery_items(*),
          transactions(
            total,
            items,
            cashier_name,
            is_cancelled,
            is_voided,
            customer:customer_id(address)
          ),
          driver:driver_id(full_name),
          helper:helper_id(full_name),
          helper2:helper_id_2(full_name),
          helper3:helper_id_3(full_name)
        `)
        .eq('branch_id', currentBranch?.id)
        .neq('status', 'cancelled') // Exclude cancelled deliveries at DB level
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Also filter out deliveries tied to cancelled/voided transactions
      const validDeliveries = (data || []).filter(d => {
        const txn = d.transactions;
        if (!txn) return true; // keep if no transaction found
        // if transaction is an Array (unlikely since relations are one-to-one or many-to-one, but just in case)
        if (Array.isArray(txn)) {
           return !txn.some(t => t.is_cancelled || t.is_voided);
        }
        return !txn.is_cancelled && !txn.is_voided;
      });

      return validDeliveries.map(fromDbToDelivery);
    },
    enabled: !!currentBranch,
  });
};

// Hook to get transactions ready for delivery
export const useTransactionsReadyForDelivery = () => {
  const { currentBranch } = useBranch();

  return useQuery<TransactionDeliveryInfo[]>({
    queryKey: ['transactionsReadyForDelivery', currentBranch?.id],
    queryFn: async () => {
      // Get transactions that have items not fully delivered
      // Filter transactions that are NOT delivered/completed (case-insensitive)
      // We use 'in' filter for pending statuses instead of 'neq' for delivered
      const { data, error } = await supabase
        .from('transactions')
        .select(`
          id,
          customer_id,
          customer_name,
          total,
          order_date,
          status,
          delivery_status,
          cashier_id,
          cashier_name,
          items,
          deliveries (
            *,
            delivery_items (*)
          )
        `)
        .eq('branch_id', currentBranch?.id)
        .neq('status', 'Dibatalkan')
        .eq('is_voided', false)
        .eq('is_cancelled', false)
        .order('order_date', { ascending: false });

      // DEBUG: Log all transactions before filtering
      /*
      console.log('🔍 All transactions fetched:', {
        total: data?.length || 0,
        transactions: data?.map(t => ({
          id: t.id,
          status: t.status,
          itemsCount: Array.isArray(t.items) ? t.items.length : 0
        }))
      });
      */

      // Filter based on status column only
      // Show in delivery list: "Pesanan Masuk" and "Diantar Sebagian"
      // Hide from delivery list: "Selesai" (goes to history) and "Dibatalkan"
      const filteredData = (data || []).filter(txn => {
        const txnStatus = (txn.status || '').trim();

        // Only show transactions with status "Pesanan Masuk" or "Diantar Sebagian"
        // AND delivery_status is NOT "Completed" (to exclude Laku Kantor/Self Pickup)
        const deliveryStatus = (txn.delivery_status || '').trim();
        return (txnStatus === 'Pesanan Masuk' || txnStatus === 'Diantar Sebagian') && deliveryStatus !== 'Completed';
      });

      /*
      console.log('✅ Filtered transactions:', {
        total: filteredData.length,
        transactions: filteredData.map(t => ({
          id: t.id,
          customer: t.customer_name,
          status: t.status,
          itemsCount: Array.isArray(t.items) ? t.items.length : 0
        }))
      });
      */

      if (error) throw error;

      // Get customer details for addresses/phones
      const customerIds = [...new Set(filteredData.map(t => t.customer_id).filter(Boolean))];
      let customersMap: Record<string, { address?: string; phone?: string }> = {};
      if (customerIds.length > 0) {
        const { data: customers } = await supabase
          .from('customers')
          .select('id, address, phone')
          .in('id', customerIds);
        customersMap = (customers || []).reduce((acc, c) => {
          acc[c.id] = { address: c.address, phone: c.phone };
          return acc;
        }, {} as Record<string, { address?: string; phone?: string }>);
      }

      return filteredData.map(txn => {
        // DEBUG: Log transaction items before mapping
        /*
        console.log('📦 Processing transaction:', {
          id: txn.id,
          customer: txn.customer_name,
          items: Array.isArray(txn.items) ? txn.items : 'NOT AN ARRAY',
          itemsCount: Array.isArray(txn.items) ? txn.items.length : 0
        });
        */

        // Map deliveries (sorted by date ascending for correct logic)
        const deliveries = (txn.deliveries || []).map(fromDbToDelivery)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

        // Calculate delivery summary
        // console.log('📦 Deliveries found:', deliveries.length);
        const deliverySummary = (Array.isArray(txn.items) ? txn.items : [])
          .map((item: any) => {
            // Skip metadata items explicitly
            if (item._isSalesMeta || item._isMigrationMeta) return null;

            // Skip material/bahan items - they are sold directly and don't go through delivery
            const itemProductId = item.product_id || item.productId || item.product?.id || '';
            const itemProductName = item.product_name || item.productName || item.product?.name || '';
            if (itemProductId.startsWith('material-') || itemProductName.toLowerCase().includes('(bahan)')) {
              return null;
            }

            const productId = item.product_id || item.productId || item.product?.id;
            const productName = item.product_name || item.productName || item.product?.name || '';
            const orderedQty = Number(item.quantity || item.orderedQuantity || 0);

            // Skip invalid items that would cause "Unknown Product" or "NaN"
            if (!productName || productName === 'Unknown Product') {
              console.warn('⚠️ Skipping invalid product:', {
                productId: productId,
                productName: productName
              });
              return null;
            }
            // Only skip items with quantity <= 0 if they're NOT bonus items
            // Bonus items can have 0 ordered quantity
            const isBonusName = productName.toLowerCase().includes('bonus') || productName.toLowerCase().includes('free');
            if (orderedQty <= 0 && !isBonusName) {
              console.warn('⚠️ Skipping item with non-positive quantity:', {
                productId: productId,
                productName: productName,
                orderedQty: orderedQty,
                isBonus: isBonusName
              });
              return null;
            }

            // Better bonus detection
            const isBonus = item.is_bonus || item.isBonus ||
              productName.toLowerCase().includes('bonus') ||
              productName.toLowerCase().includes('free');

            // Calculate total delivered for this specific item
            // STricter matching: must match ID AND basic name type (bonus vs non-bonus)
            const totalDelivered = deliveries.reduce((sum, d) => {
              // Find matching delivery items (could be multiple in one delivery)
              const matchedItems = d.items.filter(di => {
                const isIdMatch = di.productId === productId;
                const diName = (di.productName || '').toLowerCase();
                const targetIsBonus = isBonus;
                const diIsBonus = di.isBonus || diName.includes('bonus') || diName.includes('free');

                // Must match Product ID AND Bonus Status
                return isIdMatch && (diIsBonus === targetIsBonus);
              });

              const subtotal = matchedItems.reduce((s, di) => s + (Number(di.quantityDelivered) || 0), 0);
              return sum + subtotal;
            }, 0);

            return {
              productId: productId,
              productName: productName,
              orderedQuantity: orderedQty,
              deliveredQuantity: totalDelivered,
              remainingQuantity: orderedQty - totalDelivered,
              unit: item.unit || 'karton',
              isBonus: isBonus,
              width: item.width,
              height: item.height,
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null); // Remove skipped items

        // DEBUG: Log delivery summary
        /*
        console.log('📋 Delivery Summary:', {
          transactionId: txn.id,
          totalItems: deliverySummary.length,
          items: deliverySummary.map(i => ({
            name: i.productName,
            ordered: i.orderedQuantity,
            delivered: i.deliveredQuantity,
            remaining: i.remainingQuantity
          }))
        });
        */

        return {
          id: txn.id,
          orderNumber: txn.id,
          customerName: txn.customer_name,
          customerAddress: customersMap[txn.customer_id]?.address || '',
          customerPhone: customersMap[txn.customer_id]?.phone || '',
          totalAmount: txn.total,
          total: txn.total,
          orderDate: new Date(txn.order_date),
          status: txn.status,
          cashierName: txn.cashier_name,
          deliveries,
          deliverySummary,
        };
      });
    },
    enabled: !!currentBranch,
  });
};

// Hook to get delivery info for a specific transaction
// Hook to get delivery info for a specific transaction
export const useTransactionDeliveryInfo = (transactionId: string, options?: { enabled?: boolean }) => {
  const { currentBranch } = useBranch();

  return useQuery<TransactionDeliveryInfo | null>({
    queryKey: ['transactionDeliveryInfo', transactionId, currentBranch?.id],
    queryFn: async () => {
      // Return null if explicitly disabled (though enabled flag should handle this, this is extra safety)
      if (options?.enabled === false) return null;
      if (!transactionId) return null;

      // 1. Fetch Transaction Details
      const { data: txn, error: txnError } = await supabase
        .from('transactions')
        .select(`
          id,
          customer_id,
          customer_name,
          total,
          order_date,
          status,
          delivery_status,
          items
        `)
        .eq('id', transactionId)
        .eq('branch_id', currentBranch?.id)
        .eq('is_voided', false)
        .eq('is_cancelled', false)
        .single();

      if (txnError) {
        if (txnError.code === 'PGRST116') return null; // Not found
        throw txnError;
      }

      if (!txn) return null;

      // 2. Fetch Deliveries Manually
      // Fetching separately avoids potential Foreign Key relationship detection issues in Supabase/PostgREST
      const { data: deliveriesData, error: delError } = await supabase
        .from('deliveries')
        .select(`
          *,
          delivery_items(*),
          transactions(
            total,
            cashier_name,
            customer:customer_id(address)
          ),
          driver:driver_id(full_name),
          helper:helper_id(full_name),
          helper2:helper_id_2(full_name),
          helper3:helper_id_3(full_name)
        `)
        .eq('transaction_id', transactionId)
        .eq('branch_id', currentBranch?.id)
        .order('created_at', { ascending: false });

      if (delError) throw delError;

      if (delError) throw delError;

      // console.log('📦 Manual Delivery Fetch:', {
      //   txnId: transactionId,
      //   deliveriesFound: deliveriesData?.length,
      //   deliveries: deliveriesData
      // });

      // Prepare data for mapping
      // Inject transaction total into deliveries for fromDbToDelivery to use
      const enhancedDeliveries = (deliveriesData || []).map(d => ({
        ...d,
        transactions: { total: txn.total }
      }));

      // Get customer details
      let customerAddress = '';
      let customerPhone = '';
      if (txn.customer_id) {
        const { data: customer } = await supabase
          .from('customers')
          .select('address, phone')
          .eq('id', txn.customer_id)
          .single();
        if (customer) {
          customerAddress = customer.address || '';
          customerPhone = customer.phone || '';
        }
      }

      // Map deliveries
      const deliveries = enhancedDeliveries.map(fromDbToDelivery)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      // DEBUG: Log transaction items structure
      /*
      console.log('📦 Transaction items for delivery summary:', {
        transactionId: transactionId,
        itemsType: typeof txn.items,
        itemsIsArray: Array.isArray(txn.items),
        items: Array.isArray(txn.items) ? txn.items : txn.items,
        firstItem: Array.isArray(txn.items) && txn.items[0] ? txn.items[0] : 'N/A'
      });
      */

      // DEBUG: Log deliveries structure
      /*
      console.log('📦 Deliveries for delivery summary:', {
        transactionId: transactionId,
        deliveriesCount: deliveries.length,
        deliveries: deliveries.map(d => ({
          deliveryId: d.id,
          itemsCount: d.items.length,
          items: d.items.map(di => ({
            productId: di.productId,
            productName: di.productName,
            quantityDelivered: di.quantityDelivered
          }))
        }))
      });
      */

      // Calculate delivery summary
      const deliverySummary = (Array.isArray(txn.items) ? txn.items : []).map((item: any) => {
        // Skip metadata items explicitly
        if (item._isSalesMeta || item._isMigrationMeta) return null;

        // Skip material/bahan items - they are sold directly and don't go through delivery
        const itemProductId = item.product_id || item.productId || item.product?.id || '';
        const itemProductName = item.product_name || item.productName || item.product?.name || '';
        if (itemProductId.startsWith('material-') || itemProductName.toLowerCase().includes('(bahan)')) {
          return null;
        }

        const productId = item.product_id || item.productId || item.product?.id;
        const productName = item.product_name || item.productName || item.product?.name || 'Unknown Product';
        const orderedQty = item.quantity;

        /*
        console.log('📦 Processing item:', {
          productId,
          productName,
          orderedQty,
          productIdTypes: {
            product_id: item.product_id,
            productId: item.productId,
            product_id_nested: item.product?.id
          }
        });
        */

        const isBonus = item.is_bonus || item.isBonus ||
          productName.toLowerCase().includes('bonus') ||
          productName.toLowerCase().includes('free');

        // Calculate total delivered for this item across all deliveries
        const totalDelivered = deliveries.reduce((sum: number, d: Delivery) => {
          // Find matching delivery items (could be multiple in one delivery)
          const matchedItems = d.items.filter(di => {
            const diId = di.productId || di.product_id;
            const diName = (di.productName || '').toLowerCase();
            const diIsBonus = di.isBonus || diName.includes('bonus') || diName.includes('free');

            return diId === productId && !!diIsBonus === !!isBonus;
          });

          const subtotal = matchedItems.reduce((s, di) => s + (Number(di.quantityDelivered) || 0), 0);
          return sum + subtotal;
        }, 0);

        return {
          productId: productId,
          productName: productName,
          orderedQuantity: orderedQty,
          deliveredQuantity: totalDelivered,
          remainingQuantity: orderedQty - totalDelivered,
          unit: item.unit,
          isBonus: item.is_bonus || item.isBonus,
          width: item.width,
          height: item.height,
        };
      });

      console.log('📋 Final delivery summary:', {
        transactionId: transactionId,
        totalItems: deliverySummary.length,
        items: deliverySummary.map(i => ({
          name: i.productName,
          ordered: i.orderedQuantity,
          delivered: i.deliveredQuantity,
          remaining: i.remainingQuantity
        }))
      });

      return {
        id: txn.id,
        orderNumber: txn.id,  // id is used as order number
        customerName: txn.customer_name,
        customerAddress,
        customerPhone,
        totalAmount: txn.total,
        total: txn.total,
        orderDate: new Date(txn.order_date),
        status: txn.status,
        deliveries,
        deliverySummary,
      };
    },
    enabled: !!transactionId && !!currentBranch && (options?.enabled ?? true),
  });
};
