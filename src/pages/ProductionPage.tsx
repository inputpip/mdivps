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
import { format, isAfter, isBefore, isSameDay, parseISO, startOfDay, endOfDay } from 'date-fns'
import { validateProductForProduction } from "@/utils/productValidation"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Trash2, AlertTriangle, Printer, ChevronLeft, ChevronRight, FileDown, FileText } from "lucide-react"
import { ProductionPrintDialog } from "@/components/ProductionPrintDialog"
import { formatNumber } from "@/utils/formatNumber"
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

  const [selectedMaterialId, setSelectedMaterialId] = useState<string>("")
  const [errorQuantity, setErrorQuantity] = useState<number>(1)
  const [errorNote, setErrorNote] = useState<string>("")

  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false)
  const [selectedProduction, setSelectedProduction] = useState<any>(null)

  const [currentPage, setCurrentPage] = useState(1)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [selectedItemFilter, setSelectedItemFilter] = useState<string>("all")
  const [selectedInputByFilter, setSelectedInputByFilter] = useState<string>("all")
  const itemsPerPage = 10

  const finishedGoods = useMemo(() =>
    products?.filter(p => p.type === 'Produksi') || [],
    [products]
  )

  const selectedProduct = useMemo(() =>
    finishedGoods.find(p => p.id === selectedProductId),
    [finishedGoods, selectedProductId]
  )

  useEffect(() => {
    fetchProductions()
  }, [fetchProductions])

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

  useEffect(() => {
    if (!selectedProductId && finishedGoods.length > 0) {
      setSelectedProductId(finishedGoods[0].id)
    }
  }, [finishedGoods, selectedProductId])

  const itemFilterOptions = useMemo(() => {
    return Array.from(new Set(productions.map(record => record.productName).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  }, [productions])

  const inputByFilterOptions = useMemo(() => {
    return Array.from(new Set(productions.map(record => record.createdByName || record.user_input_name || 'Unknown').filter(Boolean))).sort((a, b) => a.localeCompare(b))
  }, [productions])

  const filteredProductions = useMemo(() => {
    return productions.filter((record) => {
      const createdAt = record.createdAt instanceof Date ? record.createdAt : new Date(record.createdAt)
      const fromDate = dateFrom ? startOfDay(parseISO(dateFrom)) : null
      const toDate = dateTo ? endOfDay(parseISO(dateTo)) : null
      const matchesFrom = !fromDate || isSameDay(createdAt, fromDate) || isAfter(createdAt, fromDate)
      const matchesTo = !toDate || isSameDay(createdAt, toDate) || isBefore(createdAt, toDate)
      const matchesItem = selectedItemFilter === 'all' || record.productName === selectedItemFilter
      const inputName = record.createdByName || record.user_input_name || 'Unknown'
      const matchesInputBy = selectedInputByFilter === 'all' || inputName === selectedInputByFilter

      return matchesFrom && matchesTo && matchesItem && matchesInputBy
    })
  }, [productions, dateFrom, dateTo, selectedItemFilter, selectedInputByFilter])

  useEffect(() => {
    setCurrentPage(1)
  }, [dateFrom, dateTo, selectedItemFilter, selectedInputByFilter])

  const totalFilteredQuantity = useMemo(() => {
    return filteredProductions.reduce((sum, record) => sum + (Number(record.quantity) || 0), 0)
  }, [filteredProductions])

  const totalPages = Math.max(1, Math.ceil(filteredProductions.length / itemsPerPage))
  const paginatedProductions = filteredProductions.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  )

  const visiblePages = useMemo(() => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, index) => index + 1)
    }

    if (currentPage <= 3) {
      return [1, 2, 3, '...', totalPages]
    }

    if (currentPage >= totalPages - 2) {
      return [1, '...', totalPages - 2, totalPages - 1, totalPages]
    }

    return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages]
  }, [currentPage, totalPages])

  const handleExportExcel = () => {
    const dataToExport = filteredProductions.map((p, index) => ({
      'No': index + 1,
      'Waktu': format(new Date(p.createdAt), 'dd/MM/yyyy HH:mm'),
      'Ref': p.ref,
      'Produk': p.productName,
      'Qty': p.quantity,
      'Konsumsi BOM': p.consumeBOM ? 'Ya' : 'Tidak',
      'Diinput Oleh': p.createdByName || p.user_input_name || '-',
      'Catatan': p.note || '-'
    }))

    const ws = XLSX.utils.json_to_sheet(dataToExport)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Riwayat Produksi")
    XLSX.writeFile(wb, `Riwayat_Produksi_${format(new Date(), 'yyyy-MM-dd')}.xlsx`)
  }

  const handleExportPDF = () => {
    const doc = new jsPDF('l', 'mm', 'a4')

    doc.setFontSize(16)
    doc.text('Laporan Riwayat Produksi', 14, 18)
    doc.setFontSize(10)
    doc.text(`Dicetak pada: ${format(new Date(), 'dd MMM yyyy HH:mm')}`, 14, 25)
    doc.text(`Total data: ${filteredProductions.length}`, 14, 31)

    const tableData = filteredProductions.map((p, index) => [
      (index + 1).toString(),
      format(new Date(p.createdAt), 'dd/MM/yyyy HH:mm'),
      p.ref,
      p.productName,
      formatNumber(p.quantity),
      p.consumeBOM ? 'Ya' : 'Tidak',
      p.createdByName || p.user_input_name || '-',
      p.note || '-'
    ])

    autoTable(doc, {
      head: [['No', 'Waktu', 'Ref', 'Produk', 'Qty', 'BOM', 'Diinput Oleh', 'Catatan']],
      body: tableData,
      startY: 36,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [41, 128, 185] },
      columnStyles: {
        0: { cellWidth: 10 },
        1: { cellWidth: 28 },
        2: { cellWidth: 28 },
        3: { cellWidth: 52 },
        4: { cellWidth: 18 },
        5: { cellWidth: 18 },
        6: { cellWidth: 35 },
        7: { cellWidth: 'auto' }
      }
    })

    doc.save(`Laporan_Produksi_${format(new Date(), 'yyyy-MM-dd')}.pdf`)
  }

  const handlePrintReport = () => {
    handleExportPDF()
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
      setCurrentPage(1)
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

  if (isLoadingProducts || isLoadingMaterials) {
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
        <div className="px-4 py-3 border-b flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-medium text-slate-800 dark:text-slate-200">Riwayat Produksi</h3>
          <div className="flex gap-2 flex-wrap justify-end">
            <Button variant="outline" size="sm" onClick={handlePrintReport} disabled={filteredProductions.length === 0}>
              <Printer className="h-4 w-4 mr-1" /> Cetak
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={filteredProductions.length === 0}>
              <FileDown className="h-4 w-4 mr-1" /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={filteredProductions.length === 0}>
              <FileText className="h-4 w-4 mr-1" /> PDF
            </Button>
          </div>
        </div>

        <div className="px-4 py-3 border-b grid md:grid-cols-4 gap-3">
          <div>
            <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">Tanggal Dari</div>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">Tanggal Sampai</div>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div>
            <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">Item</div>
            <Select value={selectedItemFilter} onValueChange={setSelectedItemFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Semua item" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua item</SelectItem>
                {itemFilterOptions.map((item) => (
                  <SelectItem key={item} value={item}>{item}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">Yang Menginput</div>
            <Select value={selectedInputByFilter} onValueChange={setSelectedInputByFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Semua penginput" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua penginput</SelectItem>
                {inputByFilterOptions.map((inputBy) => (
                  <SelectItem key={inputBy} value={inputBy}>{inputBy}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="px-4 py-3 border-b bg-slate-50/60 dark:bg-slate-800/40">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="text-slate-600 dark:text-slate-300">
              Menampilkan <span className="font-semibold">{filteredProductions.length}</span> data riwayat produksi
            </div>
            <div className="text-slate-600 dark:text-slate-300 md:text-right">
              Total jumlah dari filter: <span className="font-semibold">{formatNumber(totalFilteredQuantity)}</span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-200">No</th>
                <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-200">Waktu</th>
                <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-200">Ref</th>
                <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-200">Produk</th>
                <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-200">Qty</th>
                <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-200">BOM</th>
                <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-200">Diinput Oleh</th>
                <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-200">Catatan</th>
                <th className="text-left px-3 py-2 text-slate-700 dark:text-slate-200">Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedProductions.map((record, index) => (
                <tr key={record.id} className="border-t border-slate-200 dark:border-slate-700">
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300 font-medium">
                    {(currentPage - 1) * itemsPerPage + index + 1}
                  </td>
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
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                    {record.createdByName || record.user_input_name || '-'}
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
                  <td className="px-3 py-6 text-center text-slate-500 dark:text-slate-400" colSpan={9}>
                    {isLoading ? 'Loading...' : 'Belum ada produksi'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {filteredProductions.length > 0 && (
          <div className="px-4 py-3 border-t flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="text-sm text-slate-500">
              Halaman {currentPage} dari {totalPages}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>
                Awal
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              {visiblePages.map((page, index) => (
                page === '...' ? (
                  <span key={`ellipsis-${index}`} className="px-2 text-sm text-slate-500">
                    ...
                  </span>
                ) : (
                  <Button
                    key={page}
                    variant={page === currentPage ? "default" : "outline"}
                    size="sm"
                    className="min-w-9"
                    onClick={() => setCurrentPage(page as number)}
                  >
                    {page}
                  </Button>
                )
              ))}
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                Next <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}>
                Akhir
              </Button>
            </div>
          </div>
        )}
      </section>

      <ProductionPrintDialog
        open={isPrintDialogOpen}
        onOpenChange={setIsPrintDialogOpen}
        production={selectedProduction}
      />
    </div>
  )
}
