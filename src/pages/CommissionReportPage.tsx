"use client"

import { useState, useMemo, useEffect, Fragment } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { useOptimizedCommissionEntries, useDeleteCommissionEntry } from "@/hooks/useOptimizedCommissions"
import { useAuth } from "@/hooks/useAuth"
import { useBranch } from "@/contexts/BranchContext"
import { useUsers } from "@/hooks/useUsers"
import { format } from "date-fns"
import { id } from "date-fns/locale/id"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
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
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Check,
  ChevronsUpDown,
  Search,
} from "lucide-react"
import { recalculateCommissionsForPeriod } from "@/utils/commissionUtils"
import { useToast } from "@/components/ui/use-toast"

export default function CommissionReportPage() {
  const { user } = useAuth()
  const { currentBranch } = useBranch()
  const { toast } = useToast()
  const { users, isLoading: usersLoading } = useUsers({ filterByBranch: true })
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

  const applyMonthlyFilter = (month: number, year: number) => {
    const endDay = new Date(year, month + 1, 0).getDate();
    const m = (month + 1).toString().padStart(2, '0');
    setStartDate(`${year}-${m}-01`);
    setEndDate(`${year}-${m}-${endDay.toString().padStart(2, '0')}`);
  }

  const [selectedUser, setSelectedUser] = useState<string>("all")
  const [userFilterOpen, setUserFilterOpen] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 50

  const [queryConfig, setQueryConfig] = useState<{ start: string, end: string, user: string } | null>(null)

  // Use optimized commission entries with date filters
  const start = queryConfig ? new Date(queryConfig.start + "T00:00:00") : undefined
  const end = queryConfig ? new Date(queryConfig.end + "T23:59:59.999") : undefined

  const {
    data: entries = [],
    isLoading,
    isFetching,
    error
  } = useOptimizedCommissionEntries(start, end, undefined, !!queryConfig)

  const isGenerated = !!queryConfig;


  // Filter by user if selected
  const filteredEntries = useMemo(() => {
    let filtered = entries

    if (queryConfig?.user && queryConfig.user !== "all") {
      filtered = filtered.filter(entry => entry.userId === queryConfig.user)
    }

    return filtered.sort((a, b) => {
      // Kelompokkan per karyawan secara alfabet jika tidak memfilter secara spesifik (mirip sistem Gaji)
      if (!queryConfig?.user || queryConfig.user === "all") {
        const nameA = a.userName || '';
        const nameB = b.userName || '';
        if (nameA !== nameB) {
          return nameA.localeCompare(nameB);
        }
      }
      return b.createdAt.getTime() - a.createdAt.getTime()
    })
  }, [entries, queryConfig?.user])

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [queryConfig])

  const handleGenerate = () => {
    setQueryConfig({ start: startDate, end: endDate, user: selectedUser })
  }

  const paginatedEntries = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    return filteredEntries.slice(startIndex, startIndex + itemsPerPage)
  }, [filteredEntries, currentPage, itemsPerPage])

  const totalPages = Math.ceil(filteredEntries.length / itemsPerPage)

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

    // Group by user and role for detail breakdown
    const byUserAndRole = filteredEntries.reduce((acc, entry) => {
      const key = `${entry.userId}_${entry.role}`;
      if (!acc[key]) {
        const employee = users?.find(u => u.id === entry.userId);
        acc[key] = {
          userId: entry.userId,
          userName: employee?.name || entry.userName || 'Tanpa Nama',
          role: entry.role,
          amount: 0,
          quantity: 0,
          count: 0
        }
      }
      acc[key].amount += entry.amount;
      acc[key].quantity += entry.quantity;
      acc[key].count += 1;
      return acc;
    }, {} as Record<string, { userId: string; userName: string; role: string; amount: number; quantity: number; count: number }>);

    const groupedByRole = Object.values(byUserAndRole).reduce((acc, item) => {
      if (!acc[item.role]) acc[item.role] = [];
      acc[item.role].push(item);
      return acc;
    }, {} as Record<string, { userId: string; userName: string; role: string; amount: number; quantity: number; count: number }[]>);

    // Sort users inside each role by amount
    Object.keys(groupedByRole).forEach(role => {
      groupedByRole[role].sort((a,b) => b.amount - a.amount);
    });

    return { total, quantity, byRole, byUser, groupedByRole }
  }, [filteredEntries, users])

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
    const recalcStart = new Date(startDate + "T00:00:00");
    const recalcEnd = new Date(endDate + "T23:59:59.999");
    
    if (!confirm(`Recalculate komisi untuk periode ${format(recalcStart, 'dd MMM yyyy', { locale: id })} - ${format(recalcEnd, 'dd MMM yyyy', { locale: id })}?\n\nIni akan:\n• Generate komisi untuk delivery yang belum ada komisinya\n• Update komisi jika rate berubah\n• Komisi yang sudah PAID tidak akan diubah`)) {
      return;
    }

    setIsRecalculating(true);
    try {
      const result = await recalculateCommissionsForPeriod(recalcStart, recalcEnd, currentBranch?.id);

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

    if (!start || !end) return;
    
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
        `${entry.role === 'sales' ? '[Trx]' : '[Del]'} - ${entry.customerName ? `[${entry.customerName}]` : '[Walk-in]'} - ${entry.ref} - ${format(entry.createdAt, "dd/MM HH:mm")}`,
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

    if (!start || !end) return;

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
        'Referensi': `${entry.role === 'sales' ? '[Trx]' : '[Del]'} - ${entry.customerName ? `[${entry.customerName}]` : '[Walk-in]'} - ${entry.ref} - ${format(entry.createdAt, "dd/MM/yyyy HH:mm")}`,
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

    if (!start || !end) return;
    
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
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan Laporan')

    // Prepare Employee Salary formatted sheet — dengan RUMUS Excel di kolom Total
    // Dibangun cell-by-cell agar kolom F (Total Komisi) berisi formula =C*D, bukan angka statis
    const wsEmployee: XLSX.WorkSheet = {};
    const employeeHeaders = ['Nama Karyawan', 'Peran Utama', 'Tarif Komisi (Rp)', 'Jumlah Barang (Qty)', 'Frekuensi Transaksi', 'Total Komisi (Rp)'];
    
    // Row 1: Header
    employeeHeaders.forEach((header, colIdx) => {
      const cellAddr = XLSX.utils.encode_cell({ r: 0, c: colIdx });
      wsEmployee[cellAddr] = { t: 's', v: header };
    });

    let empRowIdx = 1; // Start dari row index 1 (row 2 di Excel = 1-indexed)

    // Flatten semua data dari groupedByRole, lalu sort berdasarkan nama (A-Z)
    // Bila nama sama (orang dgn 2 peran), sort lagi berdasarkan role
    const allEmployeeRows: { userName: string; role: string; avgRate: number; quantity: number; count: number }[] = [];
    Object.entries(totals.groupedByRole).forEach(([role, usersInRole]) => {
      usersInRole.forEach(data => {
        const avgRate = data.quantity > 0 ? Math.round(data.amount / data.quantity) : 0;
        allEmployeeRows.push({ userName: data.userName, role, avgRate, quantity: data.quantity, count: data.count });
      });
    });

    // Sort: nama A-Z sebagai primary key, role sebagai secondary key
    allEmployeeRows.sort((a, b) => {
      const nameCompare = a.userName.localeCompare(b.userName, 'id');
      if (nameCompare !== 0) return nameCompare;
      return a.role.localeCompare(b.role, 'id');
    });

    allEmployeeRows.forEach(row => {
      const excelRow = empRowIdx + 1; // Nomor baris di Excel (1-indexed), header ada di baris 1

      // Kolom A: Nama Karyawan
      wsEmployee[XLSX.utils.encode_cell({ r: empRowIdx, c: 0 })] = { t: 's', v: row.userName };
      // Kolom B: Peran Utama
      wsEmployee[XLSX.utils.encode_cell({ r: empRowIdx, c: 1 })] = { t: 's', v: row.role };
      // Kolom C: Tarif Komisi (angka, bisa diubah oleh user)
      wsEmployee[XLSX.utils.encode_cell({ r: empRowIdx, c: 2 })] = { t: 'n', v: row.avgRate };
      // Kolom D: Jumlah Barang / Qty (angka)
      wsEmployee[XLSX.utils.encode_cell({ r: empRowIdx, c: 3 })] = { t: 'n', v: row.quantity };
      // Kolom E: Frekuensi Transaksi (angka)
      wsEmployee[XLSX.utils.encode_cell({ r: empRowIdx, c: 4 })] = { t: 'n', v: row.count };
      // Kolom F: Total Komisi — RUMUS =C*D (Tarif × Qty), bukan angka statis!
      wsEmployee[XLSX.utils.encode_cell({ r: empRowIdx, c: 5 })] = {
        t: 'n',
        f: `C${excelRow}*D${excelRow}`,   // ← Rumus Excel yang sesungguhnya
        v: row.avgRate * row.quantity,     // Cached value (untuk preview tanpa recalculate)
      };

      empRowIdx++;
    });

    // Tambah baris TOTAL di bawah jika ada data
    if (empRowIdx > 1) {
      wsEmployee[XLSX.utils.encode_cell({ r: empRowIdx, c: 0 })] = { t: 's', v: 'TOTAL' };
      wsEmployee[XLSX.utils.encode_cell({ r: empRowIdx, c: 1 })] = { t: 's', v: '' };
      wsEmployee[XLSX.utils.encode_cell({ r: empRowIdx, c: 2 })] = { t: 's', v: '' };
      wsEmployee[XLSX.utils.encode_cell({ r: empRowIdx, c: 3 })] = {
        t: 'n',
        f: `SUM(D2:D${empRowIdx})`,
        v: totals.quantity,
      };
      wsEmployee[XLSX.utils.encode_cell({ r: empRowIdx, c: 4 })] = {
        t: 'n',
        f: `SUM(E2:E${empRowIdx})`,
        v: Object.values(totals.byUser).reduce((s, u) => s + u.count, 0),
      };
      wsEmployee[XLSX.utils.encode_cell({ r: empRowIdx, c: 5 })] = {
        t: 'n',
        f: `SUM(F2:F${empRowIdx})`,
        v: totals.total,
      };
      empRowIdx++;
    }

    // Set sheet range
    wsEmployee['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: empRowIdx - 1, c: 5 } });
    wsEmployee['!cols'] = [
      { wch: 25 }, // Nama Karyawan
      { wch: 15 }, // Peran Utama
      { wch: 18 }, // Tarif Komisi
      { wch: 20 }, // Jumlah Barang (Qty)
      { wch: 18 }, // Frekuensi Transaksi
      { wch: 20 }, // Total Komisi (formula)
    ];
    XLSX.utils.book_append_sheet(wb, wsEmployee, 'Rekap Gaji Karyawan');

    if (!start || !end) return;

    // Generate and download Excel file
    const fileName = `komisi-detail-${format(start, 'yyyy-MM-dd')}-${format(end, 'yyyy-MM-dd')}.xlsx`
    XLSX.writeFile(wb, fileName)
  }


  if ((isGenerated && isLoading) || usersLoading) {
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
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm text-muted-foreground mr-2">Filter Cepat:</span>
              <Button variant="outline" size="sm" onClick={() => {
                const now = new Date();
                applyMonthlyFilter(now.getMonth(), now.getFullYear());
              }}>Bulan Ini</Button>
              <Button variant="outline" size="sm" onClick={() => {
                const now = new Date();
                now.setMonth(now.getMonth() - 1);
                applyMonthlyFilter(now.getMonth(), now.getFullYear());
              }}>Bulan Lalu</Button>
            </div>
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
                <Popover open={userFilterOpen} onOpenChange={setUserFilterOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={userFilterOpen}
                      className="w-full justify-between"
                    >
                      {selectedUser === "all"
                        ? "Semua Karyawan"
                        : uniqueUsers.find((user) => user.id === selectedUser)?.name || "Karyawan"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0">
                    <Command>
                      <CommandInput placeholder="Cari karyawan..." />
                      <CommandList>
                        <CommandEmpty>Karyawan tidak ditemukan.</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="all"
                            onSelect={() => {
                              setSelectedUser("all");
                              setUserFilterOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedUser === "all" ? "opacity-100" : "opacity-0"
                              )}
                            />
                            Semua Karyawan
                          </CommandItem>
                          {uniqueUsers.map((userItem) => (
                            <CommandItem
                              key={userItem.id}
                              value={userItem.name}
                              onSelect={() => {
                                setSelectedUser(userItem.id);
                                setUserFilterOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectedUser === userItem.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {userItem.name} ({userItem.role?.toUpperCase()})
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <Button 
                onClick={handleGenerate} 
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Search className="h-4 w-4 mr-2" />
                Generate Laporan
              </Button>

            {/* Recalculate Button - Owner/Admin only */}
            {(user?.role === 'owner' || user?.role === 'admin') && (
              <div className="flex flex-col">
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
            </div>

          </CardContent>
        </Card>

        {/* Main Content Rendered Only If Generated */}
        {isGenerated && (
          <div className="space-y-6">
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

        {/* Summary by User (Ringkasan per Karyawan) */}
        <Card>
          <CardHeader>
            <CardTitle>Daftar Karyawan & Total Komisi</CardTitle>
            <CardDescription>
              Kumpulan total hitungan komisi beserta rincian per karyawan (Siap untuk direkap ke Gaji)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground w-1/4">Nama Karyawan</th>
                    <th className="text-center px-4 py-3 font-semibold text-muted-foreground w-32">Tarif Komisi</th>
                    <th className="text-center px-4 py-3 font-semibold text-muted-foreground w-24">Jumlah Qty</th>
                    <th className="text-center px-4 py-3 font-semibold text-muted-foreground">Total Transaksi</th>
                    <th className="text-right px-4 py-3 font-semibold text-muted-foreground w-1/4">Total Komisi (Rp)</th>
                  </tr>
                </thead>
                {Object.entries(totals.groupedByRole).map(([role, usersInRole]) => (
                  <tbody key={role} className="divide-y relative">
                    <tr className="bg-slate-100/80">
                      <td colSpan={5} className="px-4 py-2 font-bold text-slate-800 uppercase tracking-wider text-xs">
                        Peran: {role}
                      </td>
                    </tr>
                    {usersInRole.map((data) => {
                      const avgRate = data.quantity > 0 ? Math.round(data.amount / data.quantity) : 0;
                      return (
                        <tr key={`${role}-${data.userId}`} className="hover:bg-muted/50 transition-colors">
                          <td className="px-4 py-3 font-medium text-blue-700 pl-6">{data.userName}</td>
                          <td className="px-4 py-3 text-center text-slate-600">
                            {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(avgRate)}
                          </td>
                          <td className="px-4 py-3 text-center font-bold text-blue-600">
                            {data.quantity}
                          </td>
                          <td className="px-4 py-3 text-center text-muted-foreground">{data.count}x Jalan</td>
                          <td className="px-4 py-3 text-right font-bold text-green-700 bg-green-50/20">
                            {new Intl.NumberFormat("id-ID", {
                              style: "currency",
                              currency: "IDR",
                              maximumFractionDigits: 0
                            }).format(data.amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                ))}
                {Object.keys(totals.groupedByRole).length === 0 && (
                  <tbody>
                    <tr>
                      <td colSpan={5} className="text-center py-6 text-muted-foreground">
                        Tidak ada data komisi karyawan pada periode ini.
                      </td>
                    </tr>
                  </tbody>
                )}
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Export Buttons */}
        <div className="flex justify-between items-center">
          <div className="text-sm text-gray-600">
            Menampilkan {paginatedEntries.length} dari {filteredEntries.length} entri komisi (Halaman {currentPage} dari {totalPages || 1})
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
                  {paginatedEntries.map((entry) => (
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
                      <td className="px-4 py-3 font-mono text-xs">
                        {entry.role === 'sales' ? '[Trx]' : '[Del]'} - {entry.customerName ? `[${entry.customerName}]` : '[Walk-in]'} - {entry.ref} - {format(entry.createdAt, "dd/MM/yyyy HH:mm")}
                      </td>
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

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-6 pb-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCurrentPage(1);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  disabled={currentPage === 1}
                  className="hidden sm:flex"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCurrentPage(prev => Math.max(1, prev - 1));
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Prev
                </Button>

                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }

                    return (
                      <Button
                        key={pageNum}
                        variant={currentPage === pageNum ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                          setCurrentPage(pageNum);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className={`w-9 ${currentPage === pageNum ? "bg-blue-600 hover:bg-blue-700" : ""}`}
                      >
                        {pageNum}
                      </Button>
                    );
                  })}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCurrentPage(prev => Math.min(totalPages, prev + 1));
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  disabled={currentPage === totalPages}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCurrentPage(totalPages);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  disabled={currentPage === totalPages}
                  className="hidden sm:flex"
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
        </div>
        )}

      </div>
    </div>
  )
}