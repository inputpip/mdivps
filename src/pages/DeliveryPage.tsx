"use client"

import React from "react"
import { useState, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/use-toast"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Truck, Package, Search, RefreshCw, Clock, CheckCircle, AlertCircle, Plus, History, Eye, Camera, Download, Filter, Calendar, Trash2, Loader2, Pencil, ChevronDown, ChevronUp, X, FileText } from "lucide-react"
import { format } from "date-fns"
import { id as idLocale } from "date-fns/locale/id"
import { useTransactionsReadyForDelivery, useDeliveryHistory, useDeliveries } from "@/hooks/useDeliveries"
import { useTransactions } from "@/hooks/useTransactions"
import { DeliveryManagement } from "@/components/DeliveryManagement"
import { DeliveryDetailModal } from "@/components/DeliveryDetailModal"
import { DeliveryFormContent } from "@/components/DeliveryFormContent"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { TransactionDeliveryInfo } from "@/types/delivery"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAuth } from "@/hooks/useAuth"
import { useGranularPermission } from "@/hooks/useGranularPermission"
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { DeliveryNotePDF } from "@/components/DeliveryNotePDF"
import { DeliveryCompletionDialog } from "@/components/DeliveryCompletionDialog"
import { EditDeliveryDialog } from "@/components/EditDeliveryDialog"
import { Delivery } from "@/types/delivery"
import { PhotoUploadService } from "@/services/photoUploadService"

export default function DeliveryPage() {
  const { toast } = useToast()
  const { user } = useAuth()
  const { canCreateDelivery, canDeleteDelivery, canEditDelivery, canViewDeliveryHistory } = useGranularPermission()
  const { data: transactions, isLoading, refetch } = useTransactionsReadyForDelivery()
  const { data: deliveryHistory, isLoading: isLoadingHistory, refetch: refetchHistory } = useDeliveryHistory()
  const { deleteDelivery } = useDeliveries()
  const { deleteTransaction } = useTransactions()
  const [transactionToDelete, setTransactionToDelete] = useState<any>(null)
  const [isTransactionDeleteDialogOpen, setIsTransactionDeleteDialogOpen] = useState(false)
  const [isDeletingTransaction, setIsDeletingTransaction] = useState(false)

  const [searchQuery, setSearchQuery] = useState("")
  const [historySearchQuery, setHistorySearchQuery] = useState("")
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionDeliveryInfo | null>(null)
  const [selectedDelivery, setSelectedDelivery] = useState<any>(null)
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState("active")
  const [completionDialogOpen, setCompletionDialogOpen] = useState(false)
  const [completedDelivery, setCompletedDelivery] = useState<Delivery | null>(null)
  const [completedTransaction, setCompletedTransaction] = useState<TransactionDeliveryInfo | null>(null)
  const [searchParams] = useSearchParams()

  // Handle delivery completion
  const handleDeliveryCompleted = (delivery: Delivery, transaction: TransactionDeliveryInfo) => {
    setCompletedDelivery(delivery)
    setCompletedTransaction(transaction)
    setCompletionDialogOpen(true)
    setIsDeliveryDialogOpen(false) // Close the form dialog
  }
  const [isDeliveryDialogOpen, setIsDeliveryDialogOpen] = useState(false)
  const [selectedDeliveryTransaction, setSelectedDeliveryTransaction] = useState<TransactionDeliveryInfo | null>(null)

  // Auto-open delivery dialog if transactionId query param exists
  useEffect(() => {
    const transactionIdParam = searchParams.get('transactionId')
    if (transactionIdParam && transactions) {
      const transaction = transactions.find(t => t.id === transactionIdParam)
      if (transaction) {
        setSelectedDeliveryTransaction(transaction)
        setIsDeliveryDialogOpen(true)
        // Clear the query param after opening
        searchParams.delete('transactionId')
      }
    }
  }, [searchParams, transactions])

  // New filter states for history
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [selectedDriver, setSelectedDriver] = useState("all")
  const [selectedHelper, setSelectedHelper] = useState("all")
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false)

  // Delete confirmation state
  const [deliveryToDelete, setDeliveryToDelete] = useState<any>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // Edit delivery state
  const [editingDelivery, setEditingDelivery] = useState<Delivery | null>(null)

  // Expand/collapse state for delivery details
  const [expandedDeliveries, setExpandedDeliveries] = useState<Set<string>>(new Set())

  const toggleExpandDelivery = (deliveryId: string) => {
    setExpandedDeliveries(prev => {
      const newSet = new Set(prev)
      if (newSet.has(deliveryId)) {
        newSet.delete(deliveryId)
      } else {
        newSet.add(deliveryId)
      }
      return newSet
    })
  }

  // Mobile detection
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Check permissions using granular system
  const canDelete = canDeleteDelivery()
  const canEdit = canEditDelivery()
  const canAccessHistory = canViewDeliveryHistory()

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 15

  const filteredTransactions = transactions?.filter(transaction =>
    transaction.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    transaction.id.toLowerCase().includes(searchQuery.toLowerCase())
  ) || []

  // Get unique drivers and helpers for filter options
  const uniqueDrivers = Array.from(new Set(
    deliveryHistory?.map(d => d.driverName).filter(Boolean) || []
  )).sort()

  const uniqueHelpers = Array.from(new Set(
    deliveryHistory?.map(d => d.helperName).filter(Boolean) || []
  )).sort()

  const filteredDeliveryHistory = deliveryHistory?.filter(delivery => {
    // Text search filter
    const matchesSearch = !historySearchQuery || (
      delivery.customerName.toLowerCase().includes(historySearchQuery.toLowerCase()) ||
      delivery.transactionId.toLowerCase().includes(historySearchQuery.toLowerCase()) ||
      delivery.driverName?.toLowerCase().includes(historySearchQuery.toLowerCase()) ||
      delivery.helperName?.toLowerCase().includes(historySearchQuery.toLowerCase())
    )

    // Date range filter
    const deliveryDate = new Date(delivery.deliveryDate)
    const startDateObj = startDate ? new Date(startDate + "T00:00:00") : null
    const endDateObj = endDate ? new Date(endDate + "T23:59:59") : null

    const matchesDateRange = (!startDateObj || deliveryDate >= startDateObj) &&
      (!endDateObj || deliveryDate <= endDateObj)

    // Driver filter
    const matchesDriver = selectedDriver === "all" ||
      (selectedDriver === "no-driver" && !delivery.driverName) ||
      delivery.driverName === selectedDriver

    // Helper filter  
    const matchesHelper = selectedHelper === "all" ||
      (selectedHelper === "no-helper" && !delivery.helperName) ||
      delivery.helperName === selectedHelper

    return matchesSearch && matchesDateRange && matchesDriver && matchesHelper
  }) || []

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [historySearchQuery, startDate, endDate, selectedDriver, selectedHelper])

  // Pagination Calculation
  const totalPages = Math.ceil(filteredDeliveryHistory.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const paginatedHistory = filteredDeliveryHistory.slice(startIndex, startIndex + itemsPerPage)

  const getOverallStatus = (transaction: TransactionDeliveryInfo) => {
    const totalItems = transaction.deliverySummary.reduce((sum, item) => sum + item.orderedQuantity, 0)
    const deliveredItems = transaction.deliverySummary.reduce((sum, item) => sum + item.deliveredQuantity, 0)

    if (deliveredItems === 0) return { status: "Belum Diantar", variant: "secondary" as const, icon: Clock }
    if (deliveredItems >= totalItems) return { status: "Selesai", variant: "success" as const, icon: CheckCircle }
    return { status: "Sebagian", variant: "default" as const, icon: AlertCircle }
  }

  // Handle delete delivery (owner only)
  const handleDeleteDelivery = async () => {
    if (!deliveryToDelete) return

    setIsDeleting(true)
    try {
      await deleteDelivery.mutateAsync(deliveryToDelete.id)
      toast({
        title: "Berhasil",
        description: `Pengantaran #${deliveryToDelete.deliveryNumber || deliveryToDelete.id.slice(-6)} berhasil dihapus dan jurnal telah di-void`
      })
      setIsDeleteDialogOpen(false)
      setDeliveryToDelete(null)
      refetchHistory()
      refetch() // Also refresh active transactions
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Gagal Menghapus",
        description: error.message || "Terjadi kesalahan saat menghapus pengantaran"
      })
    } finally {
      setIsDeleting(false)
    }
  }

  const handleDeleteTransaction = async () => {
    if (!transactionToDelete) return

    setIsDeletingTransaction(true)
    try {
      await deleteTransaction.mutateAsync(transactionToDelete.id)
      toast({
        title: "Berhasil",
        description: `Transaksi #${transactionToDelete.id} berhasil dihapus beserta seluruh data terkait (Jurnal, Komisi, History Pengiriman).`
      })
      setIsTransactionDeleteDialogOpen(false)
      setTransactionToDelete(null)
      refetch() // Refresh active transactions list
      refetchHistory() // Refresh delivery history list - BUG FIX: history juga perlu di-refresh
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Gagal Menghapus Transaksi",
        description: error.message || "Terjadi kesalahan saat menghapus transaksi"
      })
    } finally {
      setIsDeletingTransaction(false)
    }
  }

  const generateActiveDeliveriesPDF = async () => {
    if (!filteredTransactions || filteredTransactions.length === 0) {
      toast({
        title: "Tidak ada data",
        description: "Tidak ada data pengantaran aktif untuk dicetak",
        variant: "destructive"
      })
      return
    }

    setIsGeneratingPDF(true)

    try {
      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      })

      const pageWidth = 297
      const margin = 15

      // Header
      doc.setFontSize(18)
      doc.setFont(undefined, 'bold')
      doc.text('DAFTAR PESANAN SIAP ANTAR', pageWidth / 2, 20, { align: 'center' })

      // Filter info
      doc.setFontSize(10)
      doc.setFont(undefined, 'normal')
      let yPos = 30

      const filterInfo = []
      if (searchQuery) {
        filterInfo.push(`Pencarian: "${searchQuery}"`)
      }

      doc.text(`Dicetak pada: ${format(new Date(), 'dd MMM yyyy HH:mm', { locale: idLocale })}`, margin, yPos)
      yPos += 7

      if (filterInfo.length > 0) {
        doc.text(`Filter: ${filterInfo.join(' | ')}`, margin, yPos)
        yPos += 10
      } else {
        yPos += 3
      }

      // Summary
      const totalOrders = filteredTransactions.length
      const totalItems = filteredTransactions.reduce((acc, t) => acc + t.deliverySummary.reduce((sum, item) => sum + item.remainingQuantity, 0), 0)
      const totalValue = filteredTransactions.reduce((acc, t) => acc + t.total, 0)

      doc.setFont(undefined, 'bold')
      doc.text(`Total Pesanan: ${totalOrders}`, margin, yPos)
      yPos += 6
      doc.text(`Total Sisa Item: ${totalItems}`, margin, yPos)
      yPos += 6
      doc.text(`Total Nilai Order: ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(totalValue)}`, margin, yPos)

      yPos += 10

      // Table data
      const tableData = filteredTransactions.map((t, index) => {
        const remaining = t.deliverySummary.reduce((sum, item) => sum + item.remainingQuantity, 0)
        const status = getOverallStatus(t).status

        return [
          (index + 1).toString(),
          t.id,
          t.customerName,
          format(new Date(t.orderDate), 'dd/MM/yyyy HH:mm'),
          new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(t.total),
          remaining.toString(),
          status,
          t.cashierName || '-'
        ]
      })

      // Table
      autoTable(doc, {
        head: [['No', 'Order ID', 'Pelanggan', 'Tanggal Order', 'Total Order', 'Sisa Item', 'Status', 'Kasir']],
        body: tableData,
        startY: yPos,
        margin: { left: margin, right: margin },
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [22, 163, 74], textColor: 255, fontStyle: 'bold' }, // Green header to differentiate with history (blue)
        columnStyles: {
          0: { halign: 'center', cellWidth: 15 },
          1: { halign: 'center', cellWidth: 35 },
          2: { halign: 'left' },
          3: { halign: 'center', cellWidth: 35 },
          4: { halign: 'right', cellWidth: 40 },
          5: { halign: 'center', cellWidth: 25 },
          6: { halign: 'center', cellWidth: 30 },
          7: { halign: 'left', cellWidth: 30 }
        },
        didDrawPage: (data) => {
          // Footer
          const pageHeight = doc.internal.pageSize.height
          doc.setFontSize(8)
          doc.setTextColor(100)
          doc.setFont(undefined, 'normal')
          doc.text(`Dicetak oleh: ${user?.name || user?.email || 'System'}`, margin, pageHeight - 10)
          doc.text(`Halaman ${data.pageNumber}`, pageWidth - margin, pageHeight - 10, { align: 'right' })
        }
      })

      const fileName = `laporan-pengantaran-aktif-${format(new Date(), 'yyyy-MM-dd-HHmm')}.pdf`
      doc.save(fileName)

      toast({
        title: "PDF Berhasil Dibuat",
        description: `Laporan berhasil diunduh: ${fileName}`
      })

    } catch (error) {
      console.error('Error generating PDF:', error)
      toast({
        variant: "destructive",
        title: "Gagal Membuat PDF",
        description: "Terjadi kesalahan saat membuat file PDF."
      })
    } finally {
      setIsGeneratingPDF(false)
    }
  }

  const generateHistoryPDF = async () => {
    setIsGeneratingPDF(true)

    try {
      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      })

      const pageWidth = 297
      const margin = 15

      // Header
      doc.setFontSize(18)
      doc.setFont(undefined, 'bold')
      doc.text('LAPORAN HISTORY PENGANTARAN', pageWidth / 2, 20, { align: 'center' })

      // Filter info
      doc.setFontSize(10)
      doc.setFont(undefined, 'normal')
      let yPos = 35

      let filterInfo = []
      if (startDate || endDate) {
        const dateRange = `${startDate ? format(new Date(startDate), 'dd/MM/yyyy') : 'Awal'} - ${endDate ? format(new Date(endDate), 'dd/MM/yyyy') : 'Akhir'}`
        filterInfo.push(`Periode: ${dateRange}`)
      }
      if (selectedDriver !== "all") {
        filterInfo.push(`Driver: ${selectedDriver === "no-driver" ? "Tanpa Driver" : selectedDriver}`)
      }
      if (selectedHelper !== "all") {
        filterInfo.push(`Helper: ${selectedHelper === "no-helper" ? "Tanpa Helper" : selectedHelper}`)
      }
      if (historySearchQuery) {
        filterInfo.push(`Pencarian: "${historySearchQuery}"`)
      }

      if (filterInfo.length > 0) {
        doc.text(`Filter: ${filterInfo.join(' | ')}`, margin, yPos)
        yPos += 10
      }

      // Summary
      const totalDeliveries = filteredDeliveryHistory.length
      const totalItems = filteredDeliveryHistory.reduce((sum, d) => sum + (d.items?.reduce((itemSum: number, item: any) => itemSum + item.quantityDelivered, 0) || 0), 0)
      const totalOrderValue = filteredDeliveryHistory.reduce((sum, d) => sum + (d.transactionTotal || 0), 0)

      doc.text(`Total Pengantaran: ${totalDeliveries}`, margin, yPos)
      yPos += 7
      doc.text(`Total Item Diantar: ${totalItems}`, margin, yPos)
      yPos += 7
      doc.text(`Total Nilai Order: ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(totalOrderValue)}`, margin, yPos)
      yPos += 15

      // Table data
      const tableData = filteredDeliveryHistory.map((delivery, index) => [
        (index + 1).toString(),
        delivery.deliveryNumber?.toString() || delivery.id.slice(-6),
        delivery.transactionId,
        delivery.customerName,
        format(new Date(delivery.deliveryDate), 'dd/MM/yyyy HH:mm'),
        delivery.driverName || '-',
        delivery.helperName || '-',
        delivery.items?.length?.toString() || '0',
        delivery.items?.reduce((sum: number, item: any) => sum + item.quantityDelivered, 0)?.toString() || '0',
        new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(delivery.transactionTotal || 0),
        delivery.cashierName || '-',
        delivery.photoUrl ? 'Ya' : 'Tidak'
      ])

      // Calculate table width and center it
      const totalTableWidth = 12 + 18 + 22 + 35 + 25 + 20 + 20 + 10 + 12 + 30 + 20 + 10 // Adjusted widths to fit Kasir
      const tableStartX = (pageWidth - totalTableWidth) / 2 // Center the table

      // Table
      autoTable(doc, {
        head: [['No', 'ID#', 'Order ID', 'Pelanggan', 'Tanggal Antar', 'Driver', 'Helper', 'Jenis', 'Total', 'Nilai Order', 'Kasir', 'Foto']],
        body: tableData,
        startY: yPos,
        margin: { left: tableStartX, right: tableStartX },
        tableWidth: totalTableWidth,
        styles: {
          fontSize: 8,
          cellPadding: 2,
          halign: 'left'
        },
        headStyles: {
          fillColor: [79, 70, 229],
          textColor: 255,
          fontSize: 8,
          fontStyle: 'bold',
          halign: 'center'
        },
        columnStyles: {
          0: { halign: 'center', cellWidth: 12 },    // No
          1: { halign: 'center', cellWidth: 18 },    // ID#
          2: { halign: 'center', cellWidth: 22 },    // Order ID
          3: { halign: 'left', cellWidth: 35 },      // Pelanggan
          4: { halign: 'center', cellWidth: 25 },    // Tanggal
          5: { halign: 'left', cellWidth: 20 },      // Driver
          6: { halign: 'left', cellWidth: 20 },      // Helper
          7: { halign: 'center', cellWidth: 10 },    // Jenis
          8: { halign: 'center', cellWidth: 12 },    // Total
          9: { halign: 'right', cellWidth: 30 },     // Nilai Order
          10: { halign: 'left', cellWidth: 20 },     // Kasir
          11: { halign: 'center', cellWidth: 10 }    // Foto
        },
        didDrawPage: (data) => {
          // Footer with print info
          const pageHeight = doc.internal.pageSize.height
          doc.setFontSize(8)
          doc.setTextColor(128, 128, 128)
          doc.text(`Dicetak oleh: ${user?.name || user?.email || 'System'} pada ${format(new Date(), 'dd/MM/yyyy HH:mm:ss')}`, margin, pageHeight - 10)
          doc.text(`Halaman ${data.pageNumber}`, pageWidth - margin, pageHeight - 10, { align: 'right' })
        }
      })

      // Save PDF
      const fileName = `laporan-history-pengantaran-${format(new Date(), 'yyyy-MM-dd-HHmm')}.pdf`
      doc.save(fileName)

      toast({
        title: "PDF Berhasil Dibuat",
        description: `Laporan history pengantaran berhasil diunduh sebagai ${fileName}`
      })

    } catch (error) {
      console.error('Error generating PDF:', error)
      toast({
        variant: "destructive",
        title: "Error",
        description: "Gagal membuat PDF. Silakan coba lagi."
      })
    } finally {
      setIsGeneratingPDF(false)
    }
  }

  if (selectedTransaction) {
    return (
      <div className="container mx-auto p-6">
        <div className="mb-6">
          <Button
            variant="outline"
            onClick={() => setSelectedTransaction(null)}
            className="mb-4"
          >
            ← Kembali ke Daftar
          </Button>
        </div>
        <DeliveryManagement
          transaction={selectedTransaction}
          onClose={() => {
            setSelectedTransaction(null)
            refetch()
          }}
        />
      </div>
    )
  }

  return (
    <div className="w-full max-w-none p-4 lg:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            <Truck className="h-6 w-6 sm:h-8 sm:w-8 flex-shrink-0" />
            <span className="truncate">Manajemen Pengantaran</span>
          </h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">
            Kelola pengantaran pesanan pelanggan dengan sistem partial delivery.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            onClick={() => refetch()}
            variant="outline"
            size="sm"
          >
            <RefreshCw className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className={`grid w-full max-w-md mx-auto mb-6 ${canAccessHistory ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <TabsTrigger value="active" className="flex items-center gap-2">
            <Truck className="h-4 w-4" />
            Pengantaran Aktif
          </TabsTrigger>
          {canAccessHistory && (
            <TabsTrigger value="history" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              History
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="active" className="space-y-4">
          {/* Search - Always visible */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Cari nama pelanggan atau nomor order..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-10"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 transform -translate-y-1/2 h-7 w-7 p-0"
                onClick={() => setSearchQuery('')}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Info count */}
          <div className="text-sm text-muted-foreground">
            {filteredTransactions.length} dari {transactions?.length || 0} pengantaran
          </div>

          {!isLoading && filteredTransactions.length > 0 && !isMobile && (
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 p-4 bg-muted/30 rounded-lg border">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 w-full md:w-auto">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Total Pesanan</p>
                  <p className="text-2xl font-bold">{filteredTransactions.length}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Total Sisa Item</p>
                  <p className="text-2xl font-bold text-orange-600">
                    {filteredTransactions.reduce((acc, t) => acc + t.deliverySummary.reduce((sum, item) => sum + item.remainingQuantity, 0), 0)}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Total Nilai Order</p>
                  <p className="text-2xl font-bold text-green-600">
                    {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(
                      filteredTransactions.reduce((acc, t) => acc + t.total, 0)
                    )}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full md:w-auto gap-2 border-red-200 hover:bg-red-50 hover:text-red-700 dark:border-red-900 dark:hover:bg-red-900/20"
                onClick={generateActiveDeliveriesPDF}
                disabled={isGeneratingPDF}
              >
                {isGeneratingPDF ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4 text-red-600" />
                )}
                Export PDF
              </Button>
            </div>
          )}

          {/* Mobile View - Card List */}
          {isMobile ? (
            <div className="space-y-2">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="bg-white dark:bg-gray-800 border rounded-lg p-3">
                    <Skeleton className="h-16 w-full" />
                  </div>
                ))
              ) : filteredTransactions.length === 0 ? (
                <div className="text-center py-12">
                  <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">Tidak Ada Pengantaran</h3>
                  <p className="text-muted-foreground text-sm">
                    {searchQuery
                      ? "Tidak ditemukan"
                      : "Tidak ada transaksi siap antar"}
                  </p>
                </div>
              ) : (
                filteredTransactions.map((transaction, index) => {
                  const overallStatus = getOverallStatus(transaction)
                  const StatusIcon = overallStatus.icon
                  const remainingItems = transaction.deliverySummary.reduce((sum, item) => sum + item.remainingQuantity, 0)

                  return (
                    <div
                      key={transaction.id}
                      className="bg-white dark:bg-gray-800 border rounded-lg p-3 shadow-sm active:bg-gray-50 dark:active:bg-gray-700"
                    >
                      <div
                        className="flex items-start justify-between gap-2"
                        onClick={() => setSelectedTransaction(transaction)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-xs font-bold px-2 py-0.5 rounded">
                              #{index + 1}
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {format(transaction.orderDate, "d MMM", { locale: idLocale })}
                            </span>
                            <Badge variant={overallStatus.variant} className="text-[10px] px-1 py-0">
                              <StatusIcon className="h-2.5 w-2.5 mr-0.5" />
                              {overallStatus.status}
                            </Badge>
                          </div>
                          <div className="font-medium text-sm truncate">{transaction.customerName}</div>
                          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                            <span className="font-semibold text-green-600 dark:text-green-400">
                              {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(transaction.total)}
                            </span>
                            <span>•</span>
                            <span>{remainingItems} item sisa</span>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedDeliveryTransaction(transaction)
                            setIsDeliveryDialogOpen(true)
                          }}
                          className="bg-green-600 hover:bg-green-700 text-white h-10 px-3 shrink-0"
                        >
                          <Truck className="h-4 w-4 mr-1" />
                          Antar
                        </Button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          ) : (
            /* Desktop View - Full Table */
            <Card>
              <CardHeader>
                <CardTitle>Daftar Pengantaran</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : filteredTransactions.length === 0 ? (
                  <div className="text-center py-12">
                    <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-medium mb-2">Tidak Ada Pengantaran</h3>
                    <p className="text-muted-foreground">
                      {searchQuery
                        ? "Tidak ada transaksi yang cocok dengan pencarian Anda"
                        : "Tidak ada transaksi yang perlu diantar saat ini"}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table className="min-w-[900px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[100px]">Order ID</TableHead>
                          <TableHead className="min-w-[150px]">Pelanggan</TableHead>
                          <TableHead className="min-w-[140px]">Tanggal Order</TableHead>
                          <TableHead className="min-w-[120px]">Total</TableHead>
                          <TableHead className="min-w-[100px]">Status</TableHead>
                          <TableHead className="min-w-[100px]">Kasir</TableHead>
                          <TableHead className="min-w-[80px]">Item Sisa</TableHead>
                          <TableHead className="w-[100px]">Aksi</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredTransactions.map((transaction) => {
                          const overallStatus = getOverallStatus(transaction)
                          const StatusIcon = overallStatus.icon
                          const remainingItems = transaction.deliverySummary.reduce((sum, item) => sum + item.remainingQuantity, 0)
                          const isExpanded = expandedDeliveries.has(transaction.id)
                          return (
                            <React.Fragment key={transaction.id}>
                              <TableRow className="hover:bg-muted">
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 w-6 p-0"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        toggleExpandDelivery(transaction.id)
                                      }}
                                    >
                                      {isExpanded ? (
                                        <ChevronUp className="h-4 w-4" />
                                      ) : (
                                        <ChevronDown className="h-4 w-4" />
                                      )}
                                    </Button>
                                    <Badge variant="outline" className="text-xs">#{transaction.id}</Badge>
                                  </div>
                                </TableCell>
                                <TableCell className="font-medium">
                                  <div className="truncate max-w-[150px]" title={transaction.customerName}>
                                    {transaction.customerName}
                                  </div>
                                </TableCell>
                                <TableCell className="text-sm">
                                  <div>{format(transaction.orderDate, "d MMM yyyy", { locale: idLocale })}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {format(transaction.orderDate, "HH:mm", { locale: idLocale })}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="font-semibold text-green-600 text-sm">
                                    {new Intl.NumberFormat("id-ID", {
                                      style: "currency",
                                      currency: "IDR",
                                      minimumFractionDigits: 0
                                    }).format(transaction.total)}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge variant={overallStatus.variant} className="flex items-center gap-1 w-fit text-xs">
                                    <StatusIcon className="h-3 w-3" />
                                    <span className="hidden sm:inline">{overallStatus.status}</span>
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <div className="text-sm">
                                    {transaction.cashierName || <span className="text-muted-foreground">-</span>}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="text-sm">
                                    <div>{remainingItems} item</div>
                                    <div className="text-muted-foreground text-xs">
                                      {transaction.deliveries.length} pengantaran
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="flex gap-1">
                                    <Button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setSelectedDeliveryTransaction(transaction)
                                        setIsDeliveryDialogOpen(true)
                                      }}
                                      size="sm"
                                      className="bg-green-600 hover:bg-green-700 text-white text-xs px-2 py-1"
                                    >
                                      <Truck className="h-3 w-3 sm:mr-1" />
                                      <span className="hidden sm:inline">Antar</span>
                                    </Button>

                                    {/* Delete Transaction Button (Owner/Admin Only) - NEW */}
                                    {(user?.role === 'owner' || user?.role === 'admin') && (
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        className="text-xs px-2 py-1"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setTransactionToDelete(transaction)
                                          setIsTransactionDeleteDialogOpen(true)
                                        }}
                                        title="Hapus Transaksi & Data Terkait"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    )}

                                    {/* Delete last delivery button - controlled by granular permission */}
                                    {canDelete && transaction.deliveries.length > 0 && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="text-xs px-2 py-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          // Delete the most recent delivery for this transaction
                                          const lastDelivery = transaction.deliveries[transaction.deliveries.length - 1]
                                          setDeliveryToDelete({
                                            ...lastDelivery,
                                            customerName: transaction.customerName,
                                            transactionTotal: transaction.total
                                          })
                                          setIsDeleteDialogOpen(true)
                                        }}
                                        title={`Hapus pengantaran terakhir (${transaction.deliveries.length} pengantaran)`}
                                      >
                                        <History className="h-3 w-3" /> {/* Changed icon to History to differ from Transaction Delete */}
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>

                              {/* Expanded row - Show delivery summary for active transactions */}
                              {isExpanded && (
                                <TableRow>
                                  <TableCell colSpan={8} className="p-0">
                                    <div className="bg-gray-50 dark:bg-gray-900/30 p-4 border-l-4 border-green-500">
                                      <div className="mb-3">
                                        <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                                          <Package className="h-4 w-4 text-green-600" />
                                          Detail Pengantaran
                                        </h4>
                                      </div>
                                      <div className="overflow-x-auto">
                                        <Table className="min-w-[600px]">
                                          <TableHeader>
                                            <TableRow>
                                              <TableHead className="text-xs">No</TableHead>
                                              <TableHead className="text-xs">Nama Barang</TableHead>
                                              <TableHead className="text-xs text-center">Dipesan</TableHead>
                                              <TableHead className="text-xs text-center">Diantar</TableHead>
                                              <TableHead className="text-xs text-center">Sisa</TableHead>
                                              <TableHead className="text-xs text-center">Satuan</TableHead>
                                              <TableHead className="text-xs text-center">Waktu Antar</TableHead>
                                            </TableRow>
                                          </TableHeader>
                                          <TableBody>
                                            {transaction.deliverySummary && transaction.deliverySummary.length > 0 ? (
                                              transaction.deliverySummary.map((item: any, index: number) => (
                                                <TableRow key={item.productId} className="hover:bg-gray-100 dark:hover:bg-gray-800">
                                                  <TableCell className="text-xs">{index + 1}</TableCell>
                                                  <TableCell className="text-xs font-medium">{item.productName}</TableCell>
                                                  <TableCell className="text-xs text-center">
                                                    <span className="text-gray-600 dark:text-gray-400">
                                                      {item.orderedQuantity}
                                                    </span>
                                                  </TableCell>
                                                  <TableCell className="text-xs text-center">
                                                    <span className="font-semibold text-green-600 dark:text-green-400">
                                                      {item.deliveredQuantity}
                                                    </span>
                                                  </TableCell>
                                                  <TableCell className="text-xs text-center">
                                                    <span className={
                                                      item.remainingQuantity > 0
                                                        ? 'font-semibold text-orange-600 dark:text-orange-400'
                                                        : 'text-green-600 dark:text-green-400'
                                                    }>
                                                      {item.remainingQuantity}
                                                    </span>
                                                  </TableCell>
                                                  <TableCell className="text-xs text-center">{item.unit}</TableCell>
                                                  <TableCell className="text-xs text-center">
                                                    {transaction.deliveries && transaction.deliveries.length > 0 ? (
                                                      <div className="flex flex-col gap-1">
                                                        {transaction.deliveries.map((delivery: any, dIndex: number) => (
                                                          <div key={dIndex} className="text-xs">
                                                            {format(new Date(delivery.deliveryDate), "dd/MM HH:mm", { locale: idLocale })}
                                                          </div>
                                                        ))}
                                                      </div>
                                                    ) : (
                                                      <span className="text-gray-400">-</span>
                                                    )}
                                                  </TableCell>
                                                </TableRow>
                                              ))
                                            ) : (
                                              <TableRow>
                                                <TableCell colSpan={6} className="text-xs text-center text-muted-foreground py-4">
                                                  Tidak ada data barang
                                                </TableCell>
                                              </TableRow>
                                            )}
                                          </TableBody>
                                        </Table>
                                      </div>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
                            </React.Fragment>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* History Tab - Only visible to admin/owner */}
        {canAccessHistory && (
          <TabsContent value="history" className="space-y-4">
            {/* Search - Always visible */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cari pelanggan, order ID, driver..."
                value={historySearchQuery}
                onChange={(e) => setHistorySearchQuery(e.target.value)}
                className="pl-10 pr-10"
              />
              {historySearchQuery && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 transform -translate-y-1/2 h-7 w-7 p-0"
                  onClick={() => setHistorySearchQuery('')}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            {/* Filter Toggle */}
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className="gap-2"
              >
                <Filter className="h-4 w-4" />
                Filter
                {showFilters ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
              {(startDate || endDate || selectedDriver !== 'all' || selectedHelper !== 'all') && (
                <Badge variant="secondary">Filter aktif</Badge>
              )}
            </div>

            {/* Collapsible Filters */}
            {showFilters && (
              <div className="p-4 border rounded-lg bg-background space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 block">Dari</label>
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="text-sm h-9"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 block">Sampai</label>
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="text-sm h-9"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 block">Driver</label>
                    <Select value={selectedDriver} onValueChange={setSelectedDriver}>
                      <SelectTrigger className="text-sm h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Semua</SelectItem>
                        <SelectItem value="no-driver">Tanpa Driver</SelectItem>
                        {uniqueDrivers.map(driver => (
                          <SelectItem key={driver} value={driver}>{driver}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 block">Helper</label>
                    <Select value={selectedHelper} onValueChange={setSelectedHelper}>
                      <SelectTrigger className="text-sm h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Semua</SelectItem>
                        <SelectItem value="no-helper">Tanpa Helper</SelectItem>
                        {uniqueHelpers.map(helper => (
                          <SelectItem key={helper} value={helper}>{helper}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-2 pt-2 border-t">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setHistorySearchQuery("")
                      setStartDate("")
                      setEndDate("")
                      setSelectedDriver("all")
                      setSelectedHelper("all")
                    }}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Reset
                  </Button>
                  {!isMobile && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={generateHistoryPDF}
                      disabled={isGeneratingPDF}
                    >
                      {isGeneratingPDF ? <RefreshCw className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
                      PDF
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Info count */}
            <div className="text-sm text-muted-foreground">
              {filteredDeliveryHistory.length} dari {deliveryHistory?.length || 0} pengantaran
            </div>

            {/* Mobile View - Card List */}
            {isMobile ? (
              <div className="space-y-2">
                {isLoadingHistory ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="bg-white dark:bg-gray-800 border rounded-lg p-3">
                      <Skeleton className="h-16 w-full" />
                    </div>
                  ))
                ) : filteredDeliveryHistory.length === 0 ? (
                  <div className="text-center py-12">
                    <History className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-medium mb-2">Tidak Ada History</h3>
                    <p className="text-muted-foreground text-sm">
                      {historySearchQuery ? "Tidak ditemukan" : "Belum ada history"}
                    </p>
                  </div>
                ) : (
                  paginatedHistory.map((delivery: any, index: number) => (
                    <div
                      key={`${delivery.id}-${index}`}
                      className="bg-white dark:bg-gray-800 border rounded-lg p-3 shadow-sm"
                      onClick={() => {
                        setSelectedDelivery(delivery)
                        setIsDetailModalOpen(true)
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 text-xs font-bold px-2 py-0.5 rounded">
                              #{startIndex + index + 1}
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {format(delivery.deliveryDate, "d MMM", { locale: idLocale })}
                            </span>
                            <Badge variant="success" className="text-[10px] px-1 py-0">
                              <CheckCircle className="h-2.5 w-2.5 mr-0.5" />
                              Selesai
                            </Badge>
                          </div>
                          <div className="font-medium text-sm truncate">{delivery.customerName}</div>
                          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                            <span className="font-semibold text-green-600 dark:text-green-400">
                              {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(delivery.transactionTotal)}
                            </span>
                            {delivery.driverName && (
                              <>
                                <span>•</span>
                                <span>{delivery.driverName}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <DeliveryNotePDF delivery={delivery} />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 w-8 p-0"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedDelivery(delivery)
                              setIsDetailModalOpen(true)
                            }}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>

                          {/* Delete button - controlled by granular permission */}
                          {canDelete && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={(e) => {
                                e.stopPropagation()
                                setDeliveryToDelete(delivery)
                                setIsDeleteDialogOpen(true)
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              /* Desktop View - Full Table */
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>History Pengantaran</span>
                    <Badge variant="secondary" className="text-xs">
                      {deliveryHistory?.length || 0} total
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {isLoadingHistory ? (
                    <div className="space-y-3">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-16 w-full" />
                      ))}
                    </div>
                  ) : filteredDeliveryHistory.length === 0 ? (
                    <div className="text-center py-12">
                      <History className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                      <h3 className="text-lg font-medium mb-2">Tidak Ada History</h3>
                      <p className="text-muted-foreground">
                        {historySearchQuery
                          ? "Tidak ada pengantaran yang cocok dengan pencarian Anda"
                          : "Belum ada history pengantaran yang tercatat"}
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table className="min-w-[1000px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[100px]">Nomor</TableHead>
                            <TableHead className="min-w-[100px]">Order ID</TableHead>
                            <TableHead className="min-w-[150px]">Pelanggan</TableHead>
                            <TableHead className="min-w-[140px]">Tanggal Antar</TableHead>
                            <TableHead className="min-w-[120px]">Driver</TableHead>
                            <TableHead className="min-w-[100px]">Helper</TableHead>
                            <TableHead className="min-w-[100px]">Total Item</TableHead>
                            <TableHead className="min-w-[120px]">Total Order</TableHead>
                            <TableHead className="min-w-[100px]">Kasir</TableHead>
                            <TableHead className="w-[80px]">Foto</TableHead>
                            <TableHead className="min-w-[100px]">Status</TableHead>
                            <TableHead className="w-[100px]">Aksi</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {paginatedHistory.map((delivery: any, index: number) => {
                            const isExpanded = expandedDeliveries.has(delivery.id)
                            return (
                              <React.Fragment key={`${delivery.id}-${index}`}>
                                <TableRow className="hover:bg-muted">
                                  <TableCell>
                                    <div className="flex items-center gap-2">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-6 p-0"
                                        onClick={() => toggleExpandDelivery(delivery.id)}
                                      >
                                        {isExpanded ? (
                                          <ChevronUp className="h-4 w-4" />
                                        ) : (
                                          <ChevronDown className="h-4 w-4" />
                                        )}
                                      </Button>
                                      <Badge variant="outline" className="text-xs">
                                        #{startIndex + index + 1}
                                      </Badge>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="secondary" className="text-xs">
                                      {delivery.transactionId}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="font-medium">
                                    <div className="truncate max-w-[150px]" title={delivery.customerName}>
                                      {delivery.customerName}
                                    </div>
                                    {delivery.customerAddress && (
                                      <div className="text-xs text-muted-foreground truncate max-w-[150px]">
                                        {delivery.customerAddress}
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-sm">
                                    <div>{format(delivery.deliveryDate, "d MMM yyyy", { locale: idLocale })}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {format(delivery.deliveryDate, "HH:mm", { locale: idLocale })}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="text-sm">
                                      {delivery.driverName || '-'}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="text-sm">
                                      {delivery.helperName || '-'}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="text-sm">
                                      {delivery.items?.length || 0} jenis
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {delivery.items?.reduce((sum: number, item: any) => sum + item.quantityDelivered, 0) || 0} total
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="font-semibold text-green-600 text-sm">
                                      {new Intl.NumberFormat("id-ID", {
                                        style: "currency",
                                        currency: "IDR",
                                        minimumFractionDigits: 0
                                      }).format(delivery.transactionTotal)}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="text-sm">
                                      {delivery.cashierName || <span className="text-muted-foreground">-</span>}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    {delivery.photoUrl ? (
                                      <img
                                        src={PhotoUploadService.getPhotoUrl(delivery.photoUrl, 'deliveries')}
                                        alt={`Foto pengantaran ${delivery.deliveryNumber || delivery.id.slice(-6)}`}
                                        className="w-12 h-12 object-cover rounded-md cursor-pointer hover:opacity-80 transition-opacity"
                                        onClick={() => window.open(PhotoUploadService.getPhotoUrl(delivery.photoUrl, 'deliveries'), '_blank')}
                                        onError={(e) => {
                                          const target = e.target as HTMLImageElement;
                                          target.style.display = 'none';
                                          const parent = target.parentElement;
                                          if (parent) {
                                            parent.innerHTML = `
                                              <div class="w-12 h-12 bg-gray-100 rounded-md flex items-center justify-center">
                                                <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                </svg>
                                              </div>
                                            `;
                                          }
                                        }}
                                      />
                                    ) : (
                                      <div className="w-12 h-12 bg-gray-100 rounded-md flex items-center justify-center">
                                        <Camera className="h-4 w-4 text-gray-400" />
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="success" className="flex items-center gap-1 w-fit text-xs">
                                      <CheckCircle className="h-3 w-3" />
                                      <span className="hidden sm:inline">Selesai</span>
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex gap-1">
                                      <DeliveryNotePDF delivery={delivery} />
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="text-xs px-2 py-1"
                                        onClick={() => {
                                          setSelectedDelivery(delivery)
                                          setIsDetailModalOpen(true)
                                        }}
                                      >
                                        <Eye className="h-3 w-3 sm:mr-1" />
                                        <span className="hidden sm:inline">Detail</span>
                                      </Button>

                                      {/* Delete button - controlled by granular permission */}
                                      {canDelete && (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="text-xs px-2 py-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                                          onClick={() => {
                                            setDeliveryToDelete(delivery)
                                            setIsDeleteDialogOpen(true)
                                          }}
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </Button>
                                      )}
                                    </div>
                                  </TableCell>
                                </TableRow>

                                {/* Expanded row - Show delivery items */}
                                {isExpanded && (
                                  <TableRow>
                                    <TableCell colSpan={12} className="p-0">
                                      <div className="bg-gray-50 dark:bg-gray-900/30 p-4 border-l-4 border-blue-500">
                                        <div className="mb-3">
                                          <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                                            <Package className="h-4 w-4 text-blue-600" />
                                            Detail Pengantaran
                                          </h4>
                                        </div>
                                        <div className="overflow-x-auto">
                                          <Table className="min-w-[600px]">
                                            <TableHeader>
                                              <TableRow>
                                                <TableHead className="text-xs">No</TableHead>
                                                <TableHead className="text-xs">Nama Barang</TableHead>
                                                <TableHead className="text-xs text-center">Dipesan</TableHead>
                                                <TableHead className="text-xs text-center">Diantar</TableHead>
                                                <TableHead className="text-xs text-center">Sisa</TableHead>
                                                <TableHead className="text-xs text-center">Satuan</TableHead>
                                              </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                              {delivery.items && delivery.items.length > 0 ? (
                                                delivery.items.map((item: any, itemIndex: number) => (
                                                  <TableRow key={item.id} className="hover:bg-gray-100 dark:hover:bg-gray-800">
                                                    <TableCell className="text-xs">{itemIndex + 1}</TableCell>
                                                    <TableCell className="text-xs font-medium">{item.productName}</TableCell>
                                                    <TableCell className="text-xs text-center">
                                                      <span className="text-gray-600 dark:text-gray-400">
                                                        {item.orderedQuantity || '-'}
                                                      </span>
                                                    </TableCell>
                                                    <TableCell className="text-xs text-center">
                                                      <span className="font-semibold text-green-600 dark:text-green-400">
                                                        {item.quantityDelivered}
                                                      </span>
                                                    </TableCell>
                                                    <TableCell className="text-xs text-center">
                                                      <span className={
                                                        item.remainingQuantity > 0
                                                          ? 'font-semibold text-orange-600 dark:text-orange-400'
                                                          : 'text-green-600 dark:text-green-400'
                                                      }>
                                                        {item.remainingQuantity || 0}
                                                      </span>
                                                    </TableCell>
                                                    <TableCell className="text-xs text-center">{item.unit || '-'}</TableCell>
                                                  </TableRow>
                                                ))
                                              ) : (
                                                <TableRow>
                                                  <TableCell colSpan={6} className="text-xs text-center text-muted-foreground py-4">
                                                    Tidak ada data barang
                                                  </TableCell>
                                                </TableRow>
                                              )}
                                            </TableBody>
                                          </Table>
                                        </div>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                )}
                              </React.Fragment>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Pagination Controls */}
            {filteredDeliveryHistory.length > itemsPerPage && (
              <div className="flex items-center justify-center gap-2 mt-6">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className="h-8 w-8 p-0"
                >
                  &lt;
                </Button>

                {/* Page Numbers */}
                {(() => {
                  const pages = [];
                  const maxVisible = 5;

                  if (totalPages <= maxVisible) {
                    for (let i = 1; i <= totalPages; i++) pages.push(i);
                  } else {
                    if (currentPage <= 3) {
                      pages.push(1, 2, 3, '...', totalPages);
                    } else if (currentPage >= totalPages - 2) {
                      pages.push(1, '...', totalPages - 2, totalPages - 1, totalPages);
                    } else {
                      pages.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages);
                    }
                  }

                  return pages.map((page, idx) => (
                    <Button
                      key={`page-${idx}-${page}`}
                      variant={currentPage === page ? "default" : "outline"}
                      size="sm"
                      className={`h-8 w-8 p-0 ${page === '...' ? 'cursor-default border-none pointer-events-none' : ''}`}
                      onClick={() => page !== '...' && typeof page === 'number' && setCurrentPage(page)}
                    >
                      {page}
                    </Button>
                  ));
                })()}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages || totalPages === 0}
                  className="h-8 w-8 p-0"
                >
                  &gt;
                </Button>
              </div>
            )}


          </TabsContent>
        )}
      </Tabs>


      {/* Delivery Detail Modal */}
      <DeliveryDetailModal
        delivery={selectedDelivery}
        open={isDetailModalOpen}
        onOpenChange={setIsDetailModalOpen}
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
                refetch()
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

      {/* Delete Confirmation Dialog - Owner Only */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" />
              Hapus Pengantaran
            </DialogTitle>
            <DialogDescription>
              Anda yakin ingin menghapus pengantaran ini? Tindakan ini tidak dapat dibatalkan.
            </DialogDescription>
          </DialogHeader>

          {deliveryToDelete && (
            <div className="space-y-3 py-4">
              <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">No. Pengantaran</span>
                  <span className="font-medium">#{deliveryToDelete.deliveryNumber || deliveryToDelete.id.slice(-6)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Customer</span>
                  <span className="font-medium">{deliveryToDelete.customerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Tanggal</span>
                  <span className="font-medium">
                    {format(new Date(deliveryToDelete.deliveryDate), "d MMM yyyy HH:mm", { locale: idLocale })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Driver</span>
                  <span className="font-medium">{deliveryToDelete.driverName || '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Item Diantar</span>
                  <span className="font-medium">
                    {deliveryToDelete.items?.length || 0} jenis ({deliveryToDelete.items?.reduce((sum: number, item: any) => sum + item.quantityDelivered, 0) || 0} total)
                  </span>
                </div>
              </div>

              <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-lg">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  <strong>Perhatian:</strong> Menghapus pengantaran akan:
                </p>
                <ul className="text-sm text-yellow-700 dark:text-yellow-300 list-disc list-inside mt-1">
                  <li>Void jurnal terkait (Hutang Barang Dagang)</li>
                  <li>Mengembalikan stok produk</li>
                  <li>Mengubah status transaksi jika perlu</li>
                  <li>Menghapus komisi driver/helper terkait</li>
                </ul>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setIsDeleteDialogOpen(false)
                setDeliveryToDelete(null)
              }}
              disabled={isDeleting}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteDelivery}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Menghapus...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Hapus Pengantaran
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Transaction Confirmation Dialog - Owner/Admin Only */}
      <Dialog open={isTransactionDeleteDialogOpen} onOpenChange={setIsTransactionDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" />
              Hapus Transaksi (Order)
            </DialogTitle>
            <DialogDescription>
              Apakah Anda yakin ingin MENGHAPUS transaksi ini beserta seluruh historynya?
            </DialogDescription>
          </DialogHeader>

          {transactionToDelete && (
            <div className="space-y-3 py-4">
              <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Order ID</span>
                  <span className="font-medium">#{transactionToDelete.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Customer</span>
                  <span className="font-medium">{transactionToDelete.customerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Total</span>
                  <span className="font-medium">
                    {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(transactionToDelete.total)}
                  </span>
                </div>
              </div>

              <div className="bg-orange-50 dark:bg-orange-900/20 p-3 rounded-lg border border-orange-200">
                <p className="text-sm text-orange-800 dark:text-orange-200">
                  <strong>⚠️ PERINGATAN KERAS:</strong>
                </p>
                <div className="text-sm text-orange-700 dark:text-orange-300 mt-2 space-y-1">
                  <p>Tindakan ini akan menghapus/membatalkan:</p>
                  <ul className="list-disc list-inside pl-1">
                    <li>Data Transaksi Penjualan</li>
                    <li>Semua Data Pengantaran (Delivery) terkait</li>
                    <li>Semua Jurnal Keuangan (Penjualan, Piutang, HPP)</li>
                    <li>Semua Komisi Supir/Helper yang terbentuk</li>
                    <li>Mengembalikan stok barang ke gudang</li>
                  </ul>
                  <p className="mt-2 font-bold">Data yang sudah dihapus TIDAK BISA dipulihkan!</p>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setIsTransactionDeleteDialogOpen(false)
                setTransactionToDelete(null)
              }}
              disabled={isDeletingTransaction}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteTransaction}
              disabled={isDeletingTransaction}
            >
              {isDeletingTransaction ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Menghapus...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Ya, Hapus Semuanya
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editingDelivery && (
        <EditDeliveryDialog
          delivery={editingDelivery}
          open={!!editingDelivery}
          onOpenChange={(open) => {
            if (!open) {
              setEditingDelivery(null)
              refetchHistory()
            }
          }}
        />
      )}
    </div>
  )
}
