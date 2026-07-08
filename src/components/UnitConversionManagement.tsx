import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Box, Package, Pencil, Scale, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { useMaterials } from '@/hooks/useMaterials'
import { usePermissions } from '@/hooks/usePermissions'
import { useProducts } from '@/hooks/useProducts'
import {
  groupItemUnitConversions,
  listItemUnitConversions,
  replaceItemUnitConversions,
} from '@/services/itemUnitConversionService'
import type { UnitConversionItemType } from '@/types/unitConversion'
import { parseUnitConversionsText, serializeUnitConversionsText } from '@/utils/unitConversions'

type EditableItem = {
  id: string
  itemType: UnitConversionItemType
  name: string
  baseUnit: string
  description?: string
}

export function UnitConversionManagement() {
  const { materials = [], isLoading: isLoadingMaterials } = useMaterials()
  const { products = [], isLoading: isLoadingProducts } = useProducts()
  const { canManageMaterials, canManageProducts } = usePermissions()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [activeTab, setActiveTab] = useState<UnitConversionItemType>('material')
  const [searchTerm, setSearchTerm] = useState('')
  const [editingItem, setEditingItem] = useState<EditableItem | null>(null)
  const [editorText, setEditorText] = useState('')

  const canEditMaterials = canManageMaterials()
  const canEditProducts = canManageProducts()
  const canEditAny = canEditMaterials || canEditProducts

  const { data: conversions = [], isLoading: isLoadingConversions } = useQuery({
    queryKey: ['itemUnitConversions'],
    queryFn: () => listItemUnitConversions(),
  })

  const groupedConversions = useMemo(() => groupItemUnitConversions(conversions), [conversions])

  const items = useMemo<EditableItem[]>(() => {
    if (activeTab === 'material') {
      return materials.map((material) => ({
        id: material.id,
        itemType: 'material',
        name: material.name,
        baseUnit: material.unit,
        description: material.description,
      }))
    }

    return products.map((product) => ({
      id: product.id,
      itemType: 'product',
      name: product.name,
      baseUnit: product.unit,
      description: product.description,
    }))
  }, [activeTab, materials, products])

  const filteredItems = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase()
    if (!keyword) return items

    return items.filter((item) => {
      const haystack = `${item.name} ${item.baseUnit} ${item.description || ''}`.toLowerCase()
      return haystack.includes(keyword)
    })
  }, [items, searchTerm])

  const saveConversions = useMutation({
    mutationFn: async (payload: { item: EditableItem; text: string }) => {
      await replaceItemUnitConversions({
        itemType: payload.item.itemType,
        itemId: payload.item.id,
        conversions: parseUnitConversionsText(payload.text),
      })
    },
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['itemUnitConversions'] })
      toast({
        title: 'Sukses',
        description: `Konversi satuan untuk ${variables.item.name} berhasil disimpan.`,
      })
      setEditingItem(null)
      setEditorText('')
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Gagal menyimpan konversi',
        description: error?.message || 'Terjadi kesalahan saat menyimpan konversi satuan.',
      })
    },
  })

  const openEditor = (item: EditableItem) => {
    const key = `${item.itemType}:${item.id}`
    const existing = groupedConversions[key] || []
    setEditingItem(item)
    setEditorText(serializeUnitConversionsText(existing, item.baseUnit))
  }

  const renderRows = (itemType: UnitConversionItemType) => {
    const isLoading = itemType === 'material' ? isLoadingMaterials : isLoadingProducts
    const canEdit = itemType === 'material' ? canEditMaterials : canEditProducts

    if (isLoading || isLoadingConversions) {
      return (
        <TableRow>
          <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
            Memuat data konversi...
          </TableCell>
        </TableRow>
      )
    }

    if (filteredItems.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
            {searchTerm ? 'Tidak ada item yang cocok.' : 'Belum ada item untuk diatur.'}
          </TableCell>
        </TableRow>
      )
    }

    return filteredItems.map((item) => {
      const key = `${item.itemType}:${item.id}`
      const existing = groupedConversions[key] || []
      const conversionText = serializeUnitConversionsText(existing, item.baseUnit)

      return (
        <TableRow key={key}>
          <TableCell>
            <div className="font-medium">{item.name}</div>
            {item.description && (
              <div className="text-xs text-muted-foreground line-clamp-2">{item.description}</div>
            )}
          </TableCell>
          <TableCell>
            <Badge variant="secondary">{item.baseUnit || '-'}</Badge>
          </TableCell>
          <TableCell>
            {existing.length > 0 ? (
              <div className="space-y-1">
                {existing
                  .filter((entry) => entry.unitName !== item.baseUnit)
                  .sort((a, b) => a.unitName.localeCompare(b.unitName))
                  .map((entry) => (
                    <div key={`${key}:${entry.unitName}`} className="text-sm">
                      <span className="font-medium">{entry.unitName}</span>
                      <span className="text-muted-foreground"> = {entry.conversionQty} {item.baseUnit}</span>
                    </div>
                  ))}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Belum diatur</span>
            )}
          </TableCell>
          <TableCell>
            <span className="text-xs text-muted-foreground whitespace-pre-line">
              {conversionText || '-'}
            </span>
          </TableCell>
          <TableCell className="text-right">
            <Button
              variant="outline"
              size="sm"
              onClick={() => openEditor(item)}
              disabled={!canEdit}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Atur
            </Button>
          </TableCell>
        </TableRow>
      )
    })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5" />
            Pengaturan Konversi Satuan
          </CardTitle>
          <CardDescription>
            Atur satuan pembelian seperti dus, pack, rim, atau roll untuk bahan dan produk. Format konversi:
            {' '}<span className="font-medium">nama_satuan=jumlah_satuan_dasar</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Cari nama item atau satuan dasar..."
                className="pl-9"
              />
            </div>
            {!canEditAny && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                Anda hanya punya akses lihat. Untuk ubah konversi, butuh permission kelola item.
              </div>
            )}
          </div>

          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as UnitConversionItemType)}>
            <TabsList className="grid w-full max-w-sm grid-cols-2">
              <TabsTrigger value="material" className="flex items-center gap-2">
                <Package className="h-4 w-4" />
                Bahan
              </TabsTrigger>
              <TabsTrigger value="product" className="flex items-center gap-2">
                <Box className="h-4 w-4" />
                Produk
              </TabsTrigger>
            </TabsList>

            <TabsContent value="material" className="mt-4">
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nama Bahan</TableHead>
                      <TableHead>Satuan Dasar</TableHead>
                      <TableHead>Preview Konversi</TableHead>
                      <TableHead>Format Tersimpan</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{renderRows('material')}</TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="product" className="mt-4">
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nama Produk</TableHead>
                      <TableHead>Satuan Dasar</TableHead>
                      <TableHead>Preview Konversi</TableHead>
                      <TableHead>Format Tersimpan</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{renderRows('product')}</TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={!!editingItem} onOpenChange={(open) => !open && !saveConversions.isPending && setEditingItem(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Atur Konversi Satuan</DialogTitle>
            <DialogDescription>
              {editingItem ? (
                <>
                  Item: <span className="font-medium">{editingItem.name}</span>
                  {' · '}Satuan dasar: <span className="font-medium">{editingItem.baseUnit || '-'}</span>
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="unit-conversion-editor">Daftar konversi</Label>
              <Textarea
                id="unit-conversion-editor"
                value={editorText}
                onChange={(event) => setEditorText(event.target.value)}
                placeholder={'dus=24\npack=12\nrim=500'}
                rows={8}
              />
            </div>
            <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              <div>Petunjuk:</div>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Satu baris satu konversi.</li>
                <li>Contoh: <span className="font-medium">dus=24</span> artinya 1 dus = 24 {editingItem?.baseUnit || 'satuan dasar'}.</li>
                <li>Kosongkan semua isi jika ingin menghapus konversi tambahan.</li>
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditingItem(null)
                setEditorText('')
              }}
              disabled={saveConversions.isPending}
            >
              Batal
            </Button>
            <Button
              onClick={() => editingItem && saveConversions.mutate({ item: editingItem, text: editorText })}
              disabled={saveConversions.isPending || !editingItem}
            >
              {saveConversions.isPending ? 'Menyimpan...' : 'Simpan Konversi'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
