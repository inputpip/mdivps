"use client"
import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NumberInput } from "@/components/ui/number-input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CalendarIcon, Plus, Trash2 } from "lucide-react"
import { format } from "date-fns"
import { id } from "date-fns/locale/id"
import { cn } from "@/lib/utils"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useMaterials } from "@/hooks/useMaterials"
import { useProducts } from "@/hooks/useProducts"
import { usePurchaseOrders } from "@/hooks/usePurchaseOrders"
import { useSuppliers } from "@/hooks/useSuppliers"
import { useAuth } from "@/hooks/useAuth"
import { useToast } from "@/components/ui/use-toast"
import { PurchaseOrderItem } from "@/types/purchaseOrder"
import { useTimezone } from "@/contexts/TimezoneContext"
import { getOfficeTime } from "@/utils/officeTime"

// Combined item for dropdown (material or product)
interface PurchasableItem {
  id: string;
  name: string;
  unit: string;
  type: 'material' | 'product';
  costPrice?: number; // For products with cost_price
}

const formSchema = z.object({
  supplierId: z.string().min(1, "Supplier harus dipilih"),
  includePpn: z.boolean().default(false),
  ppnMode: z.enum(['include', 'exclude']).default('exclude'),
  expedition: z.string().optional(),
  orderDate: z.date().optional(),
  expectedDeliveryDate: z.date().optional(),
  notes: z.string().optional(),
})

type FormValues = z.infer<typeof formSchema>

interface CreatePurchaseOrderDialogProps {
  materialId?: string
  children?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function CreatePurchaseOrderDialog({ materialId, children, open: externalOpen, onOpenChange: externalOnOpenChange }: CreatePurchaseOrderDialogProps) {
  const [internalOpen, setInternalOpen] = React.useState(false)

  // Use external open state if provided, otherwise use internal state
  const open = externalOpen !== undefined ? externalOpen : internalOpen
  const setOpen = externalOnOpenChange || setInternalOpen
  const { materials, isLoading: isLoadingMaterials } = useMaterials()
  const { products, isLoading: isLoadingProducts } = useProducts()
  const { addPurchaseOrder } = usePurchaseOrders()
  const { activeSuppliers } = useSuppliers()
  const { user } = useAuth()
  const { toast } = useToast()
  const { timezone } = useTimezone()

  // Combine materials and "Jual Langsung" products into one list
  const purchasableItems = React.useMemo<PurchasableItem[]>(() => {
    const items: PurchasableItem[] = [];

    // Add materials
    materials?.forEach(mat => {
      items.push({
        id: `mat-${mat.id}`,
        name: mat.name,
        unit: mat.unit,
        type: 'material'
      });
    });

    // Add "Jual Langsung" products
    products?.filter(p => p.type === 'Jual Langsung').forEach(prod => {
      items.push({
        id: `prod-${prod.id}`,
        name: prod.name,
        unit: prod.unit,
        type: 'product',
        costPrice: prod.costPrice
      });
    });

    return items;
  }, [materials, products]);

  const isLoadingItems = isLoadingMaterials || isLoadingProducts;

  // State for PO items
  const [items, setItems] = React.useState<PurchaseOrderItem[]>([])

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: "onChange",
    defaultValues: {
      supplierId: "",
      includePpn: false,
      ppnMode: "exclude",
      expedition: "",
      orderDate: getOfficeTime(timezone),
      notes: "",
    },
  })

  // Auto-add material if materialId prop is provided
  React.useEffect(() => {
    if (materialId && open) {
      const material = materials?.find(m => m.id === materialId)
      if (material && !items.find(item => item.materialId === materialId)) {
        addItem(materialId)
      }
    }
  }, [materialId, open, materials])

  // Reset form when dialog closes
  React.useEffect(() => {
    if (!open) {
      form.reset({
        supplierId: "",
        includePpn: false,
        ppnMode: "exclude",
        expedition: "",
        orderDate: getOfficeTime(timezone),
        notes: "",
      })
      setItems([])
    }
  }, [open, form])

  const selectedSupplier = activeSuppliers?.find(s => s.id === form.watch("supplierId"))
  const includePpn = form.watch("includePpn") || false
  const ppnMode = form.watch("ppnMode") || "exclude"

  // Calculate totals based on PPN mode
  const itemsTotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0)

  // PPN Include: itemsTotal sudah termasuk PPN, hitung subtotal
  // PPN Exclude: itemsTotal adalah subtotal, tambahkan PPN di atas
  const subtotal = includePpn && ppnMode === 'include'
    ? Math.round(itemsTotal / 1.11)
    : itemsTotal
  const ppnAmount = includePpn
    ? (ppnMode === 'include' ? itemsTotal - subtotal : Math.round(subtotal * 0.11))
    : 0
  const totalCost = includePpn
    ? (ppnMode === 'include' ? itemsTotal : subtotal + ppnAmount)
    : subtotal

  // Add new item
  const addItem = (preselectedItemId?: string) => {
    const newItem: PurchaseOrderItem = {
      id: `temp-${Date.now()}`,
      materialId: undefined,
      productId: undefined,
      itemType: undefined,
      quantity: 1,
      unitPrice: 0,
      notes: "",
    }

    // If preselected, parse and set the item
    if (preselectedItemId) {
      const purchasableItem = purchasableItems.find(pi => pi.id === preselectedItemId);
      if (purchasableItem) {
        if (purchasableItem.type === 'material') {
          newItem.materialId = purchasableItem.id.replace('mat-', '');
          newItem.materialName = purchasableItem.name;
          newItem.itemType = 'material';
        } else {
          newItem.productId = purchasableItem.id.replace('prod-', '');
          newItem.productName = purchasableItem.name;
          newItem.itemType = 'product';
          // Auto-fill cost price for products
          if (purchasableItem.costPrice) {
            newItem.unitPrice = purchasableItem.costPrice;
          }
        }
        newItem.unit = purchasableItem.unit;
      }
    }

    setItems([...items, newItem])
  }

  // Get the combined ID for display in dropdown
  const getItemCombinedId = (item: PurchaseOrderItem): string => {
    if (item.itemType === 'material' && item.materialId) {
      return `mat-${item.materialId}`;
    } else if (item.itemType === 'product' && item.productId) {
      return `prod-${item.productId}`;
    }
    return '';
  }

  // Update item
  const updateItem = (itemId: string, field: keyof PurchaseOrderItem | 'combinedItemId', value: any) => {
    setItems(items.map(item => {
      if (item.id === itemId) {
        const updatedItem = { ...item }

        // Handle combined item selection
        if (field === 'combinedItemId') {
          const purchasableItem = purchasableItems.find(pi => pi.id === value);
          if (purchasableItem) {
            // Reset both IDs first
            updatedItem.materialId = undefined;
            updatedItem.productId = undefined;
            updatedItem.materialName = undefined;
            updatedItem.productName = undefined;

            if (purchasableItem.type === 'material') {
              updatedItem.materialId = purchasableItem.id.replace('mat-', '');
              updatedItem.materialName = purchasableItem.name;
              updatedItem.itemType = 'material';
            } else {
              updatedItem.productId = purchasableItem.id.replace('prod-', '');
              updatedItem.productName = purchasableItem.name;
              updatedItem.itemType = 'product';
              // Auto-fill cost price for products
              if (purchasableItem.costPrice && updatedItem.unitPrice === 0) {
                updatedItem.unitPrice = purchasableItem.costPrice;
              }
            }
            updatedItem.unit = purchasableItem.unit;
          }
        } else {
          (updatedItem as any)[field] = value;
        }

        return updatedItem
      }
      return item
    }))
  }

  // Remove item
  const removeItem = (itemId: string) => {
    setItems(items.filter(item => item.id !== itemId))
  }

  const onSubmit = async (values: FormValues) => {
    if (!user?.name) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "User tidak ditemukan"
      })
      return
    }

    // Validate at least one item
    if (items.length === 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Tambahkan minimal satu item"
      })
      return
    }

    // Validate all items have material or product selected
    const invalidItems = items.filter(item => (!item.materialId && !item.productId) || item.quantity <= 0 || item.unitPrice < 0)
    if (invalidItems.length > 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Semua item harus memiliki material/produk, jumlah, dan harga yang valid"
      })
      return
    }

    const supplier = activeSuppliers?.find(s => s.id === values.supplierId)
    if (!supplier) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Supplier tidak ditemukan"
      })
      return
    }

    const poData = {
      includePpn: values.includePpn,
      ppnMode: values.ppnMode,
      ppnAmount: ppnAmount,
      subtotal: subtotal,
      totalCost: totalCost,
      requestedBy: user.name,
      status: 'Pending' as const,
      supplierId: values.supplierId,
      supplierName: supplier.name,
      expedition: values.expedition,
      orderDate: values.orderDate,
      expectedDeliveryDate: values.expectedDeliveryDate,
      notes: values.notes,
      items: items.map(item => ({
        materialId: item.materialId,
        productId: item.productId,
        itemType: item.itemType,
        materialName: item.materialName,
        productName: item.productName,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        notes: item.notes,
      })),
    }

    try {
      await addPurchaseOrder.mutateAsync(poData)
      toast({
        title: "Sukses",
        description: "Purchase Order berhasil dibuat"
      })
      setOpen(false)
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Gagal",
        description: error instanceof Error ? error.message : "Terjadi kesalahan"
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Buat PO Baru
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Buat Purchase Order Baru</DialogTitle>
          <DialogDescription>
            Isi form di bawah untuk membuat permintaan pembelian bahan baku atau produk jual langsung.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="supplier">Supplier</Label>
            <Select
              value={form.watch("supplierId")}
              onValueChange={(value) => form.setValue("supplierId", value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pilih supplier" />
              </SelectTrigger>
              <SelectContent>
                {activeSuppliers?.map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id}>
                    {supplier.code} - {supplier.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.supplierId && (
              <p className="text-sm text-destructive">
                {form.formState.errors.supplierId.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label>Item yang Dipesan</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addItem()}
              >
                <Plus className="h-4 w-4 mr-2" />
                Tambah Item
              </Button>
            </div>

            {items.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-md">
                Belum ada item. Klik "Tambah Item" untuk menambahkan.
              </div>
            ) : (
              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[300px]">Material / Produk</TableHead>
                      <TableHead className="w-[120px]">Jumlah</TableHead>
                      <TableHead className="w-[150px]">Harga Satuan</TableHead>
                      <TableHead className="w-[150px]">Subtotal</TableHead>
                      <TableHead className="w-[200px]">Catatan</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => {
                      const itemSubtotal = item.quantity * item.unitPrice
                      const selectedCombinedId = getItemCombinedId(item)

                      return (
                        <TableRow key={item.id}>
                          <TableCell>
                            <Select
                              value={selectedCombinedId}
                              onValueChange={(value) => updateItem(item.id!, 'combinedItemId', value)}
                              disabled={isLoadingItems}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder={isLoadingItems ? "Memuat..." : "Pilih material/produk"} />
                              </SelectTrigger>
                              <SelectContent>
                                {isLoadingItems ? (
                                  <SelectItem value="loading" disabled>Memuat data...</SelectItem>
                                ) : purchasableItems.length === 0 ? (
                                  <SelectItem value="empty" disabled>Tidak ada item tersedia</SelectItem>
                                ) : (
                                  <>
                                    {/* Materials Section */}
                                    {purchasableItems.filter(pi => pi.type === 'material').length > 0 && (
                                      <>
                                        <SelectItem value="header-material" disabled className="font-semibold text-xs text-muted-foreground">
                                          -- Bahan Baku --
                                        </SelectItem>
                                        {purchasableItems.filter(pi => pi.type === 'material').map((pi) => (
                                          <SelectItem key={pi.id} value={pi.id}>
                                            {pi.name} ({pi.unit})
                                          </SelectItem>
                                        ))}
                                      </>
                                    )}
                                    {/* Products Section */}
                                    {purchasableItems.filter(pi => pi.type === 'product').length > 0 && (
                                      <>
                                        <SelectItem value="header-product" disabled className="font-semibold text-xs text-muted-foreground">
                                          -- Produk Jual Langsung --
                                        </SelectItem>
                                        {purchasableItems.filter(pi => pi.type === 'product').map((pi) => (
                                          <SelectItem key={pi.id} value={pi.id}>
                                            {pi.name} ({pi.unit})
                                          </SelectItem>
                                        ))}
                                      </>
                                    )}
                                  </>
                                )}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center space-x-2">
                              <NumberInput
                                value={item.quantity}
                                onChange={(value) => updateItem(item.id!, 'quantity', value || 0)}
                                min={0.01}
                                decimalPlaces={2}
                                className="w-20"
                              />
                              {item.unit && (
                                <span className="text-xs text-muted-foreground">
                                  {item.unit}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <NumberInput
                              value={item.unitPrice}
                              onChange={(value) => updateItem(item.id!, 'unitPrice', value || 0)}
                              min={0}
                              decimalPlaces={2}
                              className="w-full"
                              placeholder="0"
                            />
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-sm">
                              Rp {itemSubtotal.toLocaleString('id-ID')}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Input
                              value={item.notes || ""}
                              onChange={(e) => updateItem(item.id!, 'notes', e.target.value)}
                              placeholder="Catatan..."
                              className="w-full"
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeItem(item.id!)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="includePpn"
                checked={form.watch("includePpn")}
                onCheckedChange={(checked) => form.setValue("includePpn", checked as boolean)}
              />
              <Label htmlFor="includePpn" className="cursor-pointer">
                Termasuk PPN 11%
              </Label>
            </div>

            {/* PPN Mode Selection */}
            {includePpn && (
              <div className="ml-6 space-y-2">
                <Label className="text-sm text-muted-foreground">Mode PPN:</Label>
                <div className="flex gap-4">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      name="ppnMode"
                      value="exclude"
                      checked={ppnMode === 'exclude'}
                      onChange={() => form.setValue("ppnMode", "exclude")}
                      className="h-4 w-4"
                    />
                    <span className="text-sm">PPN Exclude (ditambahkan)</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      name="ppnMode"
                      value="include"
                      checked={ppnMode === 'include'}
                      onChange={() => form.setValue("ppnMode", "include")}
                      className="h-4 w-4"
                    />
                    <span className="text-sm">PPN Include (sudah termasuk)</span>
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  {ppnMode === 'exclude'
                    ? 'Harga item belum termasuk PPN. PPN 11% akan ditambahkan di atas subtotal.'
                    : 'Harga item sudah termasuk PPN 11%. Subtotal akan dihitung dari total.'}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Total Cost</Label>
            <div className="px-3 py-2 bg-muted rounded-md space-y-1">
              {includePpn && ppnMode === 'include' && (
                <div className="flex justify-between text-muted-foreground">
                  <span className="text-sm">Total Input:</span>
                  <span className="font-mono text-sm">Rp {itemsTotal.toLocaleString('id-ID')}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Subtotal (DPP):</span>
                <span className="font-mono">Rp {subtotal.toLocaleString('id-ID')}</span>
              </div>
              {includePpn && (
                <div className="flex justify-between text-blue-600">
                  <span className="text-sm">PPN 11% (Piutang Pajak):</span>
                  <span className="font-mono">Rp {ppnAmount.toLocaleString('id-ID')}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold border-t pt-1 mt-1">
                <span>Total Hutang:</span>
                <span className="font-mono">Rp {totalCost.toLocaleString('id-ID')}</span>
              </div>
            </div>
            {selectedSupplier && (
              <div className="text-sm text-muted-foreground">
                Payment Terms: {selectedSupplier.paymentTerms}
              </div>
            )}
            {includePpn && (
              <div className="text-xs text-blue-600 bg-blue-50 p-2 rounded">
                PPN Masukan akan dicatat sebagai Piutang Pajak (akun 1230) saat PO di-approve
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="expedition">Ekspedisi</Label>
            <Input
              id="expedition"
              placeholder="Nama ekspedisi pengiriman (opsional)"
              {...form.register("expedition")}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tanggal PO Dibuat</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !form.watch("orderDate") && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {form.watch("orderDate") ? (
                      format(form.watch("orderDate")!, "PPP", { locale: id })
                    ) : (
                      <span>Pilih tanggal PO</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={form.watch("orderDate")}
                    onSelect={(date) => form.setValue("orderDate", date)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label>Tanggal Diharapkan Diterima</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !form.watch("expectedDeliveryDate") && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {form.watch("expectedDeliveryDate") ? (
                      format(form.watch("expectedDeliveryDate")!, "PPP", { locale: id })
                    ) : (
                      <span>Pilih tanggal pengiriman</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={form.watch("expectedDeliveryDate")}
                    onSelect={(date) => form.setValue("expectedDeliveryDate", date)}
                    disabled={(date) => date < new Date()}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Catatan</Label>
            <Textarea
              id="notes"
              placeholder="Catatan tambahan..."
              {...form.register("notes")}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button
              type="submit"
              disabled={addPurchaseOrder.isPending || items.length === 0}
            >
              {addPurchaseOrder.isPending ? "Membuat..." : "Buat PO"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}