export interface Expense {
  id: string;
  description: string;
  amount: number;
  accountId?: string; // Payment account (kas/bank)
  accountName?: string; // Payment account name
  expenseAccountId?: string; // 6000 series expense account
  expenseAccountName?: string; // Expense account name (e.g. "Beban Operasional")
  date: Date;
  category: string;
  photoUrl?: string; // URL/Filename bukti foto
  createdAt: Date;
}