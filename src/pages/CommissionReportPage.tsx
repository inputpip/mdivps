"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { useOptimizedCommissionEntries, useDeleteCommissionEntry } from "@/hooks/useOptimizedCommissions"
import { useAuth } from "@/hooks/useAuth"
import { useUsers } from "@/hooks/useUsers"
import { format } from "date-fns"
import { id } from "date-fns/locale/id"
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import {
  BarChart3,
  TrendingUp,
  Users,
  Calendar,
  Download,
  Filter,
  Loader2,
  Trash2,
  FileSpreadsheet,
  RefreshCw,
} from "lucide-react"
import { recalculateCommissionsForPeriod } from "@/utils/commissionUtils"
import { useToast } from "@/components/ui/use-toast"

export default function CommissionReportPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const { users, isLoading: usersLoading } = useUsers()
  const deleteCommissionMutation = useDeleteCommissionEntry()
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null)
  const [isRecalculating, setIsRecalculating] = useState(false)

  // Date filters
  const [startDate, setStartDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 7) // Last 7 days
    return date.toISOString().slice(0, 10)
  })

  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().slice(0, 10)
  })

  const [selectedUser, setSelectedUser] = useState<string>("all")

  // Use optimized commission entries with date filters
  const start = new Date(startDate + "T00:00:00")
  const end = new Date(endDate + "T23:59:59.999")

  const {
    data: entries = [],
    isLoading,
    error
  } = useOptimizedCommissionEntries(start, end)


  // Filter by user if selected
  const filteredEntries = useMemo(() => {
    let filtered = entries

    if (selectedUser !== "all") {
      filtered = filtered.filter(entry => entry.userId === selectedUser)
    }

    return filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }, [entries, selectedUser])

  // Calculate totals
  const totals = useMemo(() => {
    const total = filteredEntries.reduce((sum, entry) => sum + entry.amount, 0)
    const quantity = filteredEntries.reduce((sum, entry) => sum + entry.quantity, 0)

    // Group by role
    const byRole = filteredEntries.reduce((acc, entry) => {
      if (!acc[entry.role]) {
        acc[entry.role] = { amount: 0, quantity: 0, count: 0 }
      }
      acc[entry.role].amount += entry.amount
      acc[entry.role].quantity += entry.quantity
      acc[entry.role].count += 1
      return acc
    }, {} as Record<string, { amount: number; quantity: number; count: number }>)

    // Group by user
    const byUser = filteredEntries.reduce((acc, entry) => {
      if (!acc[entry.userId]) {
        const employee = users?.find(u => u.id === entry.userId)
        acc[entry.userId] = {
          userName: employee?.name || entry.userName,
          role: employee?.role || entry.role,
          amount: 0,
          quantity: 0,
          count: 0
        }
      }
      acc[entry.userId].amount += entry.amount
      acc[entry.userId].quantity += entry.quantity
      acc[entry.userId].count += 1
      return acc
    }, {} as Record<string, { userName: string; role: string; amount: number; quantity: number; count: number }>)

    return { total, quantity, byRole, byUser }
  }, [filteredEntries])

  // Get users for filter - use all employees from profiles table
  const uniqueUsers = useMemo(() => {
    // If we have users data, use it directly
    if (users && users.length > 0) {
      return users
        .filter(user => user.name && user.name.trim() !== '')
        .map(user => ({
          id: user.id,
          name: user.name, // useUsers already maps full_name to name
          role: user.role
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    }

    // Fallback: get from entries if users not available
    const userIds = Array.from(new Set(entries.map(entry => entry.userId)))
    return userIds
      .map(userId => {
        const entry = entries.find(e => e.userId === userId)
        return {
          id: userId,
          name: entry?.userName || userId,
          role: entry?.role
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [users, entries])

  const handleDeleteCommission = async (entryId: string) => {
    if (!confirm('Apakah Anda yakin ingin menghapus entri komisi ini?')) {
      return;
    }

    setDeleteLoading(entryId);

    deleteCommissionMutation.mutate(entryId, {
      onSuccess: () => {
        setDeleteLoading(null);
      },
      onError: (error) => {
        alert('Gagal menghapus komisi. Silakan coba lagi.');
        setDeleteLoading(null);
      }
    });
  };

  // Recalculate commissions for the selected period
  const handleRecalculate = async () => {
    if (!confirm(`Recalculate komisi untuk periode ${format(start, 'dd MMM yyyy', { locale: id })} - ${format(end, 'dd MMM yyyy', { locale: id })}?\n\nIni akan:\n• Generate komisi untuk delivery yang belum ada komisinya\n• Update komisi jika rate berubah\n• Komisi yang sudah PAID tidak akan diubah`)) {
      return;
    }

    setIsRecalculating(true);
    try {
      const result = await recalculateCommissionsForPeriod(start, end);

      toast({
        title: "Recalculate Selesai",
        description: `${result.created} komisi baru dibuat, ${result.updated} diupdate, ${result.skipped} dilewati (sudah paid)`,
      });

      // Refresh data
      window.location.reload();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Gagal Recalculate",
        description: error.message || "Terjadi kesalahan saat recalculate komisi",
      });
    } finally {
      setIsRecalculating(false);
    }
  };

  const exportToPDF = () => {
    const doc = new jsPDF('landscape', 'pt', 'a4')

    // Set font for Indonesian text support
    doc.setFont('helvetica')

    // Title
    doc.setFontSize(18)
    doc.text('Laporan Komisi Karyawan', 40, 40)

    // Filter information
    doc.setFontSize(10)
    const filterInfo = `Periode: ${format(start, 'dd MMM yyyy', { locale: id })} - ${format(end, 'dd MMM yyyy', { locale: id })}`
    const userInfo = selectedUser === 'all'
      ? 'Semua Karyawan'
      : `Karyawan: ${uniqueUsers.find(u => u.id === selectedUser)?.name || 'Unknown'}`

    doc.text(filterInfo, 40, 65)
    doc.text(userInfo, 40, 80)

    // Summary box
    doc.setFontSize(12)
    doc.text('RINGKASAN', 40, 110)
    doc.setFontSize(10)
    doc.text(`Total Komisi: ${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(totals.total)}`, 40, 130)
    doc.text(`Total Qty: ${totals.quantity.toLocaleString("id-ID")}`, 40, 145)
    doc.text(`Total Entri: ${filteredEntries.length}`, 40, 160)
    doc.text(`Karyawan: ${Object.keys(totals.byUser).length}`, 40, 175)

    // Summary by role
    let yPos = 195
    doc.text('Ringkasan per Peran:', 40, yPos)
    Object.entries(totals.byRole).forEach(([role, data]) => {
      yPos += 15
      doc.text(`• ${role.toUpperCase()}: ${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(data.amount)} (${data.quantity} qty, ${data.count} entri)`, 50, yPos)
    })

    // Table data
    const tableData = filteredEntries.map(entry => {
      const employee = users?.find(u => u.id === entry.userId)
      return [
        format(entry.createdAt, "dd/MM/yyyy", { locale: id }),
        entry.role.toUpperCase(),
        employee?.name || entry.userName,
        entry.productName,
        entry.quantity.toString(),
        new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(entry.ratePerQty),
        new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(entry.amount),
        entry.ref,
        entry.status === 'paid' ? 'Dibayar' : entry.status === 'pending' ? 'Pending' : 'Batal'
      ]
    })

    // Add table
    autoTable(doc, {
      head: [['Tanggal', 'Peran', 'Karyawan', 'Produk', 'Qty', 'Rate (Rp)', 'Jumlah (Rp)', 'Ref', 'Status']],
      body: tableData,
      startY: yPos + 30,
      styles: {
        fontSize: 8,
        cellPadding: 3,
      },
      headStyles: {
        fillColor: [59, 130, 246], // blue-600
        textColor: 255,
        fontStyle: 'bold'
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252] // slate-50
      },
      columnStyles: {
        0: { cellWidth: 60 }, // Date
        1: { cellWidth: 50 }, // Role
        2: { cellWidth: 80 }, // Employee
        3: { cellWidth: 120 }, // Product
        4: { cellWidth: 40, halign: 'center' }, // Qty
        5: { cellWidth: 70, halign: 'right' }, // Rate
        6: { cellWidth: 80, halign: 'right' }, // Amount
        7: { cellWidth: 80 }, // Ref
        8: { cellWidth: 60 } // Status
      },
      margin: { left: 40, right: 40 },
    })

    // Footer
    const pageCount = (doc as any).internal.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setFontSize(8)
      doc.text(
        `Halaman ${i} dari ${pageCount} - Dibuat pada ${format(new Date(), 'dd MMM yyyy HH:mm', { locale: id })}`,
        40,
        doc.internal.pageSize.height - 20
      )
    }

    // Save the PDF
    const fileName = `laporan-komisi-detail-${format(start, 'yyyy-MM-dd')}-${format(end, 'yyyy-MM-dd')}.pdf`
    doc.save(fileName)
  }

  const exportToExcel = () => {
    // Prepare detailed data for Excel export
    const excelData = filteredEntries.map(entry => {
      const employee = users?.find(u => u.id === entry.userId)
      return {
        'Tanggal': format(entry.createdAt, "dd/MM/yyyy HH:mm", { locale: id }),
        'Peran': entry.role.toUpperCase(),
        'Karyawan': employee?.name || entry.userName,
        'Produk': entry.productName,
        'SKU': entry.productSku || '-',
        'Qty': entry.quantity,
        'Rate (Rp)': entry.ratePerQty,
        'Jumlah (Rp)': entry.amount,
        'Referensi': entry.ref,
        'Status': entry.status === 'paid' ? 'Dibayar' : entry.status === 'pending' ? 'Pending' : 'Batal'
      }
    })

    // Create workbook with detailed entries
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(excelData)

    // Set column widths
    ws['!cols'] = [
      { wch: 18 }, // Tanggal
      { wch: 10 }, // Peran
      { wch: 20 }, // Karyawan
      { wch: 30 }, // Produk
      { wch: 15 }, // SKU
      { wch: 8 },  // Qty
      { wch: 12 }, // Rate
      { wch: 15 }, // Jumlah
      { wch: 25 }, // Referensi
      { wch: 10 }  // Status
    ]

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Detail Komisi')

    // Create summary sheet
    const summaryData = [
      { 'Keterangan': 'Periode', 'Nilai': `${format(start, 'dd MMM yyyy', { locale: id })} - ${format(end, 'dd MMM yyyy', { locale: id })}` },
      { 'Keterangan': 'Filter Karyawan', 'Nilai': selectedUser === 'all' ? 'Semua Karyawan' : uniqueUsers.find(u => u.id === selectedUser)?.name || 'Unknown' },
      { 'Keterangan': '', 'Nilai': '' },
      { 'Keterangan': 'Total Komisi', 'Nilai': new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(totals.total) },
      { 'Keterangan': 'Total Quantity', 'Nilai': totals.quantity.toLocaleString("id-ID") },
      { 'Keterangan': 'Total Entri', 'Nilai': filteredEntries.length },
      { 'Keterangan': 'Jumlah Karyawan', 'Nilai': Object.keys(totals.byUser).length },
      { 'Keterangan': '', 'Nilai': '' },
      { 'Keterangan': 'RINGKASAN PER PERAN', 'Nilai': '' },
    ]

    // Add role summary
    Object.entries(totals.byRole).forEach(([role, data]) => {
      summaryData.push({
        'Keterangan': role.toUpperCase(),
        'Nilai': `${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(data.amount)} (${data.quantity} qty, ${data.count} entri)`
      })
    })

    summaryData.push({ 'Keterangan': '', 'Nilai': '' })
    summaryData.push({ 'Keterangan': 'RINGKASAN PER KARYAWAN', 'Nilai': '' })

    // Add user summary
    Object.entries(totals.byUser)
      .sort((a, b) => b[1].amount - a[1].amount)
      .forEach(([userId, data]) => {
        summaryData.push({
          'Keterangan': `${data.userName} (${data.role.toUpperCase()})`,
          'Nilai': new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(data.amount)
        })
      })

    const wsSummary = XLSX.utils.json_to_sheet(summaryData)
    wsSummary['!cols'] = [
      { wch: 30 }, // Keterangan
      { wch: 40 }  // Nilai
    ]
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan')

    // Generate and download Excel file
    const fileName = `komisi-detail-${format(start, 'yyyy-MM-dd')}-${format(end, 'yyyy-MM-dd')}.xlsx`
    XLSX.writeFile(wb, fileName)
  }


  if (isLoading || usersLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 p-4 flex items-center justify-center">
        <Card className="max-w-md mx-auto">
          <CardContent className="p-6 text-center">
            <Loader2 className="h-8 w-8 mx-auto mb-4 text-blue-600 animate-spin" />
            <p className="text-lg font-medium">Memuat laporan komisi...</p>
          </CardContent>
        </Card>
      </div>
    )
  }


  // Show error message if table doesn't exist
  if (error && error.message?.includes('Tabel komisi belum dibuat')) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 lg:p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          <Card className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
            <CardHeader className="py-6 px-6">
              <CardTitle className="flex items-center gap-3 text-2xl font-bold">
                <BarChart3 className="h-8 w-8" />
                Laporan Komisi
              </CardTitle>
            </CardHeader>
          </Card>

          <Card className="border-orange-200 bg-orange-50">
            <CardContent className="p-6">
              <div className="text-center space-y-4">
                <div className="text-orange-600 text-6xl">⚠️</div>
                <h2 className="text-xl font-bold text-orange-800">Tabel Komisi Belum Dibuat</h2>
                <p className="text-orange-700">
                  Sistem komisi belum diaktifkan. Tabel database belum dibuat.
                </p>
                <div className="bg-white p-4 rounded-lg border border-orange-200">
                  <p className="text-sm text-gray-600 mb-2">
                    Untuk mengaktifkan sistem komisi, jalankan migration berikut:
                  </p>
                  <code className="text-xs bg-gray-100 p-2 rounded block">
                    supabase/migrations/0031_add_commission_tables.sql
                  </code>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <Card className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
          <CardHeader className="py-6 px-6">
            <CardTitle className="flex items-center gap-3 text-2xl font-bold">
              <BarChart3 className="h-8 w-8" />
              Laporan Komisi
            </CardTitle>
            <CardDescription className="text-blue-100 text-lg mt-2">
              Detail komisi dari seluruh orderan dan pengantaran
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Filter Laporan
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">
                  Dari Tanggal
                </label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">
                  Sampai Tanggal
                </label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">
                  Karyawan
                </label>
                <Select value={selectedUser} onValueChange={setSelectedUser}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Karyawan</SelectItem>
                    {uniqueUsers.map(userItem => (
                      <SelectItem key={userItem.id} value={userItem.id}>
                        {userItem.name} ({userItem.role?.toUpperCase()})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Recalculate Button - Owner/Admin only */}
            {(user?.role === 'owner' || user?.role === 'admin') && (
              <div className="mt-4 pt-4 border-t">
                <Button
                  onClick={handleRecalculate}
                  disabled={isRecalculating}
                  variant="outline"
                  className="bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
                >
                  {isRecalculating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Recalculate Komisi Periode Ini
                </Button>
                <p className="text-xs text-muted-foreground mt-2">
                  Generate/update komisi untuk delivery dalam periode yang dipilih berdasarkan commission rules terbaru
                </p>
              </div>
            )}

          </CardContent>
        </Card>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Komisi</p>
                  <p className="text-2xl font-bold text-green-600">
                    {new Intl.NumberFormat("id-ID", {
                      style: "currency",
                      currency: "IDR",
                      maximumFractionDigits: 0
                    }).format(totals.total)}
                  </p>
                </div>
                <TrendingUp className="h-8 w-8 text-green-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Qty</p>
                  <p className="text-2xl font-bold">{totals.quantity.toLocaleString("id-ID")}</p>
                </div>
                <BarChart3 className="h-8 w-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Entri</p>
                  <p className="text-2xl font-bold">{filteredEntries.length}</p>
                </div>
                <Calendar className="h-8 w-8 text-purple-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Karyawan</p>
                  <p className="text-2xl font-bold">{Object.keys(totals.byUser).length}</p>
                </div>
                <Users className="h-8 w-8 text-orange-600" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Summary by Role */}
        <Card>
          <CardHeader>
            <CardTitle>Ringkasan per Peran</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {Object.entries(totals.byRole).map(([role, data]) => (
                <div key={role} className="bg-muted/50 p-4 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <Badge variant="outline" className="uppercase">
                      {role}
                    </Badge>
                    <span className="text-sm text-muted-foreground">{data.count} entri</span>
                  </div>
                  <div className="space-y-1">
                    <div className="text-lg font-bold text-green-600">
                      {new Intl.NumberFormat("id-ID", {
                        style: "currency",
                        currency: "IDR",
                        maximumFractionDigits: 0
                      }).format(data.amount)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {data.quantity} qty total
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Export Buttons */}
        <div className="flex justify-between items-center">
          <div className="text-sm text-gray-600">
            Menampilkan {filteredEntries.length} entri komisi
          </div>
          <div className="flex gap-2">
            <Button onClick={exportToExcel} variant="outline" className="bg-green-50 border-green-200 text-green-700 hover:bg-green-100">
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Export Excel
            </Button>
            <Button onClick={exportToPDF} variant="outline" className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100">
              <Download className="h-4 w-4 mr-2" />
              Export Detail PDF
            </Button>
          </div>
        </div>

        {/* Detailed Table */}
        <Card>
          <CardHeader>
            <CardTitle>Detail Komisi</CardTitle>
            <CardDescription>
              Rincian setiap entri komisi berdasarkan transaksi dan pengantaran
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg bg-card overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Tanggal</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Peran</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Karyawan</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Produk</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Qty</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Rate</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Jumlah</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Ref</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Status</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry) => (
                    <tr key={entry.id} className="border-t hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3">
                        {format(entry.createdAt, "dd MMM yyyy HH:mm", { locale: id })}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="uppercase text-xs">
                          {entry.role}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {(() => {
                          const employee = users?.find(u => u.id === entry.userId)
                          return employee?.name || entry.userName
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <div className="font-medium">{entry.productName}</div>
                          {entry.productSku && (
                            <div className="text-xs text-muted-foreground font-mono">
                              {entry.productSku}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">{entry.quantity}</td>
                      <td className="px-4 py-3">
                        {new Intl.NumberFormat("id-ID", {
                          style: "currency",
                          currency: "IDR",
                          maximumFractionDigits: 0
                        }).format(entry.ratePerQty)}
                      </td>
                      <td className="px-4 py-3 font-semibold text-green-600">
                        {new Intl.NumberFormat("id-ID", {
                          style: "currency",
                          currency: "IDR",
                          maximumFractionDigits: 0
                        }).format(entry.amount)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{entry.ref}</td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={entry.status === 'paid' ? 'default' : entry.status === 'pending' ? 'secondary' : 'destructive'}
                        >
                          {entry.status === 'paid' ? 'Dibayar' : entry.status === 'pending' ? 'Pending' : 'Batal'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {(user?.role === 'admin' || user?.role === 'owner' || user?.role === 'cashier') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteCommission(entry.id)}
                            disabled={deleteLoading === entry.id}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            {deleteLoading === entry.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredEntries.length === 0 && (
                    <tr>
                      <td className="px-4 py-8 text-center text-slate-500" colSpan={10}>
                        Tidak ada data komisi untuk periode yang dipilih
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  )
}