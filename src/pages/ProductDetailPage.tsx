"use client"

import { useParams, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Package, Edit, Loader2 } from 'lucide-react'
import { useProducts } from '@/hooks/useProducts'
import { useToast } from '@/components/ui/use-toast'
import { ProductPricingManagement } from '@/components/ProductPricingManagement'
import { CustomerPricingManagement } from '@/components/CustomerPricingManagement'
import { formatCurrency } from '@/utils/currency'

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { products, isLoading, upsertProduct } = useProducts()
  const { toast } = useToast()

  const product = products?.find(p => p.id === id)

  const handleToggleActive = async (checked: boolean) => {
    if (!product) return

    try {
      await upsertProduct.mutateAsync({
        id: product.id,
        isActive: checked
      })
      toast({
        title: checked ? "Produk Diaktifkan" : "Produk Dinonaktifkan",
        description: `Produk ${product.name} sekarang ${checked ? 'tampil' : 'tidak tampil'} di POS.`
      })
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Gagal Update",
        description: error.message
      })
    }
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
          <div className="h-96 bg-gray-200 rounded"></div>
        </div>
      </div>
    )
  }

  if (!product) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-12">
              <Package className="h-16 w-16 mx-auto text-gray-400 mb-4" />
              <h2 className="text-xl font-semibold mb-2">Produk Tidak Ditemukan</h2>
              <p className="text-gray-600 mb-4">
                Produk yang Anda cari tidak ditemukan atau telah dihapus.
              </p>
              <Button onClick={() => navigate('/products')}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Kembali ke Daftar Produk
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/products')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Detail Produk</h1>
            <p className="text-muted-foreground">
              Kelola informasi dan pengaturan harga produk
            </p>
          </div>
        </div>
        <Button onClick={() => navigate(`/products/${id}/edit`)}>
          <Edit className="h-4 w-4 mr-2" />
          Edit Produk
        </Button>
      </div>

      {/* Product Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Informasi Produk
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div>
              <h3 className="font-semibold text-lg mb-2">{product.name}</h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Kategori:</span>
                  <Badge variant="outline">{product.category}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Tipe:</span>
                  <Badge variant="secondary">{product.type}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Satuan:</span>
                  <span className="text-sm font-medium">{product.unit}</span>
                </div>
                <div className="flex items-center gap-2 pt-2 border-t mt-2">
                  <Switch
                    id="product-active"
                    checked={product.isActive}
                    onCheckedChange={handleToggleActive}
                    disabled={upsertProduct.isPending}
                  />
                  <Label htmlFor="product-active" className="cursor-pointer">
                    {product.isActive ? 'Status: Aktif' : 'Status: Tidak Aktif'}
                  </Label>
                  {upsertProduct.isPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-3">Harga & Stock</h4>
              <div className="space-y-2">
                <div>
                  <span className="text-sm text-muted-foreground">Harga Dasar:</span>
                  <p className="text-lg font-bold text-green-600">
                    {formatCurrency(product.basePrice)}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">Stock Saat Ini:</span>
                  <p className="text-lg font-bold text-blue-600">
                    {product.currentStock} {product.unit}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">Min Stock:</span>
                  <p className="text-sm">{product.minStock} {product.unit}</p>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">Min Order:</span>
                  <p className="text-sm">{product.minOrder} {product.unit}</p>
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-3">Informasi Lainnya</h4>
              <div className="space-y-2">
                <div>
                  <span className="text-sm text-muted-foreground">Dibuat:</span>
                  <p className="text-sm">
                    {new Date(product.createdAt).toLocaleDateString('id-ID')}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">Diupdate:</span>
                  <p className="text-sm">
                    {new Date(product.updatedAt).toLocaleDateString('id-ID')}
                  </p>
                </div>
                {product.description && (
                  <div>
                    <span className="text-sm text-muted-foreground">Deskripsi:</span>
                    <p className="text-sm mt-1">{product.description}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Specifications */}
      {product.specifications && product.specifications.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Spesifikasi</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {product.specifications.map((spec, index) => (
                <div key={index} className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">{spec.key}:</span>
                  <span className="font-medium">{spec.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pricing Management */}
      <ProductPricingManagement
        productId={product.id}
        productName={product.name}
        basePrice={product.basePrice}
        currentStock={product.currentStock}
      />

      {/* Customer Pricing Management */}
      <CustomerPricingManagement
        productId={product.id}
        productName={product.name}
        basePrice={product.basePrice}
      />
    </div>
  )
}