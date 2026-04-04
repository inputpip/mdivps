"use client"
import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { CheckCircle, FileDown, Truck, Package, Calendar, User, FileText } from "lucide-react"
import { format, isValid } from "date-fns"
import { id } from "date-fns/locale/id"
import { Delivery, TransactionDeliveryInfo } from "@/types/delivery"
import { DeliveryNotePDF } from "@/components/DeliveryNotePDF"
import { PhotoUploadService } from "@/services/photoUploadService"

// Helper function to safely format date
function formatDeliveryDate(date: Date | string | null | undefined): string {
  if (!date) return '-';

  try {
    const dateObj = date instanceof Date ? date : new Date(date);
    if (!isValid(dateObj)) return '-';
    return format(dateObj, "d MMMM yyyy, HH:mm", { locale: id });
  } catch {
    return '-';
  }
}

interface DeliveryCompletionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  delivery: Delivery | null
  transaction: TransactionDeliveryInfo | null
}

export function DeliveryCompletionDialog({
  open,
  onOpenChange,
  delivery,
  transaction
}: DeliveryCompletionDialogProps) {

  if (!delivery || !transaction || !delivery.items) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <CheckCircle className="h-6 w-6 text-green-600" />
            <DialogTitle className="text-green-700">Pengantaran Berhasil!</DialogTitle>
          </div>
          <DialogDescription>
            Pengantaran telah berhasil dicatat dan surat jalan telah dibuat.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Delivery Info Card */}
          <Card>
            <CardContent className="pt-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Truck className="h-4 w-4 text-blue-600" />
                    <span className="font-medium">Pengantaran #{delivery.deliveryNumber}</span>
                  </div>
                  <Badge variant="success" className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    Selesai
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span>Customer: {transaction.customerName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span>Order: {transaction.id}</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span>{formatDeliveryDate(delivery.deliveryDate)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Truck className="h-4 w-4 text-muted-foreground" />
                      <span>Driver: {delivery.driverName || '-'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Items Delivered */}
          <Card>
            <CardContent className="pt-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2 font-medium">
                  <Package className="h-4 w-4 text-green-600" />
                  Item yang Diantar
                </div>
                <div className="space-y-2">
                  {delivery.items.map((item, index) => (
                    <div
                      key={item.id}
                      className="flex justify-between items-center p-2 bg-green-50 rounded-md"
                    >
                      <div>
                        <span className="font-medium">{item.productName}</span>
                        {item.notes && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Catatan: {item.notes}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="font-medium text-green-700">
                          {item.quantityDelivered} {item.unit}
                        </div>
                        {item.width && item.height && (
                          <div className="text-xs text-muted-foreground">
                            {item.width} x {item.height}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Notes if any */}
          {delivery.notes && (
            <Card>
              <CardContent className="pt-4">
                <div className="space-y-2">
                  <div className="font-medium text-sm">Catatan Pengantaran:</div>
                  <div className="text-sm bg-yellow-50 p-3 rounded-md border border-yellow-200">
                    {delivery.notes}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3">


            {delivery.photoUrl && (
              <Button
                variant="outline"
                onClick={() => window.open(PhotoUploadService.getPhotoUrl(delivery.photoUrl, 'deliveries'), '_blank')}
                className="flex-1 sm:flex-initial"
              >
                <FileText className="h-4 w-4 mr-2" />
                Lihat Foto
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}