import { useState, useEffect, useRef } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ShoppingCart, Clock, User, LogOut, Menu, X, List, Truck, Package, Users, ArrowLeft, Home, Sun, Moon, Building2, Check, ChevronsUpDown, Factory, Warehouse, Navigation, Coins, MapPin, FileText, RefreshCw, Receipt, Wrench, Search, BriefcaseBusiness } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useCompanySettings } from '@/hooks/useCompanySettings'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { id } from 'date-fns/locale/id'
import { useTheme } from 'next-themes'
import { useBranch } from '@/contexts/BranchContext'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useGranularPermission } from '@/hooks/useGranularPermission'
import { AppFeatureKey, isFeatureEnabled } from '@/config/featureSettings'




const MobileLayout = () => {
  const { user, signOut } = useAuth()
  const { settings } = useCompanySettings()
  const navigate = useNavigate()
  const location = useLocation()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const { theme, setTheme } = useTheme()
  const { currentBranch, availableBranches, canAccessAllBranches, switchBranch } = useBranch()
  const { hasGranularPermission } = useGranularPermission()
  const [searchQuery, setSearchQuery] = useState('')



  // Ref for active menu item to scroll into view
  const activeMenuRef = useRef<HTMLButtonElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const autoCloseTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Auto-close sidebar after inactivity (for touch devices)
  const resetAutoCloseTimer = () => {
    if (autoCloseTimeoutRef.current) {
      clearTimeout(autoCloseTimeoutRef.current)
    }
    if (isSidebarOpen) {
      autoCloseTimeoutRef.current = setTimeout(() => {
        setIsSidebarOpen(false)
      }, 5000) // Auto-close after 5 seconds of inactivity
    }
  }

  // Scroll to active menu when sidebar opens
  useEffect(() => {
    if (isSidebarOpen && activeMenuRef.current && navRef.current) {
      // Small delay to ensure sidebar animation is complete
      setTimeout(() => {
        activeMenuRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        })
      }, 150)
      // Start auto-close timer
      resetAutoCloseTimer()
    }

    return () => {
      if (autoCloseTimeoutRef.current) {
        clearTimeout(autoCloseTimeoutRef.current)
      }
    }
  }, [isSidebarOpen])

  // Hardware Back Button Handler for Capacitor
  useEffect(() => {
    let handler: any;

    const setupBackButton = async () => {
      try {
        const { App: CapApp } = await import('@capacitor/app');

        handler = await CapApp.addListener('backButton', (data) => {
          // If we are on the main dashboard or login page, we can exit the app
          if (location.pathname === '/' || location.pathname === '/login') {
            CapApp.exitApp();
          } else {
            // For all other pages, we try to go back in history
            // Use navigate(-1) instead of window.history.back() for better React Router integration
            navigate(-1);
          }
        });
      } catch (e) {
        console.log('Mobile back button hardware listener inactive:', e);
      }
    };

    setupBackButton();

    return () => {
      if (handler) {
        handler.remove();
      }
    };
  }, [location.pathname, navigate]);

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  const featureSettings = settings?.appFeatureSettings
  const featurePathMap: Partial<Record<string, AppFeatureKey>> = {
    '/driver-pos': 'delivery',
    '/delivery': 'delivery',
    '/delivery-report': 'delivery_reports',
    '/mobile-sales-report': 'sales_reports',
    '/quotations': 'quotations',
    '/production': 'production_bom',
    '/retasi': 'retasi',
    '/attendance': 'attendance',
    '/assets': 'assets_maintenance',
    '/maintenance': 'assets_maintenance',
    '/zakat': 'zakat',
    '/tax': 'tax',
    '/purchase-orders': 'purchase_orders',
    '/projects': 'projects',
  }

  const isPathEnabled = (path: string) => {
    const featureKey = featurePathMap[path]
    return featureKey ? isFeatureEnabled(featureSettings, featureKey) : true
  }

  // Permission checks for mobile features.
  // Mobile-specific menu toggles are allowed, but they no longer replace the main
  // Role Management permissions. This keeps web/mobile access consistent.
  const canAccessPOS = hasGranularPermission('mobile_pos') || hasGranularPermission('pos_access') || hasGranularPermission('transactions_create')
  const canAccessDriverPOS = hasGranularPermission('mobile_driver_pos') || hasGranularPermission('pos_driver_access')
  const canViewDelivery = hasGranularPermission('mobile_delivery') || hasGranularPermission('delivery_view')
  const canViewTransactions = hasGranularPermission('mobile_transactions') || hasGranularPermission('transactions_view')
  const canAccessExpenses = hasGranularPermission('mobile_expenses') || hasGranularPermission('expenses_view') || hasGranularPermission('advances_view')
  const canViewCustomers = hasGranularPermission('mobile_customers') || hasGranularPermission('customers_view')
  const canAccessCustomerMap = hasGranularPermission('mobile_customer_map') || hasGranularPermission('customer_map_access') || hasGranularPermission('customers_view')
  const canAccessQuotations = hasGranularPermission('mobile_quotations') || hasGranularPermission('quotations_view') || hasGranularPermission('quotations_create')
  const canAccessProduction = hasGranularPermission('mobile_production') || hasGranularPermission('production_view') || hasGranularPermission('production_create')
  const canAccessWarehouse = hasGranularPermission('mobile_warehouse') || hasGranularPermission('warehouse_access') || hasGranularPermission('materials_view') || hasGranularPermission('products_view')
  const canViewRetasi = hasGranularPermission('mobile_retasi') || hasGranularPermission('retasi_view')
  const canViewSoldItems = hasGranularPermission('mobile_sold_items') || hasGranularPermission('transaction_items_report')
  const canViewCommission = hasGranularPermission('mobile_commission') || hasGranularPermission('commission_view') || hasGranularPermission('commission_report')
  const canAccessAttendance = hasGranularPermission('mobile_attendance') || hasGranularPermission('attendance_access') || hasGranularPermission('attendance_view')
  const canViewMaintenance = hasGranularPermission('mobile_maintenance') || hasGranularPermission('maintenance_view')
  const canViewSalesReport = hasGranularPermission('mobile_sales_report') || hasGranularPermission('transaction_reports') || hasGranularPermission('commission_report')
  const canViewDeliveryReport = hasGranularPermission('mobile_delivery_report') || hasGranularPermission('delivery_report_view')
  const canAccessProjects = hasGranularPermission('transactions_view')

  // Regular menu items (for non-helper roles)
  const regularMenuItems = [
    ...(canAccessPOS ? [{
      title: 'Point of Sale (POS)',
      icon: ShoppingCart,
      path: '/pos',
      description: 'Buat transaksi penjualan',
      color: 'bg-green-500 hover:bg-green-600',
      textColor: 'text-white'
    }] : []),
    ...(canAccessDriverPOS ? [{
      title: 'POS Supir',
      icon: Truck,
      path: '/driver-pos',
      description: 'Input penjualan dari driver',
      color: 'bg-orange-500 hover:bg-orange-600',
      textColor: 'text-white'
    }] : []),
    ...(canViewDelivery ? [{
      title: 'Pengantaran',
      icon: Truck,
      path: '/delivery',
      description: 'Kelola pengantaran barang',
      color: 'bg-sky-500 hover:bg-sky-600',
      textColor: 'text-white'
    }] : []),
    ...(canViewTransactions ? [{
      title: 'Data Transaksi',
      icon: List,
      path: '/transactions',
      description: 'Lihat daftar transaksi',
      color: 'bg-blue-500 hover:bg-blue-600',
      textColor: 'text-white'
    }] : []),
    ...(canAccessExpenses ? [{
      title: 'Pengeluaran',
      icon: Receipt,
      path: '/expenses',
      description: 'Catat biaya operasional',
      color: 'bg-red-500 hover:bg-red-600',
      textColor: 'text-white'
    }] : []),
    ...(canViewCustomers ? [{
      title: 'Pelanggan',
      icon: Users,
      path: '/customers',
      description: 'Kelola data pelanggan',
      color: 'bg-cyan-500 hover:bg-cyan-600',
      textColor: 'text-white'
    }] : []),
    ...(canAccessCustomerMap ? [{
      title: 'Pelanggan Terdekat',
      icon: MapPin,
      path: '/customer-map',
      description: 'Cari pelanggan via GPS',
      color: 'bg-rose-500 hover:bg-rose-600',
      textColor: 'text-white'
    }] : []),
    ...(canAccessQuotations ? [{
      title: 'Penawaran',
      icon: FileText,
      path: '/quotations',
      description: 'Kelola penawaran harga',
      color: 'bg-violet-500 hover:bg-violet-600',
      textColor: 'text-white'
    }] : []),
    ...(canAccessProjects ? [{
      title: 'Proyek',
      icon: BriefcaseBusiness,
      path: '/projects',
      description: 'Pantau pekerjaan & biaya proyek',
      color: 'bg-slate-700 hover:bg-slate-800',
      textColor: 'text-white'
    }] : []),
    ...(canAccessProduction ? [{
      title: 'Input Produksi',
      icon: Factory,
      path: '/production',
      description: 'Catat hasil produksi',
      color: 'bg-amber-500 hover:bg-amber-600',
      textColor: 'text-white'
    }] : []),
    ...(canAccessWarehouse ? [{
      title: 'Gudang',
      icon: Warehouse,
      path: '/warehouse',
      description: 'Kelola stok gudang',
      color: 'bg-indigo-500 hover:bg-indigo-600',
      textColor: 'text-white'
    }] : []),
    ...(canViewRetasi ? [{
      title: 'Retasi',
      icon: Navigation,
      path: '/retasi',
      description: 'Kelola retur & retasi',
      color: 'bg-fuchsia-500 hover:bg-fuchsia-600',
      textColor: 'text-white'
    }] : []),
    ...(canViewSoldItems ? [{
      title: 'Produk Laku',
      icon: Package,
      path: '/sold-items',
      description: 'Lihat produk terjual',
      color: 'bg-purple-500 hover:bg-purple-600',
      textColor: 'text-white'
    }] : []),
    ...(canViewCommission ? [{
      title: 'Komisi Saya',
      icon: Coins,
      path: '/my-commission',
      description: 'Lihat laporan komisi',
      color: 'bg-yellow-500 hover:bg-yellow-600',
      textColor: 'text-white'
    }] : []),
    ...(canAccessAttendance ? [{
      title: 'Absensi',
      icon: Clock,
      path: '/attendance',
      description: 'Clock In / Clock Out',
      color: 'bg-green-500 hover:bg-green-600',
      textColor: 'text-white'
    }] : []),
    ...(canViewMaintenance ? [{
      title: 'Maintenance Aset',
      icon: Wrench,
      path: '/mobile-maintenance',
      description: 'Laporan perbaikan aset',
      color: 'bg-zinc-600 hover:bg-zinc-700',
      textColor: 'text-white'
    }] : []),
    ...(canViewSalesReport ? [{
      title: 'Laporan Sales',
      icon: MapPin,
      path: '/mobile-sales-report',
      description: 'Kunjungan & Penagihan',
      color: 'bg-indigo-600 hover:bg-indigo-700',
      textColor: 'text-white'
    }] : []),
    ...(canViewDeliveryReport ? [{
      title: 'Lapor Antar',
      icon: MapPin,
      path: '/delivery-report',
      description: 'Laporkan status pengantaran',
      color: 'bg-teal-500 hover:bg-teal-600',
      textColor: 'text-white'
    }] : [])
  ].filter(item => isPathEnabled(item.path))

  // Do not force helper/supir into a separate hardcoded menu. Role Management +
  // Feature Settings decide which mobile menus are available.
  const menuItems = regularMenuItems

  const handleLogout = async () => {
    try {
      await signOut()
      navigate('/login')
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen)
  }

  const currentPath = location.pathname

  const getPageTitle = (path: string) => {
    if (path.startsWith('/transactions/')) {
      return 'Detail Transaksi'
    }
    if (path.startsWith('/customers/')) {
      return 'Detail Pelanggan'
    }

    switch (path) {
      case '/pos':
        return 'Point of Sale (POS)'
      case '/driver-pos':
        return 'POS Supir'
      case '/transactions':
        return 'Data Transaksi'
      case '/customers':
        return 'Data Pelanggan'
      case '/projects':
        return 'Proyek'
      case '/production':
        return 'Input Produksi'
      case '/attendance':
        return 'Absensi'
      case '/retasi':
        return 'Retasi'
      case '/sold-items':
        return 'Produk Laku'
      case '/my-commission':
        return 'Komisi Saya'
      case '/customer-map':
        return 'Pelanggan Terdekat'
      case '/quotations':
        return 'Penawaran'
      case '/delivery':
        return 'Pengantaran'
      case '/delivery-report':
        return 'Lapor Antar'
      case '/expenses':
        return 'Pengeluaran'
      default:
        return 'ERP System'
    }
  }

  const handleBack = () => {
    if (currentPath === '/') {
      return
    }

    // Smart navigation for detail pages
    if (currentPath.startsWith('/transactions/')) {
      navigate('/transactions')
    } else if (currentPath.startsWith('/customers/')) {
      navigate('/customers')
    } else {
      // Use history back for most pages to behave like a real mobile app
      // This prevents always jumping back to home if we are in a sub-category
      // But we check history length to avoid exiting the app if possible
      if (window.history.length > 1) {
        navigate(-1)
      } else {
        navigate('/')
      }
    }
  }

  // Handle page refresh
  const handleRefresh = () => {
    setIsRefreshing(true)
    // Reload current page
    window.location.reload()
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-green-50 dark:from-gray-900 dark:to-gray-800 pb-20">
      {/* Mobile Header - Logo, Title, User Actions */}
      <div className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-gray-200 dark:bg-gray-900/80 dark:border-gray-700">
        <div className="flex items-center justify-between px-4 py-3">
          {/* Left - Logo */}
          <div className="flex items-center space-x-2">
            {settings?.logo || localStorage.getItem('company_logo_cached') ? (
              <img
                src={settings?.logo || localStorage.getItem('company_logo_cached') || ''}
                alt="Company Logo"
                className="h-8 w-8 object-contain"
              />
            ) : (
              <Package className="h-8 w-8 text-primary" />
            )}
          </div>

          {/* Center - Title */}
          <div className="flex-1 text-center px-4 overflow-hidden">
            <h1 className="text-lg font-bold text-gray-900 dark:text-white truncate">
              {currentPath === '/' ? (settings?.name || 'ERP System') : getPageTitle(currentPath)}
            </h1>
            <div className="flex items-center justify-center gap-1 text-[10px] text-gray-500 dark:text-gray-400">
              {canAccessAllBranches && currentBranch ? (
                <span className="flex items-center justify-center gap-1 truncate">
                  <Building2 className="h-2.5 w-2.5" />
                  {currentBranch.name}
                </span>
              ) : (
                <span className="truncate">{format(new Date(), "eeee, d MMM yyyy", { locale: id })}</span>
              )}
              {settings?.name && <span className="flex items-center gap-1 truncate"><Building2 className="h-2.5 w-2.5 ml-1" />{settings.name}</span>}
            </div>
          </div>

          {/* Right - User Actions */}
          <div className="flex items-center space-x-1">

            <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(true)} className="h-10 w-10 rounded-full p-0">
              <Avatar className="h-8 w-8">
                <AvatarImage src={user?.avatar} />
                <AvatarFallback className="bg-primary text-white text-xs">
                  {user?.name?.charAt(0) || 'U'}
                </AvatarFallback>
              </Avatar>
            </Button>
            <Button variant="ghost" size="icon" onClick={handleLogout} className="h-10 w-10">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Sidebar Overlay - Auto close when clicking outside */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={cn(
          "fixed left-0 top-0 z-50 w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 transform transition-transform duration-300 ease-in-out",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100dvh', // Use dynamic viewport height for mobile
          maxHeight: '100dvh'
        }}
        onMouseLeave={() => setIsSidebarOpen(false)}
        onTouchStart={resetAutoCloseTimer}
      >
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center space-x-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={user?.avatar} />
              <AvatarFallback className="bg-primary text-white">
                {user?.name?.charAt(0) || 'U'}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0 overflow-hidden">
              <p className="font-medium text-gray-900 dark:text-white truncate">
                {user?.name || 'User'}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                {user?.role || 'Staff'}
              </p>
            </div>
          </div>
        </div>

        <nav
          ref={navRef}
          className="p-4 space-y-2 overflow-y-auto overscroll-contain"
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            WebkitOverflowScrolling: 'touch'
          }}
          onTouchMove={resetAutoCloseTimer}
        >
          {/* Search Bar in Sidebar */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Cari..."
              className="w-full pl-9 pr-9 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {/* Back/Home Button */}
          {currentPath !== '/' && (
            <Button
              variant="outline"
              className={cn(
                "w-full justify-start h-auto p-4 text-left overflow-hidden mb-4",
                "border-gray-300 dark:border-gray-600",
                "transition-all duration-150 ease-out",
                "active:scale-[0.97] active:bg-gray-200 dark:active:bg-gray-700",
                "touch-manipulation select-none"
              )}
              onClick={() => {
                handleBack()
                setIsSidebarOpen(false)
              }}
            >
              <div className="flex items-center space-x-3 w-full overflow-hidden">
                <div className="p-2 rounded-lg flex-shrink-0 bg-gray-100 dark:bg-gray-700">
                  <ArrowLeft className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                </div>
                <div className="flex-1 min-w-0 overflow-hidden">
                  <p className="font-medium truncate text-gray-900 dark:text-white">Kembali</p>
                  <p className="text-sm truncate text-gray-500 dark:text-gray-400">
                    {currentPath.startsWith('/transactions/') ? 'Ke Daftar Transaksi' :
                      currentPath.startsWith('/customers/') ? 'Ke Daftar Pelanggan' :
                        'Ke Beranda'}
                  </p>
                </div>
              </div>
            </Button>
          )}

          {/* Home Button - Always visible */}
          <Button
            variant={currentPath === '/' ? "default" : "ghost"}
            className={cn(
              "w-full justify-start h-auto p-4 text-left overflow-hidden mb-4",
              "transition-all duration-150 ease-out",
              "active:scale-[0.97] active:bg-blue-100 dark:active:bg-blue-900/40",
              "hover:bg-gray-100 dark:hover:bg-gray-800",
              "touch-manipulation select-none",
              currentPath === '/' && "bg-primary text-white active:bg-primary/90"
            )}
            onClick={() => {
              navigate('/')
              setIsSidebarOpen(false)
            }}
          >
            <div className="flex items-center space-x-3 w-full overflow-hidden">
              <div className={cn(
                "p-2 rounded-lg flex-shrink-0",
                currentPath === '/' ? "bg-white/20" : "bg-green-500"
              )}>
                <Home className={cn(
                  "h-5 w-5",
                  currentPath === '/' ? "text-white" : "text-white"
                )} />
              </div>
              <div className="flex-1 min-w-0 overflow-hidden">
                <p className={cn(
                  "font-medium truncate",
                  currentPath === '/' ? "text-white" : "text-gray-900 dark:text-white"
                )}>Beranda</p>
                <p className={cn(
                  "text-sm truncate",
                  currentPath === '/' ? "text-white/80" : "text-gray-500 dark:text-gray-400"
                )}>
                  Dashboard utama
                </p>
              </div>
            </div>
          </Button>

          {menuItems.filter(item =>
            item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.description.toLowerCase().includes(searchQuery.toLowerCase())
          ).map((item) => {
            const Icon = item.icon
            const isActive = currentPath === item.path

            return (
              <Button
                key={item.path}
                ref={isActive ? activeMenuRef : undefined}
                variant={isActive ? "default" : "ghost"}
                className={cn(
                  "w-full justify-start h-auto p-4 text-left overflow-hidden",
                  "transition-all duration-150 ease-out",
                  "active:scale-[0.97] active:bg-blue-100 dark:active:bg-blue-900/40",
                  "hover:bg-gray-100 dark:hover:bg-gray-800",
                  "touch-manipulation select-none",
                  isActive && "bg-primary text-white ring-2 ring-primary/30 active:bg-primary/90"
                )}
                onClick={() => {
                  navigate(item.path)
                  setIsSidebarOpen(false)
                }}
              >
                <div className="flex items-center space-x-3 w-full overflow-hidden">
                  <div className={cn(
                    "p-2 rounded-lg flex-shrink-0 transition-transform duration-150",
                    isActive ? "bg-white/20" : item.color
                  )}>
                    <Icon className={cn(
                      "h-5 w-5",
                      isActive ? "text-white" : item.textColor
                    )} />
                  </div>
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <p className={cn(
                      "font-medium truncate",
                      isActive ? "text-white" : "text-gray-900 dark:text-white"
                    )}>{item.title}</p>
                    <p className={cn(
                      "text-sm truncate",
                      isActive ? "text-white/80" : "text-gray-500 dark:text-gray-400"
                    )}>
                      {item.description}
                    </p>
                  </div>
                </div>
              </Button>
            )
          })}

          {/* Settings Section - Inside scrollable nav */}
          <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-1">
              Pengaturan
            </p>

            {/* Branch Selector - For roles that can switch branches */}
            {canAccessAllBranches && availableBranches.length > 1 && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-2 px-1">
                  <Building2 className="h-3 w-3" />
                  Pindah Cabang
                </label>
                <Select
                  value={currentBranch?.id || ''}
                  onValueChange={(value) => switchBranch(value)}
                >
                  <SelectTrigger className="w-full h-10">
                    <SelectValue placeholder="Pilih cabang...">
                      {currentBranch?.name || 'Pilih cabang...'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {availableBranches.map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        <div className="flex flex-col">
                          <span className="font-medium">{branch.name}</span>
                          <span className="text-xs text-muted-foreground">{branch.code}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Theme Toggle */}
            <Button
              variant="outline"
              className="w-full justify-between h-12 transition-all duration-150 active:scale-95 active:opacity-80 dark:border-gray-600"
              onClick={toggleTheme}
            >
              <span className="flex items-center gap-3">
                <div className={cn(
                  "p-2 rounded-lg",
                  theme === 'dark' ? "bg-indigo-500" : "bg-amber-500"
                )}>
                  {theme === 'dark' ? (
                    <Moon className="h-4 w-4 text-white" />
                  ) : (
                    <Sun className="h-4 w-4 text-white" />
                  )}
                </div>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {theme === 'dark' ? 'Mode Gelap' : 'Mode Terang'}
                </span>
              </span>
              <Badge variant="secondary" className="text-xs dark:bg-gray-700 dark:text-gray-200">
                Aktif
              </Badge>
            </Button>

            {/* Logout Button */}
            <Button
              variant="ghost"
              className="w-full justify-start h-12 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 transition-all duration-150 active:scale-95 active:opacity-80"
              onClick={handleLogout}
            >
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30 mr-3">
                <LogOut className="h-4 w-4" />
              </div>
              Keluar
            </Button>
          </div>

          {/* Bottom padding to ensure last items are accessible */}
          <div className="h-8 flex-shrink-0" />
        </nav>
      </div>

      {/* Main Content */}
      <div className="min-h-screen">
        {/* Home/Dashboard View */}
        {currentPath === '/' && (
          <div className="p-4 space-y-6">
            {/* Welcome Card */}
            <Card className="bg-gradient-to-r from-blue-500 to-green-500 text-white border-0">
              <CardContent className="p-6">
                <div className="flex items-center space-x-4">
                  <Avatar className="h-16 w-16 border-2 border-white/20">
                    <AvatarImage src={user?.avatar} />
                    <AvatarFallback className="bg-white/20 text-white text-lg">
                      {user?.name?.charAt(0) || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h2 className="text-xl font-bold">Selamat Datang!</h2>
                    <p className="text-white/90">{user?.name || 'User'}</p>
                    <p className="text-sm text-white/70">
                      {format(new Date(), "eeee, d MMMM yyyy", { locale: id })}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Quick Actions */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Pilih Aplikasi
                </h3>
              </div>

              {/* Search Bar for Mobile Menu */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Cari menu atau aplikasi..."
                  className="w-full pl-10 pr-10 py-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary shadow-sm text-sm"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="grid gap-4">
                {menuItems.filter(item =>
                  item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  item.description.toLowerCase().includes(searchQuery.toLowerCase())
                ).map((item) => {
                  const Icon = item.icon
                  return (
                    <Card
                      key={item.path}
                      className={cn(
                        "cursor-pointer transition-all duration-200",
                        "hover:shadow-lg hover:scale-[1.02]",
                        "active:scale-[0.97] active:shadow-inner active:bg-blue-50 dark:active:bg-blue-900/30",
                        "touch-manipulation select-none"
                      )}
                      onClick={() => navigate(item.path)}
                    >
                      <CardContent className="p-6">
                        <div className="flex items-center space-x-4">
                          <div className={cn("p-4 rounded-xl transition-transform duration-150", item.color)}>
                            <Icon className={cn("h-8 w-8", item.textColor)} />
                          </div>
                          <div className="flex-1">
                            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
                              {item.title}
                            </h4>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                              {item.description}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Page Content */}
        {currentPath !== '/' && (
          <div className="p-4">
            <Outlet />
          </div>
        )}
      </div>

      {/* Mobile Footer Navigation - Always visible, hide only when sidebar is open */}
      <div className={cn(
        "fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-gray-200 dark:bg-gray-900/95 dark:border-gray-700 transition-transform duration-300",
        isSidebarOpen && "translate-y-full"
      )}>
        <div className="flex items-center justify-between px-4 py-3">
          {/* Left - Menu Button */}
          <Button variant="ghost" size="lg" onClick={toggleSidebar} className="flex items-center space-x-2 h-12 px-4 text-gray-900 dark:text-white">
            {isSidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            <span className="text-sm font-medium">{isSidebarOpen ? 'Tutup' : 'Menu'}</span>
          </Button>

          {/* Center - Refresh Button */}
          <Button
            variant="ghost"
            size="lg"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center space-x-2 h-12 px-4 text-gray-900 dark:text-white"
          >
            <RefreshCw className={cn("h-5 w-5", isRefreshing && "animate-spin")} />
            <span className="text-sm font-medium">Refresh</span>
          </Button>

          {/* Right - Back Button */}
          {currentPath !== '/' ? (
            <Button variant="ghost" size="lg" onClick={handleBack} className="flex items-center space-x-2 h-12 px-4 text-gray-900 dark:text-white">
              <ArrowLeft className="h-5 w-5" />
              <span className="text-sm font-medium">Kembali</span>
            </Button>
          ) : (
            <div className="w-[100px]"></div>
          )}
        </div>
      </div>
    </div>
  )
}

export default MobileLayout