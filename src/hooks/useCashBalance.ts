import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranch } from '@/contexts/BranchContext';
import { useTimezone } from '@/contexts/TimezoneContext';
import { getOfficeDateString } from '@/utils/officeTime';

interface CashBalance {
  currentBalance: number;
  todayIncome: number;
  todayExpense: number;
  todayNet: number;
  previousBalance: number;
  accountBalances: Array<{
    accountId: string;
    accountName: string;
    accountCode: string;
    currentBalance: number;
    previousBalance: number;
    todayIncome: number;
    todayExpense: number;
    todayNet: number;
    todayChange: number;
  }>;
}

/**
 * useCashBalance - Menghitung saldo kas dari JOURNAL ENTRIES via RPC
 * 
 * ARSITEKTUR BARU (Feb 2026):
 * - Menggunakan function SQL `get_cash_balance_summary`
 * - Prinsip: MAJU (Forward Calculation)
 * - Saldo Awal = SUM(Transaksi < Hari Ini) -> Dihitung oleh DB
 * - Mutasi Hari Ini = SUM(Transaksi = Hari Ini) -> Dihitung oleh DB
 * - Saldo Akhir = Saldo Awal + Mutasi Hari Ini
 */
export const useCashBalance = () => {
  const { currentBranch } = useBranch();
  const { timezone } = useTimezone();

  const { data: cashBalance, isLoading, error } = useQuery<CashBalance>({
    queryKey: ['cashBalance', currentBranch?.id, timezone],
    queryFn: async () => {
      if (!currentBranch?.id) throw new Error('Branch required');

      // Get today's date in office timezone (YYYY-MM-DD)
      const todayStr = getOfficeDateString(timezone);

      // Call the RPC function
      // It returns: opening_balance (< today), today_income, today_expense, today_net, current_balance
      const { data, error } = await supabase.rpc('get_cash_balance_summary', {
        p_branch_id: currentBranch.id,
        p_date: todayStr
      });

      if (error) {
        console.error('Error fetching cash balance:', error);
        throw error;
      }

      // Map response format
      let totalCurrentBalance = 0;
      let totalPreviousBalance = 0;
      let totalTodayIncome = 0;
      let totalTodayExpense = 0;

      const accountBalances = (data || []).map((row: any) => {
        const currentBal = Number(row.current_balance) || 0;
        const prevBal = Number(row.opening_balance) || 0;
        const income = Number(row.today_income) || 0;
        const expense = Number(row.today_expense) || 0;
        const net = Number(row.today_net) || 0;

        totalCurrentBalance += currentBal;
        totalPreviousBalance += prevBal;
        totalTodayIncome += income;
        totalTodayExpense += expense;

        return {
          accountId: row.account_id,
          accountName: row.account_name,
          accountCode: row.account_code,
          currentBalance: currentBal,
          previousBalance: prevBal,
          todayIncome: income,
          todayExpense: expense,
          todayNet: net,
          todayChange: net
        };
      });

      return {
        currentBalance: totalCurrentBalance,
        previousBalance: totalPreviousBalance,
        todayIncome: totalTodayIncome,
        todayExpense: totalTodayExpense,
        todayNet: totalTodayIncome - totalTodayExpense,
        accountBalances
      };
    },
    enabled: !!currentBranch,
    staleTime: 1000 * 30, // 30 seconds cache
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  return {
    cashBalance,
    isLoading,
    error
  };
};
