import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Transaction } from '@/types/transaction'
import { supabase } from '@/integrations/supabase/client'
import { useExpenses } from './useExpenses'
import { useBranch } from '@/contexts/BranchContext'
import { useTimezone } from '@/contexts/TimezoneContext'
import { getOfficeDateString } from '@/utils/officeTime'
import { findAccountByLookup, AccountLookupType } from '@/services/accountLookupService'
import { Account } from '@/types/account'
import { markAsVisitedAsync } from '@/utils/customerVisitUtils'

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
    subtotal: dbTransaction.subtotal ?? dbTransaction.total ?? 0,
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

  const { data: transactions, isLoading } = useQuery<Transaction[]>({
    queryKey: ['transactions', filters, currentBranch?.id],
    queryFn: async () => {
      // Join dengan customers untuk mendapatkan classification DAN address
      // Join dengan accounts untuk mendapatkan nama akun pembayaran
      const selectFields = `
        *,
        customer:customers(classification, address),
        payment_account:payment_account_id(name)
      `;

      let query = supabase
        .from('transactions')
        .select(selectFields)
        .eq('is_voided', false)  // Only show non-voided transactions
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

      // Prepare Transaction Data (Snake Case for RPC)
      const transactionData = {
        id: newTransaction.id,
        customer_id: newTransaction.customerId,
        customer_name: newTransaction.customerName,
        total: newTransaction.total,
        paid_amount: newTransaction.paidAmount || 0,
        payment_method: newTransaction.paymentMethod || 'Tunai',
        payment_account_id: newTransaction.paymentAccountId || null,
        is_office_sale: newTransaction.isOfficeSale || false,
        date: newTransaction.orderDate instanceof Date
          ? newTransaction.orderDate.toISOString()
          : newTransaction.orderDate,
        notes: newTransaction.notes || null,
        sales_id: newTransaction.salesId || null,
        sales_name: newTransaction.salesName || null,
        retasi_id: newTransaction.retasiId || null,
        retasi_number: newTransaction.retasiNumber || null
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
          p_cashier_id: newTransaction.cashierId || null,
          p_cashier_name: newTransaction.cashierName || null,
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

      // Return constructed transaction object (optimistic) or fetch from DB
      return {
        ...newTransaction,
        createdAt: new Date(),
        status: 'Pesanan Masuk',
        paymentStatus: transactionData.paid_amount >= transactionData.total ? 'Lunas' : 'Belum Lunas'
      } as Transaction;
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

      const transactionData = {
        total: updatedTransaction.total,
        paid_amount: updatedTransaction.paidAmount || 0,
        payment_method: updatedTransaction.paymentMethod || 'Tunai',
        customer_name: updatedTransaction.customerName,
        notes: updatedTransaction.notes
      };

      const { data: rpcResultRaw, error: rpcError } = await supabase
        .rpc('update_transaction_atomic', {
          p_transaction_id: updatedTransaction.id,
          p_transaction: transactionData,
          p_branch_id: currentBranch.id,
          p_user_id: null,
          p_user_name: null
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

      // Use receive_payment_atomic from 08_purchase_order.sql
      const { data: rpcResultRaw, error: rpcError } = await supabase
        .rpc('receive_payment_atomic', {
          p_receivable_id: transactionId, // Transaction ID acting as receivable ID
          p_branch_id: currentBranch.id,
          p_amount: amount,
          p_payment_account_id: accountId, // User-selected payment account
          p_payment_method: 'cash', // Default to cash/transfer based on account
          p_payment_date: getOfficeDateString(timezone),
          p_notes: notes || `Pelunasan Piutang by ${recordedBy || 'User'}`
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
          p_user_id: null
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
    mutationFn: async (transactionId: string) => {
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
          p_reason: 'Transaksi dihapus oleh user',
          p_user_id: null
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
  const { data: transaction, isLoading } = useQuery<Transaction | undefined>({
    queryKey: ['transaction', id],
    queryFn: async () => {
      const { data: rawData, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('id', id)
        .order('id').limit(1);
      if (error) {
        console.error(error.message);
        return undefined;
      }
      const data = Array.isArray(rawData) ? rawData[0] : rawData;
      if (!data) return undefined;
      return fromDb(data);
    },
    enabled: !!id,
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
        .eq('customer_id', customerId);
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
