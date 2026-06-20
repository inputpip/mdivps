"use client"

import { useMemo, useState } from "react"
import { format } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import { useAccounts } from "@/hooks/useAccounts"
import { useAuth } from "@/hooks/useAuth"
import { useCompanySettings } from "@/hooks/useCompanySettings"
import { useJournalEntries } from "@/hooks/useJournalEntries"
import { useTransactions } from "@/hooks/useTransactions"
import { getProductionWorkflowMode, ProductionWorkflowMode } from "@/config/featureSettings"
import { Transaction } from "@/types/transaction"
import { Account } from "@/types/account"
import { findAccountByLookup } from "@/services/accountLookupService"
import { ClipboardList, Factory, FileText, Play, CheckCircle2, WalletCards } from "lucide-react"

const PRODUCTION_STATUSES = ['Pesanan Masuk', 'Antri Produksi', 'Sedang Produksi', 'Selesai Produksi'] as const
const ACTIVE_STATUSES = ['Antri Produksi', 'Sedang Produksi']

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value || 0)

const modeLabel: Record<ProductionWorkflowMode, string> = {
  stock: 'Produksi Stok',
  order_based: 'Produksi Berdasarkan Pesanan',
  hybrid: 'Hybrid',
}

const getOrderTotalQty = (transaction: Transaction) => {
  return transaction.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
}

export default function OperatorProductionPage() {
  const { settings } = useCompanySettings()
  const productionMode = getProductionWorkflowMode(settings?.appFeatureSettings)
  const { transactions = [], isLoading, updateTransactionStatus } = useTransactions()
  const { accounts = [] } = useAccounts()
  const { createJournalEntry, isCreating } = useJournalEntries()
  const { user } = useAuth()
  const { toast } = useToast()

  const productionOrders = useMemo(() => {
    return transactions
      .filter((trx) => PRODUCTION_STATUSES.includes(trx.status as typeof PRODUCTION_STATUSES[number]))
      .sort((a, b) => {
        const aActive = a.status === 'Sedang Produksi' ? 0 : 1
        const bActive = b.status === 'Sedang Produksi' ? 0 : 1
        return aActive - bActive || a.createdAt.getTime() - b.createdAt.getTime()
      })
  }, [transactions])

  const runningOrders = useMemo(
    () => productionOrders.filter((trx) => ACTIVE_STATUSES.includes(trx.status)),
    [productionOrders]
  )

  const [selectedTransactionId, setSelectedTransactionId] = useState<string>('')
  const selectedTransaction = useMemo(() => {
    return productionOrders.find((trx) => trx.id === selectedTransactionId) || runningOrders[0] || productionOrders[0]
  }, [productionOrders, runningOrders, selectedTransactionId])

  const cashAccounts = useMemo(() => {
    return accounts.filter((account) => account.isPaymentAccount && !account.isHeader)
  }, [accounts])

  const expenseAccounts = useMemo(() => {
    return accounts.filter((account) => ['Beban', 'HPP'].includes(account.type) && !account.isHeader)
  }, [accounts])

  const defaultCashAccount = useMemo(() => {
    return findAccountByLookup(accounts, 'KAS_UTAMA') || cashAccounts[0]
  }, [accounts, cashAccounts])

  const defaultExpenseAccount = useMemo(() => {
    return findAccountByLookup(accounts, 'HPP_BAHAN_BAKU') || findAccountByLookup(accounts, 'BEBAN_OPERASIONAL') || expenseAccounts[0]
  }, [accounts, expenseAccounts])

  const [expenseAmount, setExpenseAmount] = useState<number>(0)
  const [expenseNote, setExpenseNote] = useState<string>('')
  const [debitAccountId, setDebitAccountId] = useState<string>('')
  const [creditAccountId, setCreditAccountId] = useState<string>('')

  const resolvedDebitAccount = accounts.find((account) => account.id === (debitAccountId || defaultExpenseAccount?.id))
  const resolvedCreditAccount = accounts.find((account) => account.id === (creditAccountId || defaultCashAccount?.id))

  const statusCounts = useMemo(() => {
    return PRODUCTION_STATUSES.reduce((acc, status) => {
      acc[status] = productionOrders.filter((trx) => trx.status === status).length
      return acc
    }, {} as Record<string, number>)
  }, [productionOrders])

  const handleSetStatus = async (transaction: Transaction | undefined, status: string) => {
    if (!transaction) return
    await updateTransactionStatus.mutateAsync({ transactionId: transaction.id, status })
    toast({ title: 'Status diperbarui', description: `${transaction.customerName} → ${status}` })
  }

  const handleRecordExpense = async () => {
    if (!selectedTransaction) {
      toast({ variant: 'destructive', title: 'Pilih pesanan dulu', description: 'Belum ada pesanan produksi yang dipilih.' })
      return
    }
    if (!expenseAmount || expenseAmount <= 0) {
      toast({ variant: 'destructive', title: 'Nominal belum valid', description: 'Isi nominal pengeluaran tambahan.' })
      return
    }
    if (!resolvedDebitAccount || !resolvedCreditAccount) {
      toast({ variant: 'destructive', title: 'Akun belum lengkap', description: 'Pilih akun beban/HPP dan akun kas/bank existing.' })
      return
    }

    await new Promise<void>((resolve, reject) => {
      createJournalEntry(
        {
      entryDate: new Date(),
      description: `Pengeluaran produksi order ${selectedTransaction.customerName}${expenseNote ? ` - ${expenseNote}` : ''}`,
      referenceType: 'transaction',
      referenceId: selectedTransaction.id,
      lines: [
        {
          accountId: resolvedDebitAccount.id,
          debitAmount: expenseAmount,
          creditAmount: 0,
          description: expenseNote || 'Tambahan pengeluaran produksi',
        },
        {
          accountId: resolvedCreditAccount.id,
          debitAmount: 0,
          creditAmount: expenseAmount,
          description: expenseNote || 'Pembayaran pengeluaran produksi',
        },
      ],
        },
        {
          onSuccess: () => resolve(),
          onError: (error: Error) => reject(error),
        }
      )
    })

    setExpenseAmount(0)
    setExpenseNote('')
  }

  const renderAccountOption = (account: Account) => (
    <SelectItem key={account.id} value={account.id}>
      {account.code ? `${account.code} - ` : ''}{account.name}
    </SelectItem>
  )

  if (productionMode === 'stock') {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Panel Operator Produksi</CardTitle>
            <CardDescription>
              Mode produksi saat ini: {modeLabel[productionMode]}. Panel operator pesanan aktif jika mode diubah ke Produksi Berdasarkan Pesanan atau Hybrid.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Panel Operator Produksi</h1>
          <p className="text-sm text-muted-foreground">Satu layar untuk antrian, status, detail pesanan berjalan, dan pengeluaran tambahan.</p>
        </div>
        <Badge variant="outline" className="text-sm">Mode: {modeLabel[productionMode]}</Badge>
      </div>

      <div className="grid gap-4 xl:grid-cols-4 lg:grid-cols-2">
        <Card className="xl:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><ClipboardList className="h-4 w-4" /> Antrian Pesanan</CardTitle>
            <CardDescription>{productionOrders.length} pesanan perlu produksi</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[620px] overflow-y-auto">
            {isLoading ? <div className="text-sm text-muted-foreground">Memuat antrian...</div> : null}
            {!isLoading && productionOrders.length === 0 ? (
              <div className="text-sm text-muted-foreground">Belum ada pesanan dengan status produksi.</div>
            ) : null}
            {productionOrders.map((trx) => (
              <button
                key={trx.id}
                onClick={() => setSelectedTransactionId(trx.id)}
                className={`w-full rounded-lg border p-3 text-left transition hover:bg-muted/50 ${selectedTransaction?.id === trx.id ? 'border-primary bg-primary/5' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium line-clamp-1">{trx.customerName}</div>
                  <Badge variant={trx.status === 'Sedang Produksi' ? 'default' : 'secondary'}>{trx.status}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {format(trx.orderDate, 'dd/MM/yyyy')} • {trx.items.length} item • {formatCurrency(trx.total)}
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="xl:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Factory className="h-4 w-4" /> Status Produksi</CardTitle>
            <CardDescription>Ringkasan dan aksi cepat</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {PRODUCTION_STATUSES.map((status) => (
                <div key={status} className="rounded-lg border p-3">
                  <div className="text-2xl font-semibold">{statusCounts[status] || 0}</div>
                  <div className="text-xs text-muted-foreground">{status}</div>
                </div>
              ))}
            </div>

            <div className="rounded-lg border p-3 space-y-3">
              <div className="text-sm font-medium">Aksi untuk pesanan terpilih</div>
              <div className="grid gap-2">
                <Button variant="outline" onClick={() => handleSetStatus(selectedTransaction, 'Antri Produksi')} disabled={!selectedTransaction || updateTransactionStatus.isPending}>
                  Masukkan Antrian
                </Button>
                <Button onClick={() => handleSetStatus(selectedTransaction, 'Sedang Produksi')} disabled={!selectedTransaction || updateTransactionStatus.isPending}>
                  <Play className="mr-2 h-4 w-4" /> Mulai Produksi
                </Button>
                <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => handleSetStatus(selectedTransaction, 'Selesai Produksi')} disabled={!selectedTransaction || updateTransactionStatus.isPending}>
                  <CheckCircle2 className="mr-2 h-4 w-4" /> Selesai Produksi
                </Button>
              </div>
            </div>

            <div className="text-xs text-muted-foreground rounded-lg bg-muted/40 p-3">
              Status ini memakai kolom transaksi yang sudah ada, jadi tidak menambah tabel/akun baru.
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><FileText className="h-4 w-4" /> Pesanan Berjalan</CardTitle>
            <CardDescription>Detail order yang sedang dikerjakan</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 max-h-[620px] overflow-y-auto">
            {!selectedTransaction ? (
              <div className="text-sm text-muted-foreground">Pilih pesanan dari antrian.</div>
            ) : (
              <>
                <div className="rounded-lg border p-3 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{selectedTransaction.customerName}</div>
                      <div className="text-xs text-muted-foreground">Order: {format(selectedTransaction.orderDate, 'dd/MM/yyyy HH:mm')}</div>
                    </div>
                    <Badge>{selectedTransaction.status}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-3 text-sm">
                    <div className="rounded-md bg-muted/40 p-2"><div className="text-xs text-muted-foreground">Total Qty</div>{getOrderTotalQty(selectedTransaction)}</div>
                    <div className="rounded-md bg-muted/40 p-2"><div className="text-xs text-muted-foreground">Nilai Order</div>{formatCurrency(selectedTransaction.total)}</div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">Item Pesanan</div>
                  {selectedTransaction.items.map((item, index) => (
                    <div key={`${selectedTransaction.id}-${index}`} className="rounded-lg border p-3 text-sm">
                      <div className="font-medium">{item.product?.name || 'Item'}</div>
                      <div className="text-muted-foreground">
                        Qty {item.quantity} {item.unit || 'pcs'}
                        {item.width || item.height ? ` • ${item.width || 0} x ${item.height || 0}` : ''}
                      </div>
                      {item.notes ? <div className="mt-1 text-xs text-muted-foreground">Catatan: {item.notes}</div> : null}
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><WalletCards className="h-4 w-4" /> Tambahan Pengeluaran</CardTitle>
            <CardDescription>Jurnal simple opsi B: Debit HPP/Beban, Kredit Kas/Bank</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Nominal</Label>
              <Input type="number" inputMode="numeric" value={expenseAmount || ''} onChange={(e) => setExpenseAmount(Number(e.target.value || 0))} placeholder="0" />
            </div>

            <div className="space-y-2">
              <Label>Debit ke akun HPP/Beban existing</Label>
              <Select value={debitAccountId || defaultExpenseAccount?.id || ''} onValueChange={setDebitAccountId}>
                <SelectTrigger><SelectValue placeholder="Pilih akun beban/HPP" /></SelectTrigger>
                <SelectContent>{expenseAccounts.map(renderAccountOption)}</SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Kredit dari akun kas/bank existing</Label>
              <Select value={creditAccountId || defaultCashAccount?.id || ''} onValueChange={setCreditAccountId}>
                <SelectTrigger><SelectValue placeholder="Pilih akun kas/bank" /></SelectTrigger>
                <SelectContent>{cashAccounts.map(renderAccountOption)}</SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Catatan pengeluaran</Label>
              <Textarea rows={4} value={expenseNote} onChange={(e) => setExpenseNote(e.target.value)} placeholder="Contoh: tinta tambahan, laminasi, transport bahan..." />
            </div>

            <Button className="w-full" onClick={handleRecordExpense} disabled={isCreating || !selectedTransaction}>
              {isCreating ? 'Mencatat...' : 'Catat Pengeluaran + Jurnal'}
            </Button>

            <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
              Tidak membuat akun baru. Operator memilih akun yang sudah ada. Jurnal otomatis draft mengikuti RPC jurnal existing.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
