"use client"
import * as React from "react"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { saveCompressedPDF } from "@/utils/pdfUtils"
import { format } from "date-fns"
import { id } from "date-fns/locale/id"
import { Calendar as CalendarIcon, FileDown } from "lucide-react"
import { Calendar } from "@/components/ui/calendar"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { CashHistory } from "@/types/cashFlow"
import { supabase } from "@/integrations/supabase/client"
import { useBranch } from "@/contexts/BranchContext"

interface DateRangeReportPDFProps {
  cashHistory: CashHistory[];
}

// Helper function to determine if record is income
const isIncomeType = (item: CashHistory) => {
  // Transfers are displayed based on their direction but don't affect total income/expense
  if (item.source_type === 'transfer_masuk') {
    return true;
  }
  if (item.source_type === 'transfer_keluar') {
    return false;
  }

  if (item.type) {
    return ['orderan', 'kas_masuk_manual', 'panjar_pelunasan', 'pembayaran_piutang'].includes(item.type);
  }
  if (item.transaction_type) {
    return item.transaction_type === 'income';
  }
  return false;
};

// Helper function to get transaction type label
const getTypeLabel = (item: CashHistory) => {
  // Handle transfers first
  if (item.source_type === 'transfer_masuk') {
    return 'Transfer Masuk';
  } else if (item.source_type === 'transfer_keluar') {
    return 'Transfer Keluar';
  }

  if (item.type) {
    const labels = {
      'orderan': 'Orderan',
      'kas_masuk_manual': 'Kas Masuk Manual',
      'kas_keluar_manual': 'Kas Keluar Manual',
      'panjar_pengambilan': 'Panjar Pengambilan',
      'panjar_pelunasan': 'Panjar Pelunasan',
      'pengeluaran': 'Pengeluaran',
      'pembayaran_po': 'Pembayaran PO',
      'pembayaran_piutang': 'Pembayaran Piutang',
      'transfer_masuk': 'Transfer Masuk',
      'transfer_keluar': 'Transfer Keluar'
    };
    return labels[item.type as keyof typeof labels] || item.type;
  }

  if (item.source_type) {
    switch (item.source_type) {
      case 'receivables_payment': return 'Pembayaran Piutang';
      case 'pos_direct': return 'Penjualan (POS)';
      case 'manual_expense': return 'Pengeluaran Manual';
      case 'employee_advance': return 'Panjar Karyawan';
      case 'po_payment': return 'Pembayaran PO';
      case 'receivables_writeoff': return 'Pemutihan Piutang';
      case 'transfer_masuk': return 'Transfer Masuk';
      case 'transfer_keluar': return 'Transfer Keluar';
      default: return item.source_type;
    }
  }

  if (item.transaction_type) {
    return item.transaction_type === 'income' ? 'Kas Masuk' : 'Kas Keluar';
  }

  return 'Tidak Diketahui';
};

export function DateRangeReportPDF({ cashHistory }: DateRangeReportPDFProps) {
  const [selectedDate, setSelectedDate] = React.useState<Date>(new Date());
  const [isCalendarOpen, setIsCalendarOpen] = React.useState(false);
  const { currentBranch } = useBranch();

  // Calculate data for selected date using JOURNAL ENTRIES for accurate period balances
  // ============================================================================
  // PERBAIKAN: Saldo awal periode dihitung dari jurnal, bukan dari saldo saat ini
  // Rumus: Saldo Awal = Total Debit - Total Credit SEBELUM tanggal yang dipilih
  // Saldo Akhir = Saldo Awal + (Debit - Credit) pada tanggal yang dipilih
  // ============================================================================
  const calculateDataForDate = async (targetDate: Date) => {
    const dateStr = targetDate.toISOString().split('T')[0]; // YYYY-MM-DD format

    // Get payment accounts (kas/bank) — filter by branch agar tidak duplikat lintas cabang
    const accountsQuery = supabase
      .from('accounts')
      .select('id, name, code, is_payment_account')
      .eq('is_payment_account', true)
      .eq('is_header', false)
      .order('name');

    if (currentBranch?.id) {
      accountsQuery.eq('branch_id', currentBranch.id);
    }

    const { data: accounts, error: accountsError } = await accountsQuery;

    if (accountsError) {
      throw new Error(`Failed to fetch accounts: ${accountsError.message}`);
    }

    const paymentAccountIds = (accounts || []).map(acc => acc.id);

    if (paymentAccountIds.length === 0) {
      return {
        dateIncome: 0,
        dateExpense: 0,
        dateNet: 0,
        currentBalance: 0,
        previousBalance: 0,
        dateTransactions: [],
        accountBalances: []
      };
    }

    // ============================================================================
    // 1. HITUNG SALDO AWAL PERIODE (sebelum tanggal yang dipilih)
    // Untuk akun Aset: Saldo = Total Debit - Total Credit
    // ============================================================================
    const beforeQuery = supabase
      .from('journal_entry_lines')
      .select(`
        account_id,
        debit_amount,
        credit_amount,
        journal_entries!inner (
          entry_date,
          status,
          is_voided,
          branch_id
        )
      `)
      .in('account_id', paymentAccountIds)
      .lt('journal_entries.entry_date', dateStr);

    if (currentBranch?.id) {
      beforeQuery.eq('journal_entries.branch_id', currentBranch.id);
    }

    const { data: beforeDateLines, error: beforeError } = await beforeQuery;

    if (beforeError) {
      console.error('Error fetching before-date journal lines:', beforeError);
    }

    // Calculate opening balance per account
    const accountBalances = new Map();
    (accounts || []).forEach(account => {
      accountBalances.set(account.id, {
        accountId: account.id,
        accountName: account.name,
        accountCode: account.code,
        previousBalance: 0, // Saldo awal periode
        currentBalance: 0,  // Saldo akhir periode
        dateIncome: 0,
        dateExpense: 0,
        dateNet: 0,
        todayChange: 0
      });
    });

    // Sum up all transactions BEFORE selected date for opening balance
    let totalPreviousBalance = 0;
    (beforeDateLines || []).forEach((line: any) => {
      const journal = line.journal_entries;
      if (!journal || journal.status !== 'posted' || journal.is_voided === true) return;

      const accountId = line.account_id;
      const debit = Number(line.debit_amount) || 0;
      const credit = Number(line.credit_amount) || 0;

      if (accountBalances.has(accountId)) {
        const account = accountBalances.get(accountId);
        account.previousBalance += (debit - credit);
      }
    });

    // Calculate total previous balance
    accountBalances.forEach(account => {
      totalPreviousBalance += account.previousBalance;
    });

    // ============================================================================
    // 2. HITUNG TRANSAKSI PADA TANGGAL YANG DIPILIH
    // ============================================================================
    const dateQuery = supabase
      .from('journal_entry_lines')
      .select(`
        account_id,
        debit_amount,
        credit_amount,
        journal_entries!inner (
          entry_date,
          status,
          is_voided,
          branch_id,
          description,
          reference_type
        )
      `)
      .in('account_id', paymentAccountIds)
      .eq('journal_entries.entry_date', dateStr);

    if (currentBranch?.id) {
      dateQuery.eq('journal_entries.branch_id', currentBranch.id);
    }

    const { data: dateLines, error: dateError } = await dateQuery;

    if (dateError) {
      console.error('Error fetching date journal lines:', dateError);
    }

    // Calculate income/expense for selected date
    let dateIncome = 0;
    let dateExpense = 0;

    (dateLines || []).forEach((line: any) => {
      const journal = line.journal_entries;
      if (!journal || journal.status !== 'posted' || journal.is_voided === true) return;

      const accountId = line.account_id;
      const debit = Number(line.debit_amount) || 0;
      const credit = Number(line.credit_amount) || 0;

      // For Asset accounts (Kas/Bank): Debit = income, Credit = expense
      dateIncome += debit;
      dateExpense += credit;

      if (accountBalances.has(accountId)) {
        const account = accountBalances.get(accountId);
        account.dateIncome += debit;
        account.dateExpense += credit;
        account.dateNet = account.dateIncome - account.dateExpense;
        account.todayChange = account.dateNet;
      }
    });

    // Calculate current balance (end of selected date)
    accountBalances.forEach(account => {
      account.currentBalance = account.previousBalance + account.dateNet;
    });

    const dateNet = dateIncome - dateExpense;
    const totalCurrentBalance = totalPreviousBalance + dateNet;

    // ============================================================================
    // 3. FILTER CASH HISTORY UNTUK DETAIL TRANSAKSI (HANYA CABANG AKTIF)
    // ============================================================================
    const dateStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    const dateEnd = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() + 1);

    // Pastikan kita juga memfilter berdasarkan branch agar transaksi dari cabang lain tidak masuk ke laporan
    // jika secara tidak sengaja data cashHistory mengandung campuran.
    const currentBranchAccounts = new Set(paymentAccountIds);

    const dateTransactions = cashHistory.filter(item => {
      const itemDate = new Date(item.date || item.created_at);
      const isDateValid = itemDate >= dateStart && itemDate < dateEnd;
      const isBranchValid = currentBranchAccounts.has(item.account_id);
      return isDateValid && isBranchValid;
    });

    console.log(`📊 Cash Flow Report for ${dateStr}:`);
    console.log(`   Saldo Awal Periode: Rp ${totalPreviousBalance.toLocaleString('id-ID')}`);
    console.log(`   Kas Masuk: Rp ${dateIncome.toLocaleString('id-ID')}`);
    console.log(`   Kas Keluar: Rp ${dateExpense.toLocaleString('id-ID')}`);
    console.log(`   Saldo Akhir Periode: Rp ${totalCurrentBalance.toLocaleString('id-ID')}`);

    return {
      dateIncome,
      dateExpense,
      dateNet,
      currentBalance: totalCurrentBalance,
      previousBalance: totalPreviousBalance,
      dateTransactions,
      accountBalances: Array.from(accountBalances.values())
    };
  };

  const generatePDF = async () => {
    try {
      const data = await calculateDataForDate(selectedDate);
      const doc = new jsPDF('p', 'mm', 'a4');

      // Company header
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text('LAPORAN KEUANGAN HARIAN', 105, 20, { align: 'center' });

      doc.setFontSize(14);
      doc.setFont('helvetica', 'normal');
      doc.text(`Tanggal: ${format(selectedDate, 'dd MMMM yyyy', { locale: id })}`, 105, 30, { align: 'center' });

      // Add line separator
      doc.setLineWidth(0.5);
      doc.line(20, 35, 190, 35);

      let currentY = 45;

      // Summary Section
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('RINGKASAN KEUANGAN', 20, currentY);
      currentY += 10;

      // Summary data
      const summaryData = [
        ['Saldo Awal Periode', formatCurrency(data.previousBalance)],
        ['Kas Masuk', formatCurrency(data.dateIncome)],
        ['Kas Keluar', formatCurrency(data.dateExpense)],
        ['Arus Kas Bersih', formatCurrency(data.dateNet)],
        ['Saldo Akhir Periode', formatCurrency(data.currentBalance)]
      ];

      autoTable(doc, {
        startY: currentY,
        head: [['Keterangan', 'Jumlah']],
        body: summaryData,
        theme: 'grid',
        headStyles: { fillColor: [71, 85, 105], textColor: [255, 255, 255] },
        styles: { fontSize: 11 },
        columnStyles: {
          0: { cellWidth: 80 },
          1: { cellWidth: 80, halign: 'right' }
        }
      });

      currentY = (doc as any).lastAutoTable.finalY + 15;

      // Account Balances Section
      if (data.accountBalances.length > 0) {
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('SALDO PER AKUN', 20, currentY);
        currentY += 10;

        const accountData = data.accountBalances.map(account => [
          account.accountName,
          formatCurrency(account.previousBalance),
          formatCurrency(account.dateIncome),
          formatCurrency(account.dateExpense),
          formatCurrency(account.dateNet),
          formatCurrency(account.currentBalance)
        ]);

        autoTable(doc, {
          startY: currentY,
          head: [['Akun', 'Saldo Awal', 'Kas Masuk', 'Kas Keluar', 'Net', 'Saldo Akhir']],
          body: accountData,
          theme: 'grid',
          headStyles: { fillColor: [71, 85, 105], textColor: [255, 255, 255] },
          styles: { fontSize: 9 },
          columnStyles: {
            0: { cellWidth: 35 },
            1: { cellWidth: 30, halign: 'right' },
            2: { cellWidth: 25, halign: 'right' },
            3: { cellWidth: 25, halign: 'right' },
            4: { cellWidth: 25, halign: 'right' },
            5: { cellWidth: 30, halign: 'right' }
          }
        });
      }

      // Start new page for transactions
      doc.addPage();
      currentY = 20;

      // Transactions Section
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text(`DETAIL TRANSAKSI - ${format(selectedDate, 'dd MMMM yyyy', { locale: id })}`, 20, currentY);
      currentY += 10;

      if (data.dateTransactions.length === 0) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        doc.text('Tidak ada transaksi pada tanggal ini.', 20, currentY);
      } else {
        // Income transactions
        const incomeTransactions = data.dateTransactions.filter(isIncomeType);
        const expenseTransactions = data.dateTransactions.filter(item => !isIncomeType(item));

        if (incomeTransactions.length > 0) {
          doc.setFontSize(14);
          doc.setFont('helvetica', 'bold');
          doc.text('KAS MASUK', 20, currentY);
          currentY += 7;

          const incomeData = incomeTransactions.map(item => {
            const refNumber = item.reference_number || item.reference_name || item.reference_id || '-';
            return [
              format(new Date(item.created_at), 'HH:mm', { locale: id }),
              refNumber.length > 20 ? refNumber.substring(0, 20) + '...' : refNumber,
              item.account_name || '-',
              getTypeLabel(item),
              item.description || '-',
              formatCurrency(item.amount)
            ];
          });

          autoTable(doc, {
            startY: currentY,
            head: [['Waktu', 'No. Ref', 'Akun', 'Jenis', 'Deskripsi', 'Jumlah']],
            body: incomeData,
            theme: 'striped',
            headStyles: { fillColor: [34, 197, 94], textColor: [255, 255, 255] },
            styles: { fontSize: 8, cellPadding: 2 },
            columnStyles: {
              0: { cellWidth: 15 },
              1: { cellWidth: 35 },
              2: { cellWidth: 30 },
              3: { cellWidth: 25 },
              4: { cellWidth: 60 },
              5: { cellWidth: 25, halign: 'right' }
            }
          });

          currentY = (doc as any).lastAutoTable.finalY + 10;
        }

        if (expenseTransactions.length > 0) {
          // Check if we need a new page
          if (currentY > 250) {
            doc.addPage();
            currentY = 20;
          }

          doc.setFontSize(14);
          doc.setFont('helvetica', 'bold');
          doc.text('KAS KELUAR', 20, currentY);
          currentY += 7;

          const expenseData = expenseTransactions.map(item => {
            const refNumber = item.reference_number || item.reference_name || item.reference_id || '-';
            return [
              format(new Date(item.created_at), 'HH:mm', { locale: id }),
              refNumber.length > 20 ? refNumber.substring(0, 20) + '...' : refNumber,
              item.account_name || '-',
              getTypeLabel(item),
              item.description || '-',
              formatCurrency(item.amount)
            ];
          });

          autoTable(doc, {
            startY: currentY,
            head: [['Waktu', 'No. Ref', 'Akun', 'Jenis', 'Deskripsi', 'Jumlah']],
            body: expenseData,
            theme: 'striped',
            headStyles: { fillColor: [239, 68, 68], textColor: [255, 255, 255] },
            styles: { fontSize: 8, cellPadding: 2 },
            columnStyles: {
              0: { cellWidth: 15 },
              1: { cellWidth: 35 },
              2: { cellWidth: 30 },
              3: { cellWidth: 25 },
              4: { cellWidth: 60 },
              5: { cellWidth: 25, halign: 'right' }
            }
          });
        }
      }

      // Footer
      const pageCount = doc.internal.pages.length - 1;
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(
          `Dicetak pada: ${format(new Date(), 'dd MMMM yyyy HH:mm', { locale: id })}`,
          20, 287
        );
        doc.text(`Halaman ${i} dari ${pageCount}`, 190, 287, { align: 'right' });
      }

      // Save the PDF
      const fileName = `laporan-keuangan-${format(selectedDate, 'yyyy-MM-dd')}.pdf`;
      saveCompressedPDF(doc, fileName, 100);
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Terjadi kesalahan saat menghasilkan PDF. Silakan coba lagi.');
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="flex items-center gap-2">
      <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "justify-start text-left font-normal",
              !selectedDate && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {selectedDate ? format(selectedDate, "dd MMM yyyy", { locale: id }) : "Pilih tanggal"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={(date) => {
              if (date) {
                setSelectedDate(date);
                setIsCalendarOpen(false);
              }
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>

      <Button onClick={generatePDF} variant="default" size="sm">
        <FileDown className="mr-2 h-4 w-4" />
        Cetak Laporan PDF
      </Button>
    </div>
  );
}