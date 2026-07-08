import { useState, useRef } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useExpenses } from "@/hooks/useExpenses"
import { useAccounts } from "@/hooks/useAccounts"
import { useToast } from "@/components/ui/use-toast"
import { useAuth } from "@/hooks/useAuth"
import { useTimezone } from "@/contexts/TimezoneContext"
import { getOfficeTime, getOfficeDateString } from "@/utils/officeTime"
import { Loader2, Plus, History, Camera, Image as ImageIcon, X, Trash2 } from "lucide-react"
import { format } from "date-fns"
import { id } from "date-fns/locale/id"
import { Badge } from "@/components/ui/badge"
import { formatNumber } from "@/utils/formatNumber"
import { useNavigate } from "react-router-dom"
import { PhotoUploadService } from "@/services/photoUploadService"
import { compressImage, isImageFile } from "@/utils/imageCompression"
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog"

const expenseSchema = z.object({
    description: z.string().min(3, "Deskripsi minimal 3 karakter."),
    amount: z.coerce.number().min(1, "Jumlah harus lebih dari 0."),
    accountId: z.string().min(1, "Pilih akun pembayaran."),
    expenseAccountId: z.string().min(1, "Pilih akun beban."),
})

type ExpenseFormData = z.infer<typeof expenseSchema>

export default function MobileExpensePage() {
    const { expenses, isLoading: isLoadingExpenses, addExpense } = useExpenses()
    const { accounts, isLoading: isLoadingAccounts } = useAccounts()
    const { toast } = useToast()
    const { user } = useAuth()
    const { timezone } = useTimezone()
    const navigate = useNavigate()

    // Photo State
    const [photo, setPhoto] = useState<File | null>(null)
    const [photoPreview, setPhotoPreview] = useState<string | null>(null)
    const [isUploading, setIsUploading] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // PERMISSION CHECK
    const allowedRoles = ['admin', 'owner', 'cashier'];
    if (user && !allowedRoles.includes(user.role)) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen p-4">
                <h2 className="text-xl font-bold text-destructive">Akses Ditolak</h2>
                <p className="text-muted-foreground mt-2">Anda tidak memiliki izin untuk mengakses halaman ini.</p>
                <Button className="mt-4" onClick={() => navigate('/')}>Kembali ke Home</Button>
            </div>
        )
    }

    const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<ExpenseFormData>({
        resolver: zodResolver(expenseSchema),
        defaultValues: {
            description: "",
            amount: 0,
            accountId: "",
            expenseAccountId: "",
        }
    })

    // Watch Amount
    const watchAmount = watch("amount")
    const [displayAmount, setDisplayAmount] = useState("")

    // Filter Accounts
    const expenseAccounts = accounts?.filter(a => a.type === 'Beban' && !a.isHeader) || [];
    const paymentAccounts = accounts?.filter(a => a.isPaymentAccount) || [];

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

    const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        if (!isImageFile(file)) {
            toast({ variant: "destructive", title: "Error", description: "File harus berupa gambar" })
            return
        }

        // Limit 10MB original
        if (file.size > 10 * 1024 * 1024) {
            toast({ variant: "destructive", title: "Error", description: "Ukuran file maksimal 10MB" })
            return
        }

        try {
            const compressed = await compressImage(file, 100) // Max 100KB target
            setPhoto(compressed)

            // Preview
            const reader = new FileReader()
            reader.onload = (e) => setPhotoPreview(e.target?.result as string)
            reader.readAsDataURL(compressed)
        } catch (err) {
            console.error("Compression error:", err)
            toast({ variant: "destructive", title: "Error", description: "Gagal memproses gambar" })
        }
    }

    const removePhoto = () => {
        setPhoto(null)
        setPhotoPreview(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    const onSubmit = async (data: ExpenseFormData) => {
        if (!photo) {
            toast({ variant: "destructive", title: "Foto Wajib", description: "Mohon sertakan foto bukti pengeluaran." })
            return;
        }

        const paymentAccount = accounts?.find(a => a.id === data.accountId)
        const expenseAccount = accounts?.find(a => a.id === data.expenseAccountId)
        if (!paymentAccount || !expenseAccount) return

        setIsUploading(true)
        let photoUrl = ''

        try {
            // 1. Upload Photo
            const uploadResult = await PhotoUploadService.uploadPhoto(
                photo,
                `EXP-${Date.now()}`,
                'expenses'
            )
            photoUrl = uploadResult.webViewLink

            // 2. Create Expense
            const newExpenseData = {
                description: data.description,
                amount: data.amount,
                accountId: data.accountId,
                accountName: paymentAccount.name,
                expenseAccountId: data.expenseAccountId,
                expenseAccountName: expenseAccount.name,
                date: getOfficeTime(timezone),
                category: expenseAccount.name,
                photoUrl: photoUrl
            };

            addExpense.mutate(newExpenseData, {
                onSuccess: () => {
                    toast({
                        title: "Sukses",
                        description: `Pengeluaran Rp ${formatNumber(data.amount)} berhasil dicatat`
                    })
                    // Reset Form
                    reset({ description: "", amount: 0, accountId: data.accountId, expenseAccountId: "" })
                    setDisplayAmount("")
                    removePhoto()
                    setIsUploading(false)
                },
                onError: (error) => {
                    setIsUploading(false)
                    toast({ variant: "destructive", title: "Gagal Simpan", description: error.message })
                }
            })
        } catch (error: any) {
            setIsUploading(false)
            console.error("Upload error:", error)
            toast({ variant: "destructive", title: "Gagal Upload", description: "Gagal mengupload foto bukti: " + error.message })
        }
    }

    // Filter Recent Expenses (Today)
    const todayStr = getOfficeDateString(timezone);
    const todaysExpenses = expenses?.filter(e => {
        const expenseDate = e.date instanceof Date ? e.date : new Date(e.date);
        const expenseDateStr = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(expenseDate);
        return expenseDateStr === todayStr;
    }) || [];
    const todaysTotal = todaysExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);


    return (
        <div className="min-h-screen bg-slate-50 pb-20">
            {/* Header */}
            <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 shadow-md">
                <h1 className="text-lg font-bold">Input Pengeluaran</h1>
                <p className="text-xs opacity-90">{user?.role === 'admin' ? 'Administrator' : user?.role === 'owner' ? 'Owner' : 'Kasir'}</p>
            </div>

            <div className="p-4 space-y-6">

                {/* Input Card */}
                <Card className="shadow-sm border-none">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Plus className="h-4 w-4 bg-primary text-white rounded-full p-0.5" />
                            Catat Pengeluaran Baru
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

                            {/* Jumlah */}
                            <div className="space-y-1">
                                <Label htmlFor="amount" className="text-xs text-muted-foreground">Jumlah (Rp)</Label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-semibold">Rp</span>
                                    <Input
                                        id="amount"
                                        value={displayAmount}
                                        onChange={handleAmountChange}
                                        placeholder="0"
                                        className="pl-10 text-lg font-semibold h-12"
                                        inputMode="numeric"
                                    />
                                </div>
                                {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
                            </div>

                            {/* Akun Beban */}
                            <div className="space-y-1">
                                <Label htmlFor="expenseAccount" className="text-xs text-muted-foreground">Untuk Keperluan (Akun Beban)</Label>
                                <Select onValueChange={(val) => setValue("expenseAccountId", val)} value={watch("expenseAccountId")}>
                                    <SelectTrigger className="h-10">
                                        <SelectValue placeholder="Pilih Akun Beban" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {/* Suggest Common Expenses first if needed, otherwise list all */}
                                        {expenseAccounts.map(acc => (
                                            <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {errors.expenseAccountId && <p className="text-xs text-destructive">{errors.expenseAccountId.message}</p>}
                            </div>

                            {/* Sumber Dana */}
                            <div className="space-y-1">
                                <Label htmlFor="paymentAccount" className="text-xs text-muted-foreground">Sumber Dana (Bayar Pakai)</Label>
                                <Select onValueChange={(val) => setValue("accountId", val)} value={watch("accountId")}>
                                    <SelectTrigger className="h-10">
                                        <SelectValue placeholder="Pilih Sumber Dana" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {paymentAccounts.map(acc => (
                                            <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {errors.accountId && <p className="text-xs text-destructive">{errors.accountId.message}</p>}
                            </div>

                            {/* Photo Input */}
                            <div className="space-y-2">
                                <Label className="text-xs text-muted-foreground">Bukti Foto / Nota (Wajib)</Label>
                                <input
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    className="hidden"
                                    ref={fileInputRef}
                                    onChange={handlePhotoCapture}
                                />

                                {!photoPreview ? (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="w-full h-24 border-dashed border-2 flex flex-col gap-2 hover:bg-slate-50"
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        <Camera className="h-8 w-8 text-muted-foreground" />
                                        <span className="text-xs text-muted-foreground">Ambil Foto / Pilih Gambar</span>
                                    </Button>
                                ) : (
                                    <div className="relative w-full h-48 bg-slate-100 rounded-lg overflow-hidden border">
                                        <img src={photoPreview} alt="Bukti" className="w-full h-full object-contain" />
                                        <Button
                                            type="button"
                                            variant="destructive"
                                            size="icon"
                                            className="absolute top-2 right-2 h-8 w-8 rounded-full shadow-md"
                                            onClick={removePhoto}
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                        <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] p-1 text-center truncate">
                                            {photo?.name} ({(photo?.size || 0) / 1024 < 1000 ? `${((photo?.size || 0) / 1024).toFixed(0)} KB` : `${((photo?.size || 0) / 1024 / 1024).toFixed(1)} MB`})
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Deskripsi */}
                            <div className="space-y-1">
                                <Label htmlFor="desc" className="text-xs text-muted-foreground">Keterangan Detail</Label>
                                <Input id="desc" {...register("description")} placeholder="Contoh: Beli bensin, ATK..." className="h-10" />
                                {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
                            </div>

                            <Button type="submit" className="w-full h-12 text-md mt-2" disabled={addExpense.isPending}>
                                {addExpense.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Simpan Pengeluaran"}
                            </Button>

                        </form>
                    </CardContent>
                </Card>

                {/* Recent History */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                        <h3 className="font-semibold text-sm flex items-center gap-2">
                            <History className="h-4 w-4 text-muted-foreground" /> Riwayat Hari Ini
                        </h3>
                        <Badge variant="outline" className="bg-white">Total: Rp {formatNumber(todaysTotal)}</Badge>
                    </div>

                    <div className="space-y-2">
                        {isLoadingExpenses ? (
                            <div className="text-center py-4 text-muted-foreground text-sm">Memuat data...</div>
                        ) : todaysExpenses.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground text-sm bg-white rounded-lg border border-dashed">
                                Belum ada pengeluaran hari ini.
                            </div>
                        ) : (
                            todaysExpenses.map(exp => (
                                <div key={exp.id} className="bg-white p-3 rounded-lg shadow-sm border border-slate-100 flex justify-between items-center">
                                    <div className="overflow-hidden flex-1">
                                        <p className="font-medium text-sm truncate">{exp.description}</p>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                                            <Badge variant="secondary" className="text-[10px] h-4 px-1">{exp.expenseAccountName}</Badge>
                                            <span>•</span>
                                            <span>{format(new Date(exp.date), "HH:mm")}</span>
                                        </div>
                                        {exp.photoUrl && (
                                            <Dialog>
                                                <DialogTrigger asChild>
                                                    <Button variant="link" size="sm" className="h-auto p-0 text-[10px] text-blue-600 mt-1 flex items-center gap-1">
                                                        <ImageIcon className="h-3 w-3" /> Lihat Bukti
                                                    </Button>
                                                </DialogTrigger>
                                                <DialogContent className="p-0 border-0 bg-black/90 max-w-sm mx-auto">
                                                    <div className="relative w-full h-[80vh] flex items-center justify-center">
                                                        <img
                                                            src={exp.photoUrl.startsWith('http') ? exp.photoUrl : PhotoUploadService.getPhotoUrl(exp.photoUrl, 'expenses')}
                                                            alt="Bukti"
                                                            className="max-w-full max-h-full object-contain"
                                                        />
                                                    </div>
                                                </DialogContent>
                                            </Dialog>
                                        )}
                                    </div>
                                    <div className="text-right whitespace-nowrap pl-2">
                                        <p className="font-bold text-sm text-red-600">-Rp {formatNumber(exp.amount)}</p>
                                        <p className="text-[10px] text-muted-foreground">{exp.accountName}</p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

            </div>
        </div >
    )
}
