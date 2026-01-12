"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { CalendarIcon, TrendingUp, DollarSign, Users, FileText, Download } from "lucide-react"
import { format } from "date-fns"
import { id } from "date-fns/locale/id"
import { cn } from "@/lib/utils"
import { useSalesEmployees, useSalesCommissionReport } from "@/hooks/useSalesCommission"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { saveCompressedPDF } from "@/utils/pdfUtils"

export function SalesCommissionReport() {
  const [selectedSales, setSelectedSales] = useState<string>('')
  const [startDate, setStartDate] = useState<Date>(() => {
    const date = new Date()
    date.setDate(1) // First day of current month
    return date
  })
  const [endDate, setEndDate] = useState<Date>(new Date())
  const [startDateOpen, setStartDateOpen] = useState(false)
  const [endDateOpen, setEndDateOpen] = useState(false)

  const { data: salesEmployees } = useSalesEmployees()
  const { data: report, isLoading } = useSalesCommissionReport(
    selectedSales || undefined,
    startDate,
    endDate
  )

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(amount)
  }

  const formatCommissionRate = (type: 'percentage' | 'fixed', value: number) => {
    if (type === 'percentage') {
      return `${value}%`
    }
    return formatCurrency(value)
  }

  const generatePDFReport = async () => {
    if (!report) return

    const doc = new jsPDF()
    const pageWidth = doc.internal.pageSize.width
    const margin = 20

    // Header
    doc.setFontSize(18)
    doc.setFont("helvetica", "bold")
    doc.text("LAPORAN KOMISI SALES", pageWidth / 2, 20, { align: 'center' })

    doc.setFontSize(12)
    doc.setFont("helvetica", "normal")
    doc.text(`Periode: ${format(startDate, "dd MMMM yyyy", { locale: id })} - ${format(endDate, "dd MMMM yyyy", { locale: id })}`, pageWidth / 2, 30, { align: 'center' })
    doc.text(`Sales: ${report.salesName}`, pageWidth / 2, 40, { align: 'center' })

    // Summary section
    let yPos = 60
    doc.setFontSize(14)
    doc.setFont("helvetica", "bold")
    doc.text("RINGKASAN KOMISI", margin, yPos)

    yPos += 15
    doc.setFontSize(11)
    doc.setFont("helvetica", "normal")

    const summaryData = [
      ['Total Penjualan', formatCurrency(report.totalSales)],
      ['Total Transaksi', report.totalTransactions.toString()],
      ['Komisi Rate', formatCommissionRate(report.commissionType, report.commissionRate)],
      ['Total Komisi', formatCurrency(report.commissionEarned)]
    ]

    autoTable(doc, {
      startY: yPos,
      head: [['Kategori', 'Nilai']],
      body: summaryData,
      theme: 'grid',
      headStyles: { fillColor: [66, 139, 202] },
      margin: { left: margin, right: margin },
      tableWidth: 'auto',
    })

    yPos = (doc as any).lastAutoTable.finalY + 20

    // Transaction details
    doc.setFontSize(14)
    doc.setFont("helvetica", "bold")
    doc.text("DETAIL TRANSAKSI", margin, yPos)

    yPos += 10

    const transactionData = report.transactions.map(t => [
      t.transactionId,
      t.customerName,
      format(t.orderDate, "dd/MM/yyyy"),
      formatCurrency(t.totalAmount),
      formatCurrency(t.commissionAmount),
      t.status === 'paid' ? 'Lunas' : 'Pending'
    ])

    autoTable(doc, {
      startY: yPos,
      head: [['ID Transaksi', 'Customer', 'Tanggal', 'Total', 'Komisi', 'Status']],
      body: transactionData,
      theme: 'striped',
      headStyles: { fillColor: [66, 139, 202] },
      margin: { left: margin, right: margin },
      styles: { fontSize: 9 },
      columnStyles: {
        0: { cellWidth: 25 },
        1: { cellWidth: 40 },
        2: { cellWidth: 20 },
        3: { cellWidth: 25 },
        4: { cellWidth: 25 },
        5: { cellWidth: 20 }
      }
    })

    // Footer
    const footerY = doc.internal.pageSize.height - 20
    doc.setFontSize(8)
    doc.setFont("helvetica", "normal")
    doc.text(`Dicetak pada: ${format(new Date(), "dd MMMM yyyy, HH:mm", { locale: id })} WIB`, pageWidth / 2, footerY, { align: 'center' })

    const filename = `laporan-komisi-sales-${report.salesName.replace(/\s+/g, '-')}-${format(startDate, 'yyyy-MM-dd')}-${format(endDate, 'yyyy-MM-dd')}.pdf`
    await saveCompressedPDF(doc, filename, 100)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Laporan Komisi Sales
          </CardTitle>
          <CardDescription>
            Lihat laporan komisi penjualan berdasarkan periode dan sales tertentu
          </CardDescription>
        </CardHeader>

        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label>Sales</Label>
              <Select value={selectedSales} onValueChange={setSelectedSales}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih Sales" />
                </SelectTrigger>
                <SelectContent>
                  {salesEmployees?.map((sales) => (
                    <SelectItem key={sales.id} value={sales.id}>
                      {sales.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Tanggal Mulai</Label>
              <Popover open={startDateOpen} onOpenChange={setStartDateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "justify-start text-left font-normal",
                      !startDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(startDate, "dd MMM yyyy", { locale: id }) : "Pilih tanggal"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={(date) => {
                      if (date) setStartDate(date)
                      setStartDateOpen(false)
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label>Tanggal Selesai</Label>
              <Popover open={endDateOpen} onOpenChange={setEndDateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "justify-start text-left font-normal",
                      !endDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {endDate ? format(endDate, "dd MMM yyyy", { locale: id }) : "Pilih tanggal"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={endDate}
                    onSelect={(date) => {
                      if (date) setEndDate(date)
                      setEndDateOpen(false)
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label>&nbsp;</Label>
              <Button
                onClick={generatePDFReport}
                disabled={!report}
                className="w-full"
              >
                <Download className="mr-2 h-4 w-4" />
                Export PDF
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <Card>
          <CardContent className="text-center py-8">
            <div>Loading data...</div>
          </CardContent>
        </Card>
      )}

      {!isLoading && !selectedSales && (
        <Card>
          <CardContent className="text-center py-8 text-muted-foreground">
            Pilih sales untuk melihat laporan komisi
          </CardContent>
        </Card>
      )}

      {!isLoading && selectedSales && !report && (
        <Card>
          <CardContent className="text-center py-8 text-muted-foreground">
            Tidak ada data komisi untuk periode yang dipilih
          </CardContent>
        </Card>
      )}

      {report && (
        <>
          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="border-l-4 border-l-emerald-500">
              <CardContent className="p-6">
                <div className="flex items-center">
                  <DollarSign className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                  <div className="ml-4">
                    <p className="text-sm font-medium text-muted-foreground dark:text-slate-400">Total Penjualan</p>
                    <p className="text-2xl font-bold text-foreground dark:text-white">{formatCurrency(report.totalSales)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-blue-500">
              <CardContent className="p-6">
                <div className="flex items-center">
                  <FileText className="h-8 w-8 text-blue-600 dark:text-blue-400" />
                  <div className="ml-4">
                    <p className="text-sm font-medium text-muted-foreground dark:text-slate-400">Total Transaksi</p>
                    <p className="text-2xl font-bold text-foreground dark:text-white">{report.totalTransactions}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-purple-500">
              <CardContent className="p-6">
                <div className="flex items-center">
                  <TrendingUp className="h-8 w-8 text-purple-600 dark:text-purple-400" />
                  <div className="ml-4">
                    <p className="text-sm font-medium text-muted-foreground dark:text-slate-400">Rate Komisi</p>
                    <p className="text-2xl font-bold text-foreground dark:text-white">
                      {formatCommissionRate(report.commissionType, report.commissionRate)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-orange-500">
              <CardContent className="p-6">
                <div className="flex items-center">
                  <Users className="h-8 w-8 text-orange-600 dark:text-orange-400" />
                  <div className="ml-4">
                    <p className="text-sm font-medium text-muted-foreground dark:text-slate-400">Total Komisi</p>
                    <p className="text-2xl font-bold text-foreground dark:text-white">{formatCurrency(report.commissionEarned)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Transaction Details */}
          <Card>
            <CardHeader>
              <CardTitle>Detail Transaksi</CardTitle>
              <CardDescription>
                Rincian komisi per transaksi untuk {report.salesName}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID Transaksi</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead className="text-right">Total Penjualan</TableHead>
                    <TableHead className="text-right">Komisi</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="bg-transparent">
                  {report.transactions.map((transaction) => (
                    <TableRow key={transaction.id} className="table-row-hover hover:bg-muted/50 dark:hover:bg-slate-800/50">
                      <TableCell className="font-mono text-foreground dark:text-slate-200">
                        {transaction.transactionId}
                      </TableCell>
                      <TableCell className="text-foreground dark:text-slate-200">{transaction.customerName}</TableCell>
                      <TableCell className="text-foreground dark:text-slate-200">
                        {format(transaction.orderDate, "dd MMM yyyy", { locale: id })}
                      </TableCell>
                      <TableCell className="text-right text-foreground dark:text-slate-200">
                        {formatCurrency(transaction.totalAmount)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-foreground dark:text-white">
                        {formatCurrency(transaction.commissionAmount)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={transaction.status === 'paid' ? 'default' : 'secondary'}>
                          {transaction.status === 'paid' ? 'Lunas' : 'Pending'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Separator className="my-4" />

              <div className="flex justify-between items-center text-lg font-semibold">
                <span>Total Komisi:</span>
                <span className="text-emerald-600 dark:text-emerald-400">{formatCurrency(report.commissionEarned)}</span>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}