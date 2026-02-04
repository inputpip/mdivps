"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { usePaymentHistory } from "@/hooks/usePaymentHistory"
import { useAccounts } from "@/hooks/useAccounts"
import { useBranch } from "@/contexts/BranchContext"
import { useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/integrations/supabase/client"
import { format } from 'date-fns'
import { FileText, Download, Filter, Trash2 } from "lucide-react"
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { useToast } from "@/components/ui/use-toast"
import { usePermissions } from "@/hooks/usePermissions"

// No need for type declaration when using direct import

export function PaymentHistoryTable() {
  const { accounts } = useAccounts()
  const { currentBranch } = useBranch()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null)
  const [filters, setFilters] = useState({
    date_from: '',
    date_to: '',
    account_id: 'all'
  })

  const { paymentHistory, isLoading } = usePaymentHistory(filters)

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  const clearFilters = () => {
    setFilters({
      date_from: '',
      date_to: '',
      account_id: 'all'
    })
  }

  const generatePDF = () => {
    const doc = new jsPDF()

    // Title
    doc.setFontSize(16)
    doc.text('History Pembayaran Piutang', 14, 20)

    // Filter info
    doc.setFontSize(10)
    let yPos = 30
    if (filters.date_from || filters.date_to) {
      const dateRange = `Periode: ${filters.date_from || 'Awal'} - ${filters.date_to || 'Akhir'}`
      doc.text(dateRange, 14, yPos)
      yPos += 5
    }
    if (filters.account_id !== 'all') {
      const selectedAccount = accounts?.find(acc => acc.id === filters.account_id)
      doc.text(`Akun: ${selectedAccount?.name || 'Unknown'}`, 14, yPos)
      yPos += 5
    }

    // Table data
    const tableData = paymentHistory.map(payment => [
      format(payment.created_at, 'dd/MM/yyyy HH:mm'),
      payment.description,
      payment.account_name,
      new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR'
      }).format(payment.amount),
      payment.user_name
    ])

    // Manual table drawing if autoTable fails
    let currentY = yPos + 5

    try {
      // Try autoTable first
      autoTable(doc, {
        head: [['Tanggal', 'Keterangan', 'Akun', 'Jumlah', 'Dicatat Oleh']],
        body: tableData,
        startY: currentY,
        styles: { fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 30 },
          1: { cellWidth: 60 },
          2: { cellWidth: 30 },
          3: { cellWidth: 25 },
          4: { cellWidth: 30 }
        }
      })
      currentY = (doc as any).lastAutoTable?.finalY || currentY + (tableData.length * 5) + 20
    } catch (error) {
      // Fallback to manual table drawing
      console.warn('AutoTable failed, using manual table:', error)

      // Draw header
      doc.setFontSize(9)
      doc.setFont('helvetica', 'bold')
      doc.text('Tanggal', 14, currentY)
      doc.text('Keterangan', 50, currentY)
      doc.text('Akun', 120, currentY)
      doc.text('Jumlah', 160, currentY)
      doc.text('Dicatat Oleh', 200, currentY)

      currentY += 8
      doc.line(14, currentY - 2, 280, currentY - 2)

      // Draw data rows
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)

      tableData.forEach((row, index) => {
        if (currentY > 190) { // New page if needed
          doc.addPage()
          currentY = 20
        }

        doc.text(row[0], 14, currentY)
        doc.text(row[1].substring(0, 40), 50, currentY) // Truncate long descriptions
        doc.text(row[2], 120, currentY)
        doc.text(row[3], 200, currentY, { align: 'right' })
        doc.text(row[4], 240, currentY)

        currentY += 6
      })

      currentY += 5
    }

    // Total
    const total = paymentHistory.reduce((sum, payment) => sum + payment.amount, 0)
    const finalY = currentY
    doc.setFontSize(10)
    doc.text(`Total: ${new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR'
    }).format(total)}`, 14, finalY + 10)

    // Save
    const fileName = `history-pembayaran-piutang-${format(new Date(), 'yyyy-MM-dd')}.pdf`
    doc.save(fileName)
  }

  const { hasPermission } = usePermissions();
  const canDelete = hasPermission('receivable_delete');

  const handleDeleteHistory = (paymentId: string) => {
    if (!canDelete) {
      toast({ variant: "destructive", title: "Akses Ditolak", description: "Anda tidak memiliki izin untuk menghapus history pembayaran." })
      return;
    }
    setSelectedPaymentId(paymentId)
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!selectedPaymentId || !currentBranch?.id) return

    try {
      const { data, error } = await supabase.rpc('void_payment_history_rpc', {
        p_payment_id: selectedPaymentId,
        p_branch_id: currentBranch.id,
        p_reason: 'Pembayaran dibatalkan oleh user'
      })

      if (error) throw error

      const result = Array.isArray(data) ? data[0] : data
      if (!result?.success) {
        throw new Error(result?.error_message || 'Gagal menghapus pembayaran')
      }

      toast({
        title: "Berhasil",
        description: "Pembayaran berhasil dibatalkan dan saldo piutang dikembalikan"
      })

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['paymentHistory'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Gagal",
        description: error.message || "Terjadi kesalahan saat menghapus pembayaran"
      })
    } finally {
      setDeleteDialogOpen(false)
      setSelectedPaymentId(null)
    }
  }

  const total = paymentHistory.reduce((sum, payment) => sum + payment.amount, 0)

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-card dark:bg-slate-900 border border-border rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-medium">Filter Data</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <Label htmlFor="date_from" className="text-xs text-muted-foreground">Tanggal Dari</Label>
            <Input
              id="date_from"
              type="date"
              value={filters.date_from}
              onChange={(e) => handleFilterChange('date_from', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="date_to" className="text-xs text-muted-foreground">Tanggal Sampai</Label>
            <Input
              id="date_to"
              type="date"
              value={filters.date_to}
              onChange={(e) => handleFilterChange('date_to', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="account_id" className="text-xs text-muted-foreground">Akun Pembayaran</Label>
            <Select value={filters.account_id} onValueChange={(value) => handleFilterChange('account_id', value)}>
              <SelectTrigger>
                <SelectValue placeholder="Semua akun" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Akun</SelectItem>
                {accounts?.filter(acc => acc.isPaymentAccount).map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Reset
            </Button>
            <Button
              size="sm"
              onClick={generatePDF}
              disabled={paymentHistory.length === 0}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <FileText className="h-4 w-4 mr-1" />
              PDF
            </Button>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-xl p-4">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-sm text-blue-600 dark:text-blue-400">Total Pembayaran Piutang</p>
            <p className="text-xl font-bold text-blue-800 dark:text-blue-300">
              {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(total)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-blue-600 dark:text-blue-400">Total Transaksi</p>
            <p className="text-xl font-bold text-blue-800 dark:text-blue-300">{paymentHistory.length}</p>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card dark:bg-slate-900 border border-border rounded-xl">
        <div className="px-4 py-3 border-b">
          <h3 className="font-medium">History Pembayaran Piutang</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2">Tanggal</th>
                <th className="text-left px-3 py-2">Pelanggan</th>
                <th className="text-left px-3 py-2">Keterangan</th>
                <th className="text-left px-3 py-2">Akun Pembayaran</th>
                <th className="text-right px-3 py-2">Jumlah</th>
                <th className="text-left px-3 py-2">Dicatat Oleh</th>
                <th className="text-center px-3 py-2">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
                    Loading...
                  </td>
                </tr>
              ) : paymentHistory.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
                    Tidak ada data pembayaran piutang
                  </td>
                </tr>
              ) : (
                paymentHistory.map((payment) => (
                  <tr key={payment.id} className="border-t">
                    <td className="px-3 py-2">
                      {format(payment.created_at, 'dd/MM/yyyy HH:mm')}
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {payment.customer_name || payment.reference_id?.split('-')[0] || 'Unknown'}
                    </td>
                    <td className="px-3 py-2">
                      {payment.description}
                    </td>
                    <td className="px-3 py-2">
                      {payment.account_name}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {new Intl.NumberFormat('id-ID', {
                        style: 'currency',
                        currency: 'IDR'
                      }).format(payment.amount)}
                    </td>
                    <td className="px-3 py-2">
                      {payment.user_name}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {canDelete && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteHistory(payment.id)}
                        >
                          Hapus
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Pembayaran Piutang?</AlertDialogTitle>
            <AlertDialogDescription>
              Tindakan ini akan membatalkan pembayaran dan mengembalikan saldo piutang pelanggan.
              <br /><br />
              <span className="text-red-600 font-medium">Apakah Anda yakin ingin melanjutkan?</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Ya, Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}