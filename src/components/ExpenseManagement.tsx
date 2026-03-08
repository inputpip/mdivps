import { useState, useEffect, useRef } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useExpenses } from "@/hooks/useExpenses"
import { useAccounts } from "@/hooks/useAccounts"
import { useToast } from "./ui/use-toast"
import { DateTimePicker } from "./ui/datetime-picker"
import { format } from "date-fns"
import { id } from "date-fns/locale/id"
import { useAuth } from "@/hooks/useAuth"
import { canManageCash } from '@/utils/roleUtils'
import { Trash2, Check, ChevronsUpDown, Filter, X, Search, FileDown, Image as ImageIcon, Loader2 } from "lucide-react"
import * as XLSX from "xlsx"
import { ExpenseReceiptPDF } from "./ExpenseReceiptPDF"
import { Badge } from "./ui/badge"
import { cn } from "@/lib/utils"
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { formatNumber, parseFormattedNumber } from "@/utils/formatNumber"
import { PhotoUploadService } from "@/services/photoUploadService"
import { compressImage, isImageFile } from "@/utils/imageCompression"

const expenseSchema = z.object({
  description: z.string().min(3, "Deskripsi minimal 3 karakter."),
  amount: z.coerce.number().min(1, "Jumlah harus lebih dari 0."),
  accountId: z.string().min(1, "Pilih akun pembayaran."),
  date: z.date({ required_error: "Tanggal harus diisi." }),
  expenseAccountId: z.string().min(1, "Pilih akun beban."),
})

type ExpenseFormData = z.infer<typeof expenseSchema>

export function ExpenseManagement() {
  const { expenses, isLoading: isLoadingExpenses, addExpense, deleteExpense } = useExpenses()
  const { accounts, isLoading: isLoadingAccounts } = useAccounts()
  const { toast } = useToast()
  const { user } = useAuth()
  const { timezone } = useTimezone()
  const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<ExpenseFormData>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      description: "",
      amount: 0,
      accountId: "",
      date: getOfficeTime(timezone),
      expenseAccountId: "",
    }
  })

  // Watch amount & state
  const watchAmount = watch("amount")
  const [displayAmount, setDisplayAmount] = useState("")

  // Photo State
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null) // For table modal
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  // Sync display amount
  useEffect(() => {
    const currentParsed = displayAmount ? parseFormattedNumber(displayAmount) : 0;
    if (watchAmount !== currentParsed) {
      setDisplayAmount(watchAmount ? formatNumber(watchAmount) : "");
    }
  }, [watchAmount])

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    const cleanValue = value.replace(/[^0-9]/g, '')
    if (cleanValue === '') {
      setDisplayAmount('')
      setValue('amount', 0)
      return
    }
    const num = parseInt(cleanValue, 10)
    if (!isNaN(num)) {
      setDisplayAmount(formatNumber(num))
      setValue('amount', num)
    }
  }

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!isImageFile(file)) {
      toast({ variant: "destructive", title: "Error", description: "File harus berupa gambar (JPG/PNG)" })
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({ variant: "destructive", title: "Error", description: "Ukuran file maksimal 10MB" })
      return
    }

    try {
      const compressed = await compressImage(file, 100)
      setPhoto(compressed)
      const reader = new FileReader()
      reader.onload = (e) => setPhotoPreview(e.target?.result as string)
      reader.readAsDataURL(compressed)
    } catch (err) {
      console.error(err)
      toast({ variant: "destructive", title: "Gagal", description: "Gagal memproses gambar" })
    }
  }

  const removePhoto = () => {
    setPhoto(null)
    setPhotoPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const watchDate = watch("date")
  const watchExpenseAccountId = watch("expenseAccountId")
  const canDeleteExpense = canManageCash(user);
  const [expenseAccountOpen, setExpenseAccountOpen] = useState(false);

  // Filters logic...
  const [filterStartDate, setFilterStartDate] = useState<Date | undefined>(undefined);
  const [filterEndDate, setFilterEndDate] = useState<Date | undefined>(undefined);
  const [filterExpenseAccountId, setFilterExpenseAccountId] = useState<string>("all");
  const [filterPaymentAccountId, setFilterPaymentAccountId] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Pagination logic
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterStartDate, filterEndDate, filterExpenseAccountId, filterPaymentAccountId]);

  const expenseAccounts = accounts?.filter(a => a.type === 'Beban' && !a.isHeader) || [];
  const paymentAccounts = accounts?.filter(a => a.isPaymentAccount) || [];
  const selectedExpenseAccount = expenseAccounts.find(a => a.id === watchExpenseAccountId);

  const onSubmit = async (data: ExpenseFormData) => {
    if (!photo) {
      toast({ variant: "destructive", title: "Foto Wajib", description: "Mohon sertakan bukti foto/nota." })
      return
    }

    const paymentAccount = accounts?.find(a => a.id === data.accountId)
    const expenseAccount = accounts?.find(a => a.id === data.expenseAccountId)
    if (!paymentAccount || !expenseAccount) return

    setIsUploading(true)
    let photoUrl = ""

    try {
      // Upload
      const result = await PhotoUploadService.uploadPhoto(photo, `EXP-${Date.now()}`, 'expenses')
      photoUrl = result.webViewLink

      const newExpenseData = {
        description: data.description,
        amount: data.amount,
        accountId: data.accountId, // Payment account (kas/bank)
        accountName: paymentAccount.name,
        expenseAccountId: data.expenseAccountId,
        expenseAccountName: expenseAccount.name,
        date: data.date,
        category: expenseAccount.name,
        photoUrl: photoUrl // Added
      };

      addExpense.mutate(newExpenseData, {
        onSuccess: () => {
          toast({
            title: "Sukses",
            description: `Pengeluaran berhasil dicatat ke ${expenseAccount.name}`
          })
          reset({ date: getOfficeTime(timezone), description: "", amount: 0, accountId: "", expenseAccountId: "" })
          setDisplayAmount("")
          removePhoto()
          setIsUploading(false)
        },
        onError: (error) => {
          setIsUploading(false)
          toast({ variant: "destructive", title: "Gagal", description: error.message })
        }
      })
    } catch (error: any) {
      setIsUploading(false)
      console.error("Submit error:", error)
      toast({ variant: "destructive", title: "Error Upload", description: "Gagal upload foto: " + error.message })
    }
  }

  const handleDelete = (expenseId: string) => {
    deleteExpense.mutate(expenseId, {
      onSuccess: () => {
        toast({ title: "Sukses", description: "Pengeluaran berhasil dihapus." })
      },
      onError: (error) => {
        toast({ variant: "destructive", title: "Gagal", description: error.message })
      }
    })
  }

  // Filter expenses logic...
  const filteredExpenses = expenses?.filter(exp => {
    // ... same filter logic as before
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchDescription = exp.description?.toLowerCase().includes(query);
      const matchAccount = exp.expenseAccountName?.toLowerCase().includes(query) || exp.category?.toLowerCase().includes(query);
      const matchSource = exp.accountName?.toLowerCase().includes(query);
      if (!matchDescription && !matchAccount && !matchSource) return false;
    }
    if (filterStartDate) {
      const expDate = new Date(exp.date);
      expDate.setHours(0, 0, 0, 0);
      const startDate = new Date(filterStartDate);
      startDate.setHours(0, 0, 0, 0);
      if (expDate < startDate) return false;
    }
    if (filterEndDate) {
      const expDate = new Date(exp.date);
      expDate.setHours(23, 59, 59, 999);
      const endDate = new Date(filterEndDate);
      endDate.setHours(23, 59, 59, 999);
      if (expDate > endDate) return false;
    }
    if (filterExpenseAccountId && filterExpenseAccountId !== "all" && exp.expenseAccountId !== filterExpenseAccountId) return false;
    if (filterPaymentAccountId && filterPaymentAccountId !== "all" && exp.accountId !== filterPaymentAccountId) return false;
    return true;
  }) || [];

  const totalPages = Math.ceil(filteredExpenses.length / itemsPerPage);
  const paginatedExpenses = filteredExpenses.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const totalFilteredAmount = filteredExpenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
  const totalAllAmount = expenses?.reduce((sum, exp) => sum + (exp.amount || 0), 0) || 0;

  const clearFilters = () => {
    setFilterStartDate(undefined);
    setFilterEndDate(undefined);
    setFilterExpenseAccountId("all");
    setFilterPaymentAccountId("all");
    setSearchQuery("");
  };

  const hasActiveFilters = searchQuery || filterStartDate || filterEndDate || (filterExpenseAccountId && filterExpenseAccountId !== "all") || (filterPaymentAccountId && filterPaymentAccountId !== "all");

  const exportToExcel = () => {
    const dataToExport = filteredExpenses.map(exp => {
      const sumberDana = exp.accountName || paymentAccounts.find(a => a.id === exp.accountId)?.name || '-';
      return {
        'Tanggal': format(new Date(exp.date), "dd/MM/yyyy HH:mm", { locale: id }),
        'Deskripsi': exp.description,
        'Akun Beban': exp.expenseAccountName || exp.category,
        'Sumber Dana': sumberDana,
        'Jumlah': exp.amount,
        'Ada Bukti': exp.photoUrl ? 'Ya' : 'Tidak'
      };
    });
    // ... rest of export logic same
    dataToExport.push({
      'Tanggal': '',
      'Deskripsi': 'TOTAL',
      'Akun Beban': '',
      'Sumber Dana': '',
      'Jumlah': totalFilteredAmount,
      'Ada Bukti': ''
    });

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    ws['!cols'] = [{ wch: 18 }, { wch: 40 }, { wch: 25 }, { wch: 20 }, { wch: 15 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pengeluaran");
    const dateStr = format(new Date(), "yyyy-MM-dd");
    const filterStr = hasActiveFilters ? "_filtered" : "";
    XLSX.writeFile(wb, `Pengeluaran${filterStr}_${dateStr}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Catat Pengeluaran Baru</CardTitle>
          <CardDescription>Catat semua pengeluaran operasional perusahaan di sini.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="description">Deskripsi</Label>
                <Input id="description" {...register("description")} placeholder="Keterangan pengeluaran..." />
                {errors.description && <p className="text-sm text-destructive">{errors.description.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="amount">Jumlah (Rp)</Label>
                <Input
                  id="amount"
                  value={displayAmount}
                  onChange={handleAmountChange}
                  placeholder="0"
                  autoComplete="off"
                />
                {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="expenseAccountId">Akun Beban</Label>
                <Popover open={expenseAccountOpen} onOpenChange={setExpenseAccountOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={expenseAccountOpen}
                      className="w-full justify-between font-normal"
                    >
                      {selectedExpenseAccount
                        ? (selectedExpenseAccount.code ? `${selectedExpenseAccount.code} - ${selectedExpenseAccount.name}` : selectedExpenseAccount.name)
                        : "Pilih akun beban..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0">
                    <Command>
                      <CommandInput placeholder="Cari akun beban..." />
                      <CommandList>
                        <CommandEmpty>Akun tidak ditemukan.</CommandEmpty>
                        <CommandGroup>
                          {isLoadingAccounts ? (
                            <CommandItem disabled>Memuat...</CommandItem>
                          ) : (
                            expenseAccounts.map(acc => (
                              <CommandItem
                                key={acc.id}
                                value={acc.code ? `${acc.code} ${acc.name}` : acc.name}
                                onSelect={() => {
                                  setValue("expenseAccountId", acc.id);
                                  setExpenseAccountOpen(false);
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    watchExpenseAccountId === acc.id ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                {acc.code ? `${acc.code} - ${acc.name}` : acc.name}
                              </CommandItem>
                            ))
                          )}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {errors.expenseAccountId && <p className="text-sm text-destructive">{errors.expenseAccountId.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="date">Tanggal</Label>
                <DateTimePicker date={watchDate} setDate={(d) => setValue("date", d || getOfficeTime(timezone))} />
                {errors.date && <p className="text-sm text-destructive">{errors.date.message}</p>}
              </div>
            </div>

            {/* Row 2: Payment Account & Photo Upload */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="accountId">Dibayar Dari Akun</Label>
                <Select onValueChange={(value) => setValue("accountId", value)}>
                  <SelectTrigger><SelectValue placeholder="Pilih akun..." /></SelectTrigger>
                  <SelectContent>
                    {isLoadingAccounts ? <SelectItem value="loading" disabled>Memuat...</SelectItem> :
                      accounts?.filter(a => a.isPaymentAccount).map(acc => (
                        <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {errors.accountId && <p className="text-sm text-destructive">{errors.accountId.message}</p>}
              </div>

              {/* Photo Input */}
              <div className="space-y-2">
                <Label>Bukti Foto / Nota (Wajib)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoChange}
                    className="cursor-pointer file:cursor-pointer"
                    ref={fileInputRef}
                    disabled={isUploading}
                  />
                  {photoPreview && (
                    <Button type="button" variant="destructive" size="icon" onClick={removePhoto} title="Hapus Foto">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {photoPreview && (
                  <div className="mt-2 relative w-32 h-32 border rounded-lg overflow-hidden">
                    <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>
            </div>

            <Button type="submit" disabled={addExpense.isPending || isUploading}>
              {isUploading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Mengupload Foto...</> :
                addExpense.isPending ? "Menyimpan..." : "Simpan Pengeluaran"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4">
          {/* ... Summary & Filters (kept same) ... */}
          <div className="flex flex-row items-center justify-between">
            <CardTitle>Riwayat Pengeluaran</CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={exportToExcel}
                disabled={filteredExpenses.length === 0}
              >
                <FileDown className="h-4 w-4 mr-2" />
                Export Excel
              </Button>
              <Button
                variant={showFilters ? "default" : "outline"}
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter className="h-4 w-4 mr-2" />
                Filter
                {hasActiveFilters && <Badge variant="secondary" className="ml-2">Aktif</Badge>}
              </Button>
            </div>
          </div>

          {/* ... Search & Total Summary (kept same) ... */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Cari pengeluaran (deskripsi, akun, sumber dana)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <div className="bg-muted/50 rounded-lg px-4 py-2">
              <span className="text-muted-foreground">Total {hasActiveFilters ? 'Filter' : 'Semua'}: </span>
              <span className="font-semibold text-foreground">
                {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(totalFilteredAmount)}
              </span>
              <span className="text-muted-foreground ml-1">({filteredExpenses.length} transaksi)</span>
            </div>
          </div>

        </CardHeader>
        <CardContent>
          {/* ... Filter Section (kept same, assuming it's part of your requirement to keep it) ... */}
          {showFilters && (
            <div className="mb-4 p-4 border rounded-lg bg-slate-50 space-y-4 shadow-inner">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-sm text-slate-700">Filter Pencarian</h3>
                <Button variant="ghost" size="sm" onClick={clearFilters} className="text-red-500 hover:text-red-700 h-8">
                  <X className="h-4 w-4 mr-1" /> Reset Filter
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Date Range */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Dari Tanggal</Label>
                  <DateTimePicker
                    date={filterStartDate}
                    setDate={setFilterStartDate}
                    placeholder="Pilih tanggal awal"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Sampai Tanggal</Label>
                  <DateTimePicker
                    date={filterEndDate}
                    setDate={setFilterEndDate}
                    placeholder="Pilih tanggal akhir"
                  />
                </div>

                {/* Account Filters */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Akun Beban</Label>
                  <Select value={filterExpenseAccountId} onValueChange={setFilterExpenseAccountId}>
                    <SelectTrigger className="h-10 bg-white">
                      <SelectValue placeholder="Semua Akun Beban" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua Akun Beban</SelectItem>
                      {expenseAccounts.map(acc => (
                        <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Sumber Dana</Label>
                  <Select value={filterPaymentAccountId} onValueChange={setFilterPaymentAccountId}>
                    <SelectTrigger className="h-10 bg-white">
                      <SelectValue placeholder="Semua Sumber Dana" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua Sumber Dana</SelectItem>
                      {paymentAccounts.map(acc => (
                        <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal</TableHead>
                <TableHead>Deskripsi</TableHead>
                <TableHead>Akun</TableHead>
                <TableHead>Sumber Dana</TableHead>
                <TableHead className="text-right">Jumlah</TableHead>
                <TableHead className="text-center">Bukti</TableHead>
                <TableHead className="text-center">Kwitansi</TableHead>
                {canDeleteExpense && <TableHead className="text-right">Aksi</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingExpenses ? <TableRow><TableCell colSpan={8}>Memuat...</TableCell></TableRow> :
                filteredExpenses.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      {hasActiveFilters ? 'Tidak ada pengeluaran yang sesuai filter' : 'Belum ada pengeluaran'}
                    </TableCell>
                  </TableRow>
                ) :
                  paginatedExpenses.map(exp => {
                    const isDebtPayment = exp.category === 'Pembayaran Hutang';
                    const sumberDana = exp.accountName || paymentAccounts.find(a => a.id === exp.accountId)?.name || '-';
                    return (
                      <TableRow key={exp.id}>
                        <TableCell>
                          <div>{format(new Date(exp.date), "d MMM yyyy", { locale: id })}</div>
                          <div className="text-xs text-muted-foreground">{format(new Date(exp.date), "HH:mm")}</div>
                        </TableCell>
                        <TableCell className="font-medium">{exp.description}</TableCell>
                        <TableCell>
                          <Badge
                            variant={isDebtPayment ? "outline" : "secondary"}
                            className={`w-fit ${isDebtPayment ? 'bg-blue-50 text-blue-700 border-blue-200' : ''}`}
                          >
                            {exp.expenseAccountName || exp.category}
                          </Badge>
                        </TableCell>
                        <TableCell>{sumberDana}</TableCell>
                        <TableCell className="text-right">{new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(exp.amount)}</TableCell>
                        <TableCell className="text-center">
                          {exp.photoUrl ? (
                            <Button variant="ghost" size="sm" onClick={() => {
                              setPreviewImageUrl(exp.photoUrl!.startsWith('http') ? exp.photoUrl! : PhotoUploadService.getPhotoUrl(exp.photoUrl!, 'expenses'))
                              setIsPreviewOpen(true)
                            }}>
                              <ImageIcon className="h-4 w-4 text-blue-600" />
                            </Button>
                          ) : <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell className="text-center">
                          {!isDebtPayment && <ExpenseReceiptPDF expense={exp} />}
                          {isDebtPayment && <span className="text-xs text-muted-foreground">-</span>}
                        </TableCell>
                        {canDeleteExpense && (
                          <TableCell className="text-right">
                            {!isDebtPayment ? (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon">
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Hapus Pengeluaran?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Data akan dihapus permanen dan jurnal dibatalkan.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Batal</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => handleDelete(exp.id)}
                                      className="bg-destructive text-destructive-foreground"
                                    >
                                      Hapus
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })
              }
            </TableBody>
          </Table>

          {/* Pagination Controls */}
          {filteredExpenses.length > itemsPerPage && (
            <div className="flex flex-col sm:flex-row items-center justify-between px-2 mt-4 pt-4 border-t gap-4">
              <div className="text-xs text-muted-foreground">
                Menampilkan {filteredExpenses.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, filteredExpenses.length)} dari {filteredExpenses.length} data
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

      {/* Image Preview Dialog */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Bukti Pengeluaran</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center p-4 bg-slate-100 rounded-lg min-h-[300px]">
            {previewImageUrl && (
              <img
                src={previewImageUrl}
                alt="Bukti Pengeluaran"
                className="max-w-full max-h-[70vh] object-contain shadow-md rounded"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}