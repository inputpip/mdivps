export interface CashHistory {
  id: string;
  account_id: string;
  account_name?: string;
  // Support both old and new formats
  type?: 'orderan' | 'kas_masuk_manual' | 'kas_keluar_manual' | 'panjar_pengambilan' | 'panjar_pelunasan' | 'pengeluaran' | 'pembayaran_po' | 'pembayaran_piutang' | 'transfer_masuk' | 'transfer_keluar' | 'gaji_karyawan' | 'pembayaran_gaji' | 'pembayaran_hutang';
  transaction_type?: 'income' | 'expense';
  source_type?: string;
  amount: number;
  description: string;
  reference_id?: string;
  reference_name?: string;
  reference_number?: string;
  user_id?: string;
  user_name?: string;
  created_by?: string;
  created_by_name?: string;
  created_at: string;
  updated_at?: string;
  // Added for COA integration
  expense_account_id?: string;
  expense_account_name?: string;
  previous_balance?: number;
  after_balance?: number;
}

export type CashFlowType = 'income' | 'expense';

export interface CashFlowSummary {
  totalIncome: number;
  totalExpense: number;
  netFlow: number;
}