"use client"
import { useState, useEffect } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { NumberInput } from "@/components/ui/number-input"
import { Truck, Package, Calendar, Building2, CheckCircle2, AlertCircle } from 'lucide-react'
import { format } from 'date-fns'
import { id as idLocale } from 'date-fns/locale'
import { PurchaseOrder } from '@/types/purchaseOrder'
import { supabase } from "@/integrations/supabase/client"
import { useAuth } from "@/hooks/useAuth"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import { useTimezone } from "@/contexts/TimezoneContext"
import { getOfficeTime } from "@/utils/officeTime"

interface ReceiveItem {
  id: string
  materialId?: string
  productId?: string
  itemType?: 'material' | 'product'
  name: string
  unit: string
  quantityOrdered: number
  quantityPreviouslyReceived: number
  quantityToReceive: number // Editable by user
  maxReceivable: number
}

interface MobileReceiveGoodsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  purchaseOrder: PurchaseOrder
}

export const MobileReceiveGoodsSheet = ({
  open,
  onOpenChange,
  purchaseOrder
}: MobileReceiveGoodsSheetProps) => {
  const { user } = useAuth()
  const { timezone } = useTimezone()
  const queryClient = useQueryClient()

  const [receiveItems, setReceiveItems] = useState<ReceiveItem[]>([])
  const [isLoadingItems, setIsLoadingItems] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Fetch PO items when dialog opens
  useEffect(() => {
    const fetchPoItems = async () => {
      if (!purchaseOrder || !open) return

      setIsLoadingItems(true)
      try {
        const { data, error } = await supabase
          .from('purchase_order_items')
          .select(`
            id,
            material_id,
            product_id,
            item_type,
            quantity,
            unit_price,
            quantity_received,
            notes,
            material_name,
            product_name,
            unit,
            materials:material_id (
              name,
              unit
            ),
            products:product_id (
              name,
              unit
            )
          `)
          .eq('purchase_order_id', purchaseOrder.id)

        if (error) throw error

        if (data && data.length > 0) {
          const items: ReceiveItem[] = data.map((item: any) => {
            const isMaterial = item.item_type === 'material' || item.material_id != null
            const name = isMaterial
              ? (item.materials?.name || item.material_name || 'Unknown Material')
              : (item.products?.name || item.product_name || 'Unknown Product')
            const unit = isMaterial
              ? (item.materials?.unit || item.unit || 'pcs')
              : (item.products?.unit || item.unit || 'pcs')
            const qtyOrdered = item.quantity || 0
            const qtyReceived = item.quantity_received || 0
            const maxReceivable = Math.max(0, qtyOrdered - qtyReceived)

            return {
              id: item.id,
              materialId: item.material_id,
              productId: item.product_id,
              itemType: isMaterial ? 'material' : 'product',
              name,
              unit,
              quantityOrdered: qtyOrdered,
              quantityPreviouslyReceived: qtyReceived,
              quantityToReceive: maxReceivable, // Default: terima semua sisa
              maxReceivable,
            }
          })
          setReceiveItems(items)
        } else if (purchaseOrder.materialId) {
          // Fallback to legacy single-item
          setReceiveItems([{
            id: 'legacy',
            materialId: purchaseOrder.materialId,
            itemType: 'material',
            name: purchaseOrder.materialName || 'Unknown',
            unit: purchaseOrder.unit || 'pcs',
            quantityOrdered: purchaseOrder.quantity || 0,
            quantityPreviouslyReceived: 0,
            quantityToReceive: purchaseOrder.quantity || 0,
            maxReceivable: purchaseOrder.quantity || 0,
          }])
        }
      } catch (error) {
        console.error('Error fetching PO items:', error)
        toast.error("Gagal memuat item PO")
      } finally {
        setIsLoadingItems(false)
      }
    }

    fetchPoItems()
  }, [purchaseOrder, open])

  const updateQuantity = (itemId: string, value: number) => {
    setReceiveItems(prev => prev.map(item => {
      if (item.id === itemId) {
        return {
          ...item,
          quantityToReceive: Math.min(Math.max(0, value), item.maxReceivable)
        }
      }
      return item
    }))
  }

  const setAllMax = () => {
    setReceiveItems(prev => prev.map(item => ({
      ...item,
      quantityToReceive: item.maxReceivable
    })))
  }

  const totalItemsToReceive = receiveItems.filter(i => i.quantityToReceive > 0).length
  const isPartialReceive = receiveItems.some(i => i.quantityToReceive < i.maxReceivable && i.maxReceivable > 0)
  const isFullReceive = receiveItems.every(i => i.quantityToReceive === i.maxReceivable)
  const hasAnythingToReceive = receiveItems.some(i => i.quantityToReceive > 0)

  const handleReceive = async () => {
    if (!purchaseOrder) return
    if (!hasAnythingToReceive) {
      toast.error("Tidak ada item yang akan diterima")
      return
    }

    setIsSubmitting(true)

    try {
      const itemsToReceive = receiveItems
        .filter(i => i.quantityToReceive > 0)
        .map(i => ({
          item_id: i.id,
          material_id: i.materialId,
          product_id: i.productId,
          item_type: i.itemType,
          quantity: i.quantityToReceive,
          user_id: user?.id || null,
          user_name: user?.name || user?.email || null,
        }))

      const receivedDate = getOfficeTime(timezone)
      const userNote = user?.name ? `[${user.name}] Terima via Mobile App` : 'Terima via Mobile App'

      const { data, error } = await supabase.rpc('receive_po_partial', {
        p_po_id: purchaseOrder.id,
        p_branch_id: purchaseOrder.branchId,
        p_items: itemsToReceive,
        p_received_date: receivedDate.toISOString().split('T')[0],
        p_notes: userNote,
      })

      if (error) throw error
      const res = Array.isArray(data) ? data[0] : data
      if (!res?.success) throw new Error(res?.error_message || 'Gagal menerima barang')

      const receivedCount = res.materials_received + res.products_received
      toast.success(`${receivedCount} item berhasil diterima${isPartialReceive ? ' (partial)' : ''}`)

      // Invalidasi queries
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] })
      queryClient.invalidateQueries({ queryKey: ['materials'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })

      onOpenChange(false)

    } catch (error) {
      console.error('Error receiving PO:', error)
      toast.error("Gagal menerima barang: " + (error instanceof Error ? error.message : "Terjadi kesalahan"))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[90vh] overflow-y-auto w-full max-w-lg mx-auto p-0 dark:bg-gray-900 flex flex-col">
        <div className="sticky top-0 bg-background/95 backdrop-blur z-10 px-4 pt-6 pb-2 border-b">
          <SheetHeader className="text-left">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 dark:bg-green-900/50 rounded-full flex items-center justify-center shrink-0">
                <Truck className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <SheetTitle className="text-lg leading-tight dark:text-white">Terima PO: #{purchaseOrder.id}</SheetTitle>
                <SheetDescription className="text-xs mt-0.5 dark:text-gray-400">
                  {purchaseOrder.supplierName || 'Multi Items'}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {/* Action Row */}
          <div className="flex justify-between items-center bg-muted/50 p-2 rounded-lg">
            <Badge variant={hasAnythingToReceive ? "default" : "secondary"} className="text-[10px] px-2 py-0.5 h-6">
              {totalItemsToReceive} item akan diterima
            </Badge>
            <Button type="button" variant="outline" size="sm" onClick={setAllMax} className="h-8 text-xs h-7 px-2" disabled={isLoadingItems || receiveItems.length === 0}>
              Terima Semua
            </Button>
          </div>

          {/* Item List */}
          <div className="space-y-3">
            {isLoadingItems ? (
              <div className="text-center py-8 text-muted-foreground flex flex-col items-center">
                <Package className="h-8 w-8 animate-pulse mb-2 text-gray-300" />
                Memuat item PO...
              </div>
            ) : receiveItems.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground flex flex-col items-center">
                <Package className="h-8 w-8 mb-2 text-gray-300 opacity-50" />
                Tidak ada item
              </div>
            ) : (
              receiveItems.map(item => {
                const isComplete = item.quantityPreviouslyReceived + item.quantityToReceive >= item.quantityOrdered;
                return (
                  <Card key={item.id} className="dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
                    <CardContent className="p-3">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex-1 min-w-0 pr-2">
                          <p className="font-semibold text-sm truncate dark:text-white leading-tight">{item.name}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {item.itemType === 'material' ? 'Bahan Baku' : 'Produk'} • {item.quantityOrdered} {item.unit} dipesan
                          </p>
                        </div>
                        <div className="shrink-0 flex flex-col items-end">
                          {item.quantityPreviouslyReceived > 0 && (
                            <Badge variant="secondary" className="text-[10px] px-1 py-0 mb-1 leading-tight h-4">
                              Telah Diterima: {item.quantityPreviouslyReceived} {item.unit}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between border-t border-dashed pt-2 mt-2">
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                          Jml Terima (max: {item.maxReceivable}):
                        </span>

                        {item.maxReceivable > 0 ? (
                          <div className="w-28">
                            <NumberInput
                              value={item.quantityToReceive}
                              onChange={(val) => updateQuantity(item.id, val || 0)}
                              min={0}
                              max={item.maxReceivable}
                              decimalPlaces={2}
                              className="h-8 text-center text-sm"
                            />
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                            <CheckCircle2 className="h-4 w-4" />
                            <span className="text-xs font-semibold">Lengkap</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })
            )}
          </div>

          {/* Warning */}
          {hasAnythingToReceive && (
            <div className="flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/30 rounded-lg border border-yellow-200 dark:border-yellow-700 text-xs">
              <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
              <div className="text-yellow-800 dark:text-yellow-200">
                <p>Pastikan fisik barang benar-benar diterima sesuai jumlah yang diinput sebelum klik konfirmasi.</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="sticky bottom-0 bg-background border-t p-4 z-10 flex gap-3 pb-8">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1 dark:border-gray-600 dark:text-white"
            disabled={isSubmitting}
          >
            Batal
          </Button>
          <Button
            onClick={handleReceive}
            className="flex-1 bg-green-600 hover:bg-green-700"
            disabled={isSubmitting || !hasAnythingToReceive || receiveItems.length === 0}
          >
            {isSubmitting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                Proses...
              </>
            ) : isPartialReceive ? (
              'Terima Partial'
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Konfirmasi Terima
              </>
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
