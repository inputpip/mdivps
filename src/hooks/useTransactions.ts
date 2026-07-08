import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Transaction } from '@/types/transaction'
import { supabase } from '@/integrations/supabase/client'
import { useExpenses } from './useExpenses'
import { useBranch } from '@/contexts/BranchContext'
import { useTimezone } from '@/contexts/TimezoneContext'
import { useAuth } from '@/hooks/useAuth'
import { getOfficeDateString } from '@/utils/officeTime'
import { findAccountByLookup, AccountLookupType } from '@/services/accountLookupService'
import { Account } from '@/types/account'
import { markAsVisitedAsync } from '@/utils/customerVisitUtils'
import { useCompanySettings } from '@/hooks/useCompanySettings'
import { isFeatureEnabled } from '@/config/featureSettings'

// ============================================================================
// FULL RPC IMPLEMENTATION
// Semua logika bisnis (Stok, Jurnal, Komisi) dipindah ke Database RPC
// Frontend hanya bertugas memanggil RPC dan handle response
// ============================================================================

// Helper to map DB account to App account format
const fromDbToAppAccount = (dbAccount: any): Account => ({
  id: dbAccount.id,
  name: dbAccount.name,
  type: dbAccount.type,
  balance: Number(dbAccount.balance) || 0,
  initialBalance: Number(dbAccount.initial_balance) || 0,
  isPaymentAccount: dbAccount.is_payment_account,
  createdAt: new Date(dbAccount.created_at),
  code: dbAccount.code || undefined,
  parentId: dbAccount.parent_id || undefined,
  level: dbAccount.level || 1,
  normalBalance: dbAccount.normal_balance || 'DEBIT',
  isHeader: dbAccount.is_header || false,
  isActive: dbAccount.is_active !== false,
  sortOrder: dbAccount.sort_order || 0,
  branchId: dbAccount.branch_id || undefined,
});

// Helper to extract sales info from items array
const extractSalesFromItems = (items: any[]) => {
  if (!Array.isArray(items)) {
    return { salesId: null, salesName: null, cleanItems: items || [] };
  }

  // Check if first element is sales metadata
  const firstItem = items[0];
  if (firstItem && firstItem._isSalesMeta) {
    const { salesId, salesName } = firstItem;
    const cleanItems = items.slice(1); // Remove metadata item
    return { salesId, salesName, cleanItems };
  }

  return { salesId: null, salesName: null, cleanItems: items };
};

// Helper to map from DB (snake_case) to App (camelCase)
const fromDb = (dbTransaction: any): Transaction => {
  const salesInfo = extractSalesFromItems(dbTransaction.items);

  // Fix: Ensure items have the 'product' object structure expected by UI components
  const formattedItems = (salesInfo.cleanItems || []).map((item: any) => {
    // If item already has product object, keep it. Otherwise construct it from flat fields.
    if (item.product) return item;

    return {
      ...item,
      product: {
        id: item.productId || item.product_id,
        name: item.productName || item.product_name || 'Unknown Item',
        price: item.price, // Fallback if needed
        costPrice: item.costPrice || item.cost_price || 0
      }
    };
  });

  return {
    id: dbTransaction.id,
    customerId: dbTransaction.customer_id,
    customerName: dbTransaction.customer_name,
    customerAddress: dbTransaction.customer?.address,
    customerPhone: dbTransaction.customer?.phone,
    customerClassification: dbTransaction.customer?.classification || undefined,
    cashierId: dbTransaction.cashier_id,
    cashierName: dbTransaction.cashier_name,
    salesId: dbTransaction.sales_id || salesInfo.salesId,
    salesName: dbTransaction.sales_name || salesInfo.salesName,
    designerId: dbTransaction.designer_id || null,
    operatorId: dbTransaction.operator_id || null,
    paymentAccountId: dbTransaction.payment_account_id || null,
    paymentAccountName: dbTransaction.payment_account?.name || null, // Mapped from join
    orderDate: new Date(dbTransaction.order_date),
    finishDate: dbTransaction.finish_date ? new Date(dbTransaction.finish_date) : null,
    items: formattedItems,
    subtotal: dbTransaction.subtotal || dbTransaction.total || 0,
    ppnEnabled: dbTransaction.ppn_enabled ?? false,
    ppnMode: dbTransaction.ppn_mode || 'exclude',
    ppnPercentage: dbTransaction.ppn_percentage ?? 11,
    ppnAmount: dbTransaction.ppn_amount ?? 0,
    total: dbTransaction.total,
    paidAmount: dbTransaction.paid_amount || 0,
    paymentStatus: dbTransaction.payment_status,
    status: dbTransaction.status,
    notes: null, // Notes column not available/mapped from DB usually
    isOfficeSale: dbTransaction.is_office_sale ?? false,
    dueDate: dbTransaction.due_date ? new Date(dbTransaction.due_date) : null,
    createdAt: new Date(dbTransaction.created_at),
  };
};

const transactionSelectFields = `
  *,
  customer:customers(classification, address, phone),
  payment_account:payment_account_id(name)
`;


export const useTransactions = (filters?: {
  status?: string;
  payment_status?: string;
  customer_id?: string;
  date_from?: string;
  date_to?: string;
}) => {
  const queryClient = useQueryClient()
  const { currentBranch } = useBranch()
  const { timezone } = useTimezone()
  const { user } = useAuth()
  const { settings } = useCompanySettings()
  const isDeliveryEnabled = isFeatureEnabled(settings?.appFeatureSettings, 'delivery')

  const { data: transactions, isLoading } = useQuery<Transaction[]>({
    queryKey: ['transactions', filters, currentBranch?.id],
    queryFn: async () => {
      // Join dengan customers untuk mendapatkan classification DAN address
      // Join dengan accounts untuk mendapatkan nama akun pembayaran
      let query = supabase
        .from('transactions')
        .select(transactionSelectFields)
        .eq('is_voided', false)  // Only show non-voided transactions
        .eq('is_cancelled', false) // Only show non-cancelled transactions
        .order('created_at', { ascending: false });

      // Apply branch filter - ALWAYS filter by selected branch
      if (currentBranch?.id) {
        query = query.eq('branch_id', currentBranch.id);
      }

      // Apply other filters
      if (filters?.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }
      if (filters?.payment_status && filters.payment_status !== 'all') {
        query = query.eq('payment_status', filters.payment_status);
      }
      if (filters?.customer_id) {
        query = query.eq('customer_id', filters.customer_id);
      }
      if (filters?.date_from) {
        query = query.gte('order_date', filters.date_from);
      }
      if (filters?.date_to) {
        query = query.lte('order_date', filters.date_to);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data ? data.map(fromDb) : [];
    },
    enabled: !!currentBranch,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  // 1. CREATE TRANSACTION (FULL RPC)
  const addTransaction = useMutation({
    mutationFn: async ({ newTransaction, quotationId }: { newTransaction: Omit<Transaction, 'createdAt'>, quotationId?: string | null }): Promise<Transaction> => {
      if (!currentBranch?.id) throw new Error('Branch ID is required');

      console.log('🚀 Creating Transaction via Atomic RPC...', {
        id: newTransaction.id,
        items: newTransaction.items.length
      });

      // Memastikan penjualan bahan baku (material) otomatis menjadi Laku Kantor walau tidak dicentang.
      // Jika fitur Pengantaran OFF, semua transaksi baru juga dipaksa Laku Kantor
      // sebagai guard pusat meskipun form pemanggil lupa mengirim flag isOfficeSale.
      const hasMaterialItem = newTransaction.items.some((item: any) =>
        item.product?._isMaterial || item.product?.type === 'material' || item.productId?.startsWith('material-')
      );
      const effectiveIsOfficeSale = !isDeliveryEnabled || hasMaterialItem || (newTransaction.isOfficeSale || false);

      // Prepare Transaction Data (Snake Case for RPC)
      const transactionData = {
        id: newTransaction.id,
        customer_id: newTransaction.customerId,
        customer_name: newTransaction.customerName,
        total: newTransaction.total,
        paid_amount: newTransaction.paidAmount || 0,
        payment_method: newTransaction.paymentMethod || 'Tunai',
        payment_account_id: newTransaction.paymentAccountId || null,
        is_office_sale: effectiveIsOfficeSale,
        date: newTransaction.orderDate instanceof Date
          ? newTransaction.orderDate.toISOString()
          : newTransaction.orderDate,
        notes: newTransaction.notes || null,
        sales_id: newTransaction.salesId || null,
        sales_name: newTransaction.salesName || null,
        retasi_id: newTransaction.retasiId || null,
        retasi_number: newTransaction.retasiNumber || null,
        due_date: newTransaction.dueDate instanceof Date
          ? newTransaction.dueDate.toISOString()
          : newTransaction.dueDate || null,
        subtotal: newTransaction.subtotal || newTransaction.total,
        ppn_enabled: newTransaction.ppnEnabled || false,
        ppn_mode: newTransaction.ppnMode || 'exclude',
        ppn_percentage: newTransaction.ppnPercentage || 0,
        ppn_amount: newTransaction.ppnAmount || 0
      };

      // Prepare Items Data (Snake Case for RPC JSONB)
      // RPC 09_transaction.sql expects properties like: product_id, quantity, etc.
      // For materials: product_id = "material-xxx", material_id = actual UUID
      const itemsData = newTransaction.items.map((item: any) => {
        const product = item.product;
        const isMaterial = product?._isMaterial || product?.type === 'material';
        const materialId = isMaterial ? (product?._materialId || product?.materialId) : null;
        const productId = isMaterial
          ? `material-${materialId}`  // Send prefixed ID for detection in RPC
          : (product?.id || item.productId);

        return {
          product_id: productId,
          material_id: materialId || undefined,  // Send actual material UUID separately
          product_name: item.product?.name || item.productName || 'Unknown Product',
          quantity: item.quantity || 0,
          price: item.price || 0,
          discount: item.discount || 0,
          is_bonus: item.isBonus || false,
          cost_price: item.product?.costPrice || 0,
          unit: item.unit || 'pcs',
          width: item.width || null,
          height: item.height || null
        } as any;
      });

      // Call Atomic RPC
      const { data: rpcResultRaw, error: rpcError } = await supabase
        .rpc('create_transaction_atomic', {
          p_transaction: transactionData,
          p_items: itemsData,
          p_branch_id: currentBranch.id,
          p_cashier_id: newTransaction.cashierId || user?.id || null,
          p_cashier_name: newTransaction.cashierName || user?.full_name || null,
          p_quotation_id: quotationId || null
        });

      if (rpcError) {
        console.error('❌ RPC Error:', rpcError);
        throw new Error(`Gagal menyimpan transaksi: ${rpcError.message}`);
      }

      const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;

      if (!rpcResult?.success) {
        console.error('❌ Transaction RPC failed:', rpcResult?.error_message);
        throw new Error(rpcResult?.error_message || 'Gagal menyimpan transaksi (Unknown RPC Error)');
      }

      if (!rpcResult?.journal_id) {
        console.error('❌ Transaction RPC returned success without journal_id:', rpcResult);
        throw new Error('Transaksi tidak disimpan karena jurnal penjualan gagal dibuat. Silakan cek jurnal/accounting terlebih dahulu.');
      }

      console.log('✅ Transaction Created Successfully via RPC:', {
        trxId: rpcResult.transaction_id,
        journalId: rpcResult.journal_id,
        hpp: rpcResult.total_hpp
      });

      // Mark customer as visited (Optional, non-blocking)
      if (newTransaction.customerId) {
        markAsVisitedAsync(
          newTransaction.customerId,
          newTransaction.cashierId,
          newTransaction.cashierName,
          currentBranch.id
        ).catch(console.warn);
      }

      // No need to save due_date separately, already included atomically.

      // Read back the saved transaction from DB so print/detail flows use the real stored values
      const { data: createdRow, error: fetchError } = await supabase
        .from('transactions')
        .select(`
          *,
          customer:customers(classification, address, phone),
          payment_account:payment_account_id(name)
        `)
        .eq('id', rpcResult.transaction_id)
        .single();

      if (fetchError) {
        console.warn('⚠️ Failed to refetch created transaction, falling back to optimistic object:', fetchError);
        return {
          ...newTransaction,
          createdAt: new Date(),
          status: 'Pesanan Masuk',
          paymentStatus: transactionData.paid_amount >= transactionData.total ? 'Lunas' : 'Belum Lunas'
        } as Transaction;
      }

      const createdTransactionRow = Array.isArray(createdRow) ? createdRow[0] : createdRow;
      if (!createdTransactionRow) {
        console.warn('⚠️ Created transaction refetch returned empty data, falling back to optimistic object');
        return {
          ...newTransaction,
          createdAt: new Date(),
          status: 'Pesanan Masuk',
          paymentStatus: transactionData.paid_amount >= transactionData.total ? 'Lunas' : 'Belum Lunas'
        } as Transaction;
      }

      return fromDb(createdTransactionRow);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['quotations'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['stockMovements'] })
      queryClient.invalidateQueries({ queryKey: ['cashFlow'] })
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] })
      queryClient.invalidateQueries({ queryKey: ['transactionsReadyForDelivery'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
    }
  })

  // 2. UPDATE TRANSACTION (FULL RPC)
  const updateTransaction = useMutation({
    mutationFn: async (params: Transaction | { transaction: Transaction, previousPaidAmount: number }): Promise<Transaction> => {
      const updatedTransaction = 'transaction' in params ? params.transaction : params;

      if (!currentBranch?.id) throw new Error('Branch ID is required');

      console.log('🔄 Updating Transaction via Atomic RPC...', updatedTransaction.id);

      const { data: existingDeliveryRows, error: existingDeliveryError } = await supabase
        .from('deliveries')
        .select('id')
        .eq('transaction_id', updatedTransaction.id)
        .eq('branch_id', currentBranch.id)
        .eq('is_cancelled', false)
        .limit(1);

      if (existingDeliveryError) {
        throw new Error(`Gagal memeriksa data pengantaran: ${existingDeliveryError.message}`);
      }

      const hasActiveDelivery = Array.isArray(existingDeliveryRows) && existingDeliveryRows.length > 0;
      if (hasActiveDelivery) {
        throw new Error('Transaksi ini sudah memiliki pengantaran. Edit transaksi dinonaktifkan untuk mencegah data transaksi, pengantaran, dan jurnal tidak sinkron.');
      }

      // Prepare items data (snake_case for RPC JSONB)
      const itemsData = updatedTransaction.items.map((item: any) => {
        const product = item.product;
        return {
          productId: product?.id || item.productId,
          product_name: product?.name || item.productName || 'Unknown Product',
          quantity: item.quantity || 0,
          price: item.price || 0,
          discount: item.discount || 0,
          isBonus: item.isBonus || false,
          cost_price: product?.costPrice || 0,
          unit: item.unit || 'pcs',
          width: item.width || null,
          height: item.height || null,
          hppAmount: item.hppAmount || 0,
          notes: item.notes || null,
        };
      });

      const transactionData = {
        total: updatedTransaction.total,
        subtotal: updatedTransaction.subtotal || updatedTransaction.total,
        paid_amount: updatedTransaction.paidAmount || 0,
        customer_id: updatedTransaction.customerId,
        customer_name: updatedTransaction.customerName,
        payment_account_id: updatedTransaction.paymentAccountId || null,
        sales_id: updatedTransaction.salesId || null,
        sales_name: updatedTransaction.salesName || null,
        order_date: updatedTransaction.orderDate instanceof Date
          ? updatedTransaction.orderDate.toISOString()
          : updatedTransaction.orderDate,
        due_date: updatedTransaction.dueDate instanceof Date
          ? updatedTransaction.dueDate.toISOString()
          : updatedTransaction.dueDate || null,
        items: itemsData,
        ppn_enabled: updatedTransaction.ppnEnabled || false,
        ppn_mode: updatedTransaction.ppnMode || 'exclude',
        ppn_percentage: updatedTransaction.ppnPercentage || 0,
        ppn_amount: updatedTransaction.ppnAmount || 0,
        is_office_sale: updatedTransaction.isOfficeSale || false,
        notes: updatedTransaction.notes || null,
      };

      const { data: rpcResultRaw, error: rpcError } = await supabase
        .rpc('update_transaction_atomic', {
          p_transaction_id: updatedTransaction.id,
          p_transaction: transactionData,
          p_branch_id: currentBranch.id,
          p_user_id: user?.id || null,
          p_user_name: user?.full_name || null
        });

      if (rpcError) {
        console.error('❌ RPC Error:', rpcError);
        throw new Error(`Gagal update transaksi: ${rpcError.message}`);
      }

      const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;

      if (!rpcResult?.success) {
        throw new Error(rpcResult?.error_message || 'Update transaction failed');
      }

      console.log('✅ Transaction Updated via RPC:', rpcResult.changes_made);
      return updatedTransaction;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] })
      queryClient.invalidateQueries({ queryKey: ['cashFlow'] })
      queryClient.invalidateQueries({ queryKey: ['commissions'] })
    }
  })

  // 3. RECEIVE PAYMENT (FULL RPC)
  const payReceivable = useMutation({
    mutationFn: async ({
      transactionId,
      amount,
      accountId,
      accountName,
      notes,
      recordedBy
    }: {
      transactionId: string;
      amount: number;
      accountId?: string;
      accountName?: string;
      notes?: string;
      recordedBy?: string;
    }): Promise<void> => {
      if (!currentBranch?.id) throw new Error('Branch ID is required');

      console.log('💸 Processing Receivable Payment via RPC...', { transactionId, amount });

      // Use pay_receivable_complete_rpc to store in payment_history (Source of Truth)
      const { data: rpcResultRaw, error: rpcError } = await supabase
        .rpc('pay_receivable_complete_rpc', {
          p_transaction_id: transactionId,
          p_amount: amount,
          p_payment_account_id: accountId,
          p_notes: notes || `Pelunasan Piutang by ${recordedBy || user?.full_name || 'User'}`,
          p_branch_id: currentBranch.id,
          p_user_id: user?.id || null,
          p_recorded_by_name: recordedBy || user?.full_name || 'User',
          p_payment_date: getOfficeDateString(timezone)
        });

      if (rpcError) {
        console.error('❌ RPC Error:', rpcError);
        throw new Error(`Gagal memproses pembayaran: ${rpcError.message}`);
      }

      const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;

      if (!rpcResult?.success) {
        throw new Error(rpcResult?.error_message || 'Payment failed');
      }

      console.log('✅ Payment Success:', rpcResult.payment_id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['cashFlow'] });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
    }
  });

  const deleteReceivable = useMutation({
    mutationFn: async (transactionId: string) => {
      // Re-use deleteTransaction as they are essentially the same for voiding logic
      // But if UI expects just delete, we route to void function
      if (!currentBranch?.id) throw new Error('Branch ID is required');

      const { data: rpcResultRaw, error: rpcError } = await supabase
        .rpc('void_transaction_atomic', {
          p_transaction_id: transactionId,
          p_branch_id: currentBranch.id,
          p_reason: 'Piutang dihapus/dibatalkan',
          p_user_id: user?.id || null
        });

      if (rpcError) throw new Error(rpcError.message);

      const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;
      if (!rpcResult?.success) throw new Error(rpcResult?.error_message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['cashFlow'] });
    }
  });

  const updateTransactionStatus = useMutation({
    mutationFn: async ({ transactionId, status }: { transactionId: string, status: string }) => {
      // Simple status update
      const { error } = await supabase
        .from('transactions')
        .update({ status })
        .eq('id', transactionId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    }
  });

  // 4. DELETE/VOID TRANSACTION (FULL RPC)
  const deleteTransaction = useMutation({
    mutationFn: async ({ transactionId, reason, userId }: { transactionId: string, reason: string, userId?: string | null }) => {
      if (!currentBranch?.id) throw new Error('Branch ID is required');

      console.log('🗑️ Voiding Transaction via RPC...', transactionId);

      // Fetch associated deliveries to collect photo URLs before deletion
      const { data: deliveriesData, error: deliveriesError } = await supabase
        .from('deliveries')
        .select('photo_url')
        .eq('transaction_id', transactionId)
        .not('photo_url', 'is', null);

      let photoUrlsToDelete: string[] = [];
      if (!deliveriesError && deliveriesData) {
        photoUrlsToDelete = deliveriesData
          .map(d => d.photo_url)
          .filter((url): url is string => Boolean(url));
      }

      const { data: rpcResultRaw, error: rpcError } = await supabase
        .rpc('void_transaction_atomic', {
          p_transaction_id: transactionId,
          p_branch_id: currentBranch.id,
          p_reason: reason || 'Dibatalkan oleh User',
          p_user_id: user?.id || null
        });

      if (rpcError) {
        console.error('❌ RPC Error:', rpcError);
        throw new Error(`Gagal menghapus transaksi: ${rpcError.message}`);
      }

      const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;

      if (!rpcResult?.success) {
        throw new Error(rpcResult?.error_message || 'Void transaction failed');
      }

      console.log('✅ Transaction Voided & Rolled Back:', rpcResult);

      // Actually delete the physical delivery photos from the VPS
      if (photoUrlsToDelete.length > 0) {
        // We import PhotoUploadService dynamically to avoid circular dependencies if any,
        // or just use it if imported. Let's dynamically import to be safe since it wasn't at the top.
        const { PhotoUploadService } = await import('@/services/photoUploadService');
        for (const url of photoUrlsToDelete) {
          try {
            const filename = url.split('/').pop();
            // EXTRA SAFETY CHECK: Pastikan filename valid, bukan string kosong, bukan sekadar spasi, dan minimal 5 karakter
            // format nama file kita: delivery-uuid-123456.jpg (>5 chars)
            if (filename && filename.trim().length > 5 && !filename.includes('/') && filename.includes('.')) {
              await PhotoUploadService.deletePhoto(filename, 'deliveries');
              console.log(`[deleteTransaction] Deleted physical photo: ${filename}`);
            }
          } catch (e) {
            console.error(`[deleteTransaction] Failed to delete photo ${url}:`, e);
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['products'] }); // Stock restored
      queryClient.invalidateQueries({ queryKey: ['stockMovements'] });
      queryClient.invalidateQueries({ queryKey: ['cashFlow'] });
      queryClient.invalidateQueries({ queryKey: ['commissions'] });
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['quotations'] });
    },
  });

  const deductMaterials = useMutation({
    mutationFn: async (transactionId: string) => {
      const { error } = await supabase.rpc('deduct_materials_for_transaction', {
        p_transaction_id: transactionId,
      });
      if (error) throw new Error(`Gagal mengurangi stok: ${error.message}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materials'] });
    },
  });

  const updateDueDate = useMutation({
    mutationFn: async ({ transactionId, dueDate }: { transactionId: string; dueDate: Date | null }) => {
      const { error } = await supabase
        .from('transactions')
        .update({ due_date: dueDate ? dueDate.toISOString() : null })
        .eq('id', transactionId);

      if (error) throw new Error(`Gagal mengubah jatuh tempo: ${error.message}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  return { transactions, isLoading, addTransaction, updateTransaction, payReceivable, deleteReceivable, updateTransactionStatus, deductMaterials, deleteTransaction, updateDueDate }
}

export const useTransactionById = (id: string) => {
  const { currentBranch } = useBranch()

  const { data: transaction, isLoading } = useQuery<Transaction | undefined>({
    queryKey: ['transaction', id, currentBranch?.id],
    queryFn: async () => {
      let query = supabase
        .from('transactions')
        .select(transactionSelectFields)
        .eq('id', id)
        .eq('is_voided', false)
        .eq('is_cancelled', false)
        .order('id')
        .limit(1);

      if (currentBranch?.id) {
        query = query.eq('branch_id', currentBranch.id);
      }

      const { data: rawData, error } = await query;
      if (error) {
        console.error(error.message);
        return undefined;
      }
      const data = Array.isArray(rawData) ? rawData[0] : rawData;
      if (!data) return undefined;
      return fromDb(data);
    },
    enabled: !!id && !!currentBranch,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  return { transaction, isLoading };
}

export const useTransactionsByCustomer = (customerId: string) => {
  const { data: transactions, isLoading } = useQuery<Transaction[]>({
    queryKey: ['transactions', 'customer', customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('customer_id', customerId)
        .eq('is_voided', false)
        .eq('is_cancelled', false);
      if (error) throw new Error(error.message);
      return data ? data.map(fromDb) : [];
    },
    enabled: !!customerId,
    staleTime: 3 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  return { transactions, isLoading };
}
