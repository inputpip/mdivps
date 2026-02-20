import React from "react";
import { useCashFlow } from "@/hooks/useCashFlow";
import { useAccounts } from "@/hooks/useAccounts";
import { useTimezone } from "@/contexts/TimezoneContext";
import { getOfficeDateString } from "@/utils/officeTime";
import { CashFlowTable } from "@/components/CashFlowTable";
import { AccountBalanceTable } from "@/components/AccountBalanceTable";
import { DateRangeReportPDF } from "@/components/DateRangeReportPDF";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, DollarSign, Wallet } from "lucide-react";

export function CashFlowPage() {
  const { cashHistory, isLoading } = useCashFlow();
  const { accounts, isLoading: isAccountsLoading } = useAccounts();
  const { timezone } = useTimezone();

  // Tanggal hari ini di timezone kantor (mis. WIT = Asia/Jayapura)
  const todayStr = React.useMemo(() => getOfficeDateString(timezone), [timezone]);

  // Hitung summary dari data yang sudah ada — tanpa RPC tambahan
  const summary = React.useMemo(() => {
    // Ambil semua akun kas/bank (payment accounts, bukan header)
    const paymentAccounts = (accounts || []).filter(
      (acc) => acc.isPaymentAccount && !acc.isHeader
    );

    // Saldo saat ini = langsung dari accounts.balance (sudah auto-update via DB trigger)
    const currentBalance = paymentAccounts.reduce(
      (sum, acc) => sum + (acc.balance || 0),
      0
    );

    // Filter transaksi hari ini dari cashHistory yang sudah di-fetch
    const todayItems = (cashHistory || []).filter((item) => {
      if (!item.created_at) return false;
      // Convert created_at ke tanggal di timezone kantor
      const itemDateStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(item.created_at));
      return itemDateStr === todayStr;
    });

    // Hitung kas masuk & keluar hari ini
    const todayIncome = todayItems
      .filter((item) => item.transaction_type === "income")
      .reduce((sum, item) => sum + item.amount, 0);

    const todayExpense = todayItems
      .filter((item) => item.transaction_type === "expense")
      .reduce((sum, item) => sum + item.amount, 0);

    const todayNet = todayIncome - todayExpense;

    // Saldo sebelumnya = saldo sekarang dikurangi perubahan hari ini
    const previousBalance = currentBalance - todayNet;

    // Detail per akun untuk AccountBalanceTable
    const accountBalances = paymentAccounts.map((acc) => {
      const accTodayItems = todayItems.filter((t) => t.account_id === acc.id);
      const accTodayIncome = accTodayItems
        .filter((t) => t.transaction_type === "income")
        .reduce((sum, t) => sum + t.amount, 0);
      const accTodayExpense = accTodayItems
        .filter((t) => t.transaction_type === "expense")
        .reduce((sum, t) => sum + t.amount, 0);
      const accTodayNet = accTodayIncome - accTodayExpense;

      return {
        accountId: acc.id,
        accountName: acc.name,
        accountCode: acc.code || "",
        currentBalance: acc.balance || 0,
        previousBalance: (acc.balance || 0) - accTodayNet,
        todayIncome: accTodayIncome,
        todayExpense: accTodayExpense,
        todayNet: accTodayNet,
        todayChange: accTodayNet,
      };
    });

    return { currentBalance, previousBalance, todayIncome, todayExpense, todayNet, accountBalances };
  }, [accounts, cashHistory, todayStr, timezone]);

  const isLoading2 = isLoading || isAccountsLoading;

  const formatRp = (amount: number) =>
    new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(amount);

  return (
    <div className="container mx-auto py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Buku Kas Harian</h1>
          <p className="text-muted-foreground">
            Monitoring kas harian dan mutasi akun kas/bank
          </p>
        </div>
        {cashHistory && <DateRangeReportPDF cashHistory={cashHistory} />}
      </div>

      {/* 4 Kartu Summary — dihitung dari data lokal, tanpa RPC tambahan */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Saldo Kas Saat Ini</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {isLoading2 ? "..." : formatRp(summary.currentBalance)}
            </div>
            <p className="text-xs text-muted-foreground">Total saldo semua akun</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Saldo Sebelumnya</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-600 dark:text-slate-400">
              {isLoading2 ? "..." : formatRp(summary.previousBalance)}
            </div>
            <p className="text-xs text-muted-foreground">Saldo sebelum hari ini</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Kas Masuk Hari Ini</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {isLoading2 ? "..." : formatRp(summary.todayIncome)}
            </div>
            <p className="text-xs text-muted-foreground">Total pemasukan hari ini</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Kas Keluar Hari Ini</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">
              {isLoading2 ? "..." : formatRp(summary.todayExpense)}
            </div>
            <p className="text-xs text-muted-foreground">Total pengeluaran hari ini</p>
          </CardContent>
        </Card>
      </div>

      {/* Banner Arus Kas Bersih Hari Ini */}
      {!isLoading2 && (
        <Card
          className={`mb-6 ${summary.todayNet >= 0
              ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20"
              : "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20"
            }`}
        >
          <CardHeader>
            <CardTitle
              className={`flex items-center gap-2 ${summary.todayNet >= 0
                  ? "text-green-700 dark:text-green-300"
                  : "text-red-700 dark:text-red-300"
                }`}
            >
              {summary.todayNet >= 0 ? (
                <TrendingUp className="h-5 w-5" />
              ) : (
                <TrendingDown className="h-5 w-5" />
              )}
              Arus Kas Bersih Hari Ini
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Selisih antara kas masuk dan kas keluar hari ini
            </p>
          </CardHeader>
          <CardContent>
            <div
              className={`text-3xl font-bold ${summary.todayNet >= 0
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
                }`}
            >
              {formatRp(summary.todayNet)}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Saldo Per Akun (collapsible) */}
      <div className="mb-6">
        <AccountBalanceTable
          data={summary.accountBalances}
          isLoading={isLoading2}
        />
      </div>

      {/* Tabel Mutasi Kas */}
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