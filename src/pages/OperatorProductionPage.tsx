"use client"

import { useCallback, useMemo, useRef, useState } from "react"
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
import { useProduction } from "@/hooks/useProduction"
import { useProducts } from "@/hooks/useProducts"
import { useTransactions } from "@/hooks/useTransactions"
import { getProductionWorkflowMode, isFeatureEnabled, ProductionWorkflowMode } from "@/config/featureSettings"
import { Transaction } from "@/types/transaction"
import { Account } from "@/types/account"
import { findAccountByLookup } from "@/services/accountLookupService"
import { PhotoUploadService } from "@/services/photoUploadService"
import { compressImage, isImageFile } from "@/utils/imageCompression"
import { validateProductForProduction } from "@/utils/productValidation"
import { Camera, ClipboardList, Factory, FileText, Play, CheckCircle2, WalletCards, X } from "lucide-react"

const PRODUCTION_STATUSES = ['Pesanan Masuk', 'Antri Produksi', 'Sedang Produksi', 'Selesai Produksi'] as const
const ACTIVE_STATUSES = ['Antri Produksi', 'Sedang Produksi']
type ProductionPanelStatus = typeof PRODUCTION_STATUSES[number]

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
  const isDeliveryEnabled = isFeatureEnabled(settings?.appFeatureSettings, 'delivery')
  const { transactions = [], isLoading, updateTransactionStatus } = useTransactions()
  const { products = [], isLoading: isLoadingProducts } = useProducts()
  const { processProduction, isLoading: isProcessingProduction } = useProduction()
  const { accounts = [] } = useAccounts()
  const { createJournalEntry, isCreating } = useJournalEntries()
  const { user } = useAuth()
  const { toast } = useToast()
  const [localProductionStatuses, setLocalProductionStatuses] = useState<Record<string, ProductionPanelStatus>>({})

  const getPanelStatus = useCallback((trx: Transaction): ProductionPanelStatus => {
    return localProductionStatuses[trx.id] || (PRODUCTION_STATUSES.includes(trx.status as ProductionPanelStatus) ? trx.status as ProductionPanelStatus : 'Pesanan Masuk')
  }, [localProductionStatuses])

  const productionOrders = useMemo(() => {
    return transactions
      .filter((trx) => PRODUCTION_STATUSES.includes(trx.status as typeof PRODUCTION_STATUSES[number]))
      .sort((a, b) => {
        const aActive = getPanelStatus(a) === 'Sedang Produksi' ? 0 : 1
        const bActive = getPanelStatus(b) === 'Sedang Produksi' ? 0 : 1
        return aActive - bActive || a.createdAt.getTime() - b.createdAt.getTime()
      })
  }, [transactions, getPanelStatus])

  const runningOrders = useMemo(
    () => productionOrders.filter((trx) => ACTIVE_STATUSES.includes(getPanelStatus(trx))),
    [productionOrders, getPanelStatus]
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
  const [expensePhoto, setExpensePhoto] = useState<File | null>(null)
  const [expensePhotoPreview, setExpensePhotoPreview] = useState<string | null>(null)
  const [isUploadingExpensePhoto, setIsUploadingExpensePhoto] = useState(false)
  const expensePhotoInputRef = useRef<HTMLInputElement>(null)

  const resolvedDebitAccount = accounts.find((account) => account.id === (debitAccountId || defaultExpenseAccount?.id))
  const resolvedCreditAccount = accounts.find((account) => account.id === (creditAccountId || defaultCashAccount?.id))

  const statusCounts = useMemo(() => {
    return PRODUCTION_STATUSES.reduce((acc, status) => {
      acc[status] = productionOrders.filter((trx) => getPanelStatus(trx) === status).length
      return acc
    }, {} as Record<string, number>)
  }, [productionOrders, getPanelStatus])

  const handleSetStatus = async (transaction: Transaction | undefined, status: ProductionPanelStatus) => {
    if (!transaction) return
    if (getPanelStatus(transaction) === status) return

    if (status === 'Antri Produksi' || status === 'Sedang Produksi') {
      setLocalProductionStatuses((current) => ({ ...current, [transaction.id]: status }))
      toast({ title: 'Status panel diperbarui', description: `${transaction.customerName} → ${status}` })
      return
    }

    if (status === 'Selesai Produksi') {
      if (!user?.id) {
        toast({ variant: 'destructive', title: 'User belum valid', description: 'Login ulang sebelum menyelesaikan produksi.' })
        return
      }
      if (isLoadingProducts) {
        toast({ variant: 'destructive', title: 'Produk masih dimuat', description: 'Tunggu katalog produk selesai dimuat sebelum menyelesaikan produksi.' })
        return
      }

      const productionItems = transaction.items
        .map((item) => {
          const legacyItem = item as typeof item & { productId?: string; product_id?: string }
          const productId = item.product?.id || legacyItem.productId || legacyItem.product_id
          const product = products.find((p) => p.id === productId)
          return { item, productId, product }
        })
        .filter(({ productId, product }) => productId && product?.type === 'Produksi')

      for (const { item, productId, product } of productionItems) {
        const quantity = Number(item.quantity) || 0
        if (!productId || !product || quantity <= 0) continue

        const validation = await validateProductForProduction(productId, product.type)
        if (!validation.valid) {
          toast({
            variant: 'destructive',
            title: 'Produksi belum bisa diselesaikan',
            description: `${product.name}: ${validation.message || 'Produk belum siap diproduksi.'}`,
          })
          return
        }

        const success = await processProduction({
          productId,
          quantity,
          consumeBOM: true,
          createdBy: user.id,
          note: `Produksi dari order ${transaction.customerName} (${format(transaction.orderDate, 'dd/MM/yyyy HH:mm')})`,
        })

        if (!success) return
      }

      const finalTransactionStatus = (!isDeliveryEnabled || transaction.isOfficeSale) ? 'Selesai' : 'Siap Antar'
      await updateTransactionStatus.mutateAsync({ transactionId: transaction.id, status: finalTransactionStatus })
      setLocalProductionStatuses((current) => ({ ...current, [transaction.id]: 'Selesai Produksi' }))
      toast({
        title: 'Produksi selesai',
        description: `${transaction.customerName} → ${finalTransactionStatus}`,
      })
      return
    }
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

    if (!expensePhoto) {
      toast({ variant: 'destructive', title: 'Foto bukti nota wajib', description: 'Upload atau ambil foto bukti nota sebelum mencatat pengeluaran produksi.' })
      return
    }

    setIsUploadingExpensePhoto(true)
    let expensePhotoUrl = ''
    try {
      const uploadResult = await PhotoUploadService.uploadPhoto(
        expensePhoto,
        `PROD-EXP-${selectedTransaction.id}-${Date.now()}`,
        'expenses'
      )
      expensePhotoUrl = uploadResult.webViewLink
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gagal upload foto bukti nota'
      toast({ variant: 'destructive', title: 'Upload foto gagal', description: message })
      setIsUploadingExpensePhoto(false)
      return
    }

    try {
      await new Promise<void>((resolve, reject) => {
      createJournalEntry(
        {
      entryDate: new Date(),
      description: `Pengeluaran produksi order ${selectedTransaction.customerName}${expenseNote ? ` - ${expenseNote}` : ''} | Bukti nota: ${expensePhotoUrl}`,
      referenceType: 'transaction',
      referenceId: selectedTransaction.id,
      lines: [
        {
          accountId: resolvedDebitAccount.id,
          debitAmount: expenseAmount,
          creditAmount: 0,
          description: `${expenseNote || 'Tambahan pengeluaran produksi'} | Bukti nota: ${expensePhotoUrl}`,
        },
        {
          accountId: resolvedCreditAccount.id,
          debitAmount: 0,
          creditAmount: expenseAmount,
          description: `${expenseNote || 'Pembayaran pengeluaran produksi'} | Bukti nota: ${expensePhotoUrl}`,
        },
      ],
        },
        {
          onSuccess: () => resolve(),
          onError: (error: Error) => reject(error),
        }
      )
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gagal mencatat jurnal pengeluaran produksi'
      toast({ variant: 'destructive', title: 'Gagal mencatat pengeluaran', description: message })
      setIsUploadingExpensePhoto(false)
      return
    }

    setExpenseAmount(0)
    setExpenseNote('')
    setExpensePhoto(null)
    setExpensePhotoPreview(null)
    if (expensePhotoInputRef.current) expensePhotoInputRef.current.value = ''
    setIsUploadingExpensePhoto(false)
  }

  const handleExpensePhotoCapture = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!isImageFile(file)) {
      toast({ variant: 'destructive', title: 'File tidak valid', description: 'Bukti nota wajib berupa gambar.' })
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({ variant: 'destructive', title: 'File terlalu besar', description: 'Ukuran foto maksimal 10MB.' })
      return
    }

    try {
      const compressed = await compressImage(file, 150)
      setExpensePhoto(compressed)
      const reader = new FileReader()
      reader.onload = (e) => setExpensePhotoPreview(e.target?.result as string)
      reader.readAsDataURL(compressed)
    } catch (error) {
      console.error('Gagal memproses foto bukti nota:', error)
      toast({ variant: 'destructive', title: 'Foto gagal diproses', description: 'Coba ambil ulang atau pilih gambar lain.' })
    }
  }

  const removeExpensePhoto = () => {
    setExpensePhoto(null)
    setExpensePhotoPreview(null)
    if (expensePhotoInputRef.current) expensePhotoInputRef.current.value = ''
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
                  <Badge variant={getPanelStatus(trx) === 'Sedang Produksi' ? 'default' : 'secondary'}>{getPanelStatus(trx)}</Badge>
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
                <Button variant="outline" onClick={() => handleSetStatus(selectedTransaction, 'Antri Produksi')} disabled={!selectedTransaction || getPanelStatus(selectedTransaction) === 'Antri Produksi' || updateTransactionStatus.isPending || isProcessingProduction}>
                  Masukkan Antrian
                </Button>
                <Button onClick={() => handleSetStatus(selectedTransaction, 'Sedang Produksi')} disabled={!selectedTransaction || getPanelStatus(selectedTransaction) === 'Sedang Produksi' || updateTransactionStatus.isPending || isProcessingProduction}>
                  <Play className="mr-2 h-4 w-4" /> Mulai Produksi
                </Button>
                <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => handleSetStatus(selectedTransaction, 'Selesai Produksi')} disabled={!selectedTransaction || getPanelStatus(selectedTransaction) === 'Selesai Produksi' || updateTransactionStatus.isPending || isProcessingProduction || isLoadingProducts}>
                  <CheckCircle2 className="mr-2 h-4 w-4" /> {isProcessingProduction ? 'Memproses Produksi...' : 'Selesai Produksi'}
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
                    <Badge>{getPanelStatus(selectedTransaction)}</Badge>
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

            <div className="space-y-2">
              <Label>Foto bukti nota <span className="text-destructive">*</span></Label>
              <input
                ref={expensePhotoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleExpensePhotoCapture}
              />
              {!expensePhotoPreview ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-24 w-full border-dashed border-2 flex-col gap-2"
                  onClick={() => expensePhotoInputRef.current?.click()}
                >
                  <Camera className="h-7 w-7 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Ambil Foto / Pilih Gambar Nota</span>
                </Button>
              ) : (
                <div className="relative h-40 overflow-hidden rounded-lg border bg-muted">
                  <img src={expensePhotoPreview} alt="Bukti nota pengeluaran produksi" className="h-full w-full object-contain" />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute right-2 top-2 h-8 w-8 rounded-full"
                    onClick={removeExpensePhoto}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                  <div className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-center text-[10px] text-white">
                    {expensePhoto?.name}
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Wajib ada foto nota sebelum jurnal pengeluaran produksi bisa disimpan.</p>
            </div>

            <Button className="w-full" onClick={handleRecordExpense} disabled={isCreating || isUploadingExpensePhoto || !selectedTransaction}>
              {isCreating || isUploadingExpensePhoto ? 'Mencatat...' : 'Catat Pengeluaran + Jurnal'}
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
