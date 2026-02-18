import { useCashFlow } from "@/hooks/useCashFlow";
import { CashFlowTable } from "@/components/CashFlowTable";
import { AccountBalanceTable } from "@/components/AccountBalanceTable";
import { DateRangeReportPDF } from "@/components/DateRangeReportPDF";
import { GeneralLedgerTable } from "@/components/GeneralLedgerTable";
import { useCashBalance } from "@/hooks/useCashBalance";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingUp, TrendingDown, DollarSign, BookOpen, Wallet } from "lucide-react";

export function CashFlowPage() {
  const { cashHistory, isLoading } = useCashFlow();
  const { cashBalance, isLoading: isBalanceLoading } = useCashBalance();

  return (
    <div className="container mx-auto py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Buku Kas Harian</h1>
          <p className="text-muted-foreground">
            Monitoring kas harian dan mutasi akun kas/bank
          </p>
        </div>

        {/* PDF Export Button with Date Picker */}
        {cashHistory && (
          <DateRangeReportPDF
            cashHistory={cashHistory}
          />
        )}
      </div>

      {/* Cash Balance Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Saldo Kas Saat Ini</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {isBalanceLoading ? "..." : new Intl.NumberFormat("id-ID", {
                style: "currency",
                currency: "IDR",
                minimumFractionDigits: 0,
              }).format(cashBalance?.currentBalance || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              Total saldo semua akun
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Saldo Sebelumnya</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-600 dark:text-slate-400">
              {isBalanceLoading ? "..." : new Intl.NumberFormat("id-ID", {
                style: "currency",
                currency: "IDR",
                minimumFractionDigits: 0,
              }).format(cashBalance?.previousBalance || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              Saldo sebelum hari ini
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Kas Masuk Hari Ini</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {isBalanceLoading ? "..." : new Intl.NumberFormat("id-ID", {
                style: "currency",
                currency: "IDR",
                minimumFractionDigits: 0,
              }).format(cashBalance?.todayIncome || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              Total pemasukan hari ini
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Kas Keluar Hari Ini</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">
              {isBalanceLoading ? "..." : new Intl.NumberFormat("id-ID", {
                style: "currency",
                currency: "IDR",
                minimumFractionDigits: 0,
              }).format(cashBalance?.todayExpense || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              Total pengeluaran hari ini
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Net Cash Flow Today */}
      {cashBalance && (
        <Card className={`mb-6 ${cashBalance.todayNet >= 0 ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20' : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20'}`}>
          <CardHeader>
            <CardTitle className={`flex items-center gap-2 ${cashBalance.todayNet >= 0 ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
              {cashBalance.todayNet >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
              Arus Kas Bersih Hari Ini
            </CardTitle>
            <CardDescription>
              Selisih antara kas masuk dan kas keluar hari ini
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${cashBalance.todayNet >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {new Intl.NumberFormat("id-ID", {
                style: "currency",
                currency: "IDR",
                minimumFractionDigits: 0,
              }).format(cashBalance.todayNet)}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Account Balance Details */}
      <div className="mb-6">
        <AccountBalanceTable
          data={cashBalance?.accountBalances || []}
          isLoading={isBalanceLoading}
        />
      </div>

      {/* Cash Flow Table Only */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <Wallet className="h-4 w-4" />
          <h2 className="text-lg font-semibold">Mutasi Kas</h2>
        </div>
        <CashFlowTable data={cashHistory || []} isLoading={isLoading} />
      </div>
    </div>
  );
}

export default CashFlowPage;