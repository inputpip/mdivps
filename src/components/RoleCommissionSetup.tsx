"use client"

import { useState, useMemo, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/use-toast"
import { useProducts } from "@/hooks/useProducts"
import { useCommissionRules } from "@/hooks/useCommissions"
import { Loader2, Save, Calculator, Users } from "lucide-react"

// Semua role yang tersedia
const ALL_ROLES: { value: string; label: string }[] = [
  { value: 'sales', label: 'Sales' },
  { value: 'driver', label: 'Driver / Supir' },
  { value: 'helper', label: 'Helper / Kenek' },
  { value: 'delivery_2_helpers', label: 'Pengantaran 2 Helper (Supir + 2 Kenek / Bagi 3)' },
  { value: 'delivery_3_helpers', label: 'Pengantaran 3 Helper (Supir + 3 Kenek / Bagi 4)' },
  { value: 'cashier', label: 'Kasir' },
  { value: 'designer', label: 'Designer' },
  { value: 'operator', label: 'Operator' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'admin', label: 'Admin' },
  { value: 'branch_admin', label: 'Admin Cabang' },
  { value: 'owner', label: 'Owner' },
]

type ProductCommissionRow = {
  productId: string
  productName: string
  rate: number
}

export function RoleCommissionSetup() {
  const { toast } = useToast()
  const { products, isLoading: loadingProducts } = useProducts()
  const { rules, isLoading: loadingRules, updateCommissionRate } = useCommissionRules()

  const [selectedRole, setSelectedRole] = useState<string>('')
  const [productRates, setProductRates] = useState<ProductCommissionRow[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [bulkRate, setBulkRate] = useState<string>('')

  // Get existing rates for selected role
  const existingRatesForRole = useMemo(() => {
    if (!rules || !selectedRole) return {}

    const rateMap: Record<string, number> = {}
    rules.forEach(rule => {
      if (rule.role === selectedRole) {
        rateMap[rule.productId] = rule.ratePerQty
      }
    })
    return rateMap
  }, [rules, selectedRole])

  // Initialize product rates when role or products change
  useEffect(() => {
    if (!products || !selectedRole) {
      setProductRates([])
      return
    }

    const rates = products.map(p => ({
      productId: p.id,
      productName: p.name,
      rate: existingRatesForRole[p.id] || 0
    }))
    setProductRates(rates)
  }, [products, selectedRole, existingRatesForRole])

  // Get summary of roles with commission configured
  const rolesWithCommission = useMemo(() => {
    if (!rules) return []

    const roleSet = new Set<string>()
    rules.forEach(rule => {
      if (rule.ratePerQty > 0) {
        roleSet.add(rule.role)
      }
    })
    return Array.from(roleSet)
  }, [rules])

  const updateRate = (productId: string, newRate: number) => {
    setProductRates(prev =>
      prev.map(row =>
        row.productId === productId ? { ...row, rate: newRate } : row
      )
    )
  }

  const applyBulkRate = () => {
    const rate = parseFloat(bulkRate)
    if (isNaN(rate) || rate < 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Masukkan nilai rate yang valid"
      })
      return
    }

    setProductRates(prev => prev.map(row => ({ ...row, rate })))
    toast({
      title: "Berhasil",
      description: `Rate ${rate.toLocaleString('id-ID')} diterapkan ke semua produk`
    })
  }

  const saveCommissions = async () => {
    if (!selectedRole) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Pilih role terlebih dahulu"
      })
      return
    }

    setIsSubmitting(true)
    try {
      let savedCount = 0

      for (const row of productRates) {
        const existingRate = existingRatesForRole[row.productId] || 0

        // Only update if rate changed
        if (row.rate !== existingRate) {
          await updateCommissionRate(row.productId, selectedRole, row.rate)
          savedCount++
        }
      }

      toast({
        title: "Berhasil",
        description: savedCount > 0
          ? `${savedCount} pengaturan komisi untuk ${selectedRole} berhasil disimpan`
          : "Tidak ada perubahan yang disimpan"
      })
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Gagal menyimpan pengaturan komisi"
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const getRoleLabel = (role: string) => {
    const found = ALL_ROLES.find(r => r.value === role)
    return found?.label || role
  }

  if (loadingProducts || loadingRules) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <span className="ml-2">Memuat data...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-6 w-6" />
            Setup Komisi per Jabatan
          </CardTitle>
          <CardDescription className="text-indigo-100">
            Atur rate komisi per produk untuk setiap jabatan/role karyawan
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Role Summary */}
      {rolesWithCommission.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              Role dengan Komisi Aktif
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {rolesWithCommission.map(role => (
                <Badge
                  key={role}
                  variant="outline"
                  className="cursor-pointer hover:bg-blue-50"
                  onClick={() => setSelectedRole(role)}
                >
                  {getRoleLabel(role)}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Role Selection & Bulk Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Pilih Jabatan</CardTitle>
          <CardDescription>
            Pilih jabatan yang ingin diatur komisinya
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Jabatan / Role</Label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih jabatan..." />
                </SelectTrigger>
                <SelectContent>
                  {ALL_ROLES.map(role => (
                    <SelectItem key={role.value} value={role.value}>
                      {role.label}
                      {rolesWithCommission.includes(role.value) && (
                        <span className="ml-2 text-green-600">✓</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedRole && (
              <>
                <div className="space-y-2">
                  <Label>Terapkan Rate ke Semua Produk</Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      placeholder="Contoh: 5000"
                      value={bulkRate}
                      onChange={(e) => setBulkRate(e.target.value)}
                      min="0"
                    />
                    <Button variant="outline" onClick={applyBulkRate}>
                      Terapkan
                    </Button>
                  </div>
                </div>

                <div className="flex items-end">
                  <Button
                    onClick={saveCommissions}
                    disabled={isSubmitting}
                    className="w-full bg-green-600 hover:bg-green-700"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Menyimpan...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Simpan Komisi {getRoleLabel(selectedRole)}
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Products Commission Table */}
      {selectedRole && productRates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              Rate Komisi per Produk - {getRoleLabel(selectedRole)}
            </CardTitle>
            <CardDescription>
              Masukkan nilai komisi dalam Rupiah per quantity untuk setiap produk
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-auto max-h-[500px]">
              <Table>
                <TableHeader className="sticky top-0 bg-slate-50">
                  <TableRow>
                    <TableHead className="w-[50px]">No</TableHead>
                    <TableHead>Nama Produk</TableHead>
                    <TableHead className="w-[200px]">Komisi / Qty (Rp)</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productRates.map((row, index) => (
                    <TableRow key={row.productId}>
                      <TableCell className="text-muted-foreground">
                        {index + 1}
                      </TableCell>
                      <TableCell className="font-medium">
                        {row.productName}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={row.rate}
                          onChange={(e) => updateRate(row.productId, Number(e.target.value) || 0)}
                          placeholder="0"
                          min="0"
                          className="w-full"
                        />
                      </TableCell>
                      <TableCell>
                        {row.rate > 0 ? (
                          <Badge variant="outline" className="text-green-600 border-green-600">
                            Rp {row.rate.toLocaleString('id-ID')}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Belum diatur</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info Card */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="p-4">
          <div className="text-sm text-blue-800">
            <p className="font-semibold mb-2">📋 Cara Kerja Komisi:</p>
            <ul className="space-y-1 ml-4">
              <li>• Pilih jabatan yang ingin diatur komisinya</li>
              <li>• Masukkan nilai komisi per qty untuk setiap produk</li>
              <li>• Gunakan "Terapkan Rate" untuk mengisi semua produk dengan nilai yang sama</li>
              <li>• Komisi akan otomatis dihitung saat transaksi/pengantaran berdasarkan role karyawan</li>
              <li>• <strong>Pengantaran 2 Helper:</strong> Masukkan total komisi 3 orang, akan dibagi 3 otomatis (1 Supir + 2 Kenek)</li>
              <li>• <strong>Pengantaran 3 Helper:</strong> Masukkan total komisi 4 orang, akan dibagi 4 otomatis (1 Supir + 3 Kenek)</li>
              <li>• <strong>Driver & Helper:</strong> Berlaku jika Pengantaran hanya 1 Kenek. Komisi dihitung di akhir</li>
              <li>• <strong>Sales:</strong> Komisi dihitung saat transaksi dibuat</li>
              <li>• <strong>Operator:</strong> Mendapatkan komisi dari produk yang laku dengan aturan produksi</li>
              <li>• <strong>Supervisor:</strong> Mendapatkan komisi dari setiap produk yang dijual di luar bonus</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
