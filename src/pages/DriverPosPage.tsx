"use client"

import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { useSearchParams } from "react-router-dom"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/use-toast"
import { Truck, Plus, Trash2, ShoppingCart, User, Package, CreditCard, AlertCircle, Phone, MapPin, Calendar, Minus, Gift, UserPlus } from "lucide-react"
import { format } from "date-fns"
import { id } from "date-fns/locale"
import { useCustomers } from "@/hooks/useCustomers"
import { useProducts } from "@/hooks/useProducts"
import { useAccounts } from "@/hooks/useAccounts"
import { useBranch } from "@/contexts/BranchContext"
import { useTransactions } from "@/hooks/useTransactions"
import { useAuth } from "@/hooks/useAuth"
import { useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/integrations/supabase/client"
import { useActiveRetasi } from "@/hooks/useRetasi"
import { TransactionItem, Transaction } from "@/types/transaction"
import { DriverDeliveryDialog } from "@/components/DriverDeliveryDialog"
import { DriverPrintDialog } from "@/components/DriverPrintDialog"
import { AddCustomerDialog } from "@/components/AddCustomerDialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { PricingService } from "@/services/pricingService"
import { Product } from "@/types/product"
import { useTimezone } from "@/contexts/TimezoneContext"
import { getOfficeTime } from "@/utils/officeTime"

interface CartItem extends TransactionItem {
  isBonus?: boolean
  bonusDescription?: string
  parentProductId?: string
  isManualPrice?: boolean  // Flag to preserve manually edited price
}

export default function DriverPosPage() {
  const { toast } = useToast()
  const { user } = useAuth()
  const { timezone } = useTimezone()
  const { customers } = useCustomers()
  const { products } = useProducts()
  const { accounts, getEmployeeCashAccount } = useAccounts()
  const { addTransaction } = useTransactions()
  const { currentBranch } = useBranch()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()

  // Check if driver has active retasi (is_returned = false)
  const { data: activeRetasi, isLoading: isCheckingRetasi } = useActiveRetasi(user?.name)

  // Form state
  const [selectedCustomer, setSelectedCustomer] = useState("")
  const [customerSearch, setCustomerSearch] = useState('')
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)

  // Auto-select customer from URL query parameter
  useEffect(() => {
    const customerId = searchParams.get('customerId')
    if (customerId && customers && customers.length > 0 && !selectedCustomer) {
      const customer = customers.find(c => c.id === customerId)
      if (customer) {
        setSelectedCustomer(customer.id)
        setCustomerSearch(customer.name)
      }
    }
  }, [searchParams, customers, selectedCustomer])
  const [items, setItems] = useState<CartItem[]>([])
  const [paymentAccount, setPaymentAccount] = useState("")

  // Auto-select payment account based on logged-in user's assigned cash account
  useEffect(() => {
    if (user?.id && accounts && accounts.length > 0 && !paymentAccount) {
      const employeeCashAccount = getEmployeeCashAccount(user.id);
      if (employeeCashAccount) {
        setPaymentAccount(employeeCashAccount.id);
        console.log(`[DriverPOS] Auto-selected cash account "${employeeCashAccount.name}" for user ${user.name}`);
      }
    }
  }, [user?.id, accounts, paymentAccount, getEmployeeCashAccount]);
  const [paidAmount, setPaidAmount] = useState(0)

  // Auto-set paidAmount to total when items change (default to full payment)
  useEffect(() => {
    if (items.length > 0) {
      const newTotal = items
        .filter(item => !item.isBonus)
        .reduce((sum, item) => sum + (item.price * item.quantity), 0)
      setPaidAmount(newTotal)
    } else {
      setPaidAmount(0)
    }
  }, [items])
  const [dueDate, setDueDate] = useState(() => {
    const date = getOfficeTime(timezone);
    date.setDate(date.getDate() + 7);
    return date.toISOString().split('T')[0];
  })

  // Dialog states
  const [deliveryDialogOpen, setDeliveryDialogOpen] = useState(false)
  const [printDialogOpen, setPrintDialogOpen] = useState(false)
  const [createdTransaction, setCreatedTransaction] = useState<Transaction | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCustomerAddOpen, setIsCustomerAddOpen] = useState(false)
  const [gallonAdded, setGallonAdded] = useState<number>(0)
  const [gallonWithdrawn, setGallonWithdrawn] = useState<number>(0)
  const [gallonNotes, setGallonNotes] = useState<string>('')
  const [piutangWarningOpen, setPiutangWarningOpen] = useState<boolean>(false)
  const [livePiutangData, setLivePiutangData] = useState<{ total: number; count: number; nearestDue: string | null } | null>(null)

  // Quantity editing state with debounce
  const [pendingQuantities, setPendingQuantities] = useState<Record<number, number>>({})
  const quantityDebounceRef = useRef<Record<number, NodeJS.Timeout>>({})

  // Memoized values
  const filteredCustomers = useMemo(() => {
    if (!customers) return [];
    return customers.filter(customer =>
      customer.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
      customer.phone.includes(customerSearch)
    ).slice(0, 8);
  }, [customers, customerSearch]);

  const selectedCustomerData = customers?.find(c => c.id === selectedCustomer)
  const customerOutstandingReceivable = Math.max(0, Number(selectedCustomerData?.sisaPiutang) || 0)
  const customerReceivableCount = Number(selectedCustomerData?.jumlahPiutang) || 0
  const customerNearestDueDate = selectedCustomerData?.jatuhTempoTerdekat
    ? format(new Date(selectedCustomerData.jatuhTempoTerdekat), 'dd MMM yyyy', { locale: id })
    : null

  // Products sorted by stock
  const availableProducts = useMemo(() => {
    return products
      ?.filter(p => p?.id && p.id.trim() !== '' && (p.currentStock || 0) > 0 && p.isActive !== false)
      ?.sort((a, b) => (b.currentStock || 0) - (a.currentStock || 0)) || [];
  }, [products]);

  // Calculate totals (exclude bonus items from total)
  const subtotal = items
    .filter(item => !item.isBonus)
    .reduce((sum, item) => sum + (item.price * item.quantity), 0)
  const total = subtotal

  // Count bonus items
  const bonusItems = items.filter(item => item.isBonus)
  const totalBonusQty = bonusItems.reduce((sum, item) => sum + item.quantity, 0)

  // Access control
  const isAdminOwner = user?.role && ['admin', 'owner'].includes(user.role)
  const isDriver = user?.role === 'driver' || user?.role === 'supir'
  const isHelper = user?.role === 'helper' || user?.role === 'pembantu'
  const hasAccess = isAdminOwner || isHelper || (isDriver && activeRetasi !== null)

  // Calculate price with bonus based on QUANTITY and CUSTOMER CLASSIFICATION
  const calculatePriceWithBonus = async (product: Product, quantity: number) => {
    try {
      let basePrice = product.basePrice

      // First check for customer-specific or classification-based pricing
      if (selectedCustomerData) {
        const customerPricing = await PricingService.getCustomerProductPrice(
          product.id,
          selectedCustomerData.id,
          selectedCustomerData.classification as any
        )
        if (customerPricing && customerPricing.customerAdjustedPrice !== basePrice) {
          basePrice = customerPricing.customerAdjustedPrice
          console.log(`[DriverPOS] Customer pricing applied for ${selectedCustomerData.name} (${selectedCustomerData.classification}): ${product.basePrice} -> ${basePrice}`)
        }
      }

      const productPricing = await PricingService.getProductPricing(product.id)
      if (productPricing) {
        // Calculate price based on quantity purchased, NOT stock level
        // Pass empty stockPricings to ignore stock-based pricing
        const priceCalculation = PricingService.calculatePrice(
          basePrice, // Use customer-adjusted base price
          product.currentStock || 0,
          quantity,
          [], // Ignore stock pricing - we only want quantity-based pricing
          productPricing.bonusPricings
        )
        return {
          // Use finalPrice which includes quantity-based discounts
          price: priceCalculation.finalPrice,
          bonuses: priceCalculation.bonuses || []
        }
      }
      return { price: basePrice, bonuses: [] }
    } catch (error) {
      console.error('Error calculating price:', error)
    }
    return { price: product.basePrice, bonuses: [] }
  }


  // Quick add product to cart with bonus calculation
  const quickAddProduct = async (product: typeof availableProducts[0]) => {
    const existingIndex = items.findIndex(item => item.product.id === product.id && !item.isBonus)

    if (existingIndex >= 0) {
      // Increment quantity if already in cart
      const currentQty = items[existingIndex].quantity
      const newQty = currentQty + 1
      if (newQty <= (product.currentStock || 0)) {
        await updateItemWithBonus(existingIndex, newQty)
      } else {
        toast({
          variant: "destructive",
          title: "Stock Tidak Cukup",
          description: `Stock tersedia: ${product.currentStock} ${product.unit || 'pcs'}`
        })
      }
    } else {
      // Add new item with bonus check
      const { price, bonuses } = await calculatePriceWithBonus(product, 1)
      const newItem: CartItem = {
        product,
        width: 0,
        height: 0,
        quantity: 1,
        notes: "",
        price: price,
        unit: product.unit || "pcs"
      }
      let newItems = [...items, newItem]

      // Add bonus items if any
      for (const bonus of bonuses) {
        if (bonus.type === 'quantity' && bonus.bonusQuantity > 0) {
          const bonusItem: CartItem = {
            product,
            width: 0,
            height: 0,
            quantity: bonus.bonusQuantity,
            notes: bonus.description || 'Bonus',
            price: 0,
            unit: product.unit || "pcs",
            isBonus: true,
            bonusDescription: bonus.description,
            parentProductId: product.id
          }
          newItems.push(bonusItem)
        }
      }
      setItems(newItems)
    }
  }

  // Update item with bonus recalculation
  const updateItemWithBonus = async (index: number, newQty: number) => {
    const item = items[index]
    if (item.isBonus) return // Don't update bonus items directly

    const { price, bonuses } = await calculatePriceWithBonus(item.product, newQty)

    // Remove existing bonus items for this product
    let newItems = items.filter(i => i.parentProductId !== item.product.id)

    // Update main item - preserve manually edited price
    newItems = newItems.map((i, idx) =>
      idx === index ? { ...i, quantity: newQty, price: i.isManualPrice ? i.price : price } : i
    )

    // Add new bonus items
    for (const bonus of bonuses) {
      if (bonus.type === 'quantity' && bonus.bonusQuantity > 0) {
        const bonusItem: CartItem = {
          product: item.product,
          width: 0,
          height: 0,
          quantity: bonus.bonusQuantity,
          notes: bonus.description || 'Bonus',
          price: 0,
          unit: item.product.unit || "pcs",
          isBonus: true,
          bonusDescription: bonus.description,
          parentProductId: item.product.id
        }
        newItems.push(bonusItem)
      }
    }

    setItems(newItems)
  }

  const updateQuantity = async (index: number, delta: number) => {
    const item = items[index]
    if (item.isBonus) return // Don't update bonus items directly

    const newQty = item.quantity + delta

    if (newQty <= 0) {
      // Remove item and its bonuses
      setItems(items.filter((i, idx) => idx !== index && i.parentProductId !== item.product.id))
    } else if (newQty <= (item.product.currentStock || 0)) {
      await updateItemWithBonus(index, newQty)
    } else {
      toast({
        variant: "destructive",
        title: "Stock Tidak Cukup",
        description: `Stock tersedia: ${item.product.currentStock} ${item.product.unit || 'pcs'}`
      })
    }
  }

  // Debounced quantity update - immediate UI feedback, delayed API call
  const setQuantityDirect = useCallback((index: number, qty: number) => {
    const item = items[index]
    if (!item || item.isBonus) return

    // Immediately update pending quantity for responsive UI
    setPendingQuantities(prev => ({ ...prev, [index]: qty }))

    // Clear existing debounce timer
    if (quantityDebounceRef.current[index]) {
      clearTimeout(quantityDebounceRef.current[index])
    }

    // Debounce the actual update
    quantityDebounceRef.current[index] = setTimeout(async () => {
      if (qty <= 0) {
        setItems(prev => prev.filter((i, idx) => idx !== index && i.parentProductId !== item.product.id))
        setPendingQuantities(prev => {
          const newPending = { ...prev }
          delete newPending[index]
          return newPending
        })
      } else if (qty <= (item.product.currentStock || 0)) {
        await updateItemWithBonus(index, qty)
        setPendingQuantities(prev => {
          const newPending = { ...prev }
          delete newPending[index]
          return newPending
        })
      } else {
        toast({
          variant: "destructive",
          title: "Stock Tidak Cukup",
          description: `Stock tersedia: ${item.product.currentStock} ${item.product.unit || 'pcs'}`
        })
        // Revert to actual quantity
        setPendingQuantities(prev => {
          const newPending = { ...prev }
          delete newPending[index]
          return newPending
        })
      }
    }, 300) // 300ms debounce
  }, [items, toast, updateItemWithBonus])

  const removeItem = (index: number) => {
    const item = items[index]
    // Remove item and its bonuses
    setItems(items.filter((i, idx) => idx !== index && i.parentProductId !== item.product.id))
  }

  const resetDriverPosForm = useCallback(() => {
    setSelectedCustomer("")
    setCustomerSearch('')
    setItems([])
    setPaymentAccount("")
    setPaidAmount(0)
    const newDueDate = getOfficeTime(timezone)
    newDueDate.setDate(newDueDate.getDate() + 7)
    setDueDate(newDueDate.toISOString().split('T')[0])
  }, [timezone])

  const handleSubmit = async () => {
    const customerName = selectedCustomerData?.name || customerSearch.trim();

    if (!customerName) {
      toast({ variant: "destructive", title: "Error", description: "Isi nama pelanggan" })
      return
    }
    if (items.length === 0) {
      toast({ variant: "destructive", title: "Error", description: "Tambahkan minimal satu produk" })
      return
    }
    if (paidAmount > 0 && !paymentAccount) {
      toast({ variant: "destructive", title: "Error", description: "Pilih akun pembayaran" })
      return
    }
    if (isSubmitting) return;

    // Check piutang warning sebelum submit kredit
    // Kalau transaksi ini akan kredit (paidAmount < total) DAN customer dipilih,
    // query LIVE ke transactions table untuk get latest piutang (lebih akurat dari hook cache)
    const isKreditTransaction = paidAmount < total
    if (isKreditTransaction && selectedCustomerData?.id) {
      try {
        const { data: unpaidTx, error: unpaidErr } = await supabase
          .from('transactions')
          .select('id, total, paid_amount, due_date')
          .eq('customer_id', selectedCustomerData.id)
          .eq('payment_status', 'Belum Lunas')
          .eq('is_cancelled', false)
          .eq('is_voided', false)

        if (!unpaidErr && unpaidTx && unpaidTx.length > 0) {
          const sisaTotal = unpaidTx.reduce((sum: number, t: any) => sum + (Number(t.total) - Number(t.paid_amount || 0)), 0)
          if (sisaTotal > 0) {
            // Store live piutang data ke state untuk display di dialog
            setLivePiutangData({
              total: sisaTotal,
              count: unpaidTx.length,
              nearestDue: unpaidTx
                .map((t: any) => t.due_date)
                .filter(Boolean)
                .sort()[0] || null,
            })
            setPiutangWarningOpen(true)
            return
          }
        }
      } catch (err) {
        console.error('Error checking piutang:', err)
        // On error, just proceed (don't block submission)
      }
    }

    await proceedSubmit()
  }

  const proceedSubmit = async () => {
    const customerName = selectedCustomerData?.name || customerSearch.trim();
    setIsSubmitting(true)

    try {
      const transactionId = `TXN-${Date.now()}`

      const resolvedDueDate = (() => {
        if (!(paidAmount < total)) return null
        const source = dueDate || (() => {
          const fallbackDate = getOfficeTime(timezone)
          fallbackDate.setDate(fallbackDate.getDate() + 7)
          return fallbackDate.toISOString().split('T')[0]
        })()
        const parsed = new Date(source)
        return Number.isNaN(parsed.getTime()) ? null : parsed
      })()

      if (paidAmount < total && !resolvedDueDate) {
        throw new Error('Tanggal jatuh tempo tidak valid')
      }

      const newTransaction: Omit<Transaction, 'createdAt'> = {
        id: transactionId,
        customerId: selectedCustomerData?.id || 'manual-customer',
        customerName,
        cashierId: user!.id,
        cashierName: user?.name || user?.email || 'Driver POS',
        paymentAccountId: paymentAccount || null,
        retasiId: activeRetasi?.id || null,
        retasiNumber: activeRetasi?.retasi_number || null,
        orderDate: getOfficeTime(timezone),
        items,
        subtotal: total,
        ppnEnabled: false,
        ppnMode: 'exclude',
        ppnPercentage: 0,
        ppnAmount: 0,
        total,
        paidAmount: paidAmount || 0,
        paymentStatus: paidAmount >= total ? 'Lunas' : 'Belum Lunas',
        status: 'Pesanan Masuk',
        isOfficeSale: false,
        dueDate: resolvedDueDate
      }

      const savedTransaction = await addTransaction.mutateAsync({ newTransaction })

      // Insert gallon movements (Phase 2B - 2026-05-16)
      // Trigger DB akan auto-update customers.jumlah_galon_titip
      if (selectedCustomerData?.id && (gallonAdded > 0 || gallonWithdrawn > 0)) {
        try {
          const movements: any[] = []
          if (gallonAdded > 0) {
            movements.push({
              customer_id: selectedCustomerData.id,
              transaction_id: savedTransaction?.id || newTransaction.id,
              branch_id: currentBranch?.id || null,
              delta: gallonAdded,
              type: 'addition',
              notes: gallonNotes || null,
              created_by: user?.id || null,
              created_by_name: user?.name || null,
            })
          }
          if (gallonWithdrawn > 0) {
            movements.push({
              customer_id: selectedCustomerData.id,
              transaction_id: savedTransaction?.id || newTransaction.id,
              branch_id: currentBranch?.id || null,
              delta: -gallonWithdrawn,
              type: 'withdrawal',
              notes: gallonNotes || null,
              created_by: user?.id || null,
              created_by_name: user?.name || null,
            })
          }
          if (movements.length > 0) {
            const { error: gmError } = await supabase.from('gallon_movements').insert(movements)
            if (gmError) {
              console.error('Failed to insert gallon movement:', gmError)
              toast({ variant: "destructive", title: "Peringatan", description: "Transaksi tersimpan tapi update galon gagal: " + gmError.message })
            } else {
              queryClient.invalidateQueries({ queryKey: ['customers'] })
              setGallonAdded(0)
              setGallonWithdrawn(0)
              setGallonNotes('')
            }
          }
        } catch (err) {
          console.error('Error saving gallon movement:', err)
        }
      }

      const sanitizedTransaction: Transaction = {
        ...newTransaction,
        ...savedTransaction,
        id: savedTransaction?.id || newTransaction.id,
        customerId: savedTransaction?.customerId || newTransaction.customerId,
        customerName: savedTransaction?.customerName || newTransaction.customerName,
        cashierId: savedTransaction?.cashierId || newTransaction.cashierId,
        cashierName: savedTransaction?.cashierName || newTransaction.cashierName,
        paymentAccountId: savedTransaction?.paymentAccountId ?? newTransaction.paymentAccountId,
        retasiId: savedTransaction?.retasiId ?? newTransaction.retasiId,
        retasiNumber: savedTransaction?.retasiNumber ?? newTransaction.retasiNumber,
        orderDate: savedTransaction?.orderDate && !Number.isNaN(new Date(savedTransaction.orderDate).getTime())
          ? new Date(savedTransaction.orderDate)
          : newTransaction.orderDate,
        finishDate: savedTransaction?.finishDate && !Number.isNaN(new Date(savedTransaction.finishDate).getTime())
          ? new Date(savedTransaction.finishDate)
          : (newTransaction.finishDate || null),
        items: Array.isArray(savedTransaction?.items) && savedTransaction.items.length > 0 ? savedTransaction.items : newTransaction.items,
        subtotal: Number(savedTransaction?.subtotal ?? newTransaction.subtotal ?? total) || 0,
        ppnEnabled: savedTransaction?.ppnEnabled ?? newTransaction.ppnEnabled,
        ppnMode: savedTransaction?.ppnMode ?? newTransaction.ppnMode,
        ppnPercentage: Number(savedTransaction?.ppnPercentage ?? newTransaction.ppnPercentage ?? 0) || 0,
        ppnAmount: Number(savedTransaction?.ppnAmount ?? newTransaction.ppnAmount ?? 0) || 0,
        total: Number(savedTransaction?.total ?? newTransaction.total ?? total) || 0,
        paidAmount: Number(savedTransaction?.paidAmount ?? newTransaction.paidAmount ?? 0) || 0,
        paymentStatus: savedTransaction?.paymentStatus || newTransaction.paymentStatus,
        status: savedTransaction?.status || newTransaction.status,
        isOfficeSale: savedTransaction?.isOfficeSale ?? newTransaction.isOfficeSale,
        dueDate: savedTransaction?.dueDate && !Number.isNaN(new Date(savedTransaction.dueDate).getTime())
          ? new Date(savedTransaction.dueDate)
          : resolvedDueDate,
        createdAt: savedTransaction?.createdAt && !Number.isNaN(new Date(savedTransaction.createdAt).getTime())
          ? new Date(savedTransaction.createdAt)
          : new Date(),
      }
      setCreatedTransaction(sanitizedTransaction)

      toast({ title: "Berhasil", description: `Transaksi ${transactionId} disimpan` })
      setDeliveryDialogOpen(true)

    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Gagal menyimpan" })
    } finally {
      setIsSubmitting(false)
    }
  }

  // Loading state
  if (isCheckingRetasi && isDriver) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 dark:from-gray-900 dark:to-gray-800 p-4 flex items-center justify-center">
        <div className="animate-pulse text-center">
          <Truck className="h-8 w-8 mx-auto mb-4 text-blue-600 dark:text-blue-400" />
          <p className="text-gray-700 dark:text-gray-300">Memeriksa akses...</p>
        </div>
      </div>
    )
  }

  // Access denied
  if (!hasAccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-red-100 dark:from-gray-900 dark:to-gray-800 p-4 flex items-center justify-center">
        <Card className="max-w-md bg-red-600 dark:bg-red-700 text-white">
          <CardHeader className="text-center">
            <CardTitle className="flex items-center justify-center gap-2">
              <AlertCircle className="h-6 w-6" />
              Akses Ditolak
            </CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-red-100 text-sm">
              {isDriver ? "Anda tidak memiliki retasi aktif" : "Akses terbatas"}
            </p>
            <Button variant="secondary" onClick={() => window.history.back()}>
              Kembali
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-3 pb-44">
      {/* Header - Larger */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-4 rounded-xl mb-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <Truck className="h-7 w-7" />
          <span className="font-bold text-xl">POS Supir</span>
        </div>
        {activeRetasi && isDriver && (
          <Badge variant="secondary" className="text-sm px-3 py-1">
            {activeRetasi.retasi_number}
          </Badge>
        )}
      </div>

      {/* Customer Input - Larger & Easier */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 mb-4 shadow-md">
        <div className="flex items-center justify-between mb-2">
          <Label className="text-base font-semibold text-gray-700 dark:text-gray-200">
            <User className="inline h-5 w-5 mr-2 text-blue-600 dark:text-blue-400" />
            Pelanggan
          </Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 px-3 text-sm font-medium bg-green-50 dark:bg-green-900/30 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/50"
            onClick={() => setIsCustomerAddOpen(true)}
          >
            <UserPlus className="h-4 w-4 mr-1" />
            Tambah Baru
          </Button>
        </div>
        <div className="relative">
          <input
            type="text"
            placeholder="Ketik nama pelanggan..."
            value={customerSearch}
            onChange={(e) => {
              setCustomerSearch(e.target.value)
              setShowCustomerDropdown(true)
              if (!e.target.value) setSelectedCustomer('')
            }}
            onFocus={() => setShowCustomerDropdown(true)}
            onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
            className="w-full h-14 px-4 text-lg border-2 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400"
          />
          {showCustomerDropdown && filteredCustomers.length > 0 && (
            <div className="absolute z-20 w-full mt-1 bg-white dark:bg-gray-800 border-2 dark:border-gray-600 rounded-xl shadow-xl max-h-60 overflow-auto">
              {filteredCustomers.map((customer) => (
                <div
                  key={customer.id}
                  className="px-4 py-3 hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer border-b dark:border-gray-700 last:border-b-0"
                  onClick={() => {
                    setSelectedCustomer(customer.id)
                    setCustomerSearch(customer.name)
                    setShowCustomerDropdown(false)
                  }}
                >
                  <div className="font-semibold text-base text-gray-900 dark:text-white">{customer.name}</div>
                  {customer.address && <div className="text-sm text-gray-500 dark:text-gray-400 truncate">{customer.address}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Customer quick actions - Larger buttons */}
        {selectedCustomerData && (
          <>
            {customerOutstandingReceivable > 0 && (
              <div className="mt-3 rounded-xl border-2 border-orange-200 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-orange-800 dark:text-orange-200">Piutang pelanggan</div>
                    <div className="text-2xl font-bold text-orange-600 dark:text-orange-300">
                      {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(customerOutstandingReceivable)}
                    </div>
                    <div className="mt-1 text-sm text-orange-700 dark:text-orange-300">
                      {customerReceivableCount} tagihan belum lunas{customerNearestDueDate ? ` • JT terdekat ${customerNearestDueDate}` : ''}
                    </div>
                  </div>
                  <Badge variant="outline" className="border-orange-300 bg-white/70 text-orange-700 dark:border-orange-600 dark:bg-orange-950/30 dark:text-orange-300">
                    Ada Piutang
                  </Badge>
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-3 flex-wrap">
              {selectedCustomerData.phone && (
                <Button variant="outline" size="lg" className="text-base h-11 px-4" onClick={() => window.location.href = `tel:${selectedCustomerData.phone}`}>
                  <Phone className="h-5 w-5 mr-2" /> Telepon
                </Button>
              )}
              {selectedCustomerData.latitude && (
                <Button variant="outline" size="lg" className="text-base h-11 px-4" onClick={() => window.open(`https://www.google.com/maps/dir//${selectedCustomerData.latitude},${selectedCustomerData.longitude}`, '_blank')}>
                  <MapPin className="h-5 w-5 mr-2" /> Navigasi
                </Button>
              )}
              {(selectedCustomerData.jumlah_galon_titip || 0) > 0 && (
                <Badge variant="secondary" className="text-base px-3 py-2">🥤 {selectedCustomerData.jumlah_galon_titip} galon titip</Badge>
              )}
            </div>

            {/* Galon Update Section - Phase 2B feature */}
            <div className="mt-3 rounded-xl border-2 border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 p-3">
              <div className="text-base font-semibold text-blue-800 dark:text-blue-200 mb-2">
                🥤 Update Galon Titipan
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm text-green-700 dark:text-green-400">Ditambah (+)</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    value={gallonAdded || ''}
                    onChange={(e) => setGallonAdded(Math.max(0, parseInt(e.target.value) || 0))}
                    placeholder="0"
                    className="h-11 text-base"
                  />
                </div>
                <div>
                  <Label className="text-sm text-red-700 dark:text-red-400">Ditarik (-)</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max={selectedCustomerData.jumlah_galon_titip || 0}
                    value={gallonWithdrawn || ''}
                    onChange={(e) => setGallonWithdrawn(Math.max(0, parseInt(e.target.value) || 0))}
                    placeholder="0"
                    className="h-11 text-base"
                  />
                </div>
              </div>
              {(gallonAdded > 0 || gallonWithdrawn > 0) && (
                <>
                  <Input
                    type="text"
                    value={gallonNotes}
                    onChange={(e) => setGallonNotes(e.target.value)}
                    placeholder="Catatan (opsional)..."
                    className="h-10 text-sm mt-2"
                  />
                  <div className="text-sm text-blue-700 dark:text-blue-300 mt-2 font-medium">
                    Saldo setelah transaksi: <strong>{(selectedCustomerData.jumlah_galon_titip || 0) + gallonAdded - gallonWithdrawn} galon</strong>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Product Grid - Only show when customer is selected */}
      {selectedCustomer ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 mb-4 shadow-md">
          <div className="flex items-center gap-2 mb-3">
            <Package className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            <span className="text-lg font-semibold text-gray-900 dark:text-white">Produk</span>
            <span className="text-sm text-gray-500 dark:text-gray-400">(tap untuk tambah)</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {availableProducts.slice(0, 8).map((product) => {
              const inCart = items.find(i => i.product.id === product.id && !i.isBonus)
              return (
                <button
                  key={product.id}
                  onClick={() => quickAddProduct(product)}
                  className={`p-4 rounded-xl border-2 text-left transition-all active:scale-95 ${inCart
                    ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-400 dark:border-blue-500 shadow-md'
                    : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 hover:border-gray-300'
                    }`}
                >
                  <div className="font-bold text-base truncate text-gray-900 dark:text-white">{product.name}</div>
                  <div className="flex justify-between items-center mt-2">
                    <span className="text-base text-green-600 dark:text-green-400 font-bold">
                      {new Intl.NumberFormat("id-ID").format(product.basePrice || 0)}
                    </span>
                    <span className="text-sm text-gray-500 dark:text-gray-400 font-medium">
                      {product.currentStock} {product.unit}
                    </span>
                  </div>
                  {inCart && (
                    <Badge className="mt-2 text-sm px-2 py-1" variant="default">
                      {inCart.quantity} di keranjang
                    </Badge>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="bg-yellow-50 dark:bg-yellow-900/30 rounded-xl p-6 mb-4 shadow-md border-2 border-yellow-200 dark:border-yellow-700">
          <div className="flex items-center gap-3 text-yellow-800 dark:text-yellow-200">
            <AlertCircle className="h-6 w-6" />
            <span className="text-lg font-semibold">Pilih pelanggan terlebih dahulu</span>
          </div>
          <p className="text-yellow-700 dark:text-yellow-300 mt-2 ml-9">
            Ketik nama pelanggan di kolom di atas untuk melanjutkan
          </p>
        </div>
      )}

      {/* Cart - Larger & Easier */}
      {items.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 mb-4 shadow-md">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              <span className="text-lg font-semibold text-gray-900 dark:text-white">Keranjang ({items.filter(i => !i.isBonus).length})</span>
              {totalBonusQty > 0 && (
                <Badge variant="secondary" className="text-sm bg-green-100 text-green-700 px-2 py-1">
                  <Gift className="h-4 w-4 mr-1" />+{totalBonusQty} bonus
                </Badge>
              )}
            </div>
            <span className="font-bold text-xl text-green-600 dark:text-green-400">
              {new Intl.NumberFormat("id-ID").format(total)}
            </span>
          </div>
          <div className="space-y-3">
            {items.map((item, index) => (
              <div
                key={index}
                className={`flex items-center justify-between rounded-xl p-3 ${item.isBonus ? 'bg-green-50 dark:bg-green-900/30 border-2 border-green-300 dark:border-green-700' : 'bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600'
                  }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {item.isBonus && <Gift className="h-5 w-5 text-green-600 dark:text-green-400" />}
                    <span className={`text-base font-semibold truncate ${item.isBonus ? 'text-green-700 dark:text-green-300' : 'text-gray-900 dark:text-white'}`}>
                      {item.product.name}
                    </span>
                    {item.isBonus && (
                      <Badge variant="outline" className="text-sm bg-green-100 text-green-700 border-green-300">
                        BONUS
                      </Badge>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    {item.isBonus ? (
                      <span className="text-green-600 font-medium">{item.bonusDescription || 'Gratis'}</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{new Intl.NumberFormat("id-ID").format(item.price)} × {item.quantity}</span>
                          {true && ( /* price editing allowed for all roles in mobile view */
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={item.price}
                                onChange={(e) => {
                                  const newPrice = parseInt(e.target.value) || 0
                                  setItems(prev => prev.map((i, idx) =>
                                    idx === index ? { ...i, price: newPrice, isManualPrice: true } : i
                                  ))
                                }}
                                className="w-24 h-7 text-xs px-1 bg-white dark:bg-gray-800"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {item.isBonus ? (
                  <div className="text-base font-bold text-green-600">{item.quantity} {item.unit}</div>
                ) : (
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" className="h-8 w-8 p-0 text-lg font-bold" onClick={() => updateQuantity(index, -1)}>
                      <Minus className="h-4 w-4" />
                    </Button>
                    <Input
                      type="number"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={pendingQuantities[index] ?? item.quantity}
                      onChange={(e) => setQuantityDirect(index, parseInt(e.target.value) || 0)}
                      onFocus={(e) => e.target.select()}
                      className="w-12 h-8 text-center text-base font-bold p-0"
                      min={1}
                      max={item.product.currentStock || 999}
                    />
                    <Button variant="outline" size="sm" className="h-8 w-8 p-0 text-lg font-bold" onClick={() => updateQuantity(index, 1)}>
                      <Plus className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-500" onClick={() => removeItem(index)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payment - Input First Flow */}
      {items.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-md mb-28">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            <span className="text-lg font-semibold text-gray-900 dark:text-white">Pembayaran</span>
          </div>

          {/* Total Display */}
          <div className="bg-blue-50 dark:bg-blue-900/30 rounded-xl p-4 mb-4">
            <div className="flex justify-between items-center">
              <span className="text-lg font-medium text-gray-700 dark:text-gray-300">Total Belanja:</span>
              <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(total)}
              </span>
            </div>
          </div>

          {/* Payment Amount Input - Primary */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-base font-semibold text-gray-700 dark:text-gray-200">Jumlah Bayar</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={paidAmount === total ? "default" : "outline"}
                  size="sm"
                  className="h-8 px-3 text-sm font-semibold"
                  onClick={() => setPaidAmount(total)}
                >
                  Lunas
                </Button>
                <Button
                  type="button"
                  variant={paidAmount === 0 ? "default" : "outline"}
                  size="sm"
                  className="h-8 px-3 text-sm font-semibold"
                  onClick={() => setPaidAmount(0)}
                >
                  Kredit
                </Button>
              </div>
            </div>
            <Input
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              value={paidAmount || ''}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 0
                setPaidAmount(Math.min(val, total))
                // Auto-select payment account when entering amount
                if (val > 0 && !paymentAccount) {
                  const firstAccount = accounts?.find(a => a.isPaymentAccount)
                  if (firstAccount) setPaymentAccount(firstAccount.id)
                }
                if (val === 0) setPaymentAccount('')
              }}
              onFocus={(e) => e.target.select()}
              placeholder="Masukkan jumlah pembayaran..."
              className="h-16 text-2xl font-bold text-center"
            />
            {paidAmount > 0 && paidAmount < total && (
              <div className="text-sm text-orange-600 dark:text-orange-400 mt-1 text-center">
                Sisa piutang: {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(total - paidAmount)}
              </div>
            )}
          </div>

          {/* Payment Account - Highlighted */}
          {paidAmount > 0 && (
            <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/30 rounded-xl border-2 border-blue-400 dark:border-blue-600 ring-2 ring-blue-300 dark:ring-blue-700 ring-offset-2 dark:ring-offset-gray-800">
              <Label className="text-base font-semibold text-blue-800 dark:text-blue-300 mb-2 block">Metode Pembayaran</Label>
              <Select value={paymentAccount} onValueChange={setPaymentAccount}>
                <SelectTrigger className="h-14 text-lg bg-white dark:bg-gray-700 border-2 border-blue-400 dark:border-blue-500 dark:text-white">
                  <SelectValue placeholder="Pilih Kas/Bank" />
                </SelectTrigger>
                <SelectContent>
                  {accounts?.filter(a => {
                    // Must be payment account
                    if (!a.isPaymentAccount) return false;
                    // If account has no employee assigned, show to everyone
                    if (!a.employeeId) return true;
                    // If account is assigned to current user, show it
                    if (a.employeeId === user?.id) return true;
                    // Account is assigned to someone else, hide it
                    return false;
                  }).map((acc) => {
                    const isMyAccount = acc.employeeId === user?.id;
                    return (
                      <SelectItem key={acc.id} value={acc.id} className="text-base py-3">
                        {acc.name} {isMyAccount && <span className="text-green-600 font-medium">(Kas Saya)</span>}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Due Date - Show when there's credit (paidAmount < total) */}
          {paidAmount < total && (
            <Card className="bg-orange-50 dark:bg-orange-900/30 border-2 border-orange-300 dark:border-orange-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                  <span className="text-base font-semibold text-orange-800 dark:text-orange-300">Jatuh Tempo Piutang</span>
                </div>
                {/* Quick select buttons */}
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {[7, 14, 21, 30].map((days) => {
                    const targetDate = getOfficeTime(timezone)
                    targetDate.setDate(targetDate.getDate() + days)
                    const targetDateStr = targetDate.toISOString().split('T')[0]
                    const isActive = dueDate === targetDateStr
                    return (
                      <Button
                        key={days}
                        type="button"
                        variant={isActive ? "default" : "outline"}
                        className={`h-12 text-base font-bold ${isActive ? 'bg-orange-600 hover:bg-orange-700' : ''}`}
                        onClick={() => setDueDate(targetDateStr)}
                      >
                        {days}hr
                      </Button>
                    )
                  })}
                </div>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="h-12 text-base bg-white dark:bg-gray-700 dark:text-white dark:border-gray-600"
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Fixed Submit Button - Raised above bottom menu */}
      {items.length > 0 && (
        <div className="fixed bottom-16 left-0 right-0 p-4 bg-white dark:bg-gray-800 border-t-2 dark:border-gray-700 shadow-2xl z-40">
          <Button
            onClick={handleSubmit}
            className="w-full h-16 text-xl font-bold bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 shadow-lg active:scale-95"
            disabled={isSubmitting || (!selectedCustomer && !customerSearch.trim())}
          >
            <Truck className="h-7 w-7 mr-3" />
            {isSubmitting ? "Memproses..." : `SIMPAN & ANTAR (${new Intl.NumberFormat("id-ID").format(total)})`}
          </Button>
        </div>
      )}

      {/* Piutang Warning Dialog - shows before submitting Kredit transaction
          when customer already has outstanding piutang */}
      <AlertDialog open={piutangWarningOpen} onOpenChange={setPiutangWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-orange-600 dark:text-orange-400">
              ⚠️ Pelanggan Punya Piutang
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                Pelanggan <strong>{selectedCustomerData?.name}</strong> masih memiliki piutang yang belum lunas:
              </span>
              <span className="block bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 rounded-md p-3 mt-2">
                <span className="block text-2xl font-bold text-orange-600 dark:text-orange-300">
                  {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(livePiutangData?.total || 0)}
                </span>
                <span className="block text-sm text-orange-700 dark:text-orange-300 mt-1">
                  {livePiutangData?.count || 0} tagihan belum lunas
                  {livePiutangData?.nearestDue ? ` • JT terdekat: ${format(new Date(livePiutangData.nearestDue), 'dd MMM yyyy', { locale: id })}` : ''}
                </span>
              </span>
              <span className="block mt-3 text-sm">
                Apakah supir tetap mau lanjut buat transaksi <strong>kredit</strong> baru?
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-base h-11">Batal</AlertDialogCancel>
            <AlertDialogAction
              className="text-base h-11 bg-orange-600 hover:bg-orange-700"
              onClick={() => {
                setPiutangWarningOpen(false)
                proceedSubmit()
              }}
            >
              Ya, Lanjut Kredit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialogs */}
      <AddCustomerDialog
        open={isCustomerAddOpen}
        onOpenChange={setIsCustomerAddOpen}
        onCustomerAdded={(newCustomer) => {
          // Auto-select pelanggan baru
          setSelectedCustomer(newCustomer.id)
          setCustomerSearch(newCustomer.name)
          toast({
            title: "Pelanggan Ditambahkan",
            description: `${newCustomer.name} berhasil ditambahkan dan dipilih.`
          })
        }}
      />
      {createdTransaction && (() => {
        const safeTransaction = {
          ...createdTransaction,
          orderDate: createdTransaction.orderDate && !Number.isNaN(new Date(createdTransaction.orderDate).getTime())
            ? new Date(createdTransaction.orderDate)
            : getOfficeTime(timezone),
          dueDate: createdTransaction.dueDate && !Number.isNaN(new Date(createdTransaction.dueDate).getTime())
            ? new Date(createdTransaction.dueDate)
            : null,
        }

        return (
          <>
            <DriverDeliveryDialog
              open={deliveryDialogOpen}
              onOpenChange={setDeliveryDialogOpen}
              transaction={safeTransaction}
              onDeliveryComplete={() => { setDeliveryDialogOpen(false); setPrintDialogOpen(true); }}
              activeRetasi={activeRetasi}
            />
            <DriverPrintDialog
              open={printDialogOpen}
              onOpenChange={setPrintDialogOpen}
              transaction={safeTransaction}
              onComplete={() => {
                setPrintDialogOpen(false)
                setCreatedTransaction(null)
                resetDriverPosForm()
              }}
            />
          </>
        )
      })()}
    </div>
  )
}
