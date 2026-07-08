"use client"
import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { format } from "date-fns"
import { id } from "date-fns/locale/id"
import { supabase } from "@/integrations/supabase/client"
import { useQuery } from "@tanstack/react-query"
import { Package, Search, FileDown, Printer, Eye, User, Clock, Truck, CheckCircle, ArrowRight } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import * as XLSX from 'xlsx'
import { useCompanySettings } from "@/hooks/useCompanySettings"
import { useBranch } from "@/contexts/BranchContext"
import { createCompressedPDF } from "@/utils/pdfUtils"

interface ReceiveGoodsRecord {
  id: string
  poId: string
  materialName: string
  quantity: number
  unit: string
  receivedDate: Date
  receivedBy: string
  notes?: string
  supplierName?: string
  previousStock: number
  newStock: number
  includePpn?: boolean
  ppnAmount?: number
}

export function ReceiveGoodsTab() {
  const [searchTerm, setSearchTerm] = React.useState("")
  const [selectedRecord, setSelectedRecord] = React.useState<ReceiveGoodsRecord | null>(null)
  const [detailDialogOpen, setDetailDialogOpen] = React.useState(false)
  const [ppnFilter, setPpnFilter] = React.useState<'all' | 'with_ppn' | 'without_ppn'>('all')
  const { settings } = useCompanySettings()
  const { currentBranch } = useBranch()
  const printRef = React.useRef<HTMLDivElement>(null)

  const { data: receiveRecords, isLoading, error: queryError } = useQuery<ReceiveGoodsRecord[]>({
    queryKey: ['receiveGoods', currentBranch?.id],
    queryFn: async () => {
      console.log('Fetching receive goods records...')

      // Fetch material movements with reason 'PURCHASE'
      let query = supabase
        .from('material_stock_movements')
        .select(`
          id,
          material_id,
          material_name,
          quantity,
          previous_stock,
          new_stock,
          reference_id,
          reference_type,
          notes,
          created_at,
          user_name,
          branch_id,
          materials:material_id (
            unit
          )
        `)
        .eq('reason', 'PURCHASE')
        .eq('type', 'IN')
        .order('created_at', { ascending: false })

      // Apply branch filter - Show records for selected branch OR records without branch_id (legacy data)
      if (currentBranch?.id) {
        query = query.or(`branch_id.eq.${currentBranch.id},branch_id.is.null`)
      }

      const { data, error } = await query

      console.log('Material movements query result:', { data, error })

      if (error) {
        console.error('Error fetching material movements:', error)
        throw new Error(error.message)
      }

      // Enrich with PO data
      const enrichedData = await Promise.all(
        (data || []).map(async (movement: any) => {
          let supplierName = undefined

          let includePpn = false
          let ppnAmount = 0

          if (movement.reference_id && movement.reference_type === 'purchase_order') {
            // Use .order('id').limit(1) instead of .single() because our client forces Accept: application/json
            const { data: poDataRaw } = await supabase
              .from('purchase_orders')
              .select('supplier_name, include_ppn, ppn_amount')
              .eq('id', movement.reference_id)
              .order('id').limit(1)
            const poData = Array.isArray(poDataRaw) ? poDataRaw[0] : poDataRaw

            supplierName = poData?.supplier_name
            includePpn = poData?.include_ppn || false
            ppnAmount = poData?.ppn_amount || 0
          }

          return {
            id: movement.id,
            poId: movement.reference_id || '-',
            materialName: movement.material_name,
            quantity: movement.quantity,
            unit: movement.materials?.unit || '',
            receivedDate: new Date(movement.created_at),
            receivedBy: movement.user_name || 'Unknown',
            notes: movement.notes,
            supplierName: supplierName,
            previousStock: movement.previous_stock,
            newStock: movement.new_stock,
            includePpn: includePpn,
            ppnAmount: ppnAmount,
          } as ReceiveGoodsRecord
        })
      )

      return enrichedData
    },
    enabled: !!currentBranch,
    refetchOnMount: true, // Auto-refetch when switching branches
  })

  // Filter records by search term and PPN
  const filteredRecords = receiveRecords?.filter(record => {
    // Search filter
    const matchesSearch =
      record.poId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      record.materialName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      record.supplierName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      record.receivedBy.toLowerCase().includes(searchTerm.toLowerCase())

    // PPN filter
    const matchesPpn = ppnFilter === 'all' ||
      (ppnFilter === 'with_ppn' && record.includePpn) ||
      (ppnFilter === 'without_ppn' && !record.includePpn)

    return matchesSearch && matchesPpn
  }) || []

  // Export to Excel
  const handleExportExcel = () => {
    if (!filteredRecords || filteredRecords.length === 0) {
      alert('Tidak ada data untuk diexport')
      return
    }

    // Prepare data for Excel
    const excelData = filteredRecords.map((record, index) => ({
      'No': index + 1,
      'Tanggal Terima': format(record.receivedDate, "d MMM yyyy HH:mm", { locale: id }),
      'No. PO': record.poId,
      'Material': record.materialName,
      'Supplier': record.supplierName || '-',
      'Jumlah': `${record.quantity.toLocaleString('id-ID')} ${record.unit}`,
      'Stok Sebelum': `${record.previousStock.toLocaleString('id-ID')} ${record.unit}`,
      'Stok Setelah': `${record.newStock.toLocaleString('id-ID')} ${record.unit}`,
      'Diterima Oleh': record.receivedBy,
      'Catatan': record.notes || '-'
    }))

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(excelData)

    // Set column widths
    ws['!cols'] = [
      { wch: 5 },  // No
      { wch: 18 }, // Tanggal
      { wch: 15 }, // No. PO
      { wch: 25 }, // Material
      { wch: 20 }, // Supplier
      { wch: 15 }, // Jumlah
      { wch: 15 }, // Stok Sebelum
      { wch: 15 }, // Stok Setelah
      { wch: 20 }, // Diterima Oleh
      { wch: 30 }, // Catatan
    ]

    XLSX.utils.book_append_sheet(wb, ws, 'Penerimaan Barang')

    // Generate filename with current date
    const filename = `Penerimaan_Barang_${format(new Date(), 'yyyy-MM-dd')}.xlsx`
    XLSX.writeFile(wb, filename)
  }

  // Print function
  const handlePrint = () => {
    if (!printRef.current) return

    const printWindow = window.open('', '', 'width=800,height=600')
    if (!printWindow) return

    const companyName = settings?.name || 'Perusahaan'
    const companyAddress = settings?.address || ''
    const companyPhone = settings?.phone || ''

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Laporan Penerimaan Barang</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            padding: 20px;
            font-size: 12px;
          }
          .header {
            text-align: center;
            margin-bottom: 20px;
            border-bottom: 2px solid #000;
            padding-bottom: 10px;
          }
          .header h2 { margin: 5px 0; }
          .header p { margin: 2px 0; font-size: 11px; }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
          }
          th, td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
          }
          th {
            background-color: #f4f4f4;
            font-weight: bold;
          }
          .text-right { text-align: right; }
          .text-center { text-align: center; }
          @media print {
            body { padding: 0; }
            @page { margin: 1cm; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>${companyName}</h2>
          ${companyAddress ? `<p>${companyAddress}</p>` : ''}
          ${companyPhone ? `<p>Telp: ${companyPhone}</p>` : ''}
          <h3 style="margin-top: 15px;">LAPORAN PENERIMAAN BARANG</h3>
          <p>Dicetak pada: ${format(new Date(), "d MMMM yyyy HH:mm", { locale: id })}</p>
        </div>
        <table>
          <thead>
            <tr>
              <th class="text-center">No</th>
              <th>Tanggal Terima</th>
              <th>No. PO</th>
              <th>Material</th>
              <th>Supplier</th>
              <th class="text-right">Jumlah</th>
              <th class="text-right">Stok Sebelum</th>
              <th class="text-right">Stok Setelah</th>
              <th>Diterima Oleh</th>
              <th>Catatan</th>
            </tr>
          </thead>
          <tbody>
            ${filteredRecords.map((record, index) => `
              <tr>
                <td class="text-center">${index + 1}</td>
                <td>${format(record.receivedDate, "d MMM yyyy HH:mm", { locale: id })}</td>
                <td>${record.poId}</td>
                <td>${record.materialName}</td>
                <td>${record.supplierName || '-'}</td>
                <td class="text-right">${record.quantity.toLocaleString('id-ID')} ${record.unit}</td>
                <td class="text-right">${record.previousStock.toLocaleString('id-ID')} ${record.unit}</td>
                <td class="text-right">${record.newStock.toLocaleString('id-ID')} ${record.unit}</td>
                <td>${record.receivedBy}</td>
                <td>${record.notes || '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </body>
      </html>
    `)

    printWindow.document.close()
    printWindow.focus()

    // Wait for content to load then print
    setTimeout(() => {
      printWindow.print()
      printWindow.close()
    }, 250)
  }

  return (
    <>
      {/* Hidden div for print reference */}
      <div ref={printRef} style={{ display: 'none' }} />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            <div>
              <CardTitle>Penerimaan Barang</CardTitle>
              <CardDescription>
                History penerimaan barang dari Purchase Order
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      <CardContent>
        {/* Search and Actions */}
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Cari berdasarkan No. PO, material, supplier, atau penerima..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={ppnFilter} onValueChange={(v) => setPpnFilter(v as 'all' | 'with_ppn' | 'without_ppn')}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Filter PPN" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua</SelectItem>
              <SelectItem value="with_ppn">Dengan PPN</SelectItem>
              <SelectItem value="without_ppn">Tanpa PPN</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportExcel}
            disabled={!filteredRecords || filteredRecords.length === 0}
          >
            <FileDown className="h-4 w-4 mr-2" />
            Export Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            disabled={!filteredRecords || filteredRecords.length === 0}
          >
            <Printer className="h-4 w-4 mr-2" />
            Cetak
          </Button>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal Terima</TableHead>
                <TableHead>No. PO</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Jumlah</TableHead>
                <TableHead className="text-right">Stok Sebelum</TableHead>
                <TableHead className="text-right">Stok Setelah</TableHead>
                <TableHead>Diterima Oleh</TableHead>
                <TableHead>Catatan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={9}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filteredRecords.length > 0 ? (
                filteredRecords.map((record) => (
                  <TableRow
                    key={record.id}
                    className="hover:bg-slate-50/80 cursor-pointer"
                    onClick={() => {
                      setSelectedRecord(record)
                      setDetailDialogOpen(true)
                    }}
                  >
                    <TableCell>
                      {format(record.receivedDate, "d MMM yyyy HH:mm", { locale: id })}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{record.poId}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{record.materialName}</TableCell>
                    <TableCell>{record.supplierName || '-'}</TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono">
                        {record.quantity.toLocaleString('id-ID')} {record.unit}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono text-muted-foreground">
                        {record.previousStock.toLocaleString('id-ID')} {record.unit}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono font-semibold text-green-600">
                        {record.newStock.toLocaleString('id-ID')} {record.unit}
                      </span>
                    </TableCell>
                    <TableCell>{record.receivedBy}</TableCell>
                    <TableCell className="max-w-[200px] truncate" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <span className="truncate">{record.notes || '-'}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedRecord(record)
                            setDetailDialogOpen(true)
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                    {searchTerm ? "Tidak ditemukan penerimaan barang yang sesuai" : "Belum ada penerimaan barang"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    {/* Detail Dialog */}
    {selectedRecord && (
      <ReceiveGoodsDetailDialog
        record={selectedRecord}
        open={detailDialogOpen}
        onOpenChange={(open) => {
          setDetailDialogOpen(open)
          if (!open) setSelectedRecord(null)
        }}
        settings={settings}
      />
    )}
    </>
  )
}

// Dialog to show receive goods details (similar to retasi detail)
function ReceiveGoodsDetailDialog({
  record,
  open,
  onOpenChange,
  settings,
}: {
  record: ReceiveGoodsRecord
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: any
}) {
  const printRef = React.useRef<HTMLDivElement>(null)
  const [isGenerating, setIsGenerating] = React.useState(false)

  const stockChange = record.newStock - record.previousStock

  const handlePrintPDF = async () => {
    if (!printRef.current || isGenerating) return

    setIsGenerating(true)
    try {
      await createCompressedPDF(
        printRef.current,
        `Penerimaan-${record.poId}-${format(record.receivedDate, 'ddMMyyyy-HHmm')}.pdf`,
        [148, 210], // Half A4 (A5): 148mm x 210mm
        100 // Max 100KB
      )
    } catch (error) {
      console.error('Error generating PDF:', error)
      alert('Gagal membuat PDF: ' + (error as Error).message)
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-green-600" />
            Detail Penerimaan Barang
          </DialogTitle>
          <DialogDescription>
            {record.poId} - {format(record.receivedDate, 'd MMMM yyyy HH:mm', { locale: id })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status Badge */}
          <div className="flex justify-center">
            <Badge variant="default" className="bg-green-100 text-green-700 text-sm px-4 py-1">
              <CheckCircle className="h-4 w-4 mr-2" />
              Barang Diterima
            </Badge>
          </div>

          {/* Info Section */}
          <div className="grid grid-cols-2 gap-3 text-sm bg-slate-50 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <Truck className="h-4 w-4 text-slate-400 mt-0.5" />
              <div>
                <span className="text-slate-500 text-xs">Supplier</span>
                <p className="font-medium">{record.supplierName || '-'}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Clock className="h-4 w-4 text-slate-400 mt-0.5" />
              <div>
                <span className="text-slate-500 text-xs">Waktu Diterima</span>
                <p className="font-medium">{format(record.receivedDate, 'd MMM yyyy', { locale: id })}</p>
                <p className="text-xs text-slate-500">{format(record.receivedDate, 'HH:mm', { locale: id })} WIB</p>
              </div>
            </div>
            <div className="flex items-start gap-2 col-span-2">
              <User className="h-4 w-4 text-slate-400 mt-0.5" />
              <div>
                <span className="text-slate-500 text-xs">Diterima Oleh</span>
                <p className="font-medium">{record.receivedBy}</p>
              </div>
            </div>
          </div>

          {/* Material Card */}
          <div className="border rounded-lg p-4">
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Package className="h-4 w-4" />
              Barang yang Diterima
            </h4>
            <div className="bg-slate-50 rounded-lg p-3">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="font-bold text-base">{record.materialName}</p>
                  <p className="text-xs text-slate-500">No. PO: {record.poId}</p>
                </div>
                <Badge variant="secondary" className="bg-green-100 text-green-700">
                  +{record.quantity.toLocaleString('id-ID')} {record.unit}
                </Badge>
              </div>
            </div>
          </div>

          {/* Stock Flow */}
          <div className="border rounded-lg p-4">
            <h4 className="text-sm font-semibold mb-3">Perubahan Stok</h4>
            <div className="flex items-center justify-between gap-2 bg-slate-50 rounded-lg p-3">
              <div className="text-center">
                <p className="text-xs text-slate-500">Stok Sebelum</p>
                <p className="font-mono font-bold text-lg text-slate-600">
                  {record.previousStock.toLocaleString('id-ID')}
                </p>
                <p className="text-xs text-slate-400">{record.unit}</p>
              </div>
              <div className="flex items-center gap-2">
                <ArrowRight className="h-5 w-5 text-green-500" />
                <span className="text-green-600 font-bold">+{stockChange.toLocaleString('id-ID')}</span>
              </div>
              <div className="text-center">
                <p className="text-xs text-slate-500">Stok Setelah</p>
                <p className="font-mono font-bold text-lg text-green-600">
                  {record.newStock.toLocaleString('id-ID')}
                </p>
                <p className="text-xs text-slate-400">{record.unit}</p>
              </div>
            </div>
          </div>

          {/* Notes */}
          {record.notes && (
            <div className="border rounded-lg p-4">
              <h4 className="text-sm font-semibold mb-2">Catatan</h4>
              <p className="text-sm text-slate-600 bg-slate-50 p-2 rounded">
                {record.notes}
              </p>
            </div>
          )}

          {/* Print PDF Button */}
          <div className="pt-4 border-t flex justify-end">
            <Button
              onClick={handlePrintPDF}
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={isGenerating}
            >
              <FileDown className="h-4 w-4" />
              {isGenerating ? "Membuat PDF..." : "Cetak PDF"}
            </Button>
          </div>
        </div>
      </DialogContent>

      {/* Hidden PDF Content */}
      <div className="fixed -left-[9999px] top-0 z-[-1]">
        <div
          ref={printRef}
          className="bg-white p-4 border"
          style={{
            width: '559px',
            minHeight: '400px',
            fontSize: '11px',
            fontFamily: 'Arial, sans-serif'
          }}
        >
          {/* Header */}
          <div className="flex justify-between items-start mb-3 pb-2 border-b border-gray-300">
            <div>
              {settings?.logo && (
                <img
                  src={settings.logo}
                  alt="Logo"
                  className="h-8 w-auto mb-1"
                />
              )}
              <h1 className="text-sm font-bold text-gray-900">
                {settings?.name || 'AQUAVIT'}
              </h1>
              <p className="text-xs text-gray-600">{settings?.phone || ''}</p>
            </div>
            <div className="text-right">
              <h2 className="text-base font-bold text-gray-400">BUKTI PENERIMAAN</h2>
              <p className="text-xs"><strong>No. PO:</strong> {record.poId}</p>
            </div>
          </div>

          {/* Info Section */}
          <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
            <div>
              <p><strong>Supplier:</strong> {record.supplierName || '-'}</p>
              <p><strong>Diterima:</strong> {format(record.receivedDate, 'd/MM/yyyy HH:mm', { locale: id })}</p>
            </div>
            <div>
              <p><strong>Penerima:</strong> {record.receivedBy}</p>
            </div>
          </div>

          {/* Material Table */}
          <div className="mb-3">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-2 py-1 text-left">Material</th>
                  <th className="border border-gray-300 px-2 py-1 text-center w-20">Jumlah</th>
                  <th className="border border-gray-300 px-2 py-1 text-center w-20">Stok Lama</th>
                  <th className="border border-gray-300 px-2 py-1 text-center w-20">Stok Baru</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-gray-300 px-2 py-1 font-medium">{record.materialName}</td>
                  <td className="border border-gray-300 px-2 py-1 text-center text-green-600 font-bold">
                    +{record.quantity.toLocaleString('id-ID')} {record.unit}
                  </td>
                  <td className="border border-gray-300 px-2 py-1 text-center">
                    {record.previousStock.toLocaleString('id-ID')} {record.unit}
                  </td>
                  <td className="border border-gray-300 px-2 py-1 text-center font-bold text-green-600">
                    {record.newStock.toLocaleString('id-ID')} {record.unit}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Notes */}
          {record.notes && (
            <div className="mb-3">
              <p className="text-xs"><strong>Catatan:</strong> {record.notes}</p>
            </div>
          )}

          {/* Signatures */}
          <div className="grid grid-cols-2 gap-4 mt-6">
            <div className="text-center text-xs">
              <p className="mb-6">Yang Menyerahkan</p>
              <div className="border-t border-gray-400 pt-1">
                <p>_______________</p>
                <p className="text-gray-500">Supplier</p>
              </div>
            </div>
            <div className="text-center text-xs">
              <p className="mb-6">Yang Menerima</p>
              <div className="border-t border-gray-400 pt-1">
                <p>{record.receivedBy}</p>
                <p className="text-gray-500">Penerima</p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-3 pt-1 border-t text-center text-xs text-gray-500">
            <p>Dicetak: {format(new Date(), "dd/MM/yyyy HH:mm", { locale: id })}</p>
          </div>
        </div>
      </div>
    </Dialog>
  )
}