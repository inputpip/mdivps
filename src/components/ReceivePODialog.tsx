import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { NumberInput } from "@/components/ui/number-input"
import { CalendarIcon, Package, CheckCircle2, AlertCircle } from "lucide-react"
import { format } from "date-fns"
import { id } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { PurchaseOrder, PurchaseOrderItem } from "@/types/purchaseOrder"
import { usePurchaseOrders } from "@/hooks/usePurchaseOrders"
import { useAuth } from "@/hooks/useAuth"
import { toast } from "sonner"
import { supabase } from "@/integrations/supabase/client"
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

interface ReceivePODialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  purchaseOrder: PurchaseOrder | null
}

export function ReceivePODialog({ open, onOpenChange, purchaseOrder }: ReceivePODialogProps) {
  const { timezone } = useTimezone()
  const [notes, setNotes] = useState("")
  const [receivedDate, setReceivedDate] = useState<Date>(getOfficeTime(timezone))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [receiveItems, setReceiveItems] = useState<ReceiveItem[]>([])
  const [isLoadingItems, setIsLoadingItems] = useState(false)

  const { receivePurchaseOrder } = usePurchaseOrders()
  const { user } = useAuth()

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

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setNotes("")
      setReceivedDate(getOfficeTime(timezone))
    }
  }, [open, timezone])

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!purchaseOrder) return
    if (!hasAnythingToReceive) {
      toast.error("Tidak ada item yang akan diterima")
      return
    }

    setIsSubmitting(true)

    try {
      // Build items data for RPC
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

      // Call RPC with partial receive support (5 params only for PostgREST compatibility)
      const userNote = user?.name ? `[${user.name}] ${notes || ''}`.trim() : (notes || null)
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
      onOpenChange(false)

    } catch (error) {
      console.error('Error receiving PO:', error)
      toast.error("Gagal menerima barang: " + (error instanceof Error ? error.message : "Terjadi kesalahan"))
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!purchaseOrder) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[750px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Terima Barang - PO #{purchaseOrder.id}
          </DialogTitle>
          <DialogDescription>
            Atur jumlah barang yang diterima untuk setiap item. Anda bisa melakukan penerimaan partial.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* PO Info */}
          <div className="bg-muted p-3 rounded-lg">
            <div className="flex justify-between items-center">
              <div className="text-sm">
                <span className="text-muted-foreground">Supplier: </span>
                <span className="font-medium">{purchaseOrder.supplierName || 'Tidak ada'}</span>
              </div>
              {purchaseOrder.expedition && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Ekspedisi: </span>
                  <span className="font-medium">{purchaseOrder.expedition}</span>
                </div>
              )}
            </div>
          </div>

          {/* Items Table */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label className="text-base font-semibold">Item yang Diterima</Label>
              <Button type="button" variant="outline" size="sm" onClick={setAllMax}>
                Terima Semua
              </Button>
            </div>

            {isLoadingItems ? (
              <div className="text-center py-8 text-muted-foreground">Memuat item PO...</div>
            ) : receiveItems.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">Tidak ada item</div>
            ) : (
              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[200px]">Item</TableHead>
                      <TableHead className="w-[100px] text-center">Dipesan</TableHead>
                      <TableHead className="w-[100px] text-center">Sudah Diterima</TableHead>
                      <TableHead className="w-[130px] text-center">Terima Kali Ini</TableHead>
                      <TableHead className="w-[80px] text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {receiveItems.map((item) => {
                      const totalAfterReceive = item.quantityPreviouslyReceived + item.quantityToReceive
                      const isComplete = totalAfterReceive >= item.quantityOrdered
                      const hasPartialPrev = item.quantityPreviouslyReceived > 0

                      return (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-medium text-sm">{item.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {item.itemType === 'material' ? 'Bahan Baku' : 'Produk'} • {item.unit}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-center font-mono text-sm">
                            {item.quantityOrdered}
                          </TableCell>
                          <TableCell className="text-center">
                            {hasPartialPrev ? (
                              <Badge variant="secondary" className="font-mono">
                                {item.quantityPreviouslyReceived}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">0</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {item.maxReceivable > 0 ? (
                              <NumberInput
                                value={item.quantityToReceive}
                                onChange={(val) => updateQuantity(item.id, val || 0)}
                                min={0}
                                max={item.maxReceivable}
                                decimalPlaces={2}
                                className="w-24 mx-auto text-center"
                              />
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {item.maxReceivable === 0 ? (
                              <CheckCircle2 className="h-5 w-5 text-green-500 mx-auto" />
                            ) : isComplete ? (
                              <CheckCircle2 className="h-5 w-5 text-green-500 mx-auto" />
                            ) : item.quantityToReceive > 0 ? (
                              <AlertCircle className="h-5 w-5 text-amber-500 mx-auto" />
                            ) : (
                              <span className="text-xs text-muted-foreground">Sisa {item.maxReceivable}</span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Summary badges */}
            {receiveItems.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                <Badge variant={hasAnythingToReceive ? "default" : "secondary"}>
                  {totalItemsToReceive} item akan diterima
                </Badge>
                {isPartialReceive && (
                  <Badge variant="outline" className="text-amber-600 border-amber-300">
                    Penerimaan Partial
                  </Badge>
                )}
                {isFullReceive && hasAnythingToReceive && (
                  <Badge variant="outline" className="text-green-600 border-green-300">
                    Penerimaan Lengkap
                  </Badge>
                )}
              </div>
            )}
          </div>

          {/* Received Date */}
          <div className="space-y-2">
            <Label>Tanggal Barang Diterima</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !receivedDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {receivedDate ? (
                    format(receivedDate, "PPP", { locale: id })
                  ) : (
                    <span>Pilih tanggal diterima</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={receivedDate}
                  onSelect={(date) => date && setReceivedDate(date)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Catatan Tambahan</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Catatan tambahan mengenai penerimaan barang..."
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting || !hasAnythingToReceive}>
              {isSubmitting ? "Menyimpan..." : isPartialReceive ? "Terima Partial" : "Terima Semua Barang"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}