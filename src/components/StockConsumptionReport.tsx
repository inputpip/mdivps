"use client"
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { supabase } from '@/integrations/supabase/client'
import { FileText, Download, Calendar, TrendingDown, TrendingUp, Package, CalendarDays, FileSpreadsheet } from 'lucide-react'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { id } from 'date-fns/locale/id'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { useBranch } from '@/contexts/BranchContext'

interface StockReportItem {
  productId: string
  productName: string
  productType: string
  unit: string
  startingStock: number
  totalIn: number
  totalOut: number
  endingStock: number
  netMovement: number
  productions: number
  purchases: number
  sales: number
}

interface StockMovementDetail {
  id: string
  productId: string
  productName: string
  productType: string
  unit: string
  customerName?: string
  movementDate: Date
  type: 'IN' | 'OUT'
  source: string
  reference: string
  reason: string
  quantity: number
  userName: string
  notes: string
  stockBefore: number
  stockAfter: number
}

type StockMovementDraft = Omit<StockMovementDetail, 'stockBefore' | 'stockAfter'>

const formatMovementSource = (referenceType?: string | null, movementType?: 'IN' | 'OUT') => {
  switch (referenceType) {
    case 'sale':
      return movementType === 'IN' ? 'Edit / Batal Penjualan Kantor' : 'Penjualan Kantor'
    case 'delivery':
      return movementType === 'IN' ? 'Cancel / Retur Pengantaran' : 'Pengantaran'
    case 'production':
      return movementType === 'IN' ? 'Produksi' : 'Pembatalan Produksi'
    case 'adjustment':
      return movementType === 'IN' ? 'Penambahan Stok Manual' : 'Pengurangan Stok Manual'
    case 'stock_in':
      return 'Penambahan Stok'
    case 'stock_out':
      return 'Pengurangan Stok'
    default:
      return referenceType || 'Movement'
  }
}

const formatMovementReason = (reason?: string | null, referenceType?: string | null, movementType?: 'IN' | 'OUT') => {
  if (reason === 'MANUAL_ADJUSTMENT') {
    return movementType === 'IN' ? 'Koreksi Manual (Tambah)' : 'Koreksi Manual (Kurang)'
  }
  if (reason === 'PRODUCTION_ACQUISITION' || reason === 'PRODUCTION') return 'Produksi'
  if (reason === 'PRODUCTION_CONSUMPTION') return 'Pemakaian / Pengurangan Stok'
  if (reason === 'OFFICE_SALE') return 'Laku Kantor'
  if (reason === 'DELIVERY') return 'Pengantaran'
  if (reason === 'CANCEL_OR_EDIT_SALE') return 'Edit / Cancel Penjualan Kantor'
  if (reason === 'CANCEL_OR_RETURN_DELIVERY') return 'Cancel / Retur Pengantaran'
  if (referenceType === 'production' && movementType === 'IN') return 'Produksi'
  if (referenceType === 'stock_in') return 'Penambahan Stok'
  if (referenceType === 'stock_out') return 'Pengurangan Stok'
  if (referenceType === 'sale' && movementType === 'IN') return 'Edit / Cancel Penjualan Kantor'
  if (referenceType === 'delivery' && movementType === 'IN') return 'Cancel / Retur Pengantaran'
  return reason || 'Movement'
}

export const StockConsumptionReport = () => {
  const [filterType, setFilterType] = useState<'monthly' | 'dateRange'>('monthly')
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'))
  const [reportData, setReportData] = useState<StockReportItem[]>([])
  const [movementDetails, setMovementDetails] = useState<StockMovementDetail[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const { currentBranch } = useBranch()

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

  const generateReport = async (fromDate: Date, toDate: Date): Promise<{
    reports: StockReportItem[]
    movementDetails: StockMovementDetail[]
  }> => {
    let productsQuery = supabase
      .from('products')
      .select('id, name, type, unit')
      .order('name')

    if (currentBranch?.id) {
      productsQuery = productsQuery.eq('branch_id', currentBranch.id)
    }

    const { data: products, error: productsError } = await productsQuery
    if (productsError) throw productsError

    const productMap = new Map((products || []).map(product => [product.id, product]))

    let stockQuery = supabase.from('v_product_current_stock').select('product_id, current_stock')
    if (currentBranch?.id) {
      stockQuery = stockQuery.eq('branch_id', currentBranch.id)
    }
    const { data: stockData } = await stockQuery
    const stockMap = new Map<string, number>()
    ;(stockData || []).forEach((stockRow: any) => stockMap.set(stockRow.product_id, Number(stockRow.current_stock) || 0))

    const movementCandidates: StockMovementDraft[] = []

    let productionsQuery = supabase
      .from('production_records')
      .select('id, ref, product_id, quantity, created_at, note, user_input_name, created_by, is_cancelled')
      .or('is_cancelled.is.false,is_cancelled.is.null')
      .gte('created_at', fromDate.toISOString())
      .lte('created_at', toDate.toISOString())
      .gt('quantity', 0)

    if (currentBranch?.id) {
      productionsQuery = productionsQuery.eq('branch_id', currentBranch.id)
    }

    const { data: productionRecords, error: productionError } = await productionsQuery
    if (productionError) console.warn('Production query error:', productionError)

    productionRecords?.forEach((record: any) => {
      const product = productMap.get(record.product_id)
      if (!product || product.type === 'Jasa') return

      const quantity = Number(record.quantity) || 0
      if (quantity <= 0) return

      movementCandidates.push({
        id: `production-${record.id}`,
        productId: record.product_id,
        productName: product.name,
        productType: product.type || 'Stock',
        unit: product.unit || 'pcs',
        movementDate: new Date(record.created_at),
        type: 'IN',
        source: 'Produksi',
        reference: record.ref || record.id,
        reason: 'Produksi',
        quantity,
        userName: record.user_input_name || record.created_by || 'System',
        notes: record.note || '',
      })
    })

    let deliveriesQuery = supabase
      .from('deliveries')
      .select(`
        id,
        transaction_id,
        delivery_number,
        delivery_date,
        driver_name,
        notes,
        is_cancelled,
        delivery_items(
          id,
          product_id,
          quantity_delivered,
          notes
        )
      `)
      .or('is_cancelled.is.false,is_cancelled.is.null')
      .gte('delivery_date', fromDate.toISOString())
      .lte('delivery_date', toDate.toISOString())

    if (currentBranch?.id) {
      deliveriesQuery = deliveriesQuery.eq('branch_id', currentBranch.id)
    }

    const { data: deliveries, error: deliveriesError } = await deliveriesQuery
    if (deliveriesError) console.warn('Deliveries query error:', deliveriesError)

    const deliveryTransactionIds = Array.from(new Set(
      (deliveries || [])
        .map((delivery: any) => delivery.transaction_id)
        .filter(Boolean)
    ))

    const deliveryCustomerMap = new Map<string, string>()
    if (deliveryTransactionIds.length > 0) {
      const { data: deliveryTransactions, error: deliveryTransactionsError } = await supabase
        .from('transactions')
        .select('id, customer_name')
        .in('id', deliveryTransactionIds)

      if (deliveryTransactionsError) {
        console.warn('Delivery transactions query error:', deliveryTransactionsError)
      }

      ;(deliveryTransactions || []).forEach((transaction: any) => {
        deliveryCustomerMap.set(transaction.id, transaction.customer_name || 'Umum')
      })
    }

    const deliveryCustomerById = new Map<string, string>()
    ;(deliveries || []).forEach((delivery: any) => {
      deliveryCustomerById.set(delivery.id, deliveryCustomerMap.get(delivery.transaction_id) || 'Umum')
    })

    deliveries?.forEach((delivery: any) => {
      delivery.delivery_items?.forEach((item: any) => {
        const product = productMap.get(item.product_id)
        if (!product || product.type === 'Jasa') return

        const quantity = Number(item.quantity_delivered) || 0
        if (quantity <= 0) return

        movementCandidates.push({
          id: `delivery-${delivery.id}-${item.id || item.product_id}`,
          productId: item.product_id,
          productName: product.name,
          productType: product.type || 'Stock',
          unit: product.unit || 'pcs',
          customerName: deliveryCustomerMap.get(delivery.transaction_id) || 'Umum',
          movementDate: new Date(delivery.delivery_date),
          type: 'OUT',
          source: 'Pengantaran',
          reference: delivery.id,
          reason: 'Pengantaran',
          quantity,
          userName: delivery.driver_name || 'System',
          notes: item.notes || delivery.notes || '',
        })
      })
    })

    let officeSalesQuery = supabase
      .from('transactions')
      .select('id, items, order_date, cashier_name, customer_name, notes')
      .eq('is_office_sale', true)
      .gte('order_date', fromDate.toISOString())
      .lte('order_date', toDate.toISOString())

    if (currentBranch?.id) {
      officeSalesQuery = officeSalesQuery.eq('branch_id', currentBranch.id)
    }

    const { data: officeSales, error: officeSalesError } = await officeSalesQuery
    if (officeSalesError) console.warn('Office sales query error:', officeSalesError)

    officeSales?.forEach((transaction: any) => {
      let items = transaction.items

      if (typeof items === 'string') {
        try {
          items = JSON.parse(items)
        } catch (error) {
          console.warn('Failed to parse office sale items for movement details:', error)
          return
        }
      }

      if (!Array.isArray(items)) return

      items.forEach((item: any, index: number) => {
        const productId = item.product?.id || item.productId || item.product_id || item.id
        const product = productMap.get(productId)
        if (!product || product.type === 'Jasa') return

        const quantity = Number(item.quantity || item.qty || 0)
        if (quantity <= 0) return

        movementCandidates.push({
          id: `office-sale-${transaction.id}-${productId}-${index}`,
          productId,
          productName: product.name,
          productType: product.type || 'Stock',
          unit: product.unit || 'pcs',
          customerName: transaction.customer_name || 'Umum',
          movementDate: new Date(transaction.order_date),
          type: 'OUT',
          source: 'Penjualan Kantor',
          reference: transaction.id,
          reason: 'Laku Kantor',
          quantity,
          userName: transaction.cashier_name || 'System',
          notes: item.notes || transaction.notes || '',
        })
      })
    })

    let inventoryBatchQuery = supabase
      .from('inventory_batches')
      .select('id, product_id, batch_date, initial_quantity, purchase_order_id, production_id, notes, created_at')
      .not('product_id', 'is', null)
      .gte('batch_date', fromDate.toISOString())
      .lte('batch_date', toDate.toISOString())

    if (currentBranch?.id) {
      inventoryBatchQuery = inventoryBatchQuery.eq('branch_id', currentBranch.id)
    }

    const { data: inventoryBatches, error: inventoryBatchesError } = await inventoryBatchQuery
    if (inventoryBatchesError) console.warn('Inventory batches query error:', inventoryBatchesError)

    inventoryBatches?.forEach((batch: any) => {
      const product = productMap.get(batch.product_id)
      if (!product || product.type === 'Jasa' || batch.production_id) return

      const quantity = Number(batch.initial_quantity) || 0
      if (quantity <= 0) return

      const isPurchase = Boolean(batch.purchase_order_id)
      movementCandidates.push({
        id: `batch-${batch.id}`,
        productId: batch.product_id,
        productName: product.name,
        productType: product.type || 'Stock',
        unit: product.unit || 'pcs',
        movementDate: new Date(batch.batch_date || batch.created_at),
        type: 'IN',
        source: isPurchase ? 'Pembelian' : 'Penambahan Stok',
        reference: batch.purchase_order_id || batch.id,
        reason: isPurchase ? 'Pembelian' : 'Adjustment / Restock',
        quantity,
        userName: 'System',
        notes: batch.notes || '',
      })
    })

    let productMovementsQuery = supabase
      .from('product_stock_movements')
      .select('id, product_id, type, reason, quantity, reference_id, reference_type, notes, user_name, created_at')
      .gte('created_at', fromDate.toISOString())
      .lte('created_at', toDate.toISOString())

    if (currentBranch?.id) {
      productMovementsQuery = productMovementsQuery.eq('branch_id', currentBranch.id)
    }

    const { data: productMovements, error: productMovementsError } = await productMovementsQuery
    if (productMovementsError) console.warn('Product stock movements query error:', productMovementsError)

    const existingKeys = new Set(
      movementCandidates.map((movement) => [
        movement.productId,
        movement.type,
        movement.reference,
        movement.reason,
        movement.quantity,
        movement.movementDate.toISOString(),
      ].join('|'))
    )

    productMovements?.forEach((movement: any) => {
      const product = productMap.get(movement.product_id)
      if (!product || product.type === 'Jasa') return

      const movementDate = new Date(movement.created_at)
      const quantity = Number(movement.quantity) || 0
      const normalizedKey = [
        movement.product_id,
        movement.type,
        movement.reference_id || movement.id,
        movement.reason || movement.reference_type || 'Movement',
        quantity,
        movementDate.toISOString(),
      ].join('|')

      if (existingKeys.has(normalizedKey)) return

      movementCandidates.push({
        id: `movement-${movement.id}`,
        productId: movement.product_id,
        productName: product.name,
        productType: product.type || 'Stock',
        unit: product.unit || 'pcs',
        customerName: movement.reference_type === 'delivery'
          ? (deliveryCustomerById.get(movement.reference_id) || undefined)
          : undefined,
        movementDate,
        type: movement.type,
        source: formatMovementSource(movement.reference_type, movement.type),
        reference: movement.reference_id || movement.id,
        reason: formatMovementReason(movement.reason, movement.reference_type, movement.type),
        quantity,
        userName: movement.user_name || 'System',
        notes: movement.notes || '',
      })
    })

    const movementsByProduct = movementCandidates.reduce((acc, movement) => {
      if (!acc[movement.productId]) acc[movement.productId] = []
      acc[movement.productId].push(movement)
      return acc
    }, {} as Record<string, StockMovementDraft[]>)

    const reports: StockReportItem[] = []
    const calculatedMovementDetails: StockMovementDetail[] = []

    for (const product of products || []) {
      if (product.type === 'Jasa') continue

      const productMovementsForItem = (movementsByProduct[product.id] || [])
        .sort((a, b) => a.movementDate.getTime() - b.movementDate.getTime())

      const endingStock = stockMap.get(product.id) || 0
      const totalIn = productMovementsForItem
        .filter(movement => movement.type === 'IN')
        .reduce((sum, movement) => sum + movement.quantity, 0)
      const totalOut = productMovementsForItem
        .filter(movement => movement.type === 'OUT')
        .reduce((sum, movement) => sum + movement.quantity, 0)
      const startingStock = Math.max(0, endingStock - totalIn + totalOut)
      const netMovement = totalIn - totalOut

      let runningStock = startingStock
      productMovementsForItem.forEach((movement) => {
        const stockBefore = runningStock
        const stockAfter = movement.type === 'IN'
          ? stockBefore + movement.quantity
          : stockBefore - movement.quantity

        calculatedMovementDetails.push({
          ...movement,
          stockBefore,
          stockAfter,
        })

        runningStock = stockAfter
      })

      reports.push({
        productId: product.id,
        productName: product.name,
        productType: product.type || 'Stock',
        unit: product.unit || 'pcs',
        startingStock,
        totalIn,
        totalOut,
        endingStock,
        netMovement,
        productions: productMovementsForItem
          .filter(movement => movement.type === 'IN' && movement.source === 'Produksi')
          .reduce((sum, movement) => sum + movement.quantity, 0),
        purchases: productMovementsForItem
          .filter(movement => movement.type === 'IN' && movement.source === 'Pembelian')
          .reduce((sum, movement) => sum + movement.quantity, 0),
        sales: productMovementsForItem
          .filter(movement => movement.type === 'OUT' && ['Pengantaran', 'Penjualan Kantor'].includes(movement.source))
          .reduce((sum, movement) => sum + movement.quantity, 0),
      })
    }

    return {
      reports: reports
        .filter(report => report.totalIn > 0 || report.totalOut > 0 || report.endingStock > 0)
        .sort((a, b) => a.productName.localeCompare(b.productName)),
      movementDetails: calculatedMovementDetails.sort((a, b) => b.movementDate.getTime() - a.movementDate.getTime()),
    }
  }

  const handleGenerateReport = async () => {
    setIsLoading(true)
    try {
      let fromDate: Date
      let toDate: Date

      if (filterType === 'monthly') {
        fromDate = startOfMonth(new Date(selectedYear, selectedMonth - 1))
        toDate = endOfMonth(new Date(selectedYear, selectedMonth - 1))
      } else {
        fromDate = new Date(startDate)
        toDate = new Date(endDate)
        toDate.setHours(23, 59, 59, 999)
      }

      const { reports, movementDetails } = await generateReport(fromDate, toDate)
      setReportData(reports)
      setMovementDetails(movementDetails)
    } catch (error) {
      console.error('Error generating report:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const getReportTitle = () => {
    if (filterType === 'monthly') {
      const monthName = months.find(m => m.value === selectedMonth)?.label
      return `Laporan Stock Produk - ${monthName} ${selectedYear}`
    }
    return `Laporan Stock Produk - ${format(new Date(startDate), 'dd MMM yyyy', { locale: id })} s/d ${format(new Date(endDate), 'dd MMM yyyy', { locale: id })}`
  }

  const handlePrintPDF = () => {
    const doc = new jsPDF('landscape')
    const title = getReportTitle()

    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.text(title, 14, 22)

    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text(`Digenerate pada: ${format(new Date(), 'dd MMMM yyyy HH:mm', { locale: id })}`, 14, 30)
    doc.text(`Cabang: ${currentBranch?.name || 'Semua Cabang'}`, 14, 36)

    const tableData = reportData.map(item => [
      item.productName,
      item.productType,
      item.unit,
      item.startingStock.toString(),
      item.totalIn > 0 ? `+${item.totalIn}` : '-',
      item.totalOut > 0 ? `-${item.totalOut}` : '-',
      item.endingStock.toString(),
      item.netMovement > 0 ? `+${item.netMovement}` : item.netMovement.toString(),
    ])

    autoTable(doc, {
      head: [['Nama Produk', 'Jenis', 'Satuan', 'Stock Awal', 'Masuk', 'Keluar', 'Stock Akhir', 'Net']],
      body: tableData,
      startY: 44,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [66, 139, 202] },
      columnStyles: {
        0: { cellWidth: 80 },
        1: { cellWidth: 25 },
        2: { cellWidth: 20 },
        3: { cellWidth: 25, halign: 'right' },
        4: { cellWidth: 25, halign: 'right' },
        5: { cellWidth: 25, halign: 'right' },
        6: { cellWidth: 25, halign: 'right' },
        7: { cellWidth: 25, halign: 'right' },
      },
    })

    const finalY = (doc as any).lastAutoTable.finalY + 10
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text('Ringkasan:', 14, finalY)

    const totalProducts = reportData.length
    const totalStockIn = reportData.reduce((sum, item) => sum + item.totalIn, 0)
    const totalStockOut = reportData.reduce((sum, item) => sum + item.totalOut, 0)
    const lowStockCount = reportData.filter(item => item.endingStock <= 5).length

    doc.setFont('helvetica', 'normal')
    doc.text(`Total Produk: ${totalProducts}`, 14, finalY + 8)
    doc.text(`Total Masuk: ${totalStockIn}`, 14, finalY + 16)
    doc.text(`Total Keluar: ${totalStockOut}`, 14, finalY + 24)
    doc.text(`Produk Stock Rendah (≤5): ${lowStockCount}`, 14, finalY + 32)

    const filename = filterType === 'monthly'
      ? `Laporan-Stock-${months.find(m => m.value === selectedMonth)?.label}-${selectedYear}.pdf`
      : `Laporan-Stock-${format(new Date(startDate), 'dd-MM-yyyy')}-to-${format(new Date(endDate), 'dd-MM-yyyy')}.pdf`
    doc.save(filename)
  }

  const handleExportExcel = () => {
    const title = getReportTitle()

    const excelData = reportData.map(item => ({
      'Nama Produk': item.productName,
      'Jenis': item.productType,
      'Satuan': item.unit,
      'Stock Awal': item.startingStock,
      'Masuk': item.totalIn,
      'Keluar': item.totalOut,
      'Stock Akhir': item.endingStock,
      'Net Movement': item.netMovement,
    }))

    const detailData = movementDetails.map(item => ({
      'Tanggal & Jam': format(item.movementDate, 'dd MMM yyyy HH:mm', { locale: id }),
      'Nama Produk': item.productName,
      'Jenis Produk': item.productType,
      'Pelanggan': item.customerName || '',
      'Arah': item.type,
      'Sumber': item.source,
      'Referensi': item.reference,
      'User': item.userName,
      'Jumlah': item.quantity,
      'Stock Awal': item.stockBefore,
      'Stock Akhir': item.stockAfter,
      'Catatan': item.notes || '-',
    }))

    const summarySheet = XLSX.utils.json_to_sheet([])
    XLSX.utils.sheet_add_aoa(summarySheet, [[title]], { origin: 'A1' })
    XLSX.utils.sheet_add_aoa(summarySheet, [[`Digenerate pada: ${format(new Date(), 'dd MMMM yyyy HH:mm', { locale: id })}`]], { origin: 'A2' })
    XLSX.utils.sheet_add_aoa(summarySheet, [[`Cabang: ${currentBranch?.name || 'Semua Cabang'}`]], { origin: 'A3' })
    XLSX.utils.sheet_add_aoa(summarySheet, [['']], { origin: 'A4' })

    const summaryHeaders = ['Nama Produk', 'Jenis', 'Satuan', 'Stock Awal', 'Masuk', 'Keluar', 'Stock Akhir', 'Net Movement']
    XLSX.utils.sheet_add_aoa(summarySheet, [summaryHeaders], { origin: 'A5' })
    XLSX.utils.sheet_add_aoa(summarySheet, excelData.map(item => Object.values(item)), { origin: 'A6' })

    const summaryRow = excelData.length + 7
    XLSX.utils.sheet_add_aoa(summarySheet, [['Ringkasan:']], { origin: `A${summaryRow}` })
    XLSX.utils.sheet_add_aoa(summarySheet, [[`Total Produk: ${reportData.length}`]], { origin: `A${summaryRow + 1}` })
    XLSX.utils.sheet_add_aoa(summarySheet, [[`Total Masuk: ${reportData.reduce((sum, item) => sum + item.totalIn, 0)}`]], { origin: `A${summaryRow + 2}` })
    XLSX.utils.sheet_add_aoa(summarySheet, [[`Total Keluar: ${reportData.reduce((sum, item) => sum + item.totalOut, 0)}`]], { origin: `A${summaryRow + 3}` })

    summarySheet['!cols'] = [
      { wch: 40 },
      { wch: 12 },
      { wch: 10 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 15 },
    ]

    const detailSheet = XLSX.utils.json_to_sheet(detailData)
    detailSheet['!cols'] = [
      { wch: 22 },
      { wch: 35 },
      { wch: 14 },
      { wch: 24 },
      { wch: 8 },
      { wch: 18 },
      { wch: 18 },
      { wch: 20 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 40 },
    ]

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Ringkasan Stock')
    if (detailData.length > 0) {
      XLSX.utils.book_append_sheet(workbook, detailSheet, 'Detail Pergerakan')
    }

    const filename = filterType === 'monthly'
      ? `Laporan-Stock-${months.find(m => m.value === selectedMonth)?.label}-${selectedYear}.xlsx`
      : `Laporan-Stock-${format(new Date(startDate), 'dd-MM-yyyy')}-to-${format(new Date(endDate), 'dd-MM-yyyy')}.xlsx`

    XLSX.writeFile(workbook, filename)
  }

  const getStockStatusColor = (stock: number) => {
    if (stock <= 5) return 'bg-red-100 text-red-800'
    if (stock <= 10) return 'bg-yellow-100 text-yellow-800'
    return 'bg-green-100 text-green-800'
  }

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'Stock': return 'bg-purple-100 text-purple-800'
      case 'Beli': return 'bg-orange-100 text-orange-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getMovementTypeColor = (type: 'IN' | 'OUT') => {
    return type === 'IN'
      ? 'bg-green-100 text-green-800'
      : 'bg-red-100 text-red-800'
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Laporan Stock Produk
          </CardTitle>
          <CardDescription>
            Laporan pergerakan stock produk berdasarkan periode waktu.
            <br />
            <strong>Stock Awal</strong> = Stock di awal periode | <strong>Masuk</strong> = Semua penambahan stock | <strong>Keluar</strong> = Semua pengurangan stock | <strong>Stock Akhir</strong> = Stock di akhir periode
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Jenis Filter</Label>
              <Select value={filterType} onValueChange={(value: 'monthly' | 'dateRange') => setFilterType(value)}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Bulanan</SelectItem>
                  <SelectItem value="dateRange">Rentang Tanggal</SelectItem>
                </SelectContent>
              </Select>
            </div>

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

            <div className="flex gap-2">
              <Button onClick={handleGenerateReport} disabled={isLoading}>
                <Calendar className="mr-2 h-4 w-4" />
                {isLoading ? 'Generating...' : 'Generate Laporan'}
              </Button>
              {reportData.length > 0 && (
                <>
                  <Button variant="outline" onClick={handlePrintPDF}>
                    <Download className="mr-2 h-4 w-4" />
                    Cetak PDF
                  </Button>
                  <Button variant="outline" onClick={handleExportExcel}>
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    Export Excel
                  </Button>
                </>
              )}
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
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Hasil Laporan - {filterType === 'monthly'
                  ? `${months.find(m => m.value === selectedMonth)?.label} ${selectedYear}`
                  : `${format(new Date(startDate), 'dd MMM yyyy', { locale: id })} s/d ${format(new Date(endDate), 'dd MMM yyyy', { locale: id })}`
                }
              </span>
              <div className="flex gap-2 text-sm text-muted-foreground items-center">
                <span>{reportData.length} Produk</span>
                <span>|</span>
                <span className="text-green-600">+{reportData.reduce((sum, item) => sum + item.totalIn, 0)} Masuk</span>
                <span>|</span>
                <span className="text-red-600">-{reportData.reduce((sum, item) => sum + item.totalOut, 0)} Keluar</span>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nama Produk</TableHead>
                    <TableHead>Jenis</TableHead>
                    <TableHead className="text-right">Stock Awal</TableHead>
                    <TableHead className="text-right">Masuk</TableHead>
                    <TableHead className="text-right">Keluar</TableHead>
                    <TableHead className="text-right">Stock Akhir</TableHead>
                    <TableHead className="text-right">Net Movement</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportData.map((item) => (
                    <TableRow key={item.productId}>
                      <TableCell className="font-medium">
                        <div>
                          <div className="font-medium">{item.productName}</div>
                          <div className="text-sm text-muted-foreground">{item.unit}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={getTypeColor(item.productType)}>
                          {item.productType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">{item.startingStock}</TableCell>
                      <TableCell className="text-right">
                        {item.totalIn > 0 ? (
                          <div className="flex items-center justify-end gap-1 text-green-600">
                            <TrendingUp className="h-3 w-3" />
                            <span className="font-mono">+{item.totalIn}</span>
                          </div>
                        ) : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.totalOut > 0 ? (
                          <div className="flex items-center justify-end gap-1 text-red-600">
                            <TrendingDown className="h-3 w-3" />
                            <span className="font-mono">-{item.totalOut}</span>
                          </div>
                        ) : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">{item.endingStock}</TableCell>
                      <TableCell className="text-right">
                        <span className={`font-mono font-medium ${item.netMovement > 0 ? 'text-green-600' : item.netMovement < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                          {item.netMovement > 0 ? `+${item.netMovement}` : item.netMovement}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary" className={getStockStatusColor(item.endingStock)}>
                          {item.endingStock <= 5 ? 'Rendah' : item.endingStock <= 10 ? 'Sedang' : 'Baik'}
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

      {movementDetails.length > 0 && !isLoading && (
        <Card>
          <CardHeader>
            <CardTitle>Detail Pergerakan Produk</CardTitle>
            <CardDescription>
              Setiap pergerakan stock dicatat per tanggal, jam, pelanggan, user, referensi, jumlah, stock awal, dan stock akhir.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal & Jam</TableHead>
                    <TableHead>Produk</TableHead>
                    <TableHead>Pelanggan</TableHead>
                    <TableHead>Arah</TableHead>
                    <TableHead>Sumber</TableHead>
                    <TableHead>Referensi</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead className="text-right">Jumlah</TableHead>
                    <TableHead className="text-right">Stock Awal</TableHead>
                    <TableHead className="text-right">Stock Akhir</TableHead>
                    <TableHead>Catatan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movementDetails.map((movement) => (
                    <TableRow key={movement.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {format(movement.movementDate, 'dd MMM yyyy HH:mm', { locale: id })}
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{movement.productName}</div>
                          <div className="text-xs text-muted-foreground">{movement.unit}</div>
                        </div>
                      </TableCell>
                      <TableCell>{movement.customerName || ''}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={getMovementTypeColor(movement.type)}>
                          {movement.type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">{movement.source}</div>
                        <div className="text-xs text-muted-foreground">{movement.reason}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{movement.reference}</TableCell>
                      <TableCell>{movement.userName || 'System'}</TableCell>
                      <TableCell className="text-right">
                        <span className={`font-mono font-medium ${movement.type === 'IN' ? 'text-green-600' : 'text-red-600'}`}>
                          {movement.type === 'IN' ? '+' : '-'}{movement.quantity}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono">{movement.stockBefore}</TableCell>
                      <TableCell className="text-right font-mono font-medium">{movement.stockAfter}</TableCell>
                      <TableCell className="max-w-[260px] whitespace-normal text-sm text-muted-foreground">
                        {movement.notes || '-'}
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
            <Package className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Belum Ada Data Stock</h3>
            <p className="text-muted-foreground mb-4">
              Klik "Generate Laporan" untuk melihat pergerakan stock produk dalam periode yang dipilih.
            </p>
            <div className="text-sm text-muted-foreground space-y-1">
              <p><strong>Keterangan:</strong></p>
              <p>Stock Awal = Stock produk di awal periode filter</p>
              <p>Masuk = Semua penambahan stock produk</p>
              <p>Keluar = Semua pengurangan stock produk</p>
              <p>Stock Akhir = Stock produk di akhir periode</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
