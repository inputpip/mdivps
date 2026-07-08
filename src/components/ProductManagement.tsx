"use client"

import { DataTable } from "@/components/DataTable"
import { BOMManagement } from "@/components/BOMManagement"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { NumberInput } from "@/components/ui/number-input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import * as XLSX from "xlsx"
import { useProducts } from "@/hooks/useProducts"
import { useAuth } from "@/hooks/useAuth"
import { useToast } from "@/components/ui/use-toast"
import { usePermissions, PERMISSIONS } from "@/hooks/usePermissions"
import { ProductType } from "@/types/product"
import { Link } from "react-router-dom"
import { useProductStockMovements, STOCK_OUT_REASONS } from "@/hooks/useProductStockMovements"
import { MinusCircle } from "lucide-react"
import { listItemUnitConversions, replaceItemUnitConversions } from '@/services/itemUnitConversionService'
import { parseUnitConversionsText, serializeUnitConversionsText } from '@/utils/unitConversions'

export function ProductManagement() {
  const { products, upsertProduct, deleteProduct, isLoading } = useProducts()
  const { user } = useAuth()
  const { hasPermission } = usePermissions()
  const { toast } = useToast()
  const { createStockOut } = useProductStockMovements()

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    name: "",
    barcode: "",
    type: "Produksi" as ProductType,
    basePrice: 0,
    costPrice: 0,
    unit: "pcs",
    initialStock: 0,
    minStock: 0,
    minOrder: 1,
    description: "",
  })
  const [unitConversionsText, setUnitConversionsText] = useState('')

  // Stock Out Dialog State
  const [stockOutDialogOpen, setStockOutDialogOpen] = useState(false)
  const [stockOutProduct, setStockOutProduct] = useState<any>(null)
  const [stockOutQuantity, setStockOutQuantity] = useState(0)
  const [stockOutReason, setStockOutReason] = useState('')
  const [stockOutNotes, setStockOutNotes] = useState('')

  const canManage = hasPermission(PERMISSIONS.PRODUCTS_MANAGE)
  const canDelete = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'super_admin'

  const baseColumns = [
    {
      key: "name",
      header: "Nama Produk",
      render: (row: any) => (
        <Link
          to={`/products/${row.id}`}
          className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
        >
          {row.name}
        </Link>
      )
    },
    {
      key: "type",
      header: "Jenis",
      render: (row: any) => (
        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${row.type === 'Produksi'
          ? 'bg-emerald-100 text-emerald-700'
          : 'bg-blue-100 text-blue-700'
          }`}>
          {row.type}
        </span>
      ),
    },
    {
      key: "barcode",
      header: "Barcode",
      render: (row: any) => row.barcode || '-',
    },
    { key: "unit", header: "Satuan" },
    {
      key: "basePrice",
      header: "Harga Jual",
      render: (row: any) =>
        new Intl.NumberFormat("id-ID", {
          style: "currency",
          currency: "IDR",
          maximumFractionDigits: 0
        }).format(row.basePrice),
    },
    {
      key: "costPrice",
      header: "HPP",
      render: (row: any) => (
        <span className={row.costPrice > 0 ? 'text-gray-700' : 'text-orange-500'}>
          {row.costPrice > 0
            ? new Intl.NumberFormat("id-ID", {
              style: "currency",
              currency: "IDR",
              maximumFractionDigits: 0
            }).format(row.costPrice)
            : row.type === 'Produksi' ? 'Dari BOM' : 'Rp 0'
          }
        </span>
      ),
    },
    {
      key: "initialStock",
      header: "Stok Awal",
      render: (row: any) => (
        <span className="text-gray-600">
          {row.initialStock || 0}
        </span>
      ),
    },
    {
      key: "currentStock",
      header: "Stok (FIFO)",
      render: (row: any) => (
        <span className={`font-medium ${row.currentStock <= row.minStock ? 'text-red-600' : 'text-green-600'
          }`}>
          {row.currentStock || 0}
        </span>
      ),
    },
    {
      key: "isActive",
      header: "Status",
      render: (row: any) => (
        <Badge variant={row.isActive !== false ? "success" : "destructive"}>
          {row.isActive !== false ? "Aktif" : "Non-Aktif"}
        </Badge>
      )
    },
  ]

  const columns = useMemo(() => {
    let cols = [...baseColumns]

    if (canManage) {
      cols.push({
        key: "bom",
        header: "BOM",
        render: (row: any) => row.type === 'Produksi' ? (
          <BOMManagement
            productId={row.id}
            productName={row.name}
          />
        ) : (
          <span className="text-gray-400 text-xs">-</span>
        ),
      })

      cols.push({
        key: "edit",
        header: "Edit",
        render: (row: any) => (
          <EditProductButton
            product={row}
            onSaved={() => window.location.reload()}
          />
        ),
      })
    }

    if (canDelete) {
      cols.push({
        key: "delete",
        header: "Aksi",
        render: (row: any) => (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => openStockOutDialog(row)}
              disabled={row.currentStock <= 0}
              title="Stok Keluar"
            >
              <MinusCircle className="h-4 w-4 mr-1" />
              Keluar
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-red-600 hover:text-red-700"
              onClick={() => handleDelete(row)}
            >
              Hapus
            </Button>
          </div>
        ),
      })
    }

    return cols
  }, [canManage, canDelete])

  const handleDelete = async (product: any) => {
    if (!confirm(`Hapus produk ${product.name}? Pastikan tidak digunakan dalam transaksi.`)) {
      return
    }

    try {
      await deleteProduct.mutateAsync(product.id)
      toast({
        title: "Success",
        description: "Produk berhasil dihapus"
      })
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Gagal menghapus produk"
      })
    }
  }

  // Stock Out Functions
  const openStockOutDialog = (product: any) => {
    setStockOutProduct(product)
    setStockOutQuantity(0)
    setStockOutReason('')
    setStockOutNotes('')
    setStockOutDialogOpen(true)
  }

  const handleStockOut = () => {
    if (!stockOutProduct || stockOutQuantity <= 0 || !stockOutReason) {
      toast({ variant: "destructive", title: "Error", description: "Lengkapi semua field yang diperlukan" })
      return
    }

    createStockOut.mutate({
      productId: stockOutProduct.id,
      quantity: stockOutQuantity,
      reason: stockOutReason,
      notes: stockOutNotes,
    }, {
      onSuccess: () => {
        toast({ title: "Sukses!", description: `Stok ${stockOutProduct.name} berhasil dikurangi ${stockOutQuantity} unit` })
        setStockOutDialogOpen(false)
        setStockOutProduct(null)
      },
      onError: (error) => {
        toast({ variant: "destructive", title: "Gagal!", description: error.message })
      }
    })
  }

  const handleAdd = async () => {
    if (!form.name.trim()) {
      toast({
        variant: "destructive",
        title: "Validation Error",
        description: "Nama produk wajib diisi"
      })
      return
    }

    if (form.type === 'Produksi') {
      const ok = confirm("Produk jenis Produksi wajib memiliki BOM (Bill of Materials). Anda harus menambahkan material setelah membuat produk. Lanjutkan?")
      if (!ok) return
    }

    try {
      const savedProduct = await upsertProduct.mutateAsync({
        ...form,
        specifications: [],
        materials: [],
      })

      await replaceItemUnitConversions({
        itemType: 'product',
        itemId: savedProduct.id,
        conversions: parseUnitConversionsText(unitConversionsText),
      })

      setOpen(false)
      setForm({
        name: "",
        barcode: "",
        type: "Produksi" as ProductType,
        basePrice: 0,
        costPrice: 0,
        unit: "pcs",
        initialStock: 0,
        minStock: 0,
        minOrder: 1,
        description: "",
      })
      setUnitConversionsText('')

      toast({
        title: "Success",
        description: "Produk berhasil ditambahkan"
      })
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Gagal menambahkan produk"
      })
    }
  }

  const exportXlsx = () => {
    const exportData = products?.map(product => ({
      'Nama Produk': product.name,
      'Barcode': product.barcode || '',
      'Jenis': product.type,
      'Satuan': product.unit,
      'Harga Jual': product.basePrice,
      'HPP': product.costPrice || 0,
      'Stok Awal': product.initialStock || 0,
      'Stok': product.currentStock,
      'Min Stock': product.minStock,
      'Min Order': product.minOrder,
      'Deskripsi': product.description,
    })) || []

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Produk")
    XLSX.writeFile(wb, "produk.xlsx")
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="text-center">Memuat data...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-2">
        <div className="text-lg font-semibold">Produk (Finished Goods)</div>
        <div className="flex gap-2">
          {canManage && (
            <Dialog open={open} onOpenChange={(nextOpen) => {
              setOpen(nextOpen)
              if (!nextOpen) {
                setUnitConversionsText('')
              }
            }}>
              <DialogTrigger asChild>
                <Button size="sm">Tambah</Button>
              </DialogTrigger>
              <DialogContent className="w-[95vw] max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Produk Baru</DialogTitle>
                  <DialogDescription>
                    Tambahkan produk baru ke dalam sistem
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3">
                  <div>
                    <Label htmlFor="name" className="text-sm">
                      Nama Produk
                    </Label>
                    <Input
                      id="name"
                      placeholder="Nama Produk"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="text-sm mt-1"
                    />
                  </div>

                  <div>
                    <Label htmlFor="barcode" className="text-sm">
                      Barcode
                    </Label>
                    <Input
                      id="barcode"
                      placeholder="Barcode produk"
                      value={form.barcode}
                      onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                      className="text-sm mt-1"
                    />
                  </div>


                  <div>
                    <Label htmlFor="type" className="text-sm">
                      Jenis Produk
                    </Label>
                    <Select
                      value={form.type}
                      onValueChange={(value: ProductType) => setForm({ ...form, type: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Pilih jenis" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Produksi">Produksi</SelectItem>
                        <SelectItem value="Jual Langsung">Jual Langsung</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="unit" className="text-sm">
                      Satuan
                    </Label>
                    <Input
                      id="unit"
                      placeholder="pcs, box, kg, dll"
                      value={form.unit}
                      onChange={(e) => setForm({ ...form, unit: e.target.value })}
                      className="text-sm mt-1"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor="basePrice" className="text-sm">
                        Harga Jual
                      </Label>
                      <NumberInput
                        id="basePrice"
                        placeholder="Harga Jual"
                        value={form.basePrice}
                        onChange={(value) => setForm({ ...form, basePrice: value || 0 })}
                        min={0}
                        decimalPlaces={2}
                        className="text-sm mt-1"
                      />
                    </div>
                    {form.type === 'Jual Langsung' ? (
                      <div>
                        <Label htmlFor="costPrice" className="text-sm">
                          Harga Pokok (HPP)
                        </Label>
                        <NumberInput
                          id="costPrice"
                          placeholder="Harga Modal"
                          value={form.costPrice}
                          onChange={(value) => setForm({ ...form, costPrice: value || 0 })}
                          min={0}
                          decimalPlaces={2}
                          className="text-sm mt-1"
                        />
                      </div>
                    ) : (
                      <div>
                        <Label className="text-sm text-gray-500">
                          Harga Pokok (HPP)
                        </Label>
                        <div className="p-2 bg-gray-100 rounded text-sm mt-1 text-gray-600">
                          Otomatis dari BOM
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label htmlFor="initialStock" className="text-sm">
                        Stok Awal
                      </Label>
                      <NumberInput
                        id="initialStock"
                        placeholder="0"
                        value={form.initialStock}
                        onChange={(value) => setForm({ ...form, initialStock: value || 0 })}
                        min={0}
                        decimalPlaces={0}
                        className="text-sm mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="minStock" className="text-sm">
                        Min Stock
                      </Label>
                      <NumberInput
                        id="minStock"
                        placeholder="0"
                        value={form.minStock}
                        onChange={(value) => setForm({ ...form, minStock: value || 0 })}
                        min={0}
                        decimalPlaces={0}
                        className="text-sm mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="minOrder" className="text-sm">
                        Min Order
                      </Label>
                      <NumberInput
                        id="minOrder"
                        placeholder="1"
                        value={form.minOrder}
                        onChange={(value) => setForm({ ...form, minOrder: value || 1 })}
                        min={1}
                        decimalPlaces={0}
                        className="text-sm mt-1"
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="unitConversions" className="text-sm">
                      Konversi Satuan PO (opsional)
                    </Label>
                    <Textarea
                      id="unitConversions"
                      placeholder={"dus=24\npack=12"}
                      value={unitConversionsText}
                      onChange={(e) => setUnitConversionsText(e.target.value)}
                      className="text-sm mt-1"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Format per baris: nama_satuan=jumlah_satuan_dasar. Contoh: dus=24 jika satuan dasar pcs.
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="description" className="text-sm">
                      Deskripsi
                    </Label>
                    <Input
                      id="description"
                      placeholder="Deskripsi produk (opsional)"
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      className="text-sm mt-1"
                    />
                  </div>

                  <Button
                    onClick={handleAdd}
                    className="w-full mt-2"
                    disabled={upsertProduct.isPending}
                  >
                    {upsertProduct.isPending ? "Menyimpan..." : "Simpan"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
          <Button variant="outline" onClick={exportXlsx} size="sm">
            Export
          </Button>
        </div>
      </div>

      <DataTable data={products || []} columns={columns as any} />

      {!canManage && (
        <div className="mt-3 text-sm text-muted-foreground">
          Hanya pengguna dengan permission yang dapat mengelola produk.
        </div>
      )}

      {/* Stock Out Dialog */}
      <Dialog open={stockOutDialogOpen} onOpenChange={setStockOutDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stok Keluar</DialogTitle>
            <DialogDescription>
              Kurangi stok produk: <strong>{stockOutProduct?.name}</strong>
              <br />
              Stok saat ini: <Badge variant="secondary">{stockOutProduct?.currentStock || 0}</Badge>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="stockOutQuantity">Jumlah Keluar</Label>
              <NumberInput
                id="stockOutQuantity"
                value={stockOutQuantity}
                onChange={(value) => setStockOutQuantity(value || 0)}
                min={1}
                max={stockOutProduct?.currentStock || 0}
                decimalPlaces={0}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="stockOutReason">Alasan</Label>
              <Select value={stockOutReason} onValueChange={setStockOutReason}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih alasan..." />
                </SelectTrigger>
                <SelectContent>
                  {STOCK_OUT_REASONS.map((reason) => (
                    <SelectItem key={reason.value} value={reason.value}>
                      {reason.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="stockOutNotes">Catatan (Opsional)</Label>
              <Textarea
                id="stockOutNotes"
                value={stockOutNotes}
                onChange={(e) => setStockOutNotes(e.target.value)}
                placeholder="Catatan tambahan..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStockOutDialogOpen(false)}>Batal</Button>
            <Button
              onClick={handleStockOut}
              disabled={createStockOut.isPending || stockOutQuantity <= 0 || !stockOutReason}
            >
              {createStockOut.isPending ? 'Menyimpan...' : 'Simpan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function EditProductButton({ product, onSaved }: { product: any; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    name: product.name,
    barcode: product.barcode || "",
    type: product.type,
    basePrice: product.basePrice,
    costPrice: product.costPrice || 0,
    unit: product.unit,
    initialStock: product.initialStock || 0,
    minStock: product.minStock,
    minOrder: product.minOrder,
    description: product.description || "",
  })
  const [unitConversionsText, setUnitConversionsText] = useState('')

  const { upsertProduct } = useProducts()
  const { toast } = useToast()

  const loadConversions = async () => {
    try {
      const conversions = await listItemUnitConversions({ itemType: 'product', itemIds: [product.id] })
      setUnitConversionsText(serializeUnitConversionsText(conversions, product.unit))
    } catch (error) {
      console.error('Gagal memuat konversi satuan produk:', error)
      setUnitConversionsText('')
    }
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({
        variant: "destructive",
        title: "Validation Error",
        description: "Nama produk wajib diisi"
      })
      return
    }

    try {
      await upsertProduct.mutateAsync({
        id: product.id,
        ...form,
      })

      await replaceItemUnitConversions({
        itemType: 'product',
        itemId: product.id,
        conversions: parseUnitConversionsText(unitConversionsText),
      })

      setOpen(false)
      onSaved()

      toast({
        title: "Success",
        description: "Produk berhasil diperbarui"
      })
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Gagal memperbarui produk"
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen)
      if (nextOpen) {
        void loadConversions()
      } else {
        setUnitConversionsText('')
      }
    }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[95vw] max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Produk</DialogTitle>
          <DialogDescription>
            Ubah informasi produk yang sudah ada
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label htmlFor="edit-name" className="text-sm">
              Nama Produk
            </Label>
            <Input
              id="edit-name"
              placeholder="Nama Produk"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="text-sm mt-1"
            />
          </div>

          <div>
            <Label htmlFor="edit-barcode" className="text-sm">
              Barcode
            </Label>
            <Input
              id="edit-barcode"
              placeholder="Barcode produk"
              value={form.barcode}
              onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              className="text-sm mt-1"
            />
          </div>


          <div>
            <Label htmlFor="edit-type" className="text-sm">
              Jenis Produk
            </Label>
            <Select
              value={form.type}
              onValueChange={(value: ProductType) => setForm({ ...form, type: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pilih jenis" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Produksi">Produksi</SelectItem>
                <SelectItem value="Jual Langsung">Jual Langsung</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="edit-unit" className="text-sm">
              Satuan
            </Label>
            <Input
              id="edit-unit"
              placeholder="pcs, box, kg, dll"
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              className="text-sm mt-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="edit-basePrice" className="text-sm">
                Harga Jual
              </Label>
              <NumberInput
                id="edit-basePrice"
                placeholder="Harga Jual"
                value={form.basePrice}
                onChange={(value) => setForm({ ...form, basePrice: value || 0 })}
                min={0}
                decimalPlaces={2}
                className="text-sm mt-1"
              />
            </div>
            {form.type === 'Jual Langsung' ? (
              <div>
                <Label htmlFor="edit-costPrice" className="text-sm">
                  Harga Pokok (HPP)
                </Label>
                <NumberInput
                  id="edit-costPrice"
                  placeholder="Harga Modal"
                  value={form.costPrice}
                  onChange={(value) => setForm({ ...form, costPrice: value || 0 })}
                  min={0}
                  decimalPlaces={2}
                  className="text-sm mt-1"
                />
              </div>
            ) : (
              <div>
                <Label className="text-sm text-gray-500">
                  Harga Pokok (HPP)
                </Label>
                <div className="p-2 bg-gray-100 rounded text-sm mt-1 text-gray-600">
                  {form.costPrice ? new Intl.NumberFormat('id-ID').format(form.costPrice) : 0}
                  <span className="text-xs ml-1">(dari BOM)</span>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label htmlFor="edit-initialStock" className="text-sm">
                Stok Awal
              </Label>
              <NumberInput
                id="edit-initialStock"
                placeholder="0"
                value={form.initialStock}
                onChange={(value) => setForm({ ...form, initialStock: value || 0 })}
                min={0}
                decimalPlaces={0}
                className="text-sm mt-1"
              />
            </div>
            <div>
              <Label htmlFor="edit-minStock" className="text-sm">
                Min Stock
              </Label>
              <NumberInput
                id="edit-minStock"
                placeholder="0"
                value={form.minStock}
                onChange={(value) => setForm({ ...form, minStock: value || 0 })}
                min={0}
                decimalPlaces={0}
                className="text-sm mt-1"
              />
            </div>
            <div>
              <Label htmlFor="edit-minOrder" className="text-sm">
                Min Order
              </Label>
              <NumberInput
                id="edit-minOrder"
                placeholder="1"
                value={form.minOrder}
                onChange={(value) => setForm({ ...form, minOrder: value || 1 })}
                min={1}
                decimalPlaces={0}
                className="text-sm mt-1"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="edit-unitConversions" className="text-sm">
              Konversi Satuan PO (opsional)
            </Label>
            <Textarea
              id="edit-unitConversions"
              placeholder={"dus=24\npack=12"}
              value={unitConversionsText}
              onChange={(e) => setUnitConversionsText(e.target.value)}
              className="text-sm mt-1"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Format per baris: nama_satuan=jumlah_satuan_dasar. Contoh: pack=12 jika satuan dasar pcs.
            </p>
          </div>

          <div>
            <Label htmlFor="edit-description" className="text-sm">
              Deskripsi
            </Label>
            <Input
              id="edit-description"
              placeholder="Deskripsi produk (opsional)"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="text-sm mt-1"
            />
          </div>

          <div className="flex justify-end mt-2">
            <Button
              onClick={handleSave}
              className="w-full sm:w-auto"
              disabled={upsertProduct.isPending}
            >
              {upsertProduct.isPending ? "Menyimpan..." : "Simpan"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}