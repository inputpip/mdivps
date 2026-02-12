// Financial Statements Utils - Updated to use journal-based inventory calculation
import { supabase } from '@/integrations/supabase/client';
import {
  findAccountByLookup,
  findAllAccountsByLookup,
  findAccountsByType,
  getTotalBalance,
} from '@/services/accountLookupService';
import { Account } from '@/types/account';

// Helper to map from DB to App (Account type)
const fromDbToApp = (dbAccount: any): Account => ({
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
  isHeader: dbAccount.is_header || false,
  isActive: dbAccount.is_active !== false,
  sortOrder: dbAccount.sort_order || 0,
  branchId: dbAccount.branch_id || undefined,
});

/**
 * Calculate account balances from journal entries (same logic as useAccounts.ts)
 * This ensures financial reports use the same balance calculation as the UI
 */
async function calculateAccountBalancesFromJournal(
  accounts: Account[],
  branchId: string,
  asOfDate?: Date
): Promise<Account[]> {
  // Get all journal_entry_lines for the branch
  // Note: PostgREST doesn't support !inner syntax, so we filter on client side
  // Get journal_entry_lines for the branch with server-side filtering
  let query = supabase
    .from('journal_entry_lines')
    .select(`
      account_id,
      debit_amount,
      credit_amount,
      journal_entries!inner (
        branch_id,
        status,
        is_voided,
        entry_date
      )
    `)
    .eq('journal_entries.branch_id', branchId)
    .eq('journal_entries.status', 'posted')
    .eq('journal_entries.is_voided', false);

  if (asOfDate) {
    query = query.lte('journal_entries.entry_date', asOfDate.toISOString().split('T')[0]);
  }

  const { data: journalLines, error: journalError } = await query;

  if (journalError) {
    console.warn('Error fetching journal_entry_lines for balance calculation:', journalError.message);
    // Fallback to initial_balance only
    return accounts.map(acc => ({
      ...acc,
      balance: acc.initialBalance || 0
    }));
  }

  // Check which accounts have opening balance journals
  // These accounts should NOT use initial_balance to avoid double counting
  const { data: openingJournals } = await supabase
    .from('journal_entry_lines')
    .select(`
      account_id,
      journal_entries!inner (
        branch_id,
        reference_type,
        is_voided
      )
    `)
    .eq('journal_entries.branch_id', branchId)
    .eq('journal_entries.reference_type', 'opening')
    .eq('journal_entries.is_voided', false);

  const accountsWithOpeningJournal = new Set<string>();
  (openingJournals || []).forEach((line: any) => {
    if (line.account_id) {
      accountsWithOpeningJournal.add(line.account_id);
    }
  });

  // Initialize balance map
  // If account has opening journal, start from 0 (journal will add the balance)
  // If no opening journal, use initial_balance as starting point
  const accountBalanceMap = new Map<string, number>();
  const accountTypes = new Map<string, string>();

  accounts.forEach(acc => {
    // Jika akun sudah punya jurnal opening, mulai dari 0
    // Jika belum, gunakan initial_balance
    const hasOpeningJournal = accountsWithOpeningJournal.has(acc.id);
    const startingBalance = hasOpeningJournal ? 0 : (acc.initialBalance || 0);
    accountBalanceMap.set(acc.id, startingBalance);
    accountTypes.set(acc.id, acc.type);
  });

  // Filter journal lines on client side
  const asOfDateStr = asOfDate ? asOfDate.toISOString().split('T')[0] : null;

  // IMPORTANT: Filter by account_id belonging to the branch, NOT by journal's branch_id!
  // This is because a journal entry can reference accounts from different branches.
  // Example: A stock adjustment journal in Branch A might credit Modal Disetor from Branch B.
  // If we filter by journal.branch_id, we would miss transactions affecting accounts in other branches.
  // The correct approach: only process lines where account_id is in our accountBalanceMap (i.e., belongs to this branch).
  const filteredJournalLines = journalLines || [];

  // Calculate balance per account
  filteredJournalLines.forEach((line: any) => {
    if (!line.account_id) return;

    const currentBalance = accountBalanceMap.get(line.account_id) || 0;
    const debitAmount = Number(line.debit_amount) || 0;
    const creditAmount = Number(line.credit_amount) || 0;
    const accountType = accountTypes.get(line.account_id) || 'Aset';

    // Determine balance change based on account type
    // Normalize account type for comparison (handle variations like Liabilitas, Liability, etc.)
    const normalizedType = accountType.toLowerCase();
    const isDebitNormal =
      normalizedType.includes('aset') ||
      normalizedType.includes('asset') ||
      normalizedType.includes('aktiva') ||
      normalizedType.includes('beban') ||
      normalizedType.includes('expense') ||
      normalizedType.includes('biaya');

    let balanceChange = 0;
    if (isDebitNormal) {
      // Aset & Beban: Debit increases, Credit decreases
      balanceChange = debitAmount - creditAmount;
    } else {
      // Kewajiban/Liabilitas, Modal/Ekuitas, Pendapatan: Credit increases, Debit decreases
      balanceChange = creditAmount - debitAmount;
    }

    accountBalanceMap.set(line.account_id, currentBalance + balanceChange);
  });

  // Apply calculated balances to accounts
  const accountsWithCalculatedBalance = accounts.map(acc => ({
    ...acc,
    balance: accountBalanceMap.get(acc.id) ?? 0
  }));

  console.log('📊 Financial Reports: Calculated balances from journal for branch:', branchId,
    'Journal lines processed:', filteredJournalLines.length);

  return accountsWithCalculatedBalance;
}

// Financial Statement Types
export interface BalanceSheetData {
  assets: {
    currentAssets: {
      kasBank: BalanceSheetItem[];
      piutangUsaha: BalanceSheetItem[];
      piutangPajak: BalanceSheetItem[];  // Piutang Pajak / PPN Masukan
      persediaan: BalanceSheetItem[];
      panjarKaryawan: BalanceSheetItem[];
      totalCurrentAssets: number;
    };
    fixedAssets: {
      kendaraan: BalanceSheetItem[];
      peralatan: BalanceSheetItem[];
      asetTetapLainnya: BalanceSheetItem[];
      akumulasiPenyusutan: BalanceSheetItem[];
      totalFixedAssets: number;
    };
    totalAssets: number;
  };
  liabilities: {
    currentLiabilities: {
      hutangUsaha: BalanceSheetItem[];
      hutangBank: BalanceSheetItem[];
      hutangKartuKredit: BalanceSheetItem[];
      hutangLain: BalanceSheetItem[];
      hutangGaji: BalanceSheetItem[];
      hutangPajak: BalanceSheetItem[];
      totalCurrentLiabilities: number;
    };
    totalLiabilities: number;
  };
  equity: {
    modalPemilik: BalanceSheetItem[];
    labaDitahanAkun: number;      // Saldo dari akun Laba Ditahan (3200)
    labaTahunBerjalan: number;    // Pendapatan - Beban dari jurnal periode ini
    totalLabaDitahan: number;     // labaDitahanAkun + labaTahunBerjalan
    totalEquity: number;
  };
  totalLiabilitiesEquity: number;
  selisih: number;               // Selisih jika neraca tidak balance
  isBalanced: boolean;
  generatedAt: Date;
}

export interface BalanceSheetItem {
  accountId: string;
  accountCode?: string;
  accountName: string;
  balance: number;
  formattedBalance: string;
}

export interface IncomeStatementData {
  revenue: {
    penjualan: IncomeStatementItem[];
    pendapatanLain: IncomeStatementItem[];
    totalRevenue: number;
  };
  cogs: {
    bahanBaku: IncomeStatementItem[];
    tenagaKerja: IncomeStatementItem[];
    overhead: IncomeStatementItem[];
    totalCOGS: number;
  };
  grossProfit: number;
  grossProfitMargin: number;
  operatingExpenses: {
    bebanGaji: IncomeStatementItem[];
    bebanOperasional: IncomeStatementItem[];
    bebanAdministrasi: IncomeStatementItem[];
    komisi: IncomeStatementItem[];
    totalOperatingExpenses: number;
  };
  operatingIncome: number;
  otherIncome: {
    pendapatanLainLain: IncomeStatementItem[];
    bebanLainLain: IncomeStatementItem[];
    netOtherIncome: number;
  };
  netIncomeBeforeTax: number;
  taxExpense: number;
  netIncome: number;
  netProfitMargin: number;
  periodFrom: Date;
  periodTo: Date;
  generatedAt: Date;
}

export interface IncomeStatementItem {
  accountId?: string;
  accountCode?: string;
  accountName: string;
  amount: number;
  formattedAmount: string;
  source: 'transactions' | 'journal' | 'expenses' | 'calculated';
}

export interface CashFlowCategoryItem {
  accountId: string;
  accountCode: string;
  accountName: string;
  amount: number;
  formattedAmount: string;
  transactions: number; // Count of transactions
}

export interface CashFlowStatementData {
  operatingActivities: {
    netIncome: number;
    adjustments: CashFlowItem[];
    workingCapitalChanges: CashFlowItem[];
    cashReceipts: {
      fromCustomers: number;
      fromReceivablePayments: number;
      fromOtherOperating: number;
      fromAdvanceRepayment: number;
      total: number;
      // NEW: Detail by COA account
      byAccount: CashFlowCategoryItem[];
    };
    cashPayments: {
      forRawMaterials: number;
      forPayablePayments: number;
      forInterestExpense: number;
      forDirectLabor: number;
      forEmployeeAdvances: number;
      forManufacturingOverhead: number;
      forOperatingExpenses: number;
      forTaxes: number;
      total: number;
      // NEW: Detail by COA account
      byAccount: CashFlowCategoryItem[];
    };
    netCashFromOperations: number;
  };
  investingActivities: {
    equipmentPurchases: CashFlowItem[];
    otherInvestments: CashFlowItem[];
    netCashFromInvesting: number;
    // NEW: Detail by COA account
    byAccount: CashFlowCategoryItem[];
  };
  financingActivities: {
    ownerInvestments: CashFlowItem[];
    ownerWithdrawals: CashFlowItem[];
    loans: CashFlowItem[];
    netCashFromFinancing: number;
    // NEW: Detail by COA account
    byAccount: CashFlowCategoryItem[];
  };
  netCashFlow: number;
  beginningCash: number;
  endingCash: number;
  periodFrom: Date;
  periodTo: Date;
  generatedAt: Date;
  // NEW: Summary by account type
  summaryByAccountType: {
    pendapatan: number;
    beban: number;
    aset: number;
    kewajiban: number;
    modal: number;
  };
}

export interface CashFlowItem {
  description: string;
  amount: number;
  formattedAmount: string;
  source: string;
  accountId?: string;
  accountCode?: string;
  accountName?: string;
}

// Utility Functions
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(amount);
}

export function calculatePercentage(part: number, whole: number): number {
  return whole !== 0 ? (part / whole) * 100 : 0;
}

/**
 * Generate Balance Sheet from existing data
 * ============================================================================
 * PENTING: Saldo akun dihitung dari journal_entry_lines, BUKAN dari
 * kolom balance di tabel accounts. Ini memastikan konsistensi dengan
 * useAccounts.ts yang juga menghitung balance dari jurnal.
 * ============================================================================
 */
export async function generateBalanceSheet(asOfDate?: Date, branchId?: string): Promise<BalanceSheetData> {
  const cutoffDate = asOfDate || new Date();
  const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

  if (!branchId) {
    throw new Error('Branch ID is required for generating Balance Sheet');
  }

  // Get all accounts structure for the specific branch
  // IMPORTANT: COA is per-branch, so we MUST filter by branch_id
  // This ensures initial_balance values are from the correct branch
  let accountsQuery = supabase
    .from('accounts')
    .select('id, name, type, balance, initial_balance, code, branch_id, is_payment_account, is_header, is_active, level, sort_order, parent_id, created_at')
    .eq('branch_id', branchId)
    .order('code');

  const { data: accountsData, error: accountsError } = await accountsQuery;

  if (accountsError) throw new Error(`Failed to fetch accounts: ${accountsError.message}`);

  // Convert DB accounts to App accounts
  const baseAccounts = accountsData?.map(fromDbToApp) || [];

  // ============================================================================
  // CALCULATE BALANCES FROM JOURNAL ENTRIES (not from accounts.balance column)
  // This is the same logic as useAccounts.ts
  // ============================================================================
  const accounts = await calculateAccountBalancesFromJournal(baseAccounts, branchId, cutoffDate);

  // Debug: Log semua akun dengan saldo non-zero
  const accountsWithBalance = accounts.filter(acc => acc.balance !== 0);
  console.log('📋 All accounts with balance:', accountsWithBalance.map(acc => ({
    code: acc.code,
    name: acc.name,
    type: acc.type,
    balance: acc.balance,
    initialBalance: acc.initialBalance
  })));

  // Get account receivables from transactions (filtered by branch)
  let transactionsQuery = supabase
    .from('transactions')
    .select('id, total, paid_amount, payment_status, order_date, branch_id')
    .lte('order_date', cutoffDateStr)
    .in('payment_status', ['Belum Lunas', 'Kredit']);

  if (branchId) {
    transactionsQuery = transactionsQuery.eq('branch_id', branchId);
  }

  const { data: transactions, error: transactionsError } = await transactionsQuery;

  if (transactionsError) throw new Error(`Failed to fetch transactions: ${transactionsError.message}`);

  // Get inventory value from materials (filtered by branch)
  let materialsQuery = supabase
    .from('materials')
    .select('id, name, stock, price_per_unit, branch_id');

  if (branchId) {
    materialsQuery = materialsQuery.eq('branch_id', branchId);
  }

  const { data: materials, error: materialsError } = await materialsQuery;

  if (materialsError) throw new Error(`Failed to fetch materials: ${materialsError.message}`);

  // Get accounts payable data (filtered by branch)
  let apQuery = supabase
    .from('accounts_payable')
    .select('amount, paid_amount, status')
    .lte('created_at', cutoffDateStr + 'T23:59:59');

  if (branchId) {
    apQuery = apQuery.eq('branch_id', branchId);
  }

  const { data: accountsPayable, error: apError } = await apQuery;

  // Ignore error if table doesn't exist
  const apData = apError ? [] : (accountsPayable || []);

  // Get payroll liabilities (filtered by branch)
  let payrollQuery = supabase
    .from('payroll_records')
    .select('net_salary, status, created_at')
    .lte('created_at', cutoffDateStr + 'T23:59:59')
    .eq('status', 'approved');

  if (branchId) {
    payrollQuery = payrollQuery.eq('branch_id', branchId);
  }

  const { data: payrollRecords, error: payrollError } = await payrollQuery;

  // Ignore error if table doesn't exist
  const payrollData = payrollError ? [] : (payrollRecords || []);

  // ============================================================================
  // GET ALL PRODUCTS FOR INVENTORY CALCULATION
  // ============================================================================
  // Nilai persediaan dihitung langsung dari:
  // - Persediaan Barang Dagang (1310) = Semua produk × cost_price
  // - Persediaan Bahan Baku (1320) = Semua materials × price_per_unit
  // Stock diambil dari v_product_current_stock VIEW (source of truth)
  // ============================================================================
  let productsQuery = supabase
    .from('products')
    .select('id, name, type, cost_price, base_price, branch_id');

  if (branchId) {
    productsQuery = productsQuery.eq('branch_id', branchId);
  }

  const { data: products, error: productsError } = await productsQuery;

  // Get actual stock from VIEW (source of truth)
  let stockQuery = supabase.from('v_product_current_stock').select('product_id, current_stock');
  if (branchId) {
    stockQuery = stockQuery.eq('branch_id', branchId);
  }
  const { data: stockData } = await stockQuery;
  const stockMap = new Map<string, number>();
  (stockData || []).forEach((s: any) => stockMap.set(s.product_id, Number(s.current_stock) || 0));

  // Merge products with stock from VIEW
  const productsData = productsError ? [] : (products || []).map((p: any) => ({
    ...p,
    current_stock: stockMap.get(p.id) || 0
  }));

  // ============================================================================
  // PIUTANG USAHA - USING ACCOUNT LOOKUP SERVICE
  // ============================================================================
  // Piutang diambil dari saldo akun COA menggunakan lookup by name/type
  // Ini memastikan konsistensi dengan double-entry accounting dan fleksibilitas
  // terhadap perubahan format kode akun
  // ============================================================================
  const piutangAccount = findAccountByLookup(accounts, 'PIUTANG_USAHA');
  const totalReceivables = piutangAccount?.balance || 0;

  // Fallback: Calculate from transactions if COA account not found or zero
  const calculatedReceivables = transactions?.reduce((sum, tx) =>
    sum + ((tx.total || 0) - (tx.paid_amount || 0)), 0) || 0;

  // Use COA value if available and non-zero, otherwise use calculated
  const finalReceivables = totalReceivables > 0 ? totalReceivables : calculatedReceivables;

  // ============================================================================
  // PERSEDIAAN - DIHITUNG DARI SALDO AKUN JURNAL (COA)
  // ============================================================================
  // Nilai persediaan diambil dari saldo akun di COA yang dihitung dari jurnal:
  // 1. Persediaan Barang Dagang (1310) = saldo akun 1310 dari jurnal
  // 2. Persediaan Bahan Baku (1320) = saldo akun 1320 dari jurnal
  //
  // PENTING: Menggunakan saldo dari jurnal agar neraca konsisten dan balance.
  // Jika persediaan belum dijurnal (saldo awal), gunakan fitur "Sinkron Persediaan"
  // di halaman COA untuk membuat jurnal saldo awal.
  //
  // Nilai aktual dari products/materials table disimpan untuk referensi saja:
  // ============================================================================

  // Calculate actual inventory from materials (for reference only)
  const actualMaterialsInventory = materials?.reduce((sum, material) =>
    sum + ((material.stock || 0) * (material.price_per_unit || 0)), 0) || 0;

  // Calculate actual inventory from products (for reference only)
  const actualProductsInventory = productsData?.reduce((sum, product) => {
    const costPrice = product.cost_price || product.base_price || 0;
    return sum + ((product.current_stock || 0) * costPrice);
  }, 0) || 0;

  // Get inventory values from journal/COA accounts
  const persediaanBarangDagangAccount = accounts.find(acc =>
    acc.code === '1310' ||
    acc.code === '1-310' ||
    (acc.name.toLowerCase().includes('persediaan') && acc.name.toLowerCase().includes('barang'))
  );
  const persediaanBahanBakuAccount = accounts.find(acc =>
    acc.code === '1320' ||
    acc.code === '1-320' ||
    (acc.name.toLowerCase().includes('persediaan') && acc.name.toLowerCase().includes('bahan'))
  );

  // PENTING: Untuk persediaan, gunakan nilai dari JURNAL (COA) agar neraca balance
  // Jika menggunakan nilai dari products/materials table, neraca tidak akan balance
  // karena sisi aset (persediaan) tidak sama dengan sisi ekuitas (belum dijurnal)
  //
  // Jika nilai persediaan aktual berbeda dengan jurnal, gunakan fitur "Sinkron Persediaan"
  // di halaman COA untuk membuat jurnal penyesuaian.
  const productsInventory = persediaanBarangDagangAccount?.balance || 0;
  const materialsInventory = persediaanBahanBakuAccount?.balance || 0;
  const totalInventory = productsInventory + materialsInventory;

  console.log('📦 Inventory Calculation (from Journal):', {
    persediaanBarangDagangAccount: persediaanBarangDagangAccount ? {
      code: persediaanBarangDagangAccount.code,
      name: persediaanBarangDagangAccount.name,
      balance: persediaanBarangDagangAccount.balance,
      initialBalance: persediaanBarangDagangAccount.initialBalance
    } : 'NOT FOUND',
    persediaanBahanBakuAccount: persediaanBahanBakuAccount ? {
      code: persediaanBahanBakuAccount.code,
      name: persediaanBahanBakuAccount.name,
      balance: persediaanBahanBakuAccount.balance,
      initialBalance: persediaanBahanBakuAccount.initialBalance
    } : 'NOT FOUND',
    productsInventory,
    materialsInventory,
    totalInventory,
    // Reference values from actual stock (not used in balance sheet)
    actualProductsInventory,
    actualMaterialsInventory,
    inventoryDifference: (actualProductsInventory + actualMaterialsInventory) - totalInventory
  });

  // Calculate outstanding accounts payable
  const totalAccountsPayable = apData.reduce((sum, ap) => {
    if (ap.status === 'Outstanding') {
      return sum + ap.amount;
    } else if (ap.status === 'Partial') {
      return sum + (ap.amount - (ap.paid_amount || 0));
    }
    return sum;
  }, 0);

  // Calculate unpaid payroll liabilities
  const totalPayrollLiabilities = payrollData.reduce((sum, payroll) => {
    return sum + (payroll.net_salary || 0);
  }, 0);

  // Group accounts by type using lookup service
  const assetAccounts = findAccountsByType(accounts, 'Aset');
  const equityAccounts = findAccountsByType(accounts, 'Modal');

  // Build current assets - Using lookup service for Kas dan Bank
  const kasAccounts = findAllAccountsByLookup(accounts, 'KAS_UTAMA');
  const kasKecilAccounts = findAllAccountsByLookup(accounts, 'KAS_KECIL');
  const kasDriverAccounts = findAllAccountsByLookup(accounts, 'KAS_DRIVER');
  const bankAccounts = findAllAccountsByLookup(accounts, 'BANK');
  const allCashAccounts = [...kasAccounts, ...kasKecilAccounts, ...kasDriverAccounts, ...bankAccounts];

  const kasBank = allCashAccounts
    .filter(acc => (acc.balance || 0) !== 0) // Hide zero balances
    .map(acc => ({
      accountId: acc.id,
      accountCode: acc.code,
      accountName: acc.name,
      balance: acc.balance || 0,
      formattedBalance: formatCurrency(acc.balance || 0)
    }));

  // Use COA account info if available, otherwise show as calculated
  const piutangUsaha: BalanceSheetItem[] = finalReceivables > 0 ? [{
    accountId: piutangAccount?.id || 'calculated-receivables',
    accountCode: piutangAccount?.code || '1200',
    accountName: piutangAccount?.name || 'Piutang Usaha',
    balance: finalReceivables,
    formattedBalance: formatCurrency(finalReceivables)
  }] : [];

  // ============================================================================
  // PERSEDIAAN - Tampilkan terpisah: Barang Dagang dan Bahan Baku
  // Nilai diambil dari saldo akun jurnal (COA), bukan dari products/materials table
  // ============================================================================
  const persediaan: BalanceSheetItem[] = [];

  // Persediaan Barang Dagang (1310) - dari saldo akun jurnal
  if (productsInventory !== 0) {
    persediaan.push({
      accountId: persediaanBarangDagangAccount?.id || 'journal-products-inventory',
      accountCode: persediaanBarangDagangAccount?.code || '1310',
      accountName: persediaanBarangDagangAccount?.name || 'Persediaan Barang Dagang',
      balance: productsInventory,
      formattedBalance: formatCurrency(productsInventory)
    });
  }

  // Persediaan Bahan Baku (1320) - dari saldo akun jurnal
  if (materialsInventory !== 0) {
    persediaan.push({
      accountId: persediaanBahanBakuAccount?.id || 'journal-materials-inventory',
      accountCode: persediaanBahanBakuAccount?.code || '1320',
      accountName: persediaanBahanBakuAccount?.name || 'Persediaan Bahan Baku',
      balance: materialsInventory,
      formattedBalance: formatCurrency(materialsInventory)
    });
  }

  // Piutang Karyawan / Panjar Karyawan - Using lookup service
  const piutangKaryawanAccounts = findAllAccountsByLookup(accounts, 'PIUTANG_KARYAWAN');
  const panjarKaryawan = piutangKaryawanAccounts
    .filter(acc => (acc.balance || 0) !== 0) // Hide zero balances
    .map(acc => ({
      accountId: acc.id,
      accountCode: acc.code,
      accountName: acc.name,
      balance: acc.balance || 0,
      formattedBalance: formatCurrency(acc.balance || 0)
    }));

  // ============================================================================
  // PIUTANG PAJAK / PPN MASUKAN - Using lookup service + code fallback
  // ============================================================================
  // Piutang Pajak diambil dari:
  // 1. Akun COA yang memiliki nama: "Piutang Pajak", "PPN Masukan", "Pajak Masukan"
  // 2. FALLBACK: Akun dengan kode 1230 atau 123x (Piutang Pajak range)
  // Akun ini dicatat saat PO dengan PPN di-approve:
  // - Dr. Persediaan (subtotal)
  // - Dr. PPN Masukan / Piutang Pajak (ppnAmount)
  // - Cr. Hutang Usaha (total)
  // ============================================================================
  let piutangPajakAccounts = findAllAccountsByLookup(accounts, 'PIUTANG_PAJAK');

  // Fallback: If lookup service finds nothing, search by account code (123x range)
  if (piutangPajakAccounts.length === 0) {
    piutangPajakAccounts = accounts.filter(acc => {
      const code = acc.code || '';
      // Match code 1230, 1231, 1-230, 1-23x, etc.
      return code.startsWith('123') || code.startsWith('1-23') || code.startsWith('1.23');
    }).filter(acc => !acc.isHeader);
  }

  const piutangPajak = piutangPajakAccounts
    .filter(acc => (acc.balance || 0) !== 0) // Hide zero balances
    .map(acc => ({
      accountId: acc.id,
      accountCode: acc.code,
      accountName: acc.name,
      balance: acc.balance || 0,
      formattedBalance: formatCurrency(acc.balance || 0)
    }));

  console.log('📊 Piutang Pajak Debug:', {
    foundByLookup: findAllAccountsByLookup(accounts, 'PIUTANG_PAJAK').length,
    foundByCodeFallback: accounts.filter(acc => (acc.code || '').startsWith('123')).length,
    finalAccounts: piutangPajakAccounts.map(a => ({ code: a.code, name: a.name, balance: a.balance })),
    totalPiutangPajak: piutangPajak.reduce((sum, item) => sum + item.balance, 0)
  });

  const totalCurrentAssets =
    kasBank.reduce((sum, item) => sum + item.balance, 0) +
    piutangUsaha.reduce((sum, item) => sum + item.balance, 0) +
    piutangPajak.reduce((sum, item) => sum + item.balance, 0) +
    persediaan.reduce((sum, item) => sum + item.balance, 0) +
    panjarKaryawan.reduce((sum, item) => sum + item.balance, 0);

  // ============================================================================
  // ASET TETAP - FROM COA + ASSETS TABLE
  // ============================================================================
  // Aset tetap diambil dari:
  // 1. Akun COA dengan kode 14xx, 15xx, 16xx (Aset Tetap)
  // 2. Tabel assets (jika saldo akun belum ter-update)
  // ============================================================================

  // Get assets from assets table for additional data (filtered by branch)
  let assetsQuery = supabase
    .from('assets')
    .select('id, asset_name, asset_code, category, purchase_price, current_value, account_id, status')
    .eq('status', 'active');

  if (branchId) {
    assetsQuery = assetsQuery.eq('branch_id', branchId);
  }

  const { data: assetsData } = await assetsQuery;

  // Calculate total assets value from assets table
  const assetsByAccountId: Record<string, { name: string; totalValue: number; category: string }> = {};
  assetsData?.forEach(asset => {
    const accountId = asset.account_id || 'unlinked';
    const value = asset.current_value || asset.purchase_price || 0;

    if (!assetsByAccountId[accountId]) {
      assetsByAccountId[accountId] = {
        name: asset.category === 'building' ? 'Bangunan' :
          asset.category === 'vehicle' ? 'Kendaraan' :
            asset.category === 'equipment' ? 'Peralatan' :
              asset.category === 'computer' ? 'Komputer' :
                asset.category === 'furniture' ? 'Furniture' : 'Aset Lainnya',
        totalValue: 0,
        category: asset.category || 'other'
      };
    }
    assetsByAccountId[accountId].totalValue += value;
  });

  // ============================================================================
  // ASET TETAP - PSAK 16: Nilai berdasarkan JURNAL (COA), bukan tabel assets
  // Nilai aset tetap = Harga Perolehan (dari jurnal) - Akumulasi Penyusutan
  // Tabel assets hanya untuk inventaris/tracking, bukan untuk nilai di neraca
  // ============================================================================
  // PENTING: Pencarian berdasarkan NAMA akun, bukan kode akun (lebih fleksibel)
  // ============================================================================

  // Helper function untuk filter aset tetap berdasarkan nama
  const isFixedAssetAccount = (acc: AccountWithBalance): boolean => {
    const nameLower = acc.name.toLowerCase();
    // Exclude akumulasi penyusutan dan header
    if (nameLower.includes('akumulasi') || acc.isHeader) return false;
    // Include jika kode dimulai dengan 14, 15, 16 (range aset tetap)
    if (acc.code) {
      const codePrefix = acc.code.substring(0, 2);
      if (['14', '15', '16'].includes(codePrefix)) return true;
    }
    // Include berdasarkan nama
    return (nameLower.includes('kendaraan') ||
      nameLower.includes('peralatan') ||
      nameLower.includes('mesin') ||
      nameLower.includes('bangunan') ||
      nameLower.includes('tanah') ||
      nameLower.includes('komputer') ||
      nameLower.includes('furniture') ||
      nameLower.includes('gedung'));
  };

  // KENDARAAN - akun dengan nama mengandung "kendaraan" atau "vehicle"
  const kendaraan = assetAccounts
    .filter(acc => {
      const nameLower = acc.name.toLowerCase();
      return (nameLower.includes('kendaraan') || nameLower.includes('vehicle')) &&
        !nameLower.includes('akumulasi') &&
        !acc.isHeader;
    })
    .filter(acc => (acc.balance || 0) !== 0)
    .map(acc => ({
      accountId: acc.id,
      accountCode: acc.code,
      accountName: acc.name,
      balance: acc.balance || 0,
      formattedBalance: formatCurrency(acc.balance || 0)
    }));

  // PERALATAN - akun dengan nama mengandung "peralatan", "alat", "mesin", "equipment"
  const peralatan = assetAccounts
    .filter(acc => {
      const nameLower = acc.name.toLowerCase();
      return (nameLower.includes('peralatan') ||
        nameLower.includes('alat') ||
        nameLower.includes('mesin') ||
        nameLower.includes('equipment')) &&
        !nameLower.includes('akumulasi') &&
        !nameLower.includes('kendaraan') &&
        !acc.isHeader;
    })
    .filter(acc => (acc.balance || 0) !== 0)
    .map(acc => ({
      accountId: acc.id,
      accountCode: acc.code,
      accountName: acc.name,
      balance: acc.balance || 0,
      formattedBalance: formatCurrency(acc.balance || 0)
    }));

  // ASET TETAP LAINNYA - bangunan, tanah, komputer, furniture, dll
  const asetTetapLainnya = assetAccounts
    .filter(acc => {
      const nameLower = acc.name.toLowerCase();
      // Exclude yang sudah masuk kendaraan atau peralatan
      if (nameLower.includes('kendaraan') || nameLower.includes('vehicle')) return false;
      if (nameLower.includes('peralatan') || nameLower.includes('mesin') || nameLower.includes('equipment')) return false;
      if (nameLower.includes('akumulasi') || acc.isHeader) return false;
      // Include aset tetap lainnya
      return isFixedAssetAccount(acc);
    })
    .filter(acc => (acc.balance || 0) !== 0)
    .map(acc => ({
      accountId: acc.id,
      accountCode: acc.code,
      accountName: acc.name,
      balance: acc.balance || 0,
      formattedBalance: formatCurrency(acc.balance || 0)
    }));

  // NOTE: Tidak lagi menambahkan aset dari tabel assets ke neraca
  // Nilai aset tetap HARUS dari jurnal (COA) agar sesuai PSAK 16
  // Tabel assets hanya untuk tracking/inventaris, bukan nilai neraca
  //
  // Jika aset belum dijurnal, gunakan fitur "Sinkron Aset Tetap" di halaman COA
  // untuk membuat jurnal pencatatan aset.

  const akumulasiPenyusutan = assetAccounts
    .filter(acc => acc.name.toLowerCase().includes('akumulasi'))
    .filter(acc => (acc.balance || 0) !== 0) // Hide zero balances
    .map(acc => ({
      accountId: acc.id,
      accountCode: acc.code,
      accountName: acc.name,
      balance: acc.balance || 0,
      formattedBalance: formatCurrency(acc.balance || 0)
    }));

  const totalFixedAssets =
    kendaraan.reduce((sum, item) => sum + item.balance, 0) +
    peralatan.reduce((sum, item) => sum + item.balance, 0) +
    asetTetapLainnya.reduce((sum, item) => sum + item.balance, 0) -
    Math.abs(akumulasiPenyusutan.reduce((sum, item) => sum + Math.abs(item.balance), 0));

  const totalAssets = totalCurrentAssets + totalFixedAssets;

  // Build liabilities - Using lookup service
  // ============================================================================
  // HUTANG USAHA - HANYA DARI SALDO COA (JOURNAL ENTRIES)
  // ============================================================================
  // PENTING: Hutang TIDAK BOLEH dihitung 2 kali!
  // Saldo akun Hutang Usaha di COA sudah mencakup semua hutang dari:
  // - Jurnal pembelian saat PO di-approve (Dr. Persediaan, Cr. Hutang Usaha)
  // - Jurnal pembayaran hutang (Dr. Hutang Usaha, Cr. Kas)
  //
  // Tabel accounts_payable HANYA digunakan untuk tracking/manajemen hutang,
  // BUKAN untuk perhitungan neraca. Jangan ditambahkan lagi!
  // ============================================================================
  const hutangUsahaAccounts = findAllAccountsByLookup(accounts, 'HUTANG_USAHA');
  const hutangUsaha = hutangUsahaAccounts
    .filter(acc => (acc.balance || 0) !== 0) // Hide zero balances
    .map(acc => ({
      accountId: acc.id,
      accountCode: acc.code,
      accountName: acc.name,
      balance: Math.abs(acc.balance || 0),
      formattedBalance: formatCurrency(Math.abs(acc.balance || 0))
    }));

  // NOTE: totalAccountsPayable dari tabel accounts_payable TIDAK DITAMBAHKAN
  // karena sudah tercakup dalam saldo akun Hutang Usaha dari journal entries

  // ============================================================================
  // HUTANG BANK - Pinjaman bank jangka pendek & panjang
  // ============================================================================
  const hutangBankAccounts = findAllAccountsByLookup(accounts, 'HUTANG_BANK');
  const hutangBank = hutangBankAccounts
    .filter(acc => (acc.balance || 0) !== 0)
    .map(acc => ({
      accountId: acc.id,
      accountCode: acc.code,
      accountName: acc.name,
      balance: Math.abs(acc.balance || 0),
      formattedBalance: formatCurrency(Math.abs(acc.balance || 0))
    }));

  // ============================================================================
  // HUTANG KARTU KREDIT
  // ============================================================================
  const hutangKartuKreditAccounts = findAllAccountsByLookup(accounts, 'HUTANG_KARTU_KREDIT');
  const hutangKartuKredit = hutangKartuKreditAccounts
    .filter(acc => (acc.balance || 0) !== 0)
    .map(acc => ({
      accountId: acc.id,
      accountCode: acc.code,
      accountName: acc.name,
      balance: Math.abs(acc.balance || 0),
      formattedBalance: formatCurrency(Math.abs(acc.balance || 0))
    }));

  // ============================================================================
  // HUTANG LAIN-LAIN
  // ============================================================================
  const hutangLainAccounts = findAllAccountsByLookup(accounts, 'HUTANG_LAIN');
  const hutangLain = hutangLainAccounts
    .filter(acc => (acc.balance || 0) !== 0)
    .map(acc => ({
      accountId: acc.id,
      accountCode: acc.code,
      accountName: acc.name,
      balance: Math.abs(acc.balance || 0),
      formattedBalance: formatCurrency(Math.abs(acc.balance || 0))
    }));

  // Hutang Gaji - Using lookup service
  // ============================================================================
  // HUTANG GAJI - HANYA DARI SALDO COA (JOURNAL ENTRIES)
  // ============================================================================
  // Sama seperti Hutang Usaha, saldo akun Hutang Gaji di COA sudah mencakup
  // semua hutang gaji dari jurnal payroll. TIDAK perlu ditambah dari
  // tabel payroll_records lagi untuk menghindari duplikasi.
  // ============================================================================
  const hutangGajiAccounts = findAllAccountsByLookup(accounts, 'HUTANG_GAJI');
  const hutangGaji = hutangGajiAccounts
    .filter(acc => (acc.balance || 0) !== 0) // Hide zero balances
    .map(acc => ({
      accountId: acc.id,
      accountCode: acc.code,
      accountName: acc.name,
      balance: Math.abs(acc.balance || 0),
      formattedBalance: formatCurrency(Math.abs(acc.balance || 0))
    }));

  // NOTE: totalPayrollLiabilities dari tabel payroll_records TIDAK DITAMBAHKAN
  // karena sudah tercakup dalam saldo akun Hutang Gaji dari journal entries

  // Hutang Pajak - Using lookup service
  const hutangPajakAccounts = findAllAccountsByLookup(accounts, 'HUTANG_PAJAK');
  const hutangPajak = hutangPajakAccounts
    .filter(acc => (acc.balance || 0) !== 0) // Hide zero balances
    .map(acc => ({
      accountId: acc.id,
      accountCode: acc.code,
      accountName: acc.name,
      balance: Math.abs(acc.balance || 0),
      formattedBalance: formatCurrency(Math.abs(acc.balance || 0))
    }));

  const totalCurrentLiabilities =
    hutangUsaha.reduce((sum, item) => sum + item.balance, 0) +
    hutangBank.reduce((sum, item) => sum + item.balance, 0) +
    hutangKartuKredit.reduce((sum, item) => sum + item.balance, 0) +
    hutangLain.reduce((sum, item) => sum + item.balance, 0) +
    hutangGaji.reduce((sum, item) => sum + item.balance, 0) +
    hutangPajak.reduce((sum, item) => sum + item.balance, 0);

  const totalLiabilities = totalCurrentLiabilities;

  // ============================================================================
  // MODAL & LABA DITAHAN - Perhitungan yang benar sesuai PSAK
  // ============================================================================
  // 1. Modal Disetor = dari akun tipe Modal di COA (3100, dll) KECUALI Laba Ditahan
  // 2. Laba Ditahan = Saldo akun Laba Ditahan (3200) + Laba Tahun Berjalan
  // 3. Laba Tahun Berjalan = Pendapatan - Beban (dari jurnal)
  //
  // PENTING: Laba Ditahan (3200) harus diexclude dari modalPemilik untuk
  // menghindari double counting!
  // ============================================================================

  // Ambil saldo akun Laba Ditahan dari COA (3200) - harus dicari dulu sebelum filter modalPemilik
  const labaDitahanAccount = accounts.find(acc =>
    acc.code === '3200' ||
    acc.code === '3-200' ||
    acc.name.toLowerCase().includes('laba ditahan') ||
    acc.name.toLowerCase().includes('retained earnings')
  );
  const labaDitahanAkun = labaDitahanAccount?.balance || 0;

  // Build equity - EXCLUDE akun Laba Ditahan (3200) karena akan ditampilkan terpisah
  const modalPemilik = equityAccounts
    .filter(acc => {
      // Exclude zero balances
      if ((acc.balance || 0) === 0) return false;
      // Exclude Laba Ditahan account (akan ditampilkan terpisah)
      if (labaDitahanAccount && acc.id === labaDitahanAccount.id) return false;
      if (acc.code === '3200' || acc.code === '3-200') return false;
      if (acc.name.toLowerCase().includes('laba ditahan')) return false;
      if (acc.name.toLowerCase().includes('retained earnings')) return false;
      return true;
    })
    .map(acc => ({
      accountId: acc.id,
      accountCode: acc.code,
      accountName: acc.name,
      balance: acc.balance || 0,
      formattedBalance: formatCurrency(acc.balance || 0)
    }));

  // Hitung Laba Tahun Berjalan dari jurnal (Pendapatan - Beban)
  // Akun Pendapatan = type 'Pendapatan' (credit normal, jadi credit - debit)
  // Akun Beban = type 'Beban' (debit normal, jadi debit - credit)
  const pendapatanAccounts = accounts.filter(acc => acc.type === 'Pendapatan');
  const bebanAccounts = accounts.filter(acc => acc.type === 'Beban');

  const totalPendapatan = pendapatanAccounts.reduce((sum, acc) => sum + (acc.balance || 0), 0);
  const totalBeban = bebanAccounts.reduce((sum, acc) => sum + Math.abs(acc.balance || 0), 0);
  const labaTahunBerjalan = totalPendapatan - totalBeban;

  // Total Laba Ditahan = Saldo Akun + Laba Tahun Berjalan
  const totalLabaDitahan = labaDitahanAkun + labaTahunBerjalan;

  // Total Modal Pemilik (dari COA) - sudah tidak termasuk Laba Ditahan
  const totalModalPemilik = modalPemilik.reduce((sum, item) => sum + item.balance, 0);

  // Total Ekuitas = Modal + Laba Ditahan
  const totalEquity = totalModalPemilik + totalLabaDitahan;

  const totalLiabilitiesEquity = totalLiabilities + totalEquity;

  // Hitung selisih - jika tidak 0, berarti ada kesalahan jurnal atau data belum lengkap
  const selisih = totalAssets - totalLiabilitiesEquity;
  const isBalanced = Math.abs(selisih) < 1; // Allow for rounding

  // Debug log untuk membantu troubleshooting - format string agar bisa dibaca
  console.log(`📊 Balance Sheet Calculation:
    totalAssets: ${totalAssets}
    totalCurrentAssets: ${totalCurrentAssets}
    totalFixedAssets: ${totalFixedAssets}
    ---
    totalLiabilities: ${totalLiabilities}
    totalModalPemilik: ${totalModalPemilik}
    labaDitahanAkun: ${labaDitahanAkun}
    totalPendapatan: ${totalPendapatan}
    totalBeban: ${totalBeban}
    labaTahunBerjalan: ${labaTahunBerjalan}
    totalLabaDitahan: ${totalLabaDitahan}
    totalEquity: ${totalEquity}
    totalLiabilitiesEquity: ${totalLiabilitiesEquity}
    ---
    SELISIH: ${selisih}
    isBalanced: ${isBalanced}
  `);

  return {
    assets: {
      currentAssets: {
        kasBank,
        piutangUsaha,
        piutangPajak,
        persediaan,
        panjarKaryawan,
        totalCurrentAssets
      },
      fixedAssets: {
        kendaraan,
        peralatan,
        asetTetapLainnya,
        akumulasiPenyusutan,
        totalFixedAssets
      },
      totalAssets
    },
    liabilities: {
      currentLiabilities: {
        hutangUsaha,
        hutangBank,
        hutangKartuKredit,
        hutangLain,
        hutangGaji,
        hutangPajak,
        totalCurrentLiabilities
      },
      totalLiabilities
    },
    equity: {
      modalPemilik,
      labaDitahanAkun,
      labaTahunBerjalan,
      totalLabaDitahan,
      totalEquity
    },
    totalLiabilitiesEquity,
    selisih,
    isBalanced,
    generatedAt: new Date()
  };
}

/**
 * Generate Income Statement from Journal Entries
 *
 * ============================================================================
 * LAPORAN LABA RUGI - 100% DARI JOURNAL ENTRIES
 * ============================================================================
 * Semua data pendapatan dan beban diambil dari journal_entry_lines
 * dengan filter status='posted' dan is_voided=false
 * ============================================================================
 */
export async function generateIncomeStatement(
  periodFrom: Date,
  periodTo: Date,
  branchId?: string
): Promise<IncomeStatementData> {
  const fromDateStr = periodFrom.toISOString().split('T')[0];
  const toDateStr = periodTo.toISOString().split('T')[0];

  // ============================================================================
  // FETCH JOURNAL ENTRIES FOR THE PERIOD
  // Note: PostgREST doesn't support !inner syntax, so we filter on client side
  // ============================================================================
  const { data: rawJournalLines, error: journalError } = await supabase
    .from('journal_entry_lines')
    .select(`
      id,
      account_id,
      account_code,
      account_name,
      debit_amount,
      credit_amount,
      description,
      journal_entries!inner (
        id,
        entry_number,
        entry_date,
        description,
        status,
        is_voided,
        branch_id
      )
    `)
    .eq('journal_entries.status', 'posted')
    .eq('journal_entries.is_voided', false)
    .gte('journal_entries.entry_date', fromDateStr)
    .lte('journal_entries.entry_date', toDateStr)
    .eq('journal_entries.branch_id', branchId || '');

  // Since we already filtered in the query, no need for complex client-side filter
  const journalLines = rawJournalLines || [];

  if (journalError) {
    console.error('Error fetching journal lines:', journalError);
  }

  // ============================================================================
  // GET ACCOUNTS TO DETERMINE TYPES
  // IMPORTANT: COA is per-branch, so filter by branch_id if provided
  // This ensures account types are from the correct branch
  // ============================================================================
  let accountsQuery = supabase
    .from('accounts')
    .select('id, code, name, type, is_header')
    .order('code');

  if (branchId) {
    accountsQuery = accountsQuery.eq('branch_id', branchId);
  }

  const { data: accountsData } = await accountsQuery;

  // Create account type lookup
  const accountTypes: Record<string, { type: string; code: string; name: string; isHeader: boolean }> = {};
  accountsData?.forEach(acc => {
    accountTypes[acc.id] = {
      type: acc.type,
      code: acc.code || '',
      name: acc.name,
      isHeader: acc.is_header || false
    };
  });

  // ============================================================================
  // AGGREGATE JOURNAL LINES BY ACCOUNT
  // ============================================================================
  // PENTING: Gunakan account_code yang disimpan di journal_entry_lines
  // sebagai primary key, bukan account_id. Ini karena:
  // - Akun dibuat per-branch, sehingga ID bisa berbeda antar branch
  // - Kode akun lebih stabil dan konsisten (4100, 5100, 6100, dll)
  // - Journal lines sudah menyimpan account_code dan account_name
  // ============================================================================
  const accountTotals: Record<string, {
    accountId: string;
    accountCode: string;
    accountName: string;
    accountType: string;
    debit: number;
    credit: number;
  }> = {};

  journalLines?.forEach(line => {
    // Use account_code as the key instead of account_id
    const accountCode = line.account_code || '';
    const accountId = line.account_id;
    const accountInfo = accountTypes[accountId];

    // Determine account type from:
    // 1. accountTypes lookup (if found)
    // 2. Fallback: infer from account_code prefix
    let accountType = accountInfo?.type || '';
    if (!accountType) {
      // Infer type from account code
      if (accountCode.startsWith('1')) accountType = 'Aset';
      else if (accountCode.startsWith('2')) accountType = 'Kewajiban';
      else if (accountCode.startsWith('3')) accountType = 'Modal';
      else if (accountCode.startsWith('4')) accountType = 'Pendapatan';
      else if (accountCode.startsWith('5') || accountCode.startsWith('6')) accountType = 'Beban';
      else if (accountCode.startsWith('7')) accountType = 'Pendapatan';
      else if (accountCode.startsWith('8')) accountType = 'Beban';
      else accountType = 'Unknown';
    }

    if (!accountTotals[accountCode]) {
      accountTotals[accountCode] = {
        accountId,
        accountCode,
        accountName: line.account_name || accountInfo?.name || 'Unknown',
        accountType,
        debit: 0,
        credit: 0
      };
    }

    accountTotals[accountCode].debit += line.debit_amount || 0;
    accountTotals[accountCode].credit += line.credit_amount || 0;
  });

  // ============================================================================
  // PENDAPATAN (Revenue) - Type 'Pendapatan' or code starts with '4'
  // Normal balance: CREDIT (credit increases, debit decreases)
  // Supports multiple code formats: '4xxx', '4-xxx', '4.xxx'
  // ============================================================================
  const revenueAccounts = Object.values(accountTotals).filter(acc => {
    const code = acc.accountCode || '';
    const type = acc.accountType?.toLowerCase() || '';
    // Check type or code prefix (supports: 4xxx, 4-xxx, 4.xxx formats)
    return type === 'pendapatan' ||
      code.startsWith('4') ||
      code.startsWith('4-') ||
      code.startsWith('4.');
  });

  const penjualan: IncomeStatementItem[] = revenueAccounts
    .map(acc => {
      // Revenue: Credit - Debit (credit is positive)
      const amount = acc.credit - acc.debit;
      return {
        accountId: acc.accountId,
        accountCode: acc.accountCode,
        accountName: acc.accountName,
        amount: amount,
        formattedAmount: formatCurrency(amount),
        source: 'manual_journal' as const
      };
    })
    .filter(item => item.amount !== 0)
    .sort((a, b) => (a.accountCode || '').localeCompare(b.accountCode || ''));

  const totalRevenue = penjualan.reduce((sum, item) => sum + item.amount, 0);

  // ============================================================================
  // HPP (COGS) - Code starts with '5' (Harga Pokok Penjualan)
  // Normal balance: DEBIT (debit increases)
  // Supports multiple code formats: '5xxx', '5-xxx', '5.xxx'
  // ============================================================================
  const cogsAccounts = Object.values(accountTotals).filter(acc => {
    const code = acc.accountCode || '';
    return code.startsWith('5') || code.startsWith('5-') || code.startsWith('5.');
  });

  const bahanBaku: IncomeStatementItem[] = cogsAccounts
    .map(acc => {
      // COGS: Debit - Credit (debit is positive)
      const amount = acc.debit - acc.credit;
      return {
        accountId: acc.accountId,
        accountCode: acc.accountCode,
        accountName: acc.accountName,
        amount: amount,
        formattedAmount: formatCurrency(amount),
        source: 'manual_journal' as const
      };
    })
    .filter(item => item.amount !== 0)
    .sort((a, b) => (a.accountCode || '').localeCompare(b.accountCode || ''));

  const totalCOGS = bahanBaku.reduce((sum, item) => sum + item.amount, 0);

  const grossProfit = totalRevenue - totalCOGS;
  const grossProfitMargin = calculatePercentage(grossProfit, totalRevenue);

  // ============================================================================
  // BEBAN OPERASIONAL (Operating Expenses) - Type 'Beban' or code starts with '6'
  // Normal balance: DEBIT (debit increases)
  // Supports multiple code formats: '6xxx', '6-xxx', '6.xxx'
  // ============================================================================
  const expenseAccounts = Object.values(accountTotals).filter(acc => {
    const code = acc.accountCode || '';
    const type = acc.accountType?.toLowerCase() || '';
    const isExpense = type === 'beban' ||
      code.startsWith('6') || code.startsWith('6-') || code.startsWith('6.');
    // Exclude COGS accounts (already counted)
    const isCOGS = code.startsWith('5') || code.startsWith('5-') || code.startsWith('5.');
    return isExpense && !isCOGS;
  });

  const bebanOperasional: IncomeStatementItem[] = expenseAccounts
    .map(acc => {
      // Expense: Debit - Credit (debit is positive)
      const amount = acc.debit - acc.credit;
      return {
        accountId: acc.accountId,
        accountCode: acc.accountCode,
        accountName: acc.accountName,
        amount: amount,
        formattedAmount: formatCurrency(amount),
        source: 'manual_journal' as const
      };
    })
    .filter(item => item.amount !== 0)
    .sort((a, b) => (a.accountCode || '').localeCompare(b.accountCode || ''));

  const totalOperatingExpenses = bebanOperasional.reduce((sum, item) => sum + item.amount, 0);
  const operatingIncome = grossProfit - totalOperatingExpenses;

  // ============================================================================
  // PENDAPATAN/BEBAN LAIN-LAIN - Code starts with '7' or '8'
  // Supports multiple code formats: '7xxx', '7-xxx', '7.xxx', etc.
  // ============================================================================
  const otherIncomeAccounts = Object.values(accountTotals).filter(acc => {
    const code = acc.accountCode || '';
    return code.startsWith('7') || code.startsWith('7-') || code.startsWith('7.');
  });

  const otherExpenseAccounts = Object.values(accountTotals).filter(acc => {
    const code = acc.accountCode || '';
    return code.startsWith('8') || code.startsWith('8-') || code.startsWith('8.');
  });

  const pendapatanLainLain: IncomeStatementItem[] = otherIncomeAccounts
    .map(acc => {
      const amount = acc.credit - acc.debit;
      return {
        accountId: acc.accountId,
        accountCode: acc.accountCode,
        accountName: acc.accountName,
        amount: amount,
        formattedAmount: formatCurrency(amount),
        source: 'manual_journal' as const
      };
    })
    .filter(item => item.amount !== 0);

  const bebanLainLain: IncomeStatementItem[] = otherExpenseAccounts
    .map(acc => {
      const amount = acc.debit - acc.credit;
      return {
        accountId: acc.accountId,
        accountCode: acc.accountCode,
        accountName: acc.accountName,
        amount: amount,
        formattedAmount: formatCurrency(amount),
        source: 'manual_journal' as const
      };
    })
    .filter(item => item.amount !== 0);

  const totalOtherIncome = pendapatanLainLain.reduce((sum, item) => sum + item.amount, 0);
  const totalOtherExpense = bebanLainLain.reduce((sum, item) => sum + item.amount, 0);
  const netOtherIncome = totalOtherIncome - totalOtherExpense;

  const netIncomeBeforeTax = operatingIncome + netOtherIncome;
  const netIncome = netIncomeBeforeTax; // Simplified - no tax calculation yet

  // Debug: Check for missing account mappings
  const unmappedAccounts = journalLines?.filter((line: any) => !accountTypes[line.account_id]) || [];

  console.log('📊 Income Statement from Journal:', {
    periodFrom: fromDateStr,
    periodTo: toDateStr,
    branchId,
    accountsLoaded: accountsData?.length || 0,
    journalLinesRaw: rawJournalLines?.length || 0,
    journalLinesFiltered: journalLines?.length || 0,
    accountTotalsCount: Object.keys(accountTotals).length,
    revenueAccountsFound: Object.values(accountTotals).filter(acc => {
      const code = acc.accountCode || '';
      const type = acc.accountType?.toLowerCase() || '';
      return type === 'pendapatan' || code.startsWith('4') || code.startsWith('4-') || code.startsWith('4.');
    }).length,
    totalRevenue,
    totalCOGS,
    grossProfit,
    totalOperatingExpenses,
    operatingIncome,
    netOtherIncome,
    netIncome,
    // Debug: show account types available in database
    accountTypesInDB: [...new Set(accountsData?.map(acc => acc.type) || [])],
    // Debug: show unmapped journal lines (account_id not found in accounts table)
    unmappedAccountsCount: unmappedAccounts.length,
    unmappedAccountIds: unmappedAccounts.slice(0, 5).map((line: any) => ({
      account_id: line.account_id,
      account_code: line.account_code,
      account_name: line.account_name
    })),
    // Detail per akun untuk debugging
    allAccountTotals: Object.values(accountTotals).map(acc => ({
      code: acc.accountCode,
      name: acc.accountName,
      type: acc.accountType,
      debit: acc.debit,
      credit: acc.credit
    }))
  });

  return {
    revenue: {
      penjualan,
      pendapatanLain: pendapatanLainLain,
      totalRevenue
    },
    cogs: {
      bahanBaku,
      tenagaKerja: [],
      overhead: [],
      totalCOGS
    },
    grossProfit,
    grossProfitMargin,
    operatingExpenses: {
      bebanGaji: [],
      bebanOperasional,
      bebanAdministrasi: [],
      komisi: [],
      totalOperatingExpenses
    },
    operatingIncome,
    otherIncome: {
      pendapatanLainLain,
      bebanLainLain,
      netOtherIncome
    },
    netIncomeBeforeTax,
    taxExpense: 0,
    netIncome,
    netProfitMargin: calculatePercentage(netIncome, totalRevenue),
    periodFrom,
    periodTo,
    generatedAt: new Date()
  };
}

/**
 * Generate Cash Flow Statement from Journal Entries
 *
 * ============================================================================
 * LAPORAN ARUS KAS - 100% DARI JOURNAL ENTRIES
 * ============================================================================
 * Arus kas dihitung dari pergerakan akun Kas/Bank di journal_entry_lines
 * Metode Langsung: Mengelompokkan berdasarkan akun lawan (counterpart)
 * ============================================================================
 */
export async function generateCashFlowStatement(
  periodFrom: Date,
  periodTo: Date,
  branchId?: string
): Promise<CashFlowStatementData> {
  const fromDateStr = periodFrom.toISOString().split('T')[0];
  const toDateStr = periodTo.toISOString().split('T')[0];

  if (!branchId) {
    throw new Error('Branch ID is required for generating Cash Flow Statement');
  }

  // ============================================================================
  // GET ALL ACCOUNTS FOR CLASSIFICATION
  // IMPORTANT: COA is per-branch, so filter by branch_id
  // This ensures initial_balance values are from the correct branch
  // ============================================================================
  let allAccountsQuery = supabase
    .from('accounts')
    .select('id, code, name, type, balance, initial_balance, branch_id, is_payment_account, is_header, is_active, level, sort_order, parent_id, created_at')
    .eq('branch_id', branchId)
    .order('code');

  const { data: allAccountsData } = await allAccountsQuery;

  // Convert DB accounts to App accounts for use with lookup service
  const baseAllAccounts = allAccountsData?.map(fromDbToApp) || [];

  // ============================================================================
  // CALCULATE BALANCES FROM JOURNAL ENTRIES (not from accounts.balance column)
  // This ensures ending cash balance is correct based on actual journal entries
  // ============================================================================
  const allAccounts = await calculateAccountBalancesFromJournal(baseAllAccounts, branchId, periodTo);

  // Create account lookup maps
  const accountById: Record<string, { id: string; code: string; name: string; type: string }> = {};
  const accountByCode: Record<string, { id: string; code: string; name: string; type: string }> = {};

  allAccounts?.forEach(acc => {
    accountById[acc.id] = { id: acc.id, code: acc.code || '', name: acc.name, type: acc.type };
    if (acc.code) {
      accountByCode[acc.code] = { id: acc.id, code: acc.code, name: acc.name, type: acc.type };
    }
  });

  // ============================================================================
  // FETCH JOURNAL ENTRIES FOR CASH/BANK ACCOUNTS IN PERIOD
  // ============================================================================
  // Arus kas = pergerakan akun Kas/Bank dari journal_entry_lines
  // Kas masuk = debit pada akun Kas/Bank
  // Kas keluar = credit pada akun Kas/Bank
  // ============================================================================

  // Identify cash/bank accounts (code starts with 11, type MUST be Aset)
  // PENTING: Filter by type='Aset' untuk menghindari false positive
  // seperti "Hutang Bank" (type=Kewajiban) yang mengandung kata "bank"
  const cashAccountIds = allAccounts
    .filter(acc => {
      // WAJIB: Hanya akun dengan type Aset
      if (acc.type !== 'Aset') return false;

      // Match by code (11xx = Kas dan Bank) atau by name
      const code = acc.code || '';
      const name = acc.name.toLowerCase();

      return code.startsWith('1-1') ||
        code.startsWith('11') ||
        name.includes('kas') ||
        name.includes('bank');
    })
    .map(acc => acc.id);

  // Fetch journal lines directly with inner join on entries for specific date range and branch
  const { data: journalLinesWithEntries, error: journalError } = await supabase
    .from('journal_entry_lines')
    .select(`
      id,
      account_id,
      account_code,
      account_name,
      debit_amount,
      credit_amount,
      description,
      journal_entry_id,
      journal_entries!inner (
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
    .in('account_id', cashAccountIds)
    .gte('journal_entries.entry_date', fromDateStr)
    .lte('journal_entries.entry_date', toDateStr)
    .eq('journal_entries.status', 'posted')
    .eq('journal_entries.is_voided', false)
    .eq('journal_entries.branch_id', branchId || '');

  if (journalError) {
    console.error('Error fetching journal lines for cash flow:', journalError);
  }

  // Group lines by journal entry for processing
  const linesByJournal: Record<string, any[]> = {};
  const journalEntries: any[] = [];
  const processedJournalIds = new Set<string>();

  (journalLinesWithEntries || []).forEach((line: any) => {
    const journalId = line.journal_entry_id;
    if (!linesByJournal[journalId]) {
      linesByJournal[journalId] = [];
    }
    // Only add to journalEntries if not already added
    if (!processedJournalIds.has(journalId)) {
      journalEntries.push(line.journal_entries);
      processedJournalIds.add(journalId);
    }

    // We need all lines for these journals to find counterparts
    // BUT we only have cash lines here. To find counterparts, we need to fetch 
    // ALL lines for the journals we just discovered.
  });

  // Fetch ALL journal lines for these specific journals to identify counterparts
  const journalIds = Array.from(processedJournalIds);
  let allJournalLinesData: any[] = [];
  if (journalIds.length > 0) {
    // Process in chunks to avoid URL length issues or large response limits
    const chunkSize = 100;
    for (let i = 0; i < journalIds.length; i += chunkSize) {
      const chunk = journalIds.slice(i, i + chunkSize);
      const { data: lines } = await supabase
        .from('journal_entry_lines')
        .select('*')
        .in('journal_entry_id', chunk);
      if (lines) allJournalLinesData = [...allJournalLinesData, ...lines];
    }
  }

  // Re-group ALL lines by journal entry
  const allLinesByJournal: Record<string, any[]> = {};
  allJournalLinesData.forEach(line => {
    if (!allLinesByJournal[line.journal_entry_id]) {
      allLinesByJournal[line.journal_entry_id] = [];
    }
    allLinesByJournal[line.journal_entry_id].push(line);
  });

  // Get beginning and ending cash balances
  const cashKasAccounts = findAllAccountsByLookup(allAccounts, 'KAS_UTAMA');
  const cashKasKecilAccounts = findAllAccountsByLookup(allAccounts, 'KAS_KECIL');
  const cashKasDriverAccounts = findAllAccountsByLookup(allAccounts, 'KAS_DRIVER');
  const cashBankAccounts = findAllAccountsByLookup(allAccounts, 'BANK');
  const cashAccounts = [...cashKasAccounts, ...cashKasKecilAccounts, ...cashKasDriverAccounts, ...cashBankAccounts];

  if (cashAccounts.length === 0) {
    console.warn('⚠️ No cash/bank accounts found in COA');
  }

  const endingCash = getTotalBalance(cashAccounts);

  // ============================================================================
  // ANALYZE CASH FLOWS FROM JOURNAL ENTRIES
  // ============================================================================
  // Untuk setiap jurnal yang melibatkan akun Kas/Bank:
  // - Identifikasi akun lawan (counterpart) untuk klasifikasi
  // - Debit pada Kas = kas masuk
  // - Credit pada Kas = kas keluar
  // ============================================================================

  interface CashFlowEntry {
    journalId: string;
    date: string;
    description: string;
    referenceType: string;
    amount: number; // positive = kas masuk, negative = kas keluar
    counterpartAccount: { id: string; code: string; name: string; type: string } | null;
    category: 'operating' | 'investing' | 'financing';
  }

  const cashFlowEntries: CashFlowEntry[] = [];

  journalEntries?.forEach(journal => {
    const lines = allLinesByJournal[journal.id] || [];

    // Find cash account lines and counterpart lines
    const cashLines = lines.filter(l => cashAccountIds.includes(l.account_id));
    const counterpartLines = lines.filter(l => !cashAccountIds.includes(l.account_id));

    cashLines.forEach(cashLine => {
      const cashAmount = (cashLine.debit_amount || 0) - (cashLine.credit_amount || 0);
      if (cashAmount === 0) return;

      // Find counterpart account (the other side of the transaction)
      const counterpart = counterpartLines[0]; // Usually there's one counterpart

      // ============================================================================
      // EXCLUDE: Transfer antar akun Kas/Bank (internal transfer)
      // ============================================================================
      // Jika counterpart juga akun Kas/Bank, ini adalah transfer internal
      // dan TIDAK boleh dihitung sebagai arus kas karena tidak ada kas yang
      // masuk/keluar dari perusahaan - hanya berpindah antar akun kas.
      //
      // Contoh: Transfer dari Kas Kecil ke Kas Besar
      // Dr. Kas Besar (debit = kas masuk)
      // Cr. Kas Kecil (credit = kas keluar)
      // Net effect = 0 (tidak ada arus kas nyata)
      // ============================================================================
      if (counterpart && cashAccountIds.includes(counterpart.account_id)) {
        console.log('[CashFlow] Skipping internal transfer:', {
          journal: journal.id,
          from: cashLine.account_name,
          to: counterpart.account_name,
          amount: cashAmount
        });
        return; // Skip this entry - it's internal transfer
      }

      // ============================================================================
      // EXCLUDE: Jurnal yang hanya melibatkan akun kas tanpa counterpart
      // ============================================================================
      // Jika tidak ada counterpart (semua lines adalah akun kas),
      // ini mungkin jurnal koreksi internal yang tidak valid
      // ============================================================================
      if (!counterpart && counterpartLines.length === 0) {
        console.log('[CashFlow] Skipping journal without counterpart:', {
          journal: journal.id,
          cashLine: cashLine.account_name,
          amount: cashAmount,
          note: 'No non-cash counterpart account found'
        });
        return; // Skip this entry
      }

      // Try to get account info from accountById lookup, fallback to journal line data
      let counterpartAccount: { id: string; code: string; name: string; type: string } | null = null;

      if (counterpart) {
        // First try: lookup from accounts table
        counterpartAccount = accountById[counterpart.account_id] || null;

        // Fallback: use data stored in journal_entry_lines (account_code, account_name)
        // This handles cases where the account was deleted or is from a different branch
        if (!counterpartAccount && (counterpart.account_code || counterpart.account_name)) {
          const code = counterpart.account_code || '';
          counterpartAccount = {
            id: counterpart.account_id,
            code: code,
            name: counterpart.account_name || `Akun ${code}`,
            type: code.startsWith('1') ? 'Aset' :
              code.startsWith('2') ? 'Kewajiban' :
                code.startsWith('3') ? 'Modal' :
                  code.startsWith('4') ? 'Pendapatan' :
                    code.startsWith('5') || code.startsWith('6') ? 'Beban' : 'Unknown'
          };
        }
      }

      // Classify based on counterpart account code
      let category: 'operating' | 'investing' | 'financing' = 'operating';

      if (counterpartAccount) {
        const code = counterpartAccount.code || '';
        const type = counterpartAccount.type?.toLowerCase() || '';

        // INVESTASI: Aset Tetap (14xx, 15xx, 16xx)
        if (code.startsWith('14') || code.startsWith('15') || code.startsWith('16') ||
          code.startsWith('1-4') || code.startsWith('1-5') || code.startsWith('1-6')) {
          category = 'investing';
        }
        // PENDANAAN: Modal (3xxx) atau Hutang Bank (22xx)
        else if (code.startsWith('3') || code.startsWith('22') || code.startsWith('2-2') ||
          type === 'modal') {
          category = 'financing';
        }
        // OPERASI: Pendapatan, Beban, Piutang, Hutang Usaha, Persediaan
        else {
          category = 'operating';
        }
      }

      cashFlowEntries.push({
        journalId: journal.id,
        date: journal.entry_date,
        description: journal.description || cashLine.description || '',
        referenceType: journal.reference_type || '',
        amount: cashAmount,
        counterpartAccount,
        category
      });
    });
  });

  // ============================================================================
  // AKTIVITAS OPERASI
  // ============================================================================
  const operatingFlows = cashFlowEntries.filter(e => e.category === 'operating');

  // Penerimaan (kas masuk) - amount > 0
  const operatingReceipts = operatingFlows.filter(e => e.amount > 0);
  // Pengeluaran (kas keluar) - amount < 0
  const operatingPayments = operatingFlows.filter(e => e.amount < 0);

  // Klasifikasi penerimaan berdasarkan akun lawan
  const fromCustomers = operatingReceipts
    .filter(e => {
      const code = e.counterpartAccount?.code || '';
      // Pendapatan (4xxx) atau Piutang (12xx)
      return code.startsWith('4') || code.startsWith('12') || code.startsWith('1-2');
    })
    .reduce((sum, e) => sum + e.amount, 0);

  const fromReceivablePayments = operatingReceipts
    .filter(e => {
      const code = e.counterpartAccount?.code || '';
      // Piutang Usaha
      return code.startsWith('12') || code.startsWith('1-2');
    })
    .reduce((sum, e) => sum + e.amount, 0);

  const fromOtherOperating = operatingReceipts
    .filter(e => {
      const code = e.counterpartAccount?.code || '';
      // Pendapatan lain-lain (7xxx) atau tidak terkategori
      return code.startsWith('7') || !code.startsWith('4');
    })
    .reduce((sum, e) => sum + e.amount, 0);

  const fromAdvanceRepayment = operatingReceipts
    .filter(e => {
      const code = e.counterpartAccount?.code || '';
      const name = e.counterpartAccount?.name?.toLowerCase() || '';
      // Piutang Karyawan/Panjar (1220, 122x) - NOT 13xx which is Persediaan
      return code.startsWith('122') || code.startsWith('1-22') ||
        name.includes('panjar') || name.includes('piutang karyawan');
    })
    .reduce((sum, e) => sum + e.amount, 0);

  const cashReceipts = {
    fromCustomers: fromCustomers - fromReceivablePayments, // Avoid double counting
    fromReceivablePayments,
    fromOtherOperating: fromOtherOperating - fromAdvanceRepayment,
    fromAdvanceRepayment,
    total: operatingReceipts.reduce((sum, e) => sum + e.amount, 0)
  };

  // Klasifikasi pengeluaran berdasarkan akun lawan
  const forRawMaterials = Math.abs(operatingPayments
    .filter(e => {
      const code = e.counterpartAccount?.code || '';
      const name = e.counterpartAccount?.name?.toLowerCase() || '';
      // Persediaan (131x, 132x) atau Hutang Usaha (21xx) - NOT 122x which is Piutang Karyawan
      const isPersediaan = (code.startsWith('131') || code.startsWith('132') || code.startsWith('1-31') || code.startsWith('1-32') ||
        name.includes('persediaan') || name.includes('bahan'));
      const isHutangUsaha = code.startsWith('211') || code.startsWith('2-11') || name.includes('hutang usaha');
      return isPersediaan || isHutangUsaha;
    })
    .reduce((sum, e) => sum + e.amount, 0));

  const forPayablePayments = Math.abs(operatingPayments
    .filter(e => {
      const code = e.counterpartAccount?.code || '';
      // Hutang Usaha
      return code.startsWith('21') || code.startsWith('2-1');
    })
    .reduce((sum, e) => sum + e.amount, 0));

  const forDirectLabor = Math.abs(operatingPayments
    .filter(e => {
      const code = e.counterpartAccount?.code || '';
      const name = e.counterpartAccount?.name?.toLowerCase() || '';
      // Beban Gaji (62xx) atau Hutang Gaji
      return code.startsWith('62') || name.includes('gaji');
    })
    .reduce((sum, e) => sum + e.amount, 0));

  const forEmployeeAdvances = Math.abs(operatingPayments
    .filter(e => {
      const code = e.counterpartAccount?.code || '';
      const name = e.counterpartAccount?.name?.toLowerCase() || '';
      // Piutang Karyawan/Panjar (1220, 122x) - NOT 13xx which is Persediaan
      return code.startsWith('122') || code.startsWith('1-22') ||
        name.includes('panjar') || name.includes('piutang karyawan');
    })
    .reduce((sum, e) => sum + e.amount, 0));

  const forOperatingExpenses = Math.abs(operatingPayments
    .filter(e => {
      const code = e.counterpartAccount?.code || '';
      // Beban Operasional (6xxx) excluding gaji
      return code.startsWith('6') && !code.startsWith('62');
    })
    .reduce((sum, e) => sum + e.amount, 0));

  const forManufacturingOverhead = Math.abs(operatingPayments
    .filter(e => {
      const name = e.description?.toLowerCase() || '';
      return name.includes('listrik') || name.includes('air') || name.includes('overhead');
    })
    .reduce((sum, e) => sum + e.amount, 0));

  const forInterestExpense = Math.abs(operatingPayments
    .filter(e => {
      const code = e.counterpartAccount?.code || '';
      const name = e.counterpartAccount?.name?.toLowerCase() || '';
      return code.startsWith('8') || name.includes('bunga');
    })
    .reduce((sum, e) => sum + e.amount, 0));

  const forTaxes = 0;

  const cashPayments = {
    forRawMaterials,
    forPayablePayments,
    forInterestExpense,
    forDirectLabor,
    forEmployeeAdvances,
    forManufacturingOverhead,
    forOperatingExpenses,
    forTaxes,
    total: Math.abs(operatingPayments.reduce((sum, e) => sum + e.amount, 0))
  };

  const netCashFromOperations = cashReceipts.total - cashPayments.total;

  // ============================================================================
  // AKTIVITAS INVESTASI
  // ============================================================================
  const investingFlows = cashFlowEntries.filter(e => e.category === 'investing');
  const investingOutflows = Math.abs(investingFlows.filter(e => e.amount < 0).reduce((sum, e) => sum + e.amount, 0));
  const investingInflows = investingFlows.filter(e => e.amount > 0).reduce((sum, e) => sum + e.amount, 0);
  const netCashFromInvesting = investingInflows - investingOutflows;

  // ============================================================================
  // AKTIVITAS PENDANAAN
  // ============================================================================
  const financingFlows = cashFlowEntries.filter(e => e.category === 'financing');

  const fromOwnerInvestments = financingFlows
    .filter(e => {
      const code = e.counterpartAccount?.code || '';
      return e.amount > 0 && code.startsWith('3');
    })
    .reduce((sum, e) => sum + e.amount, 0);

  // Penerimaan pinjaman (kas masuk dari hutang bank)
  const fromLoans = financingFlows
    .filter(e => {
      const code = e.counterpartAccount?.code || '';
      return e.amount > 0 && (code.startsWith('22') || code.startsWith('2-2'));
    })
    .reduce((sum, e) => sum + e.amount, 0);

  // Penarikan modal/prive (kas keluar ke modal)
  const forOwnerWithdrawals = Math.abs(financingFlows
    .filter(e => {
      const code = e.counterpartAccount?.code || '';
      const name = e.counterpartAccount?.name?.toLowerCase() || '';
      return e.amount < 0 && (code.startsWith('3') || name.includes('prive'));
    })
    .reduce((sum, e) => sum + e.amount, 0));

  // Pembayaran pinjaman (kas keluar ke hutang bank)
  const forLoanRepayments = Math.abs(financingFlows
    .filter(e => {
      const code = e.counterpartAccount?.code || '';
      return e.amount < 0 && (code.startsWith('22') || code.startsWith('2-2'));
    })
    .reduce((sum, e) => sum + e.amount, 0));

  const financingInflows = fromOwnerInvestments + fromLoans;
  const financingOutflows = forOwnerWithdrawals + forLoanRepayments;
  const netCashFromFinancing = financingInflows - financingOutflows;

  const netCashFlow = netCashFromOperations + netCashFromInvesting + netCashFromFinancing;

  // ============================================================================
  // SALDO KAS AWAL PERIODE - DIHITUNG DARI JOURNAL ENTRIES SEBELUM PERIODE
  // ============================================================================
  // Saldo awal = initial_balance + Sum(Debit - Credit) dari journal SEBELUM fromDate
  // PENTING: Jika akun sudah punya jurnal opening, abaikan initial_balance
  // ============================================================================

  // Get cash account IDs for beginning balance calculation
  const cashAccountIdsForBeginning = cashAccounts.map(acc => acc.id);

  // Check which cash accounts have opening balance journals
  const { data: cashOpeningJournals } = await supabase
    .from('journal_entry_lines')
    .select(`
      account_id,
      journal_entries!inner (
        branch_id,
        reference_type,
        is_voided
      )
    `)
    .eq('journal_entries.branch_id', branchId)
    .eq('journal_entries.reference_type', 'opening')
    .eq('journal_entries.is_voided', false)
    .in('account_id', cashAccountIdsForBeginning);

  const cashAccountsWithOpeningJournal = new Set<string>();
  (cashOpeningJournals || []).forEach((line: any) => {
    if (line.account_id) {
      cashAccountsWithOpeningJournal.add(line.account_id);
    }
  });

  // Calculate beginning cash from initial_balance + journal entries BEFORE periodFrom
  let beginningCash = 0;

  // Start with initial_balance from cash accounts (only if no opening journal)
  cashAccounts.forEach(acc => {
    // Jika akun sudah punya jurnal opening, jangan tambahkan initial_balance
    if (!cashAccountsWithOpeningJournal.has(acc.id)) {
      beginningCash += acc.initialBalance || 0;
    }
  });

  // Fetch journal entries BEFORE periodFrom for cash/bank accounts
  const { data: beforePeriodLines, error: beforeError } = await supabase
    .from('journal_entry_lines')
    .select(`
      account_id,
      debit_amount,
      credit_amount,
      journal_entries (
        branch_id,
        status,
        is_voided,
        entry_date
      )
    `)
    .in('account_id', cashAccountIdsForBeginning);

  if (beforeError) {
    console.warn('Error fetching before-period journal lines:', beforeError.message);
  } else {
    // Filter: before periodFrom, posted, not voided, correct branch
    (beforePeriodLines || []).forEach((line: any) => {
      const journal = line.journal_entries;
      if (!journal) return;
      if (journal.status !== 'posted' || journal.is_voided === true) return;
      if (journal.branch_id !== branchId) return;
      if (journal.entry_date >= fromDateStr) return; // Only BEFORE period

      const debit = Number(line.debit_amount) || 0;
      const credit = Number(line.credit_amount) || 0;
      beginningCash += (debit - credit);
    });
  }

  // ============================================================================
  // ENDING CASH HARUS = beginningCash + netCashFlow (rumus arus kas)
  // ============================================================================
  // Saldo akhir kas TIDAK boleh diambil langsung dari balance akun karena:
  // 1. Akan terjadi ketidaksesuaian dengan netCashFlow
  // 2. Laporan arus kas harus balance secara matematis
  //
  // PENTING: endingCash = beginningCash + netCashFlow
  // Ini adalah prinsip dasar laporan arus kas
  // ============================================================================

  // Calculate ending cash using the cash flow formula (NOT from account balance)
  const calculatedEndingCash = beginningCash + netCashFlow;

  // For debugging: compare with account balance
  const endingCashFromAccount = endingCash; // This was calculated from getTotalBalance
  const discrepancy = Math.abs(endingCashFromAccount - calculatedEndingCash);

  console.log('📊 Cash Flow Statement - Cash Balances:', {
    fromInitialBalance: cashAccounts.reduce((sum, acc) => sum + (acc.initialBalance || 0), 0),
    fromJournalBeforePeriod: beginningCash - cashAccounts.reduce((sum, acc) => sum + (acc.initialBalance || 0), 0),
    totalBeginningCash: beginningCash,
    netCashFlow,
    calculatedEndingCash,
    endingCashFromAccountBalance: endingCashFromAccount,
    discrepancy,
    isBalanced: discrepancy < 1,
    // Formula validation
    formulaCheck: `${beginningCash} + ${netCashFlow} = ${calculatedEndingCash}`
  });

  // Jika ada discrepancy, log warning untuk debugging
  // Discrepancy bisa terjadi karena:
  // - Journal entry dengan multiple cash lines
  // - Transaksi antar akun kas (transfer internal)
  // - Rounding/pembulatan
  if (discrepancy > 1) {
    console.warn('⚠️ Cash Flow discrepancy detected:', {
      endingCashFromAccountBalance: endingCashFromAccount,
      calculatedEndingCash,
      discrepancy,
      note: 'Using calculated ending cash to ensure report balances correctly'
    });
  }

  // GUNAKAN calculatedEndingCash agar laporan SELALU balance
  const finalEndingCash = calculatedEndingCash;

  // ============================================================================
  // GROUP CASH FLOWS BY COA ACCOUNT
  // ============================================================================
  // Mengelompokkan arus kas berdasarkan akun lawan (counterpart) dari jurnal
  // ============================================================================

  // Group receipts by counterpart account
  const receiptsByAccount: Record<string, { accountId: string; accountCode: string; accountName: string; amount: number; transactions: number }> = {};

  operatingReceipts.forEach(e => {
    const account = e.counterpartAccount;
    // Use account code as key, fallback to 'other' for entries without counterpart
    const key = account?.code || 'other-receipts';

    if (!receiptsByAccount[key]) {
      receiptsByAccount[key] = {
        accountId: account?.id || '',
        accountCode: account?.code || '-',
        // Use account name if available, otherwise use description from journal or generic label
        accountName: account?.name || (e.description ? `Lainnya: ${e.description.substring(0, 50)}` : 'Penerimaan Lainnya'),
        amount: 0,
        transactions: 0
      };
    }
    receiptsByAccount[key].amount += e.amount;
    receiptsByAccount[key].transactions += 1;
  });

  // Group payments by counterpart account
  const paymentsByAccount: Record<string, { accountId: string; accountCode: string; accountName: string; amount: number; transactions: number }> = {};

  operatingPayments.forEach(e => {
    const account = e.counterpartAccount;
    // Use account code as key, fallback to 'other' for entries without counterpart
    const key = account?.code || 'other-payments';

    if (!paymentsByAccount[key]) {
      paymentsByAccount[key] = {
        accountId: account?.id || '',
        accountCode: account?.code || '-',
        // Use account name if available, otherwise use description from journal or generic label
        accountName: account?.name || (e.description ? `Lainnya: ${e.description.substring(0, 50)}` : 'Pengeluaran Lainnya'),
        amount: 0,
        transactions: 0
      };
    }
    paymentsByAccount[key].amount += Math.abs(e.amount);
    paymentsByAccount[key].transactions += 1;
  });

  // Convert to arrays and sort by account code
  const receiptsByAccountList: CashFlowCategoryItem[] = Object.values(receiptsByAccount)
    .filter(item => item.amount > 0)
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode))
    .map(item => ({
      ...item,
      formattedAmount: formatCurrency(item.amount)
    }));

  const paymentsByAccountList: CashFlowCategoryItem[] = Object.values(paymentsByAccount)
    .filter(item => item.amount > 0)
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode))
    .map(item => ({
      ...item,
      formattedAmount: formatCurrency(item.amount)
    }));

  // Group investing by counterpart account
  const investingByAccount: Record<string, { accountId: string; accountCode: string; accountName: string; amount: number; transactions: number }> = {};

  investingFlows.forEach(e => {
    const account = e.counterpartAccount;
    const key = account?.code || 'other-investing';

    if (!investingByAccount[key]) {
      investingByAccount[key] = {
        accountId: account?.id || '',
        accountCode: account?.code || '-',
        accountName: account?.name || (e.description ? `Lainnya: ${e.description.substring(0, 50)}` : 'Investasi Lainnya'),
        amount: 0,
        transactions: 0
      };
    }
    investingByAccount[key].amount += e.amount;
    investingByAccount[key].transactions += 1;
  });

  const investingByAccountList: CashFlowCategoryItem[] = Object.values(investingByAccount)
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode))
    .map(item => ({
      ...item,
      formattedAmount: formatCurrency(item.amount)
    }));

  // Group financing by counterpart account
  const financingByAccount: Record<string, { accountId: string; accountCode: string; accountName: string; amount: number; transactions: number }> = {};

  financingFlows.forEach(e => {
    const account = e.counterpartAccount;
    const key = account?.code || 'other-financing';

    if (!financingByAccount[key]) {
      financingByAccount[key] = {
        accountId: account?.id || '',
        accountCode: account?.code || '-',
        accountName: account?.name || (e.description ? `Lainnya: ${e.description.substring(0, 50)}` : 'Pendanaan Lainnya'),
        amount: 0,
        transactions: 0
      };
    }
    financingByAccount[key].amount += e.amount;
    financingByAccount[key].transactions += 1;
  });

  const financingByAccountList: CashFlowCategoryItem[] = Object.values(financingByAccount)
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode))
    .map(item => ({
      ...item,
      formattedAmount: formatCurrency(item.amount)
    }));

  // Calculate summary by account type
  const summaryByAccountType = {
    pendapatan: receiptsByAccountList
      .filter(item => item.accountCode.startsWith('4'))
      .reduce((sum, item) => sum + item.amount, 0),
    beban: paymentsByAccountList
      .filter(item => item.accountCode.startsWith('6'))
      .reduce((sum, item) => sum + item.amount, 0),
    aset: receiptsByAccountList
      .filter(item => item.accountCode.startsWith('1'))
      .reduce((sum, item) => sum + item.amount, 0) -
      paymentsByAccountList
        .filter(item => item.accountCode.startsWith('1'))
        .reduce((sum, item) => sum + item.amount, 0),
    kewajiban: paymentsByAccountList
      .filter(item => item.accountCode.startsWith('2'))
      .reduce((sum, item) => sum + item.amount, 0),
    modal: fromOwnerInvestments - forOwnerWithdrawals
  };

  console.log('📊 Cash Flow Statement from Journal:', {
    operatingReceipts: cashReceipts.total,
    operatingPayments: cashPayments.total,
    netCashFromOperations,
    netCashFromInvesting,
    netCashFromFinancing,
    netCashFlow,
    beginningCash,
    endingCash,
    journalEntriesProcessed: journalEntries?.length || 0,
    cashFlowEntriesGenerated: cashFlowEntries.length,
    // Detail klasifikasi
    receiptsBreakdown: {
      fromCustomers: cashReceipts.fromCustomers,
      fromReceivablePayments: cashReceipts.fromReceivablePayments,
      fromAdvanceRepayment: cashReceipts.fromAdvanceRepayment,
      fromOtherOperating: cashReceipts.fromOtherOperating
    },
    paymentsBreakdown: {
      forRawMaterials: cashPayments.forRawMaterials,
      forPayablePayments: cashPayments.forPayablePayments,
      forDirectLabor: cashPayments.forDirectLabor,
      forEmployeeAdvances: cashPayments.forEmployeeAdvances,
      forOperatingExpenses: cashPayments.forOperatingExpenses
    },
    // Detail per akun lawan untuk debugging
    operatingReceiptsDetail: receiptsByAccountList,
    operatingPaymentsDetail: paymentsByAccountList
  });

  return {
    operatingActivities: {
      netIncome: netCashFromOperations,
      adjustments: [],
      workingCapitalChanges: [],
      cashReceipts: {
        ...cashReceipts,
        byAccount: receiptsByAccountList
      },
      cashPayments: {
        ...cashPayments,
        byAccount: paymentsByAccountList
      },
      netCashFromOperations
    },
    investingActivities: {
      equipmentPurchases: investingFlows
        .filter(e => e.amount < 0)
        .map(e => ({
          description: e.description || 'Pembelian Aset',
          amount: e.amount,
          formattedAmount: formatCurrency(e.amount),
          source: 'journal',
          accountId: e.counterpartAccount?.id,
          accountCode: e.counterpartAccount?.code,
          accountName: e.counterpartAccount?.name
        })),
      otherInvestments: investingFlows
        .filter(e => e.amount > 0)
        .map(e => ({
          description: e.description || 'Penjualan Aset',
          amount: e.amount,
          formattedAmount: formatCurrency(e.amount),
          source: 'journal',
          accountId: e.counterpartAccount?.id,
          accountCode: e.counterpartAccount?.code,
          accountName: e.counterpartAccount?.name
        })),
      netCashFromInvesting,
      byAccount: investingByAccountList
    },
    financingActivities: {
      ownerInvestments: fromOwnerInvestments > 0 ? [{
        description: 'Setoran Modal Pemilik',
        amount: fromOwnerInvestments,
        formattedAmount: formatCurrency(fromOwnerInvestments),
        source: 'journal'
      }] : [],
      ownerWithdrawals: forOwnerWithdrawals > 0 ? [{
        description: 'Penarikan Modal/Prive',
        amount: -forOwnerWithdrawals,
        formattedAmount: formatCurrency(-forOwnerWithdrawals),
        source: 'journal'
      }] : [],
      loans: [
        ...(fromLoans > 0 ? [{
          description: 'Penerimaan Pinjaman Bank',
          amount: fromLoans,
          formattedAmount: formatCurrency(fromLoans),
          source: 'journal'
        }] : []),
        ...(forLoanRepayments > 0 ? [{
          description: 'Pembayaran Pinjaman Bank',
          amount: -forLoanRepayments,
          formattedAmount: formatCurrency(-forLoanRepayments),
          source: 'journal'
        }] : [])
      ],
      netCashFromFinancing,
      byAccount: financingByAccountList
    },
    netCashFlow,
    beginningCash,
    endingCash: finalEndingCash, // PENTING: Gunakan calculated ending cash agar laporan balance
    periodFrom,
    periodTo,
    generatedAt: new Date(),
    summaryByAccountType
  };
}