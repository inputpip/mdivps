import { TransactionTable } from "@/components/TransactionTable";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useGranularPermission } from "@/hooks/useGranularPermission";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowLeft, Wallet, BookOpen, Receipt, PackageSearch, BarChart3, Truck } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function TransactionListPage() {
  const { hasGranularPermission, isLoading } = useGranularPermission();
  const navigate = useNavigate();

  // Check transactions_view permission
  if (!isLoading && !hasGranularPermission('transactions_view')) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-6">
        <AlertTriangle className="h-16 w-16 text-orange-500 mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Akses Ditolak</h2>
        <p className="text-gray-600 dark:text-gray-400 max-w-md">
          Anda tidak memiliki izin untuk melihat halaman Transaksi.
        </p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => window.history.back()}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Kembali
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
        <div>
          <CardTitle>Data Transaksi</CardTitle>
          <CardDescription>
            Lihat dan kelola semua transaksi yang pernah dibuat.
          </CardDescription>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => navigate('/delivery')}>
            <Truck className="h-4 w-4 mr-2 text-sky-500" />
            Pengantaran
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/commission-report')}>
            <BarChart3 className="h-4 w-4 mr-2 text-indigo-500" />
            Komisi
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/transaction-items-report')}>
            <PackageSearch className="h-4 w-4 mr-2 text-emerald-500" />
            Produk Laku
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/cash-flow')}>
            <Wallet className="h-4 w-4 mr-2 text-blue-500" />
            Buku Kas
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/receivables')}>
            <BookOpen className="h-4 w-4 mr-2 text-orange-500" />
            Piutang
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/expenses')}>
            <Receipt className="h-4 w-4 mr-2 text-red-500" />
            Pengeluaran
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/products')}>
            <PackageSearch className="h-4 w-4 mr-2 text-green-500" />
            Produk
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <TransactionTable />
      </CardContent>
    </Card>
  );
}