import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranch } from '@/contexts/BranchContext';
import { useAccounts } from '@/hooks/useAccounts';
import { startOfDay, endOfDay, format } from 'date-fns';

export interface DailyReportData {
  totalSales: number;
  cashIn: number;
  cashOut: number;
  netCash: number;
  salesSummary: {
    totalCash: number;
    totalCredit: number;
    totalSales: number;
    transactionCount: number;
  };
  cashFlowByAccount: Array<{
    accountName: string;
    cashIn: number;
    cashOut: number;
  }>;
  transactions: Array<{
    id: string;
    orderNumber: string;
    time: string;
    customerName: string;
    total: number;
    paidAmount: number;
    remaining: number;
    paymentStatus: string;
    cashierName: string;
  }>;
}

/**
 * useDailyReport - Mengambil laporan harian dari JOURNAL ENTRIES
 *
 * ARSITEKTUR BARU:
 * - Cash flow diambil dari journal_entry_lines untuk akun kas/bank
 * - TIDAK LAGI menggunakan cash_history table
 */
export function useDailyReport(selectedDate: Date) {
  const { currentBranch } = useBranch();
  const { accounts } = useAccounts();

  const {
    data: dailyReport,
    isLoading,
    error
  } = useQuery({
    queryKey: ['dailyReport', format(selectedDate, 'yyyy-MM-dd'), currentBranch?.id, accounts?.length],
    queryFn: async (): Promise<DailyReportData> => {
      const startDate = startOfDay(selectedDate);
      const endDate = endOfDay(selectedDate);

      // Fetch transactions for the selected date
      let transactionsQuery = supabase
        .from('transactions')
        .select('*')
        .gte('order_date', startDate.toISOString())
        .lte('order_date', endDate.toISOString())
        .eq('is_voided', false)
        .eq('is_cancelled', false)
        .order('created_at', { ascending: false });

      // Apply branch filter - ALWAYS filter by selected branch
      if (currentBranch?.id) {
        transactionsQuery = transactionsQuery.eq('branch_id', currentBranch.id);
      }

      const { data: transactions, error: transactionError } = await transactionsQuery;

      if (transactionError) {
        throw new Error(`Failed to fetch transactions: ${transactionError.message}`);
      }

      // Get payment accounts (kas/bank)
      const paymentAccounts = (accounts || []).filter(acc => acc.isPaymentAccount);
      const paymentAccountIds = paymentAccounts.map(acc => acc.id);
      const accountMap = new Map(paymentAccounts.map(acc => [acc.id, acc]));

      let cashIn = 0;
      let cashOut = 0;
      const cashFlowByAccountMap = new Map<string, { accountName: string; cashIn: number; cashOut: number }>();

      if (paymentAccountIds.length > 0) {
        // Fetch cash flow from journal_entry_lines for payment accounts
        const { data: journalLines, error: journalError } = await supabase
          .from('journal_entry_lines')
          .select(`
            id,
            account_id,
            account_name,
            debit_amount,
            credit_amount,
            journal_entries (
              id,
              entry_date,
              status,
              is_voided,
              branch_id,
              created_at
            )
          `)
          .in('account_id', paymentAccountIds);

        if (journalError) {
          console.error('Failed to fetch journal lines for daily report:', journalError);
        } else {
          // Filter: posted, not voided, current branch, within date range
          const filteredLines = (journalLines || []).filter((line: any) => {
            const journal = line.journal_entries;
            if (!journal) return false;

            const journalDate = new Date(journal.created_at);
            const isPosted = journal.status === 'posted';
            const isNotVoided = journal.is_voided === false;
            const isCurrentBranch = journal.branch_id === currentBranch?.id;
            const isInDateRange = journalDate >= startDate && journalDate <= endDate;

            return isPosted && isNotVoided && isCurrentBranch && isInDateRange;
          });

          // Calculate cash in/out
          // For payment accounts: Debit = kas masuk (income), Credit = kas keluar (expense)
          filteredLines.forEach((line: any) => {
            const debitAmount = Number(line.debit_amount) || 0;
            const creditAmount = Number(line.credit_amount) || 0;
            const account = accountMap.get(line.account_id);
            const accountName = line.account_name || account?.name || 'Unknown Account';

            // Update totals
            cashIn += debitAmount;
            cashOut += creditAmount;

            // Update per-account breakdown
            if (!cashFlowByAccountMap.has(accountName)) {
              cashFlowByAccountMap.set(accountName, { accountName, cashIn: 0, cashOut: 0 });
            }
            const accountData = cashFlowByAccountMap.get(accountName)!;
            accountData.cashIn += debitAmount;
            accountData.cashOut += creditAmount;
          });
        }
      }

      const netCash = cashIn - cashOut;

      // Calculate totals from transactions
      const totalSales = transactions?.reduce((sum, t) => sum + (t.total || 0), 0) || 0;
      const totalCash = transactions?.reduce((sum, t) => sum + (t.paid_amount || 0), 0) || 0;
      const totalCredit = totalSales - totalCash;
      const transactionCount = transactions?.length || 0;

      // Convert map to array
      const cashFlowByAccount = Array.from(cashFlowByAccountMap.values());

      // Format transaction data for display
      const formattedTransactions = transactions?.map(t => ({
        id: t.id,
        orderNumber: t.id,
        time: format(new Date(t.order_date), 'HH:mm'),
        customerName: t.customer_name || 'Unknown',
        total: t.total || 0,
        paidAmount: t.paid_amount || 0,
        remaining: (t.total || 0) - (t.paid_amount || 0),
        paymentStatus: t.payment_status || 'Belum Lunas',
        cashierName: t.cashier_name || 'Unknown',
      })) || [];

      return {
        totalSales,
        cashIn,
        cashOut,
        netCash,
        salesSummary: {
          totalCash,
          totalCredit,
          totalSales,
          transactionCount,
        },
        cashFlowByAccount,
        transactions: formattedTransactions,
      };
    },
    enabled: !!currentBranch && !!accounts,
    refetchOnMount: true,
  });

  return {
    data: dailyReport,
    isLoading,
    error
  };
}
