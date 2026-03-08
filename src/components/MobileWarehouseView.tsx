"use client"
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Package, AlertTriangle, ShoppingCart, Truck, Search, Calendar, Building2, CheckCircle2, Factory, Box } from 'lucide-react'
import { useMaterials } from '@/hooks/useMaterials'
import { usePurchaseOrders } from '@/hooks/usePurchaseOrders'
import { useProducts } from '@/hooks/useProducts'
import { useAuth } from '@/hooks/useAuth'
import { MobileCreatePOSheet } from './MobileCreatePOSheet'
import { MobileReceiveGoodsSheet } from './MobileReceiveGoodsSheet'
import { MobileRequestProductionSheet } from './MobileRequestProductionSheet'
import { format } from 'date-fns'
import { id } from 'date-fns/locale'
import { cn } from '@/lib/utils'

export const MobileWarehouseView = () => {
  const { materials, isLoading: isLoadingMaterials } = useMaterials()
  const { purchaseOrders, isLoading: isLoadingPOs, receivePurchaseOrder } = usePurchaseOrders()
  const { products, isLoading: isLoadingProducts } = useProducts()
  const { user } = useAuth()

  const [searchMaterial, setSearchMaterial] = useState('')
  const [searchProduct, setSearchProduct] = useState('')
  const [searchPO, setSearchPO] = useState('')
  const [isCreatePOOpen, setIsCreatePOOpen] = useState(false)
  const [selectedMaterialForPO, setSelectedMaterialForPO] = useState<string | null>(null)
  const [isReceiveSheetOpen, setIsReceiveSheetOpen] = useState(false)
  const [selectedPOForReceive, setSelectedPOForReceive] = useState<any>(null)
  const [isProductionSheetOpen, setIsProductionSheetOpen] = useState(false)
  const [selectedProductForProduction, setSelectedProductForProduction] = useState<string | null>(null)

  const isOwner = user?.role === 'owner'

  // Get all stock materials (type = 'Stock')
  const allStockMaterials = materials?.filter(m => m.type === 'Stock') || []

  // Get all products
  const allProducts = products || []

  // Filter by search
  const filteredMaterials = allStockMaterials.filter(m =>
    m.name.toLowerCase().includes(searchMaterial.toLowerCase())
  )

  // Filter products by search
  const filteredProducts = allProducts.filter(p =>
    p.name.toLowerCase().includes(searchProduct.toLowerCase())
  )

  // Count low stock items for badge
  const lowStockMaterialsCount = allStockMaterials.filter(m => m.stock <= (m.minStock || 0)).length
  const lowStockProductsCount = allProducts.filter(p => p.currentStock <= (p.minStock || 0)).length

  // Filter POs by search
  const filteredPOs = purchaseOrders?.filter(po =>
    po.id.toLowerCase().includes(searchPO.toLowerCase()) ||
    po.supplierName?.toLowerCase().includes(searchPO.toLowerCase()) ||
    po.materialName?.toLowerCase().includes(searchPO.toLowerCase())
  ) || []

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Pending':
        return <Badge variant="secondary" className="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">Pending</Badge>
      case 'Approved':
        return <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">Disetujui</Badge>
      case 'Dikirim':
        return <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300">Dikirim</Badge>
      case 'Diterima':
        return <Badge className="bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300">Diterima</Badge>
      case 'Dibayar':
        return <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">Dibayar</Badge>
      case 'Selesai':
        return <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300">Selesai</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const handleCreatePO = (materialId: string) => {
    setSelectedMaterialForPO(materialId)
    setIsCreatePOOpen(true)
  }

  const handleReceiveGoods = (po: any) => {
    setSelectedPOForReceive(po)
    setIsReceiveSheetOpen(true)
  }

  const handleRequestProduction = (productId: string) => {
    setSelectedProductForProduction(productId)
    setIsProductionSheetOpen(true)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 dark:text-white">
            <Package className="h-5 w-5" />
            Management Gudang
          </CardTitle>
        </CardHeader>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="stock" className="w-full">
        <TabsList className="grid w-full grid-cols-3 h-12 dark:bg-gray-800">
          <TabsTrigger value="stock" className="text-xs data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 px-1">
            <Package className="h-3.5 w-3.5 mr-1" />
            Bahan {lowStockMaterialsCount > 0 && <Badge variant="destructive" className="ml-1 h-4 px-1 text-[10px]">{lowStockMaterialsCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="product" className="text-xs data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 px-1">
            <Box className="h-3.5 w-3.5 mr-1" />
            Produk {lowStockProductsCount > 0 && <Badge variant="destructive" className="ml-1 h-4 px-1 text-[10px]">{lowStockProductsCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="po" className="text-xs data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 px-1">
            <ShoppingCart className="h-3.5 w-3.5 mr-1" />
            PO ({purchaseOrders?.length || 0})
          </TabsTrigger>
        </TabsList>

        {/* Tab: Persediaan Minimal */}
        <TabsContent value="stock" className="mt-4 space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Cari bahan..."
              value={searchMaterial}
              onChange={(e) => setSearchMaterial(e.target.value)}
              className="pl-10 h-10 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
            />
          </div>

          {isLoadingMaterials ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <Package className="h-8 w-8 mx-auto mb-2 animate-pulse" />
              <p>Memuat data...</p>
            </div>
          ) : filteredMaterials.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="font-medium">Tidak ada bahan ditemukan</p>
              <p className="text-sm">Coba ubah kata kunci pencarian</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredMaterials.map((material) => {
                const isOutOfStock = material.stock <= 0
                const isLowStock = material.stock <= (material.minStock || 0)
                const isCritical = material.stock <= (material.minStock || 0) / 2

                return (
                  <Card
                    key={material.id}
                    className={cn(
                      "dark:bg-gray-800 dark:border-gray-700",
                      isOutOfStock && "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20",
                      isCritical && !isOutOfStock && "border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20",
                      isLowStock && !isCritical && !isOutOfStock && "border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20"
                    )}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm truncate dark:text-white">{material.name}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={cn(
                              "text-lg font-bold",
                              isOutOfStock ? "text-red-600 dark:text-red-400" :
                                isCritical ? "text-orange-600 dark:text-orange-400" :
                                  isLowStock ? "text-yellow-600 dark:text-yellow-400" :
                                    "text-green-600 dark:text-green-400"
                            )}>
                              {material.stock}
                            </span>
                            <span className="text-gray-400">/</span>
                            <span className="text-sm text-gray-500 dark:text-gray-400">{material.minStock || 0} min</span>
                            <span className="text-xs text-gray-400">({material.unit})</span>
                          </div>
                          {isOutOfStock && (
                            <Badge variant="destructive" className="mt-1 text-xs">HABIS</Badge>
                          )}
                          {isCritical && !isOutOfStock && (
                            <Badge className="mt-1 text-xs bg-orange-500">KRITIS</Badge>
                          )}
                          {isLowStock && !isCritical && !isOutOfStock && (
                            <Badge className="mt-1 text-xs bg-yellow-500">RENDAH</Badge>
                          )}
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleCreatePO(material.id)}
                          className="ml-2 bg-blue-600 hover:bg-blue-700 h-9"
                        >
                          <ShoppingCart className="h-4 w-4 mr-1" />
                          Pesan
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </TabsContent>

        {/* Tab: Produk Minimal */}
        <TabsContent value="product" className="mt-4 space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Cari produk..."
              value={searchProduct}
              onChange={(e) => setSearchProduct(e.target.value)}
              className="pl-10 h-10 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
            />
          </div>

          {isLoadingProducts ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <Box className="h-8 w-8 mx-auto mb-2 animate-pulse" />
              <p>Memuat data...</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <Box className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="font-medium">Tidak ada produk ditemukan</p>
              <p className="text-sm">Coba ubah kata kunci pencarian</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredProducts.map((product) => {
                const isOutOfStock = product.currentStock <= 0
                const isLowStock = product.currentStock <= (product.minStock || 0)
                const isCritical = product.currentStock <= (product.minStock || 0) / 2
                const isProduction = product.type === 'Produksi'

                return (
                  <Card
                    key={product.id}
                    className={cn(
                      "dark:bg-gray-800 dark:border-gray-700",
                      isOutOfStock && "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20",
                      isCritical && !isOutOfStock && "border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20",
                      isLowStock && !isCritical && !isOutOfStock && "border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20"
                    )}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-sm truncate dark:text-white">{product.name}</p>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] px-1.5 py-0",
                                isProduction ? "border-amber-500 text-amber-600" : "border-blue-500 text-blue-600"
                              )}
                            >
                              {isProduction ? 'Produksi' : 'Beli'}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={cn(
                              "text-lg font-bold",
                              isOutOfStock ? "text-red-600 dark:text-red-400" :
                                isCritical ? "text-orange-600 dark:text-orange-400" :
                                  isLowStock ? "text-yellow-600 dark:text-yellow-400" :
                                    "text-green-600 dark:text-green-400"
                            )}>
                              {product.currentStock}
                            </span>
                            <span className="text-gray-400">/</span>
                            <span className="text-sm text-gray-500 dark:text-gray-400">{product.minStock || 0} min</span>
                            <span className="text-xs text-gray-400">({product.unit})</span>
                          </div>
                          {isOutOfStock && (
                            <Badge variant="destructive" className="mt-1 text-xs">HABIS</Badge>
                          )}
                          {isCritical && !isOutOfStock && (
                            <Badge className="mt-1 text-xs bg-orange-500">KRITIS</Badge>
                          )}
                          {isLowStock && !isCritical && !isOutOfStock && (
                            <Badge className="mt-1 text-xs bg-yellow-500">RENDAH</Badge>
                          )}
                        </div>
                        {isProduction ? (
                          <Button
                            size="sm"
                            onClick={() => handleRequestProduction(product.id)}
                            className="ml-2 bg-amber-600 hover:bg-amber-700 h-9"
                          >
                            <Factory className="h-4 w-4 mr-1" />
                            Produksi
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => {
                              // For "Jual Langsung" products, open PO sheet
                              // The PO dialog already supports products
                              setSelectedMaterialForPO(null)
                              setIsCreatePOOpen(true)
                            }}
                            className="ml-2 bg-blue-600 hover:bg-blue-700 h-9"
                          >
                            <ShoppingCart className="h-4 w-4 mr-1" />
                            Pesan PO
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </TabsContent>

        {/* Tab: Daftar PO */}
        <TabsContent value="po" className="mt-4 space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Cari PO..."
              value={searchPO}
              onChange={(e) => setSearchPO(e.target.value)}
              className="pl-10 h-10 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
            />
          </div>

          {isLoadingPOs ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <ShoppingCart className="h-8 w-8 mx-auto mb-2 animate-pulse" />
              <p>Memuat data...</p>
            </div>
          ) : filteredPOs.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <ShoppingCart className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Belum ada Purchase Order</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredPOs.map((po) => (
                <Card key={po.id} className="dark:bg-gray-800 dark:border-gray-700">
                  <CardContent className="p-3">
                    <div className="space-y-2">
                      {/* Header: PO Number & Status */}
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-sm dark:text-white">{po.id}</p>
                        {getStatusBadge(po.status)}
                      </div>

                      {/* Supplier & Date */}
                      <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                        <div className="flex items-center gap-1">
                          <Building2 className="h-3.5 w-3.5" />
                          <span>{po.supplierName || 'No Supplier'}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          <span>{po.createdAt ? format(new Date(po.createdAt), 'dd MMM yyyy', { locale: id }) : '-'}</span>
                        </div>
                      </div>

                      {/* Material & Total */}
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-gray-600 dark:text-gray-300 truncate flex-1">
                          {po.materialName || 'Multi Items'}
                        </p>
                        <p className="font-bold text-green-600 dark:text-green-400">
                          {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(po.totalCost || 0)}
                        </p>
                      </div>

                      {/* Actions - Only show Terima Barang if status is Dikirim */}
                      {po.status === 'Dikirim' && (
                        <Button
                          size="sm"
                          onClick={() => handleReceiveGoods(po)}
                          className="w-full mt-2 bg-green-600 hover:bg-green-700"
                        >
                          <Truck className="h-4 w-4 mr-2" />
                          Terima Barang
                        </Button>
                      )}

                      {/* Info for non-owner users */}
                      {!isOwner && po.status === 'Pending' && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 italic mt-1">
                          Menunggu persetujuan Owner
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Create PO Sheet (Mobile-friendly) */}
      <MobileCreatePOSheet
        open={isCreatePOOpen}
        onOpenChange={setIsCreatePOOpen}
        materialId={selectedMaterialForPO || undefined}
      />

      {/* Receive Goods Sheet */}
      {selectedPOForReceive && (
        <MobileReceiveGoodsSheet
          open={isReceiveSheetOpen}
          onOpenChange={(v) => {
            setIsReceiveSheetOpen(v)
            if (!v) setSelectedPOForReceive(null)
          }}
          purchaseOrder={selectedPOForReceive}
        />
      )}

      {/* Production Sheet */}
      <MobileRequestProductionSheet
        open={isProductionSheetOpen}
        onOpenChange={setIsProductionSheetOpen}
        productId={selectedProductForProduction || undefined}
      />
    </div>
  )
}
