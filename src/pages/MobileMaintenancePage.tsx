import { useState, useRef } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAssets } from "@/hooks/useAssets"
import { useMaintenance, useCreateMaintenance, useCompleteMaintenance } from "@/hooks/useMaintenance"
import { useAccounts } from "@/hooks/useAccounts"
import { useToast } from "@/components/ui/use-toast"
import { useAuth } from "@/hooks/useAuth"
import { useTimezone } from "@/contexts/TimezoneContext"
import { getOfficeTime } from "@/utils/officeTime"
import { Loader2, Camera, X, Wrench, CheckCircle2, History, AlertTriangle } from "lucide-react"
import { PhotoUploadService } from "@/services/photoUploadService"
import { compressImage, isImageFile } from "@/utils/imageCompression"
import { formatNumber } from "@/utils/formatNumber"
import { id as localeId } from "date-fns/locale"
import { format } from "date-fns"
import { Badge } from "@/components/ui/badge"

import { useExpenses } from "@/hooks/useExpenses"
import { useBranch } from "@/contexts/BranchContext"

const maintenanceSchema = z.object({
    assetId: z.string().min(1, "Pilih aset yang diperbaiki."),
    title: z.string().min(3, "Judul minimal 3 karakter."),
    maintenanceType: z.enum(['preventive', 'corrective', 'inspection', 'calibration', 'other']),
    description: z.string().optional(),
    actualCost: z.coerce.number().min(0),
    paymentAccountId: z.string().optional(),
    workPerformed: z.string().min(3, "Jelaskan apa yang sudah dikerjakan."),
})

type MaintenanceFormData = z.infer<typeof maintenanceSchema>

export default function MobileMaintenancePage() {
    const { assets, isLoading: isLoadingAssets } = useAssets()
    const { data: records, isLoading: isLoadingHistory } = useMaintenance()
    const createMaintenance = useCreateMaintenance()
    const completeMaintenance = useCompleteMaintenance()
    const { accounts } = useAccounts()
    const { addExpense } = useExpenses()
    const { toast } = useToast()
    const { user } = useAuth()
    const { timezone } = useTimezone()
    const { currentBranch } = useBranch()

    const [photo, setPhoto] = useState<File | null>(null)
    const [photoPreview, setPhotoPreview] = useState<string | null>(null)
    const [isUploading, setIsUploading] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<MaintenanceFormData>({
        resolver: zodResolver(maintenanceSchema),
        defaultValues: {
            assetId: "",
            title: "Perbaikan Aset",
            maintenanceType: "corrective",
            description: "",
            actualCost: 0,
            paymentAccountId: "",
            workPerformed: "",
        }
    })

    const watchCost = watch("actualCost")
    const paymentAccounts = accounts?.filter(a => a.isPaymentAccount) || []

    const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        if (!isImageFile(file)) {
            toast({ variant: "destructive", title: "Error", description: "File harus berupa gambar" })
            return
        }
        try {
            const compressed = await compressImage(file, 200) // Increase bit to 200KB for better quality
            setPhoto(compressed)
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
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    const onSubmit = async (data: MaintenanceFormData) => {
        if (!currentBranch?.id) {
            toast({ variant: "destructive", title: "Gagal", description: "Branch tidak terdeteksi. Silakan pilih branch." })
            return
        }

        setIsUploading(true)
        let photoUrl = ''

        try {
            if (photo) {
                const uploadResult = await PhotoUploadService.uploadPhoto(
                    photo,
                    `MAINT-${Date.now()}`,
                    'maintenance'
                )
                photoUrl = uploadResult.webViewLink
            }

            // 1. Create maintenance record
            const maintenanceId = await createMaintenance.mutateAsync({
                assetId: data.assetId,
                maintenanceType: data.maintenanceType,
                title: data.title,
                description: data.description,
                scheduledDate: getOfficeTime(timezone),
                isRecurring: false,
                priority: 'medium',
                estimatedCost: data.actualCost,
                notifyBeforeDays: 0,
            })

            // 2. Complete maintenance
            await completeMaintenance.mutateAsync({
                id: maintenanceId,
                actualCost: data.actualCost,
                paymentAccountId: data.paymentAccountId || undefined,
                workPerformed: data.workPerformed,
                findings: data.description,
            })

            // 3. IF there is a cost AND payment account, record as EXPENSE atomically
            if (data.actualCost > 0 && data.paymentAccountId) {
                const assetName = assets?.find(a => a.id === data.assetId)?.assetName || "Aset"
                await addExpense.mutateAsync({
                    description: `Biaya Maintenance ${assetName}: ${data.title}`,
                    amount: data.actualCost,
                    category: 'Beban Pemeliharaan & Perbaikan', // Specific category for maintenance
                    date: getOfficeTime(timezone),
                    accountId: data.paymentAccountId,
                    photoUrl: photoUrl || undefined
                })
            }

            toast({
                title: "Sukses",
                description: "Laporan & Biaya maintenance berhasil disimpan"
            })
            reset()
            removePhoto()
        } catch (error: any) {
            toast({ variant: "destructive", title: "Gagal", description: error.message })
        } finally {
            setIsUploading(false)
        }
    }

    return (
        <div className="min-h-screen bg-slate-50 pb-20">
            <div className="bg-zinc-800 text-white p-4 sticky top-0 z-10 shadow-md">
                <h1 className="text-lg font-bold">Maintenance Aset</h1>
                <p className="text-xs opacity-80">Laporkan perbaikan & pemeliharaan</p>
            </div>

            <div className="p-4 space-y-6">
                <Card className="shadow-sm border-none">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Wrench className="h-4 w-4 text-zinc-600" />
                            Input Laporan Perbaikan
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                            {/* Pilih Aset */}
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Pilih Aset</Label>
                                <Select onValueChange={(val) => setValue("assetId", val)} value={watch("assetId")}>
                                    <SelectTrigger className="h-10">
                                        <SelectValue placeholder="Pilih Aset..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {assets?.map(asset => (
                                            <SelectItem key={asset.id} value={asset.id}>
                                                {asset.assetName} ({asset.assetCode})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {errors.assetId && <p className="text-xs text-destructive">{errors.assetId.message}</p>}
                            </div>

                            {/* Judul & Tipe */}
                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">Judul</Label>
                                    <Input {...register("title")} className="h-10" />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">Tipe</Label>
                                    <Select onValueChange={(val: any) => setValue("maintenanceType", val)} value={watch("maintenanceType")}>
                                        <SelectTrigger className="h-10">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="corrective">Perbaikan</SelectItem>
                                            <SelectItem value="preventive">Pencegahan</SelectItem>
                                            <SelectItem value="inspection">Inspeksi</SelectItem>
                                            <SelectItem value="other">Lainnya</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {/* Kerja yang dilakukan */}
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Pekerjaan yang dilakukan</Label>
                                <Textarea
                                    {...register("workPerformed")}
                                    placeholder="Ceritakan apa saja yang diperbaiki..."
                                    className="min-h-[80px]"
                                />
                                {errors.workPerformed && <p className="text-xs text-destructive">{errors.workPerformed.message}</p>}
                            </div>

                            {/* Biaya (Opsional) */}
                            <div className="space-y-2 pt-2 border-t">
                                <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="text-[10px] uppercase tracking-wider">Keuangan</Badge>
                                    <span className="text-xs text-muted-foreground italic">Isi jika ada biaya perbaikan</span>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1">
                                        <Label className="text-xs text-muted-foreground">Biaya Aktual (Rp)</Label>
                                        <Input
                                            type="number"
                                            {...register("actualCost")}
                                            className="h-10 font-mono"
                                            placeholder="0"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs text-muted-foreground">Bayar Pakai</Label>
                                        <Select onValueChange={(val) => setValue("paymentAccountId", val)} value={watch("paymentAccountId")}>
                                            <SelectTrigger className="h-10">
                                                <SelectValue placeholder="Pilih Akun" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {paymentAccounts.map(acc => (
                                                    <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            </div>

                            {/* Foto Bukti */}
                            <div className="space-y-2 pt-2 border-t">
                                <Label className="text-xs text-muted-foreground">Foto Bukti (Opsional)</Label>
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
                                        className="w-full h-20 border-dashed flex flex-col gap-1 text-muted-foreground"
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        <Camera className="h-6 w-6" />
                                        <span className="text-[10px]">Ambil Foto</span>
                                    </Button>
                                ) : (
                                    <div className="relative w-full h-40 bg-slate-100 rounded-lg overflow-hidden border">
                                        <img src={photoPreview} alt="Bukti" className="w-full h-full object-contain" />
                                        <Button
                                            type="button"
                                            variant="destructive"
                                            size="icon"
                                            className="absolute top-1 right-1 h-6 w-6 rounded-full"
                                            onClick={removePhoto}
                                        >
                                            <X className="h-3 w-3" />
                                        </Button>
                                    </div>
                                )}
                            </div>

                            <Button type="submit" className="w-full h-12 bg-zinc-800 hover:bg-zinc-900" disabled={isUploading}>
                                {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <><CheckCircle2 className="mr-2 h-4 w-4" /> Simpan Laporan</>}
                            </Button>
                        </form>
                    </CardContent>
                </Card>

                {/* History Singkat */}
                <div className="space-y-2">
                    <h3 className="text-sm font-semibold flex items-center gap-2 px-1">
                        <History className="h-4 w-4 text-muted-foreground" />
                        Riwayat Terakhir
                    </h3>
                    <div className="space-y-2">
                        {isLoadingHistory ? (
                            <div className="text-center py-4 text-xs text-muted-foreground">Memuat riwayat...</div>
                        ) : records?.slice(0, 5).map(record => (
                            <div key={record.id} className="bg-white p-3 rounded-lg border shadow-sm flex items-start gap-3">
                                <div className="bg-zinc-100 p-2 rounded-lg">
                                    <Wrench className="h-4 w-4 text-zinc-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-1">
                                        <p className="font-medium text-sm truncate">{record.title}</p>
                                        <Badge variant={record.status === 'completed' ? 'default' : 'secondary'} className="text-[10px] h-4 px-1">
                                            {record.status}
                                        </Badge>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground truncate">{record.assetName}</p>
                                    <div className="flex items-center justify-between mt-1">
                                        <span className="text-[10px] text-muted-foreground">
                                            {format(new Date(record.scheduledDate), 'dd MMM yyyy', { locale: localeId })}
                                        </span>
                                        {record.actualCost > 0 && (
                                            <span className="text-xs font-bold text-red-600">Rp {formatNumber(record.actualCost)}</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}
