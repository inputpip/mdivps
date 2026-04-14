"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/use-toast"
import { Truck, Package, User, MapPin, Check, Camera, Image } from "lucide-react"
import { Transaction } from "@/types/transaction"
import { compressImage, isImageFile } from "@/utils/imageCompression"
import { useDrivers, Driver } from "@/hooks/useDrivers"
import { useDeliveries } from "@/hooks/useDeliveries"
import { CreateDeliveryRequest } from "@/types/delivery"
import { format, isValid } from "date-fns"
import { id as idLocale } from "date-fns/locale/id"
import { useAuth } from "@/hooks/useAuth"
import { Retasi } from "@/types/retasi"
import { useTimezone } from "@/contexts/TimezoneContext"
import { getOfficeTime } from "@/utils/officeTime"

interface DriverDeliveryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  transaction: Transaction
  onDeliveryComplete: () => void
  activeRetasi?: Retasi | null // Active retasi for auto-filling helper
}

function safeFormatDateTime(date: Date | string | null | undefined, formatStr: string) {
  if (!date) return '-'
  try {
    const parsed = date instanceof Date ? date : new Date(date)
    if (!isValid(parsed)) return '-'
    return format(parsed, formatStr, { locale: idLocale })
  } catch {
    return '-'
  }
}

export function DriverDeliveryDialog({
  open,
  onOpenChange,
  transaction,
  onDeliveryComplete,
  activeRetasi
}: DriverDeliveryDialogProps) {
  const { toast } = useToast()
  const { user } = useAuth()
  const { timezone } = useTimezone()
  const { drivers } = useDrivers()
  const { createDelivery } = useDeliveries()

  const [driverId, setDriverId] = useState("")
  const [helperId, setHelperId] = useState("")
  const [helperId2, setHelperId2] = useState("")
  const [helperId3, setHelperId3] = useState("")
  const [notes, setNotes] = useState("")
  const [itemQuantities, setItemQuantities] = useState<Record<string, number>>({})
  const [deliveryPhoto, setDeliveryPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Check if user is admin/owner (can select different driver)
  const isAdminOwner = user?.role && ['admin', 'owner'].includes(user.role)

  // Auto-fill driver based on active retasi or logged-in user
  useEffect(() => {
    if (open && drivers && drivers.length > 0) {
      // 1. Try to find driver from active retasi first
      if (activeRetasi?.driver_name) {
        const driverFromRetasi = (drivers as Driver[]).find(
          (d: Driver) => d.name === activeRetasi.driver_name
        )
        if (driverFromRetasi) {
          setDriverId(driverFromRetasi.id)
          console.log(`[DriverDelivery] Auto-filled driver "${activeRetasi.driver_name}" from retasi`)
          return
        }
      }

      // 2. Fallback: Find if current user is a driver in the drivers list
      if (user) {
        const currentUserAsDriver = (drivers as Driver[]).find(
          (d: Driver) => d.id === user.id
        )

        if (currentUserAsDriver) {
          // Auto-fill driver ID
          setDriverId(currentUserAsDriver.id)
          console.log(`[DriverDelivery] Auto-filled driver from logged-in user: ${user.name}`)
        }
      }
    }
  }, [open, user, drivers, activeRetasi])

  // Auto-fill all helpers from active retasi
  useEffect(() => {
    if (open && activeRetasi && drivers && drivers.length > 0) {
      // Helper 1
      if (activeRetasi.helper_id) {
        setHelperId(activeRetasi.helper_id)
      } else if (activeRetasi.helper_name) {
        const h1 = (drivers as Driver[]).find(d => d.name === activeRetasi.helper_name)
        if (h1) setHelperId(h1.id)
      }

      // Helper 2
      if (activeRetasi.helper_id_2) {
        setHelperId2(activeRetasi.helper_id_2)
      } else if (activeRetasi.helper_name_2) {
        const h2 = (drivers as Driver[]).find(d => d.name === activeRetasi.helper_name_2)
        if (h2) setHelperId2(h2.id)
      }

      // Helper 3
      if (activeRetasi.helper_id_3) {
        setHelperId3(activeRetasi.helper_id_3)
      } else if (activeRetasi.helper_name_3) {
        const h3 = (drivers as Driver[]).find(d => d.name === activeRetasi.helper_name_3)
        if (h3) setHelperId3(h3.id)
      }

      console.log(`[DriverDelivery] Auto-filled helpers from retasi:`, {
        h1: activeRetasi.helper_name,
        h2: activeRetasi.helper_name_2,
        h3: activeRetasi.helper_name_3
      })
    }
  }, [open, activeRetasi, drivers])

  // Initialize item quantities
  useEffect(() => {
    if (transaction?.items) {
      const initialQuantities: Record<string, number> = {}
      transaction.items.forEach((item, index) => {
        if (!item.product?.id) return // Skip items without valid product
        initialQuantities[`${item.product.id}_${index}`] = item.quantity
      })
      setItemQuantities(initialQuantities)
    }
  }, [transaction])

  const handleQuantityChange = (itemKey: string, quantity: number) => {
    const item = transaction.items.find((item, index) => item.product?.id && `${item.product.id}_${index}` === itemKey)
    const maxQuantity = item?.quantity || 0

    setItemQuantities(prev => ({
      ...prev,
      [itemKey]: Math.max(0, Math.min(quantity, maxQuantity))
    }))
  }

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // Validate file type
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

        setDeliveryPhoto(compressedFile)

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
  }

  const removePhoto = () => {
    setDeliveryPhoto(null)
    setPhotoPreview(null)
  }

  const handleSubmit = async () => {
    if (!driverId) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Pilih supir terlebih dahulu"
      })
      return
    }

    if (!deliveryPhoto) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Foto pengantaran wajib diambil"
      })
      return
    }

    // Validate at least one item has quantity > 0
    const hasItemsToDeliver = Object.values(itemQuantities).some(qty => qty > 0)
    if (!hasItemsToDeliver) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Minimal satu item harus diantar"
      })
      return
    }

    // Validate no item exceeds ordered quantity
    const hasExcessiveQuantity = transaction.items.some((item, index) => {
      if (!item.product?.id) return false // Skip items without valid product
      const itemKey = `${item.product.id}_${index}`
      const quantityToDeliver = itemQuantities[itemKey] || 0
      return quantityToDeliver > item.quantity
    })
    if (hasExcessiveQuantity) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Jumlah antar tidak boleh melebihi jumlah pesanan"
      })
      return
    }

    setIsSubmitting(true)

    try {
      const selectedDriver = (drivers as Driver[])?.find((d: Driver) => d.id === driverId)
      const selectedHelper = helperId && helperId !== "no-helper" ? (drivers as Driver[])?.find((d: Driver) => d.id === helperId) : undefined

      // Create delivery items
      const deliveryItems: {
        productId: string;
        productName: string;
        quantityDelivered: number;
        unit: string;
        notes?: string;
      }[] = []
      transaction.items.forEach((item, index) => {
        if (!item.product?.id) return // Skip items without valid product
        const itemKey = `${item.product.id}_${index}`
        const quantityToDeliver = itemQuantities[itemKey] || 0

        if (quantityToDeliver > 0) {
          deliveryItems.push({
            productId: item.product.id,
            productName: item.product.name,
            quantityDelivered: quantityToDeliver,
            unit: item.unit,
            notes: item.notes || ""
          })
        }
      })

      const deliveryRequest: CreateDeliveryRequest = {
        transactionId: transaction.id,
        driverId: selectedDriver?.id,
        helperId: (helperId && helperId !== "no-helper") ? helperId : undefined,
        helperId2: (helperId2 && helperId2 !== "no-helper") ? helperId2 : undefined,
        helperId3: (helperId3 && helperId3 !== "no-helper") ? helperId3 : undefined,
        deliveryDate: getOfficeTime(timezone),
        items: deliveryItems,
        notes: notes.trim() || undefined,
        photo: deliveryPhoto
      }

      await createDelivery.mutateAsync(deliveryRequest)

      toast({
        title: "Pengantaran Berhasil",
        description: `Pengantaran untuk transaksi ${transaction.id} berhasil dibuat`
      })

      onDeliveryComplete()

    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Gagal membuat pengantaran"
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const totalItemsOrdered = transaction.items?.reduce((sum, item) => sum + item.quantity, 0) || 0
  const totalItemsToDeliver = Object.values(itemQuantities).reduce((sum, qty) => sum + qty, 0)

  return (
    <Dialog open={open} onOpenChange={() => { }}>
      <DialogContent
        className="max-w-md max-h-[90vh] overflow-y-auto"
        hideCloseButton
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            Buat Pengantaran
          </DialogTitle>
          <DialogDescription>
            Transaksi {transaction.id} - {transaction.customerName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Transaction Info */}
          <Card className="bg-blue-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Package className="h-4 w-4" />
                Info Transaksi
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <div className="flex justify-between">
                <span>Tanggal:</span>
                <span>{safeFormatDateTime(transaction.orderDate, "d MMM yyyy, HH:mm")}</span>
              </div>
              <div className="flex justify-between">
                <span>Total:</span>
                <span className="font-medium text-green-600">
                  {new Intl.NumberFormat("id-ID", {
                    style: "currency",
                    currency: "IDR",
                    minimumFractionDigits: 0
                  }).format(transaction.total)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Driver & Helper */}
          <div className="space-y-3">
            <div>
              <Label className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Supir *
                {!isAdminOwner && driverId && (
                  <span className="text-xs text-blue-600 ml-2">(Otomatis terisi)</span>
                )}
              </Label>
              {/* Admin/Owner can select any driver, supir/helper auto-filled and disabled */}
              {isAdminOwner ? (
                <Select value={driverId} onValueChange={setDriverId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih Supir" />
                  </SelectTrigger>
                  <SelectContent>
                    {(drivers as Driver[])?.map((driver: Driver) => (
                      <SelectItem key={driver.id} value={driver.id}>
                        {driver.name}{driver.role?.toLowerCase() === 'helper' ? ' (Helper)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    value={(drivers as Driver[])?.find(d => d.id === driverId)?.name || user?.name || ''}
                    disabled
                    className="bg-gray-100"
                  />
                  <span className="text-xs text-muted-foreground">(Anda)</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div>
                <Label className="flex items-center gap-2">
                  Helper 1 (Opsional)
                  {activeRetasi?.helper_name && helperId && (
                    <span className="text-xs text-blue-600">(Dari Retasi)</span>
                  )}
                </Label>
                <Select value={helperId} onValueChange={setHelperId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih Helper 1" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no-helper">Tidak ada helper</SelectItem>
                    {(drivers as Driver[])
                      ?.filter((driver: Driver) => driver.id !== driverId && driver.id !== helperId2 && driver.id !== helperId3) // Exclude selected driver and other helpers
                      ?.map((driver: Driver) => (
                        <SelectItem key={driver.id} value={driver.id}>
                          {driver.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="flex items-center gap-2">
                  Helper 2 (Opsional)
                  {activeRetasi?.helper_name_2 && helperId2 && (
                    <span className="text-xs text-blue-600">(Dari Retasi)</span>
                  )}
                </Label>
                <Select value={helperId2} onValueChange={setHelperId2}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih Helper 2" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no-helper">Tidak ada helper</SelectItem>
                    {(drivers as Driver[])
                      ?.filter((driver: Driver) => driver.id !== driverId && driver.id !== helperId && driver.id !== helperId3) // Exclude selected driver and other helpers
                      ?.map((driver: Driver) => (
                        <SelectItem key={driver.id} value={driver.id}>
                          {driver.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="flex items-center gap-2">
                  Helper 3 (Opsional)
                  {activeRetasi?.helper_name_3 && helperId3 && (
                    <span className="text-xs text-blue-600">(Dari Retasi)</span>
                  )}
                </Label>
                <Select value={helperId3} onValueChange={setHelperId3}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih Helper 3" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no-helper">Tidak ada helper</SelectItem>
                    {(drivers as Driver[])
                      ?.filter((driver: Driver) => driver.id !== driverId && driver.id !== helperId && driver.id !== helperId2) // Exclude selected driver and other helpers
                      ?.map((driver: Driver) => (
                        <SelectItem key={driver.id} value={driver.id}>
                          {driver.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

          </div>

          {/* Items to Deliver */}
          <div>
            <Label className="flex items-center gap-2 mb-3">
              <Package className="h-4 w-4" />
              Item yang Diantar
            </Label>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {transaction.items?.filter(item => item.product?.id).map((item, index) => {
                const itemKey = `${item.product.id}_${index}`
                const quantityToDeliver = itemQuantities[itemKey] || 0

                return (
                  <div key={itemKey} className="bg-gray-50 p-3 rounded-lg">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{item.product.name}</div>
                        <div className="text-xs text-muted-foreground">
                          Dipesan: {item.quantity} {item.unit}
                        </div>
                        {item.notes && (
                          <div className="text-xs text-blue-600 mt-1">{item.notes}</div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs">Antar:</Label>
                      <Input
                        type="number"
                        value={quantityToDeliver}
                        onChange={(e) => handleQuantityChange(itemKey, parseInt(e.target.value) || 0)}
                        min="0"
                        max={item.quantity}
                        placeholder={`Maks: ${item.quantity}`}
                        className="h-8 text-sm"
                      />
                      <span className="text-xs text-muted-foreground">{item.unit}</span>
                    </div>
                    {quantityToDeliver > item.quantity && (
                      <p className="text-xs text-red-600 mt-1">
                        Jumlah antar tidak boleh melebihi pesanan ({item.quantity} {item.unit})
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Delivery Summary */}
            <div className="bg-blue-50 p-3 rounded-lg mt-3">
              <div className="flex justify-between text-sm">
                <span>Total Dipesan:</span>
                <span className="font-medium">{totalItemsOrdered} item</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Total Diantar:</span>
                <span className="font-medium text-blue-600">{totalItemsToDeliver} item</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <Label>Catatan Pengantaran</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Catatan tambahan untuk pengantaran..."
              rows={2}
            />
          </div>

          {/* Photo Upload */}
          <div>
            <Label className="flex items-center gap-2 mb-3">
              <Camera className="h-4 w-4" />
              Foto Pengantaran *
            </Label>

            {!photoPreview ? (
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                <Camera className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                <p className="text-sm text-gray-600 mb-4">Ambil foto bukti pengantaran</p>
                <Input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoChange}
                  className="hidden"
                  id="photo-upload"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => document.getElementById('photo-upload')?.click()}
                  className="w-full"
                >
                  <Camera className="h-4 w-4 mr-2" />
                  Ambil Foto
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <img
                    src={photoPreview}
                    alt="Preview foto pengantaran"
                    className="w-full h-48 object-cover rounded-lg border"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={removePhoto}
                    className="absolute top-2 right-2"
                  >
                    ✕
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => document.getElementById('photo-upload')?.click()}
                  className="w-full"
                >
                  <Camera className="h-4 w-4 mr-2" />
                  Ganti Foto
                </Button>
                <Input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoChange}
                  className="hidden"
                  id="photo-upload"
                />
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !driverId || !deliveryPhoto}
            className="w-full h-14 text-lg font-bold bg-green-600 hover:bg-green-700"
          >
            <Check className="h-5 w-5 mr-2" />
            {isSubmitting ? "Memproses..." : "Simpan Pengantaran"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}