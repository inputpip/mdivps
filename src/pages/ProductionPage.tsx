"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { useProduction } from "@/hooks/useProduction"
import { useProducts } from "@/hooks/useProducts"
import { useMaterials } from "@/hooks/useMaterials"
import { useAuth } from "@/hooks/useAuth"
import { useToast } from "@/components/ui/use-toast"
import { BOMItem } from "@/types/production"
import { format } from 'date-fns'
import { validateProductForProduction } from "@/utils/productValidation"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Trash2, Package, AlertTriangle, Printer, ChevronLeft, ChevronRight, FileDown, FileText } from "lucide-react"
import { ProductionPrintDialog } from "@/components/ProductionPrintDialog"
import { formatNumber, formatMoney } from "@/utils/formatNumber"
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export default function ProductionPage() {
  const { user } = useAuth()
  const { products, isLoading: isLoadingProducts } = useProducts()
  const { materials, isLoading: isLoadingMaterials } = useMaterials()
  const { productions, isLoading, fetchProductions, getBOM, processProduction, processError, deleteProduction } = useProduction()
  const { toast } = useToast()

  const [selectedProductId, setSelectedProductId] = useState<string>("")
  const [quantity, setQuantity] = useState<number>(1)
  const [consumeBOM, setConsumeBOM] = useState<boolean>(true)
  const [note, setNote] = useState<string>("")
  const [bom, setBom] = useState<BOMItem[]>([])

  // Error input states
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>("")
  const [errorQuantity, setErrorQuantity] = useState<number>(1)
  const [errorNote, setErrorNote] = useState<string>("")

  // Print dialog state
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false)
  const [selectedProduction, setSelectedProduction] = useState<any>(null)

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  // Filter only Produksi type products (finished goods)
  const finishedGoods = useMemo(() =>
    products?.filter(p => p.type === 'Produksi') || [],
    [products]
  )

  const selectedProduct = useMemo(() =>
    finishedGoods.find(p => p.id === selectedProductId),
    [finishedGoods, selectedProductId]
  )

  // Fetch production history on mount
  useEffect(() => {
    fetchProductions()
  }, [fetchProductions])

  // Load BOM when product changes
  useEffect(() => {
    if (selectedProductId) {
      getBOM(selectedProductId).then(setBom).catch((error) => {
        console.error('Error loading BOM:', error)
        setBom([])
      })
    } else {
      setBom([])
    }
  }, [selectedProductId, getBOM])

  // Set default product
  useEffect(() => {
    if (!selectedProductId && finishedGoods.length > 0) {
      setSelectedProductId(finishedGoods[0].id)
    }
  }, [finishedGoods, selectedProductId])

  // Pagination Logic
  const totalPages = Math.ceil(productions.length / itemsPerPage)
  const paginatedProductions = productions.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  )

  // EXPORT EXCEL
  const handleExportExcel = () => {
    const dataToExport = productions.map(p => ({
      'Waktu': format(new Date(p.createdAt), 'dd/MM/yyyy HH:mm'),
      'Ref': p.ref,
      'Produk': p.productName,
      'Qty': p.quantity,
      'Konsumsi BOM': p.consumeBOM ? 'Ya' : 'Tidak',
      'Catatan': p.note || '-'
    }))

    const ws = XLSX.utils.json_to_sheet(dataToExport)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Riwayat Produksi")
    XLSX.writeFile(wb, `Riwayat_Produksi_${format(new Date(), 'yyyy-MM-dd')}.xlsx`)
  }

  // EXPORT PDF
  const handleExportPDF = () => {
    const doc = new jsPDF()

    doc.setFontSize(16)
    doc.text('Laporan Riwayat Produksi', 14, 22)
    doc.setFontSize(10)
    doc.text(`Dicetak pada: ${format(new Date(), 'dd MMM yyyy HH:mm')}`, 14, 30)

    const tableData = productions.map(p => [
      format(new Date(p.createdAt), 'dd/MM/yyyy HH:mm'),
      p.ref,
      p.productName,
      p.quantity.toString(),
      p.consumeBOM ? 'Ya' : 'Tidak',
      p.note || '-'
    ])

    autoTable(doc, {
      head: [['Waktu', 'Ref', 'Produk', 'Qty', 'BOM', 'Catatan']],
      body: tableData,
      startY: 35,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [41, 128, 185] }
    })

    doc.save(`Laporan_Produksi_${format(new Date(), 'yyyy-MM-dd')}.pdf`)
  }

  const handleProduction = async () => {
    if (!selectedProductId || quantity <= 0 || !user) {
      toast({
        variant: "destructive",
        title: "Validation Error",
        description: "Lengkapi data produksi"
      })
      return
    }

    if (!selectedProduct) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Produk tidak ditemukan"
      })
      return
    }

    // Validate product for production
    const validation = await validateProductForProduction(selectedProductId, selectedProduct.type)
    if (!validation.valid) {
      toast({
        variant: "destructive",
        title: "Validation Error",
        description: validation.message
      })
      return
    }

    const success = await processProduction({
      productId: selectedProductId,
      quantity,
      note: note || undefined,
      consumeBOM,
      createdBy: user.id
    })

    if (success) {
      setQuantity(1)
      setNote("")
      setCurrentPage(1) // Reset to page 1
    }
  }

  const handleError = async () => {
    if (!selectedMaterialId || errorQuantity <= 0 || !user) {
      toast({
        variant: "destructive",
        title: "Validation Error",
        description: "Lengkapi data item keluar"
      })
      return
    }

    const success = await processError({
      materialId: selectedMaterialId,
      quantity: errorQuantity,
      note: errorNote || undefined,
      createdBy: user.id
    })

    if (success) {
      setSelectedMaterialId("")
      setErrorQuantity(1)
      setErrorNote("")
    }
  }

  const handleDeleteProduction = async (recordId: string) => {
    if (!user || !['owner', 'admin'].includes(user.role || '')) {
      toast({
        variant: "destructive",
        title: "Access Denied",
        description: "Hanya owner dan admin yang bisa menghapus data produksi"
      })
      return
    }

    await deleteProduction(recordId)
  }

  const handlePrintProduction = (record: any) => {
    setSelectedProduction(record)
    setIsPrintDialogOpen(true)
  }

  if (isLoadingProducts) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">Loading products...</div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="text-lg md:text-xl font-semibold mb-2">Produksi</div>
      <div className="text-sm text-slate-600 dark:text-slate-400 mb-4">
        Input produksi untuk menambah stok Finished Goods. Jika "Konsumsi BOM" aktif, sistem otomatis mengurangi bahan.
      </div>

      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 mb-6">
        <div className="grid md:grid-cols-3 gap-3">
          <div>
            <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">Produk (Finished Goods)</div>
            <Select value={selectedProductId} onValueChange={setSelectedProductId}>
              <SelectTrigger>
                <SelectValue placeholder="Pilih produk..." />
              </SelectTrigger>
              <SelectContent>
                {finishedGoods.length === 0 ? (
                  <SelectItem value="no-products" disabled>Tidak ada produk Produksi tersedia</SelectItem>
                ) : (
                  finishedGoods.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">Qty Produksi</div>
            <Input
              type="number"
              inputMode="numeric"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value || 0))}
              placeholder="0"
              min="1"
            />
          </div>
          <div>
            <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">Catatan (opsional)</div>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Catatan produksi"
            />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div className="hidden md:flex items-center space-x-2">
            <Switch
              id="consume-bom"
              checked={consumeBOM}
              onCheckedChange={setConsumeBOM}
            />
            <Label htmlFor="consume-bom" className="text-sm">
              Konsumsi BOM
            </Label>
          </div>
          <Button
            className="bg-blue-600 hover:bg-blue-700 text-white"
            onClick={handleProduction}
            disabled={isLoading || !selectedProductId || quantity <= 0}
          >
            {isLoading ? "Processing..." : "Proses Produksi"}
          </Button>
        </div>

        {/* BOM Preview - Hidden on mobile */}
        {selectedProduct && bom && bom.length > 0 && (
          <div className="mt-4 hidden md:block">
            <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">Ringkasan BOM (per 1 unit)</div>
            <div className="border border-slate-200 dark:border-slate-700 rounded overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-slate-50 dark:bg-slate-800">
                    <tr>
                      <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-200">Material</th>
                      <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-200">Unit</th>
                      <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-200">Qty per Unit</th>
                      <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-200">Total Qty ({quantity} unit)</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-slate-900">
                    {bom.map((item, index) => (
                      <tr key={index} className="border-t border-slate-200 dark:border-slate-700">
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{item.materialName}</td>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{item.unit}</td>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{item.quantity}</td>
                        <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300">
                          {(item.quantity * quantity).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              BOM hanya dikonsumsi jika opsi "Konsumsi BOM" diaktifkan.
            </div>
          </div>
        )}

        {selectedProduct && bom.length === 0 && (
          <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-sm text-yellow-800 dark:text-yellow-200">
            Produk ini belum memiliki BOM (Bill of Materials). Produksi akan tetap berjalan tanpa konsumsi bahan.
          </div>
        )}
      </section>

      {/* Item Keluar Section */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          <div className="text-lg font-semibold text-red-600 dark:text-red-400">Item Keluar</div>
        </div>
        <div className="text-sm text-slate-600 dark:text-slate-400 mb-4">
          Input item yang keluar (rusak/cacat/hilang). Stock akan berkurang dan tercatat di riwayat produksi.
        </div>

        <div className="grid md:grid-cols-3 gap-3">
          <div>
            <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">Nama Item *</div>
            <Select value={selectedMaterialId} onValueChange={setSelectedMaterialId}>
              <SelectTrigger>
                <SelectValue placeholder="Pilih bahan..." />
              </SelectTrigger>
              <SelectContent>
                {materials?.length === 0 ? (
                  <SelectItem value="no-materials" disabled>Tidak ada bahan tersedia</SelectItem>
                ) : (
                  materials?.map((material) => (
                    <SelectItem key={material.id} value={material.id}>
                      {material.name} (Stock: {material.stock} {material.unit})
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">Jumlah Item Keluar *</div>
            <Input
              type="number"
              inputMode="numeric"
              value={errorQuantity}
              onChange={(e) => setErrorQuantity(Number(e.target.value || 0))}
              placeholder="0"
              min="1"
            />
          </div>
          <div>
            <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">Catatan Kerusakan</div>
            <Input
              value={errorNote}
              onChange={(e) => setErrorNote(e.target.value)}
              placeholder="Deskripsi kerusakan/cacat"
            />
          </div>
        </div>

        <div className="mt-4 flex justify-between items-center">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Tanggal input: {format(new Date(), 'dd/MM/yyyy HH:mm')} | Yang mencatat: {user?.name || 'Unknown'}
          </div>
          <Button
            className="bg-red-600 hover:bg-red-700 text-white"
            onClick={handleError}
            disabled={isLoading || !selectedMaterialId || errorQuantity <= 0}
          >
            {isLoading ? "Processing..." : "Catat Item Keluar"}
          </Button>
        </div>
      </section>

      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h3 className="font-medium text-slate-800 dark:text-slate-200">Riwayat Produksi</h3>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={productions.length === 0}>
              <FileDown className="h-4 w-4 mr-1" /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={productions.length === 0}>
              <FileText className="h-4 w-4 mr-1" /> PDF
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-200">Waktu</th>
                <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-200">Ref</th>
                <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-200">Produk</th>
                <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-200">Qty</th>
                <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-200">BOM</th>
                <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-200">Catatan</th>
                <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-200">Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedProductions.map((record) => (
                <tr key={record.id} className="border-t border-slate-200 dark:border-slate-700">
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                    {format(record.createdAt, 'dd/MM/yyyy HH:mm')}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">
                    {record.ref}
                  </td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{record.productName}</td>
                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300">{formatNumber(record.quantity)}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-1 rounded-full text-xs ${record.consumeBOM
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-300'
                      }`}>
                      {record.consumeBOM ? 'Ya' : 'Tidak'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-slate-400">
                    {record.note || '-'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => handlePrintProduction(record)}
                      >
                        <Printer className="h-3 w-3 mr-1" />
                        Cetak
                      </Button>

                      {user && ['owner', 'admin'].includes(user.role || '') && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-7 w-7 p-0"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Hapus Data Produksi?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Data produksi <strong>{record.ref}</strong> akan dihapus dan stock bahan akan dikembalikan.
                                Tindakan ini tidak dapat dibatalkan.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Batal</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteProduction(record.id)}
                                className="bg-red-600 hover:bg-red-700"
                              >
                                Hapus
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {paginatedProductions.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500 dark:text-slate-400" colSpan={7}>
                    {isLoading ? 'Loading...' : 'Belum ada produksi'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t flex items-center justify-between">
            <div className="text-sm text-slate-500">
              Halaman {currentPage} dari {totalPages}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Print Dialog */}
      <ProductionPrintDialog
        open={isPrintDialogOpen}
        onOpenChange={setIsPrintDialogOpen}
        production={selectedProduction}
      />
    </div>
  )
}