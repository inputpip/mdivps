import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { CashHistory } from '@/types/cashFlow';
import { useBranch } from '@/contexts/BranchContext';
import { useAccounts } from '@/hooks/useAccounts';

/**
 * useCashFlow - Mengambil mutasi kas/bank dari JOURNAL ENTRIES
 *
 * ARSITEKTUR BARU:
 * - Cash flow dibaca dari journal_entry_lines untuk akun kas/bank (isPaymentAccount)
 * - TIDAK LAGI menggunakan cash_history table
 * - Format output tetap kompatibel dengan CashHistory interface
 *
 * Prinsip: Journal entries adalah SUMBER KEBENARAN untuk semua mutasi kas
 */
export function useCashFlow() {
  const { currentBranch } = useBranch();
  const { accounts } = useAccounts();

  const {
    data: cashHistory,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ['cashFlow', currentBranch?.id, accounts?.length],
    queryFn: async (): Promise<CashHistory[]> => {
      // Get payment accounts (kas/bank)
      const paymentAccounts = (accounts || []).filter(acc => acc.isPaymentAccount);
      const paymentAccountIds = paymentAccounts.map(acc => acc.id);

      if (paymentAccountIds.length === 0) {
        console.log('📊 No payment accounts found for cash flow');
        return [];
      }

      // Create account lookup map
      const accountMap = new Map(paymentAccounts.map(acc => [acc.id, acc]));

      // Gunakan DATABASE VIEW `v_arus_kas_lengkap` untuk mengambil rekap total tanpa chunking!
      // Menyelesaikan masalah URI Too Long (ERR_FAILED / 414)
      const { data: viewData, error: viewError } = await supabase
        .from('v_arus_kas_lengkap')
        .select('*')
        .in('account_id', paymentAccountIds)
        .eq('branch_id', currentBranch?.id)
        .order('created_at', { ascending: false });

      if (viewError) {
        console.error('❌ Failed to fetch cash flow view:', viewError);
        return [];
      }

      const transactionReferenceIds = Array.from(new Set(
        (viewData || [])
          .filter((row: any) => row.reference_type === 'transaction' && row.reference_id)
          .map((row: any) => row.reference_id)
      ));

      const expenseReferenceIds = Array.from(new Set(
        (viewData || [])
          .filter((row: any) => row.reference_type === 'expense' && row.reference_id)
          .map((row: any) => row.reference_id)
      ));

      const receivableReferenceIds = Array.from(new Set(
        (viewData || [])
          .filter((row: any) => ['receivable', 'receivable_payment'].includes(row.reference_type) && row.reference_id)
          .map((row: any) => row.reference_id)
      ));

      const transactionMap: Record<string, { id: string; customer_name: string }> = {};
      if (transactionReferenceIds.length > 0) {
        const { data: transactionsData, error: transactionsError } = await supabase
          .from('transactions')
          .select('id, customer_name')
          .in('id', transactionReferenceIds);

        if (!transactionsError && transactionsData) {
          transactionsData.forEach((tx: any) => {
            transactionMap[tx.id] = {
              id: tx.id,
              customer_name: tx.customer_name || ''
            };
          });
        }
      }

      const expenseMap: Record<string, { id: string; description: string }> = {};
      if (expenseReferenceIds.length > 0) {
        const { data: expensesData, error: expensesError } = await supabase
          .from('expenses')
          .select('id, description')
          .in('id', expenseReferenceIds);

        if (!expensesError && expensesData) {
          expensesData.forEach((expense: any) => {
            expenseMap[expense.id] = {
              id: expense.id,
              description: expense.description || ''
            };
          });
        }
      }

      const receivableTransactionMap: Record<string, { id: string; customer_name: string }> = {};
      if (receivableReferenceIds.length > 0) {
        const { data: receivableTransactionsData, error: receivableTransactionsError } = await supabase
          .from('transactions')
          .select('id, customer_name')
          .in('id', receivableReferenceIds);

        if (!receivableTransactionsError && receivableTransactionsData) {
          receivableTransactionsData.forEach((tx: any) => {
            receivableTransactionMap[tx.id] = {
              id: tx.id,
              customer_name: tx.customer_name || ''
            };
          });
        }
      }

      // Transform result to match CashHistory interface
      const cashHistoryData: CashHistory[] = (viewData || []).map((row: any) => {
        const debitAmount = Number(row.debit_amount) || 0;
        const creditAmount = Number(row.credit_amount) || 0;

        const isIncome = debitAmount > 0;
        const amount = isIncome ? debitAmount : creditAmount;

        const typeMap: Record<string, CashHistory['type']> = {
          'transaction': 'orderan',
          'expense': 'pengeluaran',
          'payroll': 'gaji_karyawan',
          'advance': 'panjar_pengambilan',
          'transfer': isIncome ? 'transfer_masuk' : 'transfer_keluar',
          'receivable': 'pembayaran_piutang',
          'receivable_payment': 'pembayaran_piutang',
          'payable': 'pembayaran_hutang',
          'manual': isIncome ? 'kas_masuk_manual' : 'kas_keluar_manual',
        };

        const type = typeMap[row.reference_type] || (isIncome ? 'kas_masuk_manual' : 'kas_keluar_manual');

        const relatedTransaction = row.reference_type === 'transaction' && row.reference_id
          ? transactionMap[row.reference_id]
          : undefined;
        const relatedExpense = row.reference_type === 'expense' && row.reference_id
          ? expenseMap[row.reference_id]
          : undefined;
        const relatedReceivableTransaction = ['receivable', 'receivable_payment'].includes(row.reference_type) && row.reference_id
          ? receivableTransactionMap[row.reference_id]
          : undefined;

        let finalDescription = row.line_description || row.journal_description || 'Transaksi Umum';
        let referenceNumber = row.entry_number || row.reference_id;

        if (row.reference_type === 'transaction') {
          finalDescription = relatedTransaction?.customer_name
            ? `Penjualan: ${relatedTransaction.customer_name}`
            : (row.line_description || row.journal_description || 'Penjualan');
          referenceNumber = relatedTransaction?.id || referenceNumber;
        } else if (row.reference_type === 'expense') {
          finalDescription = relatedExpense?.description || row.line_description || row.journal_description || 'Pengeluaran';
        } else if (['receivable', 'receivable_payment'].includes(row.reference_type)) {
          finalDescription = relatedReceivableTransaction?.customer_name
            ? `Pembayaran Piutang: ${relatedReceivableTransaction.customer_name}`
            : (row.line_description || row.journal_description || 'Pembayaran Piutang');
          referenceNumber = relatedReceivableTransaction?.id || referenceNumber;
        }

        return {
          id: row.line_id,
          account_id: row.account_id,
          account_name: row.account_name || accountMap.get(row.account_id)?.name || 'Unknown',
          type: type,
          transaction_type: isIncome ? 'income' : 'expense',
          amount: amount,
          description: finalDescription,
          reference_id: row.reference_id,
          reference_number: referenceNumber,
          created_at: row.created_at,
          created_by: null, 
          previous_balance: Number(row.previous_balance) || 0,
          after_balance: Number(row.after_balance) || 0,
        };
      });


      console.log(`📊 Cash flow loaded from journal_entries: ${cashHistoryData.length} transactions`);
      return cashHistoryData;
    },
    enabled: !!currentBranch && !!accounts,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes cache
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    retryDelay: 1000,
  });

  return {
    cashHistory,
    isLoading,
    error,
    refetch
  };
}
