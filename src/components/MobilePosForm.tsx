"use client"
import { useState, useMemo, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PlusCircle, Trash2, Search, UserPlus, Wallet, FileText, Check, ChevronsUpDown, ShoppingCart, Calculator, User as UserIcon, Plus, Minus, Printer, Eye, ArrowRight, X, Edit } from 'lucide-react'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { useToast } from '@/components/ui/use-toast'
import { generateTransactionId } from '@/utils/idGenerator'
import { Textarea } from './ui/textarea'
import { useProducts } from '@/hooks/useProducts'
import { useUsers } from '@/hooks/useUsers'
import { useAccounts } from '@/hooks/useAccounts'
import { useTransactions } from '@/hooks/useTransactions'
import { Product } from '@/types/product'
import { Customer } from '@/types/customer'
import { Transaction, TransactionItem, PaymentStatus } from '@/types/transaction'
import { CustomerSearchDialog } from './CustomerSearchDialog'
import { AddCustomerDialog } from './AddCustomerDialog'
import { PrintReceiptDialog } from './PrintReceiptDialog'
import { DateTimePicker } from './ui/datetime-picker'
import { useAuth } from '@/hooks/useAuth'
import { User } from '@/types/user'
import { useCustomers } from '@/hooks/useCustomers'
import { useSalesEmployees } from '@/hooks/useSalesCommission'
import { PricingService } from '@/services/pricingService'
import { useTimezone } from '@/contexts/TimezoneContext'
import { getOfficeTime } from '@/utils/officeTime'
import { usePermissions, PERMISSIONS } from '@/hooks/usePermissions'

interface FormTransactionItem {
  id: number;
  product: Product | null;
  keterangan: string;
  qty: number;
  harga: number;
  unit: string;
  designFileName?: string;
  isBonus?: boolean;
  bonusDescription?: string;
  isManualPrice?: boolean;
}

export const MobilePosForm = () => {
  const { toast } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const { user: currentUser } = useAuth()
  const { timezone } = useTimezone()
  const { products, isLoading: isLoadingProducts } = useProducts()
  const { users } = useUsers();
  const { accounts, getEmployeeCashAccount } = useAccounts();
  const { addTransaction } = useTransactions();
  const { customers } = useCustomers();
  const { data: salesEmployees } = useSalesEmployees();
  const { hasPermission } = usePermissions();
  const canEditPrice = true; // Default to true for all roles in mobile view as requested

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [selectedSales, setSelectedSales] = useState<string>('none')
  const [orderDate, setOrderDate] = useState<Date | undefined>(() => getOfficeTime(timezone))
  const [finishDate, setFinishDate] = useState<Date | undefined>()
  const [designerId, setDesignerId] = useState<string>('')
  const [operatorId, setOperatorId] = useState<string>('')
  const [paymentAccountId, setPaymentAccountId] = useState<string>('')
  const [items, setItems] = useState<FormTransactionItem[]>([])
  const [diskon, setDiskon] = useState(0)
  const [paidAmount, setPaidAmount] = useState(0)
  const [isCustomerSearchOpen, setIsCustomerSearchOpen] = useState(false)
  const [isCustomerAddOpen, setIsCustomerAddOpen] = useState(false)
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false)
  const [savedTransaction, setSavedTransaction] = useState<Transaction | null>(null)
  const [isSuccessSheetOpen, setIsSuccessSheetOpen] = useState(false)
  const [lastTransactionTotal, setLastTransactionTotal] = useState<number>(0) // Store total before reset
  const [openProductDropdowns, setOpenProductDropdowns] = useState<{ [key: number]: boolean }>({});
  const [isPaymentSheetOpen, setIsPaymentSheetOpen] = useState(false);
  const [isProductSheetOpen, setIsProductSheetOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const productSearchRef = useRef<HTMLInputElement>(null);
  const [editingPriceId, setEditingPriceId] = useState<number | null>(null);

  // Local cache for product pricing to avoid repeated DB calls
  const pricingCacheRef = useRef<Map<string, any>>(new Map());


  const subTotal = useMemo(() => items.reduce((total, item) => total + (item.qty * item.harga), 0), [items]);
  const totalTagihan = useMemo(() => subTotal - diskon, [subTotal, diskon]);
  const sisaTagihan = useMemo(() => totalTagihan - paidAmount, [totalTagihan, paidAmount]);

  const designers = useMemo(() => users?.filter(u => u.role?.toLowerCase() === 'designer'), [users]);
  const operators = useMemo(() => users?.filter(u => u.role?.toLowerCase() === 'operator'), [users]);

  // Filter produk berdasarkan pencarian
  const filteredProducts = useMemo(() => {
    if (!products) return [];
    if (!productSearch) return products;
    return products.filter(p =>
      p.name.toLowerCase().includes(productSearch.toLowerCase())
    );
  }, [products, productSearch]);

  useEffect(() => {
    setPaidAmount(totalTagihan);
  }, [totalTagihan]);

  // Auto-select sales jika user login dengan role sales
  useEffect(() => {
    if (currentUser?.role?.toLowerCase() === 'sales' && currentUser?.id) {
      // Cek apakah user ada di daftar salesEmployees
      const userAsSales = salesEmployees?.find(s => s.id === currentUser.id);
      if (userAsSales) {
        setSelectedSales(currentUser.id);
      }
    }
  }, [currentUser, salesEmployees]);

  // Auto-select akun pembayaran berdasarkan user yang login (supir/driver)
  useEffect(() => {
    if (currentUser?.id && accounts && accounts.length > 0 && !paymentAccountId) {
      const employeeCashAccount = getEmployeeCashAccount(currentUser.id);
      if (employeeCashAccount) {
        setPaymentAccountId(employeeCashAccount.id);
        console.log(`[MobilePOS] Auto-selected cash account "${employeeCashAccount.name}" for user ${currentUser.name}`);
      }
    }
  }, [currentUser?.id, accounts, paymentAccountId, getEmployeeCashAccount]);

  // Auto focus search when product sheet opens
  useEffect(() => {
    if (isProductSheetOpen && productSearchRef.current) {
      setTimeout(() => productSearchRef.current?.focus(), 100);
    }
  }, [isProductSheetOpen]);

  // Handle customer query parameter
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const customerId = params.get('customer');
    if (customerId && customers && !selectedCustomer) {
      const customer = customers.find(c => c.id === customerId);
      if (customer) {
        setSelectedCustomer(customer);
        console.log('[MobilePOS] Auto-selected customer from query:', customer.name);
      }
    }
  }, [location.search, customers, selectedCustomer]);

  const handleAddItem = () => {
    const newItem: FormTransactionItem = {
      id: Date.now(), product: null, keterangan: '', qty: 1, harga: 0, unit: 'pcs'
    };
    setItems([...items, newItem]);
  };

  const handleItemChange = (index: number, field: keyof FormTransactionItem, value: any) => {
    const newItems = [...items];
    (newItems[index] as any)[field] = value;

    if (field === 'product' && value) {
      const selectedProduct = value as Product;
      newItems[index].harga = selectedProduct.basePrice || 0;
      newItems[index].unit = selectedProduct.unit || 'pcs';
    }

    if (field === 'harga') {
      newItems[index].isManualPrice = true;
    }

    setItems(newItems);
  };

  const handleNumberInputChange = (index: number, field: 'qty' | 'harga', e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Allow empty string to enable complete deletion
    if (value === '') {
      handleItemChange(index, field, 0);
    } else {
      const numValue = Number(value);
      if (!isNaN(numValue) && numValue >= 0) {
        handleItemChange(index, field, numValue);
      }
    }
  };

  const handleDiskonChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '') {
      setDiskon(0);
    } else {
      const numValue = Number(value);
      if (!isNaN(numValue) && numValue >= 0) {
        setDiskon(numValue);
      }
    }
  };

  const handlePaidAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '') {
      setPaidAmount(0);
    } else {
      const numValue = Number(value);
      if (!isNaN(numValue) && numValue >= 0) {
        setPaidAmount(numValue);
      }
    }
  };

  const handleRemoveItem = (index: number) => {
    const itemToRemove = items[index];
    if (itemToRemove.isBonus) {
      // Remove only the bonus item
      setItems(items.filter((_, i) => i !== index));
    } else {
      // Remove main item and all its bonus items
      setItems(items.filter(item =>
        !(item.id === itemToRemove.id || (item.isBonus && item.product?.id === itemToRemove.product?.id))
      ));
    }
  };

  // Reset form after successful transaction
  const resetForm = () => {
    setSelectedCustomer(null);
    setSelectedSales('none');
    setItems([]);
    setDiskon(0);
    setPaidAmount(0);
    setPaymentAccountId('');
    setSavedTransaction(null);
  };

  // Handle print thermal (RawBT)
  const handlePrintThermal = () => {
    if (savedTransaction) {
      setIsPrintDialogOpen(true);
    }
  };

  // Handle view detail and navigate
  const handleViewDetail = () => {
    setIsSuccessSheetOpen(false);
    resetForm();
    if (savedTransaction) {
      navigate(`/transactions?highlight=${savedTransaction.id}`);
    } else {
      navigate('/transactions');
    }
  };

  // Handle continue (go to transactions list)
  const handleContinue = () => {
    setIsSuccessSheetOpen(false);
    resetForm();
    navigate('/transactions');
  };

  // Handle new transaction
  const handleNewTransaction = () => {
    setIsSuccessSheetOpen(false);
    resetForm();
  };

  // Helper: Get cached pricing or fetch
  const getCachedPricing = async (productId: string) => {
    const cached = pricingCacheRef.current.get(productId);
    if (cached) {
      console.log('[POS] Using cached pricing for:', productId, cached);
      return cached;
    }

    console.log('[POS] Fetching pricing for:', productId);
    const pricing = await PricingService.getProductPricing(productId);
    console.log('[POS] Fetched pricing:', pricing);
    if (pricing) {
      pricingCacheRef.current.set(productId, pricing);
    }
    return pricing;
  };

  // Update item dengan bonus calculation
  const updateItemWithBonuses = async (existingItem: FormTransactionItem, newQty: number) => {
    if (!existingItem.product) return;

    console.log('[POS] updateItemWithBonuses:', existingItem.product.name, 'newQty:', newQty);

    const productPricing = await getCachedPricing(existingItem.product.id);
    console.log('[POS] Update - bonusPricings:', productPricing?.bonusPricings);

    const calculation = productPricing ? PricingService.calculatePrice(
      existingItem.product.basePrice || 0,
      existingItem.product.currentStock || 0,
      newQty,
      [],
      productPricing.bonusPricings || []
    ) : null;

    console.log('[POS] Update - Calculation result:', calculation);

    // Use functional update to get latest items state
    setItems(prevItems => {
      // Update main item
      let newItems = prevItems.map(item =>
        item.id === existingItem.id
          ? { ...item, qty: newQty, harga: calculation?.finalPrice || item.harga }
          : item
      );

      // Remove existing bonus items for this product
      newItems = newItems.filter(item =>
        !(item.isBonus && item.product?.id === existingItem.product?.id)
      );

      // Add bonus items if any
      if (calculation?.bonuses && calculation.bonuses.length > 0) {
        console.log('[POS] Update - Processing bonuses:', calculation.bonuses);
        for (const bonus of calculation.bonuses) {
          if (bonus.type === 'quantity' && bonus.bonusQuantity > 0) {
            console.log('[POS] Update - Adding bonus item');
            newItems.push({
              id: Date.now() + Math.random(),
              product: existingItem.product,
              keterangan: bonus.description || `Bonus - ${bonus.type}`,
              qty: bonus.bonusQuantity,
              harga: 0,
              unit: existingItem.product!.unit || 'pcs',
              isBonus: true,
              bonusDescription: bonus.description,
            });
          }
        }
      }

      console.log('[POS] Update - Final items count:', newItems.length);
      return newItems;
    });
  };

  // Add new item with bonus calculation
  const addNewItemWithBonuses = async (product: Product, quantity: number) => {
    console.log('[POS] addNewItemWithBonuses:', product.name, 'qty:', quantity);

    const productPricing = await getCachedPricing(product.id);
    console.log('[POS] bonusPricings:', productPricing?.bonusPricings);

    const calculation = productPricing ? PricingService.calculatePrice(
      product.basePrice || 0,
      product.currentStock || 0,
      quantity,
      [],
      productPricing.bonusPricings || []
    ) : null;

    console.log('[POS] Calculation result:', calculation);

    // Use functional update to get latest items state
    setItems(prevItems => {
      const newItems: FormTransactionItem[] = [...prevItems];

      // Add main item
      newItems.push({
        id: Date.now(),
        product: product,
        keterangan: '',
        qty: quantity,
        harga: calculation?.finalPrice || product.basePrice || 0,
        unit: product.unit || 'pcs',
        isBonus: false,
      });

      // Add bonus items if any
      if (calculation?.bonuses && calculation.bonuses.length > 0) {
        console.log('[POS] Processing bonuses:', calculation.bonuses);
        for (const bonus of calculation.bonuses) {
          console.log('[POS] Bonus type check:', bonus.type, 'qty:', bonus.bonusQuantity);
          if (bonus.type === 'quantity' && bonus.bonusQuantity > 0) {
            console.log('[POS] Adding bonus item for:', product.name);
            newItems.push({
              id: Date.now() + Math.random(),
              product: product,
              keterangan: bonus.description || `Bonus - ${bonus.type}`,
              qty: bonus.bonusQuantity,
              harga: 0,
              unit: product.unit || 'pcs',
              isBonus: true,
              bonusDescription: bonus.description,
            });
          }
        }
      }

      console.log('[POS] Final items count:', newItems.length);
      return newItems;
    });
  };

  // Tambah produk ke cart - SINKRON, bonus langsung tampil bersamaan
  const addProductToCart = async (product: Product) => {
    console.log('[POS] addProductToCart:', product.name);

    // PENTING: Fetch pricing DULU sebelum update state, agar bonus langsung tampil
    const productPricing = await getCachedPricing(product.id);
    console.log('[POS] Got pricing, bonusPricings:', productPricing?.bonusPricings);

    // Sekarang update state dengan data lengkap termasuk bonus
    setItems(prevItems => {
      const existing = prevItems.find(item => item.product?.id === product.id && !item.isBonus);

      if (existing) {
        const newQty = existing.qty + 1;
        console.log('[POS] Existing item, updating qty to:', newQty);

        // Calculate price and bonus
        const calculation = productPricing ? PricingService.calculatePrice(
          product.basePrice || 0,
          product.currentStock || 0,
          newQty,
          [],
          productPricing.bonusPricings || []
        ) : null;

        console.log('[POS] Calculation result:', calculation);

        // Update main item qty and price (only update price if not manual)
        let newItems = prevItems.map(item =>
          item.id === existing.id
            ? {
              ...item,
              qty: newQty,
              harga: item.isManualPrice ? item.harga : (calculation?.finalPrice || item.harga)
            }
            : item
        );

        // Remove old bonus items for this product
        newItems = newItems.filter(item =>
          !(item.isBonus && item.product?.id === product.id)
        );

        // Add new bonus items LANGSUNG dalam satu setState
        if (calculation?.bonuses && calculation.bonuses.length > 0) {
          for (const bonus of calculation.bonuses) {
            console.log('[POS] Checking bonus:', bonus.type, 'qty:', bonus.bonusQuantity);
            if (bonus.type === 'quantity' && bonus.bonusQuantity > 0) {
              console.log('[POS] >>> ADDING BONUS ITEM:', bonus.bonusQuantity);
              newItems.push({
                id: Date.now() + Math.random(),
                product: product,
                keterangan: bonus.description || `Bonus`,
                qty: bonus.bonusQuantity,
                harga: 0,
                unit: product.unit || 'pcs',
                isBonus: true,
                bonusDescription: bonus.description,
              });
            }
          }
        }

        console.log('[POS] Final items count:', newItems.length);
        return newItems;
      } else {
        // New item
        console.log('[POS] Adding new item');

        // Calculate price and bonus for qty=1
        const calculation = productPricing ? PricingService.calculatePrice(
          product.basePrice || 0,
          product.currentStock || 0,
          1,
          [],
          productPricing.bonusPricings || []
        ) : null;

        console.log('[POS] New item calculation:', calculation);

        const newItems: FormTransactionItem[] = [...prevItems];

        // Add main item
        newItems.push({
          id: Date.now(),
          product: product,
          keterangan: '',
          qty: 1,
          harga: calculation?.finalPrice || product.basePrice || 0,
          unit: product.unit || 'pcs',
          isBonus: false,
        });

        // Add bonus items LANGSUNG dalam satu setState
        if (calculation?.bonuses && calculation.bonuses.length > 0) {
          for (const bonus of calculation.bonuses) {
            console.log('[POS] New item checking bonus:', bonus.type, 'qty:', bonus.bonusQuantity);
            if (bonus.type === 'quantity' && bonus.bonusQuantity > 0) {
              console.log('[POS] >>> ADDING NEW ITEM BONUS:', bonus.bonusQuantity);
              newItems.push({
                id: Date.now() + Math.random(),
                product: product,
                keterangan: bonus.description || `Bonus`,
                qty: bonus.bonusQuantity,
                harga: 0,
                unit: product.unit || 'pcs',
                isBonus: true,
                bonusDescription: bonus.description,
              });
            }
          }
        }

        console.log('[POS] Final new items count:', newItems.length);
        return newItems;
      }
    });
  };

  // Update qty item (with bonus recalculation) - SINKRON
  const updateItemQty = async (index: number, delta: number) => {
    const item = items[index];
    if (!item || item.isBonus) return;

    const newQty = item.qty + delta;

    if (newQty <= 0) {
      // Remove main item and all its bonus items
      setItems(prevItems => prevItems.filter(i =>
        !(i.id === item.id || (i.isBonus && i.product?.id === item.product?.id))
      ));
      return;
    }

    // Fetch pricing DULU agar bonus langsung tampil
    const productPricing = item.product ? await getCachedPricing(item.product.id) : null;

    setItems(prevItems => {
      // Calculate price and bonus
      const calculation = productPricing ? PricingService.calculatePrice(
        item.product!.basePrice || 0,
        item.product!.currentStock || 0,
        newQty,
        [],
        productPricing.bonusPricings || []
      ) : null;

      // Update main item qty and price (only update price if not manual)
      let newItems = prevItems.map((i, idx) =>
        idx === index
          ? {
            ...i,
            qty: newQty,
            harga: i.isManualPrice ? i.harga : (calculation?.finalPrice || i.harga)
          }
          : i
      );

      // Remove old bonus items for this product
      newItems = newItems.filter(i =>
        !(i.isBonus && i.product?.id === item.product?.id)
      );

      // Add new bonus items LANGSUNG
      if (calculation?.bonuses && calculation.bonuses.length > 0) {
        for (const bonus of calculation.bonuses) {
          if (bonus.type === 'quantity' && bonus.bonusQuantity > 0) {
            newItems.push({
              id: Date.now() + Math.random(),
              product: item.product!,
              keterangan: bonus.description || `Bonus`,
              qty: bonus.bonusQuantity,
              harga: 0,
              unit: item.product!.unit || 'pcs',
              isBonus: true,
              bonusDescription: bonus.description,
            });
          }
        }
      }

      return newItems;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validItems = items.filter(item => item.product && item.qty > 0);

    if (!selectedCustomer || validItems.length === 0 || !currentUser) {
      toast({ variant: "destructive", title: "Validasi Gagal", description: "Harap pilih Pelanggan dan tambahkan minimal satu item produk yang valid." });
      return;
    }

    // Determine payment account - auto-select first if needed
    let finalPaymentAccountId = paymentAccountId;
    if (paidAmount > 0 && !paymentAccountId) {
      const firstAccount = accounts?.find(a => a.isPaymentAccount);
      if (firstAccount) {
        finalPaymentAccountId = firstAccount.id;
      } else {
        toast({ variant: "destructive", title: "Validasi Gagal", description: "Tidak ada akun pembayaran tersedia." });
        return;
      }
    }

    const transactionItems: TransactionItem[] = validItems.map(item => ({
      product: item.product!,
      quantity: item.qty,
      price: item.harga,
      unit: item.unit,
      width: 0,
      height: 0,
      notes: item.isBonus
        ? `${item.keterangan}${item.keterangan ? ' - ' : ''}BONUS: ${item.bonusDescription || 'Bonus Item'}`
        : item.keterangan,
      designFileName: item.designFileName,
      isBonus: item.isBonus || false,
      name: item.isBonus ? `${item.product!.name} (Bonus)` : item.product!.name
    }));

    const paymentStatus: PaymentStatus = sisaTagihan <= 0 ? 'Lunas' : 'Belum Lunas';

    // Generate sequential transaction ID: AQVPOSSUP-DDMM-NNN
    const transactionId = await generateTransactionId('supir');

    const newTransaction: Omit<Transaction, 'createdAt'> = {
      id: transactionId,
      customerId: selectedCustomer.id,
      customerName: selectedCustomer.name,
      cashierId: currentUser.id,
      cashierName: currentUser.name,
      salesId: selectedSales && selectedSales !== 'none' ? selectedSales : null,
      salesName: selectedSales && selectedSales !== 'none' ? salesEmployees?.find(s => s.id === selectedSales)?.name || null : null,
      designerId: designerId || null,
      operatorId: operatorId || null,
      paymentAccountId: finalPaymentAccountId || null,
      orderDate: orderDate || getOfficeTime(timezone),
      finishDate: finishDate || null,
      items: transactionItems,
      total: totalTagihan,
      paidAmount: paidAmount,
      paymentStatus: paymentStatus,
      status: 'Pesanan Masuk',
    };

    addTransaction.mutate({ newTransaction }, {
      onSuccess: (savedData) => {
        // ============================================================================
        // BALANCE UPDATE DIHAPUS - Sekarang dihitung dari journal_entries
        // addTransaction sudah memanggil createSalesJournal yang akan auto-post jurnal
        // ============================================================================

        // Store the total BEFORE reset (use totalTagihan from state, not savedData which may not have it)
        setLastTransactionTotal(totalTagihan);
        setSavedTransaction(savedData);
        toast({ title: "Sukses", description: "Transaksi berhasil disimpan." });

        // Show success sheet with print/view options instead of immediate redirect
        setIsSuccessSheetOpen(true);
      },
      onError: (error) => {
        toast({ variant: "destructive", title: "Gagal Menyimpan", description: error.message });
      }
    });
  };

  return (
    <div className="space-y-4">
      <CustomerSearchDialog open={isCustomerSearchOpen} onOpenChange={setIsCustomerSearchOpen} onCustomerSelect={setSelectedCustomer} />
      <AddCustomerDialog open={isCustomerAddOpen} onOpenChange={setIsCustomerAddOpen} onCustomerAdded={setSelectedCustomer} />
      {savedTransaction && (
        <PrintReceiptDialog
          open={isPrintDialogOpen}
          onOpenChange={setIsPrintDialogOpen}
          transaction={savedTransaction}
          template="receipt"
          onClose={() => {
            // Setelah print dialog ditutup dengan tombol "Selesai", navigasi ke transaksi
            setIsSuccessSheetOpen(false);
            resetForm();
            navigate('/transactions');
          }}
        />
      )}

      {/* Success Sheet - After transaction saved */}
      <Sheet open={isSuccessSheetOpen} onOpenChange={(open) => {
        if (!open) {
          // If closing without selecting action, reset and go to transactions
          handleContinue();
        }
      }}>
        <SheetContent side="bottom" className="h-auto">
          <SheetHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <Check className="h-8 w-8 text-green-600" />
            </div>
            <SheetTitle className="text-xl">Transaksi Berhasil!</SheetTitle>
            <SheetDescription>
              {savedTransaction && (
                <div className="space-y-1">
                  <p className="font-semibold text-2xl text-green-600">
                    Rp {new Intl.NumberFormat("id-ID").format(lastTransactionTotal || savedTransaction.total || 0)}
                  </p>
                  <p className="text-sm font-medium">{savedTransaction.customerName}</p>
                  <p className="text-xs text-muted-foreground">No: {savedTransaction.id}</p>
                </div>
              )}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-3 pb-6">
            {/* Print Thermal (RawBT) Button */}
            <Button
              onClick={handlePrintThermal}
              className="w-full h-14 text-lg bg-blue-600 hover:bg-blue-700"
            >
              <Printer className="mr-2 h-5 w-5" />
              Cetak Struk (RawBT)
            </Button>

            {/* View Detail Button */}
            <Button
              onClick={handleViewDetail}
              variant="outline"
              className="w-full h-12"
            >
              <Eye className="mr-2 h-5 w-5" />
              Lihat Detail Transaksi
            </Button>

            {/* New Transaction Button */}
            <Button
              onClick={handleNewTransaction}
              variant="outline"
              className="w-full h-12 border-green-300 text-green-700 hover:bg-green-50"
            >
              <Plus className="mr-2 h-5 w-5" />
              Transaksi Baru
            </Button>

            {/* Go to Transactions Button */}
            <Button
              onClick={handleContinue}
              variant="ghost"
              className="w-full h-10 text-muted-foreground"
            >
              <ArrowRight className="mr-2 h-4 w-4" />
              Ke Daftar Transaksi
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Header */}
      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 dark:text-white">
            <ShoppingCart className="h-5 w-5" />
            Point of Sale
          </CardTitle>
        </CardHeader>
      </Card>

      {/* Customer Selection - Compact for mobile */}
      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-base dark:text-white">Pelanggan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 px-3 pb-3">
          <div className="p-2 bg-muted dark:bg-gray-700 rounded-lg">
            <p className="font-semibold text-sm dark:text-white">
              {selectedCustomer?.name || 'Belum dipilih'}
            </p>
            {selectedCustomer && (
              <>
                <p className="text-xs text-muted-foreground dark:text-gray-400 mt-0.5 truncate">
                  {selectedCustomer.address}
                </p>
                <p className="text-xs text-muted-foreground dark:text-gray-400">
                  📞 {selectedCustomer.phone}
                </p>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => setIsCustomerSearchOpen(true)}
              size="sm"
              className="flex-1 bg-yellow-400 hover:bg-yellow-500 text-black h-9"
            >
              <Search className="mr-1 h-3.5 w-3.5" /> Cari
            </Button>
            <Button
              onClick={() => setIsCustomerAddOpen(true)}
              size="sm"
              className="flex-1 h-9"
            >
              <UserPlus className="mr-1 h-3.5 w-3.5" /> Baru
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Sales Selection */}
      <Card className="border-green-200 dark:border-green-700 bg-green-50 dark:bg-green-900/30">
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-base flex items-center gap-2 dark:text-white">
            <UserIcon className="h-4 w-4 text-green-600 dark:text-green-400" />
            Sales
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3">
          <Select value={selectedSales} onValueChange={setSelectedSales}>
            <SelectTrigger className="bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white h-9">
              <SelectValue placeholder="Pilih Sales (Opsional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                <span className="text-gray-500 dark:text-gray-400">Tanpa Sales</span>
              </SelectItem>
              {salesEmployees?.map((sales) => (
                <SelectItem key={sales.id} value={sales.id}>
                  <div className="flex items-center gap-2">
                    <UserIcon className="h-4 w-4" />
                    <span>{sales.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedSales && selectedSales !== 'none' && (
            <p className="text-xs text-green-700 dark:text-green-300 mt-1.5">
              ✓ Sales: {salesEmployees?.find(s => s.id === selectedSales)?.name}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Items Management */}
      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <CardHeader className="pb-2 pt-3 px-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base dark:text-white">Item ({items.filter(i => !i.isBonus).length})</CardTitle>
              {items.filter(i => i.isBonus).length > 0 && (
                <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400 px-2 py-0.5 rounded-full">
                  +{items.filter(i => i.isBonus).reduce((sum, i) => sum + i.qty, 0)} Bonus
                </span>
              )}
            </div>
            <div className="flex gap-2">
              {/* Tombol Tambah Produk Cepat */}
              <Sheet open={isProductSheetOpen} onOpenChange={setIsProductSheetOpen}>
                <SheetTrigger asChild>
                  <Button size="sm" className="bg-green-600 hover:bg-green-700">
                    <Plus className="mr-1 h-4 w-4" /> Tambah
                  </Button>
                </SheetTrigger>
                <SheetContent side="bottom" className="h-[85vh] dark:bg-gray-900">
                  <SheetHeader>
                    <SheetTitle className="dark:text-white">Pilih Produk</SheetTitle>
                    <SheetDescription className="dark:text-gray-400">
                      Ketuk produk untuk menambahkan ke keranjang
                    </SheetDescription>
                  </SheetHeader>
                  <div className="mt-4 space-y-4">
                    {/* Search Input */}
                    <Input
                      ref={productSearchRef}
                      placeholder="🔍 Cari produk..."
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      className="text-lg py-6 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                    />
                    {/* Product Grid */}
                    <div className="grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto pb-4">
                      {filteredProducts.map((product) => {
                        const inCart = items.find(item => item.product?.id === product.id);
                        return (
                          <div
                            key={product.id}
                            onClick={() => {
                              addProductToCart(product);
                              // Tidak tutup sheet agar bisa tambah banyak produk
                            }}
                            onTouchEnd={(e) => {
                              e.preventDefault();
                              addProductToCart(product);
                            }}
                            className={cn(
                              "p-3 rounded-lg border-2 cursor-pointer transition-all active:scale-95 select-none touch-manipulation",
                              inCart
                                ? "border-green-500 bg-green-50 dark:bg-green-900/30 dark:border-green-600"
                                : "border-gray-200 bg-white dark:bg-gray-800 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-500"
                            )}
                          >
                            <p className="font-semibold text-sm truncate dark:text-white">{product.name}</p>
                            <p className="text-green-600 dark:text-green-400 font-bold mt-1">
                              {new Intl.NumberFormat("id-ID").format(product.basePrice || 0)}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">/{product.unit}</p>
                            {inCart && (
                              <div className="mt-2 flex items-center justify-center bg-green-600 dark:bg-green-700 text-white rounded-full px-2 py-1 text-xs">
                                ✓ {inCart.qty} di keranjang
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* Tombol Selesai */}
                    <Button
                      className="w-full h-12 text-lg"
                      onClick={() => {
                        setIsProductSheetOpen(false);
                        setProductSearch('');
                      }}
                    >
                      Selesai ({items.length} item)
                    </Button>
                  </div>
                </SheetContent>
              </Sheet>

            </div>
          </div>
        </CardHeader>
        <CardContent className="px-3 pb-3">
          {items.length > 0 ? (
            <div className="space-y-2">
              {items.map((item, index) => (
                <div key={item.id} className={cn(
                  "flex items-center gap-2 p-2 rounded",
                  item.isBonus ? "bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700" : "bg-muted dark:bg-gray-700"
                )}>
                  {/* Qty Controls - disabled for bonus items */}
                  <div className="flex items-center gap-1">
                    {item.isBonus ? (
                      // Bonus: hanya tampilkan qty tanpa kontrol edit
                      <div className="w-14 h-8 flex items-center justify-center bg-green-200 dark:bg-green-800 rounded text-green-700 dark:text-green-300 font-bold text-sm">
                        {item.qty}
                      </div>
                    ) : (
                      // Non-bonus: tampilkan kontrol edit qty
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => updateItemQty(index, -1)}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <Input
                          type="number"
                          value={item.qty || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '') {
                              handleItemChange(index, 'qty', 0);
                            } else {
                              const num = parseInt(val);
                              if (!isNaN(num) && num >= 0) {
                                handleItemChange(index, 'qty', num);
                              }
                            }
                          }}
                          onFocus={(e) => e.target.select()}
                          className="w-14 h-8 text-center font-bold p-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          min="0"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => updateItemQty(index, 1)}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                  {/* Product Info */}
                  <div className="flex-1 min-w-0">
                    {item.isBonus ? (
                      <>
                        <p className="font-medium text-sm truncate text-green-700 dark:text-green-300">
                          🎁 {item.product?.name} (Bonus)
                        </p>
                        {item.bonusDescription && (
                          <p className="text-xs text-green-600 dark:text-green-400">{item.bonusDescription}</p>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="font-medium text-sm truncate dark:text-white">{item.product?.name || 'Produk'}</p>
                        <div className="flex items-center gap-1.5">
                          {editingPriceId === item.id ? (
                            <div className="flex items-center gap-1 mt-1">
                              <span className="text-xs text-muted-foreground">Rp</span>
                              <Input
                                type="number"
                                value={item.harga}
                                onChange={(e) => handleItemChange(index, 'harga', parseInt(e.target.value) || 0)}
                                className="h-7 w-24 text-xs p-1"
                                onBlur={() => setEditingPriceId(null)}
                                autoFocus
                              />
                            </div>
                          ) : (
                            <div
                              className={cn(
                                "flex items-center gap-1 mt-0.5",
                                canEditPrice && "cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/30 px-1 rounded transition-colors"
                              )}
                              onClick={() => canEditPrice && setEditingPriceId(item.id)}
                            >
                              <p className="text-xs text-muted-foreground dark:text-gray-400">
                                @ {new Intl.NumberFormat("id-ID").format(item.harga)}
                              </p>
                              {canEditPrice && <Edit className="h-3 w-3 text-blue-500" />}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  {/* Total */}
                  {item.isBonus ? (
                    <span className="text-sm font-medium text-green-600 dark:text-green-400">GRATIS</span>
                  ) : (
                    <p className="font-bold text-green-600 dark:text-green-400">
                      {new Intl.NumberFormat("id-ID").format(item.qty * item.harga)}
                    </p>
                  )}
                  {/* Delete Button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-100 dark:hover:bg-red-900/30"
                    onClick={() => handleRemoveItem(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div
              className="text-center py-4 text-muted-foreground dark:text-gray-400 cursor-pointer hover:bg-muted dark:hover:bg-gray-700 rounded-lg transition-colors"
              onClick={() => setIsProductSheetOpen(true)}
            >
              <Plus className="mx-auto h-8 w-8 mb-2 text-green-600 dark:text-green-400" />
              <p className="font-medium text-sm">Ketuk untuk tambah produk</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment - Input First Flow (seperti Driver POS) */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-md">
        <div className="flex items-center gap-2 mb-4">
          <Wallet className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          <span className="text-base font-semibold text-gray-900 dark:text-white">Pembayaran</span>
        </div>

        {/* Total Display */}
        <div className="bg-blue-50 dark:bg-blue-900/30 rounded-xl p-3 mb-4">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Total Belanja:</span>
            <span className="text-xl font-bold text-blue-600 dark:text-blue-400">
              {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(totalTagihan)}
            </span>
          </div>
          {/* Bonus Display */}
          {(() => {
            const bonusItems = items.filter(item => item.isBonus);
            const totalBonusQty = bonusItems.reduce((sum, item) => sum + item.qty, 0);
            if (totalBonusQty > 0) {
              return (
                <div className="flex justify-between items-center mt-2 pt-2 border-t border-blue-200 dark:border-blue-700">
                  <span className="text-sm font-medium text-green-600 dark:text-green-400">🎁 Bonus:</span>
                  <span className="text-sm font-bold text-green-600 dark:text-green-400">
                    {totalBonusQty} {bonusItems.length === 1 ? bonusItems[0].unit : 'item'} GRATIS
                  </span>
                </div>
              );
            }
            return null;
          })()}
        </div>

        {/* Payment Amount Input - Primary */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-sm font-semibold text-gray-700 dark:text-gray-200">Jumlah Bayar</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={paidAmount === totalTagihan ? "default" : "outline"}
                size="sm"
                className="h-8 px-3 text-xs font-semibold"
                onClick={() => setPaidAmount(totalTagihan)}
              >
                Lunas
              </Button>
              <Button
                type="button"
                variant={paidAmount === 0 ? "default" : "outline"}
                size="sm"
                className="h-8 px-3 text-xs font-semibold"
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
              setPaidAmount(Math.min(val, totalTagihan))
              // Auto-select payment account when entering amount
              if (val > 0 && !paymentAccountId) {
                const firstAccount = accounts?.find(a => a.isPaymentAccount)
                if (firstAccount) setPaymentAccountId(firstAccount.id)
              }
              if (val === 0) setPaymentAccountId('')
            }}
            onFocus={(e) => e.target.select()}
            placeholder="Masukkan jumlah pembayaran..."
            className="h-14 text-xl font-bold text-center dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          />
          {paidAmount > 0 && paidAmount < totalTagihan && (
            <div className="text-sm text-orange-600 dark:text-orange-400 mt-1 text-center">
              Sisa piutang: {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(sisaTagihan)}
            </div>
          )}
        </div>

        {/* Payment Account - Highlighted (only show when paidAmount > 0) */}
        {paidAmount > 0 && (
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/30 rounded-xl border-2 border-blue-400 dark:border-blue-600">
            <Label className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-2 block">Metode Pembayaran</Label>
            <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
              <SelectTrigger className="h-12 text-base bg-white dark:bg-gray-700 border-2 border-blue-400 dark:border-blue-500 dark:text-white">
                <SelectValue placeholder="Pilih Kas/Bank" />
              </SelectTrigger>
              <SelectContent>
                {accounts?.filter(a => a.isPaymentAccount).map((acc) => (
                  <SelectItem key={acc.id} value={acc.id} className="text-base py-2">
                    {acc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Status Pembayaran */}
        {paidAmount === totalTagihan && totalTagihan > 0 && (
          <div className="text-center py-2 bg-green-100 dark:bg-green-900/30 rounded-lg text-green-700 dark:text-green-300 font-medium text-sm">
            ✓ Pembayaran Lunas
          </div>
        )}
        {paidAmount === 0 && totalTagihan > 0 && (
          <div className="text-center py-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg text-orange-700 dark:text-orange-300 font-medium text-sm">
            📝 Transaksi Kredit (Belum Bayar)
          </div>
        )}
      </div>

      {/* Submit Button */}
      <Button
        onClick={handleSubmit}
        size="lg"
        className="w-full h-12 text-base"
        disabled={addTransaction.isPending || !selectedCustomer || items.length === 0}
      >
        {addTransaction.isPending ? "Menyimpan..." : "Simpan Transaksi"}
      </Button>
    </div>
  )
}