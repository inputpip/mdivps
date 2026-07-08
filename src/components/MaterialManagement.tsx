"use client"
import { useState } from 'react'
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumberInput } from '@/components/ui/number-input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Material } from '@/types/material'
import { useMaterials } from '@/hooks/useMaterials'
import { useAuth } from '@/hooks/useAuth'
import { CreatePurchaseOrderDialog } from './CreatePurchaseOrderDialog'
import { Badge } from './ui/badge'
import { useToast } from './ui/use-toast'
import { Trash2, ChevronDown, ChevronUp, Package, Search, X, FileText, Printer, FileDown, Scale } from 'lucide-react'
import { MaterialStockAdjustmentDialog } from './MaterialStockAdjustmentDialog'
import { isOwner } from '@/utils/roleUtils'
import { useCompanySettings } from '@/hooks/useCompanySettings'
import { format } from 'date-fns'
import { id as idLocale } from 'date-fns/locale'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { usePermissions } from '@/hooks/usePermissions'
import { listItemUnitConversions, replaceItemUnitConversions } from '@/services/itemUnitConversionService'
import { parseUnitConversionsText, serializeUnitConversionsText } from '@/utils/unitConversions'

const materialSchema = z.object({
  name: z.string().min(3, { message: "Nama bahan minimal 3 karakter." }),
  barcode: z.string().optional(),
  type: z.enum(['Stock', 'Beli'], { message: "Pilih jenis bahan." }),
  unit: z.string().min(1, { message: "Satuan harus diisi (cth: meter, lembar, kg)." }),
  pricePerUnit: z.coerce.number().min(0, { message: "Harga tidak boleh negatif." }),
  stock: z.coerce.number().min(0, { message: "Stok tidak boleh negatif." }),
  minStock: z.coerce.number().min(0, { message: "Stok minimal tidak boleh negatif." }).optional(),
  description: z.string().optional(),
}).refine((data) => {
  // For "Beli" type, minStock is not required or should be 0
  if (data.type === 'Beli') {
    return true; // minStock can be anything for "Beli" type
  }
  // For "Stock" type, minStock is required
  return data.minStock !== undefined && data.minStock >= 0;
}, {
  message: "Stok minimal diperlukan untuk jenis Stock.",
  path: ["minStock"],
})

type MaterialFormData = z.infer<typeof materialSchema>

const EMPTY_FORM_DATA: MaterialFormData = {
  name: '',
  barcode: '',
  type: 'Stock',
  unit: '',
  pricePerUnit: 0,
  stock: 0,
  minStock: 10,
  description: '',
};

export const MaterialManagement = () => {
  const { materials, isLoading, upsertMaterial, deleteMaterial } = useMaterials()
  const { user } = useAuth()
  const { toast } = useToast()
  const { settings: companyInfo } = useCompanySettings()
  const { canManageMaterials: checkCanManage } = usePermissions()

  // Permission checks
  const canManageMaterials = checkCanManage()
  const [isRequestPoOpen, setIsRequestPoOpen] = useState(false)
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null)
  const [isAdjustmentOpen, setIsAdjustmentOpen] = useState(false)
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null)
  const [isMaterialListOpen, setIsMaterialListOpen] = useState(true)
  const [typeFilter, setTypeFilter] = useState<string>("")
  const [lowStockFilter, setLowStockFilter] = useState(false)
  const [unitConversionsText, setUnitConversionsText] = useState('')

  const { register, handleSubmit, reset, control, watch, formState: { errors } } = useForm<MaterialFormData>({
    resolver: zodResolver(materialSchema),
    defaultValues: EMPTY_FORM_DATA,
  })

  const selectedType = watch('type')

  // Filter materials based on search query and filters
  const filteredMaterials = materials?.filter(material => {
    const matchesType = !typeFilter || material.type === typeFilter
    const matchesLowStock = !lowStockFilter || (material.type === 'Stock' && material.stock <= (material.minStock || 0))

    return matchesType && matchesLowStock
  }) || []

  const hasActiveFilters = typeFilter || lowStockFilter

  const clearAllFilters = () => {
    setTypeFilter("")
    setLowStockFilter(false)
  }

  const handleOpenRequestPo = (material: Material) => {
    setSelectedMaterial(material)
    setIsRequestPoOpen(true)
  }

  const handleOpenAdjustment = (material: Material) => {
    setSelectedMaterial(material)
    setIsAdjustmentOpen(true)
  }

  const handleEditClick = async (material: Material) => {
    setEditingMaterial(material);
    const { name, barcode, unit, pricePerUnit, stock, minStock, description } = material;
    const type: 'Stock' | 'Beli' = material.type === 'Jasa' ? 'Stock' : material.type;
    const adjustedMinStock = type === 'Beli' ? 0 : minStock;

    reset({ name, barcode: barcode || '', type, unit, pricePerUnit, stock, minStock: adjustedMinStock, description });

    try {
      const conversions = await listItemUnitConversions({ itemType: 'material', itemIds: [material.id] })
      setUnitConversionsText(serializeUnitConversionsText(conversions, material.unit))
    } catch (error) {
      console.error('Gagal memuat konversi satuan material:', error)
      setUnitConversionsText('')
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setEditingMaterial(null);
    setUnitConversionsText('')
    reset(EMPTY_FORM_DATA);
  };

  const handleDeleteClick = (material: Material) => {
    if (window.confirm(`Apakah Anda yakin ingin menghapus bahan "${material.name}"?`)) {
      deleteMaterial.mutate(material.id, {
        onSuccess: () => {
          toast({
            title: "Sukses!",
            description: `Bahan "${material.name}" berhasil dihapus.`,
          })
        },
        onError: (error) => {
          toast({
            variant: "destructive",
            title: "Gagal!",
            description: `Terjadi kesalahan: ${error.message}`,
          })
        },
      })
    }
  }

  const onFormSubmit = async (data: MaterialFormData) => {
    const materialToSave: Partial<Material> = {
      ...data,
      id: editingMaterial?.id,
    };

    if (editingMaterial) {
      delete materialToSave.stock;
    }

    try {
      const savedMaterial = await upsertMaterial.mutateAsync(materialToSave)
      await replaceItemUnitConversions({
        itemType: 'material',
        itemId: savedMaterial.id,
        conversions: parseUnitConversionsText(unitConversionsText),
      })

      toast({
        title: "Sukses!",
        description: `Bahan "${savedMaterial.name}" berhasil ${editingMaterial ? 'diperbarui' : 'ditambahkan'}.`,
      })
      handleCancelEdit();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Gagal!",
        description: `Terjadi kesalahan: ${error.message}`,
      })
    }
  }

  // Fungsi cetak PDF Stok Bahan Baku
  const handlePrintStockPDF = () => {
    if (!materials || materials.length === 0) {
      toast({
        variant: "destructive",
        title: "Tidak ada data",
        description: "Tidak ada data bahan untuk dicetak.",
      })
      return
    }

    const doc = new jsPDF()
    const pageWidth = doc.internal.pageSize.getWidth()
    const margin = 15

    // Header dengan background biru
    doc.setFillColor(59, 130, 246)
    doc.rect(0, 0, pageWidth, 40, 'F')

    // Logo dan info perusahaan
    if (companyInfo?.logo) {
      try {
        doc.addImage(companyInfo.logo, 'PNG', margin, 8, 25, 10, undefined, 'FAST')
      } catch (e) { console.error(e) }
    }

    doc.setTextColor(255, 255, 255)
    doc.setFontSize(16).setFont('helvetica', 'bold')
    doc.text(companyInfo?.name || 'PERUSAHAAN', margin + 30, 15)
    doc.setFontSize(9).setFont('helvetica', 'normal')
    doc.text(companyInfo?.address || '', margin + 30, 21)
    doc.text(companyInfo?.phone || '', margin + 30, 26)

    // Judul laporan
    doc.setFontSize(18).setFont('helvetica', 'bold')
    doc.text('LAPORAN STOK BAHAN BAKU', pageWidth - margin, 18, { align: 'right' })
    doc.setFontSize(10).setFont('helvetica', 'normal')
    doc.text(`Tanggal: ${format(new Date(), 'd MMMM yyyy', { locale: idLocale })}`, pageWidth - margin, 26, { align: 'right' })

    // Ringkasan
    const stockMaterials = filteredMaterials.filter(m => m.type === 'Stock')
    const lowStockCount = stockMaterials.filter(m => m.stock <= (m.minStock || 0)).length
    const totalValue = stockMaterials.reduce((sum, m) => sum + (m.stock * m.pricePerUnit), 0)

    let y = 50
    doc.setTextColor(0, 0, 0)
    doc.setFillColor(245, 247, 250)
    doc.roundedRect(margin, y, pageWidth - 2 * margin, 25, 3, 3, 'F')

    doc.setFontSize(10).setFont('helvetica', 'bold')
    doc.text('RINGKASAN STOK', margin + 5, y + 8)
    doc.setFont('helvetica', 'normal')
    doc.text(`Total Item: ${filteredMaterials.length}`, margin + 5, y + 16)
    doc.text(`Item Stok Rendah: ${lowStockCount}`, margin + 70, y + 16)
    doc.text(`Total Nilai Stok: ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(totalValue)}`, margin + 140, y + 16)

    y += 35

    // Tabel data bahan
    const tableData = filteredMaterials.map((material, index) => {
      const isLowStock = material.type === 'Stock' && material.stock <= (material.minStock || 0)
      const stockValue = material.stock * material.pricePerUnit
      return [
        (index + 1).toString(),
        material.name,
        material.barcode || '-',
        material.type,
        `${material.stock.toLocaleString('id-ID')} ${material.unit}`,
        material.type === 'Stock' ? `${(material.minStock || 0).toLocaleString('id-ID')} ${material.unit}` : '-',
        new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(material.pricePerUnit),
        new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(stockValue),
        isLowStock ? 'RENDAH' : 'OK'
      ]
    })

    autoTable(doc, {
      startY: y,
      head: [['No', 'Nama Bahan', 'Barcode', 'Jenis', 'Stok Saat Ini', 'Stok Minimal', 'Harga/Satuan', 'Nilai Stok', 'Status']],
      body: tableData,
      theme: 'striped',
      headStyles: {
        fillColor: [59, 130, 246],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9,
        halign: 'center'
      },
      bodyStyles: {
        fontSize: 8,
        cellPadding: 3
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252]
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 10 },
        1: { halign: 'left', cellWidth: 40 },
        2: { halign: 'center', cellWidth: 18 },
        3: { halign: 'right', cellWidth: 25 },
        4: { halign: 'right', cellWidth: 25 },
        5: { halign: 'right', cellWidth: 28 },
        6: { halign: 'right', cellWidth: 28 },
        7: { halign: 'center', cellWidth: 18 }
      },
      margin: { left: margin, right: margin },
      didParseCell: (data) => {
        // Warnai status RENDAH dengan merah
        if (data.column.index === 7 && data.cell.raw === 'RENDAH') {
          data.cell.styles.textColor = [220, 38, 38]
          data.cell.styles.fontStyle = 'bold'
        }
        // Warnai status OK dengan hijau
        if (data.column.index === 7 && data.cell.raw === 'OK') {
          data.cell.styles.textColor = [34, 197, 94]
        }
      }
    })

    // Footer
    const finalY = (doc as any).lastAutoTable.finalY + 10
    doc.setFontSize(8).setTextColor(100, 100, 100)
    doc.text(`Dicetak pada: ${format(new Date(), 'd MMMM yyyy HH:mm', { locale: idLocale })} WIB`, margin, finalY)
    doc.text(`Total ${filteredMaterials.length} item bahan`, pageWidth - margin, finalY, { align: 'right' })

    // Simpan PDF
    const filename = `Laporan-Stok-Bahan-${format(new Date(), 'yyyy-MM-dd')}.pdf`
    doc.save(filename)

    toast({
      title: "Berhasil!",
      description: `Laporan stok bahan berhasil diunduh: ${filename}`,
    })
  }

  return (
    <div className="space-y-6">
      <CreatePurchaseOrderDialog
        materialId={selectedMaterial?.id}
        open={isRequestPoOpen}
        onOpenChange={setIsRequestPoOpen}
      >
        <div />
      </CreatePurchaseOrderDialog>

      <MaterialStockAdjustmentDialog
        open={isAdjustmentOpen}
        onOpenChange={setIsAdjustmentOpen}
        material={selectedMaterial}
      />

      {canManageMaterials && (
        <Card>
          <CardHeader>
            <CardTitle>{editingMaterial ? `Edit Bahan: ${editingMaterial.name}` : 'Tambah Bahan Baru'}</CardTitle>
            <CardDescription>
              {editingMaterial ? 'Perbarui detail bahan di bawah ini.' : 'Tambahkan material baru yang akan digunakan dalam produksi.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
                <div className="space-y-2 lg:col-span-2">
                  <Label htmlFor="name">Nama Bahan</Label>
                  <Input id="name" {...register("name")} />
                  {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="barcode">Barcode</Label>
                  <Input id="barcode" {...register("barcode")} placeholder="Barcode bahan" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type">Jenis Bahan</Label>
                  <Controller
                    name="type"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue placeholder="Pilih jenis bahan" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Stock">Stock</SelectItem>
                          <SelectItem value="Beli">Beli</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {errors.type && <p className="text-sm text-destructive">{errors.type.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="unit">Satuan</Label>
                  <Input id="unit" {...register("unit")} placeholder="meter, lembar, kg" />
                  {errors.unit && <p className="text-sm text-destructive">{errors.unit.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pricePerUnit">Harga per Satuan</Label>
                  <Controller
                    name="pricePerUnit"
                    control={control}
                    render={({ field }) => (
                      <NumberInput
                        id="pricePerUnit"
                        value={field.value}
                        onChange={(value) => field.onChange(value || 0)}
                        min={0}
                        decimalPlaces={2}
                      />
                    )}
                  />
                  {errors.pricePerUnit && <p className="text-sm text-destructive">{errors.pricePerUnit.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="stock">Stok Awal (Saat Create)</Label>
                  <Controller
                    name="stock"
                    control={control}
                    render={({ field }) => (
                      <NumberInput
                        id="stock"
                        value={field.value}
                        onChange={(value) => field.onChange(value || 0)}
                        min={0}
                        decimalPlaces={2}
                        disabled={!!editingMaterial}
                      />
                    )}
                  />
                  {editingMaterial && (
                    <p className="text-[10px] text-muted-foreground">
                      Gunakan tombol "Update Stok" di daftar bahan untuk perubahan stok berjalan.
                    </p>
                  )}
                  {errors.stock && <p className="text-sm text-destructive">{errors.stock.message}</p>}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
                {selectedType === 'Stock' && (
                  <div className="space-y-2">
                    <Label htmlFor="minStock">Stok Minimal</Label>
                    <Controller
                      name="minStock"
                      control={control}
                      render={({ field }) => (
                        <NumberInput
                          id="minStock"
                          value={field.value}
                          onChange={(value) => field.onChange(value || 0)}
                          min={0}
                          decimalPlaces={0}
                        />
                      )}
                    />
                    {errors.minStock && <p className="text-sm text-destructive">{errors.minStock.message}</p>}
                  </div>
                )}
                <div className="space-y-2 lg:col-span-2">
                  <Label htmlFor="unitConversions">Konversi Satuan PO (opsional)</Label>
                  <Textarea
                    id="unitConversions"
                    value={unitConversionsText}
                    onChange={(e) => setUnitConversionsText(e.target.value)}
                    placeholder={"dus=24\npack=12"}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Isi satu baris per konversi. Format: nama_satuan=jumlah_satuan_dasar. Contoh jika satuan dasar pcs: dus=24.
                  </p>
                </div>
                <div className="space-y-2 lg:col-span-3">
                  <Label htmlFor="description">Deskripsi (Opsional)</Label>
                  <Textarea id="description" {...register("description")} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={upsertMaterial.isPending}>
                  {upsertMaterial.isPending ? "Menyimpan..." : (editingMaterial ? 'Simpan Perubahan' : 'Simpan Bahan Baru')}
                </Button>
                {editingMaterial && (
                  <Button type="button" variant="outline" onClick={handleCancelEdit}>Batal</Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Collapsible open={isMaterialListOpen} onOpenChange={setIsMaterialListOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Package className="h-5 w-5" />
                    Daftar Bahan & Stok
                  </CardTitle>
                  <CardDescription>
                    {canManageMaterials
                      ? 'Kelola semua bahan baku dan stok yang tersedia.'
                      : user?.role?.toLowerCase() === 'designer'
                        ? 'Lihat informasi bahan baku dan request Purchase Order (PO).'
                        : 'Lihat informasi bahan baku dan stok (hanya baca).'}
                  </CardDescription>
                </div>
                {isMaterialListOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>

              {/* Filter Controls */}
              <div className="mb-6 space-y-4">
                <div className="flex gap-4 items-center flex-wrap">
                  <Select value={typeFilter || "all"} onValueChange={(value) => setTypeFilter(value === "all" ? "" : value)}>
                    <SelectTrigger className="w-[150px]">
                      <SelectValue placeholder="Jenis" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua Jenis</SelectItem>
                      <SelectItem value="Stock">Stock</SelectItem>
                      <SelectItem value="Beli">Beli</SelectItem>
                      <SelectItem value="Jasa">Jasa</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant={lowStockFilter ? "default" : "outline"}
                    size="sm"
                    onClick={() => setLowStockFilter(!lowStockFilter)}
                  >
                    Stok Rendah
                  </Button>
                  {hasActiveFilters && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        Menampilkan {filteredMaterials.length} dari {materials?.length || 0} bahan
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearAllFilters}
                        className="h-8 px-2"
                      >
                        <X className="h-4 w-4" />
                        Clear
                      </Button>
                    </div>
                  )}
                  {/* Tombol Cetak PDF */}
                  <div className="ml-auto">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handlePrintStockPDF}
                      className="flex items-center gap-2"
                    >
                      <FileDown className="h-4 w-4" />
                      Cetak Stok PDF
                    </Button>
                  </div>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nama</TableHead>
                    <TableHead>Barcode</TableHead>
                    <TableHead>Jenis</TableHead>
                    <TableHead>Stok Saat Ini</TableHead>
                    <TableHead>Stok Minimal</TableHead>
                    <TableHead>Harga/Satuan</TableHead>
                    <TableHead>Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={7} className="text-center">Memuat data...</TableCell></TableRow>
                  ) : filteredMaterials?.map((material) => (
                    <TableRow key={material.id}>
                      <TableCell className="font-medium">
                        <Link
                          to={`/materials/${material.id}`}
                          className="text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                        >
                          {material.name}
                        </Link>
                      </TableCell>
                      <TableCell>{material.barcode || '-'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={
                          material.type === 'Stock' ? 'bg-purple-100 text-purple-800' :
                            'bg-orange-100 text-orange-800'
                        }>
                          {material.type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {material.type === 'Stock' ? (
                          <Badge variant={material.stock < (material.minStock || 0) ? "destructive" : "secondary"}>
                            {material.stock} {material.unit}
                          </Badge>
                        ) : (
                          <div className="flex flex-col">
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 mb-1">
                              Total Digunakan: {material.stock} {material.unit}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              (Kontrak/Jasa)
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {material.type === 'Stock' ? (
                          `${material.minStock || 0} ${material.unit}`
                        ) : (
                          <span className="text-muted-foreground text-sm">Tidak ada</span>
                        )}
                      </TableCell>
                      <TableCell>Rp{material.pricePerUnit.toLocaleString()}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {canManageMaterials && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenAdjustment(material)}
                              className="border-blue-300 text-blue-600 hover:bg-blue-50"
                            >
                              <Scale className="h-4 w-4 mr-1" />
                              Update Stok
                            </Button>
                          )}
                          {canManageMaterials && (
                            <Button variant="outline" size="sm" onClick={() => handleEditClick(material)}>Edit</Button>
                          )}
                          <Button variant="secondary" size="sm" onClick={() => handleOpenRequestPo(material)}>
                            Request PO
                          </Button>
                          {isOwner(user) && (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleDeleteClick(material)}
                              disabled={deleteMaterial.isPending}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>


    </div>
  )
}
