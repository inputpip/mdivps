"use client"
import { useState, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { DateRange } from "react-day-picker"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FileDown, Package2, TrendingUp, TrendingDown, ShoppingCart, Factory, AlertTriangle, ArrowUpDown } from 'lucide-react'
import { format, startOfMonth, endOfMonth, startOfDay, endOfDay } from 'date-fns'
import { id } from 'date-fns/locale/id'
import { useMaterialMovements } from '@/hooks/useMaterialMovements'
import { useTransactions } from '@/hooks/useTransactions'
import { useMaterials } from '@/hooks/useMaterials'
import { useCompanySettings } from '@/hooks/useCompanySettings'
import { MaterialMovement } from '@/types/materialMovement'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

interface MaterialSummary {
  materialId: string
  materialName: string
  materialType: string
  unit: string
  openingStock: number
  totalIn: number
  totalOut: number
  closingStock: number
  purchaseQty: number
  productionQty: number
  errorQty: number
  adjustmentQty: number
}

export function MaterialMovementReport() {
  const { stockMovements, isLoading: isMovementsLoading } = useMaterialMovements()
  const { transactions } = useTransactions()
  const { materials } = useMaterials()
  const { settings: companyInfo } = useCompanySettings()

  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  })
  const [activeTab, setActiveTab] = useState<string>("summary")

  // Enhanced material movements with transaction linking
  const enrichedMovements = useMemo(() => {
    if (!stockMovements || !dateRange?.from || !dateRange?.to) return []

    const from = startOfDay(dateRange.from)
    const to = endOfDay(dateRange.to)

    // Filter by date range
    const filteredMovements = stockMovements.filter(movement => {
      const movementDate = new Date(movement.createdAt)
      return movementDate >= from && movementDate <= to
    })

    // Enrich with transaction data
    return filteredMovements.map(movement => {
      let transactionData = null
      let transactionId = '-'

      // Try to find related transaction
      if (movement.referenceType === 'transaction' && movement.referenceId) {
        const transaction = transactions?.find(t => t.id === movement.referenceId)
        if (transaction) {
          transactionData = transaction
          transactionId = transaction.id
        }
      } else if (movement.referenceType === 'purchase_order') {
        transactionId = movement.referenceId || '-'
      }

      return {
        ...movement,
        transactionData,
        transactionId,
      }
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [stockMovements, transactions, dateRange])

  // Generate actual material movements from transactions (only for production status)
  const transactionBasedMovements = useMemo(() => {
    if (!transactions || !dateRange?.from || !dateRange?.to) return []

    const from = startOfDay(dateRange.from)
    const to = endOfDay(dateRange.to)

    const movements: any[] = []

    // Process transactions in date range that are in production or completed
    transactions.forEach(transaction => {
      const transactionDate = new Date(transaction.orderDate)
      if (transactionDate >= from && transactionDate <= to) {
        // Only show material movements for transactions that actually went into production
        if (transaction.status === 'Proses Produksi' || transaction.status === 'Pesanan Selesai') {

          // For each item in transaction, calculate material usage
          transaction.items.forEach(item => {
            if (item.product.materials && item.product.materials.length > 0) {
              item.product.materials.forEach(productMaterial => {
                const totalMaterialUsed = productMaterial.quantity * item.quantity
                const material = materials?.find(m => m.id === productMaterial.materialId)
                const materialName = material?.name || `Material untuk ${item.product.name}`

                movements.push({
                  id: `${transaction.id}-${item.product.id}-${productMaterial.materialId}`,
                  materialId: productMaterial.materialId,
                  materialName: materialName,
                  type: material?.type === 'Stock' ? 'OUT' : 'IN',
                  reason: material?.type === 'Stock' ? 'PRODUCTION_CONSUMPTION' : 'PRODUCTION_ACQUISITION',
                  quantity: totalMaterialUsed,
                  referenceId: transaction.id,
                  referenceType: 'transaction' as const,
                  notes: `${material?.type === 'Stock' ? 'Dikonsumsi' : 'Diperoleh'} untuk produksi ${item.product.name} (${item.quantity} unit)`,
                  userId: transaction.cashierId,
                  userName: transaction.cashierName,
                  createdAt: transaction.orderDate.toISOString(),
                  transactionData: transaction,
                  transactionId: transaction.id
                })
              })
            }
          })
        }
      }
    })

    return movements.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [transactions, materials, dateRange])

  // Combine both data sources (prioritize transaction-based for accuracy)
  const allMovements = useMemo(() => {
    const combined = [...transactionBasedMovements]

    // Add only valid material movements (purchases, manual adjustments, production errors - NOT product transactions/deliveries)
    enrichedMovements.forEach(movement => {
      // Include material-related movements: purchases, adjustments, production errors, and production consumption
      if (movement.referenceType !== 'transaction' &&
        movement.referenceType !== 'delivery' &&
        (movement.reason === 'PURCHASE' ||
          movement.reason === 'ADJUSTMENT' ||
          movement.reason === 'PRODUCTION' ||
          movement.reason === 'PRODUCTION_CONSUMPTION' ||
          movement.reason === 'PRODUCTION_ERROR')) {
        combined.push(movement)
      }
      // IMPORTANT: Include ALL production reference type (production errors AND production consumption)
      else if (movement.referenceType === 'production') {
        combined.push(movement)
      }
    })

    return combined.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [enrichedMovements, transactionBasedMovements])

  // Material Summaries - rangkuman per item bahan
  const materialSummaries = useMemo<MaterialSummary[]>(() => {
    if (!materials || materials.length === 0) return []

    // Group movements by materialId
    const movementsByMaterial = new Map<string, any[]>()
    allMovements.forEach(movement => {
      const materialId = movement.materialId
      if (!movementsByMaterial.has(materialId)) {
        movementsByMaterial.set(materialId, [])
      }
      movementsByMaterial.get(materialId)!.push(movement)
    })

    // Calculate summary for each material that has movements
    const summaries: MaterialSummary[] = []

    movementsByMaterial.forEach((movements, materialId) => {
      const material = materials.find(m => m.id === materialId)
      if (!material) return

      let purchaseQty = 0
      let productionQty = 0
      let errorQty = 0
      let adjustmentQty = 0
      let totalIn = 0
      let totalOut = 0

      movements.forEach(movement => {
        const qty = movement.quantity || 0

        if (movement.type === 'IN') {
          totalIn += qty
          if (movement.reason === 'PURCHASE') purchaseQty += qty
          if (movement.reason === 'ADJUSTMENT') adjustmentQty += qty
        } else {
          totalOut += qty
          if (movement.reason === 'PRODUCTION_CONSUMPTION' || movement.reason === 'PRODUCTION') productionQty += qty
          if (movement.reason === 'PRODUCTION_ERROR' || (movement.reason === 'ADJUSTMENT' && movement.referenceType === 'spoilage')) errorQty += qty
          if (movement.reason === 'ADJUSTMENT' && movement.referenceType !== 'spoilage') adjustmentQty += qty
        }
      })

      // Stok akhir adalah stok saat ini di database
      const closingStock = material.stock
      // Stok awal = stok akhir - total masuk + total keluar
      const openingStock = closingStock - totalIn + totalOut

      summaries.push({
        materialId,
        materialName: material.name,
        materialType: material.type,
        unit: material.unit,
        openingStock,
        totalIn,
        totalOut,
        closingStock,
        purchaseQty,
        productionQty,
        errorQty,
        adjustmentQty
      })
    })

    // Sort by name
    return summaries.sort((a, b) => a.materialName.localeCompare(b.materialName))
  }, [allMovements, materials])

  // Summary totals
  const summaryTotals = useMemo(() => {
    return {
      totalIn: materialSummaries.reduce((sum, m) => sum + m.totalIn, 0),
      totalOut: materialSummaries.reduce((sum, m) => sum + m.totalOut, 0),
      totalPurchase: materialSummaries.reduce((sum, m) => sum + m.purchaseQty, 0),
      totalProduction: materialSummaries.reduce((sum, m) => sum + m.productionQty, 0),
      totalError: materialSummaries.reduce((sum, m) => sum + m.errorQty, 0),
    }
  }, [materialSummaries])

  const handleExportPDF = () => {
    const pdf = new jsPDF('landscape')
    const pageWidth = pdf.internal.pageSize.getWidth()
    const margin = 15

    // Header dengan background biru
    pdf.setFillColor(59, 130, 246)
    pdf.rect(0, 0, pageWidth, 35, 'F')

    // Logo dan info perusahaan
    if (companyInfo?.logo) {
      try {
        pdf.addImage(companyInfo.logo, 'PNG', margin, 6, 20, 8, undefined, 'FAST')
      } catch (e) { console.error(e) }
    }

    pdf.setTextColor(255, 255, 255)
    pdf.setFontSize(14).setFont('helvetica', 'bold')
    pdf.text(companyInfo?.name || 'PERUSAHAAN', margin + 25, 12)
    pdf.setFontSize(8).setFont('helvetica', 'normal')
    pdf.text(companyInfo?.address || '', margin + 25, 18)
    pdf.text(companyInfo?.phone || '', margin + 25, 23)

    // Judul laporan
    pdf.setFontSize(16).setFont('helvetica', 'bold')
    pdf.text('LAPORAN RANGKUMAN PENGGUNAAN BAHAN', pageWidth - margin, 14, { align: 'right' })

    const dateRangeText = dateRange?.from && dateRange?.to
      ? `Periode: ${format(dateRange.from, 'd MMMM yyyy', { locale: id })} - ${format(dateRange.to, 'd MMMM yyyy', { locale: id })}`
      : 'Semua Data'
    pdf.setFontSize(10).setFont('helvetica', 'normal')
    pdf.text(dateRangeText, pageWidth - margin, 22, { align: 'right' })

    // Page 1: Rangkuman
    let y = 45
    pdf.setTextColor(0, 0, 0)

    // Summary cards
    pdf.setFillColor(240, 253, 244) // green
    pdf.roundedRect(margin, y, 60, 20, 2, 2, 'F')
    pdf.setFontSize(9).setFont('helvetica', 'bold')
    pdf.text('Total Masuk', margin + 5, y + 8)
    pdf.setFontSize(12)
    pdf.setTextColor(34, 197, 94)
    pdf.text(`+${summaryTotals.totalIn.toLocaleString('id-ID')}`, margin + 5, y + 16)

    pdf.setFillColor(254, 242, 242) // red
    pdf.roundedRect(margin + 65, y, 60, 20, 2, 2, 'F')
    pdf.setFontSize(9).setFont('helvetica', 'bold')
    pdf.setTextColor(0, 0, 0)
    pdf.text('Total Keluar', margin + 70, y + 8)
    pdf.setFontSize(12)
    pdf.setTextColor(220, 38, 38)
    pdf.text(`-${summaryTotals.totalOut.toLocaleString('id-ID')}`, margin + 70, y + 16)

    pdf.setFillColor(239, 246, 255) // blue
    pdf.roundedRect(margin + 130, y, 60, 20, 2, 2, 'F')
    pdf.setFontSize(9).setFont('helvetica', 'bold')
    pdf.setTextColor(0, 0, 0)
    pdf.text('Pembelian', margin + 135, y + 8)
    pdf.setFontSize(12)
    pdf.setTextColor(59, 130, 246)
    pdf.text(summaryTotals.totalPurchase.toLocaleString('id-ID'), margin + 135, y + 16)

    pdf.setFillColor(254, 249, 195) // yellow
    pdf.roundedRect(margin + 195, y, 60, 20, 2, 2, 'F')
    pdf.setFontSize(9).setFont('helvetica', 'bold')
    pdf.setTextColor(0, 0, 0)
    pdf.text('Produksi', margin + 200, y + 8)
    pdf.setFontSize(12)
    pdf.setTextColor(202, 138, 4)
    pdf.text(summaryTotals.totalProduction.toLocaleString('id-ID'), margin + 200, y + 16)

    y += 30

    // Summary table
    pdf.setTextColor(0, 0, 0)
    const summaryTableData = materialSummaries.map((summary, index) => [
      (index + 1).toString(),
      summary.materialName,
      summary.unit,
      summary.openingStock.toLocaleString('id-ID'),
      summary.purchaseQty > 0 ? `+${summary.purchaseQty.toLocaleString('id-ID')}` : '-',
      summary.productionQty > 0 ? `-${summary.productionQty.toLocaleString('id-ID')}` : '-',
      summary.errorQty > 0 ? `-${summary.errorQty.toLocaleString('id-ID')}` : '-',
      `+${summary.totalIn.toLocaleString('id-ID')}`,
      `-${summary.totalOut.toLocaleString('id-ID')}`,
      summary.closingStock.toLocaleString('id-ID')
    ])

    autoTable(pdf, {
      startY: y,
      head: [['No', 'Nama Bahan', 'Satuan', 'Stok Awal', 'Pembelian', 'Produksi', 'Rusak', 'Total Masuk', 'Total Keluar', 'Stok Akhir']],
      body: summaryTableData,
      theme: 'striped',
      headStyles: {
        fillColor: [59, 130, 246],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
        halign: 'center'
      },
      bodyStyles: {
        fontSize: 7,
        cellPadding: 2
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252]
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 10 },
        1: { halign: 'left', cellWidth: 50 },
        2: { halign: 'center', cellWidth: 20 },
        3: { halign: 'right', cellWidth: 25 },
        4: { halign: 'right', cellWidth: 25 },
        5: { halign: 'right', cellWidth: 25 },
        6: { halign: 'right', cellWidth: 20 },
        7: { halign: 'right', cellWidth: 25 },
        8: { halign: 'right', cellWidth: 25 },
        9: { halign: 'right', cellWidth: 25 }
      },
      margin: { left: margin, right: margin },
      didParseCell: (data) => {
        // Color for Masuk (green)
        if (data.column.index === 4 || data.column.index === 7) {
          if (data.cell.raw && data.cell.raw.toString().startsWith('+')) {
            data.cell.styles.textColor = [34, 197, 94]
          }
        }
        // Color for Keluar (red)
        if (data.column.index === 5 || data.column.index === 6 || data.column.index === 8) {
          if (data.cell.raw && data.cell.raw.toString().startsWith('-')) {
            data.cell.styles.textColor = [220, 38, 38]
          }
        }
      }
    })

    // Page 2: Detail
    pdf.addPage('landscape')

    // Header page 2
    pdf.setFillColor(59, 130, 246)
    pdf.rect(0, 0, pageWidth, 25, 'F')
    pdf.setTextColor(255, 255, 255)
    pdf.setFontSize(14).setFont('helvetica', 'bold')
    pdf.text('DETAIL PERGERAKAN BAHAN', margin, 16)
    pdf.setFontSize(10).setFont('helvetica', 'normal')
    pdf.text(dateRangeText, pageWidth - margin, 16, { align: 'right' })

    // Detail table
    const tableData = allMovements.map(movement => [
      format(new Date(movement.createdAt), 'dd/MM/yy HH:mm', { locale: id }),
      movement.materialName,
      movement.type === 'IN' ? 'Masuk' : 'Keluar',
      movement.reason === 'PURCHASE' ? 'Pembelian' :
        (movement.reason === 'PRODUCTION_CONSUMPTION' || movement.reason === 'PRODUCTION') ? 'Produksi' :
          (movement.reason === 'PRODUCTION_ERROR' || (movement.reason === 'ADJUSTMENT' && movement.referenceType === 'spoilage')) ? 'Barang Rusak' :
            movement.reason === 'ADJUSTMENT' ? 'Penyesuaian' : movement.reason,
      movement.type === 'IN' ? `+${movement.quantity}` : `-${movement.quantity}`,
      movement.userName || 'System',
      (movement.notes || '').substring(0, 40)
    ])

    autoTable(pdf, {
      head: [['Tanggal', 'Material', 'Jenis', 'Alasan', 'Jumlah', 'User', 'Keterangan']],
      body: tableData,
      startY: 35,
      theme: 'striped',
      headStyles: {
        fillColor: [79, 70, 229],
        fontSize: 8
      },
      bodyStyles: {
        fontSize: 7
      },
      columnStyles: {
        0: { cellWidth: 30 },
        1: { cellWidth: 50 },
        2: { cellWidth: 18 },
        3: { cellWidth: 25 },
        4: { cellWidth: 20, halign: 'right' },
        5: { cellWidth: 30 },
        6: { cellWidth: 70 }
      },
      margin: { left: margin, right: margin }
    })

    // Footer
    const pageCount = pdf.internal.pages.length - 1
    for (let i = 1; i <= pageCount; i++) {
      pdf.setPage(i)
      pdf.setFontSize(8).setTextColor(100, 100, 100)
      pdf.text(`Dicetak: ${format(new Date(), 'd MMMM yyyy HH:mm', { locale: id })} WIB`, margin, pdf.internal.pageSize.getHeight() - 10)
      pdf.text(`Halaman ${i} dari ${pageCount}`, pageWidth - margin, pdf.internal.pageSize.getHeight() - 10, { align: 'right' })
    }

    // Save
    const fileName = `rangkuman-bahan-${format(new Date(), 'yyyy-MM-dd')}.pdf`
    pdf.save(fileName)
  }

  if (isMovementsLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Package2 className="h-5 w-5" />
              Pergerakan Penggunaan Bahan
            </CardTitle>
            <CardDescription>
              Rangkuman dan riwayat penggunaan bahan dari proses produksi, barang rusak, pembelian bahan, dan penyesuaian stok
            </CardDescription>
          </div>
          <div className="flex items-center gap-4">
            <DateRangePicker
              date={dateRange}
              onDateChange={setDateRange}
            />
            <Button
              variant="outline"
              onClick={handleExportPDF}
              className="flex items-center gap-2"
            >
              <FileDown className="h-4 w-4" />
              Export PDF
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="summary" className="flex items-center gap-2">
              <ArrowUpDown className="h-4 w-4" />
              Rangkuman
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <Package2 className="h-4 w-4" />
              Riwayat
            </TabsTrigger>
          </TabsList>

          {/* Tab Rangkuman */}
          <TabsContent value="summary" className="mt-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <Card className="bg-green-50 border-green-200">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-green-600" />
                    <span className="text-sm font-medium text-green-800">Total Masuk</span>
                  </div>
                  <p className="text-2xl font-bold text-green-700 mt-2">
                    +{summaryTotals.totalIn.toLocaleString('id-ID')}
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-red-50 border-red-200">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <TrendingDown className="h-5 w-5 text-red-600" />
                    <span className="text-sm font-medium text-red-800">Total Keluar</span>
                  </div>
                  <p className="text-2xl font-bold text-red-700 mt-2">
                    -{summaryTotals.totalOut.toLocaleString('id-ID')}
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="h-5 w-5 text-blue-600" />
                    <span className="text-sm font-medium text-blue-800">Pembelian</span>
                  </div>
                  <p className="text-2xl font-bold text-blue-700 mt-2">
                    {summaryTotals.totalPurchase.toLocaleString('id-ID')}
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-yellow-50 border-yellow-200">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <Factory className="h-5 w-5 text-yellow-600" />
                    <span className="text-sm font-medium text-yellow-800">Produksi</span>
                  </div>
                  <p className="text-2xl font-bold text-yellow-700 mt-2">
                    {summaryTotals.totalProduction.toLocaleString('id-ID')}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Summary Table */}
            {materialSummaries.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Tidak ada pergerakan material dalam periode yang dipilih
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">No</TableHead>
                      <TableHead>Nama Bahan</TableHead>
                      <TableHead>Satuan</TableHead>
                      <TableHead className="text-right">Stok Awal</TableHead>
                      <TableHead className="text-right">Pembelian</TableHead>
                      <TableHead className="text-right">Produksi</TableHead>
                      <TableHead className="text-right">Rusak</TableHead>
                      <TableHead className="text-right">Total Masuk</TableHead>
                      <TableHead className="text-right">Total Keluar</TableHead>
                      <TableHead className="text-right">Stok Akhir</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {materialSummaries.map((summary, index) => (
                      <TableRow key={summary.materialId}>
                        <TableCell className="text-center">{index + 1}</TableCell>
                        <TableCell className="font-medium">{summary.materialName}</TableCell>
                        <TableCell>{summary.unit}</TableCell>
                        <TableCell className="text-right">{summary.openingStock.toLocaleString('id-ID')}</TableCell>
                        <TableCell className="text-right">
                          {summary.purchaseQty > 0 ? (
                            <span className="text-green-600">+{summary.purchaseQty.toLocaleString('id-ID')}</span>
                          ) : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {summary.productionQty > 0 ? (
                            <span className="text-red-600">-{summary.productionQty.toLocaleString('id-ID')}</span>
                          ) : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {summary.errorQty > 0 ? (
                            <span className="text-red-600">-{summary.errorQty.toLocaleString('id-ID')}</span>
                          ) : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-green-600 font-medium">+{summary.totalIn.toLocaleString('id-ID')}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-red-600 font-medium">-{summary.totalOut.toLocaleString('id-ID')}</span>
                        </TableCell>
                        <TableCell className="text-right font-bold">{summary.closingStock.toLocaleString('id-ID')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="mt-4 text-sm text-muted-foreground text-center">
              Menampilkan {materialSummaries.length} item bahan dengan pergerakan dalam periode yang dipilih
            </div>
          </TabsContent>

          {/* Tab Riwayat */}
          <TabsContent value="history" className="mt-4">
            {allMovements.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Tidak ada pergerakan material dalam periode yang dipilih
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Material</TableHead>
                      <TableHead>Jenis</TableHead>
                      <TableHead>Alasan</TableHead>
                      <TableHead className="text-right">Jumlah</TableHead>
                      <TableHead>Transaksi</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Keterangan</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allMovements.map((movement, index) => (
                      <TableRow key={movement.id || index}>
                        <TableCell>
                          {format(new Date(movement.createdAt), 'dd/MM/yyyy HH:mm', { locale: id })}
                        </TableCell>
                        <TableCell className="font-medium">
                          {movement.materialName}
                        </TableCell>
                        <TableCell>
                          <Badge variant={movement.type === 'IN' ? 'default' : 'secondary'}>
                            {movement.type === 'IN' ? 'Masuk' : 'Keluar'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {movement.reason === 'PURCHASE' ? 'Pembelian' :
                            (movement.reason === 'PRODUCTION_CONSUMPTION' || movement.reason === 'PRODUCTION') ? 'Produksi' :
                              (movement.reason === 'PRODUCTION_ERROR' || (movement.reason === 'ADJUSTMENT' && movement.referenceType === 'spoilage')) ? 'Barang Rusak' :
                                movement.reason === 'ADJUSTMENT' ? 'Penyesuaian' :
                                  movement.reason}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={movement.type === 'IN' ? 'text-green-600' : 'text-red-600'}>
                            {movement.type === 'IN' ? '+' : '-'}{movement.quantity}
                          </span>
                        </TableCell>
                        <TableCell>
                          {movement.transactionId !== '-' ? (
                            <Badge variant="outline" className="font-mono text-xs">
                              {movement.transactionId}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>{movement.userName || 'System'}</TableCell>
                        <TableCell className="max-w-[200px] truncate" title={movement.notes}>
                          {movement.notes || ''}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="mt-4 text-sm text-muted-foreground text-center">
              Menampilkan {allMovements.length} pergerakan dalam periode yang dipilih
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}