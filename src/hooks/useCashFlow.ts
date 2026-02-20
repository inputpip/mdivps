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

      // Get journal entry lines for payment accounts
      const { data: journalLines, error: journalError } = await supabase
        .from('journal_entry_lines')
        .select(`
          id,
          account_id,
          account_code,
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
            created_at,
            created_by
          )
        `)
        .in('account_id', paymentAccountIds);

      if (journalError) {
        console.error('❌ Failed to fetch journal lines for cash flow:', journalError);
        return [];
      }

      // Filter only posted and not voided journals for current branch
      const filteredLines = (journalLines || []).filter((line: any) => {
        const journal = line.journal_entries;
        if (!journal) return false;
        return journal.status === 'posted' &&
          journal.is_voided === false &&
          journal.branch_id === currentBranch?.id;
      });

      // Sort by created_at descending
      filteredLines.sort((a: any, b: any) => {
        const dateA = new Date(a.journal_entries?.created_at || 0);
        const dateB = new Date(b.journal_entries?.created_at || 0);
        return dateB.getTime() - dateA.getTime();
      });

      // Collect reference IDs by type for batch fetching
      const refIdsByType: Record<string, string[]> = {};
      filteredLines.forEach((line: any) => {
        const journal = line.journal_entries;
        if (journal?.reference_id && journal?.reference_type) {
          if (!refIdsByType[journal.reference_type]) {
            refIdsByType[journal.reference_type] = [];
          }
          if (!refIdsByType[journal.reference_type].includes(journal.reference_id)) {
            refIdsByType[journal.reference_type].push(journal.reference_id);
          }
        }
      });

      // Map to store reference numbers and detailed information
      const refNumberMap: Record<string, string> = {};
      const refDetailMap: Record<string, { label?: string, description?: string }> = {};

      // Fetch transaction details
      if (refIdsByType['transaction']?.length) {
        const { data: transactions } = await supabase
          .from('transactions')
          .select('id, customer_name')
          .in('id', refIdsByType['transaction']);
        transactions?.forEach((t: any) => {
          refNumberMap[t.id] = t.id;
          refDetailMap[t.id] = { label: `Order ${t.id}`, description: `Penjualan ke ${t.customer_name}` };
        });
      }

      // Fetch expense details
      if (refIdsByType['expense']?.length) {
        const { data: expenses } = await supabase
          .from('expenses')
          .select('id, description')
          .in('id', refIdsByType['expense']);
        expenses?.forEach((e: any) => {
          refNumberMap[e.id] = e.id;
          refDetailMap[e.id] = { description: e.description };
        });
      }

      // Fetch employee advance details
      // Filter hanya UUID valid (ada ID lama format 'adv-XXXXXX' yang bukan UUID)
      if (refIdsByType['advance']?.length) {
        const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const validAdvanceIds = refIdsByType['advance'].filter(id => UUID_REGEX.test(id));
        if (validAdvanceIds.length > 0) {
          const { data: advances } = await supabase
            .from('employee_advances')
            .select('id, employee_name')
            .in('id', validAdvanceIds);
          advances?.forEach((a: any) => {
            refNumberMap[a.id] = a.id;
            refDetailMap[a.id] = { description: `Panjar karyawan: ${a.employee_name || 'Tidak diketahui'}` };
          });
        }
      }

      // Fetch payroll details
      // Dibungkus try-catch karena tabel payroll_periods tidak ada di semua database (mkw_db)
      if (refIdsByType['payroll']?.length) {
        try {
          const { data: payrolls, error: payrollError } = await supabase
            .from('payroll_periods')
            .select('id, name')
            .in('id', refIdsByType['payroll']);
          if (!payrollError) {
            payrolls?.forEach((p: any) => {
              refNumberMap[p.id] = p.name || p.id;
            });
          }
        } catch {
          // Tabel payroll_periods tidak ada di database ini (e.g. mkw_db) — skip
        }
      }

      // Fetch payable details
      if (refIdsByType['payable']?.length) {
        const { data: payables } = await supabase
          .from('accounts_payable')
          .select('id, supplier_name')
          .in('id', refIdsByType['payable']);
        payables?.forEach((p: any) => {
          refDetailMap[p.id] = {
            label: `Bayar Hutang: ${p.id}`,
            description: `Pembayaran hutang ke ${p.supplier_name}`
          };
        });
      }

      // Fetch receivable payment details (to get customer names for payments)
      if (refIdsByType['receivable']?.length) {
        const { data: payments } = await supabase
          .from('payment_history')
          .select('id, transaction_id, transactions(customer_name)')
          .in('id', refIdsByType['receivable']);

        payments?.forEach((p: any) => {
          const customerName = p.transactions?.customer_name || 'Pelanggan';
          refDetailMap[p.id] = {
            label: `Bayar Piutang: ${p.transaction_id}`,
            description: `Penerimaan piutang dari ${customerName}`
          };
        });
      }

      // Transform to CashHistory format
      // For payment accounts: Debit = kas masuk (income), Credit = kas keluar (expense)
      const cashHistoryData: CashHistory[] = filteredLines.map((line: any) => {
        const journal = line.journal_entries;
        const debitAmount = Number(line.debit_amount) || 0;
        const creditAmount = Number(line.credit_amount) || 0;

        // Determine if this is income or expense
        const isIncome = debitAmount > 0;
        const amount = isIncome ? debitAmount : creditAmount;

        // Map reference_type to old type format for compatibility
        const typeMap: Record<string, CashHistory['type']> = {
          'transaction': 'orderan',
          'expense': 'pengeluaran',
          'payroll': 'gaji_karyawan',
          'advance': 'panjar_pengambilan',
          'transfer': isIncome ? 'transfer_masuk' : 'transfer_keluar',
          'receivable': 'pembayaran_piutang',
          'payable': 'pembayaran_hutang',
          'manual': isIncome ? 'kas_masuk_manual' : 'kas_keluar_manual',
        };

        const refId = journal.reference_id;
        const detail = refId ? refDetailMap[refId] : null;

        // Determine specialized description
        let finalDescription = line.description || journal.description;
        if (detail?.description) {
          finalDescription = detail.description;
        }

        // Get the actual transaction number from source table
        const sourceRefNumber = journal.reference_id ? refNumberMap[journal.reference_id] : null;

        return {
          id: line.id,
          account_id: line.account_id,
          account_name: line.account_name || accountMap.get(line.account_id)?.name || 'Unknown',
          type: typeMap[journal.reference_type] || (isIncome ? 'kas_masuk_manual' : 'kas_keluar_manual'),
          transaction_type: isIncome ? 'income' : 'expense',
          amount: amount,
          description: finalDescription,
          reference_id: journal.reference_id,
          // Prioritas: label dari detail > nomor dari tabel sumber > entry_number
          reference_number: detail?.label || sourceRefNumber || journal.entry_number,
          created_at: journal.created_at,
          created_by: journal.created_by,
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
