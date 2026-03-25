import { useState, useRef, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useCustomers } from "@/hooks/useCustomers"
import { useTransactions } from "@/hooks/useTransactions"
import { useToast } from "@/components/ui/use-toast"
import { useAuth } from "@/hooks/useAuth"
import { useBranch } from "@/contexts/BranchContext"
import { useAccounts } from "@/hooks/useAccounts"
import { Loader2, Camera, X, MapPin, Search, CheckCircle2, CreditCard, History, Navigation } from "lucide-react"
import { format } from "date-fns"
import { PhotoUploadService } from "@/services/photoUploadService"
import { compressImage, isImageFile } from "@/utils/imageCompression"
import { formatNumber } from "@/utils/formatNumber"
import { supabase } from "@/integrations/supabase/client"
import { PayReceivableDialog } from "@/components/PayReceivableDialog"
import { Transaction } from "@/types/transaction"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { MobilePosForm } from "@/components/MobilePosForm"

const salesReportSchema = z.object({
    customerId: z.string().min(1, "Pilih pelanggan."),
    notes: z.string().min(3, "Catatan minimal 3 karakter."),
    latitude: z.number({ required_error: "Lokasi wajib diambil" }),
    longitude: z.number({ required_error: "Lokasi wajib diambil" }),
    photo: z.any().refine((file) => file instanceof File, "Foto wajib diunggah"),
})

type SalesReportFormData = z.infer<typeof salesReportSchema>

export default function MobileSalesReportPage() {
    const { customers, isLoading: isLoadingCustomers } = useCustomers()
    const { transactions } = useTransactions()
    const { user } = useAuth()
    const { currentBranch } = useBranch()
    const { toast } = useToast()

    const [photo, setPhoto] = useState<File | null>(null)
    const [photoPreview, setPhotoPreview] = useState<string | null>(null)
    const [isUploading, setIsUploading] = useState(false)
    const [location, setLocation] = useState<{ lat: number, lng: number } | null>(null)
    const [isLocating, setIsLocating] = useState(false)
    const [searchQuery, setSearchQuery] = useState("")
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
    const [isPayDialogOpen, setIsPayDialogOpen] = useState(false)
    const [isPosModalOpen, setIsPosModalOpen] = useState(false)
    const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null)

    const fileInputRef = useRef<HTMLInputElement>(null)

    const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<SalesReportFormData>({
        resolver: zodResolver(salesReportSchema),
        defaultValues: {
            customerId: "",
            notes: "",
            latitude: undefined,
            longitude: undefined,
        }
    })

    // Get GPS Location
    const getGPS = () => {
        setIsLocating(true)
        if (!navigator.geolocation) {
            toast({ variant: "destructive", title: "GPS Error", description: "Browser tidak mendukung GPS" })
            setIsLocating(false)
            return
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
                setLocation(loc)
                setValue("latitude", loc.lat)
                setValue("longitude", loc.lng)
                setIsLocating(false)
                toast({ title: "GPS Berhasil", description: "Lokasi berhasil dikunci" })
            },
            (err) => {
                console.error(err)
                toast({ variant: "destructive", title: "GPS Error", description: "Gagal mengambil lokasi: " + err.message })
                setIsLocating(false)
            },
            { enableHighAccuracy: true, timeout: 10000 }
        )
    }

    const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        if (!isImageFile(file)) {
            toast({ variant: "destructive", title: "Error", description: "File harus berupa gambar" })
            return
        }
        try {
            const compressed = await compressImage(file, 200)
            setPhoto(compressed)
            setValue("photo", compressed, { shouldValidate: true })
            const reader = new FileReader()
            reader.onload = (e) => setPhotoPreview(e.target?.result as string)
            reader.readAsDataURL(compressed)
        } catch (err) {
            toast({ variant: "destructive", title: "Error", description: "Gagal memproses gambar" })
        }
    }

    const removePhoto = () => {
        setPhoto(null)
        setPhotoPreview(null)
        setValue("photo", null)
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    const onSubmit = async (data: SalesReportFormData) => {
        setIsUploading(true)
        let photoUrl = ''

        try {
            if (photo) {
                const customerName = selectedCustomer?.name || 'UMUM'
                const tanggal = format(new Date(), 'yyyyMMdd_HHmmss')
                const exactFilename = `KUNJUNGAN - ${customerName} - ${tanggal}`

                const uploadResult = await PhotoUploadService.uploadPhoto(
                    photo,
                    exactFilename,
                    'visits',
                    true
                )
                photoUrl = uploadResult.webViewLink
            } else {
                throw new Error("Foto wajib diunggah")
            }

            // Save Report to database (using Supabase directly for now)
            const { error } = await supabase
                .from('sales_visit_reports')
                .insert({
                    branch_id: currentBranch?.id,
                    sales_id: user?.id,
                    customer_id: data.customerId,
                    notes: data.notes,
                    latitude: data.latitude,
                    longitude: data.longitude,
                    photo_url: photoUrl,
                    created_by: user?.id
                })

            if (error) throw error

            toast({
                title: "Sukses",
                description: "Laporan kunjungan berhasil disimpan"
            })
            reset()
            removePhoto()
            setLocation(null)
            setSelectedCustomerId(null)
        } catch (error: any) {
            toast({ variant: "destructive", title: "Gagal", description: error.message })
        } finally {
            setIsUploading(false)
        }
    }

    const filteredCustomers = customers?.filter(c =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.phone && c.phone.toLowerCase().includes(searchQuery.toLowerCase()))
    ).slice(0, 10) || []

    const selectedCustomer = customers?.find(c => c.id === selectedCustomerId)
    const customerReceivables = transactions?.filter(t =>
        t.customerId === selectedCustomerId &&
        (t.paymentStatus === 'Belum Lunas' || t.paymentStatus === 'Partial')
    ) || []

    // Find the cash account assigned to the current user
    const { getEmployeeCashAccount } = useAccounts()
    const userCashAccount = user?.id ? getEmployeeCashAccount(user.id) : undefined

    return (
        <div className="min-h-screen bg-slate-50 pb-20">
            <div className="bg-indigo-600 text-white p-4 sticky top-0 z-10 shadow-md">
                <h1 className="text-lg font-bold">Laporan Sales</h1>
                <p className="text-xs opacity-80">Kunjungan Toko & Penagihan</p>
            </div>

            <div className="p-4 space-y-6">
                {!selectedCustomerId ? (
                    <Card className="shadow-sm border-none">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base flex items-center gap-2">
                                <Search className="h-4 w-4 text-indigo-600" />
                                Pilih Pelanggan
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Cari Nama / No. HP Pelanggan..."
                                    className="pl-10"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                {isLoadingCustomers ? (
                                    <div className="text-center py-4"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>
                                ) : filteredCustomers.map(customer => (
                                    <Button
                                        key={customer.id}
                                        variant="outline"
                                        className="w-full justify-start h-auto py-3 text-left flex flex-col items-start gap-1"
                                        onClick={() => {
                                            setSelectedCustomerId(customer.id)
                                            setValue("customerId", customer.id)
                                        }}
                                    >
                                        <span className="font-bold text-indigo-700">{customer.name}</span>
                                        <span className="text-[10px] text-muted-foreground">{customer.phone || 'No Phone'} • {customer.address || 'No Address'}</span>
                                    </Button>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                        <Card className="shadow-sm border-none border-l-4 border-l-indigo-600">
                            <CardContent className="p-4 flex items-center justify-between">
                                <div className="flex-1 min-w-0 mr-4">
                                    <h2 className="font-bold text-indigo-900 truncate">{selectedCustomer?.name}</h2>
                                    <p className="text-xs text-muted-foreground">{selectedCustomer?.phone || 'No Phone'}</p>
                                </div>
                                <div className="flex gap-2 shrink-0">
                                    <Button
                                        type="button"
                                        size="sm"
                                        className="bg-emerald-600 hover:bg-emerald-700"
                                        onClick={() => setIsPosModalOpen(true)}
                                    >
                                        POS
                                    </Button>
                                    <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedCustomerId(null)}>Ganti</Button>
                                </div>
                            </CardContent>
                        </Card>

                        {/* GPS Section */}
                        <Card className="shadow-sm border-none">
                            <CardContent className="p-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-full ${location ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-400'}`}>
                                        <Navigation className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <p className="text-xs font-semibold">Koordinat GPS</p>
                                        <p className="text-[10px] text-muted-foreground">{location ? `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}` : 'Belum mengunci lokasi'}</p>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    <Button type="button" size="sm" variant="outline" onClick={getGPS} disabled={isLocating}>
                                        {isLocating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ambil Lokasi"}
                                    </Button>
                                    {(errors.latitude || errors.longitude) && <p className="text-[10px] text-destructive">Lokasi wajib diambil</p>}
                                </div>
                            </CardContent>
                        </Card>

                        {/* Payment Section (Receivables) */}
                        {customerReceivables.length > 0 && (
                            <Card className="shadow-sm border-none">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-semibold flex items-center gap-2 text-rose-600">
                                        <CreditCard className="h-4 w-4" />
                                        Tagihan Belum Lunas ({customerReceivables.length})
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    {customerReceivables.map(t => (
                                        <div key={t.id} className="p-3 bg-rose-50 rounded-lg border border-rose-100 flex justify-between items-center">
                                            <div className="min-w-0 flex-1">
                                                <p className="text-[10px] font-bold text-rose-800">{t.id}</p>
                                                <p className="text-xs text-rose-600 font-bold">Sisa: Rp {formatNumber(t.total - (t.paidAmount || 0))}</p>
                                            </div>
                                            <Button
                                                type="button"
                                                size="sm"
                                                className="h-8 bg-rose-600 hover:bg-rose-700 text-[10px]"
                                                onClick={() => {
                                                    setSelectedTransaction(t)
                                                    setIsPayDialogOpen(true)
                                                }}
                                            >
                                                Bayar
                                            </Button>
                                        </div>
                                    ))}
                                </CardContent>
                            </Card>
                        )}

                        {/* Report Form */}
                        <Card className="shadow-sm border-none">
                            <CardContent className="p-4 space-y-4">
                                <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">Catatan Kunjungan</Label>
                                    <Textarea
                                        {...register("notes")}
                                        placeholder="Contoh: Toko tutup, Pemilik sedang keluar, Stok menipis..."
                                        className="min-h-[100px]"
                                    />
                                    {errors.notes && <p className="text-xs text-destructive">{errors.notes.message}</p>}
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-xs text-muted-foreground">Foto Kunjungan (Opsional)</Label>
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
                                            className="w-full h-24 border-dashed flex flex-col gap-2 text-muted-foreground"
                                            onClick={() => fileInputRef.current?.click()}
                                        >
                                            <Camera className="h-8 w-8" />
                                            <span className="text-xs">Ambil Foto Bukti</span>
                                        </Button>
                                    ) : (
                                        <div className="relative w-full h-48 bg-slate-100 rounded-lg overflow-hidden border">
                                            <img src={photoPreview} alt="Visit" className="w-full h-full object-contain" />
                                            <Button
                                                type="button"
                                                variant="destructive"
                                                size="icon"
                                                className="absolute top-2 right-2 h-8 w-8 rounded-full shadow-md"
                                                onClick={removePhoto}
                                            >
                                                <X className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    )}
                                    {errors.photo && <p className="text-xs text-destructive">{errors.photo.message as string}</p>}
                                </div>

                                <Button type="submit" className="w-full h-12 bg-indigo-600 hover:bg-indigo-700" disabled={isUploading}>
                                    {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <><CheckCircle2 className="mr-2 h-4 w-4" /> Simpan Laporan Kunjungan</>}
                                </Button>
                            </CardContent>
                        </Card>
                    </form>
                )}

                {/* History Summary? Maybe later */}
            </div>

            <PayReceivableDialog
                open={isPayDialogOpen}
                onOpenChange={setIsPayDialogOpen}
                transaction={selectedTransaction}
                defaultPaymentAccount={userCashAccount}
            />

            <Dialog open={isPosModalOpen} onOpenChange={setIsPosModalOpen}>
                <DialogContent className="p-0 sm:max-w-[100vw] h-[100vh] border-none overflow-y-auto bg-slate-50 flex flex-col">
                    <div className="sticky top-0 z-50 bg-indigo-600 text-white p-4 flex items-center justify-between shadow-md shrink-0">
                        <h2 className="font-bold">Point of Sale</h2>
                        <Button variant="ghost" size="icon" onClick={() => setIsPosModalOpen(false)} className="text-white hover:bg-indigo-700">
                            <X className="h-6 w-6" />
                        </Button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4">
                        <MobilePosForm preselectedCustomerId={selectedCustomerId || undefined} />
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
