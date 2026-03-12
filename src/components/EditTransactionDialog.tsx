"use client"

import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { DateTimePicker } from './ui/datetime-picker'
import { Transaction, TransactionItem, PaymentStatus } from '@/types/transaction'
import { useTransactions } from '@/hooks/useTransactions'
import { useCustomers } from '@/hooks/useCustomers'
import { useProducts } from '@/hooks/useProducts'
import { useAccounts } from '@/hooks/useAccounts'
import { calculatePPNWithMode, getDefaultPPNPercentage } from '@/utils/ppnCalculations'
import { Trash2, Plus } from 'lucide-react'
import { useTimezone } from '@/contexts/TimezoneContext'
import { getOfficeTime } from '@/utils/officeTime'
import { useSalesEmployees } from '@/hooks/useSalesCommission'

interface EditTransactionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  transaction: Transaction
}

interface FormTransactionItem {
  id: number;
  product: any | null;
  keterangan: string;
  qty: number;
  harga: number;
  unit: string;
}

export function EditTransactionDialog({ open, onOpenChange, transaction }: EditTransactionDialogProps) {
  const { toast } = useToast()
  const { updateTransaction } = useTransactions()
  const { customers } = useCustomers()
  const { products } = useProducts()
  const { accounts } = useAccounts()
  const { timezone } = useTimezone()
  const { data: salesEmployees } = useSalesEmployees()

  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null)
  const [orderDate, setOrderDate] = useState<Date | undefined>(getOfficeTime(timezone))
  const [dueDate, setDueDate] = useState('')
  const [paymentAccountId, setPaymentAccountId] = useState<string>('')
  const [salesId, setSalesId] = useState<string>('')
  const [salesName, setSalesName] = useState<string>('')
  const [items, setItems] = useState<FormTransactionItem[]>([])
  const [diskon, setDiskon] = useState(0)
  const [paidAmount, setPaidAmount] = useState(0)
  const [previousPaidAmount, setPreviousPaidAmount] = useState(0) // Jumlah dibayar sebelumnya
  const [ppnEnabled, setPpnEnabled] = useState(false)
  const [ppnMode, setPpnMode] = useState<'include' | 'exclude'>('include')
  const [ppnPercentage, setPpnPercentage] = useState(getDefaultPPNPercentage())
  const [isOfficeSale, setIsOfficeSale] = useState(false)

  // Load transaction data when dialog opens
  useEffect(() => {
    if (open && transaction) {
      const customer = customers?.find(c => c.id === transaction.customerId)
      setSelectedCustomer(customer || null)
      setOrderDate(transaction.orderDate)
      setDueDate(transaction.dueDate ? transaction.dueDate.toISOString().split('T')[0] : '')
      setPaymentAccountId(transaction.paymentAccountId || '')
      setPaidAmount(transaction.paidAmount)
      setPreviousPaidAmount(transaction.paidAmount) // Simpan jumlah dibayar sebelumnya
      setPpnEnabled(transaction.ppnEnabled)
      setPpnMode(transaction.ppnMode || 'include')
      setPpnPercentage(transaction.ppnPercentage)
      setIsOfficeSale(transaction.isOfficeSale || false)
      setSalesId(transaction.salesId || '')
      setSalesName(transaction.salesName || '')

      // Convert transaction items to form items (skip items without valid product)
      const formItems: FormTransactionItem[] = transaction.items
        .filter(item => item.product?.id) // Skip items without valid product
        .map((item, index) => ({
          id: index,
          product: item.product,
          keterangan: item.notes || '',
          qty: item.quantity,
          harga: item.price,
          unit: item.unit,
        }))
      setItems(formItems)

      // Calculate discount from subtotal difference (only for items with valid product)
      const itemsTotal = transaction.items
        .filter(item => item.product?.id)
        .reduce((total, item) => total + (item.quantity * item.price), 0)
      const calculatedDiskon = itemsTotal - transaction.subtotal
      setDiskon(calculatedDiskon)
    }
  }, [open, transaction, customers])

  const subTotal = useMemo(() => items.reduce((total, item) => total + (item.qty * item.harga), 0), [items])
  const subtotalAfterDiskon = useMemo(() => subTotal - diskon, [subTotal, diskon])
  const ppnCalculation = useMemo(() => {
    if (ppnEnabled) {
      return calculatePPNWithMode(subtotalAfterDiskon, ppnPercentage, ppnMode)
    }
    return { subtotal: subtotalAfterDiskon, ppnAmount: 0, total: subtotalAfterDiskon }
  }, [subtotalAfterDiskon, ppnEnabled, ppnPercentage, ppnMode])
  const totalTagihan = useMemo(() => ppnCalculation.total, [ppnCalculation])
  const sisaTagihan = useMemo(() => totalTagihan - paidAmount, [totalTagihan, paidAmount])

  const handleAddItem = () => {
    const newItem: FormTransactionItem = {
      id: Date.now(), product: null, keterangan: '', qty: 1, harga: 0, unit: 'pcs'
    }
    setItems([...items, newItem])
  }

  const handleItemChange = (index: number, field: keyof FormTransactionItem, value: any) => {
    const newItems = [...items];
    (newItems[index] as any)[field] = value;

    if (field === 'product' && value) {
      newItems[index].harga = value.basePrice || 0;
      newItems[index].unit = value.unit || 'pcs';
    }

    setItems(newItems);
  }

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const validItems = items.filter(item => item.product && item.qty > 0)

    if (!selectedCustomer || validItems.length === 0) {
      toast({ variant: "destructive", title: "Validasi Gagal", description: "Harap pilih Pelanggan dan tambahkan minimal satu item produk yang valid." })
      return
    }

    if (paidAmount > 0 && !paymentAccountId) {
      toast({ variant: "destructive", title: "Validasi Gagal", description: "Harap pilih Metode Pembayaran jika ada jumlah yang dibayar." })
      return
    }

    const transactionItems: TransactionItem[] = validItems.map(item => ({
      product: item.product!,
      quantity: item.qty,
      price: item.harga,
      unit: item.unit,
      width: 0,
      height: 0,
      notes: item.keterangan,
    }))

    const paymentStatus: PaymentStatus = sisaTagihan <= 0 ? 'Lunas' : 'Belum Lunas'

    const updatedTransaction: Transaction = {
      ...transaction,
      customerId: selectedCustomer.id,
      customerName: selectedCustomer.name,
      paymentAccountId: paymentAccountId || null,
      salesId: salesId || null,
      salesName: salesName || null,
      orderDate: orderDate || getOfficeTime(timezone),
      dueDate: sisaTagihan > 0 && dueDate ? new Date(dueDate) : null,
      items: transactionItems,
      subtotal: ppnCalculation.subtotal,
      ppnEnabled: ppnEnabled,
      ppnMode: ppnEnabled ? ppnMode : undefined,
      ppnPercentage: ppnPercentage,
      ppnAmount: ppnCalculation.ppnAmount,
      total: totalTagihan,
      paidAmount: paidAmount,
      paymentStatus: paymentStatus,
      isOfficeSale: isOfficeSale,
    }

    // Kirim dengan previousPaidAmount untuk auto-generate jurnal penyesuaian pembayaran
    updateTransaction.mutate({ transaction: updatedTransaction, previousPaidAmount }, {
      onSuccess: () => {
        toast({ title: "Sukses", description: "Transaksi berhasil diperbarui." })
        onOpenChange(false)
      },
      onError: (error) => {
        toast({ variant: "destructive", title: "Gagal Memperbarui", description: error.message })
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Transaksi</DialogTitle>
          <DialogDescription>
            Edit data transaksi {transaction?.id}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Customer Selection */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Pelanggan</Label>
              <Select
                value={selectedCustomer?.id || ''}
                onValueChange={(value) => {
                  const customer = customers?.find(c => c.id === value)
                  setSelectedCustomer(customer || null)
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pilih pelanggan..." />
                </SelectTrigger>
                <SelectContent>
                  {customers?.map(customer => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tanggal Order</Label>
              <DateTimePicker date={orderDate} setDate={setOrderDate} />
            </div>
          </div>

          {/* Sales Selection */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Sales</Label>
              <Select
                value={salesId || 'none'}
                onValueChange={(value) => {
                  if (value === 'none') {
                    setSalesId('')
                    setSalesName('')
                  } else {
                    const sales = salesEmployees?.find(s => s.id === value)
                    setSalesId(value)
                    setSalesName(sales?.name || '')
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pilih sales..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Tanpa Sales</SelectItem>
                  {salesEmployees?.map(sales => (
                    <SelectItem key={sales.id} value={sales.id}>
                      {sales.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              {/* Office Sale Checkbox */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 w-full">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOfficeSale}
                    onChange={(e) => setIsOfficeSale(e.target.checked)}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                  />
                  <span className="text-sm font-medium text-blue-900">Laku Kantor</span>
                </label>
              </div>
            </div>
          </div>

          {/* Items */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <Label>Daftar Item</Label>
              <Button type="button" onClick={handleAddItem} size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Tambah Item
              </Button>
            </div>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left p-2">Produk</th>
                    <th className="text-left p-2">Catatan</th>
                    <th className="text-left p-2">Qty</th>
                    <th className="text-left p-2">Unit</th>
                    <th className="text-left p-2">Harga</th>
                    <th className="text-left p-2">Subtotal</th>
                    <th className="text-left p-2">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={item.id} className="border-t">
                      <td className="p-2">
                        <Select
                          value={item.product?.id || ''}
                          onValueChange={(value) => {
                            const product = products?.find(p => p.id === value)
                            handleItemChange(index, 'product', product || null)
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Pilih produk..." />
                          </SelectTrigger>
                          <SelectContent>
                            {products?.map(product => (
                              <SelectItem key={product.id} value={product.id}>
                                {product.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-2">
                        <Input
                          value={item.keterangan}
                          onChange={(e) => handleItemChange(index, 'keterangan', e.target.value)}
                          placeholder="Catatan..."
                          className="w-full"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min="1"
                          value={item.qty}
                          onChange={(e) => handleItemChange(index, 'qty', Number(e.target.value) || 1)}
                          className="w-16"
                        />
                      </td>
                      <td className="p-2 text-sm">{item.unit}</td>
                      <td className="p-2">
                        <Input
                          type="number"
                          value={item.harga}
                          onChange={(e) => handleItemChange(index, 'harga', Number(e.target.value) || 0)}
                          className="w-24"
                        />
                      </td>
                      <td className="p-2 text-sm font-medium">
                        {new Intl.NumberFormat("id-ID").format(item.qty * item.harga)}
                      </td>
                      <td className="p-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleRemoveItem(index)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tax Settings */}
          <div className="border border-blue-200 bg-blue-50 p-4 rounded-lg">
            <Label className="text-sm font-medium text-gray-900 mb-3 block">Pengaturan Pajak</Label>
            <div className="space-y-3">
              <label className="flex items-center text-sm cursor-pointer hover:bg-blue-100 p-2 rounded transition-colors">
                <input
                  type="radio"
                  name="taxMode"
                  checked={ppnEnabled && ppnMode === 'include'}
                  onChange={() => {
                    setPpnEnabled(true)
                    setPpnMode('include')
                  }}
                  className="mr-3 w-4 h-4 text-blue-600"
                />
                <div>
                  <div className="font-medium text-gray-900">PPN Include</div>
                  <div className="text-xs text-gray-600">Harga sudah termasuk pajak {ppnPercentage}%</div>
                </div>
              </label>
              <label className="flex items-center text-sm cursor-pointer hover:bg-blue-100 p-2 rounded transition-colors">
                <input
                  type="radio"
                  name="taxMode"
                  checked={ppnEnabled && ppnMode === 'exclude'}
                  onChange={() => {
                    setPpnEnabled(true)
                    setPpnMode('exclude')
                  }}
                  className="mr-3 w-4 h-4 text-blue-600"
                />
                <div>
                  <div className="font-medium text-gray-900">PPN Exclude</div>
                  <div className="text-xs text-gray-600">Pajak {ppnPercentage}% ditambahkan ke total</div>
                </div>
              </label>
              <label className="flex items-center text-sm cursor-pointer hover:bg-blue-100 p-2 rounded transition-colors">
                <input
                  type="radio"
                  name="taxMode"
                  checked={!ppnEnabled}
                  onChange={() => setPpnEnabled(false)}
                  className="mr-3 w-4 h-4 text-blue-600"
                />
                <div>
                  <div className="font-medium text-gray-900">Non Pajak</div>
                  <div className="text-xs text-gray-600">Tidak menggunakan pajak</div>
                </div>
              </label>
              {ppnEnabled && (
                <div className="mt-3 pt-3 border-t border-blue-200">
                  <div className="text-xs text-blue-700">
                    <strong>Mode Aktif:</strong> {ppnMode === 'include' ? 'PPN Include' : 'PPN Exclude'} ({ppnPercentage}%)
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Payment Details */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Sub Total</Label>
              <div className="text-lg font-medium">
                {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(subTotal)}
              </div>
            </div>
            <div>
              <Label>Diskon</Label>
              <Input
                type="number"
                value={diskon}
                onChange={(e) => setDiskon(Number(e.target.value) || 0)}
              />
            </div>
          </div>

          {ppnEnabled && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>PPN ({ppnPercentage}%)</Label>
                <div className="text-lg font-medium">
                  {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(ppnCalculation.ppnAmount)}
                </div>
              </div>
              <div>
                <Label>Total</Label>
                <div className="text-lg font-bold">
                  {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(totalTagihan)}
                </div>
              </div>
            </div>
          )}

          {/* Payment Section */}
          <div className="border border-green-200 bg-green-50 p-4 rounded-lg space-y-4">
            <Label className="text-sm font-medium text-gray-900 block">Status Pembayaran</Label>

            {/* Previous Payment Info */}
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Total Tagihan:</span>
                <span className="font-bold text-lg">
                  {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(totalTagihan)}
                </span>
              </div>
              <div className="flex justify-between items-center mt-1">
                <span className="text-sm text-gray-600">Dibayar Sebelumnya:</span>
                <span className="font-medium text-blue-600">
                  {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(previousPaidAmount)}
                </span>
              </div>
              {previousPaidAmount !== paidAmount && (
                <div className="flex justify-between items-center mt-1 pt-2 border-t">
                  <span className="text-sm text-gray-600">Perubahan:</span>
                  <span className={`font-medium ${paidAmount > previousPaidAmount ? 'text-green-600' : 'text-red-600'}`}>
                    {paidAmount > previousPaidAmount ? '+' : ''}{new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(paidAmount - previousPaidAmount)}
                  </span>
                </div>
              )}
            </div>

            {/* Quick Select Buttons */}
            <div className="flex gap-2">
              <Button
                type="button"
                variant={paidAmount === totalTagihan ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => {
                  setPaidAmount(totalTagihan)
                  // Auto-select first payment account if not selected
                  if (!paymentAccountId) {
                    const firstAccount = accounts?.find(a => a.isPaymentAccount)
                    if (firstAccount) setPaymentAccountId(firstAccount.id)
                  }
                }}
              >
                Lunas
              </Button>
              <Button
                type="button"
                variant={paidAmount === 0 ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => {
                  setPaidAmount(0)
                  setPaymentAccountId('')
                }}
              >
                Kredit (Belum Bayar)
              </Button>
            </div>

            {/* Payment Amount Input */}
            <div>
              <Label className="text-sm">Jumlah Dibayar Baru</Label>
              <Input
                type="number"
                value={paidAmount}
                onChange={(e) => {
                  const val = Number(e.target.value) || 0
                  setPaidAmount(Math.min(val, totalTagihan))
                  // Auto-select payment account if paying
                  if (val > 0 && !paymentAccountId) {
                    const firstAccount = accounts?.find(a => a.isPaymentAccount)
                    if (firstAccount) setPaymentAccountId(firstAccount.id)
                  }
                  if (val === 0) setPaymentAccountId('')
                }}
                className="mt-1"
              />
            </div>

            {/* Payment Account - Only show if paidAmount > 0 */}
            {paidAmount > 0 && (
              <div>
                <Label className="text-sm">Metode Pembayaran</Label>
                <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Pilih pembayaran..." />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts?.filter(a => a.isPaymentAccount).map(acc => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Remaining Balance */}
            {sisaTagihan > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-orange-700">Sisa Tagihan:</span>
                  <span className="font-bold text-orange-600">
                    {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(sisaTagihan)}
                  </span>
                </div>
              </div>
            )}

            {/* Payment Status Indicator */}
            {paidAmount >= totalTagihan && totalTagihan > 0 && (
              <div className="text-center py-2 bg-green-100 rounded-lg text-green-700 font-medium text-sm">
                ✓ Pembayaran Lunas
              </div>
            )}
            {paidAmount === 0 && totalTagihan > 0 && (
              <div className="text-center py-2 bg-orange-100 rounded-lg text-orange-700 font-medium text-sm">
                📝 Transaksi Kredit (Belum Bayar)
              </div>
            )}
            {paidAmount > 0 && paidAmount < totalTagihan && (
              <div className="text-center py-2 bg-yellow-100 rounded-lg text-yellow-700 font-medium text-sm">
                ⏳ Pembayaran Sebagian
              </div>
            )}
          </div>

          {/* Due Date - Only show if there's remaining balance */}
          {sisaTagihan > 0 && (
            <div>
              <Label>Tanggal Jatuh Tempo</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="mt-1"
              />
            </div>
          )}

          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={updateTransaction.isPending}>
              {updateTransaction.isPending ? 'Menyimpan...' : 'Simpan'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}