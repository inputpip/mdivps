"use client"

import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Home,
  ShoppingCart,
  Package,
  Box,
  Settings,
  Users,
  FileText,
  List,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Landmark,
  HandCoins,
  ReceiptText,
  IdCard,
  Fingerprint,
  BookCheck,
  BarChart3,
  PackageOpen,
  Package2,
  Shield,
  TrendingUp,
  Factory,
  Truck,
  Calculator,
  BriefcaseBusiness,
  PieChart,
  Building,
  DollarSign,
  Search,
  X,
  Wrench,
  Sparkles,
  Building2,
  Server,
  MapPin,
  History,
  Receipt,
  Lock,
  Unlock,
  FolderArchive,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { usePermissions, PERMISSIONS, Permission } from "@/hooks/usePermissions";
import { useAuth } from "@/hooks/useAuth";
import { useGranularPermission } from "@/hooks/useGranularPermission";
import { isFeatureEnabled } from '@/config/featureSettings';

// Section color configuration for modern gradient look (with dark mode support)
const sectionColors: Record<string, { bg: string; text: string; activeBg: string }> = {
  "Utama": { bg: "bg-blue-50 dark:bg-blue-950/50", text: "text-blue-700 dark:text-blue-300", activeBg: "bg-blue-600 dark:bg-blue-500" },
  "Manajemen Data": { bg: "bg-emerald-50 dark:bg-emerald-950/50", text: "text-emerald-700 dark:text-emerald-300", activeBg: "bg-emerald-600 dark:bg-emerald-500" },
  "Keuangan": { bg: "bg-amber-50 dark:bg-amber-950/50", text: "text-amber-700 dark:text-amber-300", activeBg: "bg-amber-600 dark:bg-amber-500" },
  "Aset, Zakat & Pajak": { bg: "bg-purple-50 dark:bg-purple-950/50", text: "text-purple-700 dark:text-purple-300", activeBg: "bg-purple-600 dark:bg-purple-500" },
  "Laporan": { bg: "bg-rose-50 dark:bg-rose-950/50", text: "text-rose-700 dark:text-rose-300", activeBg: "bg-rose-600 dark:bg-rose-500" },
  "Pengaturan": { bg: "bg-slate-100 dark:bg-slate-800/50", text: "text-slate-700 dark:text-slate-300", activeBg: "bg-slate-600 dark:bg-slate-500" },
};

/*
 * Sidebar menu configuration.
 *
 * The application groups navigation links into a small number of top‑level
 * sections. Each section may be expanded or collapsed independently to make
 * long menus easier to scan. In addition, all report pages are grouped under
 * a dedicated "Laporan" section (Reports) rather than being mixed into other
 * management or finance sections. If you need to adjust or extend the menu
 * simply modify the data structure below – the rendering logic will adapt
 * automatically.
 */
const getMenuItems = (
  hasPermission: (permission: Permission) => boolean,
  hasGranularPermission: (permission: string) => boolean,
  userRole: string | undefined,
  featureSettings?: Parameters<typeof isFeatureEnabled>[0]
) => {
  const hasAnyGranularPermission = (permissions: string | string[]) => {
    const permissionList = Array.isArray(permissions) ? permissions : [permissions];
    return permissionList.some(permission => hasGranularPermission(permission));
  };

  const canAccessMenuItem = (item: any) => {
    if (item.featureKey && !isFeatureEnabled(featureSettings, item.featureKey)) {
      return false;
    }

    if (item.roles && userRole && !item.roles.includes(userRole.toLowerCase())) {
      return false;
    }

    if (item.granularPermissions) {
      return hasAnyGranularPermission(item.granularPermissions);
    }

    if (item.granularPermission) {
      return hasGranularPermission(item.granularPermission);
    }

    return item.permission ? hasPermission(item.permission) : true;
  };

  return [
  {
    title: "Utama",
    items: [
      { href: "/", label: "Dashboard", icon: Home },
      { href: "/pos", label: "Point of Sale (POS)", icon: ShoppingCart, granularPermissions: ['pos_access', 'transactions_create'] },
      { href: "/driver-pos", label: "POS Supir", icon: Truck, granularPermission: 'pos_driver_access', featureKey: 'delivery' as const },
      { href: "/transactions", label: "Data Transaksi", icon: List, granularPermission: 'transactions_view' },
      { href: "/quotations", label: "Penawaran", icon: FileText, granularPermissions: ['quotations_view', 'quotations_create'], featureKey: 'quotations' as const },
      { href: "/delivery", label: "Pengantaran", icon: Truck, granularPermission: 'delivery_view', featureKey: 'delivery' as const },
      { href: "/delivery-report", label: "Lapor Antar", icon: MapPin, granularPermissions: ['delivery_report_view', 'delivery_report_create', 'mobile_delivery_report'], featureKey: 'delivery_reports' as const },
      { href: "/retasi", label: "Retasi", icon: Package, granularPermission: 'retasi_view', featureKey: 'retasi' as const },
      { href: "/transaction-items-report", label: "Laporan Produk Laku", icon: PackageOpen, granularPermission: 'transaction_items_report' },
      { href: "/sales-reports", label: "Laporan Sales", icon: MapPin, granularPermissions: ['transaction_reports', 'commission_report', 'mobile_sales_report'], featureKey: 'sales_reports' as const },
      { href: "/attendance", label: "Absensi", icon: Fingerprint, permission: PERMISSIONS.ATTENDANCE, featureKey: 'attendance' as const },
      { href: "/expenses", label: "Pengeluaran & Kasbon", icon: FileText, granularPermissions: ['expenses_view', 'advances_view'] },
    ].filter(canAccessMenuItem),
  },
  {
    title: "Manajemen Data",
    items: [
      { href: "/materials", label: "Barang & Stok", icon: Box, permission: PERMISSIONS.MATERIALS },
      { href: "/production", label: "Produksi", icon: Factory, granularPermission: 'production_view', featureKey: 'production_bom' as const },
      { href: "/customers", label: "Pelanggan", icon: Users, granularPermission: 'customers_view' },
      { href: "/customer-map", label: "Pelanggan Terdekat", icon: MapPin, granularPermissions: ['customer_map_access', 'customers_view'] },
      { href: "/projects", label: "Proyek", icon: BriefcaseBusiness, permission: PERMISSIONS.TRANSACTIONS, featureKey: 'projects' as const },
      { href: "/employees", label: "Karyawan", icon: IdCard, permission: PERMISSIONS.EMPLOYEES },
      { href: "/suppliers", label: "Supplier", icon: Building, granularPermission: 'suppliers_view' },
      { href: "/purchase-orders", label: "Purchase Orders", icon: ClipboardList, granularPermissions: ['purchase_orders_view', 'purchase_orders_create'], featureKey: 'purchase_orders' as const },
    ].filter(canAccessMenuItem),
  },
  {
    title: "Keuangan",
    items: [
      { href: "/accounts", label: "Akun Keuangan", icon: Landmark, granularPermission: 'accounts_view' },
      { href: "/journal", label: "Jurnal Umum", icon: BookCheck, granularPermissions: ['accounts_view', 'financial_reports'] },
      { href: "/cash-flow", label: "Buku Kas Harian", icon: TrendingUp, granularPermission: 'cash_flow_view' },
      { href: "/receivables", label: "Piutang", icon: ReceiptText, granularPermission: 'receivables_view' },
      { href: "/accounts-payable", label: "Hutang", icon: DollarSign, granularPermission: 'payables_view' },
      { href: "/financial-reports", label: "Laporan Keuangan", icon: PieChart, granularPermission: 'financial_reports' },
    ].filter(canAccessMenuItem),
  },
  {
    title: "Aset, Zakat & Pajak",
    items: [
      { href: "/assets", label: "Aset & Maintenance", icon: Wrench, granularPermission: 'assets_view', featureKey: 'assets_maintenance' as const },
      { href: "/maintenance", label: "Jadwal Maintenance", icon: Wrench, granularPermission: 'maintenance_view', featureKey: 'assets_maintenance' as const },
      { href: "/zakat", label: "Zakat & Sedekah", icon: Sparkles, granularPermission: 'zakat_view', featureKey: 'zakat' as const },
      { href: "/tax", label: "Pajak (PPN)", icon: Receipt, granularPermission: 'financial_reports', featureKey: 'tax' as const },
    ].filter(canAccessMenuItem),
  },
  {
    title: "Laporan",
    items: [
      { href: "/stock-report", label: "Laporan Stock", icon: BarChart3, granularPermission: 'stock_reports' },
      { href: "/material-movements", label: "Pergerakan Penggunaan Bahan", icon: Package2, granularPermission: 'material_movement_report' },
      { href: "/attendance/report", label: "Laporan Absensi", icon: BookCheck, granularPermission: 'attendance_reports', featureKey: 'attendance' as const },
      { href: "/commission-report", label: "Komisi Saya", icon: Calculator, granularPermissions: ['commission_view', 'commission_report', 'mobile_commission'] },
    ].filter(canAccessMenuItem),
  },
  {
    title: "Pengaturan",
    items: [
      { href: "/settings", label: "Pengaturan", icon: Settings, permission: PERMISSIONS.SETTINGS },
      { href: "/roles", label: "Manajemen Roles", icon: Shield, permission: PERMISSIONS.ROLES },
      { href: "/branches", label: "Manajemen Cabang", icon: Building2, permission: PERMISSIONS.SETTINGS },
      { href: "/web-management", label: "Web Management", icon: Server, permission: PERMISSIONS.SETTINGS, roles: ['owner'] },
      { href: "/company-archive", label: "Arsip Berkas", icon: FolderArchive, permission: PERMISSIONS.SETTINGS, roles: ['owner'] },
      { href: "/audit-logs", label: "Log Aktivitas (Audit)", icon: History, permission: PERMISSIONS.SETTINGS, roles: ['owner'] },

    ].filter(canAccessMenuItem),
  },
].filter(section => section.items.length > 0);
};

interface SidebarProps {
  /**
   * Whether the entire sidebar is collapsed into icon‑only mode. This prop is
   * controlled by the parent layout. When `true`, section headers and link
   * labels are hidden and only icons remain visible.
   */
  isCollapsed: boolean;
  /**
   * Callback to toggle the collapsed state. Handlers within this component
   * should call this to shrink or expand the sidebar.
   */
  setCollapsed: (isCollapsed: boolean) => void;
  onHoverChange?: (isHovering: boolean) => void;
}

export function Sidebar({ isCollapsed, setCollapsed, onHoverChange }: SidebarProps) {
  const location = useLocation();
  const { settings } = useCompanySettings();
  const { hasPermission } = usePermissions();
  const { user } = useAuth();
  const { hasGranularPermission } = useGranularPermission();

  // Get filtered menu items based on user permissions and role
  const rawMenuItems = getMenuItems(
    hasPermission,
    hasGranularPermission,
    user?.role,
    settings?.appFeatureSettings
  );

  // Final menu is already resolved from Feature Settings + Role Management.
  // Avoid role-name allowlists here so Role Management remains the source of truth.
  const menuItems = rawMenuItems;

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Lock state for submenus
  const [isLocked, setIsLocked] = useState(() => {
    const saved = localStorage.getItem('sidebar_locked');
    return saved === 'true';
  });

  const toggleLock = () => {
    const newState = !isLocked;
    setIsLocked(newState);
    localStorage.setItem('sidebar_locked', newState.toString());
    if (newState) {
      // Expand all sections when locking
      const allExpanded: Record<string, boolean> = {};
      menuItems.forEach(s => allExpanded[s.title] = true);
      setOpenSections(allExpanded);
    }
  };

  // Auto-expand on hover state
  const [isHoverExpanded, setIsHoverExpanded] = useState(false);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const leaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Handle mouse enter - expand sidebar after small delay
  const handleMouseEnter = useCallback(() => {
    if (isCollapsed && !isHoverExpanded) {
      // Clear any pending leave timeout
      if (leaveTimeoutRef.current) {
        clearTimeout(leaveTimeoutRef.current);
        leaveTimeoutRef.current = null;
      }
      // Expand after 150ms delay
      hoverTimeoutRef.current = setTimeout(() => {
        setIsHoverExpanded(true);
        onHoverChange?.(true);
        // Auto focus search input after expand
        setTimeout(() => {
          searchInputRef.current?.focus();
        }, 100);
      }, 150);
    }
  }, [isCollapsed, isHoverExpanded]);

  // Handle mouse leave - collapse sidebar after delay
  const handleMouseLeave = useCallback(() => {
    // Clear any pending hover timeout
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    if (isHoverExpanded) {
      // Collapse after 300ms delay
      leaveTimeoutRef.current = setTimeout(() => {
        setIsHoverExpanded(false);
        onHoverChange?.(false);
      }, 150);
    }
  }, [isHoverExpanded]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      if (leaveTimeoutRef.current) clearTimeout(leaveTimeoutRef.current);
    };
  }, []);

  // Determine if sidebar should show expanded content
  const showExpanded = !isCollapsed || isHoverExpanded;

  // Track expanded/collapsed state for each top‑level menu section. When
  // `true` the section's links are visible, otherwise they are hidden. Use
  // section titles as keys since they are stable.
  const [openSections, setOpenSections] = useState(() => {
    const initialState: Record<string, boolean> = {};
    menuItems.forEach((section) => {
      initialState[section.title] = true; // sections are expanded by default
    });
    return initialState;
  });

  function toggleSection(title: string) {
    if (isLocked) return; // Prevent toggling if locked
    setOpenSections((prev) => ({ ...prev, [title]: !prev[title] }));
  }

  // Filter menu items based on search query
  const filteredMenuItems = searchQuery.trim() === ""
    ? menuItems
    : menuItems.map(section => ({
      ...section,
      items: section.items.filter(item =>
        item.label.toLowerCase().includes(searchQuery.toLowerCase())
      )
    })).filter(section => section.items.length > 0);

  // Flatten items for Arrow Key Navigation
  const flatMenuItems = useMemo(() => {
    return filteredMenuItems.flatMap(section => 
       (openSections[section.title] || searchQuery.trim() !== "" || isLocked) ? section.items : []
    );
  }, [filteredMenuItems, openSections, searchQuery, isLocked]);

  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset selected index when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  // Global hotkey to toggle sidebar & focus search using backtick (`)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === '`') {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          setCollapsed(!isCollapsed);
          setIsHoverExpanded(false);
          if (isCollapsed) {
            setTimeout(() => searchInputRef.current?.focus(), 100);
          }
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isCollapsed, setCollapsed]);

  // Handle search input keydown - open selected result in new tab on Enter / Arrow Keys
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, Math.max(0, flatMenuItems.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selectedItem = flatMenuItems[selectedIndex];
      if (selectedItem) {
        setSearchQuery("");
        setSelectedIndex(0);
        setIsHoverExpanded(false);
        window.open(selectedItem.href, '_blank', 'noopener,noreferrer');
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setSearchQuery("");
      setSelectedIndex(0);
    }
  };

  // Auto-expand sections with search results or when locked
  useEffect(() => {
    if (searchQuery.trim() !== "" || isLocked) {
      const newOpenSections: Record<string, boolean> = {};
      filteredMenuItems.forEach((section) => {
        newOpenSections[section.title] = true;
      });
      setOpenSections(newOpenSections);
    }
  }, [searchQuery, isLocked]);

  return (
    <div
      className={cn(
        "h-full border-r bg-slate-50 dark:bg-slate-900 transition-all duration-200 ease-in-out dark:border-slate-700",
        showExpanded ? "w-[220px] lg:w-[280px]" : "w-[60px]",
        isHoverExpanded && isCollapsed && "shadow-2xl bg-white dark:bg-slate-950 border-r-indigo-500/50"
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <TooltipProvider delayDuration={0}>
        <div className="flex h-full max-h-screen flex-col">
          <div
            className={cn(
              "flex h-14 items-center border-b lg:h-[60px]",
              !showExpanded ? "justify-center" : "px-4 lg:px-6"
            )}
          >
            <Link to="/" className="flex items-center gap-2 font-semibold">
              {settings?.logo ? (
                <img src={settings.logo} alt="Logo" className="h-6 w-6 object-contain" />
              ) : (
                <Package className="h-6 w-6 text-primary" />
              )}
              <span className={cn(!showExpanded && "hidden")}>{settings?.name || 'Aquvit POS'}</span>
            </Link>
          </div>

          {/* Search Menu */}
          {showExpanded && (
            <div className="px-3 py-2 border-b">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Ketik & Enter..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  className="w-full rounded-md border border-input bg-background pl-8 pr-8 py-1.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
                {searchQuery ? (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : (
                  <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/60 bg-muted px-1 py-0.5 rounded">
                    ↵
                  </kbd>
                )}
              </div>
              {/* Show first result hint when searching */}
              {searchQuery && flatMenuItems[selectedIndex] && (
                <div className="mt-1.5 text-xs text-muted-foreground flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <span>Enter →</span>
                    <span className="font-medium text-foreground">{flatMenuItems[selectedIndex].label}</span>
                  </div>
                </div>
              )}

            </div>
          )}

          <nav className={cn(
            "flex-1 space-y-3 overflow-auto py-4 px-2",
            showExpanded && "min-w-[220px]"
          )}>
            {filteredMenuItems.map((section) => {
              const colors = sectionColors[section.title] || sectionColors["Utama"];

              return (
                <div key={section.title} className="space-y-1">
                  {/* Section header with gradient */}
                  {showExpanded && (
                    <button
                      type="button"
                      className={cn(
                        "mb-1 flex w-full items-center justify-between px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors",
                        colors.bg,
                        colors.text
                      )}
                      onClick={() => toggleSection(section.title)}
                    >
                      <span>{section.title}</span>
                      {openSections[section.title] ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                  <div
                    className={cn(
                      !showExpanded && "flex flex-col items-center",
                      !openSections[section.title] && showExpanded && "hidden"
                    )}
                  >
                    {section.items.map((item) => {
                      const isActive = location.pathname === item.href;
                      const isSelectedByKeyboard = showExpanded && flatMenuItems[selectedIndex]?.href === item.href;

                      return !showExpanded ? (
                        <Tooltip key={item.href}>
                          <TooltipTrigger asChild>
                            <Link
                              to={item.href}
                              className={cn(
                                "flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-all hover:scale-105",
                                isActive && cn(colors.activeBg, "text-white shadow-md")
                              )}
                            >
                              <item.icon className="h-5 w-5" />
                              <span className="sr-only">{item.label}</span>
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent side="right">{item.label}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <Link
                          key={item.href}
                          to={item.href}
                          className={cn(
                            "flex items-center gap-3 rounded-lg px-3 py-2 transition-all whitespace-nowrap",
                            isActive 
                              ? cn(colors.activeBg, "text-white shadow-md hover:brightness-110") 
                              : "text-muted-foreground hover:bg-white/10 hover:text-indigo-600 dark:hover:text-indigo-400",
                            isSelectedByKeyboard && !isActive && "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300 shadow-[inset_2px_0_0_0_#4f46e5]"
                          )}
                        >
                          <item.icon className="h-4 w-4" />
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>
          <div className="mt-auto border-t p-2">
            <div className={cn("flex items-center gap-2", !showExpanded ? "flex-col" : "justify-between")}>
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8"
                onClick={() => {
                  setCollapsed(!isCollapsed);
                  setIsHoverExpanded(false);
                }}
              >
                {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                <span className="sr-only">Toggle Sidebar</span>
              </Button>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant={isLocked ? "default" : "outline"}
                    className={cn(
                      "h-8 w-8 transition-all",
                      isLocked && "bg-indigo-600 hover:bg-indigo-700 text-white shadow-md"
                    )}
                    onClick={toggleLock}
                  >
                    {isLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {isLocked ? "Unlock Sub-menus" : "Lock Expand All Sub-menus"}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div >
      </TooltipProvider >
    </div >
  );
}
