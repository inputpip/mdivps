"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { Badge } from "@/components/ui/badge"
import { format } from "date-fns"
import { TransactionDeliveryInfo, DeliveryFormData, Delivery } from "@/types/delivery"
import { useDeliveries, useDeliveryEmployees } from "@/hooks/useDeliveries"
import { compressImage, isImageFile } from "@/utils/imageCompression"
import { useAuthContext } from "@/contexts/AuthContext"
import { canDeliverWithoutDriver } from "@/utils/roleUtils"
import { Capacitor } from "@capacitor/core"
import { useTimezone } from "@/contexts/TimezoneContext"
import { getOfficeTime } from "@/utils/officeTime"
import { PhotoUploadService } from "@/services/photoUploadService"

interface DeliveryFormContentProps {
  transaction: TransactionDeliveryInfo;
  onSuccess?: () => void;
  onDeliveryCreated?: (delivery: Delivery, transaction: TransactionDeliveryInfo) => void;
}

// Helper to check if running in Capacitor/APK
function isCapacitorApp(): boolean {
  try {
    if (Capacitor.isNativePlatform()) return true;
    const platform = Capacitor.getPlatform();
    if (platform === 'android' || platform === 'ios') return true;
  } catch (e) {
    // Capacitor not available
  }
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol;
    if (protocol === 'capacitor:' || protocol === 'file:') return true;
  }
  return false;
}

export function DeliveryFormContent({ transaction, onSuccess, onDeliveryCreated }: DeliveryFormContentProps) {
  const { toast } = useToast()
  const { createDelivery } = useDeliveries()
  const { data: employees, isLoading: isLoadingEmployees } = useDeliveryEmployees()
  const { user } = useAuthContext()
  const { timezone } = useTimezone()
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Check if driver is optional (web view + allowed role)
  const isWebView = !isCapacitorApp()
  const driverOptional = isWebView && canDeliverWithoutDriver(user?.role)

  const [formData, setFormData] = useState<DeliveryFormData>(() => ({
    transactionId: transaction.id,
    deliveryDate: format(getOfficeTime(timezone), "yyyy-MM-dd'T'HH:mm"),
    notes: "",
    driverId: "",
    helperId: "",
    items: transaction.deliverySummary.map((item, index) => ({
      itemId: `${item.productId}-${index}`, // Unique identifier per row
      productId: item.productId,
      productName: item.productName,
      isBonus: item.productName.toUpperCase().includes("BONUS"),
      orderedQuantity: item.orderedQuantity,
      deliveredQuantity: item.deliveredQuantity,
      remainingQuantity: item.remainingQuantity,
      quantityToDeliver: 0,
      unit: item.unit,
      width: item.width,
      height: item.height,
      notes: "",
    })),
    photo: undefined,
  }))

  // State untuk preview foto
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)

  // FIX: Update form items when transaction.deliverySummary changes (e.g., after delivery deletion)
  useEffect(() => {
    console.log('🔄 Updating form data due to transaction change:', {
      transactionId: transaction.id,
      deliverySummaryCount: transaction.deliverySummary.length,
      summary: transaction.deliverySummary.map(item => ({
        name: item.productName,
        remaining: item.remainingQuantity
      }))
    })

    setFormData(prev => ({
      ...prev,
      items: transaction.deliverySummary.map((item, index) => {
        // Try to preserve existing quantityToDeliver if item exists
        const existingItem = prev.items.find(existing =>
          existing.productId === item.productId && existing.productName === item.productName
        )

        return {
          itemId: `${item.productId}-${index}`,
          productId: item.productId,
          productName: item.productName,
          isBonus: item.productName.toUpperCase().includes("BONUS"),
          orderedQuantity: item.orderedQuantity,
          deliveredQuantity: item.deliveredQuantity,
          remainingQuantity: item.remainingQuantity,
          quantityToDeliver: existingItem ? Math.min(existingItem.quantityToDeliver, item.remainingQuantity) : 0,
          unit: item.unit,
          width: item.width,
          height: item.height,
          notes: existingItem?.notes || "",
        }
      })
    }))
  }, [transaction.deliverySummary])

  const handleItemQuantityChange = (itemId: string, quantityToDeliver: number) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.map(item => {
        if (item.itemId === itemId) {
          // Enforce strict limit: cannot exceed remaining quantity
          const clampedQuantity = Math.max(0, Math.min(quantityToDeliver, item.remainingQuantity))

          // Show toast warning if user tries to exceed limit
          if (quantityToDeliver > item.remainingQuantity) {
            toast({
              variant: "destructive",
              title: "Jumlah Melebihi Batas",
              description: `Jumlah antar untuk ${item.productName} tidak boleh melebihi sisa pesanan (${item.remainingQuantity} ${item.unit})`,
            })
          }

          console.log(`📦 Updating quantity for ${item.productName}:`, {
            requested: quantityToDeliver,
            remaining: item.remainingQuantity,
            clamped: clampedQuantity
          })

          return { ...item, quantityToDeliver: clampedQuantity }
        }
        return item
      })
    }))
  }

  const handleItemNotesChange = (itemId: string, notes: string) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.map(item =>
        item.itemId === itemId ? { ...item, notes } : item
      )
    }))
  }

  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate image file
    if (!isImageFile(file)) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "File harus berupa gambar"
      })
      return
    }

    // Validate file size (max 10MB before compression)
    if (file.size > 10 * 1024 * 1024) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Ukuran file maksimal 10MB"
      })
      return
    }

    try {
      // Compress image to max 100KB
      const compressedFile = await compressImage(file, 100)
      console.log(`Photo compressed: ${(file.size / 1024).toFixed(1)}KB -> ${(compressedFile.size / 1024).toFixed(1)}KB`)

      setFormData(prev => ({ ...prev, photo: compressedFile }))

      // Create preview
      const reader = new FileReader()
      reader.onload = (e) => {
        setPhotoPreview(e.target?.result as string)
      }
      reader.readAsDataURL(compressedFile)

      toast({
        title: "Foto dikompres",
        description: `Ukuran: ${(compressedFile.size / 1024).toFixed(1)}KB`
      })
    } catch (error) {
      console.error('Error compressing image:', error)
      toast({
        variant: "destructive",
        title: "Error",
        description: "Gagal mengkompresi gambar"
      })
    }
  }

  const removePhoto = () => {
    setFormData(prev => ({ ...prev, photo: undefined }))
    setPhotoPreview(null)
  }

  const handleSubmit = async () => {
    // Validate at least one item to deliver
    const itemsToDeliver = formData.items.filter(item => item.quantityToDeliver > 0)
    if (itemsToDeliver.length === 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Pilih minimal satu item untuk diantar"
      })
      return
    }

    // Validate driver (required unless driverOptional is true)
    if (!formData.driverId && !driverOptional) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Supir wajib dipilih"
      })
      return
    }

    // Validate no item exceeds remaining quantity
    const hasExcessiveQuantity = formData.items.some(item =>
      item.quantityToDeliver > item.remainingQuantity
    )
    if (hasExcessiveQuantity) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Jumlah antar tidak boleh melebihi sisa pesanan"
      })
      return
    }

    // Validate duplicate items (BLOCK approach)
    // This prevents user from submitting multiple rows for the same product, 
    // which causes confusion and potential double counting issues.
    const productKeysCheck = new Set<string>();
    for (const item of itemsToDeliver) {
      // Create unique key based on Product + Bonus status
      // We treat Bonus items as distinct from Regular items
      const key = `${item.productId}-${!!item.isBonus}`;

      if (productKeysCheck.has(key)) {
        toast({
          variant: "destructive",
          title: "Duplikasi Produk Terdeteksi",
          description: `Produk "${item.productName}" muncul lebih dari sekali di pengantaran ini. Mohon gabungkan jumlahnya dalam satu baris, atau perbaiki data transaksi.`
        })
        return; // BLOCK submission
      }
      productKeysCheck.add(key);
    }

    setIsSubmitting(true)
    try {
      // Upload photo to VPS using PhotoUploadService
      let photoUrl: string | undefined = undefined
      if (formData.photo) {
        try {
          const uploadResult = await PhotoUploadService.uploadPhoto(
            formData.photo,
            `${transaction.id}-delivery`,
            'deliveries'
          )

          photoUrl = uploadResult.id // Store filename/ID
          console.log('✅ Photo uploaded successfully:', photoUrl)
        } catch (error) {
          console.error('❌ Photo upload failed:', error)
          // Continue without photo if upload fails
          toast({
            variant: "destructive",
            title: "Warning",
            description: "Gagal upload foto, pengantaran akan tetap disimpan tanpa foto"
          })
        }
      }

      const deliveryItems = itemsToDeliver.map(item => ({
        productId: item.productId,
        productName: item.productName,
        quantityDelivered: item.quantityToDeliver,
        unit: item.unit,
        width: item.width,
        height: item.height,
        notes: item.notes || undefined,
        isBonus: item.isBonus, // Added: explicit bonus flag
      }))

      const result = await createDelivery.mutateAsync({
        transactionId: formData.transactionId,
        deliveryDate: new Date(formData.deliveryDate), // Use user's selected delivery date and time
        notes: formData.notes,
        driverId: formData.driverId || undefined,  // Empty string -> undefined for optional UUID
        helperId: formData.helperId || undefined,
        items: deliveryItems,
        photoUrl: photoUrl, // Send photoUrl instead of photo
      })

      // Check if there were any invalid products that were skipped
      const hasInvalidProducts = (result as any)?._invalidProductIds?.length > 0

      if (hasInvalidProducts) {
        toast({
          title: "Pengantaran Berhasil Dicatat dengan Peringatan",
          description: `Pengantaran disimpan, tetapi beberapa item dilewati karena produk tidak ditemukan di database`,
          variant: "default",
        })
      } else {
        toast({
          title: "Pengantaran Berhasil Dicatat",
          description: `Pengantaran untuk transaksi ${transaction.id} berhasil disimpan`,
        })
      }

      // Call the completion dialog callback if provided
      if (onDeliveryCreated && result) {
        // Construct a proper Delivery object from RPC result + form data
        const deliveryForDialog: Delivery = {
          id: (result as any).delivery_id,
          transactionId: formData.transactionId,
          deliveryNumber: (result as any).delivery_number,
          deliveryDate: new Date(formData.deliveryDate),
          driverId: formData.driverId || undefined,
          driverName: employees?.find(e => e.id === formData.driverId)?.name,
          helperId: formData.helperId || undefined,
          helperName: employees?.find(e => e.id === formData.helperId)?.name,
          notes: formData.notes || undefined,
          items: deliveryItems.map((item, idx) => ({
            id: `${(result as any).delivery_id}-${idx}`,
            deliveryId: (result as any).delivery_id,
            productId: item.productId,
            productName: item.productName,
            quantityDelivered: item.quantityDelivered,
            unit: item.unit || '',
            width: item.width,
            height: item.height,
            notes: item.notes,
            createdAt: new Date()
          })),
          createdAt: new Date(),
          updatedAt: new Date()
        };
        onDeliveryCreated(deliveryForDialog, transaction)
      }

      onSuccess?.()
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Gagal menyimpan pengantaran"
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="grid gap-4">
      {/* Mobile-optimized form fields */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label htmlFor="deliveryDate" className="text-sm">Waktu Pengantaran</Label>
          <Input
            id="deliveryDate"
            type="datetime-local"
            value={formData.deliveryDate}
            onChange={(e) => setFormData(prev => ({ ...prev, deliveryDate: e.target.value }))}
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Supir {driverOptional ? '(Opsional)' : '*'}</Label>
          <Select
            value={formData.driverId || "no-driver"}
            onValueChange={(value) => setFormData(prev => ({ ...prev, driverId: value === "no-driver" ? "" : value }))}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Pilih Supir" />
            </SelectTrigger>
            <SelectContent>
              {driverOptional && <SelectItem value="no-driver">Tanpa Supir</SelectItem>}
              {employees?.filter(emp => ['supir', 'helper'].includes(emp.role?.toLowerCase())).map((emp) => (
                <SelectItem key={emp.id} value={emp.id}>
                  {emp.name}{emp.role?.toLowerCase() === 'helper' ? ' (Helper)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isLoadingEmployees && <div className="text-xs text-muted-foreground">Loading...</div>}
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Helper (Opsional)</Label>
          <Select
            value={formData.helperId || "no-helper"}
            onValueChange={(value) => setFormData(prev => ({ ...prev, helperId: value === "no-helper" ? "" : value }))}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Pilih Helper" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="no-helper">Tidak ada</SelectItem>
              {employees?.filter(emp => ['helper', 'supir'].includes(emp.role?.toLowerCase())).map((helper) => (
                <SelectItem key={helper.id} value={helper.id}>
                  {helper.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Mobile-optimized items list */}
      <div className="space-y-2">
        <Label className="text-sm">Item yang Diantar</Label>
        <div className="border rounded-lg divide-y max-h-[40vh] overflow-y-auto">
          {formData.items.map((item) => (
            <div key={item.itemId} className={`p-3 ${item.isBonus ? "bg-orange-50" : ""}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="font-medium text-sm">{item.productName}</span>
                    {item.isBonus && (
                      <Badge className="text-[10px] bg-orange-100 text-orange-800 px-1">BONUS</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Pesan: {item.orderedQuantity} | Diantar: {item.deliveredQuantity} | Sisa: <span className="font-medium text-blue-600">{item.remainingQuantity}</span> {item.unit}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Input
                    type="number"
                    min="0"
                    max={item.remainingQuantity}
                    value={item.quantityToDeliver || ''}
                    onChange={(e) => handleItemQuantityChange(item.itemId, parseInt(e.target.value) || 0)}
                    placeholder="Antar"
                    className={`h-9 text-center ${item.quantityToDeliver > item.remainingQuantity ? 'border-red-500' : ''}`}
                    disabled={item.remainingQuantity === 0}
                  />
                </div>
                <Input
                  value={item.notes}
                  onChange={(e) => handleItemNotesChange(item.itemId, e.target.value)}
                  placeholder="Catatan..."
                  className="flex-1 h-9 text-sm"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="notes" className="text-sm">Catatan Pengantaran</Label>
        <Textarea
          id="notes"
          value={formData.notes}
          onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
          placeholder="Catatan tambahan..."
          rows={2}
          className="resize-none"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-sm">Foto Pengantaran (Opsional)</Label>
        {!photoPreview ? (
          <div className="mt-1">
            <Input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoCapture}
              className="hidden"
              id="delivery-photo-upload"
            />
            <div
              className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 transition-colors"
              onClick={() => document.getElementById('delivery-photo-upload')?.click()}
            >
              <div className="text-2xl mb-1">📷</div>
              <p className="text-xs text-gray-600">Tap untuk ambil foto</p>
            </div>
          </div>
        ) : (
          <div className="mt-1 space-y-2">
            <div className="relative">
              <img
                src={photoPreview}
                alt="Preview"
                className="w-full max-h-32 object-contain rounded-lg border"
              />
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={removePhoto}
                className="absolute top-1 right-1 h-6 w-6 p-0"
              >
                ✕
              </Button>
            </div>
            <Input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoCapture}
              className="hidden"
              id="delivery-photo-upload"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => document.getElementById('delivery-photo-upload')?.click()}
              className="w-full h-8 text-xs"
            >
              Ganti Foto
            </Button>
          </div>
        )}
      </div>

      <Button
        onClick={handleSubmit}
        disabled={isSubmitting}
        className="w-full h-12 text-base font-semibold bg-green-600 hover:bg-green-700"
      >
        {isSubmitting ? "Menyimpan..." : "Simpan Pengantaran"}
      </Button>
    </div>
  )
}
