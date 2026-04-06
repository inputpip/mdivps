import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Account } from '@/types/account'
import { supabase } from '@/integrations/supabase/client'
import { useBranch } from '@/contexts/BranchContext'

// Helper to map from DB (snake_case) to App (camelCase)
const fromDbToApp = (dbAccount: any): Account => ({
  id: dbAccount.id,
  name: dbAccount.name,
  type: dbAccount.type,
  balance: Number(dbAccount.total_balance) || 0,
  initialBalance: Number(dbAccount.total_initial_balance) || 0,
  isPaymentAccount: dbAccount.is_payment_account,
  createdAt: new Date(dbAccount.created_at),

  // Enhanced Chart of Accounts fields
  code: dbAccount.code || undefined,
  parentId: dbAccount.parent_id || undefined,
  level: dbAccount.level || 1,
  isHeader: dbAccount.is_header || false,
  isActive: dbAccount.is_active !== false,
  sortOrder: dbAccount.sort_order || 0,
  branchId: dbAccount.branch_id || undefined,

  // Employee assignment for cash accounts
  employeeId: dbAccount.employee_id || undefined,
  employeeName: dbAccount.employee_name || dbAccount.employee_full_name || undefined,
});

export const useAccounts = () => {
  const queryClient = useQueryClient()
  const { currentBranch } = useBranch()

  const { data: accounts, isLoading } = useQuery<Account[]>({
    queryKey: ['accounts', currentBranch?.id],
    queryFn: async () => {
      // Get accounts for current branch only
      let accountsQuery = supabase
        .from('v_coa_saldosaatini')
        .select('*');

      if (currentBranch?.id) {
        accountsQuery = accountsQuery.eq('branch_id', currentBranch.id);
      }

      const { data: accountsData, error } = await accountsQuery.order('code');

      if (error) throw new Error(error.message);

      // Simply return accounts. Balance is now auto-updated by DB trigger.
      return accountsData ? accountsData.map(fromDbToApp) : [];
    },
    enabled: !!currentBranch,
    staleTime: 1000 * 60, // 1 minute stale time is fine now since DB is source of truth
    refetchOnMount: true,
    refetchOnWindowFocus: true, // Auto refetch on focus to get latent updates if any
    retry: 1,
  })

  // CREATE ACCOUNT - RPC
  const addAccount = useMutation({
    mutationFn: async (newAccountData: Omit<Account, 'id' | 'createdAt'>): Promise<Account> => {
      if (!currentBranch?.id) throw new Error('Branch required');

      const { data: rpcResultRaw, error } = await supabase.rpc('create_account', {
        p_branch_id: currentBranch.id,
        p_name: newAccountData.name,
        p_code: newAccountData.code || '',
        p_type: newAccountData.type,
        p_initial_balance: newAccountData.initialBalance ?? newAccountData.balance ?? 0,
        p_is_payment_account: newAccountData.isPaymentAccount ?? false,
        p_parent_id: newAccountData.parentId || null,
        p_level: newAccountData.level ?? 1,
        p_is_header: newAccountData.isHeader ?? false,
        p_sort_order: newAccountData.sortOrder ?? 0,
        p_employee_id: newAccountData.employeeId || null
      });

      if (error) throw error;

      const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;
      if (!rpcResult?.success) throw new Error(rpcResult?.error_message || 'Failed to create account');

      // Fetch created account to return proper object
      const { data: createdRaw } = await supabase.from('accounts').select('*').eq('id', rpcResult.account_id).single();
      return fromDbToApp(createdRaw);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });

  // UPDATE ACCOUNT - RPC
  const updateAccount = useMutation({
    mutationFn: async ({ accountId, newData }: { accountId: string, newData: Partial<Account> }) => {
      if (!currentBranch?.id) throw new Error('Branch required');

      const { data: existing } = await supabase.from('accounts').select('*').eq('id', accountId).single();
      if (!existing) throw new Error('Account not found');

      const p_name = newData.name ?? existing.name;
      const p_code = newData.code ?? existing.code;
      const p_type = newData.type ?? existing.type;
      const p_initial = newData.initialBalance ?? existing.initial_balance;
      const p_pay = newData.isPaymentAccount ?? existing.is_payment_account;
      const p_parent = newData.parentId !== undefined ? (newData.parentId || null) : existing.parent_id;
      const p_level = newData.level ?? existing.level;
      const p_header = newData.isHeader ?? existing.is_header;
      const p_active = newData.isActive ?? existing.is_active;
      const p_sort = newData.sortOrder ?? existing.sort_order;
      const p_emp = newData.employeeId !== undefined ? (newData.employeeId || null) : existing.employee_id;

      const { data: rpcResultRaw, error } = await supabase.rpc('update_account', {
        p_account_id: accountId,
        p_branch_id: currentBranch.id,
        p_name,
        p_code: p_code || '',
        p_type,
        p_initial_balance: p_initial ?? 0,
        p_is_payment_account: p_pay ?? false,
        p_parent_id: p_parent ?? null,
        p_level: p_level ?? 1,
        p_is_header: p_header ?? false,
        p_is_active: p_active ?? true,
        p_sort_order: p_sort ?? 0,
        p_employee_id: p_emp ?? null
      });

      if (error) throw error;
      const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;
      if (!rpcResult?.success) throw new Error(rpcResult?.error_message || 'Failed to update account');

      return fromDbToApp({ ...existing, ...newData });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    }
  })

  // DELETE ACCOUNT - RPC
  const deleteAccount = useMutation({
    mutationFn: async (accountId: string): Promise<void> => {
      const { data: rpcResultRaw, error } = await supabase.rpc('delete_account', {
        p_account_id: accountId
      });

      if (error) throw error;
      const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;
      if (!rpcResult?.success) throw new Error(rpcResult?.error_message || 'Failed to delete account');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });

  // GET OPENING BALANCE
  const getOpeningBalance = useMutation({
    mutationFn: async (accountId: string): Promise<{ openingBalance: number; journalId: string | null; lastUpdated: string | null }> => {
      if (!currentBranch?.id) throw new Error('Branch required');

      const { data: rpcResultRaw, error } = await supabase.rpc('get_account_opening_balance', {
        p_account_id: accountId,
        p_branch_id: currentBranch.id
      });

      if (error) {
        console.error('[getOpeningBalance] RPC error:', error);
        throw new Error(error.message);
      }

      const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;
      return {
        openingBalance: Number(rpcResult?.opening_balance) || 0,
        journalId: rpcResult?.journal_id || null,
        lastUpdated: rpcResult?.last_updated || null
      };
    }
  });

  // UPDATE INITIAL BALANCE
  const updateInitialBalance = useMutation({
    mutationFn: async ({ accountId, initialBalance }: { accountId: string, initialBalance: number }): Promise<void> => {
      if (!currentBranch?.id) throw new Error('Branch required');

      console.log('[updateInitialBalance] Calling RPC:', { accountId, initialBalance });

      const { data: rpcResultRaw, error } = await supabase.rpc('update_account_initial_balance_atomic', {
        p_account_id: accountId,
        p_new_initial_balance: initialBalance,
        p_branch_id: currentBranch.id
      });

      if (error) {
        console.error('[updateInitialBalance] RPC error:', error);
        throw new Error(error.message);
      }

      const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;
      if (!rpcResult?.success) {
        throw new Error(rpcResult?.error_message || 'Failed to update initial balance');
      }

      console.log('[updateInitialBalance] Success, journal id:', rpcResult.journal_id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
      queryClient.invalidateQueries({ queryKey: ['openingBalances'] });
    },
  });

  // MOVE ACCOUNT
  const moveAccount = useMutation({
    mutationFn: async ({ accountId, newParentId, newSortOrder }: {
      accountId: string,
      newParentId?: string,
      newSortOrder?: number
    }) => {
      return updateAccount.mutateAsync({
        accountId,
        newData: {
          parentId: newParentId,
          sortOrder: newSortOrder
        }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    }
  });

  // BULK UPDATE
  const bulkUpdateAccountCodes = useMutation({
    mutationFn: async (updates: Array<{ accountId: string, code: string, sortOrder?: number }>) => {
      const promises = updates.map(u =>
        updateAccount.mutateAsync({
          accountId: u.accountId,
          newData: { code: u.code, sortOrder: u.sortOrder }
        })
      );
      await Promise.all(promises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    }
  });

  // IMPORT STANDARD COA
  const importStandardCoA = useMutation({
    mutationFn: async (coaTemplate: Array<any>) => {
      if (!currentBranch?.id) throw new Error('Branch required');

      const simplifiedTemplate = coaTemplate.map(t => ({
        code: t.code,
        name: t.name,
        type: t.type,
        level: t.level,
        isHeader: t.isHeader,
        sortOrder: t.sortOrder,
        parentCode: t.parentCode
      }));

      const { data: rpcResultRaw, error } = await supabase.rpc('import_standard_coa', {
        p_branch_id: currentBranch.id,
        p_items: simplifiedTemplate
      });

      if (error) throw error;
      const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;
      if (!rpcResult?.success) throw new Error(rpcResult?.error_message || 'Import failed');

      return rpcResult.imported_count;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    }
  });

  const getAccountsHierarchy = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('v_coa_saldosaatini')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (error) throw new Error(error.message);
      return data ? data.map(fromDbToApp) : [];
    },
  });

  const getAccountBalance = useMutation({
    mutationFn: async (accountId: string, includeChildren = false) => {
      if (!includeChildren) {
        const { data: dataRaw, error } = await supabase
          .from('v_coa_saldosaatini')
          .select('total_balance')
          .eq('id', accountId)
          .single();
        if (error) throw error;
        return Number(dataRaw?.total_balance) || 0;
      }

      const { data, error } = await supabase
        .rpc('get_account_balance_with_children', { account_id: accountId });
      if (error) throw error;
      return Number(data) || 0;
    }
  });

  const getEmployeeCashAccount = (employeeId: string): Account | undefined => {
    if (!accounts) return undefined;
    return accounts.find(acc =>
      acc.isPaymentAccount &&
      acc.employeeId === employeeId &&
      acc.isActive !== false
    );
  };

  const getCashAccountsWithEmployees = (): Account[] => {
    if (!accounts) return [];
    return accounts.filter(acc =>
      acc.isPaymentAccount &&
      !acc.isHeader &&
      acc.isActive !== false
    );
  };

  const getUnassignedCashAccounts = (): Account[] => {
    if (!accounts) return [];
    return accounts.filter(acc =>
      acc.isPaymentAccount &&
      !acc.isHeader &&
      !acc.employeeId &&
      acc.isActive !== false
    );
  };

  // SYNC ACCOUNT BALANCES - Removed as redundant, DB trigger handles it.
  // Kept interface compatible but does nothing/returns empty.
  const syncAccountBalances = useMutation({
    mutationFn: async (): Promise<{
      updated: number;
      branchId: string;
      branchName: string;
      details: Array<any>;
    }> => {
      // No-op
      return {
        updated: 0,
        branchId: currentBranch?.id || '',
        branchName: currentBranch?.name || '',
        details: []
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    }
  });

  return {
    accounts,
    isLoading,
    addAccount,
    updateAccount,
    updateInitialBalance,
    getOpeningBalance,
    deleteAccount,
    getAccountsHierarchy,
    moveAccount,
    bulkUpdateAccountCodes,
    importStandardCoA,
    getAccountBalance,
    getEmployeeCashAccount,
    getCashAccountsWithEmployees,
    getUnassignedCashAccounts,
    syncAccountBalances,
  }
}