"use client"
import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/use-toast'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Shield, Save, RotateCcw, Settings, Eye, Plus, Edit, Trash2, Building2, Calendar, ShoppingCart, Truck, List, Receipt, Users, MapPin, FileText, Factory, Warehouse, Navigation, Coins, Clock, Wrench, Package } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useRoles } from '@/hooks/useRoles'
import { useBranches } from '@/hooks/useBranches'
import { isOwner } from '@/utils/roleUtils'
import { getRolePermissions, updateRolePermissions } from '@/services/rolePermissionService'

// Define default color for roles
const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-800',
  admin: 'bg-blue-100 text-blue-800',
  supervisor: 'bg-green-100 text-green-800',
  cashier: 'bg-orange-100 text-orange-800',
  designer: 'bg-pink-100 text-pink-800',
  operator: 'bg-gray-100 text-gray-800',
  supir: 'bg-yellow-100 text-yellow-800',
}

// Define all features and their permissions
const FEATURES = [
  {
    category: 'Dashboard',
    items: [
      { id: 'dashboard_view', name: 'Lihat Dashboard', icon: Eye },
    ]
  },
  {
    category: 'Produk & Inventory',
    items: [
      { id: 'products_view', name: 'Lihat Produk', icon: Eye },
      { id: 'products_create', name: 'Tambah Produk', icon: Plus },
      { id: 'products_edit', name: 'Edit Produk', icon: Edit },
      { id: 'products_delete', name: 'Hapus Produk', icon: Trash2 },
      { id: 'materials_view', name: 'Lihat Bahan', icon: Eye },
      { id: 'materials_create', name: 'Tambah Bahan', icon: Plus },
      { id: 'materials_edit', name: 'Edit Bahan', icon: Edit },
      { id: 'materials_delete', name: 'Hapus Bahan', icon: Trash2 },
    ]
  },
  {
    category: 'Transaksi & POS',
    items: [
      { id: 'pos_access', name: 'Akses POS Kasir (Mobile)', icon: Eye },
      { id: 'pos_driver_access', name: 'Akses POS Supir (Mobile)', icon: Eye },
      { id: 'warehouse_access', name: 'Akses Gudang (Mobile)', icon: Eye },
      { id: 'transactions_view', name: 'Lihat Transaksi', icon: Eye },
      { id: 'transactions_create', name: 'Buat Transaksi', icon: Plus },
      { id: 'transactions_edit', name: 'Edit Transaksi', icon: Edit },
      { id: 'transactions_delete', name: 'Hapus Transaksi', icon: Trash2 },
      { id: 'pos_edit_price', name: 'Izin Ubah Harga di POS', icon: Edit },
      { id: 'material_sales', name: 'Izin Jual Bahan', icon: Plus },
    ]
  },
  {
    category: 'Produksi',
    items: [
      { id: 'production_view', name: 'Lihat Produksi', icon: Eye },
      { id: 'production_create', name: 'Input Produksi (Mobile)', icon: Plus },
      { id: 'production_edit', name: 'Edit Produksi', icon: Edit },
      { id: 'production_delete', name: 'Hapus Produksi', icon: Trash2 },
    ]
  },
  {
    category: 'Quotation',
    items: [
      { id: 'quotations_view', name: 'Lihat Quotation', icon: Eye },
      { id: 'quotations_create', name: 'Buat Quotation', icon: Plus },
      { id: 'quotations_edit', name: 'Edit Quotation', icon: Edit },
      { id: 'quotations_delete', name: 'Hapus Quotation', icon: Trash2 },
    ]
  },
  {
    category: 'Customer & Employee',
    items: [
      { id: 'customers_view', name: 'Lihat Pelanggan', icon: Eye },
      { id: 'customers_create', name: 'Tambah Pelanggan', icon: Plus },
      { id: 'customers_edit', name: 'Edit Pelanggan', icon: Edit },
      { id: 'customers_delete', name: 'Hapus Pelanggan', icon: Trash2 },
      { id: 'customer_map_access', name: 'Akses Pelanggan Terdekat (GPS)', icon: Eye },
      { id: 'employees_view', name: 'Lihat Karyawan', icon: Eye },
      { id: 'employees_create', name: 'Tambah Karyawan', icon: Plus },
      { id: 'employees_edit', name: 'Edit Karyawan', icon: Edit },
      { id: 'employees_delete', name: 'Hapus Karyawan', icon: Trash2 },
    ]
  },
  {
    category: 'Supplier & Purchase',
    items: [
      { id: 'suppliers_view', name: 'Lihat Supplier', icon: Eye },
      { id: 'suppliers_create', name: 'Tambah Supplier', icon: Plus },
      { id: 'suppliers_edit', name: 'Edit Supplier', icon: Edit },
      { id: 'suppliers_delete', name: 'Hapus Supplier', icon: Trash2 },
      { id: 'purchase_orders_view', name: 'Lihat Purchase Order', icon: Eye },
      { id: 'purchase_orders_create', name: 'Buat Purchase Order', icon: Plus },
      { id: 'purchase_orders_edit', name: 'Edit Purchase Order', icon: Edit },
      { id: 'purchase_orders_delete', name: 'Hapus Purchase Order', icon: Trash2 },
    ]
  },
  {
    category: 'Delivery & Retasi',
    items: [
      { id: 'delivery_view', name: 'Lihat Pengantaran', icon: Eye },
      { id: 'delivery_create', name: 'Buat Pengantaran', icon: Plus },
      { id: 'delivery_edit', name: 'Edit Pengantaran', icon: Edit },
      { id: 'delivery_delete', name: 'Hapus Pengantaran', icon: Trash2 },
      { id: 'retasi_view', name: 'Lihat Retasi', icon: Eye },
      { id: 'retasi_create', name: 'Buat Retasi', icon: Plus },
      { id: 'retasi_edit', name: 'Edit Retasi', icon: Edit },
      { id: 'retasi_delete', name: 'Hapus Retasi', icon: Trash2 },
      { id: 'delivery_report_view', name: 'Lihat Laporan Pengantaran', icon: Eye },
      { id: 'delivery_report_create', name: 'Buat Laporan Pengantaran', icon: Plus },
    ]
  },
  {
    category: 'Keuangan',
    items: [
      { id: 'accounts_view', name: 'Lihat Akun Keuangan', icon: Eye },
      { id: 'accounts_create', name: 'Tambah Akun', icon: Plus },
      { id: 'accounts_edit', name: 'Edit Akun', icon: Edit },
      { id: 'accounts_delete', name: 'Hapus Akun', icon: Trash2 },
      { id: 'receivables_view', name: 'Lihat Piutang', icon: Eye },
      { id: 'receivables_edit', name: 'Kelola Piutang (Edit Jatuh Tempo)', icon: Edit },
      { id: 'receivable_backdate', name: 'Pelunasan Piutang Backdate (Mundur Tanggal)', icon: Calendar },
      { id: 'receivable_delete', name: 'Hapus History Pembayaran Piutang', icon: Trash2 },
      { id: 'payables_view', name: 'Lihat Hutang', icon: Eye },
      { id: 'payables_create', name: 'Tambah Hutang', icon: Plus },
      { id: 'payables_edit', name: 'Edit Hutang', icon: Edit },
      { id: 'payables_delete', name: 'Hapus Hutang', icon: Trash2 },
      { id: 'expenses_view', name: 'Lihat Pengeluaran', icon: Eye },
      { id: 'expenses_create', name: 'Tambah Pengeluaran', icon: Plus },
      { id: 'expenses_edit', name: 'Edit Pengeluaran', icon: Edit },
      { id: 'expenses_delete', name: 'Hapus Pengeluaran', icon: Trash2 },
      { id: 'advances_view', name: 'Lihat Panjar', icon: Eye },
      { id: 'advances_create', name: 'Tambah Panjar', icon: Plus },
      { id: 'advances_edit', name: 'Edit Panjar', icon: Edit },
      { id: 'cash_flow_view', name: 'Lihat Buku Besar', icon: Eye },
      { id: 'financial_reports', name: 'Laporan Keuangan', icon: Eye },
    ]
  },
  {
    category: 'Payroll & Commission',
    items: [
      { id: 'payroll_view', name: 'Lihat Gaji', icon: Eye },
      { id: 'payroll_process', name: 'Proses Gaji', icon: Plus },
      { id: 'commission_view', name: 'Lihat Komisi', icon: Eye },
      { id: 'commission_manage', name: 'Kelola Pengaturan Komisi', icon: Settings },
      { id: 'commission_report', name: 'Laporan Komisi', icon: Eye },
    ]
  },
  {
    category: 'Assets & Maintenance',
    items: [
      { id: 'assets_view', name: 'Lihat Aset', icon: Eye },
      { id: 'assets_create', name: 'Tambah Aset', icon: Plus },
      { id: 'assets_edit', name: 'Edit Aset', icon: Edit },
      { id: 'assets_delete', name: 'Hapus Aset', icon: Trash2 },
      { id: 'maintenance_view', name: 'Lihat Maintenance', icon: Eye },
      { id: 'maintenance_create', name: 'Jadwalkan Maintenance', icon: Plus },
      { id: 'maintenance_edit', name: 'Edit Maintenance', icon: Edit },
    ]
  },
  {
    category: 'Zakat & Sedekah',
    items: [
      { id: 'zakat_view', name: 'Lihat Zakat', icon: Eye },
      { id: 'zakat_create', name: 'Tambah Zakat', icon: Plus },
      { id: 'zakat_edit', name: 'Edit Zakat', icon: Edit },
    ]
  },
  {
    category: 'Absensi',
    items: [
      { id: 'attendance_view', name: 'Lihat Absensi', icon: Eye },
      { id: 'attendance_create', name: 'Buat Absensi', icon: Plus },
      { id: 'attendance_edit', name: 'Edit Absensi', icon: Edit },
      { id: 'attendance_delete', name: 'Hapus Absensi', icon: Trash2 },
    ]
  },
  {
    category: 'Laporan',
    items: [
      { id: 'stock_reports', name: 'Laporan Stock', icon: Eye },
      { id: 'transaction_reports', name: 'Laporan Transaksi', icon: Eye },
      { id: 'transaction_items_report', name: 'Laporan Produk Laku', icon: Eye },
      { id: 'material_movement_report', name: 'Laporan Pergerakan Bahan', icon: Eye },
      { id: 'attendance_reports', name: 'Laporan Absensi', icon: Eye },
      { id: 'production_reports', name: 'Laporan Produksi', icon: Eye },
    ]
  },
  {
    category: 'Dashboard Mobile (Tampilan HP)',
    items: [
      { id: 'mobile_pos', name: 'Menu: Point of Sale (POS)', icon: ShoppingCart },
      { id: 'mobile_driver_pos', name: 'Menu: POS Supir', icon: Truck },
      { id: 'mobile_delivery', name: 'Menu: Pengantaran', icon: Truck },
      { id: 'mobile_transactions', name: 'Menu: Data Transaksi', icon: List },
      { id: 'mobile_expenses', name: 'Menu: Pengeluaran', icon: Receipt },
      { id: 'mobile_customers', name: 'Menu: Data Pelanggan', icon: Users },
      { id: 'mobile_customer_map', name: 'Menu: Pelanggan Terdekat', icon: MapPin },
      { id: 'mobile_quotations', name: 'Menu: Penawaran', icon: FileText },
      { id: 'mobile_production', name: 'Menu: Input Produksi', icon: Factory },
      { id: 'mobile_warehouse', name: 'Menu: Gudang (Stok)', icon: Warehouse },
      { id: 'mobile_retasi', name: 'Menu: Retasi', icon: Navigation },
      { id: 'mobile_sold_items', name: 'Menu: Produk Laku', icon: Package },
      { id: 'mobile_commission', name: 'Menu: Komisi Saya', icon: Coins },
      { id: 'mobile_attendance', name: 'Menu: Absensi (Clock In)', icon: Clock },
      { id: 'mobile_maintenance', name: 'Menu: Maintenance Aset', icon: Wrench },
      { id: 'mobile_sales_report', name: 'Menu: Laporan Sales (Kunjungan)', icon: MapPin },
      { id: 'mobile_delivery_report', name: 'Menu: Lapor Antar', icon: MapPin },
    ]
  },
  {
    category: 'Sistem',
    items: [
      { id: 'settings_access', name: 'Akses Pengaturan', icon: Settings },
      { id: 'role_management', name: 'Kelola Role', icon: Eye },
      { id: 'branches_view', name: 'Lihat Cabang', icon: Eye },
      { id: 'branches_create', name: 'Tambah Cabang', icon: Plus },
      { id: 'branches_edit', name: 'Edit Cabang', icon: Edit },
      { id: 'branches_delete', name: 'Hapus Cabang', icon: Trash2 },
      { id: 'attendance_access', name: 'Akses Absensi', icon: Eye },
      { id: 'notifications_view', name: 'Lihat Notifikasi', icon: Eye },
      { id: 'profiles_view', name: 'Lihat Profil', icon: Eye },
      { id: 'profiles_edit', name: 'Edit Profil', icon: Edit },
    ]
  }
]

// Helper function to get all permission IDs
const getAllPermissionIds = (): string[] => {
  return FEATURES.flatMap(category => category.items.map(item => item.id))
}

// Helper function to create all permissions set to true (for owner)
const createAllTruePermissions = (): Record<string, boolean> => {
  return Object.fromEntries(getAllPermissionIds().map(id => [id, true]))
}

// Helper function to create all permissions set to false (for new roles)
const createAllFalsePermissions = (): Record<string, boolean> => {
  return Object.fromEntries(getAllPermissionIds().map(id => [id, false]))
}

export const RolePermissionManagement = () => {
  const { user } = useAuth()
  const { toast } = useToast()
  const { roles: dbRoles, isLoading: rolesLoading } = useRoles()
  const { branches, isLoading: branchesLoading } = useBranches()
  const [permissions, setPermissions] = useState<Record<string, Record<string, boolean>>>({})
  const [hasChanges, setHasChanges] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [selectedRole, setSelectedRole] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)

  // Only owner can access this component
  const canManageRoles = isOwner(user)

  // Convert database roles to format needed for this component
  const ROLES = useMemo(() => {
    if (!dbRoles) return []

    return dbRoles.map(role => ({
      id: role.name,
      name: role.displayName,
      color: ROLE_COLORS[role.name] || 'bg-gray-100 text-gray-800',
      isSystem: role.isSystemRole
    }))
  }, [dbRoles])

  // Create dynamic branch access permissions
  const BRANCH_ACCESS_FEATURES = useMemo(() => {
    if (!branches || branches.length === 0) return []

    return [{
      category: 'Akses Cabang',
      items: branches.map(branch => ({
        id: `branch_access_${branch.id}`,
        name: `Akses ${branch.name} (${branch.code})`,
        icon: Building2,
        branchId: branch.id
      }))
    }]
  }, [branches])

  // Combine static features with dynamic branch features (branches first)
  const ALL_FEATURES = useMemo(() => {
    return [...BRANCH_ACCESS_FEATURES, ...FEATURES]
  }, [BRANCH_ACCESS_FEATURES])

  // Set first role as default selected role
  useEffect(() => {
    if (ROLES.length > 0 && !selectedRole) {
      setSelectedRole(ROLES[0].id)
    }
  }, [ROLES, selectedRole])

  // Load permissions from database
  useEffect(() => {
    const loadPermissions = async () => {
      if (ROLES.length === 0) return

      setIsLoading(true)
      try {
        const dbPermissions = await getRolePermissions()
        const loadedPerms: Record<string, Record<string, boolean>> = {}

        // Initialize all roles with base permissions
        ROLES.forEach(role => {
          if (role.id === 'owner') {
            // Owner ALWAYS gets all permissions = true
            loadedPerms[role.id] = createAllTruePermissions()
          } else {
            // Other roles start with all false
            loadedPerms[role.id] = createAllFalsePermissions()
          }
        })

        // Override with database values (except owner which is always all true)
        if (dbPermissions && dbPermissions.length > 0) {
          dbPermissions.forEach((rp: { role_id: string; permissions: Record<string, boolean> }) => {
            if (rp.role_id !== 'owner' && loadedPerms[rp.role_id]) {
              // Merge database permissions with base false permissions
              loadedPerms[rp.role_id] = {
                ...loadedPerms[rp.role_id],
                ...rp.permissions
              }
            }
          })
        }

        // Add branch access permissions
        if (branches && branches.length > 0) {
          ROLES.forEach(role => {
            branches.forEach(branch => {
              const branchPermKey = `branch_access_${branch.id}`
              if (role.id === 'owner') {
                // Owner gets all branch access
                loadedPerms[role.id][branchPermKey] = true
              } else if (!(branchPermKey in loadedPerms[role.id])) {
                // Other roles: check if admin, otherwise false
                loadedPerms[role.id][branchPermKey] = role.id === 'admin'
              }
            })
          })
        }

        setPermissions(loadedPerms)
      } catch (error) {
        console.error('Error loading permissions from database:', error)
        // Fallback: create default permissions
        const fallbackPerms: Record<string, Record<string, boolean>> = {}
        ROLES.forEach(role => {
          fallbackPerms[role.id] = role.id === 'owner'
            ? createAllTruePermissions()
            : createAllFalsePermissions()
        })
        setPermissions(fallbackPerms)
      } finally {
        setIsLoading(false)
      }
    }

    loadPermissions()
  }, [branches, ROLES])

  const togglePermission = (roleId: string, permissionId: string) => {
    if (!canManageRoles) return

    // Owner permissions cannot be changed - always all true
    if (roleId === 'owner') {
      toast({
        variant: "destructive",
        title: "Tidak Diizinkan",
        description: "Permission Owner tidak dapat diubah. Owner selalu memiliki semua akses.",
      })
      return
    }

    setPermissions(prev => ({
      ...prev,
      [roleId]: {
        ...prev[roleId],
        [permissionId]: !prev[roleId]?.[permissionId]
      }
    }))
    setHasChanges(true)
  }

  const resetToDefaults = () => {
    // Reset: Owner = all true, others = all false
    const resetPerms: Record<string, Record<string, boolean>> = {}
    ROLES.forEach(role => {
      if (role.id === 'owner') {
        resetPerms[role.id] = createAllTruePermissions()
      } else {
        resetPerms[role.id] = createAllFalsePermissions()
      }

      // Add branch permissions
      if (branches && branches.length > 0) {
        branches.forEach(branch => {
          const branchPermKey = `branch_access_${branch.id}`
          resetPerms[role.id][branchPermKey] = role.id === 'owner' || role.id === 'admin'
        })
      }
    })

    setPermissions(resetPerms)
    setHasChanges(true)
    toast({
      title: "Reset ke Default",
      description: "Owner = semua aktif, role lain = semua nonaktif.",
    })
  }

  const savePermissions = async () => {
    if (!canManageRoles) return

    setIsSaving(true)
    try {
      // Save all role permissions to VPS database (except owner - no need to save)
      const savePromises = Object.entries(permissions)
        .filter(([roleId]) => roleId !== 'owner') // Don't save owner - always all true
        .map(([roleId, rolePerms]) =>
          updateRolePermissions(roleId, rolePerms as Record<string, boolean>)
        )

      await Promise.all(savePromises)

      // Also save to localStorage as cache for faster load
      localStorage.setItem('rolePermissions', JSON.stringify(permissions))

      // Trigger storage event manually for same window
      window.dispatchEvent(new Event('storage'))

      setHasChanges(false)
      toast({
        title: "Sukses!",
        description: "Permission berhasil disimpan ke database. Refresh halaman untuk melihat perubahan menu.",
      })
    } catch (error) {
      console.error('Error saving permissions:', error)
      toast({
        variant: "destructive",
        title: "Gagal!",
        description: "Terjadi kesalahan saat menyimpan permission ke database.",
      })
    } finally {
      setIsSaving(false)
    }
  }

  if (!canManageRoles) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Shield className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">Akses Terbatas</h3>
          <p className="text-muted-foreground text-center">
            Hanya Owner yang dapat mengakses pengaturan role dan permission.
          </p>
        </CardContent>
      </Card>
    )
  }

  if (isLoading || rolesLoading) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4"></div>
          <p className="text-muted-foreground">Memuat permission dari database...</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Info Card */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Shield className="h-5 w-5 text-blue-600 mt-0.5" />
            <div className="space-y-2 text-sm">
              <p className="font-semibold text-blue-900">
                Cara Kerja Permission System:
              </p>
              <ul className="list-disc list-inside space-y-1 text-blue-800">
                <li><strong>Owner</strong> selalu punya akses penuh ke semua menu (tidak bisa diubah)</li>
                <li>Permission yang dicentang akan menentukan <strong>menu yang tampil di sidebar</strong></li>
                <li>Jika permission dimatikan (tidak dicentang), menu terkait akan <strong>hilang dari sidebar</strong></li>
                <li>Perubahan akan berlaku setelah <strong>klik "Simpan Perubahan"</strong> dan <strong>refresh halaman</strong></li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Kelola Role & Permission
          </CardTitle>
          <CardDescription>
            Pilih role dan atur permission-nya. Perubahan akan berlaku untuk semua user dengan role tersebut.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Role Selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Pilih Role:</label>
            <Select value={selectedRole} onValueChange={setSelectedRole}>
              <SelectTrigger className="w-full max-w-sm">
                <SelectValue placeholder="Pilih role untuk diatur permission-nya" />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className={role.color}>
                        {role.name}
                      </Badge>
                      {role.id === 'owner' && (
                        <span className="text-xs text-green-600 font-medium">(Semua Aktif)</span>
                      )}
                      {role.isSystem && role.id !== 'owner' && (
                        <span className="text-xs text-muted-foreground">(System Role)</span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button
              onClick={savePermissions}
              disabled={!hasChanges || isSaving}
              className="flex items-center gap-2"
            >
              <Save className="h-4 w-4" />
              {isSaving ? 'Menyimpan...' : 'Simpan Perubahan'}
            </Button>
            <Button
              variant="outline"
              onClick={resetToDefaults}
              className="flex items-center gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Reset ke Default
            </Button>
          </div>

          {hasChanges && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-sm text-yellow-800 font-semibold">
                Ada perubahan yang belum disimpan. Klik "Simpan Perubahan" untuk menerapkan.
              </p>
              <p className="text-xs text-yellow-700 mt-1">
                Setelah simpan, refresh halaman (F5) untuk melihat perubahan menu di sidebar.
              </p>
            </div>
          )}

          {selectedRole === 'owner' && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800 font-semibold">
                Owner memiliki SEMUA permission secara otomatis dan tidak dapat diubah.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedRole && ALL_FEATURES.map((category) => (
        <Card key={category.category}>
          <CardHeader>
            <CardTitle className="text-lg flex items-center justify-between">
              <span>{category.category}</span>
              <Badge variant="secondary" className={ROLES.find(r => r.id === selectedRole)?.color}>
                {ROLES.find(r => r.id === selectedRole)?.name}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {category.items.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center justify-between p-3 border rounded-lg ${selectedRole === 'owner' ? 'bg-green-50 border-green-200' : 'hover:bg-gray-50'
                    }`}
                >
                  <div className="flex items-center gap-2 flex-1">
                    <item.icon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{item.name}</span>
                  </div>
                  <Switch
                    checked={permissions[selectedRole]?.[item.id] || false}
                    onCheckedChange={() => togglePermission(selectedRole, item.id)}
                    disabled={!canManageRoles || selectedRole === 'owner'}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Permission Summary for Selected Role */}
      {selectedRole && permissions[selectedRole] && (
        <Card>
          <CardHeader>
            <CardTitle>Ringkasan Permission - {ROLES.find(r => r.id === selectedRole)?.name}</CardTitle>
            <CardDescription>
              Total permission yang dimiliki role ini
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {(() => {
                const rolePermissions = permissions[selectedRole] || {}
                const totalPermissions = Object.keys(rolePermissions).length
                const activePermissions = Object.values(rolePermissions).filter(Boolean).length
                const percentage = totalPermissions > 0 ? Math.round((activePermissions / totalPermissions) * 100) : 0

                return (
                  <>
                    <Card>
                      <CardContent className="p-6 text-center">
                        <div className="text-4xl font-bold text-green-600">{activePermissions}</div>
                        <div className="text-sm text-muted-foreground mt-2">
                          Permission Aktif
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-6 text-center">
                        <div className="text-4xl font-bold text-blue-600">{totalPermissions}</div>
                        <div className="text-sm text-muted-foreground mt-2">
                          Total Permission
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-6 text-center">
                        <div className="text-4xl font-bold text-purple-600">{percentage}%</div>
                        <div className="text-sm text-muted-foreground mt-2">
                          Akses
                        </div>
                      </CardContent>
                    </Card>
                  </>
                )
              })()}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
