// Types untuk Jurnal Umum (General Journal)

export interface JournalEntry {
  id: string;
  entryNumber: string;
  entryDate: Date;
  entryTime?: string; // Format: HH:mm:ss atau HH:mm
  description: string;
  referenceType?: 'transaction' | 'expense' | 'payroll' | 'transfer' | 'manual' | 'adjustment' | 'closing' | 'opening';
  referenceId?: string;
  status: 'draft' | 'posted' | 'voided';
  totalDebit: number;
  totalCredit: number;
  createdBy?: string;
  createdByName?: string;
  createdAt: Date;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: Date;
  isVoided: boolean;
  voidedBy?: string;
  voidedByName?: string;
  voidedAt?: Date;
  voidReason?: string;
  branchId?: string;
  lines: JournalEntryLine[];
}

export interface JournalEntryLine {
  id: string;
  journalEntryId: string;
  lineNumber: number;
  accountId: string;
  accountCode?: string;
  accountName?: string;
  debitAmount: number;
  creditAmount: number;
  description?: string;
  createdAt: Date;
}

export interface JournalEntryFormData {
  entryDate: Date;
  description: string;
  referenceType?: string;
  referenceId?: string;
  lines: JournalEntryLineFormData[];
}

export interface JournalEntryLineFormData {
  accountId: string;
  accountCode?: string;
  accountName?: string;
  debitAmount: number;
  creditAmount: number;
  description?: string;
}

// Database types (snake_case)
export interface DbJournalEntry {
  id: string;
  entry_number: string;
  entry_date: string;
  description: string;
  reference_type?: string;
  reference_id?: string;
  status: string;
  total_debit: number;
  total_credit: number;
  created_by?: string;
  created_by_name?: string;
  created_at: string;
  approved_by?: string;
  approved_by_name?: string;
  approved_at?: string;
  is_voided: boolean;
  voided_by?: string;
  voided_by_name?: string;
  voided_at?: string;
  voided_reason?: string;
  branch_id?: string;
}

export interface DbJournalEntryLine {
  id: string;
  journal_entry_id: string;
  line_number: number;
  account_id: string;
  account_code?: string;
  account_name?: string;
  debit_amount: number;
  credit_amount: number;
  description?: string;
  created_at: string;
}
