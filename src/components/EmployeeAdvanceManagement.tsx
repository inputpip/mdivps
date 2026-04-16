"use client"
import { useState, useMemo, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "./ui/use-toast"
import { useAuth } from "@/hooks/useAuth"
import { useUsers } from "@/hooks/useUsers"
import { useEmployeeAdvances } from "@/hooks/useEmployeeAdvances"
import { canManageCash, isOwner } from '@/utils/roleUtils'
import { EmployeeAdvance } from "@/types/employeeAdvance"
import { RepayAdvanceDialog } from "./RepayAdvanceDialog"
import { format, endOfDay, isAfter, isBefore, isSameDay, parseISO, startOfDay } from "date-fns"
import { id } from "date-fns/locale/id"
import { Badge } from "./ui/badge"
import { useAccounts } from "@/hooks/useAccounts"
import { Trash2, Search, History, ArrowUpDown, Columns } from "lucide-react"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { PanjarReceiptPDF } from "./PanjarReceiptPDF"
import { EmployeeAdvancesReport } from "./EmployeeAdvancesReport"
import { useTimezone } from "@/contexts/TimezoneContext"
import { getOfficeTime } from "@/utils/officeTime"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

const advanceSchema = z.object({
  employeeId: z.string().min(1, "Karyawan harus dipilih."),
  amount: z.coerce.number().min(1000, "Jumlah minimal Rp 1.000."),
  date: z.date({ required_error: "Tanggal harus diisi." }),
  notes: z.string().optional(),
  accountId: z.string().min(1, "Sumber dana harus dipilih."),
})

type AdvanceFormData = z.infer<typeof advanceSchema>

export function EmployeeAdvanceManagement() {
  const { toast } = useToast()
  const { user } = useAuth()
  const { timezone } = useTimezone()
  const { users: employees, isLoading: loadingUsers } = useUsers({ filterByBranch: true })
  const { accounts, isLoading: loadingAccounts } = useAccounts()
  const { advances, isLoading: loadingAdvances, addAdvance, deleteAdvance, isError, error: advancesError } = useEmployeeAdvances()
  const [isRepayDialogOpen, setIsRepayDialogOpen] = useState(false)
  const [selectedAdvance, setSelectedAdvance] = useState<EmployeeAdvance | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [dateFromFilter, setDateFromFilter] = useState("")
  const [dateToFilter, setDateToFilter] = useState("")

  // Check if user has management privileges (kasir, admin, owner)
  const canManageAdvances = canManageCash(user)
  const isViewOnly = !canManageAdvances

  const { register, handleSubmit, setValue, reset, formState: { errors } } = useForm<AdvanceFormData>({
    resolver: zodResolver(advanceSchema),
    defaultValues: {
      employeeId: "",
      amount: 0,
      date: getOfficeTime(timezone),
      notes: "",
      accountId: "",
    }
  })

  const handleOpenRepayDialog = (advance: EmployeeAdvance) => {
    setSelectedAdvance(advance)
    setIsRepayDialogOpen(true)
  }

  const onAddAdvanceSubmit = (data: AdvanceFormData) => {
    const employee = employees?.find(e => e.id === data.employeeId)
    const account = accounts?.find(a => a.id === data.accountId)
    if (!employee || !account) return

    const newAdvanceData = {
      employeeId: data.employeeId,
      amount: data.amount,
      date: data.date,
      notes: data.notes,
      accountId: data.accountId,
      employeeName: employee.name,
      accountName: account.name,
    };

    addAdvance.mutate(newAdvanceData, {
      onSuccess: () => {
        toast({ title: "Sukses", description: "Panjar berhasil dicatat." })
        reset({ date: getOfficeTime(timezone), amount: 0, employeeId: '', notes: '', accountId: '' })
      },
      onError: (error) => {
        toast({ variant: "destructive", title: "Gagal", description: error.message })
      }
    })
  }

  const handleDeleteAdvance = (advance: EmployeeAdvance) => {
    deleteAdvance.mutate(advance, {
      onSuccess: () => {
        toast({ title: "Sukses", description: "Data panjar berhasil dihapus." });
      },
      onError: (error) => {
        toast({ variant: "destructive", title: "Gagal", description: error.message });
      }
    });
  };

  const isAdminOrOwnerOrCashier = canManageCash(user);
  const isOwnerRole = isOwner(user);

  type SortConfig = { key: keyof EmployeeAdvance | 'status'; direction: 'asc' | 'desc' } | null;
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'date', direction: 'desc' });

  const [visibleColumns, setVisibleColumns] = useState({
    date: true,
    employeeName: true,
    amount: true,
    accountName: true,
    remainingAmount: true,
    status: true,
    notes: true,
    actions: true,
  });

  const handleSort = (key: keyof typeof visibleColumns) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key: key as any, direction });
  };

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sortConfig, dateFromFilter, dateToFilter]);

  const filteredAndSortedAdvances = useMemo(() => {
    if (!advances) return [];
    const query = searchQuery.toLowerCase();

    let result = advances.filter(adv => {
      const advanceDate = adv.date instanceof Date ? adv.date : new Date(adv.date)
      const fromDate = dateFromFilter ? startOfDay(parseISO(dateFromFilter)) : null
      const toDate = dateToFilter ? endOfDay(parseISO(dateToFilter)) : null
      const matchesSearch = (
        adv.employeeName.toLowerCase().includes(query) ||
        (adv.notes?.toLowerCase() || "").includes(query) ||
        (adv.accountName?.toLowerCase() || "").includes(query)
      )
      const matchesFrom = !fromDate || isSameDay(advanceDate, fromDate) || isAfter(advanceDate, fromDate)
      const matchesTo = !toDate || isSameDay(advanceDate, toDate) || isBefore(advanceDate, toDate)

      return matchesSearch && matchesFrom && matchesTo
    });

    if (sortConfig) {
      result.sort((a, b) => {
        let aValue: any = a[sortConfig.key as keyof EmployeeAdvance] || '';
        let bValue: any = b[sortConfig.key as keyof EmployeeAdvance] || '';

        if (sortConfig.key === 'status') {
          aValue = a.remainingAmount <= 0 ? 1 : 0;
          bValue = b.remainingAmount <= 0 ? 1 : 0;
        } else if (sortConfig.key === 'date') {
          aValue = new Date(a.date).getTime();
          bValue = new Date(b.date).getTime();
        }

        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return result;
  }, [advances, searchQuery, sortConfig, dateFromFilter, dateToFilter]);

  const totalPages = Math.ceil(filteredAndSortedAdvances.length / itemsPerPage);
  const paginatedAdvances = filteredAndSortedAdvances.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const totalFilteredPanjar = filteredAndSortedAdvances.reduce((sum, adv) => sum + adv.amount, 0);
  const totalFilteredSisa = filteredAndSortedAdvances.reduce((sum, adv) => sum + adv.remainingAmount, 0);
  const totalFilteredTerbayar = totalFilteredPanjar - totalFilteredSisa;

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">Gagal Memuat Data</CardTitle>
          <CardDescription>
            Terjadi kesalahan saat mengambil data panjar karyawan. Silakan coba muat ulang halaman.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Detail Error: {advancesError?.message}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <RepayAdvanceDialog open={isRepayDialogOpen} onOpenChange={setIsRepayDialogOpen} advance={selectedAdvance} />

      {isAdminOrOwnerOrCashier && (
        <Card>
          <CardHeader>
            <CardTitle>Beri Panjar Karyawan</CardTitle>
            <CardDescription>Fitur ini untuk Owner/Admin/Kasir. Catat uang muka yang diberikan kepada karyawan.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onAddAdvanceSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="employeeId">Karyawan</Label>
                  <Select onValueChange={(value) => setValue("employeeId", value)}>
                    <SelectTrigger><SelectValue placeholder="Pilih Karyawan..." /></SelectTrigger>
                    <SelectContent>{loadingUsers ? <SelectItem value="loading" disabled>Memuat...</SelectItem> : employees?.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
                  </Select>
                  {errors.employeeId && <p className="text-sm text-destructive">{errors.employeeId.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="amount">Jumlah Panjar (Rp)</Label>
                  <Input id="amount" type="number" {...register("amount")} />
                  {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="accountId">Sumber Dana</Label>
                  <Select onValueChange={(value) => setValue("accountId", value)}>
                    <SelectTrigger><SelectValue placeholder="Pilih Akun..." /></SelectTrigger>
                    <SelectContent>{loadingAccounts ? <SelectItem value="loading" disabled>Memuat...</SelectItem> : accounts?.filter(a => a.isPaymentAccount).map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                  </Select>
                  {errors.accountId && <p className="text-sm text-destructive">{errors.accountId.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="date">Tanggal {!isOwnerRole && <span className="text-xs text-muted-foreground">(Hanya Owner dapat ubah)</span>}</Label>
                  <Input
                    type="date"
                    {...register("date", {
                      setValueAs: (value: string | Date) => {
                        if (!value) return new Date();
                        if (value instanceof Date) return value;
                        if (typeof value !== 'string') return new Date();
                        const [year, month, day] = value.split('-').map(Number);
                        return new Date(year, month - 1, day, 12, 0, 0);
                      }
                    })}
                    defaultValue={format(getOfficeTime(timezone), 'yyyy-MM-dd')}
                    disabled={!isOwnerRole}
                  />
                  {errors.date && <p className="text-sm text-destructive">{errors.date.message}</p>}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Catatan</Label>
                <Textarea id="notes" {...register("notes")} />
              </div>
              <Button type="submit" disabled={addAdvance.isPending}>
                {addAdvance.isPending ? "Menyimpan..." : "Simpan Panjar"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1.5 flex-1">
            <CardTitle>
              {isViewOnly ? 'Data Panjar Saya' : 'Riwayat Panjar Karyawan'}
            </CardTitle>
            <CardDescription>
              {isViewOnly
                ? 'Berikut adalah data panjar yang pernah Anda terima'
                : 'Lihat daftar karyawan dan riwayat pengambilan panjar'
              }
            </CardDescription>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto items-start md:items-center">
            {!isViewOnly && (
              <>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="search"
                    placeholder="Cari data..."
                    className="pl-8"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className="w-full sm:w-auto">
                  <Input
                    type="date"
                    value={dateFromFilter}
                    onChange={(e) => setDateFromFilter(e.target.value)}
                  />
                </div>
                <div className="w-full sm:w-auto">
                  <Input
                    type="date"
                    value={dateToFilter}
                    onChange={(e) => setDateToFilter(e.target.value)}
                  />
                </div>
              </>
            )}
            {!isViewOnly && filteredAndSortedAdvances && (
              <EmployeeAdvancesReport
                advances={filteredAndSortedAdvances}
                titleSuffix={dateFromFilter || dateToFilter ? '(Sesuai Filter)' : ''}
              />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Columns className="mr-2 h-4 w-4" />
                  Kolom
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuCheckboxItem checked={visibleColumns.date} onCheckedChange={(c) => setVisibleColumns(p => ({ ...p, date: !!c }))}>Tanggal</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={visibleColumns.employeeName} onCheckedChange={(c) => setVisibleColumns(p => ({ ...p, employeeName: !!c }))}>Karyawan</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={visibleColumns.amount} onCheckedChange={(c) => setVisibleColumns(p => ({ ...p, amount: !!c }))}>Jumlah Panjar</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={visibleColumns.accountName} onCheckedChange={(c) => setVisibleColumns(p => ({ ...p, accountName: !!c }))}>Sumber Dana</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={visibleColumns.remainingAmount} onCheckedChange={(c) => setVisibleColumns(p => ({ ...p, remainingAmount: !!c }))}>Sisa Utang</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={visibleColumns.status} onCheckedChange={(c) => setVisibleColumns(p => ({ ...p, status: !!c }))}>Status</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={visibleColumns.notes} onCheckedChange={(c) => setVisibleColumns(p => ({ ...p, notes: !!c }))}>Catatan</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={visibleColumns.actions} onCheckedChange={(c) => setVisibleColumns(p => ({ ...p, actions: !!c }))}>Aksi</DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {isViewOnly && (
            <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg w-full">
              <p className="text-sm text-blue-800">
                <span className="font-medium">Info:</span> Anda hanya dapat melihat data panjar pribadi Anda.
                Untuk mengelola panjar karyawan lain, hubungi Admin/Owner/Kasir.
              </p>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {loadingAdvances ? (
            <div className="text-center py-4">Memuat...</div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                <div className="p-4 border rounded-xl bg-blue-50/50 dark:bg-blue-950/20">
                  <p className="text-sm font-medium text-blue-600 dark:text-blue-400 mb-1">Total Panjar</p>
                  <p className="text-2xl font-bold">{new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(totalFilteredPanjar)}</p>
                </div>
                <div className="p-4 border rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20">
                  <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400 mb-1">Total Dibayar</p>
                  <p className="text-2xl font-bold">{new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(totalFilteredTerbayar)}</p>
                </div>
                <div className="p-4 border rounded-xl bg-rose-50/50 dark:bg-rose-950/20">
                  <p className="text-sm font-medium text-rose-600 dark:text-rose-400 mb-1">Sisa Utang</p>
                  <p className="text-2xl font-bold">{new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(totalFilteredSisa)}</p>
                </div>
              </div>

              {filteredAndSortedAdvances.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground border rounded-md">
                  {isViewOnly ? 'Anda belum pernah menerima panjar' : 'Belum ada data panjar karyawan'}
                </div>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {visibleColumns.date && (
                          <TableHead>
                            <Button variant="ghost" onClick={() => handleSort('date')} className="h-8 flex items-center -ml-4 whitespace-nowrap">
                              Tanggal <ArrowUpDown className="ml-2 h-4 w-4" />
                            </Button>
                          </TableHead>
                        )}
                        {visibleColumns.employeeName && (
                          <TableHead>
                            <Button variant="ghost" onClick={() => handleSort('employeeName')} className="h-8 flex items-center -ml-4">
                              Karyawan <ArrowUpDown className="ml-2 h-4 w-4" />
                            </Button>
                          </TableHead>
                        )}
                        {visibleColumns.amount && (
                          <TableHead className="text-right">
                            <Button variant="ghost" onClick={() => handleSort('amount')} className="h-8 flex items-center justify-end -mr-4 ml-auto whitespace-nowrap">
                              Jumlah Panjar <ArrowUpDown className="ml-2 h-4 w-4" />
                            </Button>
                          </TableHead>
                        )}
                        {visibleColumns.accountName && (
                          <TableHead>
                            <Button variant="ghost" onClick={() => handleSort('accountName')} className="h-8 flex items-center -ml-4 whitespace-nowrap">
                              Sumber Dana <ArrowUpDown className="ml-2 h-4 w-4" />
                            </Button>
                          </TableHead>
                        )}
                        {visibleColumns.remainingAmount && (
                          <TableHead className="text-right">
                            <Button variant="ghost" onClick={() => handleSort('remainingAmount')} className="h-8 flex items-center justify-end -mr-4 ml-auto whitespace-nowrap">
                              Sisa Utang <ArrowUpDown className="ml-2 h-4 w-4" />
                            </Button>
                          </TableHead>
                        )}
                        {visibleColumns.status && (
                          <TableHead className="text-center">
                            <Button variant="ghost" onClick={() => handleSort('status')} className="h-8 flex items-center justify-center mx-auto">
                              Status <ArrowUpDown className="ml-2 h-4 w-4" />
                            </Button>
                          </TableHead>
                        )}
                        {visibleColumns.notes && (
                          <TableHead>
                            <Button variant="ghost" onClick={() => handleSort('notes')} className="h-8 flex items-center -ml-4">
                              Catatan <ArrowUpDown className="ml-2 h-4 w-4" />
                            </Button>
                          </TableHead>
                        )}
                        {visibleColumns.actions && <TableHead className="text-center">Aksi</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedAdvances.map((adv) => {
                        const isLunas = adv.remainingAmount <= 0;

                        return (
                          <TableRow key={adv.id}>
                            {visibleColumns.date && (
                              <TableCell>
                                <span className="font-medium text-sm whitespace-nowrap">{format(new Date(adv.date), "d MMM yyyy", { locale: id })}</span>
                              </TableCell>
                            )}
                            {visibleColumns.employeeName && (
                              <TableCell className="font-medium whitespace-nowrap">{adv.employeeName}</TableCell>
                            )}
                            {visibleColumns.amount && (
                              <TableCell className="text-right font-medium whitespace-nowrap">
                                {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(adv.amount)}
                              </TableCell>
                            )}
                            {visibleColumns.accountName && (
                              <TableCell className="whitespace-nowrap">{adv.accountName || '-'}</TableCell>
                            )}
                            {visibleColumns.remainingAmount && (
                              <TableCell className="text-right whitespace-nowrap">
                                <span className={`font-bold ${!isLunas ? 'text-destructive' : 'text-green-600'}`}>
                                  {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(adv.remainingAmount)}
                                </span>
                              </TableCell>
                            )}
                            {visibleColumns.status && (
                              <TableCell className="text-center whitespace-nowrap">
                                <Badge variant={!isLunas ? "destructive" : "success"}>
                                  {!isLunas ? 'Belum Lunas' : 'Lunas'}
                                </Badge>
                              </TableCell>
                            )}
                            {visibleColumns.notes && (
                              <TableCell className="max-w-[150px] truncate" title={adv.notes || ''}>
                                {adv.notes || '-'}
                              </TableCell>
                            )}
                            {visibleColumns.actions && (
                              <TableCell className="text-center">
                                <div className="flex items-center justify-center gap-2 flex-wrap min-w-[200px]">
                                  <Dialog>
                                    <DialogTrigger asChild>
                                      <Button variant="outline" size="sm" title="Detail Riwayat" className="h-8">
                                        <History className="h-4 w-4 mr-1" /> Detail
                                      </Button>
                                    </DialogTrigger>
                                    <DialogContent className="max-w-md">
                                      <DialogHeader>
                                        <DialogTitle>Detail Panjar</DialogTitle>
                                        <DialogDescription>{adv.employeeName} - {format(new Date(adv.date), "d MMM yyyy", { locale: id })}</DialogDescription>
                                      </DialogHeader>
                                      <div className="space-y-4 pt-2">
                                        <div className="grid grid-cols-2 gap-2 text-sm bg-muted/30 p-3 rounded-lg border">
                                          <div><span className="text-muted-foreground mr-1">Jumlah:</span><br />{new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(adv.amount)}</div>
                                          <div><span className="text-muted-foreground mr-1">Sisa:</span><br />{new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(adv.remainingAmount)}</div>
                                          <div><span className="text-muted-foreground mr-1">Sumber:</span><br />{adv.accountName || '-'}</div>
                                          <div><span className="text-muted-foreground mr-1">Status:</span><br />
                                            <Badge variant={!isLunas ? "destructive" : "success"} className="mt-1">
                                              {!isLunas ? 'Belum Lunas' : 'Lunas'}
                                            </Badge>
                                          </div>
                                        </div>
                                        <div className="mt-2">
                                          <p className="font-semibold text-sm mb-2">Riwayat Pembayaran:</p>
                                          {adv.repayments && adv.repayments.length > 0 ? (
                                            <div className="space-y-2 max-h-[30vh] overflow-y-auto pr-2">
                                              {adv.repayments.map(rep => (
                                                <div key={rep.id} className="flex justify-between items-center bg-background p-2 rounded border text-sm">
                                                  <div>
                                                    <p className="font-medium text-green-600">+{new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(rep.amount)}</p>
                                                    <p className="text-xs text-muted-foreground">{format(new Date(rep.date), "dd/MM/yyyy")}</p>
                                                  </div>
                                                  <div className="text-right">
                                                    <p className="text-xs text-muted-foreground">Pencatat</p>
                                                    <p className="font-medium">{rep.recordedBy || '-'}</p>
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          ) : (
                                            <p className="text-xs text-muted-foreground">Belum ada cicilan untuk panjar ini.</p>
                                          )}
                                          {adv.notes && (
                                            <div className="mt-4 pt-4 border-t">
                                              <p className="font-semibold text-sm mb-1">Catatan:</p>
                                              <p className="text-sm">{adv.notes}</p>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </DialogContent>
                                  </Dialog>
                                  <PanjarReceiptPDF advance={adv} />
                                  {isAdminOrOwnerOrCashier && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleOpenRepayDialog(adv)}
                                      disabled={adv.remainingAmount <= 0}
                                      className="h-8 px-2"
                                    >
                                      Bayar
                                    </Button>
                                  )}
                                  {isOwnerRole && (
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <Button variant="outline" size="sm" className="h-8 text-destructive border-destructive hover:bg-destructive hover:text-white">
                                          <Trash2 className="h-4 w-4 mr-1" /> Hapus
                                        </Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                        <AlertDialogHeader>
                                          <AlertDialogTitle>Hapus Panjar?</AlertDialogTitle>
                                          <AlertDialogDescription>
                                            Data panjar dan semua cicilannya akan dihapus permanen.
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                          <AlertDialogCancel>Batal</AlertDialogCancel>
                                          <AlertDialogAction onClick={() => handleDeleteAdvance(adv)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Ya, Hapus</AlertDialogAction>
                                        </AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  )}
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}

          {/* Pagination Controls */}
          {filteredAndSortedAdvances.length > itemsPerPage && (
            <div className="flex flex-col sm:flex-row items-center justify-between px-2 mt-4 pt-4 border-t gap-4">
              <div className="text-xs text-muted-foreground">
                Menampilkan {filteredAndSortedAdvances.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, filteredAndSortedAdvances.length)} dari {filteredAndSortedAdvances.length} data
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  Sebelumnya
                </Button>
                <div className="text-xs font-medium border px-3 py-1.5 rounded-md bg-muted/50">
                  {currentPage} / {totalPages || 1}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages || totalPages === 0}
                >
                  Selanjutnya
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}