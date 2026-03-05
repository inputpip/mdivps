"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/use-toast"
import { Camera, Package, CheckCircle, Clock, AlertCircle, FileText, Trash2 } from "lucide-react"
import { DeliveryNotePDF } from "@/components/DeliveryNotePDF"
import { format, isValid } from "date-fns"
import { id as idLocale } from "date-fns/locale/id"
import { TransactionDeliveryInfo, Delivery } from "@/types/delivery"
import { useDeliveries } from "@/hooks/useDeliveries"
import { useAuth } from "@/hooks/useAuth"
import { Link } from "react-router-dom"
import { useTimezone } from "@/contexts/TimezoneContext"

interface DeliveryManagementProps {
  transaction: TransactionDeliveryInfo;
  onClose?: () => void;
  embedded?: boolean; // Add embedded mode prop
  onDeliveryCreated?: (delivery: Delivery, transaction: TransactionDeliveryInfo) => void;
  defaultOpen?: boolean;
}

export function DeliveryManagement({ transaction, onClose, embedded = false, onDeliveryCreated, defaultOpen = false }: DeliveryManagementProps) {
  const { toast } = useToast()
  const { user } = useAuth()
  const { timezone } = useTimezone()
  const { deleteDelivery } = useDeliveries()

  const [isDeleting, setIsDeleting] = useState<string | null>(null)

  // Check if user is admin or owner
  const canDeleteDelivery = user?.role === 'admin' || user?.role === 'owner'

  const handleDeleteDelivery = async (deliveryId: string, deliveryNumber: number) => {
    if (!confirm(`Apakah Anda yakin ingin menghapus pengantaran #${deliveryNumber}? Stock akan dikembalikan.`)) {
      return
    }

    setIsDeleting(deliveryId)
    try {
      await deleteDelivery.mutateAsync(deliveryId)
      toast({
        title: "Pengantaran Berhasil Dihapus",
        description: `Pengantaran #${deliveryNumber} telah dihapus dan stock dikembalikan`,
      })
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Gagal menghapus pengantaran"
      })
    } finally {
      setIsDeleting(null)
    }
  }

  const getStatusIcon = (delivered: number, total: number) => {
    if (delivered === 0) return <Clock className="h-4 w-4 text-yellow-500" />
    if (delivered >= total) return <CheckCircle className="h-4 w-4 text-green-500" />
    return <AlertCircle className="h-4 w-4 text-blue-500" />
  }

  const getStatusText = (delivered: number, total: number) => {
    if (delivered === 0) return "Belum Diantar"
    if (delivered >= total) return "Selesai"
    return "Sebagian"
  }

  const getStatusVariant = (delivered: number, total: number) => {
    if (delivered === 0) return "secondary"
    if (delivered >= total) return "success"
    return "default"
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Pengantaran - {transaction.customerName}
            </CardTitle>
            <CardDescription>
              Order #{transaction.id} • {transaction.orderDate && isValid(new Date(transaction.orderDate)) ? format(new Date(transaction.orderDate), "d MMMM yyyy", { locale: idLocale }) : '-'}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {transaction.deliveries.length > 0 && (
              <DeliveryNotePDF
                delivery={transaction.deliveries[0]}
                transactionInfo={transaction}
              >
                <Button variant="outline" className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Cetak Surat Jalan
                </Button>
              </DeliveryNotePDF>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Delivery Summary */}
          <div>
            <h4 className="font-medium mb-3">Status Pengantaran</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead>Dipesan</TableHead>
                  <TableHead>Diantar</TableHead>
                  <TableHead>Sisa</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transaction.deliverySummary
                  .filter(item => item.productName && item.productName !== 'Unknown Product')
                  .map((item, index) => (
                    <TableRow key={`summary-${item.productId}-${index}`}>
                      <TableCell>
                        <div>
                          <Link
                            to={`/products/${item.productId}`}
                            className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            {item.productName}
                          </Link>
                        </div>
                      </TableCell>
                      <TableCell>{item.orderedQuantity} {item.unit}</TableCell>
                      <TableCell>{item.deliveredQuantity} {item.unit}</TableCell>
                      <TableCell>{item.remainingQuantity} {item.unit}</TableCell>
                      <TableCell>
                        <Badge
                          variant={getStatusVariant(item.deliveredQuantity, item.orderedQuantity)}
                          className="flex items-center gap-1 w-fit"
                        >
                          {getStatusIcon(item.deliveredQuantity, item.orderedQuantity)}
                          {getStatusText(item.deliveredQuantity, item.orderedQuantity)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>

          {/* Delivery History */}
          {transaction.deliveries.length > 0 && (
            <div>
              <h4 className="font-medium mb-3">Riwayat Pengantaran</h4>
              <div className="space-y-3">
                {transaction.deliveries.map((delivery) => (
                  <Card key={delivery.id} className="border-l-4 border-l-blue-500">
                    <CardContent className="pt-4">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <div className="font-medium">
                            Pengantaran #{delivery.deliveryNumber}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {delivery.deliveryDate && isValid(new Date(delivery.deliveryDate)) ? format(new Date(delivery.deliveryDate), "d MMMM yyyy, HH:mm", { locale: idLocale }) : '-'}
                            {delivery.driverId && ` • Supir: ${delivery.driverName || delivery.driverId}`}
                            {delivery.helperId && ` • Helper 1: ${delivery.helperName || delivery.helperId}`}
                            {delivery.helperId2 && ` • Helper 2: ${delivery.helperName2 || delivery.helperId2}`}
                            {delivery.helperId3 && ` • Helper 3: ${delivery.helperName3 || delivery.helperId3}`}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {delivery.photoUrl && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => window.open(delivery.photoUrl, '_blank')}
                            >
                              <Camera className="h-4 w-4 mr-1" />
                              Lihat Foto
                            </Button>
                          )}
                          {/* Moved Dot Matrix Print Button here, next to Delete */}
                          <DeliveryNotePDF delivery={delivery} transactionInfo={transaction} />

                          {canDeleteDelivery && (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleDeleteDelivery(delivery.id, delivery.deliveryNumber)}
                              disabled={isDeleting === delivery.id}
                            >
                              <Trash2 className="h-4 w-4 mr-1" />
                              {isDeleting === delivery.id ? "Menghapus..." : "Hapus"}
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <div className="text-sm font-medium mb-1">Item Diantar:</div>
                          <ul className="text-sm text-muted-foreground space-y-1">
                            {delivery.items.map((item, index) => (
                              <li key={`delivery-item-${delivery.id}-${item.productId}-${index}`}>
                                <Link
                                  to={`/products/${item.productId}`}
                                  className="text-blue-600 hover:text-blue-800 hover:underline"
                                >
                                  {item.productName}
                                </Link>
                                : {item.quantityDelivered} {item.unit}
                                {item.notes && (
                                  <span className="text-blue-600"> • {item.notes}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>

                        {delivery.notes && (
                          <div>
                            <div className="text-sm font-medium mb-1">Catatan:</div>
                            <div className="text-sm text-muted-foreground">{delivery.notes}</div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>

    </Card>
  )
}
