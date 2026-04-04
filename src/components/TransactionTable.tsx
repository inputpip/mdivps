import * as React from "react"
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { PlusCircle, FileDown, Trash2, Search, X, Edit, Eye, FileText, Calendar, Truck, Filter, ChevronDown, ChevronUp, Printer } from "lucide-react"
import * as XLSX from "xlsx"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { useNavigate } from "react-router-dom"
import { useCompanySettings } from "@/hooks/useCompanySettings"
import { useBranch } from "@/contexts/BranchContext"

import { Badge, badgeVariants } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar as CalendarComponent } from "@/components/ui/calendar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Link } from "react-router-dom"
import { Transaction } from "@/types/transaction"
import { format, isWithinInterval, startOfDay, endOfDay } from "date-fns"
import { id } from "date-fns/locale/id"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { useToast } from "./ui/use-toast"
import { cn } from "@/lib/utils"
import { useTransactions } from "@/hooks/useTransactions"
import { Skeleton } from "./ui/skeleton"
import { useAuth } from "@/hooks/useAuth"
import { EditTransactionDialog } from "./EditTransactionDialog"
import { MigrationTransactionDialog } from "./MigrationTransactionDialog"
import { isOwner } from '@/utils/roleUtils'
import { useDeliveryEmployees, useDeliveryHistory } from "@/hooks/useDeliveries"
import { useAccounts } from "@/hooks/useAccounts"
import { useSalesEmployees } from "@/hooks/useSalesCommission"
import { DeliveryFormContent } from "@/components/DeliveryFormContent"
import { DeliveryCompletionDialog } from "@/components/DeliveryCompletionDialog"
import { TransactionDeliveryInfo } from "@/types/delivery"
import { useTransactionsReadyForDelivery } from "@/hooks/useDeliveries"
import { Delivery } from "@/types/delivery"


export function TransactionTable() {
  const { settings: companyInfo } = useCompanySettings();
  const { currentBranch } = useBranch();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Check if mobile view
  const [isMobile, setIsMobile] = React.useState(window.innerWidth < 768);
  // Track expanded transactions - use Record<string, boolean> for TanStack Table
  const [expandedTransactions, setExpandedTransactions] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const toggleExpand = (transactionId: string) => {
    setExpandedTransactions(prev => ({
      ...prev,
      [transactionId]: !prev[transactionId]
    }));
  };

  // For desktop, we'll use a simple expand state without TanStack Table's expand feature
  // to avoid complexity. We can add it later if needed.

  // Filter states
  const [showFilters, setShowFilters] = React.useState(false);
  const [customerSearch, setCustomerSearch] = React.useState<string>(''); // Search box untuk pelanggan
  const [dateRange, setDateRange] = React.useState<{ from: Date | undefined; to: Date | undefined }>({ from: undefined, to: undefined });
  const [ppnFilter, setPpnFilter] = React.useState<'all' | 'ppn' | 'non-ppn'>('all');
  const [driverFilter, setDriverFilter] = React.useState<string>('all'); // Filter by driver ID (replaces deliveryFilter)
  const [paymentFilter, setPaymentFilter] = React.useState<'all' | 'lunas' | 'belum-lunas' | 'jatuh-tempo' | 'piutang'>('all');
  const [paymentAccountFilter, setPaymentAccountFilter] = React.useState<string>('all'); // Filter by payment account ID
  const [customerTypeFilter, setCustomerTypeFilter] = React.useState<'all' | 'Rumahan' | 'Kios/Toko'>('all'); // Filter by customer classification
  const [retasiFilter, setRetasiFilter] = React.useState<string>('all'); // 'all' or retasi_number
  const [cashierFilter, setCashierFilter] = React.useState<string>('all'); // 'all' or cashier_name
  const [salesFilter, setSalesFilter] = React.useState<string>('all'); // 'all' or sales_name
  const [filteredTransactions, setFilteredTransactions] = React.useState<Transaction[]>([]);

  const { transactions, isLoading, deleteTransaction } = useTransactions();

  // Get drivers (supir) for filter dropdown
  const { data: deliveryEmployees } = useDeliveryEmployees();
  // Get sales employees for filter dropdown
  // Note: We need to import useSalesEmployees from hook
  const { data: salesEmployees } = useSalesEmployees();

  const drivers = React.useMemo(() => {
    if (!deliveryEmployees) return [];
    return deliveryEmployees.filter(emp => emp.role === 'supir');
  }, [deliveryEmployees]);

  // Get payment accounts for filter dropdown
  const { accounts } = useAccounts();
  const { data: transactionsReadyForDelivery } = useTransactionsReadyForDelivery();

  // Delivery dialog state
  const [isDeliveryDialogOpen, setIsDeliveryDialogOpen] = React.useState(false);
  const [selectedDeliveryTransaction, setSelectedDeliveryTransaction] = React.useState<TransactionDeliveryInfo | null>(null);
  const [completionDialogOpen, setCompletionDialogOpen] = React.useState(false);
  const [completedDelivery, setCompletedDelivery] = React.useState<Delivery | null>(null);
  const [completedTransaction, setCompletedTransaction] = React.useState<TransactionDeliveryInfo | null>(null);

  // Handle delivery completion
  const handleDeliveryCompleted = (delivery: Delivery, transaction: TransactionDeliveryInfo) => {
    setCompletedDelivery(delivery)
    setCompletedTransaction(transaction)
    setCompletionDialogOpen(true)
    setIsDeliveryDialogOpen(false) // Close the form dialog
  }
  const paymentAccounts = React.useMemo(() => {
    if (!accounts) return [];
    return accounts.filter(acc => acc.isPaymentAccount && !acc.isHeader && acc.isActive !== false);
  }, [accounts]);

  // Get delivery history to map transactions to drivers
  const { data: deliveryHistory } = useDeliveryHistory();
  const transactionDriverMap = React.useMemo(() => {
    if (!deliveryHistory) return new Map<string, string[]>();
    const map = new Map<string, string[]>();
    deliveryHistory.forEach(delivery => {
      if (delivery.driverId && delivery.transactionId) {
        const existing = map.get(delivery.transactionId) || [];
        if (!existing.includes(delivery.driverId)) {
          existing.push(delivery.driverId);
        }
        map.set(delivery.transactionId, existing);
      }
    });
    return map;
  }, [deliveryHistory]);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState('');
  const [selectedTransaction, setSelectedTransaction] = React.useState<Transaction | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false);
  const [transactionToEdit, setTransactionToEdit] = React.useState<Transaction | null>(null);
  const [isMigrationDialogOpen, setIsMigrationDialogOpen] = React.useState(false);

  // Helper function to check if payment is overdue
  const isPaymentOverdue = (transaction: Transaction): boolean => {
    if (!transaction.dueDate || transaction.paymentStatus === 'Lunas') return false;
    return new Date() > new Date(transaction.dueDate);
  };

  // Helper function to categorize payment status
  const getPaymentCategory = (transaction: Transaction): string => {
    const paidAmount = transaction.paidAmount || 0;
    const total = transaction.total;

    if (paidAmount >= total) return 'lunas';
    if (paidAmount === 0) {
      if (transaction.paymentStatus === 'Kredit' && isPaymentOverdue(transaction)) {
        return 'jatuh-tempo';
      }
      return 'belum-lunas';
    }
    // Partial payment
    if (transaction.paymentStatus === 'Kredit' && isPaymentOverdue(transaction)) {
      return 'jatuh-tempo';
    }
    return 'piutang'; // Partial payment, still has remaining balance
  };

  // Filter logic
  React.useEffect(() => {
    if (!transactions) {
      setFilteredTransactions([]);
      return;
    }

    let filtered = [...transactions];

    // Filter by date range
    if (dateRange.from || dateRange.to) {
      filtered = filtered.filter(transaction => {
        if (!transaction.orderDate) return false;
        const transactionDate = new Date(transaction.orderDate);

        if (dateRange.from && dateRange.to) {
          return isWithinInterval(transactionDate, {
            start: startOfDay(dateRange.from),
            end: endOfDay(dateRange.to)
          });
        } else if (dateRange.from) {
          return transactionDate >= startOfDay(dateRange.from);
        } else if (dateRange.to) {
          return transactionDate <= endOfDay(dateRange.to);
        }

        return true;
      });
    }

    // Filter by PPN status
    if (ppnFilter !== 'all') {
      filtered = filtered.filter(transaction => {
        if (ppnFilter === 'ppn') {
          return transaction.ppnEnabled === true;
        } else if (ppnFilter === 'non-ppn') {
          return transaction.ppnEnabled === false;
        }
        return true;
      });
    }

    // Filter by driver (transactions that have been delivered by this driver)
    if (driverFilter !== 'all') {
      filtered = filtered.filter(transaction => {
        const driverIds = transactionDriverMap.get(transaction.id);
        return driverIds && driverIds.includes(driverFilter);
      });
    }

    // Filter by payment account
    if (paymentAccountFilter !== 'all') {
      filtered = filtered.filter(transaction => {
        return transaction.paymentAccountId === paymentAccountFilter;
      });
    }

    // Filter by customer type (Rumahan / Kios/Toko)
    if (customerTypeFilter !== 'all') {
      filtered = filtered.filter(transaction => {
        return transaction.customerClassification === customerTypeFilter;
      });
    }

    // Filter by payment status
    if (paymentFilter !== 'all') {
      filtered = filtered.filter(transaction => {
        const category = getPaymentCategory(transaction);
        return category === paymentFilter;
      });
    }

    // Filter by retasi
    if (retasiFilter !== 'all') {
      filtered = filtered.filter(transaction => {
        return transaction.retasiNumber === retasiFilter;
      });
    }

    // Filter by cashier
    if (cashierFilter !== 'all') {
      filtered = filtered.filter(transaction => {
        return transaction.cashierName === cashierFilter;
      });
    }

    // Filter by sales
    if (salesFilter !== 'all') {
      filtered = filtered.filter(transaction => {
        // Compare salesName case-insensitive and trimmed to handle slight variations
        const trxSales = (transaction.salesName || '').trim().toLowerCase();
        const filterSales = salesFilter.trim().toLowerCase();
        return trxSales === filterSales;
      });
    }

    // Filter by search (customer name or order ID)
    if (customerSearch.trim()) {
      const searchLower = customerSearch.toLowerCase().trim();
      filtered = filtered.filter(transaction => {
        return transaction.customerName?.toLowerCase().includes(searchLower) ||
          transaction.id?.toLowerCase().includes(searchLower);
      });
    }

    // Sort: ascending (oldest first) for mobile, descending (newest first) for desktop
    filtered.sort((a, b) => {
      const dateA = new Date(a.orderDate || 0).getTime();
      const dateB = new Date(b.orderDate || 0).getTime();
      return isMobile ? dateA - dateB : dateB - dateA; // Mobile: oldest first, Desktop: newest first
    });

    setFilteredTransactions(filtered);
  }, [transactions, dateRange, ppnFilter, driverFilter, paymentFilter, paymentAccountFilter, customerTypeFilter, retasiFilter, cashierFilter, salesFilter, customerSearch, isMobile, transactionDriverMap]);

  const clearFilters = () => {
    setCustomerSearch('');
    setDateRange({ from: undefined, to: undefined });
    setPpnFilter('all');
    setDriverFilter('all');
    setPaymentFilter('all');
    setPaymentAccountFilter('all');
    setCustomerTypeFilter('all');
    setRetasiFilter('all');
    setCashierFilter('all');
    setSalesFilter('all');
  };

  // Get unique retasi numbers from transactions
  const uniqueRetasiNumbers = React.useMemo(() => {
    if (!transactions) return [];
    const retasiSet = new Set<string>();
    transactions.forEach(t => {
      if (t.retasiNumber) {
        retasiSet.add(t.retasiNumber);
      }
    });
    return Array.from(retasiSet).sort();
  }, [transactions]);

  // Get unique cashier names from transactions
  const uniqueCashiers = React.useMemo(() => {
    if (!transactions) return [];
    const cashierSet = new Set<string>();
    transactions.forEach(t => {
      if (t.cashierName) {
        cashierSet.add(t.cashierName);
      }
    });
    return Array.from(cashierSet).sort();
  }, [transactions]);



  // confirmCancelProduction function removed - no longer needed

  const handleDeleteClick = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setIsDeleteDialogOpen(true);
  };

  const handleEditClick = (transaction: Transaction) => {
    setTransactionToEdit(transaction);
    setIsEditDialogOpen(true);
  };

  const confirmDelete = () => {
    if (!cancelReason.trim()) {
      toast({ variant: "destructive", title: "Validasi Gagal", description: "Alasan pembatalan wajib diisi." });
      return;
    }
    if (selectedTransaction) {
      deleteTransaction.mutate({
        transactionId: selectedTransaction.id,
        reason: cancelReason,
        userId: user?.id
      }, {
        onSuccess: () => {
          toast({ title: "Transaksi Dihapus", description: `Transaksi ${selectedTransaction.id} berhasil dihapus.` });
          setIsDeleteDialogOpen(false);
          setCancelReason('');
        },
        onError: (error) => {
          toast({ variant: "destructive", title: "Gagal Hapus", description: error.message });
        }
      });
    }
  };




  // Cetak Dot Matrix - optimal untuk 1/2 A4 (A5: 148mm x 210mm)
  const handleDotMatrixPrint = (transaction: Transaction) => {
    if (!transaction) return;

    // Use branch or company info
    const info = currentBranch || companyInfo;

    const orderDate = transaction.orderDate ? new Date(transaction.orderDate) : null;
    const paidAmount = transaction.paidAmount || 0;
    const remaining = transaction.total - paidAmount;

    const formatNumber = (num: number) => new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);

    // Singkat satuan
    const shortUnit = (unit: string) => {
      const unitMap: Record<string, string> = {
        'Karton': 'Krt', 'karton': 'Krt',
        'Lusin': 'Lsn', 'lusin': 'Lsn',
        'Botol': 'Btl', 'botol': 'Btl',
        'Pieces': 'Pcs', 'pieces': 'Pcs', 'Pcs': 'Pcs', 'pcs': 'Pcs',
        'Kilogram': 'Kg', 'kilogram': 'Kg',
        'Gram': 'Gr', 'gram': 'Gr',
        'Liter': 'Ltr', 'liter': 'Ltr',
        'Pack': 'Pck', 'pack': 'Pck',
        'Dus': 'Dus', 'dus': 'Dus',
        'Box': 'Box', 'box': 'Box',
        'Unit': 'Unt', 'unit': 'Unt',
      };
      return unitMap[unit] || unit;
    };

    const dotMatrixContent = `
      <table class="main-table" style="width: 100%; border-collapse: collapse;">
        <!-- Header Row -->
        <tr>
          <td colspan="5" style="border-bottom: 1px solid #000; padding-bottom: 2mm;">
            <table style="width: 100%;">
              <tr>
                <td style="width: 35%; vertical-align: top; overflow: hidden;">
                  <div style="font-size: 17pt; font-weight: bold;">FAKTUR PENJUALAN</div>
                  <div style="font-size: 13pt; font-weight: bold;">${info?.name || ''}</div>
                  <div style="font-size: 10pt; word-wrap: break-word; overflow-wrap: break-word;">
                    ${info?.address || ''}<br/>
                    KANTOR: ${String(info?.phone || '').replace(/,/g, '')}
                  </div>
                </td>
                <td style="width: 60%; vertical-align: top; font-size: 11pt;">
                  <table style="width: 100%;">
                    <tr><td width="80">No</td><td>: ${transaction.id}</td><td width="50">SALES</td><td>: ${transaction.salesName?.split(' ')[0] || 'KANTOR'}</td></tr>
                    <tr><td>Tanggal</td><td>: ${orderDate ? format(orderDate, "dd/MM/yy HH:mm", { locale: id }) : '-'}</td><td>PPN</td><td>: ${transaction.ppnEnabled ? 'Ya' : '-'}</td></tr>
                    <tr><td>Pelanggan</td><td colspan="3">: ${transaction.customerName}</td></tr>
                    <tr><td>Alamat</td><td colspan="3">: ${transaction.customerAddress || '-'}</td></tr>
                    ${transaction.dueDate ? `<tr><td>Jt. Tempo</td><td colspan="3">: ${format(new Date(transaction.dueDate), "dd/MM/yyyy", { locale: id })}</td></tr>` : ''}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Table Header -->
        <tr style="border-top: 1px solid #000; border-bottom: 1px solid #000;">
          <th style="padding: 1mm; text-align: left; width: 5%; font-size: 11pt;">No</th>
          <th style="padding: 1mm; text-align: left; width: 45%; font-size: 11pt;">Nama Item</th>
          <th style="padding: 1mm; text-align: center; width: 15%; font-size: 11pt;">Jml</th>
          <th style="padding: 1mm; text-align: right; width: 17%; font-size: 11pt;">Harga</th>
          <th style="padding: 1mm; text-align: right; width: 18%; font-size: 11pt;">Total</th>
        </tr>

        <!-- Items -->
        ${transaction.items.filter(item => item.product?.name).map((item, idx) => `
          <tr>
            <td style="padding: 0.5mm 1mm; font-size: 11pt;">${idx + 1}</td>
            <td style="padding: 0.5mm 1mm; font-size: 11pt;">${item.product?.name}</td>
            <td style="padding: 0.5mm 1mm; text-align: center; font-size: 11pt;">${formatNumber(item.quantity)} ${shortUnit(item.unit || '')}</td>
            <td style="padding: 0.5mm 1mm; text-align: right; font-size: 11pt;">${formatNumber(item.price)}</td>
            <td style="padding: 0.5mm 1mm; text-align: right; font-size: 11pt;">${formatNumber(item.price * item.quantity)}</td>
          </tr>
        `).join('')}

        <!-- Spacer row to push footer to bottom -->
        <tr style="height: 100%;">
          <td colspan="5" style="vertical-align: bottom;"></td>
        </tr>

        <!-- Footer -->
        <tr>
          <td colspan="5" style="border-top: 1px solid #000; padding-top: 2mm;">
            <table style="width: 100%;">
              <tr>
                <td style="width: 55%; vertical-align: top;">
                  <div style="font-size: 11pt; margin-bottom: 1mm;">Keterangan:</div>
                  <table style="width: 90%; margin-top: 3mm;">
                    <tr>
                      <td style="width: 33%; text-align: center;">
                        <div style="font-size: 11pt;">Hormat Kami</div>
                        <div style="height: 12mm;"></div>
                        <div style="font-size: 11pt;">(.................)</div>
                      </td>
                      <td style="width: 33%; text-align: center;">
                        <div style="font-size: 11pt;">Penerima</div>
                        <div style="height: 12mm;"></div>
                        <div style="font-size: 11pt;">(.................)</div>
                      </td>
                    </tr>
                  </table>
                </td>
                <td style="width: 45%; vertical-align: top; font-size: 11pt;">
                  <table style="width: 100%;">
                    <tr><td>Sub Total</td><td style="text-align: right;">:</td><td style="text-align: right; width: 40%;">${formatNumber(transaction.subtotal || transaction.total)}</td></tr>
                    ${transaction.ppnEnabled && (transaction.ppnAmount || 0) > 0 ? `<tr><td>PPN (${transaction.ppnPercentage || 11}%)</td><td style="text-align: right;">:</td><td style="text-align: right;">${formatNumber(transaction.ppnAmount || 0)}</td></tr>` : ''}
                    <tr><td>Total Akhir</td><td style="text-align: right;">:</td><td style="text-align: right;">${formatNumber(transaction.total)}</td></tr>
                    ${paidAmount > 0 ? `<tr><td>Tunai</td><td style="text-align: right;">:</td><td style="text-align: right;">${formatNumber(paidAmount)}</td></tr>` : ''}
                    ${remaining > 0 ? `<tr><td>Kredit</td><td style="text-align: right;">:</td><td style="text-align: right;">${formatNumber(remaining)}</td></tr>` : ''}
                    ${paidAmount > transaction.total ? `<tr><td>Kembali</td><td style="text-align: right;">:</td><td style="text-align: right;">${formatNumber(paidAmount - transaction.total)}</td></tr>` : ''}
                    ${transaction.dueDate && remaining > 0 ? `<tr><td>Jt. Tempo</td><td style="text-align: right;">:</td><td style="text-align: right;">${format(new Date(transaction.dueDate), "dd/MM/yyyy", { locale: id })}</td></tr>` : ''}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Bank Accounts - Full Width -->
        ${(() => {
        const banks = [
          companyInfo?.bankAccount1 ? `${companyInfo.bankAccount1} A.N ${companyInfo?.bankAccountName1 || companyInfo?.name || '-'}` : '',
          companyInfo?.bankAccount2 ? `${companyInfo.bankAccount2} A.N ${companyInfo?.bankAccountName2 || companyInfo?.name || '-'}` : '',
          companyInfo?.bankAccount3 ? `${companyInfo.bankAccount3} A.N ${companyInfo?.bankAccountName3 || companyInfo?.name || '-'}` : ''
        ].filter(Boolean);
        return banks.length > 0 ? `<tr><td colspan="5" style="font-size: 10pt; padding-top: 1mm;">Rek: ${banks.join(' | ')}</td></tr>` : '';
      })()}

        <!-- Warning Footer -->
        <tr>
          <td colspan="5" style="border-top: 1px solid #000; padding-top: 1mm; font-size: 10pt;">
            WAJIB CEK STOK ANDA SENDIRI SEBELUM BARANG TURUN, KEHILANGAN BUKAN TANGGUNG JAWAB KAMI
          </td>
        </tr>
      </table>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
            <head>
            <title>Faktur ${transaction.id}</title>
            <meta charset="UTF-8">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; font-weight: bold !important; }
                @page { size: A5 landscape; margin: 10mm 5mm 5mm 5mm; }
                @media print {
                html, body { height: 100%; margin: 0; padding: 0; }
                }
                html, body {
                height: 100%;
                }
                body {
                font-family: 'Courier New', Courier, monospace;
                font-weight: bold;
                font-size: 10pt;
                line-height: 1.4;
                padding: 3mm 0 0 0;
                background: white;
                color: black;
                display: flex;
                flex-direction: column;
                }
                .main-table {
                border-collapse: collapse;
                width: 100%;
                height: 100%;
                }
                table { border-collapse: collapse; width: 100%; }
                td, th, div, span, p { font-weight: bold !important; }
            </style>
            </head>
            <body onload="window.print(); window.onafterprint = function(){ window.close(); }">
            ${dotMatrixContent}
            </body>
        </html>
        `);
      printWindow.document.close();
    }
  };

  const columns: ColumnDef<Transaction>[] = [
    {
      accessorKey: "id",
      header: "No. Order",
      cell: ({ row }) => (
        <div className="flex flex-col gap-1">
          <Badge variant="outline">{row.getValue("id")}</Badge>
          {(row.original.notes?.startsWith('[MIGRASI]') || row.original.notes?.toLowerCase().includes('migrasi')) && (
            <Badge variant="secondary" className="text-[10px] w-fit border-amber-500 text-amber-600 bg-amber-50">
              Migrasi
            </Badge>
          )}
        </div>
      ),
    },
    {
      accessorKey: "customerName",
      header: "Pelanggan",
      cell: ({ row }) => (
        <div className="max-w-[150px] truncate font-medium" title={row.getValue("customerName")}>
          {row.getValue("customerName")}
        </div>
      ),
    },
    {
      accessorKey: "paymentAccountName",
      header: "Akun Pembayaran",
      cell: ({ row }) => {
        const accName = row.original.paymentAccountName; // Access from original object
        if (!accName) return <span className="text-xs text-muted-foreground">-</span>;
        return (
          <div className="max-w-[150px] truncate text-sm font-medium" title={accName}>
            {accName}
          </div>
        );
      },
    },
    {
      id: "items",
      header: "Item Pesanan",
      cell: ({ row }) => {
        const transaction = row.original;
        return (
          <div className="text-sm space-y-1">
            {transaction.items.map((item, idx) => (
              <div key={idx} className="flex justify-between gap-4">
                <span className="truncate max-w-[150px] text-muted-foreground" title={item.product?.name}>
                  {item.quantity}x {item.product?.name}
                </span>
              </div>
            ))}
          </div>
        );
      },
    },
    {
      accessorKey: "salesName",
      header: "Sales",
      cell: ({ row }) => {
        const salesName = row.getValue("salesName") as string | null;
        if (!salesName) return <span className="text-xs text-muted-foreground">-</span>;
        return (
          <div className="max-w-[120px] truncate text-sm font-medium" title={salesName}>
            {salesName}
          </div>
        );
      },
    },
    {
      id: "drivers",
      header: "Supir",
      cell: ({ row }) => {
        const driverIds = transactionDriverMap.get(row.original.id);
        if (!driverIds || driverIds.length === 0) return <span className="text-xs text-muted-foreground">-</span>;

        return (
          <div className="flex flex-col gap-1">
            {driverIds.map(driverId => {
              const driver = drivers.find(d => d.id === driverId);
              return driver ? (
                <Badge key={driverId} variant="secondary" className="text-[10px] w-fit">
                  {driver.name}
                </Badge>
              ) : null;
            })}
          </div>
        );
      },
    },
    {
      accessorKey: "cashierName",
      header: "Kasir",
      cell: ({ row }) => {
        const cashierName = row.getValue("cashierName") as string | null;
        if (!cashierName) return <span className="text-xs text-muted-foreground">-</span>;
        return (
          <div className="max-w-[120px] truncate text-sm" title={cashierName}>
            {cashierName}
          </div>
        );
      },
    },
    {
      accessorKey: "orderDate",
      header: "Tgl Order",
      cell: ({ row }) => {
        const dateValue = row.getValue("orderDate");
        if (!dateValue) return "N/A";
        const date = new Date(dateValue as string | number | Date);
        return (
          <div className="min-w-[100px]">
            <div className="font-medium">{format(date, "d MMM yyyy", { locale: id })}</div>
            <div className="text-xs text-muted-foreground">
              {format(date, "HH:mm")}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "total",
      header: () => <div className="text-right">Total</div>,
      cell: ({ row }) => {
        const amount = parseFloat(row.getValue("total"))
        const formatted = new Intl.NumberFormat("id-ID", {
          style: "currency",
          currency: "IDR",
          minimumFractionDigits: 0,
        }).format(amount)
        return <div className="text-right font-medium">{formatted}</div>
      },
    },
    {
      id: "paymentStatus",
      header: "Status Pembayaran",
      cell: ({ row }) => {
        const transaction = row.original;
        const total = transaction.total;
        const paidAmount = transaction.paidAmount || 0;
        const category = getPaymentCategory(transaction);

        let statusText = "";
        let variant: "default" | "secondary" | "destructive" | "outline" | "success" = "default";

        switch (category) {
          case 'lunas':
            statusText = "Tunai";
            variant = "success";
            break;
          case 'belum-lunas':
            statusText = "Kredit";
            variant = "destructive";
            break;
          case 'piutang':
            statusText = "Kredit";
            variant = "secondary";
            break;
          case 'jatuh-tempo':
            statusText = "Jatuh Tempo";
            variant = "outline";
            break;
          default:
            statusText = "Unknown";
            variant = "default";
        }

        return (
          <div className="space-y-1">
            <Badge variant={variant}>{statusText}</Badge>
            <div className="text-xs text-muted-foreground">
              Dibayar: {new Intl.NumberFormat("id-ID", {
                style: "currency",
                currency: "IDR",
                minimumFractionDigits: 0,
              }).format(paidAmount)}
            </div>
            {paidAmount < total && (
              <div className="text-xs text-destructive">
                Sisa: {new Intl.NumberFormat("id-ID", {
                  style: "currency",
                  currency: "IDR",
                  minimumFractionDigits: 0,
                }).format(total - paidAmount)}
              </div>
            )}
            {transaction.dueDate && category === 'jatuh-tempo' && (
              <div className="text-xs text-red-500 font-medium">
                Due: {format(new Date(transaction.dueDate), "dd MMM yyyy")}
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "Aksi",
      cell: ({ row }) => {
        const transaction = row.original;

        // Check if fully delivered to disable Antar button
        // Note: Without exact delivery counts here, this is a best-effort check or visual toggle.
        // Ideally we need aggregated delivery status from backend.
        // For now, we always enable it unless we know it's done. 
        // User asked to disable if done. Let's assume passed "status" might help, or we keep it enabled but handle it in detail.
        // Correction: User said "tombol antar mati ketika sudah selesai". 
        // We really need to filter `deliveryHistory` for this transaction ID to count items.

        const myDeliveries = deliveryHistory?.filter(d => d.transactionId === transaction.id) || [];
        // Calculate totals
        let isFullyDelivered = false;
        if (transaction.items && transaction.items.length > 0) {
          const totalOrdered = transaction.items.reduce((sum, item) => sum + (item.quantity || 0), 0);
          const totalDelivered = myDeliveries.reduce((sum, d) =>
            sum + d.items.reduce((isum, di) => isum + (di.quantityDelivered || 0), 0)
            , 0);

          // Allow some float tolerance or just exact match
          isFullyDelivered = totalDelivered >= totalOrdered;
        }

        return (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate(`/transactions/${transaction.id}`)}
              title="Lihat Detail"
              className="hover-glow"
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleEditClick(transaction)}
              title="Edit Transaksi"
              className="hover-glow"
            >
              <Edit className="h-4 w-4" />
            </Button>

            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                // Find transaction in ready for delivery list
                const readyTransaction = transactionsReadyForDelivery?.find(t => t.id === transaction.id)
                if (readyTransaction) {
                  setSelectedDeliveryTransaction(readyTransaction)
                  setIsDeliveryDialogOpen(true)
                }
              }}
              disabled={isFullyDelivered}
              className={cn(
                "text-xs px-2 py-1",
                isFullyDelivered
                  ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                  : "bg-green-600 hover:bg-green-700 text-white"
              )}
              title={isFullyDelivered ? "Pengantaran Selesai" : "Input Pengantaran"}
            >
              <Truck className="h-3 w-3 sm:mr-1" />
              <span className="hidden sm:inline">{isFullyDelivered ? "Selesai" : "Antar"}</span>
            </Button>

            {/* Dot Matrix Print Button */}
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                handleDotMatrixPrint(transaction);
              }}
              title="Cetak Faktur (Dot Matrix)"
              className="hover-glow text-gray-600 hover:text-gray-900"
            >
              <Printer className="h-4 w-4" />
            </Button>

            {isOwner(user) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDeleteClick(transaction)}
                title="Hapus Transaksi"
                className="text-red-500 hover:text-red-700 hover-glow"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        )
      },
    },
  ]

  const table = useReactTable({
    data: filteredTransactions || [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const handleExportExcel = () => {
    // Use filteredTransactions directly
    const exportTransactions = filteredTransactions;

    // Calculate summations
    const totalSum = exportTransactions.reduce((sum, t) => sum + t.total, 0);
    const paidSum = exportTransactions.reduce((sum, t) => sum + (t.paidAmount || 0), 0);
    const remainingSum = exportTransactions.reduce((sum, t) => sum + (t.total - (t.paidAmount || 0)), 0);
    const ppnSum = exportTransactions.reduce((sum, t) => sum + (t.ppnEnabled ? (t.ppnAmount || 0) : 0), 0);
    const subtotalSum = exportTransactions.reduce((sum, t) => sum + (t.ppnEnabled ? (t.subtotal || t.total - (t.ppnAmount || 0)) : t.total), 0);

    const exportData = exportTransactions.map(t => ({
      'No Order': t.id,
      'Pelanggan': t.customerName,
      'Tgl Order': t.orderDate ? format(new Date(t.orderDate), "d MMM yyyy, HH:mm", { locale: id }) : 'N/A',
      'Sales': t.salesName || '-',
      'Kasir': t.cashierName,
      'Item Pesanan': t.items.map(i => `${i.product?.name} (${i.quantity})`).join(", "),
      'Subtotal (DPP)': t.ppnEnabled ? (t.subtotal || t.total - (t.ppnAmount || 0)) : t.total,
      'PPN': t.ppnEnabled ? (t.ppnAmount || 0) : 0,
      'Total': t.total,
      'Dibayar': t.paidAmount || 0,
      'Sisa': t.total - (t.paidAmount || 0),
      'Akun Pembayaran': t.paymentAccountName || '-',
      'Status Pembayaran': (t.paidAmount || 0) === 0 ? 'Kredit' :
        (t.paidAmount || 0) >= t.total ? 'Tunai' : 'Kredit',
      'Status PPN': t.ppnEnabled ? (t.ppnMode === 'include' ? 'PPN Include' : 'PPN Exclude') : 'Non PPN'
    }));

    // Add summary row
    exportData.push({
      'No Order': '',
      'Pelanggan': '',
      'Tgl Order': '',
      'Sales': '',
      'Kasir': '',
      'Item Pesanan': `TOTAL (${exportTransactions.length} transaksi)`,
      'Subtotal (DPP)': subtotalSum,
      'PPN': ppnSum,
      'Total': totalSum,
      'Dibayar': paidSum,
      'Sisa': remainingSum,
      'Akun Pembayaran': '',
      'Status Pembayaran': '',
      'Status PPN': ''
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Transaksi");
    // Add filter info to filename
    let filename = `data-transaksi-${exportTransactions.length}-records`;
    if (dateRange.from && dateRange.to) {
      filename += `-${format(dateRange.from, 'yyyy-MM-dd')}-${format(dateRange.to, 'yyyy-MM-dd')}`;
    }
    if (ppnFilter !== 'all') {
      filename += `-${ppnFilter}`;
    }
    filename += '.xlsx';

    XLSX.writeFile(workbook, filename);
  };

  const handleExportPdf = () => {
    // Use filteredTransactions directly
    const exportTransactions = filteredTransactions;

    // Calculate summations
    const totalSum = exportTransactions.reduce((sum, t) => sum + t.total, 0);
    const paidSum = exportTransactions.reduce((sum, t) => sum + (t.paidAmount || 0), 0);
    const remainingSum = exportTransactions.reduce((sum, t) => sum + (t.total - (t.paidAmount || 0)), 0);
    const ppnSum = exportTransactions.reduce((sum, t) => sum + (t.ppnEnabled ? (t.ppnAmount || 0) : 0), 0);
    const subtotalSum = exportTransactions.reduce((sum, t) => sum + (t.ppnEnabled ? (t.subtotal || t.total - (t.ppnAmount || 0)) : t.total), 0);

    const doc = new jsPDF('landscape'); // Use landscape for more columns

    // Add title and filter info
    doc.setFontSize(16);
    doc.text('Data Transaksi', 14, 15);
    doc.setFontSize(10);
    doc.text(`Total Records: ${exportTransactions.length}`, 14, 25);
    if (dateRange.from && dateRange.to) {
      doc.text(`Filter Tanggal: ${format(dateRange.from, "d MMM yyyy", { locale: id })} - ${format(dateRange.to, "d MMM yyyy", { locale: id })}`, 14, 30);
      doc.text(`Export Date: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 14, 35);
    } else {
      doc.text(`Export Date: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 14, 30);
    }

    const formatCurrency = (value: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(value);

    // Data table with PPN column
    autoTable(doc, {
      head: [['No. Order', 'Pelanggan', 'Tgl', 'Sales', 'Item Pesanan', 'Total', 'Dibayar', 'Sisa', 'Akun', 'Status']],
      body: [
        ...exportTransactions.map(t => {
          return [
            t.id,
            t.customerName,
            t.orderDate ? format(new Date(t.orderDate), "dd/MM/yy", { locale: id }) : 'N/A',
            t.salesName || '-',
            t.items.map(i => `${i.product?.name} (${i.quantity})`).join(", "),
            formatCurrency(t.total),
            formatCurrency(t.paidAmount || 0),
            formatCurrency(t.total - (t.paidAmount || 0)),
            t.paymentAccountName || '-',
            (t.paidAmount || 0) === 0 ? 'Kredit' :
              (t.paidAmount || 0) >= t.total ? 'Tunai' : 'Kredit'
          ];
        }),
        // Summary row
        [
          '',
          '',
          'TOTAL',
          '',
          `(${exportTransactions.length} transaksi)`,
          formatCurrency(totalSum),
          formatCurrency(paidSum),
          formatCurrency(remainingSum),
          '',
          ''
        ]
      ],
      startY: 40,
      styles: {
        fontSize: 6, // Reduced font size to fit more columns
        cellPadding: 1,
        overflow: 'linebreak'
      },
      headStyles: {
        fillColor: [41, 128, 185],
        textColor: 255,
        fontSize: 6,
        fontStyle: 'bold'
      },
      columnStyles: {
        0: { cellWidth: 20 },
        1: { cellWidth: 30 },
        2: { cellWidth: 15 },
        3: { cellWidth: 20 }, // Sales
        4: { cellWidth: 60 }, // Items (Reduced)
        5: { cellWidth: 22, halign: 'right' },
        6: { cellWidth: 22, halign: 'right' },
        7: { cellWidth: 22, halign: 'right' },
        8: { cellWidth: 25 }, // Akun Pembayaran
        9: { cellWidth: 15, halign: 'center' }, // Status
      },
      didParseCell: function (data: any) {
        // Highlight summary row
        if (data.row.index === exportTransactions.length) {
          data.cell.styles.fillColor = [52, 152, 219];
          data.cell.styles.textColor = 255;
          data.cell.styles.fontStyle = 'bold';
        }
      }
    });

    // Add filter info to filename
    let filename = `data-transaksi-${exportTransactions.length}-records`;
    if (dateRange.from && dateRange.to) {
      filename += `-${format(dateRange.from, 'yyyy-MM-dd')}-${format(dateRange.to, 'yyyy-MM-dd')}`;
    }
    filename += '.pdf';

    doc.save(filename);
  };


  // Calculate filtered summary
  const filteredSummary = React.useMemo(() => {
    const totalAmount = filteredTransactions.reduce((sum, t) => sum + t.total, 0);
    const paidAmount = filteredTransactions.reduce((sum, t) => sum + (t.paidAmount || 0), 0);
    const remainingAmount = totalAmount - paidAmount;

    return {
      count: filteredTransactions.length,
      totalAmount,
      paidAmount,
      remainingAmount
    };
  }, [filteredTransactions]);

  return (
    <div className="w-full max-w-none">
      {/* Customer Search Box - Always visible */}
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cari nama pelanggan atau nomor order..."
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            className="pl-10 pr-10"
          />
          {customerSearch && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 transform -translate-y-1/2 h-7 w-7 p-0"
              onClick={() => setCustomerSearch('')}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Filter Toggle Button */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="gap-2"
          >
            <Filter className="h-4 w-4" />
            Filter Transaksi
            {showFilters ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
          {(customerSearch.trim() || dateRange.from || dateRange.to || ppnFilter !== 'all' || driverFilter !== 'all' || paymentFilter !== 'all' || paymentAccountFilter !== 'all' || customerTypeFilter !== 'all' || retasiFilter !== 'all' || cashierFilter !== 'all') && (
            <Badge variant="secondary" className="ml-2">
              Filter aktif
            </Badge>
          )}
        </div>
        {showFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-4 w-4 mr-2" />
            Reset Filter
          </Button>
        )}
      </div>

      {/* Filter Controls */}
      {showFilters && (
        <div className="bg-card border border-border rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Filter Transaksi</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Date Range Filter */}
            <div className="space-y-2 md:col-span-2 lg:col-span-1">
              <label className="text-sm font-medium">Rentang Tanggal</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !dateRange.from && !dateRange.to && "text-muted-foreground"
                    )}
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {dateRange.from ? (
                      dateRange.to ? (
                        `${format(dateRange.from, "d MMM yyyy", { locale: id })} - ${format(dateRange.to, "d MMM yyyy", { locale: id })}`
                      ) : (
                        `${format(dateRange.from, "d MMM yyyy", { locale: id })} - ...`
                      )
                    ) : (
                      "Pilih Rentang Tanggal"
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    initialFocus
                    mode="range"
                    defaultMonth={dateRange.from}
                    selected={dateRange.from && dateRange.to ? { from: dateRange.from, to: dateRange.to } : dateRange.from ? { from: dateRange.from, to: undefined } : undefined}
                    onSelect={(range) => {
                      if (range) {
                        setDateRange({ from: range.from, to: range.to });
                      } else {
                        setDateRange({ from: undefined, to: undefined });
                      }
                    }}
                    numberOfMonths={2}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Payment Status Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Status Pembayaran</label>
              <Select value={paymentFilter} onValueChange={(value: 'all' | 'lunas' | 'belum-lunas' | 'jatuh-tempo' | 'piutang') => setPaymentFilter(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih Status Pembayaran" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  <SelectItem value="lunas">Tunai</SelectItem>
                  <SelectItem value="belum-lunas">Kredit</SelectItem>
                  <SelectItem value="piutang">Kredit (Dibayar Sebagian)</SelectItem>
                  <SelectItem value="jatuh-tempo">Jatuh Tempo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* PPN Status Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Status PPN</label>
              <Select value={ppnFilter} onValueChange={(value: 'all' | 'ppn' | 'non-ppn') => setPpnFilter(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih Status PPN" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  <SelectItem value="ppn">PPN</SelectItem>
                  <SelectItem value="non-ppn">Non PPN</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Driver Filter */}
            {drivers.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Supir (Driver)</label>
                <Select value={driverFilter} onValueChange={(value: string) => setDriverFilter(value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih Supir" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Supir</SelectItem>
                    {drivers.map(driver => (
                      <SelectItem key={driver.id} value={driver.id}>
                        {driver.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Payment Account Filter */}
            {paymentAccounts.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Akun Pembayaran</label>
                <Select value={paymentAccountFilter} onValueChange={(value: string) => setPaymentAccountFilter(value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih Akun Pembayaran" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Akun</SelectItem>
                    {paymentAccounts.map(account => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.code ? `${account.code} - ${account.name}` : account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Customer Type Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Tipe Pelanggan</label>
              <Select value={customerTypeFilter} onValueChange={(value: 'all' | 'Rumahan' | 'Kios/Toko') => setCustomerTypeFilter(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih Tipe Pelanggan" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Tipe</SelectItem>
                  <SelectItem value="Rumahan">Rumahan</SelectItem>
                  <SelectItem value="Kios/Toko">Kios/Toko</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Retasi Filter */}
            {uniqueRetasiNumbers.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Retasi (Driver)</label>
                <Select value={retasiFilter} onValueChange={(value: string) => setRetasiFilter(value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih Retasi" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Retasi</SelectItem>
                    {uniqueRetasiNumbers.map(retasiNum => (
                      <SelectItem key={retasiNum} value={retasiNum}>
                        {retasiNum}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Sales Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Sales</label>
              <Select value={salesFilter} onValueChange={setSalesFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Semua Sales" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Sales</SelectItem>
                  {salesEmployees?.map((sales) => (
                    <SelectItem key={sales.id} value={sales.name}>
                      {sales.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Cashier Filter */}
            {uniqueCashiers.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Kasir</label>
                <Select value={cashierFilter} onValueChange={(value: string) => setCashierFilter(value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih Kasir" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Kasir</SelectItem>
                    {uniqueCashiers.map(cashier => (
                      <SelectItem key={cashier} value={cashier}>
                        {cashier}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Summary Cards - Hidden on mobile */}
      <div className="hidden md:grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg p-4">
          <div className="text-sm font-medium text-blue-700 dark:text-blue-400">Total Transaksi</div>
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-300">{filteredSummary.count}</div>
        </div>
        <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 rounded-lg p-4">
          <div className="text-sm font-medium text-green-700 dark:text-green-400">Total Nilai</div>
          <div className="text-2xl font-bold text-green-600 dark:text-green-300">
            {new Intl.NumberFormat("id-ID", {
              style: "currency",
              currency: "IDR",
              minimumFractionDigits: 0,
            }).format(filteredSummary.totalAmount)}
          </div>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-lg p-4">
          <div className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Dibayar</div>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-300">
            {new Intl.NumberFormat("id-ID", {
              style: "currency",
              currency: "IDR",
              minimumFractionDigits: 0,
            }).format(filteredSummary.paidAmount)}
          </div>
        </div>
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg p-4">
          <div className="text-sm font-medium text-red-700 dark:text-red-400">Sisa Tagihan</div>
          <div className="text-2xl font-bold text-red-600 dark:text-red-300">
            {new Intl.NumberFormat("id-ID", {
              style: "currency",
              currency: "IDR",
              minimumFractionDigits: 0,
            }).format(filteredSummary.remainingAmount)}
          </div>
        </div>
      </div>

      {/* Info & Actions - Different for mobile/desktop */}
      {isMobile ? (
        <div className="text-sm text-muted-foreground py-2">
          {filteredTransactions.length} pesanan
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-4">
          <div className="text-sm text-muted-foreground">
            Menampilkan {filteredTransactions.length} dari {transactions?.length || 0} transaksi
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <Button variant="outline" onClick={handleExportExcel} className="text-xs sm:text-sm hover-glow">
              <FileDown className="mr-2 h-3 w-3 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Ekspor </span>Excel
            </Button>
            <Button variant="outline" onClick={handleExportPdf} className="text-xs sm:text-sm hover-glow">
              <FileDown className="mr-2 h-3 w-3 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Ekspor </span>PDF
            </Button>
            {isOwner(user?.role) && (
              <Button variant="outline" onClick={() => setIsMigrationDialogOpen(true)} className="text-xs sm:text-sm hover-glow bg-amber-50 border-amber-200 hover:bg-amber-100">
                <FileText className="mr-2 h-3 w-3 sm:h-4 sm:w-4 text-amber-600" />
                <span className="hidden sm:inline">Import </span>Migrasi
              </Button>
            )}
            <Button asChild>
              <Link to="/pos" className="text-xs sm:text-sm">
                <PlusCircle className="mr-2 h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Tambah </span>Transaksi
              </Link>
            </Button>
          </div>
        </div>
      )}
      {/* Mobile View - Simple Card List with Expand */}
      {isMobile ? (
        <div className="space-y-2">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-card border rounded-lg p-3">
                <Skeleton className="h-16 w-full" />
              </div>
            ))
          ) : filteredTransactions.length > 0 ? (
            filteredTransactions.map((transaction, index) => {
              const total = transaction.total;
              const paidAmount = transaction.paidAmount || 0;
              const remaining = total - paidAmount;
              const paymentCategory = getPaymentCategory(transaction);
              const isExpanded = !!expandedTransactions[transaction.id];

              return (
                <div
                  key={transaction.id}
                  className="bg-card border rounded-lg shadow-sm overflow-hidden"
                >
                  {/* Main Card - Always Visible */}
                  <div
                    className="p-3 active:bg-muted/50"
                    onClick={() => toggleExpand(transaction.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded">
                            #{index + 1}
                          </span>
                          <span className="text-xs text-gray-500">
                            {transaction.orderDate ? format(new Date(transaction.orderDate), "d MMM", { locale: id }) : '-'}
                          </span>
                          <span className="text-xs text-gray-400">
                            {transaction.orderDate ? format(new Date(transaction.orderDate), "HH:mm", { locale: id }) : ''}
                          </span>
                        </div>
                        <div className="font-medium text-sm truncate">{transaction.customerName}</div>
                        <div className="text-xs text-gray-500 truncate">
                          {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(transaction.total)}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 items-end">
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            // Find transaction in ready for delivery list
                            const readyTransaction = transactionsReadyForDelivery?.find(t => t.id === transaction.id)
                            if (readyTransaction) {
                              setSelectedDeliveryTransaction(readyTransaction)
                              setIsDeliveryDialogOpen(true)
                            }
                          }}
                          className="bg-green-600 hover:bg-green-700 text-white h-8 px-2 text-xs"
                        >
                          <Truck className="h-3 w-3 mr-1" />
                          Antar
                        </Button>
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="border-t bg-muted/30 p-3">
                      {/* Items */}
                      <div className="space-y-2 mb-3">
                        <div className="text-xs font-medium text-gray-600 mb-1">Item Pesanan:</div>
                        {transaction.items.map((item, idx) => (
                          <div key={idx} className="bg-card rounded p-2 border border-border">
                            <div className="flex justify-between items-start">
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">{item.product?.name}</div>
                                <div className="text-xs text-gray-500">
                                  {item.quantity} {item.unit}
                                  {item.width && item.height && (
                                    <span> ({item.width} x {item.height})</span>
                                  )}
                                </div>
                              </div>
                              <div className="text-sm font-medium text-right ml-2">
                                {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(item.price * item.quantity)}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Payment Status */}
                      <div className="space-y-1 mb-3">
                        <div className="text-xs font-medium text-gray-600">Status Pembayaran:</div>
                        <div className="flex items-center gap-2">
                          <Badge variant={paymentCategory === 'lunas' ? "success" : paymentCategory === 'jatuh-tempo' ? "outline" : paymentCategory === 'piutang' ? "secondary" : "destructive"}>
                            {paymentCategory === 'lunas' ? 'Tunai' : paymentCategory === 'jatuh-tempo' ? 'Jatuh Tempo' : 'Kredit'}
                          </Badge>
                        </div>
                        {paidAmount > 0 && (
                          <div className="text-xs text-gray-600">
                            Dibayar: {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(paidAmount)}
                          </div>
                        )}
                        {remaining > 0 && (
                          <div className="text-xs text-red-600">
                            Sisa: {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(remaining)}
                          </div>
                        )}
                        {transaction.dueDate && paymentCategory === 'jatuh-tempo' && (
                          <div className="text-xs text-red-500 font-medium">
                            Jatuh Tempo: {format(new Date(transaction.dueDate), "dd MMM yyyy")}
                          </div>
                        )}
                      </div>

                      {/* Notes if any */}
                      {transaction.notes && (
                        <div className="text-xs text-gray-600">
                          <div className="font-medium mb-1">Catatan:</div>
                          <div className="bg-amber-500/10 border border-amber-500/20 rounded p-2 text-foreground">
                            {transaction.notes}
                          </div>
                        </div>
                      )}

                      {/* Action Buttons */}
                      <div className="flex gap-2 mt-3 pt-3 border-t">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/transactions/${transaction.id}`)}
                          className="flex-1 text-xs"
                        >
                          <Eye className="h-3 w-3 mr-1" />
                          Detail
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEditClick(transaction)}
                          className="flex-1 text-xs"
                        >
                          <Edit className="h-3 w-3 mr-1" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDotMatrixPrint(transaction);
                          }}
                          className="flex-1 text-xs"
                        >
                          <Printer className="h-3 w-3 mr-1" />
                          Cetak
                        </Button>
                        {isOwner(user) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDeleteClick(transaction)}
                            className="flex-1 text-xs text-red-600 hover:text-red-700"
                          >
                            <Trash2 className="h-3 w-3 mr-1" />
                            Hapus
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="text-center py-8 text-gray-500">Tidak ada transaksi</div>
          )}
        </div>
      ) : (
        /* Desktop View - Full Table */
        <div className="rounded-md border overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="min-w-[800px]">
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>{headerGroup.headers.map((header) => (<TableHead key={header.id}>{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</TableHead>))}</TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (<TableRow key={i}><TableCell colSpan={columns.length}><Skeleton className="h-8 w-full" /></TableCell></TableRow>))
                ) : table.getRowModel().rows?.length ? (
                  table.getRowModel().rows.map((row) => {
                    const transaction = row.original;
                    const isExpanded = !!expandedTransactions[transaction.id];
                    const total = transaction.total;
                    const paidAmount = transaction.paidAmount || 0;
                    const remaining = total - paidAmount;
                    const paymentCategory = getPaymentCategory(transaction);

                    return (
                      <React.Fragment key={row.id}>
                        <TableRow
                          onClick={() => toggleExpand(transaction.id)}
                          className="cursor-pointer table-row-hover"
                        >
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">{transaction.id}</Badge>
                              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </div>
                          </TableCell>
                          {row.getVisibleCells().slice(1).map((cell) => (
                            <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                          ))}
                        </TableRow>

                        {/* Expanded Detail Row */}
                        {isExpanded && (
                          <TableRow>
                            <TableCell colSpan={columns.length} className="bg-muted/30 p-4">
                              <div className="grid grid-cols-2 gap-6">
                                {/* Items */}
                                <div>
                                  <h4 className="font-medium mb-2 text-sm">Item Pesanan:</h4>
                                  <div className="space-y-1">
                                    {transaction.items.map((item, idx) => (
                                      <div key={idx} className="bg-card rounded p-2 border border-border text-sm">
                                        <div className="flex justify-between items-start">
                                          <div className="flex-1">
                                            <div className="font-medium">{item.product?.name}</div>
                                            <div className="text-xs text-gray-500">
                                              {item.quantity} {item.unit}
                                              {item.width && item.height && (
                                                <span> ({item.width} x {item.height})</span>
                                              )}
                                            </div>
                                          </div>
                                          <div className="font-medium">
                                            {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(item.price * item.quantity)}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                {/* Payment Status & Notes */}
                                <div className="space-y-4">
                                  <div>
                                    <h4 className="font-medium mb-2 text-sm">Status Pembayaran:</h4>
                                    <div className="space-y-1">
                                      <Badge variant={paymentCategory === 'lunas' ? "success" : paymentCategory === 'jatuh-tempo' ? "outline" : paymentCategory === 'piutang' ? "secondary" : "destructive"}>
                                        {paymentCategory === 'lunas' ? 'Tunai' : paymentCategory === 'jatuh-tempo' ? 'Jatuh Tempo' : 'Kredit'}
                                      </Badge>
                                      {paidAmount > 0 && (
                                        <div className="text-sm text-gray-600">
                                          Dibayar: {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(paidAmount)}
                                        </div>
                                      )}
                                      {remaining > 0 && (
                                        <div className="text-sm text-red-600">
                                          Sisa: {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(remaining)}
                                        </div>
                                      )}
                                      {transaction.dueDate && paymentCategory === 'jatuh-tempo' && (
                                        <div className="text-sm text-red-500 font-medium">
                                          Jatuh Tempo: {format(new Date(transaction.dueDate), "dd MMM yyyy")}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {transaction.notes && (
                                    <div>
                                      <h4 className="font-medium mb-2 text-sm">Catatan:</h4>
                                      <div className="bg-amber-500/10 border border-amber-500/20 rounded p-2 text-sm text-foreground">
                                        {transaction.notes}
                                      </div>
                                    </div>
                                  )}

                                  {/* Quick Actions */}
                                  <div className="flex gap-2 pt-2 border-t">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => navigate(`/transactions/${transaction.id}`)}
                                      className="text-xs"
                                    >
                                      <Eye className="h-3 w-3 mr-1" />
                                      Detail
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleDotMatrixPrint(transaction)}
                                      className="text-xs"
                                    >
                                      <Printer className="h-3 w-3 mr-1" />
                                      Cetak
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })
                ) : (
                  <TableRow><TableCell colSpan={columns.length} className="h-24 text-center">No results.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Pagination - Desktop only */}
      {!isMobile && (
        <div className="flex items-center justify-end space-x-2 py-4">
          <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} className="hover-glow">Previous</Button>
          <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} className="hover-glow">Next</Button>
        </div>
      )}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={(open) => {
        setIsDeleteDialogOpen(open);
        if (!open) setCancelReason('');
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Transaksi?</AlertDialogTitle>
            <AlertDialogDescription>
              Tindakan ini tidak dapat dibatalkan. Ini akan membatalkan dan menghapus data transaksi dengan nomor order <strong>{selectedTransaction?.id}</strong>.
            </AlertDialogDescription>
            <div className="mt-4 text-left">
              <label className="text-sm font-medium">Alasan Pembatalan <span className="text-red-500">*</span></label>
              <Input
                placeholder="Masukkan alasan transaksi ini dihapus"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="mt-1"
                autoFocus
              />
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setCancelReason('')}>Batal</AlertDialogCancel>
            <AlertDialogAction
              className={cn(badgeVariants({ variant: "destructive", className: "cursor-pointer" }))}
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={deleteTransaction.isPending || !cancelReason.trim()}
            >
              {deleteTransaction.isPending ? "Memproses..." : "Hapus Transaksi"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Production cancellation warning dialog removed - no longer needed */}

      {transactionToEdit && (
        <EditTransactionDialog
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          transaction={transactionToEdit}
        />
      )}

      {/* Migration Dialog - Owner Only */}
      <MigrationTransactionDialog
        open={isMigrationDialogOpen}
        onOpenChange={setIsMigrationDialogOpen}
      />

      {/* Delivery Dialog */}
      {selectedDeliveryTransaction && (
        <Dialog open={isDeliveryDialogOpen} onOpenChange={setIsDeliveryDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Buat Pengantaran Baru</DialogTitle>
              <DialogDescription>
                Catat pengantaran untuk order #{selectedDeliveryTransaction.id} - {selectedDeliveryTransaction.customerName}
              </DialogDescription>
            </DialogHeader>

            <DeliveryFormContent
              transaction={selectedDeliveryTransaction}
              onSuccess={() => {
                setSelectedDeliveryTransaction(null)
                setIsDeliveryDialogOpen(false)
                // Note: refetch is not available in this context, 
                // the transactions list will auto-refresh from the hook
              }}
              onDeliveryCreated={handleDeliveryCompleted}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Delivery Completion Dialog */}
      <DeliveryCompletionDialog
        open={completionDialogOpen}
        onOpenChange={setCompletionDialogOpen}
        delivery={completedDelivery}
        transaction={completedTransaction}
      />
    </div>
  )
}
