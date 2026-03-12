// APK with Server Selection + Full WebView App
// Build: 2024-12-23 v3
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { BranchProvider } from "@/contexts/BranchContext";
import { TimezoneProvider } from "@/contexts/TimezoneContext";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Layout } from "@/components/layout/Layout";
import MobileLayout from "@/components/layout/MobileLayout";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Suspense, lazy, useEffect, useState } from "react";
import PageLoader from "@/components/PageLoader";
import { useChunkErrorHandler } from "@/hooks/useChunkErrorHandler";
import { useMobileDetection } from "@/hooks/useMobileDetection";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { updateFavicon } from "@/utils/faviconUtils";
import { useCacheManager, useBackgroundRefresh } from "@/hooks/useCacheManager";
import { Card, CardContent } from "@/components/ui/card";
import { Building2, MapPin, Check } from "lucide-react";
import { PinValidationDialog } from "@/components/PinValidationDialog";
import { RouteRefreshHandler } from "@/components/RouteRefreshHandler";

// Lazy load all pages
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const PosPage = lazy(() => import("@/pages/PosPage"));
const TransactionListPage = lazy(() => import("@/pages/TransactionListPage"));
const TransactionDetailPage = lazy(() => import("@/pages/TransactionDetailPage"));
const MasterDataStockPage = lazy(() => import("@/pages/MasterDataStockPage"));
const ProductDetailPage = lazy(() => import("@/pages/ProductDetailPage"));
// const MaterialPage = lazy(() => import("@/pages/MaterialPage")); // Replaced by MasterDataStockPage
const ProductionPage = lazy(() => import("@/pages/ProductionPage"));
const MaterialDetailPage = lazy(() => import("@/pages/MaterialDetailPage"));
const CustomerPage = lazy(() => import("@/pages/CustomerPage"));
const CustomerDetailPage = lazy(() => import("@/pages/CustomerDetailPage"));
const EmployeePage = lazy(() => import("@/pages/EmployeePage"));
const PurchaseOrderPage = lazy(() => import("@/pages/PurchaseOrderPage"));
const ChartOfAccountsPage = lazy(() => import("@/pages/ChartOfAccountsPage"));
const AccountDetailPage = lazy(() => import("@/pages/AccountDetailPage"));
const ReceivablesPage = lazy(() => import("@/pages/ReceivablesPage"));
const ExpensesAndAdvancesPage = lazy(() => import("@/pages/ExpensesAndAdvancesPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const AccountSettingsPage = lazy(() => import("@/pages/AccountSettingsPage"));
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const AttendancePage = lazy(() => import("@/pages/AttendancePage"));
const AttendanceReportPage = lazy(() => import("@/pages/AttendanceReportPage"));
const StockReportPage = lazy(() => import("@/pages/StockReportPage"));
const TransactionItemsReportPage = lazy(() => import("@/pages/TransactionItemsReportPage"));
const ProductAnalyticsDebugPage = lazy(() => import("@/pages/ProductAnalyticsDebugPage"));
const MaterialMovementReportPage = lazy(() => import("@/pages/MaterialMovementReportPage"));
const ServiceMaterialReportPage = lazy(() => import("@/pages/ServiceMaterialReportPage"));
const CashFlowPage = lazy(() => import("@/pages/CashFlowPage"));
const RolesPage = lazy(() => import("@/pages/RolesPage"));
const RetasiPage = lazy(() => import("@/pages/RetasiPage"));
const DeliveryPage = lazy(() => import("@/pages/DeliveryPage"));
const DriverPosPage = lazy(() => import("@/pages/DriverPosPage"));
const SupplierPage = lazy(() => import("@/pages/SupplierPage"));
const PayrollPage = lazy(() => import("@/pages/PayrollPage"));
const CommissionReportPage = lazy(() => import("@/pages/CommissionReportPage"));
const FinancialReportsPage = lazy(() => import("@/pages/FinancialReportsPage"));
const AccountsPayablePage = lazy(() => import("@/pages/AccountsPayablePage"));
const AssetsPage = lazy(() => import("@/pages/AssetsPage"));
const MaintenancePage = lazy(() => import("@/pages/MaintenancePage"));
const ZakatPage = lazy(() => import("@/pages/ZakatPage"));
const TaxPage = lazy(() => import("@/pages/TaxPage"));
const BranchManagementPage = lazy(() => import("@/pages/BranchManagementPage"));
const JournalPage = lazy(() => import("@/pages/JournalPage"));
const MaterialUsageSummaryPage = lazy(() => import("@/pages/MaterialUsageSummaryPage"));

const WebManagementPage = lazy(() => import("@/pages/WebManagementPage"));
const CustomerMapPage = lazy(() => import("@/pages/CustomerMapPage"));
const WarehousePage = lazy(() => import("@/pages/WarehousePage"));
const MobileRetasiPage = lazy(() => import("@/pages/MobileRetasiPage"));
const MobileSoldItemsPage = lazy(() => import("@/pages/MobileSoldItemsPage"));
const MobileCommissionPage = lazy(() => import("@/pages/MobileCommissionPage"));
const MobileExpensePage = lazy(() => import("@/pages/MobileExpensePage"));
const MobileMaintenancePage = lazy(() => import("@/pages/MobileMaintenancePage"));
const MobileSalesReportPage = lazy(() => import("@/pages/MobileSalesReportPage"));
const MobileDeliveryReportPage = lazy(() => import("@/pages/MobileDeliveryReportPage"));
const SalesReportPage = lazy(() => import("@/pages/SalesReportPage"));
const DeliveryReportPage = lazy(() => import("@/pages/DeliveryReportPage"));


const QuotationsPage = lazy(() => import("@/pages/QuotationsPage"));
const SERVERS = [
  {
    id: 'nabire',
    name: 'Aquvit Nabire',
    url: 'https://nbx.aquvit.id',
    description: 'Server utama Nabire',
    icon: '🏭',
  },
  {
    id: 'manokwari',
    name: 'Aquvit Manokwari',
    url: 'https://mkw.aquvit.id',
    description: 'Server Manokwari',
    icon: '🏢',
  },
];

const SERVER_STORAGE_KEY = 'aquvit_selected_server';

// Server Selection Screen Component
function ServerSelector({ onSelect }: { onSelect: (url: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [cachedLogo, setCachedLogo] = useState<string | null>(localStorage.getItem('company_logo_cached'));

  useEffect(() => {
    // Check for cached logo periodically or on mount
    setCachedLogo(localStorage.getItem('company_logo_cached'));
  }, []);

  const handleSelect = (server: typeof SERVERS[0]) => {
    setSelected(server.id);
    // Save selection
    localStorage.setItem(SERVER_STORAGE_KEY, server.id);
    // Small delay for visual feedback then redirect
    setTimeout(() => {
      onSelect(server.url);
    }, 300);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-white rounded-2xl mb-4 shadow-md overflow-hidden border border-gray-100 p-2">
            {cachedLogo ? (
              <img src={cachedLogo} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              <Building2 className="w-10 h-10 text-blue-600" />
            )}
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Pilih Server</h1>
          <p className="text-gray-600 mt-2">Pilih lokasi usaha yang ingin diakses</p>
        </div>

        <div className="space-y-4">
          {SERVERS.map((server) => (
            <Card
              key={server.id}
              className={`cursor-pointer transition-all duration-200 hover:shadow-lg ${selected === server.id
                ? 'ring-2 ring-blue-500 bg-blue-50'
                : 'hover:bg-gray-50'
                }`}
              onClick={() => handleSelect(server)}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className="text-4xl">{server.icon}</div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg text-gray-900">
                      {server.name}
                    </h3>
                    <div className="flex items-center gap-1 text-sm text-gray-500">
                      <MapPin className="w-3 h-3" />
                      {server.description}
                    </div>
                  </div>
                  {selected === server.id && (
                    <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                      <Check className="w-5 h-5 text-white" />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="text-center text-xs text-gray-400 mt-8">
          Pilih lokasi untuk membuka aplikasi
        </p>
      </div>
    </div>
  );
}

// Check if running in Capacitor/APK
function isCapacitorApp(): boolean {
  try {
    const { Capacitor } = require('@capacitor/core');
    if (Capacitor.isNativePlatform()) return true;
    const platform = Capacitor.getPlatform();
    if (platform === 'android' || platform === 'ios') return true;
  } catch (e) { }

  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol;
    if (protocol === 'capacitor:' || protocol === 'file:') return true;
  }
  return false;
}

// Main App - Shows server selector first (for Capacitor), then loads web app
function App() {
  const [showSelector, setShowSelector] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // For APK: ALWAYS show server selector on app start (no memory) unless hardcoded
    // For Web: skip selector, use current domain
    const hardcodedServer = import.meta.env.VITE_APK_SERVER;

    if (isCapacitorApp() && !hardcodedServer) {
      // Clear previous selection so user always picks
      localStorage.removeItem('aquvit_selected_server');
      setShowSelector(true);
    }
    setIsReady(true);
  }, []);

  const handleServerSelect = (url: string) => {
    // For APK: reload the app to reinitialize with new server config
    // The client.ts will now use the selected server from localStorage
    window.location.reload();
  };

  if (!isReady) {
    return <PageLoader />;
  }

  if (showSelector) {
    return (
      <ThemeProvider attribute="class" defaultTheme="light" storageKey="vite-ui-theme">
        <ServerSelector onSelect={handleServerSelect} />
      </ThemeProvider>
    );
  }

  // Normal web app flow
  return <WebApp />;
}

function WebApp() {
  // Handle chunk loading errors
  useChunkErrorHandler();

  // Mobile detection
  const { shouldUseMobileLayout } = useMobileDetection();

  // Company settings for favicon
  const { settings } = useCompanySettings();

  // Cache management and optimization
  const { prefetchCriticalData, getCacheStats } = useCacheManager();
  useBackgroundRefresh();

  // Update favicon when company logo changes
  useEffect(() => {
    if (settings?.logo) {
      updateFavicon(settings.logo);
    }
  }, [settings?.logo]);

  // Prefetch critical data on app load
  useEffect(() => {
    const timer = setTimeout(() => {
      prefetchCriticalData();
    }, 1000);

    return () => clearTimeout(timer);
  }, [prefetchCriticalData, getCacheStats]);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" storageKey="vite-ui-theme">
      <AuthProvider>
        <BranchProvider>
          <TimezoneProvider>
            <BrowserRouter future={{
              v7_startTransition: true,
              v7_relativeSplatPath: true
            }}>
              {/* Auto refresh data on navigation */}
              <RouteRefreshHandler />

              {/* PIN Validation Dialog for Owner */}
              <PinValidationDialog />
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />

                  {/* Mobile routes - POS, Attendance, Transactions, and Customers */}
                  {shouldUseMobileLayout ? (
                    <Route element={<ProtectedRoute><MobileLayout /></ProtectedRoute>}>
                      <Route path="/" element={<PosPage />} />
                      <Route path="/pos" element={<PosPage />} />
                      <Route path="/driver-pos" element={<DriverPosPage />} />
                      <Route path="/attendance" element={<AttendancePage />} />
                      <Route path="/transactions" element={<TransactionListPage />} />
                      <Route path="/transactions/:id" element={<TransactionDetailPage />} />
                      <Route path="/customers" element={<CustomerPage />} />
                      <Route path="/customers/:id" element={<CustomerDetailPage />} />
                      <Route path="/customer-map" element={<CustomerMapPage />} />
                      <Route path="/production" element={<ProductionPage />} />
                      <Route path="/warehouse" element={<WarehousePage />} />
                      <Route path="/retasi" element={<MobileRetasiPage />} />
                      <Route path="/delivery" element={<DeliveryPage />} />
                      <Route path="/sold-items" element={<MobileSoldItemsPage />} />
                      <Route path="/my-commission" element={<MobileCommissionPage />} />
                      <Route path="/expenses" element={<MobileExpensePage />} />
                      <Route path="/mobile-maintenance" element={<MobileMaintenancePage />} />
                      <Route path="/mobile-sales-report" element={<MobileSalesReportPage />} />
                      <Route path="/delivery-report" element={<MobileDeliveryReportPage />} />
                      <Route path="/quotations" element={<QuotationsPage />} />
                      <Route path="/quotations/new" element={<QuotationsPage />} />
                      <Route path="/journal" element={<JournalPage />} />
                      <Route path="/employees" element={<EmployeePage />} />

                      <Route path="*" element={<NotFound />} />
                    </Route>
                  ) : (
                    /* Desktop routes - all features */
                    <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                      <Route path="/" element={<DashboardPage />} />
                      <Route path="/pos" element={<PosPage />} />
                      <Route path="/transactions" element={<TransactionListPage />} />
                      <Route path="/transactions/:id" element={<TransactionDetailPage />} />
                      <Route path="/products" element={<MasterDataStockPage />} />
                      <Route path="/products/:id" element={<ProductDetailPage />} />
                      <Route path="/materials" element={<MasterDataStockPage />} />
                      <Route path="/production" element={<ProductionPage />} />
                      <Route path="/materials/:materialId" element={<MaterialDetailPage />} />
                      <Route path="/customers" element={<CustomerPage />} />
                      <Route path="/customers/:id" element={<CustomerDetailPage />} />
                      <Route path="/employees" element={<EmployeePage />} />
                      <Route path="/payroll" element={<PayrollPage />} />
                      <Route path="/suppliers" element={<SupplierPage />} />
                      <Route path="/purchase-orders" element={<PurchaseOrderPage />} />
                      <Route path="/accounts" element={<ChartOfAccountsPage />} />
                      <Route path="/accounts/:id" element={<AccountDetailPage />} />
                      <Route path="/receivables" element={<ReceivablesPage />} />
                      <Route path="/accounts-payable" element={<AccountsPayablePage />} />
                      <Route path="/expenses" element={<ExpensesAndAdvancesPage />} />
                      <Route path="/advances" element={<ExpensesAndAdvancesPage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                      <Route path="/account-settings" element={<AccountSettingsPage />} />
                      <Route path="/attendance" element={<AttendancePage />} />
                      <Route path="/attendance/report" element={<AttendanceReportPage />} />
                      <Route path="/stock-report" element={<StockReportPage />} />
                      <Route path="/transaction-items-report" element={<TransactionItemsReportPage />} />
                      <Route path="/debug/product-analytics" element={<ProductAnalyticsDebugPage />} />
                      <Route path="/material-movements" element={<MaterialMovementReportPage />} />
                      <Route path="/service-material-report" element={<ServiceMaterialReportPage />} />
                      <Route path="/cash-flow" element={<CashFlowPage />} />
                      <Route path="/roles" element={<RolesPage />} />
                      <Route path="/retasi" element={<RetasiPage />} />
                      <Route path="/delivery" element={<DeliveryPage />} />
                      <Route path="/driver-pos" element={<DriverPosPage />} />
                      <Route path="/commission-report" element={<CommissionReportPage />} />
                      <Route path="/financial-reports" element={<FinancialReportsPage />} />
                      <Route path="/assets" element={<AssetsPage />} />
                      <Route path="/maintenance" element={<MaintenancePage />} />
                      <Route path="/zakat" element={<ZakatPage />} />
                      <Route path="/tax" element={<TaxPage />} />
                      <Route path="/branches" element={<BranchManagementPage />} />
                      <Route path="/journal" element={<JournalPage />} />
                      <Route path="/material-usage-summary" element={<MaterialUsageSummaryPage />} />
                      <Route path="/web-management" element={<WebManagementPage />} />
                      <Route path="/customer-map" element={<CustomerMapPage />} />
                      <Route path="/quotations" element={<QuotationsPage />} />
                      <Route path="/quotations/new" element={<QuotationsPage />} />
                      <Route path="/sales-reports" element={<SalesReportPage />} />
                      <Route path="/delivery-report" element={<DeliveryReportPage />} />

                      <Route path="*" element={<NotFound />} />
                    </Route>
                  )}
                </Routes>
              </Suspense>
            </BrowserRouter>
          </TimezoneProvider>
        </BranchProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;