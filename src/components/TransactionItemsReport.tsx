"use client"
import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Download, Calendar, Package, CalendarDays, ShoppingCart, Truck, Store, Navigation, FileSpreadsheet, User, Wallet, CreditCard, UserCheck } from 'lucide-react'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { id } from 'date-fns/locale/id'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { supabase } from '@/integrations/supabase/client'
import { useBranch } from '@/contexts/BranchContext'
import { useTimezone } from '@/contexts/TimezoneContext'
import { toOfficeStartOfDay, toOfficeEndOfDay } from '@/utils/officeTime'
import { useAccounts } from '@/hooks/useAccounts'

interface SoldProduct {
  transactionId: string
  transactionDate: Date
  soldDate: Date // Tanggal laku (delivery date, order date untuk laku kantor, atau retasi date)
  customerName: string
  productName: string
  quantity: number
  unit: string
  price: number
  total: number
  source: 'delivery' | 'office_sale' | 'retasi' | 'migration' | 'pos_kasir' // Sumber: pengantaran, laku kantor, retasi, data migrasi, atau pos kasir
  driverId?: string
  driverName?: string
  retasiNumber?: string
  retasiKe?: number // Retasi ke-berapa (1, 2, 3, dst)
  cashierId?: string
  cashierName: string
  isBonus: boolean
  paymentAccountId?: string // ID akun pembayaran
  paymentAccountName?: string // Nama akun pembayaran
  paymentStatus?: 'Lunas' | 'Belum Lunas' // Status pembayaran
  salesName?: string // Nama sales yang menangani transaksi
}

// Helper: Extract sales name from transaction data
// Sales name can come from: 1) sales_name column, or 2) _isSalesMeta in items JSON
const extractSalesName = (transaction: any): string | undefined => {
  // Priority 1: Direct column
  if (transaction?.sales_name) return transaction.sales_name;
  // Priority 2: Metadata in items array
  const items = transaction?.items;
  if (Array.isArray(items) && items.length > 0 && items[0]?._isSalesMeta) {
    return items[0].salesName || undefined;
  }
  return undefined;
};

export const TransactionItemsReport = () => {
  // Default filter: hari ini (dateRange dengan start dan end = hari ini)
  const [filterType, setFilterType] = useState<'monthly' | 'dateRange'>('dateRange')
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [productFilter, setProductFilter] = useState<string>('all') // Filter by product name
  const [availableProducts, setAvailableProducts] = useState<string[]>([]) // List of unique product names
  const [sourceFilter, setSourceFilter] = useState<'all' | 'delivery' | 'office_sale' | 'retasi' | 'migration' | 'pos_kasir'>('all')
  const [driverFilter, setDriverFilter] = useState<string>('all')
  const [availableDrivers, setAvailableDrivers] = useState<string[]>([])
  const [helperFilter, setHelperFilter] = useState<string>('all')
  const [availableHelpers, setAvailableHelpers] = useState<string[]>([])
  const [cashierFilter, setCashierFilter] = useState<string>('all')
  const [availableCashiers, setAvailableCashiers] = useState<string[]>([])
  const [retasiKeFilter, setRetasiKeFilter] = useState<string>('all')
  const [availableRetasiKe, setAvailableRetasiKe] = useState<{ value: string, label: string }[]>([])
  const [paymentAccountFilter, setPaymentAccountFilter] = useState<string>('all')
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'all' | 'Lunas' | 'Belum Lunas'>('all')
  const [salesFilter, setSalesFilter] = useState<string>('all')
  const [availableSales, setAvailableSales] = useState<string[]>([])
  const [allItems, setAllItems] = useState<SoldProduct[]>([])
  // const [reportData, setReportData] = useState<SoldProduct[]>([]) // Removed state, now derived
  const [isLoading, setIsLoading] = useState(false)

  const { currentBranch } = useBranch()
  const { timezone } = useTimezone()
  const { accounts } = useAccounts()

  // Get payment accounts (kas/bank accounts)
  const paymentAccounts = useMemo(() => {
    return (accounts || []).filter(acc =>
      acc.isPaymentAccount === true ||
      acc.code?.startsWith('1-1') || // Kas
      acc.code?.startsWith('11') ||  // Kas
      acc.name?.toLowerCase().includes('kas') ||
      acc.name?.toLowerCase().includes('bank')
    ).sort((a, b) => (a.code || '').localeCompare(b.code || ''))
  }, [accounts])

  // Filter Logic moved to useMemo for instant updates
  const reportData = useMemo(() => {
    let filteredItems = allItems

    // Apply product filter if selected
    if (productFilter !== 'all') {
      filteredItems = filteredItems.filter(item => item.productName === productFilter)
    }

    // Apply source filter if selected
    if (sourceFilter !== 'all') {
      filteredItems = filteredItems.filter(item => item.source === sourceFilter)
    }

    // Apply driver filter if selected
    if (driverFilter !== 'all') {
      filteredItems = filteredItems.filter(item =>
        (item.source === 'delivery' || item.source === 'retasi') && item.driverName === driverFilter
      )
    }

    // Apply helper filter if selected
    if (helperFilter !== 'all') {
      filteredItems = filteredItems.filter(item => {
        if (item.source !== 'delivery' && item.source !== 'retasi') return false
        const helpers = [
          (item as any).helperName,
          (item as any).helperName2,
          (item as any).helperName3,
        ].filter(Boolean)
        return helpers.includes(helperFilter)
      })
    }

    // Apply cashier filter if selected
    if (cashierFilter !== 'all') {
      filteredItems = filteredItems.filter(item =>
        (item.source === 'office_sale' || item.source === 'pos_kasir' || item.source === 'migration') && item.cashierName === cashierFilter
      )
    }

    // Apply retasi ke filter if selected
    if (retasiKeFilter !== 'all') {
      const filterKe = parseInt(retasiKeFilter)
      // Robust comparison in case of type mismatch (though we cast to int)
      filteredItems = filteredItems.filter(item => item.retasiKe == filterKe)
    }

    // Apply payment account filter if selected
    if (paymentAccountFilter !== 'all') {
      filteredItems = filteredItems.filter(item => item.paymentAccountId === paymentAccountFilter)
    }

    // Apply payment status filter if selected
    if (paymentStatusFilter !== 'all') {
      filteredItems = filteredItems.filter(item => item.paymentStatus === paymentStatusFilter)
    }

    // Apply sales filter if selected
    if (salesFilter !== 'all') {
      filteredItems = filteredItems.filter(item => item.salesName === salesFilter)
    }

    return filteredItems
  }, [allItems, productFilter, sourceFilter, driverFilter, helperFilter, cashierFilter, retasiKeFilter, paymentAccountFilter, paymentStatusFilter, salesFilter])


  const months = [
    { value: 1, label: 'Januari' },
    { value: 2, label: 'Februari' },
    { value: 3, label: 'Maret' },
    { value: 4, label: 'April' },
    { value: 5, label: 'Mei' },
    { value: 6, label: 'Juni' },
    { value: 7, label: 'Juli' },
    { value: 8, label: 'Agustus' },
    { value: 9, label: 'September' },
    { value: 10, label: 'Oktober' },
    { value: 11, label: 'November' },
    { value: 12, label: 'Desember' },
  ]

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)

  const handleGenerateReport = async () => {
    setIsLoading(true)
    try {
      let fromDate: Date
      let toDate: Date

      if (filterType === 'monthly') {
        const firstDay = format(startOfMonth(new Date(selectedYear, selectedMonth - 1)), 'yyyy-MM-dd')
        const lastDay = format(endOfMonth(new Date(selectedYear, selectedMonth - 1)), 'yyyy-MM-dd')
        fromDate = toOfficeStartOfDay(firstDay, timezone)
        toDate = toOfficeEndOfDay(lastDay, timezone)
      } else {
        fromDate = toOfficeStartOfDay(startDate, timezone)
        toDate = toOfficeEndOfDay(endDate, timezone)
      }

      console.log('[TransactionItemsReport] Fetching from v_realisasi_penjualan:', {
        timezone, startDate, endDate, fromDateISO: fromDate.toISOString(), toDateISO: toDate.toISOString()
      })

      // Query to our powerful new View
      let query = supabase
        .from('v_realisasi_penjualan')
        .select('*')
        .gte('realization_date', fromDate.toISOString())
        .lte('realization_date', toDate.toISOString())

      if (currentBranch?.id) {
        query = query.eq('branch_id', currentBranch.id)
      }

      const { data: records, error } = await query

      if (error) {
        console.error('Error fetching v_realisasi_penjualan:', error)
        throw error
      }

      const retasiIds = [...new Set((records || [])
        .map((r: any) => r.retasi_id)
        .filter((value: any) => !!value))]

      let retasiMap: Record<string, { retasi_ke?: number; retasi_number?: string; driver_name?: string }> = {}
      if (retasiIds.length > 0) {
        const { data: retasiRows, error: retasiError } = await supabase
          .from('retasi')
          .select('id, retasi_ke, retasi_number, driver_name')
          .in('id', retasiIds)

        if (retasiError) {
          console.error('[TransactionItemsReport] Error fetching retasi details:', retasiError)
        } else {
          retasiMap = (retasiRows || []).reduce((acc, row: any) => {
            acc[row.id] = {
              retasi_ke: row.retasi_ke,
              retasi_number: row.retasi_number,
              driver_name: row.driver_name,
            }
            return acc
          }, {} as Record<string, { retasi_ke?: number; retasi_number?: string; driver_name?: string }>)
        }
      }

      const items: SoldProduct[] = (records || []).map(r => {
        const soldDate = new Date(r.realization_date || new Date())
        const paymentAcct = paymentAccounts.find(a => a.id === r.payment_account_id)
        const retasiInfo = r.retasi_id ? retasiMap[r.retasi_id] : undefined

        let retasiKeValue: number | undefined =
          retasiInfo?.retasi_ke !== undefined && retasiInfo?.retasi_ke !== null && !Number.isNaN(Number(retasiInfo.retasi_ke))
            ? Number(retasiInfo.retasi_ke)
            : r.retasi_ke !== undefined && r.retasi_ke !== null && !Number.isNaN(Number(r.retasi_ke))
              ? Number(r.retasi_ke)
              : undefined

        const retasiDisplay = retasiInfo?.retasi_number || r.retasi_number || '-'
        if (retasiKeValue === undefined && r.retasi_number && r.retasi_number.includes('ke-')) {
          const match = r.retasi_number.match(/ke-(\d+)/i)
          if (match) {
            retasiKeValue = parseInt(match[1])
          }
        }

        return {
          transactionId: r.transaction_id,
          transactionDate: soldDate,
          soldDate,
          customerName: r.customer_name || 'Walk-in Customer',
          productName: r.product_name || 'Unknown',
          quantity: r.quantity || 0,
          unit: r.unit || 'pcs',
          price: Number(r.price) || 0,
          total: (r.quantity || 0) * (Number(r.price) || 0),
          source: r.source_type as any,
          driverId: r.driver_id,
          driverName: r.driver_name || retasiInfo?.driver_name || undefined,
          helperName: r.helper_name || undefined,
          helperName2: r.helper_name_2 || undefined,
          helperName3: r.helper_name_3 || undefined,
          retasiNumber: retasiDisplay,
          retasiKe: retasiKeValue,
          cashierId: r.cashier_id,
          cashierName: r.cashier_name || 'Unknown',
          isBonus: r.is_bonus || false,
          paymentAccountId: r.payment_account_id,
          paymentAccountName: paymentAcct?.name,
          paymentStatus: r.payment_status || 'Belum Lunas',
          salesName: r.sales_name || undefined
        }
      })

      console.log('[DEBUG] items mapped. Example top item:', items.length > 0 ? {
        id: items[0].transactionId,
        source: items[0].source,
        driverId: items[0].driverId,
        driverName: items[0].driverName,
      } : 'No items');

      // Fetch missing names from profiles
      const missingProfileIds = [
        ...items.filter(i => (i.source === 'delivery' || i.source === 'retasi') && (!i.driverName || i.driverName === '-' || i.driverName.trim() === '') && i.driverId).map(i => i.driverId),
        ...items.filter(i => (i.source === 'office_sale' || i.source === 'pos_kasir') && (!i.cashierName || i.cashierName === 'Unknown' || i.cashierName === '-' || i.cashierName.trim() === '') && i.cashierId).map(i => i.cashierId)
      ];
      
      const uniqueMissingIds = [...new Set(missingProfileIds)].filter(Boolean) as string[];

      console.log('[DEBUG] uniqueMissingIds found:', uniqueMissingIds);

      if (uniqueMissingIds.length > 0) {
        try {
          console.log('[DEBUG] Fetching missing profiles for IDs:', uniqueMissingIds);
          const { data: profilesData } = await supabase
            .from('profiles')
            .select('id, full_name')
            .in('id', uniqueMissingIds);
            
          console.log('[DEBUG] Fetched profiles:', profilesData);
            
          if (profilesData && profilesData.length > 0) {
            const profileMap = profilesData.reduce((acc, p) => ({ ...acc, [p.id]: p.full_name }), {} as Record<string, string>);
            
            items.forEach(item => {
              if ((item.source === 'delivery' || item.source === 'retasi') && (!item.driverName || item.driverName === '-' || item.driverName.trim() === '') && item.driverId && profileMap[item.driverId]) {
                item.driverName = profileMap[item.driverId];
              }
              if ((item.source === 'office_sale' || item.source === 'pos_kasir') && (!item.cashierName || item.cashierName === 'Unknown' || item.cashierName === '-' || item.cashierName.trim() === '') && item.cashierId && profileMap[item.cashierId]) {
                item.cashierName = profileMap[item.cashierId];
              }
            });
          }
        } catch (err) {
          console.error('[TransactionItemsReport] Error fetching profiles for missing names:', err);
        }
      }

      // Sort by sold date (newest first)
      items.sort((a, b) => b.soldDate.getTime() - a.soldDate.getTime())

      // Extract unique product names for filter dropdown
      const uniqueProducts = [...new Set(
        items.map(item => item.productName).filter(Boolean)
      )].sort()
      setAvailableProducts(uniqueProducts)

      // Extract unique drivers for filter dropdown
      const uniqueDrivers = [...new Set(
        items
          .filter(item => item.source === 'delivery' || item.source === 'retasi')
          .map(item => item.driverName)
          .filter((name): name is string => !!name)
      )].sort()
      setAvailableDrivers(uniqueDrivers)

      // Extract unique helpers for filter dropdown
      const uniqueHelpers = [...new Set(
        items
          .filter(item => item.source === 'delivery' || item.source === 'retasi')
          .flatMap(item => [
            (item as any).helperName,
            (item as any).helperName2,
            (item as any).helperName3,
          ])
          .filter((name): name is string => !!name)
      )].sort()
      setAvailableHelpers(uniqueHelpers)

      // Extract unique cashiers for filter dropdown
      const uniqueCashiers = [...new Set(
        items
          .filter(item => item.source === 'office_sale' || item.source === 'pos_kasir' || item.source === 'migration')
          .map(item => item.cashierName)
          .filter((name): name is string => !!name)
      )].sort()
      setAvailableCashiers(uniqueCashiers)

      // Extract unique retasi_ke values for filter dropdown
      const uniqueRetasiKe = [...new Set(
        items
          .filter(item => item.retasiKe !== undefined && item.retasiKe !== null)
          .map(item => item.retasiKe as number)
      )].sort((a, b) => a - b)
      setAvailableRetasiKe(uniqueRetasiKe.map(ke => ({
        value: ke.toString(),
        label: `Retasi Ke-${ke}`
      })))

      // Extract unique sales names for filter dropdown
      const uniqueSales = [...new Set(
        items
          .map(item => item.salesName)
          .filter((name): name is string => !!name)
      )].sort()
      setAvailableSales(uniqueSales)

      setAllItems(items) // Store all items for client-side filtering
    } catch (error) {
      console.error('Error generating report:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const getReportTitle = () => {
    const productFilterText = productFilter === 'all' ? '' : ` (${productFilter})`
    const sourceText = sourceFilter === 'all' ? '' :
      sourceFilter === 'delivery' ? ' - Pengantaran' :
        sourceFilter === 'office_sale' ? ' - Laku Kantor' : ' - Retasi'

    if (filterType === 'monthly') {
      const monthName = months.find(m => m.value === selectedMonth)?.label
      return `Laporan Produk Laku${productFilterText}${sourceText} - ${monthName} ${selectedYear}`
    } else {
      return `Laporan Produk Laku${productFilterText}${sourceText} - ${format(new Date(startDate), 'dd MMM yyyy', { locale: id })} s/d ${format(new Date(endDate), 'dd MMM yyyy', { locale: id })}`
    }
  }

  const handlePrintReport = () => {
    const doc = new jsPDF('landscape')
    const title = getReportTitle()

    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.text(title, 14, 22)

    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text(`Digenerate pada: ${format(new Date(), 'dd MMMM yyyy HH:mm', { locale: id })}`, 14, 30)
    doc.text(`Sumber: Pengantaran + Laku Kantor + Retasi`, 14, 36)

    const tableData = reportData.map(item => [
      format(item.soldDate, 'dd/MM/yyyy'),
      item.transactionId.substring(0, 8) + '...',
      item.customerName,
      item.isBonus ? `${item.productName} [BONUS]` : item.productName,
      item.quantity.toString(),
      `Rp ${item.price.toLocaleString()}`,
      `Rp ${item.total.toLocaleString()}`,
      item.source === 'delivery' ? 'Diantar' : item.source === 'office_sale' ? 'Laku Kantor' : item.source === 'retasi' ? 'Retasi' : 'Migrasi',
      item.retasiNumber || '-',
      item.source === 'delivery' ? (item.driverName || '-') :
        item.source === 'retasi' ? (item.driverName || '-') : item.cashierName,
      item.salesName || '-',
      item.paymentAccountName || '-',
      item.paymentStatus || 'Belum Lunas'
    ])

    autoTable(doc, {
      head: [['Tanggal', 'No. Trx', 'Customer', 'Produk', 'Qty', 'Harga', 'Total', 'Sumber', 'Retasi', 'Supir/Kasir', 'Sales', 'Akun Bayar', 'Status']],
      body: tableData,
      startY: 42,
      styles: { fontSize: 6 },
      headStyles: { fillColor: [66, 139, 202] },
      columnStyles: {
        0: { cellWidth: 17 },
        1: { cellWidth: 16 },
        2: { cellWidth: 22 },
        3: { cellWidth: 30 },
        4: { cellWidth: 9 },
        5: { cellWidth: 18 },
        6: { cellWidth: 20 },
        7: { cellWidth: 14 },
        8: { cellWidth: 18 }, // Retasi
        9: { cellWidth: 22 }, // Supir/Kasir
        10: { cellWidth: 22 }, // Sales
        11: { cellWidth: 22 }, // Akun Bayar
        12: { cellWidth: 17 }  // Status
      }
    })

    const finalY = (doc as any).lastAutoTable.finalY + 10
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text('Ringkasan Produk Laku:', 14, finalY)

    // Calculate product aggregation
    const productSummaryMap: Record<string, { quantity: number, total: number, unit: string }> = {}
    reportData.forEach(item => {
      const key = item.isBonus ? `${item.productName} [BONUS]` : item.productName
      if (!productSummaryMap[key]) {
        productSummaryMap[key] = { quantity: 0, total: 0, unit: item.unit }
      }
      productSummaryMap[key].quantity += item.quantity
      productSummaryMap[key].total += item.total
    })

    const productSummaryTable = Object.entries(productSummaryMap)
      .map(([name, data]) => [
        name,
        data.quantity.toString(),
        data.unit || 'pcs',
        `Rp ${data.total.toLocaleString()}`
      ])
      .sort((a, b) => (b[1] as any) - (a[1] as any))

    autoTable(doc, {
      head: [['Produk', 'Total Qty', 'Unit', 'Total Nilai']],
      body: productSummaryTable,
      startY: finalY + 5,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [52, 152, 219] },
      columnStyles: {
        1: { halign: 'center', cellWidth: 20 },
        2: { halign: 'center', cellWidth: 20 },
        3: { halign: 'right', cellWidth: 40 }
      }
    })

    const finalSummaryY = (doc as any).lastAutoTable.finalY + 10
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text('Statistik Umum:', 14, finalSummaryY)

    const totalItems = reportData.length
    const totalQuantity = reportData.reduce((sum, item) => sum + item.quantity, 0)
    const totalValue = reportData.reduce((sum, item) => sum + item.total, 0)
    const uniqueTransactions = new Set(reportData.map(item => item.transactionId)).size
    const deliveryItems = reportData.filter(item => item.source === 'delivery').length
    const officeSaleItems = reportData.filter(item => item.source === 'office_sale').length
    const retasiItems = reportData.filter(item => item.source === 'retasi').length
    const migrationItems = reportData.filter(item => item.source === 'migration').length
    const posKasirItems = reportData.filter(item => item.source === 'pos_kasir').length
    const regularItems = reportData.filter(item => !item.isBonus).length
    const bonusItems = reportData.filter(item => item.isBonus).length

    doc.setFont('helvetica', 'normal')
    doc.text(`• Total Entri: ${totalItems} (Diantar: ${deliveryItems}, Laku Kantor: ${officeSaleItems}, Retasi: ${retasiItems}, Migrasi: ${migrationItems}, Pos Kasir: ${posKasirItems})`, 14, finalSummaryY + 8)
    if (productFilter === 'all') {
      doc.text(`• Produk Reguler: ${regularItems}, Produk Bonus: ${bonusItems}`, 14, finalSummaryY + 16)
      doc.text(`• Total Seluruh Quantity: ${totalQuantity}`, 14, finalSummaryY + 24)
      doc.text(`• Total Seluruh Nilai: Rp ${totalValue.toLocaleString()}`, 14, finalSummaryY + 32)
      doc.text(`• Total Transaksi Unik: ${uniqueTransactions}`, 14, finalSummaryY + 40)
    } else {
      doc.text(`• Total Seluruh Quantity: ${totalQuantity}`, 14, finalSummaryY + 16)
      doc.text(`• Total Seluruh Nilai: Rp ${totalValue.toLocaleString()}`, 14, finalSummaryY + 24)
      doc.text(`• Total Transaksi Unik: ${uniqueTransactions}`, 14, finalSummaryY + 32)
    }

    const filterSuffix = productFilter !== 'all' ? `-${productFilter.replace(/\s+/g, '')}` : ''
    const sourceSuffix = sourceFilter === 'delivery' ? '-Pengantaran' :
      sourceFilter === 'office_sale' ? '-LakuKantor' :
        sourceFilter === 'retasi' ? '-Retasi' : ''
    const filename = filterType === 'monthly'
      ? `Laporan-Produk-Laku${filterSuffix}${sourceSuffix}-${months.find(m => m.value === selectedMonth)?.label}-${selectedYear}.pdf`
      : `Laporan-Produk-Laku${filterSuffix}${sourceSuffix}-${format(new Date(startDate), 'dd-MM-yyyy')}-to-${format(new Date(endDate), 'dd-MM-yyyy')}.pdf`
    doc.save(filename)
  }

  const handleExportExcel = () => {
    const title = getReportTitle()

    // Prepare data for Excel
    const excelData = reportData.map(item => ({
      'Tanggal Laku': format(item.soldDate, 'dd/MM/yyyy'),
      'No. Transaksi': item.transactionId.substring(0, 8) + '...',
      'Customer': item.customerName,
      'Produk': item.isBonus ? `${item.productName} [BONUS]` : item.productName,
      'Qty': item.quantity,
      'Unit': item.unit,
      'Harga': item.price,
      'Total': item.total,
      'Sumber': item.source === 'delivery' ? 'Diantar' : item.source === 'office_sale' ? 'Laku Kantor' : item.source === 'retasi' ? 'Retasi' : item.source === 'migration' ? 'Migrasi' : 'Laku Pos Kasir',
      'Retasi': item.retasiNumber || '-',
      'Supir/Kasir': item.source === 'delivery' || item.source === 'retasi' ? (item.driverName || '-') : item.cashierName,
      'Sales': item.salesName || '-',
      'Akun Pembayaran': item.paymentAccountName || '-',
      'Status': item.paymentStatus || 'Belum Lunas'
    }))

    // Create workbook and worksheet
    const ws = XLSX.utils.json_to_sheet(excelData)

    // Add title row at the beginning
    XLSX.utils.sheet_add_aoa(ws, [[title]], { origin: 'A1' })
    XLSX.utils.sheet_add_aoa(ws, [[`Digenerate pada: ${format(new Date(), 'dd MMMM yyyy HH:mm', { locale: id })}`]], { origin: 'A2' })
    XLSX.utils.sheet_add_aoa(ws, [['']], { origin: 'A3' })

    // Re-add data with header starting from row 4
    const headers = ['Tanggal Laku', 'No. Transaksi', 'Customer', 'Produk', 'Qty', 'Unit', 'Harga', 'Total', 'Sumber', 'Retasi', 'Supir/Kasir', 'Sales', 'Akun Pembayaran', 'Status']
    XLSX.utils.sheet_add_aoa(ws, [headers], { origin: 'A4' })

    // Add data rows starting from row 5
    const dataRows = excelData.map(item => Object.values(item))
    XLSX.utils.sheet_add_aoa(ws, dataRows, { origin: 'A5' })

    // Add summary at the end
    const totalItems = reportData.length
    const totalQuantity = reportData.reduce((sum, item) => sum + item.quantity, 0)
    const totalValue = reportData.reduce((sum, item) => sum + item.total, 0)
    const uniqueTransactions = new Set(reportData.map(item => item.transactionId)).size
    const deliveryItems = reportData.filter(item => item.source === 'delivery').length
    const officeSaleItems = reportData.filter(item => item.source === 'office_sale').length
    const retasiItems = reportData.filter(item => item.source === 'retasi').length
    const migrationItems = reportData.filter(item => item.source === 'migration').length
    const posKasirItems = reportData.filter(item => item.source === 'pos_kasir').length

    // Calculate product aggregation for Excel
    const productSummaryMap: Record<string, { quantity: number, total: number, unit: string }> = {}
    reportData.forEach(item => {
      const key = item.isBonus ? `${item.productName} [BONUS]` : item.productName
      if (!productSummaryMap[key]) {
        productSummaryMap[key] = { quantity: 0, total: 0, unit: item.unit }
      }
      productSummaryMap[key].quantity += item.quantity
      productSummaryMap[key].total += item.total
    })

    const productSummaryRows = Object.entries(productSummaryMap)
      .map(([name, data]) => [name, data.quantity, data.unit, data.total])
      .sort((a, b) => (b[1] as any) - (a[1] as any))

    const summaryStartRow = 5 + excelData.length + 2
    XLSX.utils.sheet_add_aoa(ws, [
      ['RINGKASAN PER PRODUK'],
      ['Produk', 'Total Qty', 'Unit', 'Total Nilai'],
      ...productSummaryRows,
      [''],
      ['STATISTIK UMUM'],
      [`Total Entri: ${totalItems} (Diantar: ${deliveryItems}, Laku Kantor: ${officeSaleItems}, Retasi: ${retasiItems}, Migrasi: ${migrationItems}, Pos Kasir: ${posKasirItems})`],
      [`Total Seluruh Quantity: ${totalQuantity}`],
      [`Total Seluruh Nilai: Rp ${totalValue.toLocaleString()}`],
      [`Total Transaksi Unik: ${uniqueTransactions}`]
    ], { origin: `A${summaryStartRow}` })

    // Set column widths
    ws['!cols'] = [
      { wch: 12 }, // Tanggal
      { wch: 15 }, // No. Transaksi
      { wch: 25 }, // Customer
      { wch: 35 }, // Produk
      { wch: 8 },  // Qty
      { wch: 10 }, // Unit
      { wch: 15 }, // Harga
      { wch: 18 }, // Total
      { wch: 15 }, // Sumber
      { wch: 25 }, // Retasi
      { wch: 20 }, // Supir/Kasir
      { wch: 20 }, // Akun Pembayaran
      { wch: 12 }  // Status
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Produk Laku')

    // Generate filename
    const filterSuffix = productFilter !== 'all' ? `-${productFilter.replace(/\s+/g, '')}` : ''
    const sourceSuffix = sourceFilter === 'delivery' ? '-Pengantaran' :
      sourceFilter === 'office_sale' ? '-LakuKantor' :
        sourceFilter === 'retasi' ? '-Retasi' : ''
    const filename = filterType === 'monthly'
      ? `Laporan-Produk-Laku${filterSuffix}${sourceSuffix}-${months.find(m => m.value === selectedMonth)?.label}-${selectedYear}.xlsx`
      : `Laporan-Produk-Laku${filterSuffix}${sourceSuffix}-${format(new Date(startDate), 'dd-MM-yyyy')}-to-${format(new Date(endDate), 'dd-MM-yyyy')}.xlsx`

    XLSX.writeFile(wb, filename)
  }

  const getSourceBadge = (source: 'delivery' | 'office_sale' | 'retasi' | 'migration' | 'pos_kasir', retasiNumber?: string) => {
    if (source === 'delivery') {
      return (
        <Badge variant="secondary" className="bg-blue-100 text-blue-800 border-blue-300">
          <Truck className="h-3 w-3 mr-1" />
          Diantar
        </Badge>
      )
    }
    if (source === 'retasi') {
      return (
        <Badge variant="secondary" className="bg-purple-100 text-purple-800 border-purple-300">
          <Navigation className="h-3 w-3 mr-1" />
          {retasiNumber ? `Retasi ${retasiNumber}` : 'Retasi'}
        </Badge>
      )
    }
    if (source === 'migration') {
      return (
        <Badge variant="secondary" className="bg-orange-100 text-orange-800 border-orange-300">
          <Package className="h-3 w-3 mr-1" />
          Migrasi
        </Badge>
      )
    }
    if (source === 'pos_kasir') {
      return (
        <Badge variant="secondary" className="bg-cyan-100 text-cyan-800 border-cyan-300">
          <ShoppingCart className="h-3 w-3 mr-1" />
          Pos Kasir
        </Badge>
      )
    }
    return (
      <Badge variant="secondary" className="bg-green-100 text-green-800 border-green-300">
        <Store className="h-3 w-3 mr-1" />
        Laku Kantor
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Laporan Produk Laku
          </CardTitle>
          <CardDescription>
            Laporan produk yang sudah laku berdasarkan pengantaran, laku kantor, retasi, data migrasi, dan penjualan pos kasir
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            {/* Filter Type Selection */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Jenis Filter</Label>
                <Select value={filterType} onValueChange={(value: 'monthly' | 'dateRange') => setFilterType(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Bulanan</SelectItem>
                    <SelectItem value="dateRange">Rentang Tanggal</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1">
                  <Package className="h-3 w-3" />
                  Item Produk
                </Label>
                <Select value={productFilter} onValueChange={setProductFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Semua Produk" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Produk</SelectItem>
                    {availableProducts.map(product => (
                      <SelectItem key={product} value={product}>
                        {product}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Sumber</Label>
                <Select value={sourceFilter} onValueChange={(value: 'all' | 'delivery' | 'office_sale' | 'retasi' | 'migration' | 'pos_kasir') => setSourceFilter(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Sumber</SelectItem>
                    <SelectItem value="delivery">Pengantaran</SelectItem>
                    <SelectItem value="office_sale">Laku Kantor</SelectItem>
                    <SelectItem value="retasi">Retasi</SelectItem>
                    <SelectItem value="migration">Data Migrasi</SelectItem>
                    <SelectItem value="pos_kasir">Laku Pos Kasir</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1">
                  <Navigation className="h-3 w-3" />
                  Retasi Ke
                </Label>
                <Select value={retasiKeFilter} onValueChange={setRetasiKeFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Semua" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Retasi</SelectItem>
                    {availableRetasiKe.map(item => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1">
                  <User className="h-3 w-3" />
                  Supir
                </Label>
                <Select value={driverFilter} onValueChange={setDriverFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Semua Supir" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Supir</SelectItem>
                    {availableDrivers.map(name => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1">
                  <User className="h-3 w-3" />
                  Helper
                </Label>
                <Select value={helperFilter} onValueChange={setHelperFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Semua Helper" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Helper</SelectItem>
                    {availableHelpers.map(name => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1">
                  <User className="h-3 w-3" />
                  Kasir
                </Label>
                <Select value={cashierFilter} onValueChange={setCashierFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Semua Kasir" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Kasir</SelectItem>
                    {availableCashiers.map(name => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Payment Account, Status & Sales Filter */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1">
                  <Wallet className="h-3 w-3" />
                  Akun Pembayaran
                </Label>
                <Select value={paymentAccountFilter} onValueChange={setPaymentAccountFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Semua Akun" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Akun Pembayaran</SelectItem>
                    {paymentAccounts.map(account => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.code ? `${account.code} - ${account.name}` : account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1">
                  <CreditCard className="h-3 w-3" />
                  Status Pembayaran
                </Label>
                <Select value={paymentStatusFilter} onValueChange={(value: 'all' | 'Lunas' | 'Belum Lunas') => setPaymentStatusFilter(value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Semua Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Status</SelectItem>
                    <SelectItem value="Lunas">Lunas</SelectItem>
                    <SelectItem value="Belum Lunas">Belum Lunas</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1">
                  <UserCheck className="h-3 w-3" />
                  Sales
                </Label>
                <Select value={salesFilter} onValueChange={setSalesFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Semua Sales" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Sales</SelectItem>
                    {availableSales.map(name => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Monthly Filter */}
            {filterType === 'monthly' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Bulan</Label>
                  <Select value={selectedMonth.toString()} onValueChange={(value) => setSelectedMonth(Number(value))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {months.map(month => (
                        <SelectItem key={month.value} value={month.value.toString()}>
                          {month.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Tahun</Label>
                  <Select value={selectedYear.toString()} onValueChange={(value) => setSelectedYear(Number(value))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {years.map(year => (
                        <SelectItem key={year} value={year.toString()}>
                          {year}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Date Range Filter */}
            {filterType === 'dateRange' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <CalendarDays className="h-4 w-4" />
                    Tanggal Mulai
                  </Label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <CalendarDays className="h-4 w-4" />
                    Tanggal Selesai
                  </Label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button onClick={handleGenerateReport} disabled={isLoading}>
                <Calendar className="mr-2 h-4 w-4" />
                {isLoading ? 'Generating...' : 'Generate Laporan'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <Card>
          <CardContent className="p-6">
            <div className="space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {reportData.length > 0 && !isLoading && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Hasil Laporan - {filterType === 'monthly'
                  ? `${months.find(m => m.value === selectedMonth)?.label} ${selectedYear}`
                  : `${format(new Date(startDate), 'dd MMM yyyy', { locale: id })} s/d ${format(new Date(endDate), 'dd MMM yyyy', { locale: id })}`
                }
              </CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handlePrintReport}>
                  <Download className="mr-2 h-4 w-4" />
                  Cetak PDF
                </Button>
                <Button variant="outline" size="sm" onClick={handleExportExcel}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Export Excel
                </Button>
              </div>
            </div>

            {/* Summary Cards - Moved to Header */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-9 gap-3 mt-4">
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 text-center">
                <div className="text-xl font-bold">{reportData.length}</div>
                <div className="text-xs text-muted-foreground">Total Produk</div>
              </div>
              <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-blue-600">{reportData.filter(item => item.source === 'delivery').length}</div>
                <div className="text-xs text-muted-foreground">Diantar</div>
              </div>
              <div className="bg-green-50 dark:bg-green-900/30 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-green-600">{reportData.filter(item => item.source === 'office_sale').length}</div>
                <div className="text-xs text-muted-foreground">Laku Kantor</div>
              </div>
              <div className="bg-purple-50 dark:bg-purple-900/30 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-purple-600">{reportData.filter(item => item.source === 'retasi').length}</div>
                <div className="text-xs text-muted-foreground">Retasi</div>
              </div>
              <div className="bg-orange-50 dark:bg-orange-900/30 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-orange-600">{reportData.filter(item => item.source === 'migration').length}</div>
                <div className="text-xs text-muted-foreground">Migrasi</div>
              </div>
              <div className="bg-cyan-50 dark:bg-cyan-900/30 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-cyan-600">{reportData.filter(item => item.source === 'pos_kasir').length}</div>
                <div className="text-xs text-muted-foreground">Pos Kasir</div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 text-center">
                <div className="text-xl font-bold">{reportData.reduce((sum, item) => sum + item.quantity, 0)}</div>
                <div className="text-xs text-muted-foreground">Total Qty</div>
              </div>
              <div className="bg-emerald-50 dark:bg-emerald-900/30 rounded-lg p-3 text-center">
                <div className="text-lg font-bold text-emerald-600">Rp {reportData.reduce((sum, item) => sum + item.total, 0).toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">Total Nilai</div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 text-center">
                <div className="text-xl font-bold">{new Set(reportData.map(item => item.transactionId)).size}</div>
                <div className="text-xs text-muted-foreground">Transaksi</div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            <h3 className="text-lg font-medium">Detail Produk Laku</h3>

            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal Laku</TableHead>
                    <TableHead>No. Transaksi</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Produk</TableHead>
                    <TableHead className="text-center">Qty</TableHead>
                    <TableHead className="text-center">Harga</TableHead>
                    <TableHead className="text-center">Total</TableHead>
                    <TableHead className="text-center">Sumber</TableHead>
                    <TableHead>Retasi</TableHead>
                    <TableHead>Supir/Kasir</TableHead>
                    <TableHead>Sales</TableHead>
                    <TableHead>Akun Bayar</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportData.map((item, index) => (
                    <TableRow key={`${item.transactionId}-${index}`}>
                      <TableCell className="font-mono">
                        {format(item.soldDate, 'dd/MM/yyyy')}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {item.transactionId.substring(0, 8)}...
                      </TableCell>
                      <TableCell className="font-medium">
                        {item.customerName}
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {item.productName}
                            {item.isBonus && (
                              <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-800 border-orange-300">
                                BONUS
                              </Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground">{item.unit}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center font-mono">
                        {item.quantity}
                      </TableCell>
                      <TableCell className="text-center font-mono">
                        Rp {item.price.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-center font-mono font-medium">
                        Rp {item.total.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-center">
                        {getSourceBadge(item.source, item.retasiNumber)}
                      </TableCell>
                      <TableCell className="text-sm font-mono">
                        {item.retasiNumber || '-'}
                      </TableCell>
                      <TableCell className="text-sm">
                        {item.source === 'delivery' || item.source === 'retasi'
                          ? (item.driverName || '-')
                          : item.cashierName}
                      </TableCell>
                      <TableCell className="text-sm">
                        {item.salesName || '-'}
                      </TableCell>
                      <TableCell className="text-sm">
                        {item.paymentAccountName || '-'}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant="secondary"
                          className={item.paymentStatus === 'Lunas'
                            ? 'bg-green-100 text-green-800 border-green-300'
                            : 'bg-yellow-100 text-yellow-800 border-yellow-300'}
                        >
                          {item.paymentStatus || 'Belum Lunas'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {reportData.length === 0 && !isLoading && (
        <Card>
          <CardContent className="text-center py-12">
            <ShoppingCart className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Belum Ada Data</h3>
            <p className="text-muted-foreground">
              Pilih periode dan klik "Generate Laporan" untuk melihat produk yang laku.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Laporan ini menampilkan produk dari pengantaran, laku kantor, retasi, dan data migrasi.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
