import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Expense } from '@/types/expense'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from './useAuth'
import { useBranch } from '@/contexts/BranchContext'
import { useAccounts } from '@/hooks/useAccounts'
// Journal now handled by RPC create_expense_atomic

// ============================================================================
// CATATAN PENTING: DOUBLE-ENTRY ACCOUNTING SYSTEM
// ============================================================================
// Semua saldo akun HANYA dihitung dari journal_entries (tidak ada updateAccountBalance)
// cash_history SUDAH DIHAPUS - tidak lagi digunakan
// Jurnal otomatis dibuat melalui journalService untuk setiap transaksi
// ============================================================================

// Helper to map from DB (snake_case) to App (camelCase)
const fromDbToApp = (dbExpense: any): Expense => ({
  id: dbExpense.id,
  description: dbExpense.description,
  amount: dbExpense.amount,
  accountId: dbExpense.account_id,
  accountName: dbExpense.account_name,
  expenseAccountId: dbExpense.expense_account_id,
  expenseAccountName: dbExpense.expense_account_name,
  date: new Date(dbExpense.date),
  category: dbExpense.category,
  photoUrl: dbExpense.photo_url,
  createdAt: new Date(dbExpense.created_at),
});

// Helper to map from App (camelCase) to DB (snake_case)
const fromAppToDb = (appExpense: Partial<Omit<Expense, 'id' | 'createdAt'>>) => {
  const { accountId, accountName, expenseAccountId, expenseAccountName, date, ...rest } = appExpense;
  const dbData: any = { ...rest };
  if (accountId !== undefined) dbData.account_id = accountId;
  if (accountName !== undefined) dbData.account_name = accountName;
  if (expenseAccountId !== undefined) dbData.expense_account_id = expenseAccountId;
  if (expenseAccountName !== undefined) dbData.expense_account_name = expenseAccountName;
  // Convert Date object to ISO string for database
  if (date !== undefined) dbData.date = date instanceof Date ? date.toISOString() : date;
  return dbData;
};

export const useExpenses = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { currentBranch } = useBranch();
  const { accounts } = useAccounts();

  const { data: expenses, isLoading } = useQuery<Expense[]>({
    queryKey: ['expenses', currentBranch?.id],
    queryFn: async () => {
      // Filter out commission expenses - they are handled automatically in financial reports
      let query = supabase
        .from('expenses')
        .select('*')
        .not('id', 'like', 'EXP-COMMISSION-%')
        .order('date', { ascending: false });

      // Apply branch filter - ALWAYS filter by selected branch
      if (currentBranch?.id) {
        query = query.eq('branch_id', currentBranch.id);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data ? data.map(fromDbToApp) : [];
    },
    enabled: !!currentBranch,
    // Optimized for expense management
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes cache
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    retryDelay: 1000,
  });

  // Query untuk mendapatkan pembayaran hutang dari JOURNAL ENTRIES (bukan cash_history)
  const { data: debtPayments, isLoading: isLoadingDebtPayments } = useQuery<Expense[]>({
    queryKey: ['debtPayments', currentBranch?.id, accounts?.length],
    queryFn: async () => {
      // Get payment accounts (kas/bank)
      const paymentAccounts = (accounts || []).filter(acc => acc.isPaymentAccount);
      const paymentAccountIds = paymentAccounts.map(acc => acc.id);

      if (paymentAccountIds.length === 0) {
        return [];
      }

      // Create account lookup map
      const accountMap = new Map(paymentAccounts.map(acc => [acc.id, acc]));

      // Query journal entries with reference_type='payable'
      const { data: journalLines, error } = await supabase
        .from('journal_entry_lines')
        .select(`
          id,
          account_id,
          account_name,
          debit_amount,
          credit_amount,
          description,
          journal_entries (
            id,
            entry_number,
            entry_date,
            description,
            reference_type,
            reference_id,
            status,
            is_voided,
            branch_id,
            created_at
          )
        `)
        .in('account_id', paymentAccountIds);

      if (error) {
        console.error('Failed to fetch debt payments from journal entries:', error);
        return [];
      }

      // Filter: reference_type='payable', posted, not voided, current branch, credit > 0 (kas keluar)
      const filteredLines = (journalLines || []).filter((line: any) => {
        const journal = line.journal_entries;
        if (!journal) return false;

        const isPayablePayment = journal.reference_type === 'payable';
        const isPosted = journal.status === 'posted';
        const isNotVoided = journal.is_voided === false;
        const isCurrentBranch = journal.branch_id === currentBranch?.id;
        const isCredit = Number(line.credit_amount) > 0; // Kas keluar = credit untuk akun kas

        return isPayablePayment && isPosted && isNotVoided && isCurrentBranch && isCredit;
      });

      // Sort by created_at descending
      filteredLines.sort((a: any, b: any) => {
        const dateA = new Date(a.journal_entries?.created_at || 0);
        const dateB = new Date(b.journal_entries?.created_at || 0);
        return dateB.getTime() - dateA.getTime();
      });

      // Transform to Expense format
      return filteredLines.map((line: any): Expense => {
        const journal = line.journal_entries;
        const account = accountMap.get(line.account_id);

        return {
          id: line.id,
          description: journal.description || 'Pembayaran Hutang',
          amount: Number(line.credit_amount) || 0,
          accountId: line.account_id,
          accountName: line.account_name || account?.name || 'Unknown',
          expenseAccountId: undefined,
          expenseAccountName: 'Pembayaran Hutang',
          date: new Date(journal.created_at),
          category: 'Pembayaran Hutang',
          createdAt: new Date(journal.created_at),
        };
      });
    },
    enabled: !!currentBranch && !!accounts,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    retryDelay: 1000,
  });

  // Gabungkan expenses dan debtPayments, lalu sort by date descending
  const allExpenses = [...(expenses || []), ...(debtPayments || [])].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const addExpense = useMutation({
    mutationFn: async (newExpenseData: Omit<Expense, 'id' | 'createdAt'>): Promise<Expense> => {
      // ============================================================================
      // USE RPC: create_expense_atomic
      // Handles: expense record + journal (Dr. Beban, Cr. Kas) in single transaction
      // ============================================================================
      if (currentBranch?.id) {
        // Simply use ISO string - Date object already has the correct local time
        const dateToSend = newExpenseData.date instanceof Date
          ? newExpenseData.date.toISOString()
          : newExpenseData.date;

        const { data: rpcResultRaw, error: rpcError } = await supabase
          .rpc('create_expense_atomic', {
            p_expense: {
              description: newExpenseData.description,
              amount: newExpenseData.amount,
              category: newExpenseData.category || 'Beban Umum',
              date: dateToSend,
              account_id: newExpenseData.accountId,
              expense_account_id: newExpenseData.expenseAccountId,
              expense_account_name: newExpenseData.expenseAccountName,
            },
            p_branch_id: currentBranch.id,
            p_photo_url: newExpenseData.photoUrl || null,
          });

        if (rpcError) {
          console.error('RPC create_expense_atomic error:', rpcError);
          throw new Error(rpcError.message);
        }

        const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;
        if (!rpcResult?.success) {
          throw new Error(rpcResult?.error_message || 'Gagal membuat pengeluaran');
        }

        console.log('✅ Expense created via RPC:', rpcResult.expense_id, 'Journal:', rpcResult.journal_id);

        // Fetch the created expense
        const { data: createdExpenseRaw } = await supabase
          .from('expenses')
          .select('*')
          .eq('id', rpcResult.expense_id)
          .order('id').limit(1);

        const createdExpense = Array.isArray(createdExpenseRaw) ? createdExpenseRaw[0] : createdExpenseRaw;
        if (!createdExpense) throw new Error('Expense created but not found');

        return fromDbToApp(createdExpense);
      }

      // Fallback: Legacy method if no branch
      const dbData = fromAppToDb(newExpenseData);
      const insertData = {
        ...dbData,
        id: `exp-${Date.now()}`,
        branch_id: currentBranch?.id || null,
      };

      const { data: dataRaw, error } = await supabase
        .from('expenses')
        .insert(insertData)
        .select()
        .order('id').limit(1);

      if (error) throw new Error(error.message);
      const data = Array.isArray(dataRaw) ? dataRaw[0] : dataRaw;
      if (!data) throw new Error('Failed to create expense');

      return fromDbToApp(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['cashFlow'] });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
    },
  });

  const deleteExpense = useMutation({
    mutationFn: async (expenseId: string): Promise<Expense> => {
      // Get expense data first for return value
      const { data: expenseRaw } = await supabase
        .from('expenses')
        .select('*')
        .eq('id', expenseId)
        .order('id').limit(1);

      const expense = Array.isArray(expenseRaw) ? expenseRaw[0] : expenseRaw;
      if (!expense) throw new Error("Pengeluaran tidak ditemukan");

      const appExpense = fromDbToApp(expense);

      // ============================================================================
      // USE RPC: delete_expense_atomic
      // Handles: void journal + delete expense in single transaction
      // ============================================================================
      if (currentBranch?.id) {
        const { data: rpcResultRaw, error: rpcError } = await supabase
          .rpc('delete_expense_atomic', {
            p_expense_id: expenseId,
            p_branch_id: currentBranch.id,
          });

        if (rpcError) {
          console.error('RPC delete_expense_atomic error:', rpcError);
          throw new Error(rpcError.message);
        }

        const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;
        if (!rpcResult?.success) {
          throw new Error(rpcResult?.error_message || 'Gagal menghapus pengeluaran');
        }

        console.log('✅ Expense deleted via RPC, journals voided:', rpcResult.journals_voided);
        return appExpense;
      }

      // Fallback: Legacy method
      const { error: deleteError } = await supabase
        .from('expenses')
        .delete()
        .eq('id', expenseId);

      if (deleteError) throw new Error(deleteError.message);
      return appExpense;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['cashFlow'] });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
    }
  });

  // ============================================================================
  // UPDATE EXPENSE - Using RPC update_expense_atomic
  // ============================================================================
  const updateExpense = useMutation({
    mutationFn: async (updatedExpense: Partial<Expense> & { id: string }): Promise<Expense> => {
      // ============================================================================
      // USE RPC: update_expense_atomic
      // Handles: update expense + update journal if amount/account changed
      // ============================================================================
      if (currentBranch?.id) {
        const { data: rpcResultRaw, error: rpcError } = await supabase
          .rpc('update_expense_atomic', {
            p_expense_id: updatedExpense.id,
            p_expense: {
              description: updatedExpense.description,
              amount: updatedExpense.amount,
              category: updatedExpense.category,
              date: updatedExpense.date instanceof Date ? updatedExpense.date.toISOString().split('T')[0] : updatedExpense.date,
              account_id: updatedExpense.accountId,
            },
            p_branch_id: currentBranch.id,
          });

        if (rpcError) {
          console.error('RPC update_expense_atomic error:', rpcError);
          throw new Error(rpcError.message);
        }

        const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;
        if (!rpcResult?.success) {
          throw new Error(rpcResult?.error_message || 'Gagal update pengeluaran');
        }

        console.log('✅ Expense updated via RPC, journal updated:', rpcResult.journal_updated);

        // Fetch updated expense
        const { data: savedExpenseRaw } = await supabase
          .from('expenses')
          .select('*')
          .eq('id', updatedExpense.id)
          .order('id').limit(1);

        const savedExpense = Array.isArray(savedExpenseRaw) ? savedExpenseRaw[0] : savedExpenseRaw;
        if (!savedExpense) throw new Error('Expense updated but not found');

        return fromDbToApp(savedExpense);
      }

      // Fallback: Legacy method
      const updateData: any = {};
      if (updatedExpense.description !== undefined) updateData.description = updatedExpense.description;
      if (updatedExpense.amount !== undefined) updateData.amount = updatedExpense.amount;
      if (updatedExpense.category !== undefined) updateData.category = updatedExpense.category;
      if (updatedExpense.date !== undefined) updateData.date = updatedExpense.date;
      if (updatedExpense.accountId !== undefined) updateData.account_id = updatedExpense.accountId;

      const { data: savedExpenseRaw, error: updateError } = await supabase
        .from('expenses')
        .update(updateData)
        .eq('id', updatedExpense.id)
        .select()
        .order('id').limit(1);

      if (updateError) throw new Error(updateError.message);
      const savedExpense = Array.isArray(savedExpenseRaw) ? savedExpenseRaw[0] : savedExpenseRaw;
      if (!savedExpense) throw new Error('Gagal update pengeluaran');

      return fromDbToApp(savedExpense);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['cashFlow'] });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
    }
  });

  return {
    expenses: allExpenses, // Return gabungan expenses + pembayaran hutang
    expensesOnly: expenses, // Pure expenses tanpa pembayaran hutang
    isLoading: isLoading || isLoadingDebtPayments,
    addExpense,
    updateExpense,
    deleteExpense,
  }
}
