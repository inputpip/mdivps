"use client"

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  TrendingUp,
  DollarSign,
  BarChart3,
  FileText,
  Calendar,
  Download,
  Loader2,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  Building,
  CreditCard,
  Banknote,
  Building2,
  BookOpen,
  Lock,
  Unlock
} from 'lucide-react';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { id } from 'date-fns/locale/id';
import {
  generateBalanceSheet,
  generateIncomeStatement,
  generateCashFlowStatement,
  type BalanceSheetData,
  type IncomeStatementData,
  type CashFlowStatementData,
  formatCurrency
} from '@/utils/financialStatementsUtils';
import { useToast } from '@/hooks/use-toast';
import { downloadCashFlowPDF, PrinterInfo as CashFlowPrinterInfo } from '@/components/CashFlowPDF';
import { downloadBalanceSheetPDF, PrinterInfo as BalanceSheetPrinterInfo } from '@/components/BalanceSheetPDF';
import { downloadIncomeStatementPDF, PrinterInfo } from '@/components/IncomeStatementPDF';
import { useBranch } from '@/contexts/BranchContext';
import { useAuth } from '@/hooks/useAuth';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useClosingEntry } from '@/hooks/useClosingEntry';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const FinancialReportsPage = () => {
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetData | null>(null);
  const [incomeStatement, setIncomeStatement] = useState<IncomeStatementData | null>(null);
  const [cashFlowStatement, setCashFlowStatement] = useState<CashFlowStatementData | null>(null);

  const [loading, setLoading] = useState({ balanceSheet: false, incomeStatement: false, cashFlow: false });

  // Default to current month - all reports use same date range
  const [periodFrom, setPeriodFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [periodTo, setPeriodTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));

  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());

  const handleMonthYearChange = (month: number, year: number) => {
    const date = new Date(year, month, 1);
    const fromDate = format(startOfMonth(date), 'yyyy-MM-dd');
    const toDate = format(endOfMonth(date), 'yyyy-MM-dd');
    setPeriodFrom(fromDate);
    setPeriodTo(toDate);
  };

  const { toast } = useToast();

  // Auth context for printer info
  const { user } = useAuth();

  // Branch context
  const { currentBranch, availableBranches, canAccessAllBranches } = useBranch();
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');

  // Closing Entry hook
  const {
    loading: closingLoading,
    preview: closingPreview,
    closedYears,
    fetchPreview,
    fetchClosedYears,
    executeClosing,
    voidClosing,
    clearPreview
  } = useClosingEntry();

  const [closingYear, setClosingYear] = useState<number>(new Date().getFullYear());
  const [showClosingConfirm, setShowClosingConfirm] = useState(false);

  // Sync selectedBranchId when currentBranch changes (after loading)
  useEffect(() => {
    if (currentBranch?.id && !selectedBranchId) {
      setSelectedBranchId(currentBranch.id);
    }
  }, [currentBranch?.id]);

  // Fetch closed years when branch changes
  useEffect(() => {
    if (selectedBranchId) {
      fetchClosedYears(selectedBranchId);
    }
  }, [selectedBranchId, fetchClosedYears]);

  const handleGenerateBalanceSheet = async () => {
    if (!selectedBranchId) {
      toast({
        variant: 'destructive',
        title: 'Gagal',
        description: 'Silakan pilih cabang terlebih dahulu'
      });
      return;
    }
    setLoading(prev => ({ ...prev, balanceSheet: true }));
    try {
      // Use periodTo as the balance sheet date (as of date)
      const data = await generateBalanceSheet(new Date(periodTo), selectedBranchId);
      setBalanceSheet(data);
      toast({
        title: 'Sukses',
        description: `Neraca per ${format(new Date(periodTo), 'd MMMM yyyy', { locale: id })} berhasil dibuat`
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Gagal',
        description: error instanceof Error ? error.message : 'Terjadi kesalahan'
      });
    } finally {
      setLoading(prev => ({ ...prev, balanceSheet: false }));
    }
  };

  const handleGenerateIncomeStatement = async () => {
    if (!selectedBranchId) {
      toast({
        variant: 'destructive',
        title: 'Gagal',
        description: 'Silakan pilih cabang terlebih dahulu'
      });
      return;
    }
    setLoading(prev => ({ ...prev, incomeStatement: true }));
    try {
      const data = await generateIncomeStatement(new Date(periodFrom), new Date(periodTo), selectedBranchId);
      setIncomeStatement(data);
      toast({
        title: 'Sukses',
        description: 'Laporan Laba Rugi berhasil dibuat dari data transaksi'
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Gagal',
        description: error instanceof Error ? error.message : 'Terjadi kesalahan'
      });
    } finally {
      setLoading(prev => ({ ...prev, incomeStatement: false }));
    }
  };

  const handleGenerateCashFlow = async () => {
    if (!selectedBranchId) {
      toast({
        variant: 'destructive',
        title: 'Gagal',
        description: 'Silakan pilih cabang terlebih dahulu'
      });
      return;
    }
    setLoading(prev => ({ ...prev, cashFlow: true }));
    try {
      const data = await generateCashFlowStatement(new Date(periodFrom), new Date(periodTo), selectedBranchId);
      setCashFlowStatement(data);
      toast({
        title: 'Sukses',
        description: 'Laporan Arus Kas berhasil dibuat dari cash history'
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Gagal',
        description: error instanceof Error ? error.message : 'Terjadi kesalahan'
      });
    } finally {
      setLoading(prev => ({ ...prev, cashFlow: false }));
    }
  };

  const loadPresetPeriod = (months: number) => {
    const endDate = new Date();
    const startDate = subMonths(startOfMonth(endDate), months - 1);
    setPeriodFrom(format(startDate, 'yyyy-MM-dd'));
    setPeriodTo(format(endOfMonth(endDate), 'yyyy-MM-dd'));

    // If selecting single month (Bulan Ini), update the month/year pickers too
    if (months === 1) {
      setSelectedMonth(endDate.getMonth());
      setSelectedYear(endDate.getFullYear());
    }
  };

  // Closing Entry handlers
  const handlePreviewClosing = async () => {
    if (!selectedBranchId) {
      toast({
        variant: 'destructive',
        title: 'Gagal',
        description: 'Silakan pilih cabang terlebih dahulu'
      });
      return;
    }
    await fetchPreview(closingYear, selectedBranchId);
  };

  const handleConfirmClosing = async () => {
    if (!selectedBranchId || !user?.id) return;
    const success = await executeClosing(closingYear, selectedBranchId, user.id);
    if (success) {
      setShowClosingConfirm(false);
      clearPreview();
    }
  };

  const handleVoidClosing = async (year: number) => {
    if (!selectedBranchId) return;
    await voidClosing(year, selectedBranchId);
  };

  const isYearAlreadyClosed = closedYears.some(cy => cy.year === closingYear);

  return (
    <div className="container mx-auto py-8 space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold flex items-center justify-center gap-2">
          <BarChart3 className="h-8 w-8" />
          Laporan Keuangan
        </h1>
        <p className="text-muted-foreground">
          Laporan keuangan berdasarkan data real dari aplikasi Anda
        </p>
      </div>

      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pengaturan Periode</CardTitle>
          <CardDescription>
            Pilih cabang dan periode untuk laporan keuangan
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Branch Selector - ALWAYS show for debugging */}
          <div className="space-y-2">
            <Label htmlFor="branchSelect" className="flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Pilih Cabang untuk Laporan
            </Label>
            <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
              <SelectTrigger id="branchSelect">
                <SelectValue placeholder="Pilih cabang..." />
              </SelectTrigger>
              <SelectContent>
                {availableBranches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedBranchId && (
              <p className="text-xs text-muted-foreground">
                Branch ID: {selectedBranchId}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="periodFrom">Dari Tanggal</Label>
              <Input
                id="periodFrom"
                type="date"
                value={periodFrom}
                onChange={(e) => setPeriodFrom(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="periodTo">Sampai Tanggal</Label>
              <Input
                id="periodTo"
                type="date"
                value={periodTo}
                onChange={(e) => setPeriodTo(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Neraca akan dibuat per tanggal ini
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => loadPresetPeriod(1)}>
                Bulan Ini
              </Button>
              <Button variant="outline" size="sm" onClick={() => loadPresetPeriod(3)}>
                3 Bulan
              </Button>
              <Button variant="outline" size="sm" onClick={() => loadPresetPeriod(6)}>
                6 Bulan
              </Button>
              <Button variant="outline" size="sm" onClick={() => loadPresetPeriod(12)}>
                1 Tahun
              </Button>
            </div>

            <div className="flex items-center gap-2 border-l pl-6">
              <Label className="text-sm font-medium whitespace-nowrap flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Lompat ke Bulan:
              </Label>
              <div className="flex gap-2">
                <Select
                  value={String(selectedMonth)}
                  onValueChange={(val) => {
                    const m = parseInt(val);
                    setSelectedMonth(m);
                    handleMonthYearChange(m, selectedYear);
                  }}
                >
                  <SelectTrigger className="w-[140px] h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {format(new Date(2000, i, 1), 'MMMM', { locale: id })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={String(selectedYear)}
                  onValueChange={(val) => {
                    const y = parseInt(val);
                    setSelectedYear(y);
                    handleMonthYearChange(selectedMonth, y);
                  }}
                >
                  <SelectTrigger className="w-[100px] h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 5 }, (_, i) => {
                      const y = new Date().getFullYear() - 2 + i;
                      return (
                        <SelectItem key={y} value={String(y)}>
                          {y}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Generate Buttons */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Button
          size="lg"
          className="h-16 gap-2"
          onClick={handleGenerateBalanceSheet}
          disabled={loading.balanceSheet}
        >
          {loading.balanceSheet ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Building className="h-5 w-5" />
          )}
          Generate Neraca
        </Button>

        <Button
          size="lg"
          className="h-16 gap-2"
          onClick={handleGenerateIncomeStatement}
          disabled={loading.incomeStatement}
        >
          {loading.incomeStatement ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <TrendingUp className="h-5 w-5" />
          )}
          Generate Laba Rugi
        </Button>

        <Button
          size="lg"
          className="h-16 gap-2"
          onClick={handleGenerateCashFlow}
          disabled={loading.cashFlow}
        >
          {loading.cashFlow ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Banknote className="h-5 w-5" />
          )}
          Generate Arus Kas
        </Button>
      </div>

      {/* Reports Tabs */}
      <Tabs defaultValue="balance-sheet" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="balance-sheet" className="gap-2">
            <Building className="h-4 w-4" />
            Neraca
          </TabsTrigger>
          <TabsTrigger value="income-statement" className="gap-2">
            <TrendingUp className="h-4 w-4" />
            Laba Rugi
          </TabsTrigger>
          <TabsTrigger value="cash-flow" className="gap-2">
            <Banknote className="h-4 w-4" />
            Arus Kas
          </TabsTrigger>
          <TabsTrigger value="closing-entry" className="gap-2">
            <BookOpen className="h-4 w-4" />
            Tutup Buku
          </TabsTrigger>
        </TabsList>

        {/* Balance Sheet Tab */}
        <TabsContent value="balance-sheet" className="space-y-4">
          {balanceSheet ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Building className="h-5 w-5" />
                    NERACA (Balance Sheet)
                  </CardTitle>
                  <CardDescription>
                    Per {format(new Date(periodTo), 'd MMMM yyyy', { locale: id })}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {balanceSheet.isBalanced ? (
                    <Badge variant="default" className="gap-1">
                      <CheckCircle className="h-3 w-3" />
                      Seimbang
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Tidak Seimbang
                    </Badge>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const printerInfo: BalanceSheetPrinterInfo = {
                        name: user?.name || user?.email || 'Unknown User',
                        position: user?.role || undefined
                      };
                      downloadBalanceSheetPDF(balanceSheet, new Date(periodTo), currentBranch?.name || 'PT AQUVIT MANUFACTURE', printerInfo);
                    }}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Assets */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-blue-700 border-b pb-2">ASET</h3>

                    {/* Current Assets */}
                    <div className="space-y-2">
                      <h4 className="font-medium text-gray-700">Aset Lancar:</h4>

                      {/* Kas dan Setara Kas - Grouped */}
                      {balanceSheet.assets.currentAssets.kasBank.length > 0 && (
                        <div className="space-y-1">
                          <div className="pl-4 font-medium text-sm text-gray-600">Kas dan Setara Kas:</div>
                          {balanceSheet.assets.currentAssets.kasBank.map(item => (
                            <div key={item.accountId} className="flex justify-between pl-8">
                              <span className="text-sm">{item.accountName}</span>
                              <span className="text-sm font-mono">{item.formattedBalance}</span>
                            </div>
                          ))}
                          <div className="flex justify-between pl-4 text-sm italic text-gray-600">
                            <span>Total Kas dan Setara Kas</span>
                            <span className="font-mono">
                              {formatCurrency(balanceSheet.assets.currentAssets.kasBank.reduce((sum, item) => sum + item.balance, 0))}
                            </span>
                          </div>
                        </div>
                      )}

                      {balanceSheet.assets.currentAssets.piutangUsaha.map(item => (
                        <div key={item.accountId} className="flex justify-between pl-4">
                          <span className="text-sm">{item.accountName}</span>
                          <span className="text-sm font-mono">{item.formattedBalance}</span>
                        </div>
                      ))}
                      {balanceSheet.assets.currentAssets.piutangPajak?.map(item => (
                        <div key={item.accountId} className="flex justify-between pl-4">
                          <span className="text-sm">{item.accountName}</span>
                          <span className="text-sm font-mono">{item.formattedBalance}</span>
                        </div>
                      ))}
                      {balanceSheet.assets.currentAssets.persediaan.map(item => (
                        <div key={item.accountId} className="flex justify-between pl-4">
                          <span className="text-sm">{item.accountName}</span>
                          <span className="text-sm font-mono">{item.formattedBalance}</span>
                        </div>
                      ))}
                      {balanceSheet.assets.currentAssets.panjarKaryawan.map(item => (
                        <div key={item.accountId} className="flex justify-between pl-4">
                          <span className="text-sm">{item.accountName}</span>
                          <span className="text-sm font-mono">{item.formattedBalance}</span>
                        </div>
                      ))}
                      <div className="flex justify-between font-medium border-t pt-2">
                        <span>Total Aset Lancar</span>
                        <span className="font-mono">{formatCurrency(balanceSheet.assets.currentAssets.totalCurrentAssets)}</span>
                      </div>
                    </div>

                    {/* Fixed Assets */}
                    <div className="space-y-2">
                      <h4 className="font-medium text-gray-700">Aset Tetap:</h4>
                      {/* Kendaraan */}
                      {balanceSheet.assets.fixedAssets.kendaraan.map(item => (
                        <div key={item.accountId} className="flex justify-between pl-4">
                          <span className="text-sm">{item.accountName}</span>
                          <span className="text-sm font-mono">{item.formattedBalance}</span>
                        </div>
                      ))}
                      {/* Peralatan */}
                      {balanceSheet.assets.fixedAssets.peralatan.map(item => (
                        <div key={item.accountId} className="flex justify-between pl-4">
                          <span className="text-sm">{item.accountName}</span>
                          <span className="text-sm font-mono">{item.formattedBalance}</span>
                        </div>
                      ))}
                      {/* Aset Tetap Lainnya */}
                      {balanceSheet.assets.fixedAssets.asetTetapLainnya.map(item => (
                        <div key={item.accountId} className="flex justify-between pl-4">
                          <span className="text-sm">{item.accountName}</span>
                          <span className="text-sm font-mono">{item.formattedBalance}</span>
                        </div>
                      ))}
                      {/* Akumulasi Penyusutan */}
                      {balanceSheet.assets.fixedAssets.akumulasiPenyusutan.map(item => (
                        <div key={item.accountId} className="flex justify-between pl-4">
                          <span className="text-sm">({item.accountName})</span>
                          <span className="text-sm font-mono">({item.formattedBalance})</span>
                        </div>
                      ))}
                      <div className="flex justify-between font-medium border-t pt-2">
                        <span>Total Aset Tetap</span>
                        <span className="font-mono">{formatCurrency(balanceSheet.assets.fixedAssets.totalFixedAssets)}</span>
                      </div>
                    </div>

                    <div className="flex justify-between font-bold text-lg border-t pt-4">
                      <span>TOTAL ASET</span>
                      <span className="font-mono">{formatCurrency(balanceSheet.assets.totalAssets)}</span>
                    </div>
                  </div>

                  {/* Liabilities & Equity */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-red-700 border-b pb-2">KEWAJIBAN & EKUITAS</h3>

                    {/* Liabilities */}
                    <div className="space-y-2">
                      <h4 className="font-medium text-gray-700">Kewajiban Lancar:</h4>

                      {/* Hutang Usaha - Grouped */}
                      {balanceSheet.liabilities.currentLiabilities.hutangUsaha.length > 0 && (
                        <div className="space-y-1">
                          <div className="pl-4 font-medium text-sm text-gray-600">Hutang Usaha:</div>
                          {balanceSheet.liabilities.currentLiabilities.hutangUsaha.map(item => (
                            <div key={item.accountId} className="flex justify-between pl-8">
                              <span className="text-sm">{item.accountName}</span>
                              <span className="text-sm font-mono">{item.formattedBalance}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Hutang Bank */}
                      {balanceSheet.liabilities.currentLiabilities.hutangBank.length > 0 && (
                        <div className="space-y-1">
                          <div className="pl-4 font-medium text-sm text-gray-600">Hutang Bank:</div>
                          {balanceSheet.liabilities.currentLiabilities.hutangBank.map(item => (
                            <div key={item.accountId} className="flex justify-between pl-8">
                              <span className="text-sm">{item.accountName}</span>
                              <span className="text-sm font-mono">{item.formattedBalance}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Hutang Kartu Kredit */}
                      {balanceSheet.liabilities.currentLiabilities.hutangKartuKredit.length > 0 && (
                        <div className="space-y-1">
                          <div className="pl-4 font-medium text-sm text-gray-600">Hutang Kartu Kredit:</div>
                          {balanceSheet.liabilities.currentLiabilities.hutangKartuKredit.map(item => (
                            <div key={item.accountId} className="flex justify-between pl-8">
                              <span className="text-sm">{item.accountName}</span>
                              <span className="text-sm font-mono">{item.formattedBalance}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Hutang Lain-lain */}
                      {balanceSheet.liabilities.currentLiabilities.hutangLain.length > 0 && (
                        <div className="space-y-1">
                          <div className="pl-4 font-medium text-sm text-gray-600">Hutang Lain-lain:</div>
                          {balanceSheet.liabilities.currentLiabilities.hutangLain.map(item => (
                            <div key={item.accountId} className="flex justify-between pl-8">
                              <span className="text-sm">{item.accountName}</span>
                              <span className="text-sm font-mono">{item.formattedBalance}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Hutang Gaji */}
                      {balanceSheet.liabilities.currentLiabilities.hutangGaji.map(item => (
                        <div key={item.accountId} className="flex justify-between pl-4">
                          <span className="text-sm">{item.accountName}</span>
                          <span className="text-sm font-mono">{item.formattedBalance}</span>
                        </div>
                      ))}

                      {/* Hutang Pajak */}
                      {balanceSheet.liabilities.currentLiabilities.hutangPajak.map(item => (
                        <div key={item.accountId} className="flex justify-between pl-4">
                          <span className="text-sm">{item.accountName}</span>
                          <span className="text-sm font-mono">{item.formattedBalance}</span>
                        </div>
                      ))}

                      <div className="flex justify-between font-medium border-t pt-2">
                        <span>Total Kewajiban</span>
                        <span className="font-mono">{formatCurrency(balanceSheet.liabilities.totalLiabilities)}</span>
                      </div>
                    </div>

                    {/* Equity */}
                    <div className="space-y-2">
                      <h4 className="font-medium text-gray-700">Ekuitas:</h4>

                      {/* Modal Pemilik - Grouped */}
                      {balanceSheet.equity.modalPemilik.length > 0 && (
                        <div className="space-y-1">
                          <div className="pl-4 font-medium text-sm text-gray-600">Modal Pemilik:</div>
                          {balanceSheet.equity.modalPemilik.map(item => (
                            <div key={item.accountId} className="flex justify-between pl-8">
                              <span className="text-sm">{item.accountName}</span>
                              <span className="text-sm font-mono">{item.formattedBalance}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Laba Ditahan - dengan breakdown */}
                      <div className="space-y-1">
                        <div className="pl-4 font-medium text-sm text-gray-600">Laba Ditahan:</div>
                        {balanceSheet.equity.labaDitahanAkun !== 0 && (
                          <div className="flex justify-between pl-8">
                            <span className="text-sm text-gray-500">Saldo Laba Ditahan</span>
                            <span className="text-sm font-mono text-gray-500">{formatCurrency(balanceSheet.equity.labaDitahanAkun)}</span>
                          </div>
                        )}
                        <div className="flex justify-between pl-8">
                          <span className="text-sm text-gray-500">Laba Tahun Berjalan</span>
                          <span className={`text-sm font-mono ${balanceSheet.equity.labaTahunBerjalan >= 0 ? 'text-gray-500' : 'text-red-500'}`}>
                            {formatCurrency(balanceSheet.equity.labaTahunBerjalan)}
                          </span>
                        </div>
                        <div className="flex justify-between pl-4 text-sm italic text-gray-600">
                          <span>Total Laba Ditahan</span>
                          <span className={`font-mono ${balanceSheet.equity.totalLabaDitahan >= 0 ? '' : 'text-red-600'}`}>
                            {formatCurrency(balanceSheet.equity.totalLabaDitahan)}
                          </span>
                        </div>
                      </div>

                      <div className="flex justify-between font-medium border-t pt-2">
                        <span>Total Ekuitas</span>
                        <span className="font-mono">{formatCurrency(balanceSheet.equity.totalEquity)}</span>
                      </div>
                    </div>

                    <div className="flex justify-between font-bold text-lg border-t pt-4">
                      <span>TOTAL KEWAJIBAN & EKUITAS</span>
                      <span className="font-mono">{formatCurrency(balanceSheet.totalLiabilitiesEquity)}</span>
                    </div>

                    {/* Selisih Warning */}
                    {!balanceSheet.isBalanced && (
                      <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                        <div className="flex items-center gap-2 text-red-700">
                          <AlertCircle className="h-5 w-5" />
                          <span className="font-medium">Neraca Tidak Balance!</span>
                        </div>
                        <div className="mt-2 text-sm text-red-600">
                          <div className="flex justify-between">
                            <span>Selisih:</span>
                            <span className="font-mono font-bold">{formatCurrency(balanceSheet.selisih)}</span>
                          </div>
                          <p className="mt-2 text-xs">
                            Kemungkinan penyebab: Saldo awal persediaan belum dijurnal,
                            atau ada transaksi yang tidak memiliki jurnal lengkap.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="text-xs text-muted-foreground text-center pt-4 border-t">
                  Dibuat pada: {format(balanceSheet.generatedAt, 'dd MMM yyyy HH:mm', { locale: id })} •
                  Status: {balanceSheet.isBalanced ? '✓ Neraca Balance' : '⚠ Neraca Tidak Balance'}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center py-16">
                <div className="text-center space-y-4">
                  <Building className="h-16 w-16 mx-auto text-muted-foreground" />
                  <div>
                    <p className="text-lg font-medium">Neraca Belum Dibuat</p>
                    <p className="text-sm text-muted-foreground">
                      Klik "Generate Neraca" untuk membuat laporan dari data aplikasi
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Income Statement Tab */}
        <TabsContent value="income-statement" className="space-y-4">
          {incomeStatement ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    LAPORAN LABA RUGI (Income Statement)
                  </CardTitle>
                  <CardDescription>
                    Periode {format(incomeStatement.periodFrom, 'd MMM', { locale: id })} - {format(incomeStatement.periodTo, 'd MMM yyyy', { locale: id })}
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const printerInfo: PrinterInfo = {
                      name: user?.name || user?.email || 'Unknown User',
                      position: user?.role || undefined
                    };
                    downloadIncomeStatementPDF(incomeStatement, currentBranch?.name || 'PT AQUVIT MANUFACTURE', printerInfo);
                  }}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export PDF
                </Button>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  {/* Revenue Section */}
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold text-green-700 border-b pb-2">PENDAPATAN</h3>
                    {incomeStatement.revenue.penjualan.map((item, index) => (
                      <div key={index} className="flex justify-between">
                        <span>{item.accountName}</span>
                        <span className="font-mono">{item.formattedAmount}</span>
                      </div>
                    ))}
                    <div className="flex justify-between font-medium border-t pt-2">
                      <span>Total Pendapatan</span>
                      <span className="font-mono">{formatCurrency(incomeStatement.revenue.totalRevenue)}</span>
                    </div>
                  </div>

                  {/* COGS Section */}
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold text-orange-700 border-b pb-2">HARGA POKOK PENJUALAN</h3>
                    {incomeStatement.cogs.bahanBaku.map((item, index) => (
                      <div key={index} className="flex justify-between">
                        <span>{item.accountName}</span>
                        <span className="font-mono">({item.formattedAmount})</span>
                      </div>
                    ))}
                    <div className="flex justify-between font-medium border-t pt-2">
                      <span>Total Harga Pokok Penjualan</span>
                      <span className="font-mono">({formatCurrency(incomeStatement.cogs.totalCOGS)})</span>
                    </div>
                  </div>

                  {/* Gross Profit */}
                  <div className="flex justify-between font-semibold text-lg bg-green-50 p-3 rounded">
                    <span>LABA KOTOR</span>
                    <div className="text-right">
                      <span className="font-mono">{formatCurrency(incomeStatement.grossProfit)}</span>
                      <div className="text-sm text-muted-foreground">
                        ({incomeStatement.grossProfitMargin.toFixed(1)}%)
                      </div>
                    </div>
                  </div>

                  {/* Operating Expenses */}
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold text-red-700 border-b pb-2">BEBAN OPERASIONAL</h3>
                    {incomeStatement.operatingExpenses.bebanOperasional.map((item, index) => (
                      <div key={index} className="flex justify-between">
                        <span>{item.accountName}</span>
                        <span className="font-mono">({item.formattedAmount})</span>
                      </div>
                    ))}
                    {incomeStatement.operatingExpenses.komisi.map((item, index) => (
                      <div key={index} className="flex justify-between">
                        <span>{item.accountName}</span>
                        <span className="font-mono">({item.formattedAmount})</span>
                      </div>
                    ))}
                    <div className="flex justify-between font-medium border-t pt-2">
                      <span>Total Beban Operasional</span>
                      <span className="font-mono">({formatCurrency(incomeStatement.operatingExpenses.totalOperatingExpenses)})</span>
                    </div>
                  </div>

                  {/* Net Income */}
                  <div className="space-y-3">
                    <div className="flex justify-between font-semibold text-lg bg-blue-50 p-3 rounded">
                      <span>LABA OPERASIONAL</span>
                      <span className="font-mono">{formatCurrency(incomeStatement.operatingIncome)}</span>
                    </div>

                    <div className={`flex justify-between font-bold text-xl p-4 rounded ${incomeStatement.netIncome >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                      <span>LABA BERSIH</span>
                      <div className="text-right">
                        <span className="font-mono">{formatCurrency(incomeStatement.netIncome)}</span>
                        <div className="text-sm">
                          ({incomeStatement.netProfitMargin.toFixed(1)}%)
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground text-center pt-4 border-t">
                  Dibuat pada: {format(incomeStatement.generatedAt, 'dd MMM yyyy HH:mm', { locale: id })} •
                  Data dari: Transactions, Cash History, Commission Entries
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center py-16">
                <div className="text-center space-y-4">
                  <TrendingUp className="h-16 w-16 mx-auto text-muted-foreground" />
                  <div>
                    <p className="text-lg font-medium">Laporan Laba Rugi Belum Dibuat</p>
                    <p className="text-sm text-muted-foreground">
                      Klik "Generate Laba Rugi" untuk membuat laporan dari data transaksi
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Cash Flow Tab */}
        <TabsContent value="cash-flow" className="space-y-4">
          {cashFlowStatement ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div className="text-center">
                  <CardTitle className="flex items-center justify-center gap-2 text-xl">
                    <Banknote className="h-6 w-6" />
                    PT AQUVIT MANUFACTURE
                  </CardTitle>
                  <h3 className="text-lg font-semibold mt-2">LAPORAN ARUS KAS</h3>
                  <CardDescription className="mt-1">
                    Periode {format(cashFlowStatement.periodFrom, 'd MMMM', { locale: id })} sampai dengan {format(cashFlowStatement.periodTo, 'd MMMM yyyy', { locale: id })}
                  </CardDescription>
                  <p className="text-sm text-muted-foreground mt-1">(Metode Langsung - Disajikan dalam Rupiah)</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const printerInfo: CashFlowPrinterInfo = {
                      name: user?.name || user?.email || 'Unknown User',
                      position: user?.role || undefined
                    };
                    downloadCashFlowPDF(cashFlowStatement, currentBranch?.name || 'PT AQUVIT MANUFACTURE', printerInfo);
                  }}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export PDF
                </Button>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  {/* Operating Activities - PSAK Format */}
                  <div className="space-y-3">
                    <h3 className="text-lg font-semibold text-blue-700 border-b pb-2">AKTIVITAS OPERASI</h3>

                    {/* Cash Receipts */}
                    <div className="space-y-1">
                      <h4 className="font-medium text-blue-600">Penerimaan kas dari:</h4>
                      {/* Show receipts by account for more detail */}
                      {cashFlowStatement.operatingActivities.cashReceipts?.byAccount?.map((item, index) => (
                        <div key={index} className="flex justify-between pl-4">
                          <span className="text-sm">{item.accountName} ({item.accountCode})</span>
                          <span className="font-mono">{formatCurrency(item.amount)}</span>
                        </div>
                      ))}
                      {/* Fallback to summary if no detail */}
                      {(!cashFlowStatement.operatingActivities.cashReceipts?.byAccount ||
                        cashFlowStatement.operatingActivities.cashReceipts.byAccount.length === 0) && (
                          <>
                            <div className="flex justify-between pl-4">
                              <span>Pelanggan</span>
                              <span className="font-mono">{formatCurrency(cashFlowStatement.operatingActivities.cashReceipts?.fromCustomers || 0)}</span>
                            </div>
                            <div className="flex justify-between pl-4">
                              <span>Pembayaran piutang</span>
                              <span className="font-mono">{formatCurrency(cashFlowStatement.operatingActivities.cashReceipts?.fromReceivablePayments || 0)}</span>
                            </div>
                            {cashFlowStatement.operatingActivities.cashReceipts?.fromAdvanceRepayment > 0 && (
                              <div className="flex justify-between pl-4">
                                <span>Pelunasan panjar karyawan</span>
                                <span className="font-mono">{formatCurrency(cashFlowStatement.operatingActivities.cashReceipts?.fromAdvanceRepayment || 0)}</span>
                              </div>
                            )}
                            <div className="flex justify-between pl-4">
                              <span>Penerimaan operasi lain</span>
                              <span className="font-mono">{formatCurrency(cashFlowStatement.operatingActivities.cashReceipts?.fromOtherOperating || 0)}</span>
                            </div>
                          </>
                        )}
                      <div className="flex justify-between font-medium text-green-600 border-b pb-1">
                        <span className="pl-4">Total penerimaan kas</span>
                        <span className="font-mono">{formatCurrency(cashFlowStatement.operatingActivities.cashReceipts?.total || 0)}</span>
                      </div>
                    </div>

                    {/* Cash Payments */}
                    <div className="space-y-1">
                      <h4 className="font-medium text-red-600">Pembayaran kas untuk:</h4>
                      {/* Show payments by account for more detail */}
                      {cashFlowStatement.operatingActivities.cashPayments?.byAccount?.map((item, index) => (
                        <div key={index} className="flex justify-between pl-4">
                          <span className="text-sm">{item.accountName} ({item.accountCode})</span>
                          <span className="font-mono">({formatCurrency(item.amount)})</span>
                        </div>
                      ))}
                      {/* Fallback to summary if no detail */}
                      {(!cashFlowStatement.operatingActivities.cashPayments?.byAccount ||
                        cashFlowStatement.operatingActivities.cashPayments.byAccount.length === 0) && (
                          <>
                            <div className="flex justify-between pl-4">
                              <span>Pembayaran ke supplier</span>
                              <span className="font-mono">({formatCurrency(cashFlowStatement.operatingActivities.cashPayments?.forRawMaterials || 0)})</span>
                            </div>
                            {cashFlowStatement.operatingActivities.cashPayments?.forPayablePayments > 0 && (
                              <div className="flex justify-between pl-4">
                                <span>Pembayaran hutang usaha lainnya</span>
                                <span className="font-mono">({formatCurrency(cashFlowStatement.operatingActivities.cashPayments?.forPayablePayments || 0)})</span>
                              </div>
                            )}
                            <div className="flex justify-between pl-4">
                              <span>Hutang Bunga Atas Hutang Bank</span>
                              <span className="font-mono">({formatCurrency(cashFlowStatement.operatingActivities.cashPayments?.forInterestExpense || 0)})</span>
                            </div>
                            <div className="flex justify-between pl-4">
                              <span>Upah tenaga kerja langsung</span>
                              <span className="font-mono">({formatCurrency(cashFlowStatement.operatingActivities.cashPayments?.forDirectLabor || 0)})</span>
                            </div>
                            {cashFlowStatement.operatingActivities.cashPayments?.forEmployeeAdvances > 0 && (
                              <div className="flex justify-between pl-4">
                                <span>Pemberian panjar karyawan</span>
                                <span className="font-mono">({formatCurrency(cashFlowStatement.operatingActivities.cashPayments?.forEmployeeAdvances || 0)})</span>
                              </div>
                            )}
                            <div className="flex justify-between pl-4">
                              <span>Biaya overhead pabrik</span>
                              <span className="font-mono">({formatCurrency(cashFlowStatement.operatingActivities.cashPayments?.forManufacturingOverhead || 0)})</span>
                            </div>
                            <div className="flex justify-between pl-4">
                              <span>Beban operasi lainnya</span>
                              <span className="font-mono">({formatCurrency(cashFlowStatement.operatingActivities.cashPayments?.forOperatingExpenses || 0)})</span>
                            </div>
                            {cashFlowStatement.operatingActivities.cashPayments?.forTaxes > 0 && (
                              <div className="flex justify-between pl-4">
                                <span>Pajak penghasilan</span>
                                <span className="font-mono">({formatCurrency(cashFlowStatement.operatingActivities.cashPayments.forTaxes)})</span>
                              </div>
                            )}
                          </>
                        )}
                      <div className="flex justify-between font-medium text-red-600 border-b pb-1">
                        <span className="pl-4">Total pembayaran kas</span>
                        <span className="font-mono">({formatCurrency(cashFlowStatement.operatingActivities.cashPayments?.total || 0)})</span>
                      </div>
                    </div>

                    <div className="flex justify-between font-bold text-lg bg-blue-50 p-3 rounded">
                      <span>Kas Bersih dari Aktivitas Operasi</span>
                      <span className="font-mono">{formatCurrency(cashFlowStatement.operatingActivities.netCashFromOperations)}</span>
                    </div>
                  </div>

                  {/* Investing Activities */}
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold text-purple-700 border-b pb-2">AKTIVITAS INVESTASI</h3>
                    {cashFlowStatement.investingActivities.equipmentPurchases.map((item, index) => (
                      <div key={index} className="flex justify-between">
                        <span>{item.description}</span>
                        <span className="font-mono">{item.formattedAmount}</span>
                      </div>
                    ))}
                    {cashFlowStatement.investingActivities.equipmentPurchases.length === 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>Tidak ada aktivitas investasi</span>
                        <span className="font-mono">-</span>
                      </div>
                    )}
                    <div className="flex justify-between font-medium border-t pt-2">
                      <span>Kas Bersih dari Aktivitas Investasi</span>
                      <span className="font-mono">{formatCurrency(cashFlowStatement.investingActivities.netCashFromInvesting)}</span>
                    </div>
                  </div>

                  {/* Financing Activities */}
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold text-green-700 border-b pb-2">AKTIVITAS PENDANAAN</h3>

                    {/* Owner Investments */}
                    {cashFlowStatement.financingActivities.ownerInvestments.map((item, index) => (
                      <div key={`owner-inv-${index}`} className="flex justify-between">
                        <span>{item.description}</span>
                        <span className="font-mono">{item.formattedAmount}</span>
                      </div>
                    ))}

                    {/* Owner Withdrawals */}
                    {cashFlowStatement.financingActivities.ownerWithdrawals.map((item, index) => (
                      <div key={`owner-wd-${index}`} className="flex justify-between">
                        <span>{item.description}</span>
                        <span className="font-mono">{item.formattedAmount}</span>
                      </div>
                    ))}

                    {/* Loans */}
                    {cashFlowStatement.financingActivities.loans.map((item, index) => (
                      <div key={`loan-${index}`} className="flex justify-between">
                        <span>{item.description}</span>
                        <span className="font-mono">{item.formattedAmount}</span>
                      </div>
                    ))}

                    {/* Show "no activity" if all arrays are empty */}
                    {cashFlowStatement.financingActivities.ownerInvestments.length === 0 &&
                      cashFlowStatement.financingActivities.ownerWithdrawals.length === 0 &&
                      cashFlowStatement.financingActivities.loans.length === 0 && (
                        <div className="flex justify-between text-muted-foreground">
                          <span>Tidak ada aktivitas pendanaan</span>
                          <span className="font-mono">-</span>
                        </div>
                      )}

                    <div className="flex justify-between font-medium border-t pt-2">
                      <span>Kas Bersih dari Aktivitas Pendanaan</span>
                      <span className="font-mono">{formatCurrency(cashFlowStatement.financingActivities.netCashFromFinancing)}</span>
                    </div>
                  </div>

                  {/* Net Cash Flow */}
                  <div className="space-y-3">
                    <div className={`flex justify-between font-semibold text-lg p-3 rounded ${cashFlowStatement.netCashFlow >= 0 ? 'bg-green-50' : 'bg-red-50'
                      }`}>
                      <span>KENAIKAN (PENURUNAN) KAS BERSIH</span>
                      <span className="font-mono">{formatCurrency(cashFlowStatement.netCashFlow)}</span>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span>Kas di awal periode</span>
                        <span className="font-mono">{formatCurrency(cashFlowStatement.beginningCash)}</span>
                      </div>
                      <div className="flex justify-between font-bold text-lg border-t pt-2">
                        <span>KAS DI AKHIR PERIODE</span>
                        <span className="font-mono">{formatCurrency(cashFlowStatement.endingCash)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground text-center pt-4 border-t">
                  Dibuat pada: {format(cashFlowStatement.generatedAt, 'dd MMM yyyy HH:mm', { locale: id })} •
                  Data dari: Cash History, Account Balances
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center py-16">
                <div className="text-center space-y-4">
                  <Banknote className="h-16 w-16 mx-auto text-muted-foreground" />
                  <div>
                    <p className="text-lg font-medium">Laporan Arus Kas Belum Dibuat</p>
                    <p className="text-sm text-muted-foreground">
                      Klik "Generate Arus Kas" untuk membuat laporan dari cash history
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Closing Entry Tab */}
        <TabsContent value="closing-entry" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Tutup Buku Tahunan
              </CardTitle>
              <CardDescription>
                Tutup periode akuntansi dan transfer Laba/Rugi ke Laba Ditahan
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Year Selection */}
              <div className="flex items-end gap-4">
                <div className="space-y-2">
                  <Label htmlFor="closingYear">Tahun yang akan ditutup</Label>
                  <Select
                    value={String(closingYear)}
                    onValueChange={(val) => {
                      setClosingYear(Number(val));
                      clearPreview();
                    }}
                  >
                    <SelectTrigger id="closingYear" className="w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[2023, 2024, 2025].map(year => (
                        <SelectItem key={year} value={String(year)}>
                          {year}
                          {closedYears.some(cy => cy.year === year) && ' (Sudah ditutup)'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handlePreviewClosing}
                  disabled={closingLoading || isYearAlreadyClosed}
                >
                  {closingLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Preview Tutup Buku
                </Button>
              </div>

              {isYearAlreadyClosed && (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex items-center gap-2">
                  <Lock className="h-5 w-5 text-yellow-600" />
                  <span className="text-yellow-800">
                    Tahun {closingYear} sudah ditutup pada{' '}
                    {format(closedYears.find(cy => cy.year === closingYear)?.closedAt || new Date(), 'd MMM yyyy HH:mm', { locale: id })}
                  </span>
                </div>
              )}

              {/* Preview Results */}
              {closingPreview && (
                <div className="space-y-4 border rounded-lg p-4">
                  <h4 className="font-semibold">Preview Jurnal Penutup Tahun {closingPreview.year}</h4>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Pendapatan */}
                    <div className="space-y-2">
                      <h5 className="font-medium text-green-700">Pendapatan yang akan ditutup:</h5>
                      {closingPreview.pendapatanAccounts.length > 0 ? (
                        <>
                          {closingPreview.pendapatanAccounts.map(acc => (
                            <div key={acc.id} className="flex justify-between text-sm pl-4">
                              <span>{acc.code} - {acc.name}</span>
                              <span className="font-mono">{formatCurrency(acc.balance)}</span>
                            </div>
                          ))}
                          <div className="flex justify-between font-medium border-t pt-2">
                            <span>Total Pendapatan</span>
                            <span className="font-mono text-green-700">{formatCurrency(closingPreview.totalPendapatan)}</span>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground pl-4">Tidak ada pendapatan</p>
                      )}
                    </div>

                    {/* Beban */}
                    <div className="space-y-2">
                      <h5 className="font-medium text-red-700">Beban yang akan ditutup:</h5>
                      {closingPreview.bebanAccounts.length > 0 ? (
                        <>
                          {closingPreview.bebanAccounts.map(acc => (
                            <div key={acc.id} className="flex justify-between text-sm pl-4">
                              <span>{acc.code} - {acc.name}</span>
                              <span className="font-mono">{formatCurrency(acc.balance)}</span>
                            </div>
                          ))}
                          <div className="flex justify-between font-medium border-t pt-2">
                            <span>Total Beban</span>
                            <span className="font-mono text-red-700">{formatCurrency(closingPreview.totalBeban)}</span>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground pl-4">Tidak ada beban</p>
                      )}
                    </div>
                  </div>

                  {/* Summary */}
                  <div className={`p-4 rounded-lg ${closingPreview.labaRugiBersih >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'} border`}>
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-lg">
                        {closingPreview.labaRugiBersih >= 0 ? 'Laba Bersih' : 'Rugi Bersih'}
                      </span>
                      <span className={`font-mono text-xl font-bold ${closingPreview.labaRugiBersih >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {formatCurrency(Math.abs(closingPreview.labaRugiBersih))}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">
                      {closingPreview.labaRugiBersih >= 0
                        ? `Laba ini akan ditransfer ke akun Laba Ditahan (${closingPreview.labaDitahanAccount?.code || '3200'})`
                        : `Rugi ini akan mengurangi saldo Laba Ditahan (${closingPreview.labaDitahanAccount?.code || '3200'})`}
                    </p>
                  </div>

                  {/* Action Button */}
                  <div className="flex justify-end">
                    <Button
                      onClick={() => setShowClosingConfirm(true)}
                      className="gap-2"
                      disabled={closingLoading}
                    >
                      <Lock className="h-4 w-4" />
                      Eksekusi Tutup Buku
                    </Button>
                  </div>
                </div>
              )}

              {/* Closed Years History */}
              {closedYears.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold">Riwayat Tutup Buku</h4>
                  <div className="border rounded-lg divide-y">
                    {closedYears.map(cy => (
                      <div key={cy.id} className="flex items-center justify-between p-3">
                        <div>
                          <span className="font-medium">Tahun {cy.year}</span>
                          <span className="text-sm text-muted-foreground ml-2">
                            - Ditutup {format(cy.closedAt, 'd MMM yyyy HH:mm', { locale: id })}
                          </span>
                          <span className={`text-sm ml-2 ${cy.netIncome >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            ({cy.netIncome >= 0 ? 'Laba' : 'Rugi'}: {formatCurrency(Math.abs(cy.netIncome))})
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleVoidClosing(cy.year)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Unlock className="h-4 w-4 mr-1" />
                          Batalkan
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Confirmation Dialog */}
      <Dialog open={showClosingConfirm} onOpenChange={setShowClosingConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Konfirmasi Tutup Buku</DialogTitle>
            <DialogDescription>
              Anda akan menutup buku untuk tahun {closingYear}. Proses ini akan:
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc pl-6 space-y-1 text-sm">
            <li>Menutup semua akun Pendapatan ke Ikhtisar Laba Rugi</li>
            <li>Menutup semua akun Beban ke Ikhtisar Laba Rugi</li>
            <li>Transfer {closingPreview?.labaRugiBersih && closingPreview.labaRugiBersih >= 0 ? 'Laba' : 'Rugi'} Bersih ke Laba Ditahan</li>
          </ul>
          <p className="text-sm text-muted-foreground mt-2">
            Jurnal penutup akan dibuat dengan tanggal 31 Desember {closingYear}.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClosingConfirm(false)}>
              Batal
            </Button>
            <Button onClick={handleConfirmClosing} disabled={closingLoading}>
              {closingLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Ya, Tutup Buku
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FinancialReportsPage;