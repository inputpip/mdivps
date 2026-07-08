"use client"

import { Link, useNavigate, useLocation } from "react-router-dom";
import {
  CircleUser, Menu, Package, LogOut, Home, List, Users, Settings, Shield,
  BarChart3, Truck, Factory, Store, UserCheck, Archive, FlaskConical, PieChart, Landmark, BookCheck,
  DollarSign, FileText, Receipt, LayoutGrid, Wallet, Activity, Wrench
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "../ThemeToggle";
import { BranchSelector } from "../BranchSelector";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions, PERMISSIONS } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { isFeatureEnabled } from "@/config/featureSettings";

export function Header() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { hasPermission } = usePermissions();
  const { settings } = useCompanySettings();
  const isDeliveryEnabled = isFeatureEnabled(settings?.appFeatureSettings, 'delivery');

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  // --- SELEKSI MENU PENTING ---

  // Menu Utama (Tampil sebagai Ikon Langsung)
  const mainMenus = [
    { href: "/", label: "Dashboard", icon: Home },
    { href: "/pos", label: "POS Kasir", icon: Store, permission: PERMISSIONS.TRANSACTIONS },
    { href: "/transactions", label: "Transaksi", icon: List, permission: PERMISSIONS.TRANSACTIONS },
    { href: "/delivery", label: "Pengantaran", icon: Truck, permission: PERMISSIONS.DELIVERIES, enabled: isDeliveryEnabled },
    { href: "/materials", label: "Data Barang", icon: Package, permission: PERMISSIONS.MATERIALS },
    { href: "/production", label: "Produksi", icon: Factory, permission: PERMISSIONS.PRODUCTION },
    { href: "/customers", label: "Pelanggan", icon: Users, permission: PERMISSIONS.CUSTOMERS },
  ].filter(item => (item.enabled ?? true) && (!item.permission || hasPermission(item.permission)));

  // Menu Keuangan Utama
  const financialMenus = [
    { href: "/accounts", label: "Akun Keuangan", icon: Landmark },
    { href: "/journal", label: "Jurnal Umum", icon: BookCheck },
    { href: "/receivables", label: "Piutang", icon: Receipt },
    { href: "/accounts-payable", label: "Hutang", icon: DollarSign },
    { href: "/financial-reports", label: "Laporan Keuangan", icon: PieChart },
  ].filter(() => hasPermission(PERMISSIONS.FINANCIAL));

  // Menu Laporan Utama
  const reportMenus = [
    { href: "/stock-report", label: "Laporan Stok", icon: BarChart3 },
    { href: "/transaction-items-report", label: "Laporan Produk Laku", icon: Package },
  ].filter(() => hasPermission(PERMISSIONS.REPORTS));

  // Menu Admin Utama
  const adminMenus = [
    { href: "/employees", label: "Karyawan", icon: UserCheck, permission: PERMISSIONS.EMPLOYEES },
    { href: "/settings", label: "Pengaturan Utama", icon: Wrench, permission: PERMISSIONS.SETTINGS },
    { href: "/roles", label: "Roles", icon: Shield, permission: PERMISSIONS.ROLES },
  ].filter(item => hasPermission(item.permission));

  return (
    <header className="sticky top-0 border-b relative z-50 w-full shadow-md border-slate-800">
      {/* Warna Midnight Slate yang Sejuk */}
      <div className="absolute inset-0 bg-slate-950"></div>
      <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950/90"></div>

      {/* Efek Glassmorphism Halus */}
      <div className="absolute inset-0 backdrop-blur-md bg-white/[0.01]"></div>

      <div className="flex h-16 items-center px-4 md:px-6 w-full max-w-none relative z-10">
        {/* Mobile Menu Trigger */}
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="shrink-0 md:hidden mr-4 text-slate-300 hover:bg-slate-800 h-10 w-10">
              <Menu className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="flex flex-col p-0">
            <Sidebar isCollapsed={false} setCollapsed={() => { }} />
          </SheetContent>
        </Sheet>

        {/* --- NAVIGATION: IMPORTANT ONLY --- */}
        <nav className="hidden md:flex flex-1 items-center justify-start gap-1 overflow-x-auto no-scrollbar scroll-smooth">
          <TooltipProvider delayDuration={0}>
            <div className="flex items-center gap-1 px-1">

              {/* Menu Ikon Langsung */}
              {mainMenus.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.href;

                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>
                      <Link
                        to={item.href}
                        className={cn(
                          "flex items-center justify-center h-10 w-10 rounded-lg transition-all duration-200 hover:scale-110",
                          isActive
                            ? "bg-slate-800 text-white shadow-sm ring-1 ring-white/10"
                            : "text-slate-400 hover:text-white hover:bg-white/5"
                        )}
                      >
                        <Icon className="h-5 w-5" />
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="bg-slate-900 text-white border-slate-700">
                      <p className="text-xs font-semibold">{item.label}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}

              <div className="h-6 w-px bg-slate-800 mx-1.5" />

              {/* Group: Keuangan */}
              {financialMenus.length > 0 && (
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-10 w-10 text-slate-400 hover:text-white hover:bg-white/5 transition-all">
                          <Wallet className="h-5 w-5" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="bg-slate-900 text-white border-slate-700">
                      <p className="text-xs font-semibold">Keuangan</p>
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="start" className="w-52 bg-slate-950 border-slate-800 text-white shadow-2xl ring-1 ring-white/10">
                    <DropdownMenuLabel className="text-[10px] uppercase text-slate-500 tracking-widest px-3 py-2">Finance</DropdownMenuLabel>
                    <DropdownMenuSeparator className="bg-slate-800/50" />
                    {financialMenus.map(item => (
                      <DropdownMenuItem key={item.href} asChild className="hover:bg-indigo-600 focus:bg-indigo-600 transition-colors cursor-pointer">
                        <Link to={item.href} className="flex items-center w-full py-2 px-3 group">
                          <item.icon className="h-4 w-4 mr-3 text-slate-400 group-hover:text-white group-hover:scale-110 transition-all" />
                          <span className="text-sm font-medium text-slate-100 group-hover:text-white">{item.label}</span>
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {/* Group: Laporan */}
              {reportMenus.length > 0 && (
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-10 w-10 text-slate-400 hover:text-white hover:bg-white/5 transition-all">
                          <Activity className="h-5 w-5" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="bg-slate-900 text-white border-slate-700">
                      <p className="text-xs font-semibold">Laporan</p>
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="start" className="w-52 bg-slate-950 border-slate-800 text-white shadow-2xl ring-1 ring-white/10">
                    <DropdownMenuLabel className="text-[10px] uppercase text-slate-500 tracking-widest px-3 py-2">Analytics</DropdownMenuLabel>
                    <DropdownMenuSeparator className="bg-slate-800/50" />
                    {reportMenus.map(item => (
                      <DropdownMenuItem key={item.href} asChild className="hover:bg-amber-600 focus:bg-amber-600 transition-colors cursor-pointer">
                        <Link to={item.href} className="flex items-center w-full py-2 px-3 group">
                          <item.icon className="h-4 w-4 mr-3 text-slate-400 group-hover:text-white group-hover:scale-110 transition-all" />
                          <span className="text-sm font-medium text-slate-100 group-hover:text-white">{item.label}</span>
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {/* Group: Admin */}
              {adminMenus.length > 0 && (
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-10 w-10 text-slate-400 hover:text-white hover:bg-white/5 transition-all">
                          <Settings className="h-5 w-5" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="bg-slate-900 text-white border-slate-700">
                      <p className="text-xs font-semibold">Admin & Sistem</p>
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="start" className="w-52 bg-slate-950 border-slate-800 text-white shadow-2xl ring-1 ring-white/10">
                    <DropdownMenuLabel className="text-[10px] uppercase text-slate-500 tracking-widest px-3 py-2">System</DropdownMenuLabel>
                    <DropdownMenuSeparator className="bg-slate-800/50" />
                    {adminMenus.map(item => (
                      <DropdownMenuItem key={item.href} asChild className="hover:bg-slate-800 focus:bg-slate-800 transition-colors cursor-pointer">
                        <Link to={item.href} className="flex items-center w-full py-2 px-3 group">
                          <item.icon className="h-4 w-4 mr-3 text-slate-400 group-hover:text-white group-hover:scale-110 transition-all" />
                          <span className="text-sm font-medium text-slate-100 group-hover:text-white">{item.label}</span>
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

            </div>
          </TooltipProvider>
        </nav>

        {/* --- USER CONTROLS --- */}
        <div className="flex items-center gap-3 ml-auto">
          {/* User Info */}
          <div className="hidden lg:flex flex-col items-end mr-1 select-none">
            <span className="text-xs font-bold text-white leading-none mb-1">{user?.name}</span>
            <div className="flex items-center gap-1.5 leading-none">
              <div className="w-1 h-1 rounded-full bg-green-500" />
              <span className="text-[9px] text-slate-500 uppercase font-black tracking-widest">{user?.role}</span>
            </div>
          </div>

          <BranchSelector />
          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full h-9 w-9 ring-1 ring-slate-800 hover:bg-slate-800 transition-colors bg-slate-900 overflow-hidden">
                <CircleUser className="h-5 w-5 text-slate-400" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60 bg-slate-950 border-slate-800 text-slate-200 shadow-2xl">
              <div className="p-4 bg-slate-900/50 rounded-t-lg">
                <p className="text-sm font-bold text-white truncate">{user?.name}</p>
                <p className="text-[10px] text-slate-500 truncate">{user?.email}</p>
              </div>
              <DropdownMenuSeparator className="bg-slate-800" />
              <DropdownMenuItem asChild className="hover:bg-slate-800 focus:bg-slate-800 cursor-pointer">
                <Link to="/account-settings" className="flex items-center w-full py-2.5 px-3">
                  <UserCheck className="h-4 w-4 mr-3 text-slate-400" />
                  <span className="text-sm">Pengaturan Akun</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="hover:bg-slate-800 focus:bg-slate-800 cursor-pointer">
                <Link to="/settings" className="flex items-center w-full py-2.5 px-3">
                  <Store className="h-4 w-4 mr-3 text-slate-400" />
                  <span className="text-sm">Info Perusahaan</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-slate-800" />
              <DropdownMenuItem onClick={handleLogout} className="text-rose-500 hover:bg-rose-500/10 focus:bg-rose-500/10 cursor-pointer m-1 rounded-md">
                <LogOut className="mr-3 h-4 w-4" />
                <span className="font-bold text-sm">Keluar Sistem</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}