"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Truck, User, Clock, Package, Camera, MapPin, Phone, ExternalLink, Printer } from "lucide-react"
import { format } from "date-fns"
import { id as idLocale } from "date-fns/locale/id"
import { PhotoUploadService } from "@/services/photoUploadService"
import { DeliveryNotePDF } from "@/components/DeliveryNotePDF"

interface DeliveryDetailModalProps {
  delivery: any
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeliveryDetailModal({ delivery, open, onOpenChange }: DeliveryDetailModalProps) {
  if (!delivery) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between w-full">
            <DialogTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" />
              Detail Pengantaran #{delivery.deliveryNumber || delivery.id.slice(-6)}
            </DialogTitle>
            <DeliveryNotePDF delivery={delivery}>
              <Button variant="outline" size="sm" className="flex items-center gap-2">
                <Printer className="h-4 w-4" />
                Cetak
              </Button>
            </DeliveryNotePDF>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Basic Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Order ID</label>
                <div className="text-base">{delivery.transactionId}</div>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Tanggal Pengantaran</label>
                <div className="text-base">
                  {format(new Date(delivery.deliveryDate), "d MMMM yyyy 'pukul' HH:mm", { locale: idLocale })}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Status</label>
                <div>
                  <Badge variant="success" className="flex items-center gap-1 w-fit">
                    <Clock className="h-3 w-3" />
                    Selesai
                  </Badge>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Driver</label>
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  {delivery.driverName || '-'}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Helper 1</label>
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  {delivery.helperName || '-'}
                </div>
              </div>
              {delivery.helperId2 && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Helper 2</label>
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    {delivery.helperName2 || '-'}
                  </div>
                </div>
              )}
              {delivery.helperId3 && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Helper 3</label>
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    {delivery.helperName3 || '-'}
                  </div>
                </div>
              )}
              <div>
                <label className="text-sm font-medium text-muted-foreground">Total Transaksi</label>
                <div className="text-lg font-semibold text-green-600">
                  {new Intl.NumberFormat("id-ID", {
                    style: "currency",
                    currency: "IDR",
                    minimumFractionDigits: 0
                  }).format(delivery.transactionTotal)}
                </div>
              </div>
            </div>
          </div>

          <div className="border-t my-4" />

          {/* Customer Info */}
          <div>
            <h3 className="font-medium mb-3 flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Informasi Pelanggan
            </h3>
            <div className="bg-muted/30 p-4 rounded-lg space-y-2">
              <div>
                <span className="font-medium">{delivery.customerName}</span>
              </div>
              {delivery.customerPhone && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Phone className="h-3 w-3" />
                  {delivery.customerPhone}
                </div>
              )}
              {delivery.customerAddress && (
                <div className="text-sm text-muted-foreground">
                  {delivery.customerAddress}
                </div>
              )}
            </div>
          </div>

          {/* Items */}
          {delivery.items && delivery.items.length > 0 && (
            <>
              <div className="border-t my-4" />
              <div>
                <h3 className="font-medium mb-3 flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Item yang Diantar ({delivery.items.length} jenis)
                </h3>
                <div className="space-y-2">
                  {delivery.items.map((item: any, index: number) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                      <div className="flex-1">
                        <div className="font-medium">{item.productName}</div>
                        <div className="text-sm text-muted-foreground">
                          {item.quantityDelivered} {item.unit} diantar
                        </div>
                        {item.notes && (
                          <div className="text-xs text-blue-600 mt-1">{item.notes}</div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="font-medium text-green-600">
                          {new Intl.NumberFormat("id-ID", {
                            style: "currency",
                            currency: "IDR",
                            minimumFractionDigits: 0
                          }).format((item.price || 0) * item.quantityDelivered)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Photo */}
          {delivery.photoUrl && (
            <>
              <div className="border-t my-4" />
              <div>
                <h3 className="font-medium mb-3 flex items-center gap-2">
                  <Camera className="h-4 w-4" />
                  Foto Pengantaran
                </h3>
                <div className="space-y-3">
                  <img
                    src={PhotoUploadService.getPhotoUrl(delivery.photoUrl, 'deliveries')}
                    alt={`Foto pengantaran ${delivery.deliveryNumber || delivery.id.slice(-6)}`}
                    className="w-full max-w-md mx-auto rounded-lg shadow-md cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => window.open(PhotoUploadService.getPhotoUrl(delivery.photoUrl, 'deliveries'), '_blank')}
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                      const parent = target.parentElement;
                      if (parent) {
                        parent.innerHTML = `
                          <div class="w-full h-48 bg-gray-100 rounded-lg flex items-center justify-center">
                            <div class="text-center text-gray-500">
                              <svg class="h-12 w-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                              <p class="text-sm">Foto tidak dapat dimuat</p>
                            </div>
                          </div>
                        `;
                      }
                    }}
                  />
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => window.open(PhotoUploadService.getPhotoUrl(delivery.photoUrl, 'deliveries'), '_blank')}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Buka di Tab Baru
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* Notes */}
          {delivery.notes && (
            <>
              <div className="border-t my-4" />
              <div>
                <h3 className="font-medium mb-3">Catatan</h3>
                <div className="bg-muted/30 p-4 rounded-lg">
                  <p className="text-sm">{delivery.notes}</p>
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}