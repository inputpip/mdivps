"use client"

import { useState, useRef } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
    Truck, Package, MapPin, Camera, X, CheckCircle2,
    Loader2, Clock, Phone, AlertTriangle, ArrowLeft,
    Calendar, User, Send, RotateCcw, XCircle
} from "lucide-react"
import { format } from "date-fns"
import { id as localeId } from "date-fns/locale"
import { useMyDeliveries, useCreateDeliveryReport } from "@/hooks/useDeliveryReports"
import { PhotoUploadService } from "@/services/photoUploadService"
import { compressImage, isImageFile } from "@/utils/imageCompression"
import { useToast } from "@/hooks/use-toast"

type ViewMode = 'list' | 'report'

const STATUS_OPTIONS = [
    { value: 'delivered', label: 'Terkirim', icon: CheckCircle2, color: 'bg-emerald-500' },
    { value: 'partial', label: 'Sebagian', icon: Package, color: 'bg-amber-500' },
    { value: 'failed', label: 'Gagal', icon: XCircle, color: 'bg-red-500' },
    { value: 'returned', label: 'Dikembalikan', icon: RotateCcw, color: 'bg-orange-500' },
    { value: 'rescheduled', label: 'Dijadwalkan Ulang', icon: Calendar, color: 'bg-blue-500' },
]

const getStatusBadge = (status: string | null) => {
    if (!status) return null
    const opt = STATUS_OPTIONS.find(s => s.value === status)
    if (!opt) return <Badge variant="outline">{status}</Badge>
    return (
        <Badge className={`${opt.color} text-white text-[10px] px-1.5 py-0`}>
            {opt.label}
        </Badge>
    )
}

export default function MobileDeliveryReportPage() {
    const { data: deliveries, isLoading } = useMyDeliveries()
    const createReport = useCreateDeliveryReport()
    const { toast } = useToast()

    const [viewMode, setViewMode] = useState<ViewMode>('list')
    const [selectedDelivery, setSelectedDelivery] = useState<any>(null)
    const [reportStatus, setReportStatus] = useState('')
    const [reportNotes, setReportNotes] = useState('')
    const [photo, setPhoto] = useState<File | null>(null)
    const [photoPreview, setPhotoPreview] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const unreported = deliveries?.filter(d => !d.reportStatus) || []
    const reported = deliveries?.filter(d => d.reportStatus) || []

    const handleSelectDelivery = (delivery: any) => {
        setSelectedDelivery(delivery)
        setReportStatus('delivered') // Default status to 'delivered'
        setReportNotes('')
        setPhoto(null)
        setPhotoPreview(null)
        setViewMode('report')
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
            const reader = new FileReader()
            reader.onload = (e) => setPhotoPreview(e.target?.result as string)
            reader.readAsDataURL(compressed)
        } catch {
            toast({ variant: "destructive", title: "Error", description: "Gagal memproses gambar" })
        }
    }

    const removePhoto = () => {
        setPhoto(null)
        setPhotoPreview(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    const handleSubmitReport = async () => {
        if (!selectedDelivery) return;

        if (!photo) {
            toast({ variant: "destructive", title: "Validasi", description: "Wajib melampirkan foto bukti!" })
            return
        }

        setIsSubmitting(true)
        try {
            // Try to get GPS location - now MANDATORY
            let latitude: number | undefined
            let longitude: number | undefined

            try {
                toast({ title: "GPS", description: "Sedang mengambil lokasi..." })
                const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject, {
                        timeout: 10000,
                        enableHighAccuracy: true
                    })
                })
                latitude = pos.coords.latitude
                longitude = pos.coords.longitude
            } catch (err: any) {
                toast({ variant: "destructive", title: "Lokasi Gagal", description: "Wajib mengaktifkan GPS dan memberikan izin lokasi!" })
                setIsSubmitting(false)
                return
            }

            if (!latitude || !longitude) {
                toast({ variant: "destructive", title: "Lokasi Gagal", description: "Gagal mendapatkan koordinat GPS. Coba lagi." })
                setIsSubmitting(false)
                return
            }

            // Upload photo
            const nomor = selectedDelivery.deliveryNumber ? `DR-${selectedDelivery.deliveryNumber}` : `DR-${selectedDelivery.transactionId.substring(0, 8)}`
            const customerName = selectedDelivery.customerName || 'UMUM'
            const tanggal = format(new Date(), 'yyyyMMdd_HHmmss')
            const exactFilename = `${nomor} - ${customerName} - ${tanggal}`

            const uploadResult = await PhotoUploadService.uploadPhoto(
                photo,
                exactFilename,
                'delivery-reports',
                true
            )
            const photoUrl = uploadResult.webViewLink

            await createReport.mutateAsync({
                transactionId: selectedDelivery.transactionId,
                deliveryId: selectedDelivery.id,
                status: reportStatus,
                notes: reportNotes || undefined,
                photoUrl: photoUrl || undefined,
                latitude,
                longitude,
            })

            setViewMode('list')
            setSelectedDelivery(null)
        } catch (error: any) {
            toast({ variant: "destructive", title: "Gagal", description: error.message })
        } finally {
            setIsSubmitting(false)
        }
    }

    // ============ REPORT VIEW ============
    if (viewMode === 'report' && selectedDelivery) {
        return (
            <div className="min-h-screen bg-slate-50 pb-20">
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white p-4 sticky top-0 z-10 shadow-lg">
                    <div className="flex items-center gap-3">
                        <Button variant="ghost" size="icon" className="text-white hover:bg-white/20"
                            onClick={() => setViewMode('list')}>
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                        <div>
                            <h1 className="text-base font-bold">Lapor Pengantaran</h1>
                            <p className="text-xs opacity-80">#{selectedDelivery.deliveryNumber} - {selectedDelivery.customerName}</p>
                        </div>
                    </div>
                </div>

                <div className="p-4 space-y-4">
                    {/* Delivery Info */}
                    <Card className="border-none shadow-sm">
                        <CardContent className="pt-4 space-y-3">
                            <div className="flex items-center gap-2 text-sm">
                                <User className="h-4 w-4 text-muted-foreground" />
                                <span className="font-medium">{selectedDelivery.customerName}</span>
                            </div>
                            {selectedDelivery.customerAddress && (
                                <div className="flex items-start gap-2 text-sm">
                                    <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                                    <span className="text-muted-foreground">{selectedDelivery.customerAddress}</span>
                                </div>
                            )}
                            {selectedDelivery.customerPhone && (
                                <div className="flex items-center gap-2 text-sm">
                                    <Phone className="h-4 w-4 text-muted-foreground" />
                                    <a href={`tel:${selectedDelivery.customerPhone}`} className="text-blue-600 underline">
                                        {selectedDelivery.customerPhone}
                                    </a>
                                </div>
                            )}
                            <div className="flex items-center gap-2 text-sm">
                                <Calendar className="h-4 w-4 text-muted-foreground" />
                                <span>{format(selectedDelivery.deliveryDate, 'dd MMM yyyy', { locale: localeId })}</span>
                            </div>

                            {/* Items */}
                            {selectedDelivery.items?.length > 0 && (
                                <div className="pt-2 border-t space-y-1">
                                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Barang Diantar</span>
                                    {selectedDelivery.items.map((item: any, i: number) => (
                                        <div key={i} className="flex justify-between text-sm bg-slate-50 p-2 rounded">
                                            <span className="truncate flex-1">{item.product_name}</span>
                                            <span className="font-medium ml-2 tabular-nums">{item.quantity_delivered} {item.unit}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Status Selection */}
                    <Card className="border-none shadow-sm">
                        <CardContent className="pt-4 space-y-4">
                            <div className="space-y-2">
                                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status Pengantaran *</Label>
                                <div className="grid grid-cols-2 gap-2">
                                    {STATUS_OPTIONS.map(opt => {
                                        const Icon = opt.icon
                                        const isSelected = reportStatus === opt.value
                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => setReportStatus(opt.value)}
                                                className={`flex items-center gap-2 p-3 rounded-xl border-2 transition-all duration-200 text-left ${isSelected
                                                    ? `border-blue-500 bg-blue-50 shadow-md scale-[1.02]`
                                                    : 'border-slate-200 bg-white hover:border-slate-300'
                                                    }`}
                                            >
                                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isSelected ? opt.color : 'bg-slate-100'
                                                    }`}>
                                                    <Icon className={`h-4 w-4 ${isSelected ? 'text-white' : 'text-slate-500'}`} />
                                                </div>
                                                <span className={`text-sm font-medium ${isSelected ? 'text-blue-700' : 'text-slate-600'}`}>
                                                    {opt.label}
                                                </span>
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>

                            {/* Notes */}
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Catatan (Opsional)</Label>
                                <Textarea
                                    value={reportNotes}
                                    onChange={(e) => setReportNotes(e.target.value)}
                                    placeholder="Ceritakan detail pengantaran..."
                                    className="min-h-[80px] resize-none"
                                />
                            </div>

                            {/* Photo */}
                            <div className="space-y-2">
                                <Label className="text-xs text-muted-foreground font-bold text-red-500">Foto Bukti (WAJIB) *</Label>
                                <input
                                    type="file" accept="image/*" capture="environment"
                                    className="hidden" ref={fileInputRef}
                                    onChange={handlePhotoCapture}
                                />
                                {!photoPreview ? (
                                    <Button type="button" variant="outline"
                                        className="w-full h-20 border-dashed flex flex-col gap-1 text-muted-foreground"
                                        onClick={() => fileInputRef.current?.click()}>
                                        <Camera className="h-6 w-6" />
                                        <span className="text-[10px]">Ambil Foto / Pilih File</span>
                                    </Button>
                                ) : (
                                    <div className="relative w-full h-40 bg-slate-100 rounded-lg overflow-hidden border">
                                        <img src={photoPreview} alt="Bukti" className="w-full h-full object-contain" />
                                        <Button type="button" variant="destructive" size="icon"
                                            className="absolute top-1 right-1 h-6 w-6 rounded-full" onClick={removePhoto}>
                                            <X className="h-3 w-3" />
                                        </Button>
                                    </div>
                                )}
                            </div>

                            {/* Submit */}
                            <Button
                                className="w-full h-12 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg"
                                disabled={!reportStatus || isSubmitting}
                                onClick={handleSubmitReport}
                            >
                                {isSubmitting ? (
                                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Mengirim...</>
                                ) : (
                                    <><Send className="mr-2 h-4 w-4" /> Kirim Laporan</>
                                )}
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            </div>
        )
    }

    // ============ LIST VIEW ============
    return (
        <div className="min-h-screen bg-slate-50 pb-20">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white p-4 sticky top-0 z-10 shadow-lg">
                <div className="flex items-center gap-2">
                    <Truck className="h-5 w-5" />
                    <div>
                        <h1 className="text-lg font-bold">Lapor Antar</h1>
                        <p className="text-xs opacity-80">Laporkan status pengantaran Anda</p>
                    </div>
                </div>
                {/* Stats */}
                <div className="flex gap-3 mt-3">
                    <div className="bg-white/15 backdrop-blur-sm rounded-lg px-3 py-1.5 flex-1 text-center">
                        <div className="text-lg font-bold">{unreported.length}</div>
                        <div className="text-[10px] opacity-80">Menunggu Laporan</div>
                    </div>
                </div>
            </div>

            <div className="p-4 space-y-4">
                {isLoading ? (
                    <div className="text-center py-10">
                        <Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-500 mb-2" />
                        <p className="text-sm text-muted-foreground">Memuat data pengantaran...</p>
                    </div>
                ) : unreported.length === 0 ? (
                    <div className="text-center py-16 space-y-3">
                        <div className="bg-slate-100 w-16 h-16 rounded-2xl mx-auto flex items-center justify-center">
                            <Truck className="h-8 w-8 text-slate-400" />
                        </div>
                        <p className="text-muted-foreground font-medium">Semua Sudah Dilaporkan</p>
                        <p className="text-xs text-muted-foreground">Tidak ada pengantaran yang perlu dilaporkan saat ini.</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <h3 className="text-sm font-semibold flex items-center gap-2 px-1">
                            <AlertTriangle className="h-4 w-4 text-amber-500" />
                            Perlu Dilaporkan ({unreported.length})
                        </h3>
                        {unreported.map(delivery => (
                            <Card key={delivery.id} className="border-none shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                                onClick={() => handleSelectDelivery(delivery)}>
                                <CardContent className="p-3">
                                    <div className="flex items-start gap-3">
                                        <div className="bg-amber-50 p-2.5 rounded-xl shrink-0">
                                            <Truck className="h-5 w-5 text-amber-600" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="font-semibold text-sm truncate">{delivery.customerName || 'Pelanggan'}</span>
                                                <Badge variant="outline" className="text-[10px] shrink-0 border-amber-300 text-amber-700 bg-amber-50">
                                                    #{delivery.deliveryNumber}
                                                </Badge>
                                            </div>
                                            {delivery.customerAddress && (
                                                <p className="text-xs text-muted-foreground truncate mt-0.5">
                                                    <MapPin className="h-3 w-3 inline mr-1" />{delivery.customerAddress}
                                                </p>
                                            )}
                                            <div className="flex items-center justify-between mt-2">
                                                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                                    <Clock className="h-3 w-3" />
                                                    {format(delivery.deliveryDate, 'dd MMM yyyy', { locale: localeId })}
                                                </span>
                                                <span className="text-xs font-semibold text-slate-700">
                                                    {delivery.items?.length || 0} item
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}</div>
        </div>
    )
}
