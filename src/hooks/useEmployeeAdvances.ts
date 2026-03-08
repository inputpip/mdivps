import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { EmployeeAdvance, AdvanceRepayment } from '@/types/employeeAdvance'
import { useAuth } from './useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useBranch } from '@/contexts/BranchContext';
import { findAccountByLookup } from '@/services/accountLookupService';
import { Account } from '@/types/account';
// journalService import removed - now using RPC for all journal operations

// ============================================================================
// CATATAN PENTING: DOUBLE-ENTRY ACCOUNTING SYSTEM
// ============================================================================
// Semua saldo akun HANYA dihitung dari journal_entries (tidak ada update balance langsung)
// cash_history SUDAH DIHAPUS - tidak lagi digunakan
// Jurnal otomatis dibuat melalui journalService untuk setiap transaksi panjar
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

// Helper to get Piutang Karyawan account using lookup service (by name/type)
const getPiutangKaryawanAccount = async (): Promise<{ id: string; name: string } | null> => {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .order('code');

  if (error || !data) {
    console.warn('Failed to fetch accounts for Piutang Karyawan lookup:', error?.message);
    return null;
  }

  const accounts = data.map(fromDbToAppAccount);
  const piutangAccount = findAccountByLookup(accounts, 'PIUTANG_KARYAWAN');

  if (!piutangAccount) {
    console.warn('Piutang Karyawan account not found using lookup service');
    return null;
  }

  return { id: piutangAccount.id, name: piutangAccount.name };
};

const fromDbToApp = (dbAdvance: any): EmployeeAdvance => ({
  id: dbAdvance.id,
  employeeId: dbAdvance.employee_id,
  employeeName: dbAdvance.employee_name,
  amount: Number(dbAdvance.amount) || 0,
  date: new Date(dbAdvance.date),
  notes: dbAdvance.notes,
  remainingAmount: Number(dbAdvance.remaining_amount) || 0,
  repayments: (dbAdvance.advance_repayments || []).map((r: any) => ({
    id: r.id,
    amount: Number(r.amount) || 0,
    date: new Date(r.date),
    recordedBy: r.recorded_by,
  })),
  createdAt: new Date(dbAdvance.created_at),
  accountId: dbAdvance.account_id,
  accountName: dbAdvance.accounts?.name || dbAdvance.account_name || 'Kas Tunai',
});

// Helper to format date to YYYY-MM-DD string (local date, avoid timezone shift)
const formatDateToLocalString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const fromAppToDb = (appAdvance: Partial<EmployeeAdvance>) => {
  const dbData: { [key: string]: any } = {};
  if (appAdvance.id !== undefined) dbData.id = appAdvance.id;
  if (appAdvance.employeeId !== undefined) dbData.employee_id = appAdvance.employeeId;
  if (appAdvance.employeeName !== undefined) dbData.employee_name = appAdvance.employeeName;
  if (appAdvance.amount !== undefined) dbData.amount = appAdvance.amount;
  // Format date as YYYY-MM-DD string to prevent timezone conversion issues
  if (appAdvance.date !== undefined) dbData.date = formatDateToLocalString(appAdvance.date);
  if (appAdvance.notes !== undefined) dbData.notes = appAdvance.notes;
  if (appAdvance.remainingAmount !== undefined) dbData.remaining_amount = appAdvance.remainingAmount;
  if (appAdvance.accountId !== undefined) dbData.account_id = appAdvance.accountId;
  if (appAdvance.accountName !== undefined) dbData.account_name = appAdvance.accountName;
  return dbData;
};

export const useEmployeeAdvances = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { currentBranch } = useBranch();

  const { data: advances, isLoading, isError, error } = useQuery<EmployeeAdvance[]>({
    queryKey: ['employeeAdvances', currentBranch?.id, user?.id],
    queryFn: async () => {
      let query = supabase.from('employee_advances').select('*, accounts(name), advance_repayments:advance_repayments(*)');

      // Apply branch filter - ALWAYS filter by selected branch
      if (currentBranch?.id) {
        query = query.eq('branch_id', currentBranch.id);
      }

      // Filter out cancelled advances
      query = query.neq('status', 'cancelled');

      // Role-based filtering: only kasir, cashier, admin, owner can see all data
      // Other users can only see their own advances
      const allowedRoles = ['kasir', 'cashier', 'kasir sales', 'admin', 'owner'];
      const userRole = user?.role?.toLowerCase();

      if (user && !allowedRoles.includes(userRole || '')) {
        query = query.eq('employee_id', user.id);
      }

      const { data, error } = await query;
      if (error) {
        console.error("❌ Gagal mengambil data panjar:", error.message);
        throw new Error(error.message);
      }

      // Client-side filter as backup
      const filteredData = data ? data.filter((d: any) => d.status !== 'cancelled') : [];
      console.log('UseEmployeeAdvances: Fetched', data?.length, 'Filtered', filteredData.length);

      return filteredData.map(fromDbToApp);
    },
    enabled: !!currentBranch,
    // Optimized for panjar management
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes cache
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    retryDelay: 1000,
  });

  const addAdvance = useMutation({
    mutationFn: async (newData: Omit<EmployeeAdvance, 'id' | 'createdAt' | 'remainingAmount' | 'repayments'>): Promise<EmployeeAdvance> => {
      if (!currentBranch?.id) throw new Error('Branch ID is required');

      console.log('🚀 Creating Employee Advance via Atomic RPC...', newData.employeeName);

      const { data: rpcResultRaw, error: rpcError } = await supabase
        .rpc('create_employee_advance_atomic', {
          p_branch_id: currentBranch.id,
          p_advance: {
            employee_id: newData.employeeId,
            employee_name: newData.employeeName,
            amount: newData.amount,
            advance_date: newData.date instanceof Date ? newData.date.toISOString().split('T')[0] : newData.date,
            reason: newData.notes || '',
            payment_account_id: newData.accountId
          }
        });

      if (rpcError) {
        console.error('❌ RPC Error:', rpcError);
        throw new Error(`Gagal menyimpan panjar: ${rpcError.message}`);
      }

      const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;

      if (!rpcResult?.success) {
        throw new Error(rpcResult?.error_message || 'Gagal menyimpan panjar (Unknown RPC Error)');
      }

      console.log('✅ Advance Created via RPC:', rpcResult.advance_id, 'Journal:', rpcResult.journal_id);

      // Return constructed object for optimistic UI (optional)
      return {
        id: rpcResult.advance_id,
        ...newData,
        createdAt: new Date(),
        remainingAmount: newData.amount,
        repayments: []
      } as EmployeeAdvance;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employeeAdvances'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['cashFlow'] });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
    },
  });

  const addRepayment = useMutation({
    mutationFn: async ({ advanceId, repaymentData, accountId }: {
      advanceId: string,
      repaymentData: Omit<AdvanceRepayment, 'id'>,
      accountId?: string,
      accountName?: string
    }): Promise<void> => {
      if (!currentBranch?.id) throw new Error('Branch ID is required');
      if (!accountId) throw new Error('Payment account is required');

      console.log('💸 Processing Advance Repayment via RPC...', advanceId);

      const { data: rpcResultRaw, error: rpcError } = await supabase
        .rpc('repay_employee_advance_atomic', {
          p_advance_id: advanceId,
          p_branch_id: currentBranch.id,
          p_amount: repaymentData.amount,
          p_payment_date: repaymentData.date instanceof Date ? repaymentData.date.toISOString().split('T')[0] : repaymentData.date,
          p_payment_account_id: accountId,
          p_payment_method: 'cash',
          p_notes: null
        });

      if (rpcError) {
        console.error('❌ RPC Error:', rpcError);
        throw new Error(`Gagal memproses pelunasan: ${rpcError.message}`);
      }

      const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;
      if (!rpcResult?.success) {
        throw new Error(rpcResult?.error_message || 'Gagal memproses pelunasan');
      }

      console.log('✅ Repayment Success via RPC:', rpcResult.repayment_id, 'Journal:', rpcResult.journal_id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employeeAdvances'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['cashFlow'] });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
    }
  });

  const deleteAdvance = useMutation({
    mutationFn: async (advanceToDelete: EmployeeAdvance): Promise<void> => {
      if (!currentBranch?.id) throw new Error('Branch ID is required');

      console.log('🗑️ Voiding Advance via RPC...', advanceToDelete.id);

      const { data: rpcResultRaw, error: rpcError } = await supabase
        .rpc('void_employee_advance_atomic', {
          p_branch_id: currentBranch.id,
          p_advance_id: advanceToDelete.id,
          p_reason: 'Dihapus oleh user'
        });

      if (rpcError) {
        console.error('❌ RPC Error:', rpcError);
        throw new Error(`Gagal menghapus panjar: ${rpcError.message}`);
      }

      const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;
      if (!rpcResult?.success) {
        throw new Error(rpcResult?.error_message || 'Gagal menghapus panjar');
      }

      console.log('✅ Advance Deleted & Journals Voided:', rpcResult.journals_voided);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employeeAdvances'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['cashFlow'] });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
    }
  });

  return {
    advances,
    isLoading,
    isError,
    error,
    addAdvance,
    addRepayment,
    deleteAdvance,
  }
}