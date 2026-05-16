"use client"
import { useState, useMemo, useEffect, useRef } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumberInput } from '@/components/ui/number-input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PlusCircle, Trash2, Search, UserPlus, Wallet, FileText, Check, ChevronsUpDown, Percent, AlertTriangle, Plus, ChevronDown, User as UserIcon, Phone, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { useToast } from '@/components/ui/use-toast'
import { Switch } from '@/components/ui/switch'
import { calculatePPN, calculatePPNWithMode, getDefaultPPNPercentage } from '@/utils/ppnCalculations'
import { generateTransactionId } from '@/utils/idGenerator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Textarea } from './ui/textarea'
import { useProducts } from '@/hooks/useProducts'
import { useMaterials } from '@/hooks/useMaterials'
import { useUsers } from '@/hooks/useUsers'
import { useAccounts } from '@/hooks/useAccounts'
import { useTransactions } from '@/hooks/useTransactions'
import { useQueryClient } from '@tanstack/react-query'
import { Product } from '@/types/product'
import { Customer } from '@/types/customer'
import { Transaction, TransactionItem, PaymentStatus } from '@/types/transaction'
import { CustomerSearchDialog } from './CustomerSearchDialog'
import { AddCustomerDialog } from './AddCustomerDialog'
import { PrintReceiptDialog } from './PrintReceiptDialog'
import { DateTimePicker } from './ui/datetime-picker'
import { useAuth } from '@/hooks/useAuth'
import { useGranularPermission } from '@/hooks/useGranularPermission'
import { User } from '@/types/user'
import { useCustomers } from '@/hooks/useCustomers'
import { useRetasi } from '@/hooks/useRetasi'
import { supabase } from '@/integrations/supabase/client'
import { useSalesEmployees } from '@/hooks/useSalesCommission'
import { useProductPricing, usePriceCalculation } from '@/hooks/usePricing'
import { PricingService } from '@/services/pricingService'
import { Link } from 'react-router-dom'
import { quotationService, Quotation } from '@/services/quotationService'
import { useTimezone } from '@/contexts/TimezoneContext'
import { getOfficeTime, getOfficeDateString } from '@/utils/officeTime'

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
  parentItemId?: number;
}

export const PosForm = () => {
  const { toast } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { user: currentUser } = useAuth()
  const { hasGranularPermission } = useGranularPermission()
  const { timezone } = useTimezone()
  const queryClient = useQueryClient()
  const { products, isLoading: isLoadingProducts } = useProducts()
  const { materials } = useMaterials()

  // Check if user can sell materials
  const canSellMaterials = hasGranularPermission('material_sales')
  const { users } = useUsers();
  const { accounts } = useAccounts();
  const { addTransaction } = useTransactions();
  const { data: salesEmployees } = useSalesEmployees();
  const { customers } = useCustomers();
  const { checkDriverAvailability } = useRetasi();

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)
  const [selectedSales, setSelectedSales] = useState<string>('none')
  const [orderDate, setOrderDate] = useState<Date | undefined>(() => getOfficeTime(timezone))
  const [dueDate, setDueDate] = useState(() => {
    const date = getOfficeTime(timezone);
    date.setDate(date.getDate() + 7);
    return date.toISOString().split('T')[0];
  });
  const [paymentAccountId, setPaymentAccountId] = useState<string>('')
  const [items, setItems] = useState<FormTransactionItem[]>([])
  const [diskon, setDiskon] = useState(0)
  const [paidAmount, setPaidAmount] = useState(0)
  const [ppnEnabled, setPpnEnabled] = useState(false)
  const [ppnMode, setPpnMode] = useState<'include' | 'exclude'>('include') // PPN include or exclude
  const [ppnPercentage, setPpnPercentage] = useState(getDefaultPPNPercentage())
  const [isCustomerSearchOpen, setIsCustomerSearchOpen] = useState(false)
  const [isCustomerAddOpen, setIsCustomerAddOpen] = useState(false)
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false)
  const [savedTransaction, setSavedTransaction] = useState<Transaction | null>(null)
  const [openProductDropdowns, setOpenProductDropdowns] = useState<{ [key: number]: boolean }>({});
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [showPaymentDetails, setShowPaymentDetails] = useState(false);
  const [showTaxSettings, setShowTaxSettings] = useState(false);
  const [retasiBlocked, setRetasiBlocked] = useState(false);
  const [retasiMessage, setRetasiMessage] = useState('');
  const [isOfficeSale, setIsOfficeSale] = useState(false);
  const [transactionNotes, setTransactionNotes] = useState('');
  const [loadingPrices, setLoadingPrices] = useState<{ [key: number]: boolean }>({});
  const [sourceQuotation, setSourceQuotation] = useState<Quotation | null>(null);
  const productSearchInputRef = useRef<HTMLInputElement>(null);

  // Force autofocus on Product Search when Tambah Item is opened
  useEffect(() => {
    if (showProductDropdown && productSearchInputRef.current) {
      setTimeout(() => productSearchInputRef.current?.focus(), 50);
    }
  }, [showProductDropdown]);
  const debounceTimers = useRef<Record<number, NodeJS.Timeout>>({});
  // Cache for product pricing data to avoid repeated fetches
  const pricingCache = useRef<Record<string, { bonusPricings: any[], stockPricings: any[], fetchedAt: number }>>({});

  // Load quotation data if fromQuotation param is present
  useEffect(() => {
    const quotationId = searchParams.get('fromQuotation');
    if (quotationId && products && customers) {
      loadQuotationData(quotationId);
    }

    const customerIdFromQuery = searchParams.get('customer');
    if (customerIdFromQuery && customers && !selectedCustomer) {
      const customer = customers.find(c => c.id === customerIdFromQuery);
      if (customer) {
        setSelectedCustomer(customer);
        setCustomerSearch(customer.name);
        console.log('[PosForm] Auto-selected customer from query:', customer.name);
      }
    }
  }, [searchParams, products, customers, selectedCustomer]);

  const loadQuotationData = async (quotationId: string) => {
    try {
      const quotation = await quotationService.getQuotationById(quotationId);
      if (!quotation) {
        toast({ variant: 'destructive', title: 'Error', description: 'Penawaran tidak ditemukan' });
        return;
      }

      setSourceQuotation(quotation);

      // Set customer
      const customer = customers?.find(c => c.id === quotation.customer_id);
      if (customer) {
        setSelectedCustomer(customer);
      }

      // Set notes
      if (quotation.notes) {
        setTransactionNotes(`Dari Penawaran: ${quotation.quotation_number || quotation.id}\n${quotation.notes}`);
      } else {
        setTransactionNotes(`Dari Penawaran: ${quotation.quotation_number || quotation.id}`);
      }

      // Set items from quotation
      if (quotation.items && quotation.items.length > 0) {
        const formItems: FormTransactionItem[] = quotation.items.map((item, index) => {
          // Find product in products list
          let product = products?.find(p => p.id === item.product_id);

          // If product not found by ID, create a placeholder product from quotation data
          // This ensures the item is still displayed with correct name and price
          if (!product && item.product_name) {
            product = {
              id: item.product_id || `quotation-item-${index}`,
              name: item.product_name,
              type: (item.product_type as any) || 'Jasa',
              basePrice: item.unit_price,
              costPrice: 0,
              unit: item.unit || 'pcs',
              initialStock: 0,
              currentStock: 0,
              minStock: 0,
              minOrder: 1,
              description: '',
              specifications: [],
              materials: [],
              createdAt: new Date(),
              updatedAt: new Date(),
            } as Product;
          }

          return {
            id: index + 1,
            product: product || null,
            keterangan: item.notes || '',
            qty: item.quantity,
            harga: item.unit_price,
            unit: item.unit || 'pcs',
          };
        });
        setItems(formItems);
      }

      toast({ title: 'Berhasil', description: 'Data penawaran berhasil dimuat' });
    } catch (err) {
      console.error('Error loading quotation:', err);
      toast({ variant: 'destructive', title: 'Error', description: 'Gagal memuat data penawaran' });
    }
  };


  const subTotal = useMemo(() => items.reduce((total, item) => total + (item.qty * item.harga), 0), [items]);
  const subtotalAfterDiskon = useMemo(() => subTotal - diskon, [subTotal, diskon]);
  const ppnCalculation = useMemo(() => {
    if (ppnEnabled) {
      return calculatePPNWithMode(subtotalAfterDiskon, ppnPercentage, ppnMode);
    }
    return { subtotal: subtotalAfterDiskon, ppnAmount: 0, total: subtotalAfterDiskon };
  }, [subtotalAfterDiskon, ppnEnabled, ppnPercentage, ppnMode]);
  const totalTagihan = useMemo(() => ppnCalculation.total, [ppnCalculation]);
  const sisaTagihan = useMemo(() => totalTagihan - paidAmount, [totalTagihan, paidAmount]);

  // Helper function to create sample pricing rules for testing (tiered system)
  const createSamplePricingRules = async (productId: string, basePrice: number) => {
    try {
      // Create bonus rules
      const bonusRules = [
        {
          minQuantity: 100,
          bonusValue: 1,
          description: 'Beli 100+ gratis 1'
        },
        {
          minQuantity: 500,
          bonusValue: 25,
          description: 'Beli 500+ gratis 25'
        },
        {
          minQuantity: 1000,
          bonusValue: 75,
          description: 'Beli 1000+ gratis 75'
        }
      ];

      for (const rule of bonusRules) {
        await PricingService.createBonusPricing({
          productId: productId,
          minQuantity: rule.minQuantity,
          maxQuantity: null, // No upper limit
          bonusQuantity: rule.bonusValue,
          bonusType: 'quantity',
          bonusValue: rule.bonusValue,
          description: rule.description
        });
      }

      // Create stock-based pricing rules (different prices based on stock levels)
      const stockPricingRules = [
        {
          minStock: 0,
          maxStock: 50,
          price: basePrice * 1.2, // Higher price when stock is low
          description: 'Harga tinggi (stok rendah)'
        },
        {
          minStock: 51,
          maxStock: 200,
          price: basePrice, // Normal price
          description: 'Harga normal'
        },
        {
          minStock: 201,
          maxStock: null, // No upper limit
          price: basePrice * 0.9, // Lower price when stock is high
          description: 'Harga diskon (stok tinggi)'
        }
      ];

      for (const rule of stockPricingRules) {
        await PricingService.createStockPricing({
          productId: productId,
          minStock: rule.minStock,
          maxStock: rule.maxStock,
          price: rule.price
        });
      }

      console.log('✅ Created tiered pricing rules (bonus + stock) for product:', productId);
    } catch (error) {
      console.error('❌ Failed to create sample pricing rules:', error);
    }
  };

  // Function to get cached pricing data for a product
  // isMaterial parameter indicates if this is a material (not a product)
  const getCachedPricing = async (productId: string, basePrice: number, isMaterial: boolean = false) => {
    const CACHE_DURATION = 60000; // 1 minute cache
    const cached = pricingCache.current[productId];
    const now = Date.now();

    // Return cached data if valid
    if (cached && (now - cached.fetchedAt) < CACHE_DURATION) {
      return cached;
    }

    // Fetch fresh data
    let productPricing = await PricingService.getProductPricing(productId);

    // If no pricing data exists, create sample pricing rules (for testing)
    // SKIP for materials - pricing rules only work with products table (foreign key constraint)
    if (!isMaterial && (!productPricing || (productPricing.bonusPricings.length === 0 && productPricing.stockPricings.length === 0))) {
      console.log('🎯 No pricing rules found, creating sample rules...');
      await createSamplePricingRules(productId, basePrice);
      productPricing = await PricingService.getProductPricing(productId);
    }

    const cacheData = {
      bonusPricings: productPricing?.bonusPricings || [],
      stockPricings: productPricing?.stockPricings || [],
      fetchedAt: now
    };
    pricingCache.current[productId] = cacheData;
    return cacheData;
  };

  // Function to calculate dynamic pricing for a product (uses cache)
  const calculateDynamicPrice = async (product: Product, quantity: number, skipFetch: boolean = false) => {
    try {
      // Untuk material, gunakan _materialId (UUID asli) bukan product.id yang ada prefix "material-"
      const productExt = product as Product & { _isMaterial?: boolean; _materialId?: string };
      const actualProductId = productExt._isMaterial && productExt._materialId
        ? productExt._materialId
        : product.id;

      // If skipFetch, use cached data only (for qty changes) - no logging
      if (skipFetch) {
        const cached = pricingCache.current[actualProductId];
        if (cached) {
          const priceCalculation = PricingService.calculatePrice(
            product.basePrice || 0,
            product.currentStock || 0,
            quantity,
            [], // Ignore stock pricing
            cached.bonusPricings || []
          );
          return { price: priceCalculation.finalPrice, calculation: priceCalculation };
        }
        // If no cache, fall through to fetch
      }

      console.log('🔄 Fetching pricing for product:', product.name);
      const isMaterial = productExt._isMaterial || false;
      const cachedPricing = await getCachedPricing(actualProductId, product.basePrice, isMaterial);

      // Calculate price based on QUANTITY purchased, NOT stock level
      const priceCalculation = PricingService.calculatePrice(
        product.basePrice || 0,
        product.currentStock || 0,
        quantity,
        [], // Ignore stock pricing - we only want quantity-based pricing
        cachedPricing?.bonusPricings || []
      )
      return {
        // Use finalPrice which includes quantity-based discounts
        price: priceCalculation.finalPrice,
        calculation: priceCalculation
      }
    } catch (error) {
      console.error('❌ Error calculating dynamic price:', error)
    }
    return { price: product.basePrice, calculation: null }
  }


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

  // Auto-focus product search input when dropdown opens
  useEffect(() => {
    if (showProductDropdown && productSearchInputRef.current) {
      setTimeout(() => {
        productSearchInputRef.current?.focus();
      }, 100);
    }
  }, [showProductDropdown]);

  // Cleanup debounce timers on unmount
  useEffect(() => {
    return () => {
      Object.values(debounceTimers.current).forEach(timer => clearTimeout(timer));
    };
  }, []);

  // Check retasi validation for drivers
  useEffect(() => {
    const checkRetasiValidation = async () => {
      if (currentUser?.role?.toLowerCase() === 'supir' && currentUser?.name) {
        try {
          // checkDriverAvailability returns TRUE if driver is AVAILABLE (no active retasi)
          // We need to check if driver has active retasi to access POS
          const isAvailable = await checkDriverAvailability(currentUser.name);
          console.log('[PosForm] Driver availability check:', currentUser.name, '| isAvailable:', isAvailable);

          if (!isAvailable) {
            // Driver has unreturned retasi (not available for new retasi), can access POS
            setRetasiBlocked(false);
            setRetasiMessage('');
          } else {
            // Driver has no active retasi (available for new retasi), blocked from POS
            setRetasiBlocked(true);
            setRetasiMessage('Anda tidak dapat mengakses POS. Silakan buat retasi "Armada Berangkat" terlebih dahulu.');
          }
        } catch (error) {
          console.error('Error checking retasi validation:', error);
          // Block access if check fails for drivers
          setRetasiBlocked(true);
          setRetasiMessage('Gagal memvalidasi retasi. Silakan buat retasi terlebih dahulu.');
        }
      } else {
        setRetasiBlocked(false);
        setRetasiMessage('');
      }
    };

    if (currentUser) {
      checkRetasiValidation();
    }
  }, [currentUser, checkDriverAvailability]);

  // Auto-set Laku Kantor for specific customers
  useEffect(() => {
    const name = (selectedCustomer?.name || customerSearch || '').toLowerCase();
    // Check if name indicates factory/office sale
    if (name.includes('laku pabrik') || name.includes('laku kantor')) {
      if (!isOfficeSale) {
        setIsOfficeSale(true);
        toast({
          title: "Mode Laku Kantor Aktif",
          description: "Transaksi ini otomatis ditandai sebagai Laku Kantor (Tanpa Pengantaran).",
        });
      }
    }
  }, [selectedCustomer, customerSearch]);

  const handleAddItem = () => {
    const newItem: FormTransactionItem = {
      id: Date.now(), product: null, keterangan: '', qty: 1, harga: 0, unit: 'pcs'
    };
    setItems([...items, newItem]);
  };

  const handleItemChange = async (index: number, field: keyof FormTransactionItem, value: any) => {
    const targetItem = items[index];
    const newItems = [...items];
    (newItems[index] as any)[field] = value;

    if (field === 'product' && value) {
      const selectedProduct = value as Product;
      setLoadingPrices(prev => ({ ...prev, [newItems[index].id]: true }));
      const { price } = await calculateDynamicPrice(selectedProduct, newItems[index].qty);
      newItems[index].harga = price;
      newItems[index].unit = selectedProduct.unit || 'pcs';
      setLoadingPrices(prev => ({ ...prev, [newItems[index].id]: false }));
    }

    if (field === 'qty' && newItems[index].product && !newItems[index].isBonus) {
      const itemId = newItems[index].id;
      const itemToUpdate = { ...newItems[index], qty: value };
      const isMaterial = (newItems[index].product as any)?._isMaterial === true;

      // Update qty secara lokal dulu (UI responsif)
      newItems[index].qty = value;
      setItems(newItems);

      // For materials: don't recalculate price, just update qty
      // Materials allow custom pricing, so we preserve user's input
      if (isMaterial) {
        return;
      }

      // Clear timer sebelumnya jika ada
      if (debounceTimers.current[itemId]) {
        clearTimeout(debounceTimers.current[itemId]);
      }

      // Set timer baru untuk calculate price setelah delay (500ms)
      debounceTimers.current[itemId] = setTimeout(async () => {
        setLoadingPrices(prev => ({ ...prev, [itemId]: true }));
        // Gunakan itemToUpdate yang sudah di-capture dengan qty baru
        if (itemToUpdate.product) {
          await updateItemWithBonuses(itemToUpdate, value);
        }
        setLoadingPrices(prev => ({ ...prev, [itemId]: false }));
        delete debounceTimers.current[itemId];
      }, 500);

      return;
    }

    if (field === 'qty' && newItems[index].isBonus) {
      // Allow manual bonus quantity adjustment
      newItems[index].qty = value;
    }

    setItems(newItems);
  };

  const handleRemoveItem = (index: number) => {
    const itemToRemove = items[index];
    if (itemToRemove.isBonus) {
      // Remove only the bonus item
      setItems(items.filter((_, i) => i !== index));
    } else {
      // Remove main item and all its bonus items
      setItems(items.filter((item, i) => i !== index && item.parentItemId !== itemToRemove.id));
    }
  };

  const handlePrintDialogClose = (shouldNavigate: boolean = true) => {
    setIsPrintDialogOpen(false);

    if (shouldNavigate) {
      // Reset form
      setSelectedCustomer(null);
      setCustomerSearch('');
      setItems([]);
      setDiskon(0);
      setPaidAmount(0);
      setPaymentAccountId('');
      setPpnEnabled(false);
      setPpnMode('include');
      setPpnPercentage(getDefaultPPNPercentage());
      setIsOfficeSale(false);

      // Reset due date
      const newDueDate = getOfficeTime(timezone);
      newDueDate.setDate(newDueDate.getDate() + 7);
      setDueDate(newDueDate.toISOString().split('T')[0]);

      // Navigate to transactions page
      navigate('/transactions');
    }
  };

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || addTransaction.isPending) return;

    const validItems = items.filter(item => item.product && item.qty > 0);

    // Check if we have either selected customer or typed customer name
    const customerName = selectedCustomer?.name || customerSearch.trim();

    if (!customerName || validItems.length === 0 || !currentUser) {
      toast({ variant: "destructive", title: "Validasi Gagal", description: "Harap isi Nama Pelanggan dan tambahkan minimal satu item produk yang valid." });
      return;
    }

    if (paidAmount > 0 && !paymentAccountId) {
      toast({ variant: "destructive", title: "Validasi Gagal", description: "Harap pilih Kas/Bank untuk menerima pembayaran." });
      return;
    }

    setIsSubmitting(true);

    const transactionItems: TransactionItem[] = validItems.map(item => ({
      product: {
        ...item.product!,
        // Ensure bonus items have distinct names for delivery differentiation
        name: item.isBonus ? `${item.product!.name} (Bonus)` : item.product!.name
      },
      quantity: item.qty,
      price: item.harga,
      unit: item.unit,
      width: 0, height: 0,
      notes: item.isBonus
        ? `${item.keterangan}${item.keterangan ? ' - ' : ''}BONUS: ${item.bonusDescription || 'Bonus Item'}`
        : item.keterangan,
      designFileName: item.designFileName,
      isBonus: item.isBonus || false,
    }));

    const paymentStatus: PaymentStatus = sisaTagihan <= 0 ? 'Lunas' : 'Belum Lunas';

    // Generate sequential transaction ID: AQV-DDMM-NNN
    const transactionId = await generateTransactionId('kasir');

    const newTransaction: Omit<Transaction, 'createdAt'> = {
      id: transactionId,
      customerId: selectedCustomer?.id || 'manual-customer',
      customerName: customerName,
      cashierId: currentUser.id,
      cashierName: currentUser.name,
      salesId: selectedSales && selectedSales !== 'none' ? selectedSales : null,
      salesName: selectedSales && selectedSales !== 'none' ? salesEmployees?.find(s => s.id === selectedSales)?.name || null : null,
      designerId: null,
      operatorId: null,
      paymentAccountId: paymentAccountId || null,
      orderDate: orderDate || getOfficeTime(timezone),
      finishDate: null,
      dueDate: sisaTagihan > 0 ? new Date(dueDate || (() => {
        const fallbackDate = getOfficeTime(timezone);
        fallbackDate.setDate(fallbackDate.getDate() + 7);
        return fallbackDate.toISOString().split('T')[0];
      })()) : null,
      items: transactionItems,
      subtotal: ppnCalculation.subtotal,
      ppnEnabled: ppnEnabled,
      ppnMode: ppnEnabled ? ppnMode : undefined,
      ppnPercentage: ppnPercentage,
      ppnAmount: ppnCalculation.ppnAmount,
      total: totalTagihan,
      paidAmount: paidAmount,
      paymentStatus: paymentStatus,
      status: 'Pesanan Masuk',
      notes: transactionNotes.trim() || undefined,
      isOfficeSale: isOfficeSale,
    };

    addTransaction.mutate({ newTransaction }, {
      onSuccess: async (savedData) => {
        // ============================================================================
        // BALANCE UPDATE DIHAPUS - Sekarang dihitung dari journal_entries
        // addTransaction sudah memanggil createSalesJournal yang akan auto-post jurnal
        // ============================================================================

        // Update quotation status to converted if this transaction is from a quotation
        if (sourceQuotation?.id) {
          try {
            await quotationService.convertToInvoice(sourceQuotation.id, savedData.id);
          } catch (err) {
            console.error('Failed to update quotation status:', err);
          }
        }

        setSavedTransaction(savedData);
        toast({ title: "Sukses", description: "Transaksi dan pembayaran berhasil disimpan." });

        // Show print dialog and redirect to transactions page
        setIsPrintDialogOpen(true);
        setIsSubmitting(false);
        navigate('/transactions');
      },
      onError: (error) => {
        setIsSubmitting(false);
        toast({ variant: "destructive", title: "Gagal Menyimpan", description: error.message });
      }
    });
  };

  // Convert materials to Product-like objects for POS
  // Materials akan ditampilkan dengan label "(Bahan)" dan type "Bahan"
  // Hanya tampil jika user punya permission material_sales
  const materialsAsProducts = useMemo(() => {
    if (!materials || !canSellMaterials) return [];
    return materials.map(material => ({
      id: `material-${material.id}`,
      name: `${material.name} (Bahan)`,
      type: 'Bahan' as any, // Special type for materials
      basePrice: material.pricePerUnit,
      costPrice: material.pricePerUnit,
      unit: material.unit,
      initialStock: material.stock,
      currentStock: material.stock,
      minStock: material.minStock,
      minOrder: 1,
      description: material.description,
      specifications: [],
      materials: [],
      createdAt: material.createdAt,
      updatedAt: material.updatedAt,
      _isMaterial: true, // Flag to identify material items
      _materialId: material.id, // Original material ID
    } as Product & { _isMaterial: boolean; _materialId: string }));
  }, [materials, canSellMaterials]);

  const filteredProducts = useMemo(() => {
    const allItems = [...(products || []), ...materialsAsProducts];
    const activeItems = allItems.filter(p => (p as any).isActive !== false);
    return activeItems.filter(product =>
      product.name?.toLowerCase().includes(productSearch.toLowerCase())
    ) || [];
  }, [products, materialsAsProducts, productSearch]);

  const filteredCustomers = useMemo(() => {
    if (!customers) return [];
    return customers.filter(customer =>
      customer.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
      customer.phone.includes(customerSearch)
    ).slice(0, 10); // Limit to 10 results
  }, [customers, customerSearch]);

  const [selectedCustomerIndex, setSelectedCustomerIndex] = useState(0);

  useEffect(() => {
    setSelectedCustomerIndex(0);
  }, [customerSearch]);

  const [selectedProductIndex, setSelectedProductIndex] = useState(0);

  useEffect(() => {
    setSelectedProductIndex(0);
  }, [productSearch]);

  const addToCart = async (product: Product) => {
    const existing = items.find(item => item.product?.id === product.id && !item.isBonus);
    let targetId = 0;
    if (existing) {
      // Hilangkan validasi stok agar tetap bisa jual walau stok 0
      const newQty = existing.qty + 1;
      await updateItemWithBonuses(existing, newQty);
      targetId = existing.id;
    } else {
      const newItemId = Date.now();
      await addNewItemWithBonuses(product, 1, newItemId);
      targetId = newItemId;
    }
    setShowProductDropdown(false);
    setProductSearch('');

    // INPUT CHAIN: Focus and auto-select Qty after adding item
    setTimeout(() => {
      const qtyInput = document.getElementById(`qty-input-${targetId}`) as HTMLInputElement;
      if (qtyInput) {
        qtyInput.focus();
        qtyInput.select();
      }
    }, 100);
  };

  const updateItemWithBonuses = async (existingItem: FormTransactionItem, newQty: number) => {
    // Check if this is a material item - materials don't have pricing rules
    // and user should be able to set custom prices
    const isMaterial = (existingItem.product as any)?._isMaterial === true;

    // Use skipFetch=true to use cached pricing data (no database fetch)
    const { price, calculation } = await calculateDynamicPrice(existingItem.product!, newQty, true);

    // Remove existing bonus items for this product
    let newItems = items.filter(item => item.parentItemId !== existingItem.id);

    // Update main item
    // For materials: preserve user's custom price, only update qty
    // For products: update both qty and price (from dynamic pricing)
    newItems = newItems.map(item =>
      item.id === existingItem.id
        ? { ...item, qty: newQty, harga: isMaterial ? item.harga : price }
        : item
    );

    // Add bonus items if any
    if (calculation?.bonuses && calculation.bonuses.length > 0) {
      for (const bonus of calculation.bonuses) {
        // Only add quantity-based bonuses as separate items
        if (bonus.type === 'quantity' && bonus.bonusQuantity > 0) {
          const bonusItem: FormTransactionItem = {
            id: Date.now() + Math.random(),
            product: existingItem.product,
            keterangan: bonus.description || `Bonus - ${bonus.type}`,
            qty: bonus.bonusQuantity,
            harga: 0,
            unit: existingItem.product!.unit || 'pcs',
            isBonus: true,
            bonusDescription: bonus.description,
            parentItemId: existingItem.id
          };
          newItems.push(bonusItem);
        }
        // For discount bonuses, we don't add separate items as the price is already adjusted
      }
    }

    setItems(newItems);
  };

  const addNewItemWithBonuses = async (product: Product, quantity: number, forceId?: number) => {
    const { price, calculation } = await calculateDynamicPrice(product, quantity);
    const newItemId = forceId || Date.now();

    const newItem: FormTransactionItem = {
      id: newItemId,
      product: product,
      keterangan: '',
      qty: quantity,
      harga: price,
      unit: product.unit || 'pcs'
    };

    let newItems = [...items, newItem];

    // Add bonus items if any
    if (calculation?.bonuses && calculation.bonuses.length > 0) {
      for (const bonus of calculation.bonuses) {
        // Only add quantity-based bonuses as separate items
        if (bonus.type === 'quantity' && bonus.bonusQuantity > 0) {
          const bonusItem: FormTransactionItem = {
            id: Date.now() + Math.random(),
            product: product,
            keterangan: bonus.description || `Bonus - ${bonus.type}`,
            qty: bonus.bonusQuantity,
            harga: 0,
            unit: product.unit || 'pcs',
            isBonus: true,
            bonusDescription: bonus.description,
            parentItemId: newItemId
          };
          newItems.push(bonusItem);
        }
        // For discount bonuses, we don't add separate items as the price is already adjusted
      }
    }

    setItems(newItems);
  };

  return (
    <>
      <CustomerSearchDialog
        open={isCustomerSearchOpen}
        onOpenChange={setIsCustomerSearchOpen}
        onCustomerSelect={(customer) => {
          setSelectedCustomer(customer)
          setCustomerSearch(customer?.name || '')
        }}
      />
      <AddCustomerDialog
        open={isCustomerAddOpen}
        onOpenChange={setIsCustomerAddOpen}
        onCustomerAdded={(customer) => {
          setSelectedCustomer(customer)
          setCustomerSearch(customer?.name || '')
        }}
      />
      {savedTransaction && <PrintReceiptDialog open={isPrintDialogOpen} onOpenChange={handlePrintDialogClose} transaction={savedTransaction} template="receipt" />}

      <div className="min-h-screen bg-white dark:bg-gray-900">
        <div className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 p-3 md:p-4">
          <h1 className="text-lg md:text-xl font-bold text-gray-900 dark:text-white">Buat Transaksi Baru</h1>
          <p className="text-xs md:text-sm text-gray-600 dark:text-gray-400">Isi detail pesanan pelanggan pada form di bawah ini.</p>
        </div>

        <form onSubmit={handleSubmit} className="p-3 md:p-6">
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Left Panel - Main Form Content (Scrollable) */}
            <div className="flex-1 space-y-4 md:space-y-6 lg:overflow-auto">
              {retasiBlocked && (
                <div className="p-4 mb-4 text-sm text-red-800 dark:text-red-200 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700" role="alert">
                  <div className="flex items-center">
                    <AlertTriangle className="inline-block w-5 h-5 mr-2" />
                    <span className="font-medium">Akses POS Diblokir</span>
                  </div>
                  <p className="mt-2">{retasiMessage}</p>
                  <div className="mt-3">
                    <Button
                      type="button"
                      onClick={() => navigate('/retasi')}
                      className="bg-red-600 hover:bg-red-700 text-white"
                    >
                      Buka Halaman Retasi
                    </Button>
                  </div>
                </div>
              )}
              <div className="space-y-4 md:space-y-0 md:grid md:grid-cols-1 lg:grid-cols-2 md:gap-6">
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">Nama Pemesan</h3>
                  <div className="space-y-3">
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Ketik nama pelanggan atau pilih dari dropdown..."
                        value={customerSearch}
                        onChange={(e) => {
                          setCustomerSearch(e.target.value)
                          setShowCustomerDropdown(true)
                          if (!e.target.value) {
                            setSelectedCustomer(null)
                          }
                        }}
                        onFocus={() => setShowCustomerDropdown(true)}
                        onBlur={() => {
                          // Delay to allow click on dropdown items
                          setTimeout(() => setShowCustomerDropdown(false), 150)
                        }}
                        disabled={retasiBlocked}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (filteredCustomers.length > 0 && showCustomerDropdown) {
                              const customer = filteredCustomers[selectedCustomerIndex] || filteredCustomers[0];
                              setSelectedCustomer(customer);
                              setCustomerSearch(customer.name);
                              setShowCustomerDropdown(false);
                            }
                          } else if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setSelectedCustomerIndex(prev => Math.min(prev + 1, filteredCustomers.length - 1));
                            const container = document.getElementById('customer-dropdown-container');
                            const item = document.getElementById(`customer-item-${Math.min(selectedCustomerIndex + 1, filteredCustomers.length - 1)}`);
                            if (container && item) item.scrollIntoView({ block: 'nearest' });
                          } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setSelectedCustomerIndex(prev => Math.max(prev - 1, 0));
                            const container = document.getElementById('customer-dropdown-container');
                            const item = document.getElementById(`customer-item-${Math.max(selectedCustomerIndex - 1, 0)}`);
                            if (container && item) item.scrollIntoView({ block: 'nearest' });
                          }
                        }}
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />

                      {showCustomerDropdown && filteredCustomers.length > 0 && (
                        <div id="customer-dropdown-container" className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-60 overflow-auto">
                          {filteredCustomers.map((customer, index) => {
                            const isSelected = index === selectedCustomerIndex;
                            return (
                              <div
                                key={customer.id}
                                id={`customer-item-${index}`}
                                className={`px-3 py-2 transition-colors cursor-pointer text-sm ${isSelected ? 'bg-blue-50 dark:bg-blue-900/40 border-l-4 border-l-blue-500' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                                onClick={() => {
                                  setSelectedCustomer(customer)
                                  setCustomerSearch(customer.name)
                                  setShowCustomerDropdown(false)
                                }}
                              >
                                <div className={`font-medium ${isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-white'}`}>{customer.name}</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">{customer.phone}</div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Button
                        type="button"
                        onClick={() => setIsCustomerSearchOpen(true)}
                        disabled={retasiBlocked}
                        variant="outline"
                        size="sm"
                        className="bg-yellow-400 hover:bg-yellow-500 text-black border-yellow-400 text-xs md:text-sm"
                      >
                        <Search className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                        Cari Lanjutan
                      </Button>
                      <Button
                        type="button"
                        onClick={() => setIsCustomerAddOpen(true)}
                        disabled={retasiBlocked}
                        variant="outline"
                        size="sm"
                        className="bg-gray-500 hover:bg-gray-600 text-white border-gray-500 text-xs md:text-sm"
                      >
                        <UserIcon className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                        Baru
                      </Button>
                    </div>

                    {selectedCustomer && (
                      <div className="text-xs md:text-sm text-gray-600 dark:text-gray-300 space-y-2 bg-gray-50 dark:bg-gray-700 p-3 rounded">
                        <div>
                          <strong>Alamat:</strong> <span className="break-words">{selectedCustomer.address}</span>
                        </div>
                        <div>
                          <strong>Telp:</strong> {selectedCustomer.phone}
                        </div>
                        {selectedCustomer.jumlah_galon_titip !== undefined && selectedCustomer.jumlah_galon_titip > 0 && (
                          <div className="text-green-600 font-medium">
                            <strong>🥤 Galon Titip:</strong> {selectedCustomer.jumlah_galon_titip} galon
                          </div>
                        )}
                        {selectedCustomer.sisaPiutang !== undefined && selectedCustomer.sisaPiutang > 0 && (
                          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md p-2 mt-2">
                            <div className="text-red-700 dark:text-red-400 font-semibold flex items-center gap-1">
                              <span>⚠️</span>
                              <span>Piutang Outstanding:</span>
                              <span className="ml-auto">
                                Rp {selectedCustomer.sisaPiutang.toLocaleString('id-ID')}
                              </span>
                            </div>
                            <div className="text-xs text-red-600 dark:text-red-300 mt-1">
                              {selectedCustomer.jumlahPiutang || 0} transaksi belum lunas
                              {selectedCustomer.jatuhTempoTerdekat && (
                                <span className="ml-2">
                                  • Jatuh tempo terdekat: {new Date(selectedCustomer.jatuhTempoTerdekat).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                        <div className="flex gap-2 mt-2">
                          {selectedCustomer.phone && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => window.location.href = `tel:${selectedCustomer.phone}`}
                              className="flex items-center gap-1 text-xs"
                            >
                              <Phone className="h-3 w-3" />
                              <span>Telepon</span>
                            </Button>
                          )}
                          {selectedCustomer.latitude && selectedCustomer.longitude && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                window.open(`https://www.google.com/maps/dir//${selectedCustomer.latitude},${selectedCustomer.longitude}`, '_blank');
                              }}
                              className="flex items-center gap-1 text-xs"
                            >
                              <MapPin className="h-3 w-3" />
                              <span>Lokasi GPS</span>
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Sales Selection */}
                <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-3">Sales</h3>
                  <Select value={selectedSales} onValueChange={setSelectedSales} disabled={retasiBlocked}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih Sales (Opsional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        <span className="text-gray-500">Tanpa Sales</span>
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
                    <div className="mt-2 text-xs text-green-700">
                      <strong>Sales:</strong> {salesEmployees?.find(s => s.id === selectedSales)?.name}
                    </div>
                  )}
                  {selectedSales === 'none' && (
                    <div className="mt-2 text-xs text-gray-500">
                      <strong>Sales:</strong> Tanpa Sales
                    </div>
                  )}
                </div>

                {/* Office Sale Checkbox */}
                <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isOfficeSale}
                      onChange={(e) => setIsOfficeSale(e.target.checked)}
                      className="w-5 h-5 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                      disabled={retasiBlocked}
                    />
                    <div>
                      <span className="text-lg font-medium text-blue-900">Laku Kantor</span>
                      <p className="text-sm text-blue-700">Centang jika produk laku kantor (tidak perlu update ke pengantaran)</p>
                    </div>
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Tgl Order</label>
                    {currentUser?.role === 'owner' ? (
                      <DateTimePicker date={orderDate} setDate={setOrderDate} disabled={retasiBlocked} />
                    ) : (
                      <div className="flex items-center h-10 px-3 bg-gray-100 dark:bg-gray-800 rounded-md text-sm text-gray-700 dark:text-gray-300">
                        {orderDate ? new Intl.DateTimeFormat('id-ID', {
                          timeZone: timezone,
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        }).format(orderDate) : '-'}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
                  <h3 className="text-base md:text-lg font-medium text-gray-900 dark:text-white">Daftar Item</h3>
                  <div className="relative flex-1">
                    <Button
                      type="button"
                      size="lg"
                      className="w-full bg-gray-800 hover:bg-gray-900 text-sm md:text-base py-3 md:py-4"
                      onClick={() => setShowProductDropdown(!showProductDropdown)}
                      disabled={retasiBlocked}
                    >
                      <Plus className="w-4 h-4 md:w-5 md:h-5 mr-2" />
                      Tambah Item
                    </Button>

                    {showProductDropdown && (
                      <div className="absolute left-0 right-0 top-full mt-2 bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-lg shadow-xl z-50 max-h-[40vh] overflow-hidden">
                        <div className="p-2 border-b dark:border-gray-600 bg-gray-50 dark:bg-gray-700 sticky top-0">
                          <Input
                            ref={productSearchInputRef}
                            placeholder="Cari produk (Enter untuk tambah & selesai)"
                            value={productSearch}
                            onChange={(e) => setProductSearch(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                if (filteredProducts.length > 0) {
                                  addToCart(filteredProducts[selectedProductIndex] || filteredProducts[0]);
                                } else {
                                  // Kosong lalu Enter -> Selesai dan lanjut Simpan
                                  setShowProductDropdown(false);
                                  document.getElementById('simpan-transaksi-btn')?.focus();
                                }
                              } else if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                setSelectedProductIndex(prev => Math.min(prev + 1, filteredProducts.length - 1));
                                // Auto scroll into view
                                const container = document.getElementById('product-dropdown-container');
                                const item = document.getElementById(`product-item-${Math.min(selectedProductIndex + 1, filteredProducts.length - 1)}`);
                                if (container && item) {
                                  item.scrollIntoView({ block: 'nearest' });
                                }
                              } else if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                setSelectedProductIndex(prev => Math.max(prev - 1, 0));
                                // Auto scroll into view
                                const container = document.getElementById('product-dropdown-container');
                                const item = document.getElementById(`product-item-${Math.max(selectedProductIndex - 1, 0)}`);
                                if (container && item) {
                                  item.scrollIntoView({ block: 'nearest' });
                                }
                              }
                            }}
                            className="w-full text-sm h-9"
                            autoFocus
                          />
                        </div>
                        <div id="product-dropdown-container" className="max-h-[calc(40vh-50px)] overflow-y-auto">
                          {filteredProducts.map((product, index) => {
                            const isOutOfStock = (product.currentStock || 0) <= 0;
                            const isSelected = index === selectedProductIndex;
                            return (
                              <div
                                key={product.id}
                                id={`product-item-${index}`}
                                className={`px-3 py-2 border-b dark:border-gray-600 last:border-b-0 transition-colors cursor-pointer ${
                                  isSelected 
                                    ? 'bg-blue-50 dark:bg-blue-900/40 border-l-4 border-l-blue-500' 
                                    : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                                }`}
                                onClick={() => addToCart(product)}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex-1 min-w-0">
                                    <span className={`font-medium text-sm ${isOutOfStock ? 'text-gray-500 dark:text-gray-400' : (isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-white')}`}>
                                      {product.name}
                                    </span>
                                    <div className={`text-xs ${isOutOfStock ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}`}>
                                      Stok: {product.currentStock ?? 0} {product.unit || 'pcs'}
                                    </div>
                                  </div>
                                  <div className="shrink-0 flex items-center gap-3">
                                    <div className={`text-sm font-semibold ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-green-600 dark:text-green-400'}`}>
                                      {new Intl.NumberFormat("id-ID", {
                                        style: "currency",
                                        currency: "IDR",
                                        maximumFractionDigits: 0,
                                      }).format(product.basePrice || 0)}
                                    </div>
                                    <Plus className={`h-4 w-4 ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-green-600 dark:text-green-400'}`} />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="border dark:border-gray-600 rounded-lg overflow-x-auto">
                  <table className="w-full min-w-[600px]">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <th className="px-2 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium text-gray-700 dark:text-gray-200">Produk</th>
                        <th className="px-2 md:px-4 py-2 md:py-3 text-center text-xs md:text-sm font-medium text-gray-700 dark:text-gray-200">Qty</th>
                        <th className="px-2 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium text-gray-700 dark:text-gray-200">Satuan</th>
                        <th className="px-2 md:px-4 py-2 md:py-3 text-right text-xs md:text-sm font-medium text-gray-700 dark:text-gray-200">Harga Satuan</th>
                        <th className="px-2 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium text-gray-700 dark:text-gray-200">Catatan</th>
                        <th className="px-2 md:px-4 py-2 md:py-3 text-right text-xs md:text-sm font-medium text-gray-700 dark:text-gray-200">Total</th>
                        <th className="px-2 md:px-4 py-2 md:py-3 text-center text-xs md:text-sm font-medium text-gray-700 dark:text-gray-200">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 md:py-12 text-center text-gray-500">
                            <div className="flex flex-col items-center">
                              <div className="w-12 h-12 md:w-16 md:h-16 bg-gray-100 rounded-full flex items-center justify-center mb-3 md:mb-4">
                                <Plus className="w-6 h-6 md:w-8 md:h-8 text-gray-400" />
                              </div>
                              <p className="text-xs md:text-sm">
                                Belum ada item. Klik "Tambah Item" untuk menambahkan produk.
                              </p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        items.map((item, index) => (
                          <tr key={item.id} className={`border-t dark:border-gray-600 ${item.isBonus ? 'bg-green-50 dark:bg-green-900/30' : ''}`}>
                            <td className="px-2 md:px-4 py-2 md:py-3">
                              {item.isBonus ? (
                                <div className="text-xs text-green-700 dark:text-green-300 font-medium">
                                  🎁 {item.product?.name} (Bonus)
                                  {item.bonusDescription && (
                                    <div className="text-xs text-gray-600 mt-1">{item.bonusDescription}</div>
                                  )}
                                </div>
                              ) : (
                                <Popover open={openProductDropdowns[index]} onOpenChange={(open) => {
                                  setOpenProductDropdowns(prev => ({ ...prev, [index]: open }));
                                }}>
                                  <PopoverTrigger asChild disabled={retasiBlocked}>
                                    <Button
                                      variant="outline"
                                      role="combobox"
                                      className={cn(
                                        "w-full justify-between text-xs h-8",
                                        !item.product && "text-muted-foreground"
                                      )}
                                    >
                                      {item.product ? item.product.name : "Pilih produk..."}
                                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                  </PopoverTrigger>
                                    <PopoverContent className="w-[300px] p-0">
                                      <Command>
                                        <CommandInput placeholder="Cari produk..." autoFocus />
                                        <CommandEmpty>Produk tidak ditemukan.</CommandEmpty>
                                      <CommandGroup className="max-h-64 overflow-y-auto">
                                        {(products || []).map((product) => (
                                          <CommandItem
                                            key={product.id}
                                            value={product.name}
                                            onSelect={() => {
                                              handleItemChange(index, 'product', product);
                                              setOpenProductDropdowns(prev => ({ ...prev, [index]: false }));
                                            }}
                                          >
                                            <Check
                                              className={cn(
                                                "mr-2 h-4 w-4",
                                                item.product?.id === product.id ? "opacity-100" : "opacity-0"
                                              )}
                                            />
                                            <div>
                                              <div className="font-medium">{product.name}</div>
                                              <div className="text-xs text-gray-500">
                                                {new Intl.NumberFormat("id-ID", {
                                                  style: "currency",
                                                  currency: "IDR",
                                                  maximumFractionDigits: 0,
                                                }).format(product.basePrice || 0)} | {product.unit}
                                              </div>
                                            </div>
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    </Command>
                                  </PopoverContent>
                                </Popover>
                              )}
                            </td>
                            <td className="px-2 md:px-4 py-2 md:py-3 text-center">
                              <NumberInput
                                id={`qty-input-${item.id}`}
                                value={item.qty}
                                onChange={(value) => handleItemChange(index, 'qty', value || 1)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    // INPUT CHAIN: Jump back to Tambah Item/Search after typing Qty
                                    setShowProductDropdown(true);
                                    setTimeout(() => productSearchInputRef.current?.focus(), 100);
                                  }
                                }}
                                min={1}
                                decimalPlaces={0}
                                className="w-16 md:w-20 text-center text-xs"
                                disabled={retasiBlocked}
                              />
                            </td>
                            <td className="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm text-gray-900 dark:text-white">
                              <div>{item.unit}</div>
                              {/* Tampilkan stok untuk semua produk */}
                              {item.product && (
                                <div className={`text-xs mt-0.5 ${(item.product.currentStock || 0) <= 0
                                  ? 'text-red-500 font-medium'
                                  : (item.product.currentStock || 0) <= (item.product.minStock || 10)
                                    ? 'text-amber-600'
                                    : 'text-gray-500'
                                  }`}>
                                  Stok: {item.product.currentStock ?? '-'}
                                </div>
                              )}
                            </td>
                            <td className="px-2 md:px-4 py-2 md:py-3 text-right">
                              {item.isBonus ? (
                                <div className="text-center text-xs text-green-600 font-medium">GRATIS</div>
                              ) : (
                                <div className="relative">
                                  <NumberInput
                                    value={item.harga}
                                    onChange={(value) => handleItemChange(index, 'harga', value || 0)}
                                    min={0}
                                    decimalPlaces={2}
                                    className="w-20 md:w-32 text-right text-xs"
                                    disabled={retasiBlocked || loadingPrices[item.id] || !hasGranularPermission('pos_edit_price')}
                                  />
                                  {loadingPrices[item.id] && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-70">
                                      <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="px-2 md:px-4 py-2 md:py-3 text-left">
                              <Input
                                type="text"
                                placeholder="Catatan..."
                                value={item.keterangan}
                                onChange={(e) => handleItemChange(index, 'keterangan', e.target.value)}
                                className="w-20 md:w-32 text-xs"
                                disabled={retasiBlocked}
                              />
                            </td>
                            <td className="px-2 md:px-4 py-2 md:py-3 text-right text-xs md:text-sm font-medium text-gray-900 dark:text-white">
                              {new Intl.NumberFormat("id-ID").format(item.qty * item.harga)}
                            </td>
                            <td className="px-2 md:px-4 py-2 md:py-3 text-center">
                              <Button size="sm" variant="outline" onClick={() => handleRemoveItem(index)} disabled={retasiBlocked}>
                                <Trash2 className="w-3 h-3 md:w-4 md:h-4" />
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Catatan</label>
                <textarea
                  className="mt-1 w-full p-2 md:p-3 border dark:border-gray-600 rounded-lg resize-none text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  rows={2}
                  placeholder="Tambahkan catatan untuk transaksi ini..."
                  value={transactionNotes}
                  onChange={(e) => setTransactionNotes(e.target.value)}
                />
              </div>
            </div>

            {/* Right Panel - Payment & Submit (Sticky on Desktop) */}
            <div className="lg:w-1/3 lg:min-w-[320px] lg:max-w-[400px] lg:sticky lg:top-4 lg:self-start space-y-3 bg-gray-50 dark:bg-gray-800 lg:bg-white dark:lg:bg-gray-800 lg:border dark:lg:border-gray-600 lg:rounded-lg lg:p-4 lg:shadow-sm">
              {/* Payment Summary Header */}
              <div className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white p-2 rounded-lg -m-4 mb-2 lg:m-0 lg:mb-2 lg:-mt-4 lg:-mx-4 lg:rounded-t-lg lg:rounded-b-none">
                <h3 className="font-semibold text-center text-sm">Pembayaran</h3>
              </div>

              <div className="space-y-3">
                {/* Total & Payment Amount - Compact */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-100 dark:bg-gray-700 p-2 rounded-lg">
                    <label className="text-xs text-gray-500 dark:text-gray-400">Total Tagihan</label>
                    <div className="text-lg font-bold text-gray-900 dark:text-white">
                      {new Intl.NumberFormat("id-ID").format(totalTagihan)}
                    </div>
                  </div>
                  <div className="bg-emerald-50 dark:bg-emerald-900/30 p-2 rounded-lg border border-emerald-200 dark:border-emerald-700">
                    <label className="text-xs text-emerald-700 dark:text-emerald-400">Jumlah Bayar</label>
                    <NumberInput
                      value={paidAmount}
                      onChange={(value) => setPaidAmount(Math.min(value || 0, totalTagihan))}
                      min={0}
                      decimalPlaces={2}
                      className="text-right font-bold text-emerald-700 text-lg w-full bg-transparent border-0 p-0 h-auto"
                      disabled={retasiBlocked}
                    />
                  </div>
                </div>

                {/* Quick Payment Buttons */}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={paidAmount >= totalTagihan ? "default" : "outline"}
                    size="sm"
                    className={`flex-1 text-xs ${paidAmount >= totalTagihan ? 'bg-green-600 hover:bg-green-700' : ''}`}
                    onClick={() => setPaidAmount(totalTagihan)}
                    disabled={retasiBlocked}
                  >
                    💰 Lunas
                  </Button>
                  <Button
                    type="button"
                    variant={paidAmount === 0 ? "default" : "outline"}
                    size="sm"
                    className={`flex-1 text-xs ${paidAmount === 0 ? 'bg-orange-600 hover:bg-orange-700' : ''}`}
                    onClick={() => setPaidAmount(0)}
                    disabled={retasiBlocked}
                  >
                    📝 Kredit
                  </Button>
                </div>

                {/* Status & Sisa - Compact */}
                <div className="flex justify-between text-xs bg-gray-50 dark:bg-gray-700 p-2 rounded">
                  <span className={sisaTagihan <= 0 ? 'text-green-600 font-medium' : sisaTagihan < totalTagihan ? 'text-orange-600' : 'text-gray-600'}>
                    {sisaTagihan <= 0 ? '✅ Lunas' : sisaTagihan < totalTagihan ? `⏳ Sisa: ${new Intl.NumberFormat("id-ID").format(sisaTagihan)}` : '❌ Belum Bayar'}
                  </span>
                </div>

                {/* Payment Method - Only show if paidAmount > 0 */}
                {paidAmount > 0 && (
                  <div className="border border-emerald-200 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-900/30 p-3 rounded-lg">
                    <h3 className="text-xs font-medium text-gray-700 dark:text-gray-200 mb-2">Metode Pembayaran</h3>
                    <Select value={paymentAccountId} onValueChange={setPaymentAccountId} disabled={retasiBlocked}>
                      <SelectTrigger className="w-full text-sm">
                        <SelectValue placeholder="Pilih Kas/Bank..." />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts?.filter(a => a.isPaymentAccount).map(acc => (
                          <SelectItem key={acc.id} value={acc.id}>
                            <Wallet className="inline-block mr-2 h-4 w-4" />
                            {acc.code ? `${acc.code} - ` : ''}{acc.name}
                            <span className="text-xs text-gray-500 ml-2">
                              ({new Intl.NumberFormat("id-ID").format(acc.balance || 0)})
                            </span>
                          </SelectItem>
                        ))}
                        {(!accounts || accounts.filter(a => a.isPaymentAccount).length === 0) && (
                          <SelectItem value="no-accounts" disabled>
                            ⚠️ Tidak ada akun pembayaran
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Diskon - Compact inline */}
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">Diskon:</label>
                  <NumberInput
                    value={diskon}
                    onChange={(value) => setDiskon(value || 0)}
                    min={0}
                    decimalPlaces={2}
                    className="text-right text-sm flex-1"
                    disabled={retasiBlocked}
                  />
                </div>

                {/* Tax Settings - Collapsed by default */}
                <div className="border dark:border-gray-600 rounded-lg">
                  <button
                    type="button"
                    className="flex items-center justify-between w-full text-xs font-medium text-gray-600 dark:text-gray-300 p-2 hover:bg-gray-50 dark:hover:bg-gray-700"
                    onClick={() => setShowTaxSettings(!showTaxSettings)}
                  >
                    <span>⚙️ Pajak: {ppnEnabled ? `PPN ${ppnMode === 'include' ? 'Include' : 'Exclude'} ${ppnPercentage}%` : 'Non Pajak'}</span>
                    <ChevronDown className={`w-3 h-3 transition-transform ${showTaxSettings ? "rotate-180" : ""}`} />
                  </button>
                  {showTaxSettings && (
                    <div className="p-2 pt-0 space-y-1 border-t dark:border-gray-600">
                      <label className="flex items-center text-xs cursor-pointer p-1 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300">
                        <input type="radio" name="taxMode" checked={ppnEnabled && ppnMode === 'include'} onChange={() => { setPpnEnabled(true); setPpnMode('include'); }} className="mr-2 w-3 h-3" disabled={retasiBlocked} />
                        PPN Include ({ppnPercentage}%)
                      </label>
                      <label className="flex items-center text-xs cursor-pointer p-1 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300">
                        <input type="radio" name="taxMode" checked={ppnEnabled && ppnMode === 'exclude'} onChange={() => { setPpnEnabled(true); setPpnMode('exclude'); }} className="mr-2 w-3 h-3" disabled={retasiBlocked} />
                        PPN Exclude ({ppnPercentage}%)
                      </label>
                      <label className="flex items-center text-xs cursor-pointer p-1 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300">
                        <input type="radio" name="taxMode" checked={!ppnEnabled} onChange={() => setPpnEnabled(false)} className="mr-2 w-3 h-3" disabled={retasiBlocked} />
                        Non Pajak
                      </label>
                      {ppnEnabled && (
                        <div className="text-xs text-blue-600 pt-1 border-t">
                          PPN: {new Intl.NumberFormat("id-ID").format(ppnCalculation.ppnAmount)}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <Button
                  id="simpan-transaksi-btn"
                  type="submit"
                  disabled={items.length === 0 || addTransaction.isPending || isSubmitting || retasiBlocked}
                  className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold py-3 md:py-4 shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none text-sm md:text-base focus:ring-4 focus:ring-emerald-500"
                >
                  {isSubmitting || addTransaction.isPending ? "Menyimpan..." : "Simpan Transaksi"}
                </Button>

                {/* Due Date Section - Only show if payment is not full */}
                {sisaTagihan > 0 && (
                  <div className="pt-3 md:pt-4 border-t border-gray-200 dark:border-gray-600">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Tanggal Jatuh Tempo</label>
                    <Input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="mt-1 text-sm"
                      min={getOfficeDateString(timezone)}
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Tenggat waktu pembayaran kredit</p>

                    <div className="flex flex-wrap gap-2 mt-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200"
                        onClick={() => {
                          const date = getOfficeTime(timezone);
                          date.setDate(date.getDate() + 3);
                          setDueDate(date.toISOString().split('T')[0]);
                        }}
                      >
                        3 Hari
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs bg-green-50 hover:bg-green-100 text-green-700 border-green-200"
                        onClick={() => {
                          const date = getOfficeTime(timezone);
                          date.setDate(date.getDate() + 7);
                          setDueDate(date.toISOString().split('T')[0]);
                        }}
                      >
                        7 Hari
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs bg-orange-50 hover:bg-orange-100 text-orange-700 border-orange-200"
                        onClick={() => {
                          const date = getOfficeTime(timezone);
                          date.setDate(date.getDate() + 14);
                          setDueDate(date.toISOString().split('T')[0]);
                        }}
                      >
                        14 Hari
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs bg-purple-50 hover:bg-purple-100 text-purple-700 border-purple-200"
                        onClick={() => {
                          const date = getOfficeTime(timezone);
                          date.setDate(date.getDate() + 21);
                          setDueDate(date.toISOString().split('T')[0]);
                        }}
                      >
                        21 Hari
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </form>
      </div>
    </>
  )
}