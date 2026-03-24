"use client"
import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Download, Calendar, Package, CalendarDays, ShoppingCart, Truck, Store, Navigation, FileSpreadsheet, User, Wallet, CreditCard, UserCheck } from 'lucide-react'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { id } from 'date-fns/locale/id'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { supabase } from '@/integrations/supabase/client'
import { useBranch } from '@/contexts/BranchContext'
import { useTimezone } from '@/contexts/TimezoneContext'
import { toOfficeStartOfDay, toOfficeEndOfDay } from '@/utils/officeTime'
import { useAccounts } from '@/hooks/useAccounts'

interface SoldProduct {
  transactionId: string
  transactionDate: Date
  soldDate: Date // Tanggal laku (delivery date, order date untuk laku kantor, atau retasi date)
  customerName: string
  productName: string
  quantity: number
  unit: string
  price: number
  total: number
  source: 'delivery' | 'office_sale' | 'retasi' | 'migration' | 'pos_kasir' // Sumber: pengantaran, laku kantor, retasi, data migrasi, atau pos kasir
  driverName?: string
  retasiNumber?: string
  retasiKe?: number // Retasi ke-berapa (1, 2, 3, dst)
  cashierName: string
  isBonus: boolean
  paymentAccountId?: string // ID akun pembayaran
  paymentAccountName?: string // Nama akun pembayaran
  paymentStatus?: 'Lunas' | 'Belum Lunas' // Status pembayaran
  salesName?: string // Nama sales yang menangani transaksi
}

// Helper: Extract sales name from transaction data
// Sales name can come from: 1) sales_name column, or 2) _isSalesMeta in items JSON
const extractSalesName = (transaction: any): string | undefined => {
  // Priority 1: Direct column
  if (transaction?.sales_name) return transaction.sales_name;
  // Priority 2: Metadata in items array
  const items = transaction?.items;
  if (Array.isArray(items) && items.length > 0 && items[0]?._isSalesMeta) {
    return items[0].salesName || undefined;
  }
  return undefined;
};

export const TransactionItemsReport = () => {
  // Default filter: hari ini (dateRange dengan start dan end = hari ini)
  const [filterType, setFilterType] = useState<'monthly' | 'dateRange'>('dateRange')
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [productFilter, setProductFilter] = useState<string>('all') // Filter by product name
  const [availableProducts, setAvailableProducts] = useState<string[]>([]) // List of unique product names
  const [sourceFilter, setSourceFilter] = useState<'all' | 'delivery' | 'office_sale' | 'retasi' | 'migration' | 'pos_kasir'>('all')
  const [driverKasirFilter, setDriverKasirFilter] = useState<string>('all')
  const [availableDriversKasir, setAvailableDriversKasir] = useState<string[]>([])
  const [retasiKeFilter, setRetasiKeFilter] = useState<string>('all')
  const [availableRetasiKe, setAvailableRetasiKe] = useState<{ value: string, label: string }[]>([])
  const [paymentAccountFilter, setPaymentAccountFilter] = useState<string>('all')
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'all' | 'Lunas' | 'Belum Lunas'>('all')
  const [salesFilter, setSalesFilter] = useState<string>('all')
  const [availableSales, setAvailableSales] = useState<string[]>([])
  const [allItems, setAllItems] = useState<SoldProduct[]>([])
  // const [reportData, setReportData] = useState<SoldProduct[]>([]) // Removed state, now derived
  const [isLoading, setIsLoading] = useState(false)

  const { currentBranch } = useBranch()
  const { timezone } = useTimezone()
  const { accounts } = useAccounts()

  // Get payment accounts (kas/bank accounts)
  const paymentAccounts = useMemo(() => {
    return (accounts || []).filter(acc =>
      acc.isPaymentAccount === true ||
      acc.code?.startsWith('1-1') || // Kas
      acc.code?.startsWith('11') ||  // Kas
      acc.name?.toLowerCase().includes('kas') ||
      acc.name?.toLowerCase().includes('bank')
    ).sort((a, b) => (a.code || '').localeCompare(b.code || ''))
  }, [accounts])

  // Filter Logic moved to useMemo for instant updates
  const reportData = useMemo(() => {
    let filteredItems = allItems

    // Apply product filter if selected
    if (productFilter !== 'all') {
      filteredItems = filteredItems.filter(item => item.productName === productFilter)
    }

    // Apply source filter if selected
    if (sourceFilter !== 'all') {
      filteredItems = filteredItems.filter(item => item.source === sourceFilter)
    }

    // Apply driver/kasir filter if selected
    if (driverKasirFilter !== 'all') {
      filteredItems = filteredItems.filter(item => {
        if (item.source === 'delivery' || item.source === 'retasi') {
          return item.driverName === driverKasirFilter
        }
        return item.cashierName === driverKasirFilter
      })
    }

    // Apply retasi ke filter if selected
    if (retasiKeFilter !== 'all') {
      const filterKe = parseInt(retasiKeFilter)
      // Robust comparison in case of type mismatch (though we cast to int)
      filteredItems = filteredItems.filter(item => item.retasiKe == filterKe)
    }

    // Apply payment account filter if selected
    if (paymentAccountFilter !== 'all') {
      filteredItems = filteredItems.filter(item => item.paymentAccountId === paymentAccountFilter)
    }

    // Apply payment status filter if selected
    if (paymentStatusFilter !== 'all') {
      filteredItems = filteredItems.filter(item => item.paymentStatus === paymentStatusFilter)
    }

    // Apply sales filter if selected
    if (salesFilter !== 'all') {
      filteredItems = filteredItems.filter(item => item.salesName === salesFilter)
    }

    return filteredItems
  }, [allItems, productFilter, sourceFilter, driverKasirFilter, retasiKeFilter, paymentAccountFilter, paymentStatusFilter, salesFilter])


  const months = [
    { value: 1, label: 'Januari' },
    { value: 2, label: 'Februari' },
    { value: 3, label: 'Maret' },
    { value: 4, label: 'April' },
    { value: 5, label: 'Mei' },
    { value: 6, label: 'Juni' },
    { value: 7, label: 'Juli' },
    { value: 8, label: 'Agustus' },
    { value: 9, label: 'September' },
    { value: 10, label: 'Oktober' },
    { value: 11, label: 'November' },
    { value: 12, label: 'Desember' },
  ]

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)

  const handleGenerateReport = async () => {
    setIsLoading(true)
    try {
      let fromDate: Date
      let toDate: Date

      if (filterType === 'monthly') {
        // Untuk filter bulanan, gunakan hari pertama dan terakhir bulan
        const firstDay = format(startOfMonth(new Date(selectedYear, selectedMonth - 1)), 'yyyy-MM-dd')
        const lastDay = format(endOfMonth(new Date(selectedYear, selectedMonth - 1)), 'yyyy-MM-dd')
        fromDate = toOfficeStartOfDay(firstDay, timezone)
        toDate = toOfficeEndOfDay(lastDay, timezone)
      } else {
        // Gunakan timezone kantor untuk konversi tanggal
        // Ini memastikan filter bekerja dengan benar terlepas dari timezone browser
        fromDate = toOfficeStartOfDay(startDate, timezone)
        toDate = toOfficeEndOfDay(endDate, timezone)
      }

      console.log('[TransactionItemsReport] Date filter with office timezone:', {
        timezone,
        startDate,
        endDate,
        fromDateISO: fromDate.toISOString(),
        toDateISO: toDate.toISOString(),
      })

      const items: SoldProduct[] = []

      // 1. Fetch delivered items from delivery_items table
      if (sourceFilter === 'all' || sourceFilter === 'delivery') {
        let deliveryQuery = supabase
          .from('deliveries')
          .select(`
            id,
            transaction_id,
            delivery_date,
            created_at,
            driver_id,
            driver:profiles!deliveries_driver_id_fkey(full_name),
            delivery_items(
              id,
              product_id,
              product_name,
              quantity_delivered,
              unit
            ),
            transaction:transactions!deliveries_transaction_id_fkey(
              id,
              customer_name,
              order_date,
              cashier_id,
              retasi_id,
              sales_name,
              payment_account_id,
              payment_status,
              cashier:profiles!transactions_cashier_id_fkey(full_name),
              items
            )
          `)
          .gte('delivery_date', fromDate.toISOString())
          .lte('delivery_date', toDate.toISOString())

        if (currentBranch?.id) {
          deliveryQuery = deliveryQuery.eq('branch_id', currentBranch.id)
        }

        const { data: deliveryData, error: deliveryError } = await deliveryQuery

        if (deliveryError) {
          console.error('Error fetching deliveries:', deliveryError)
        } else if (deliveryData) {
          // Fetch ALL retasi records for the branch (no date filter for more reliable matching)
          let allRetasiList: any[] = []
          if (currentBranch?.id) {
            const { data: allRetasi } = await supabase
              .from('retasi')
              .select('id, retasi_number, retasi_ke, driver_name, departure_date, created_at')
              .eq('branch_id', currentBranch.id)
              .order('departure_date', { ascending: false })

            if (allRetasi) {
              allRetasiList = allRetasi
              console.log('[Report] Fetched retasi:', allRetasi.length, 'sample:', allRetasi.slice(0, 2))
            }
          }

          deliveryData.forEach((delivery: any) => {
            const deliveryDate = new Date(delivery.delivery_date)
            // Get local date string (not UTC) to match DB departure_date format
            const year = deliveryDate.getFullYear()
            const month = String(deliveryDate.getMonth() + 1).padStart(2, '0')
            const day = String(deliveryDate.getDate()).padStart(2, '0')
            const deliveryDateStr = `${year}-${month}-${day}`

            const transaction = delivery.transaction
            const transactionItems = transaction?.items || []
            const driverName = delivery.driver?.full_name || ''

            // Find retasi: Priority 1: Direct link via transaction.retasi_id
            let retasiInfo = null

            // 1. Try to find by explicit ID first
            if (transaction?.retasi_id && allRetasiList.length > 0) {
              retasiInfo = allRetasiList.find(r => r.id === transaction.retasi_id)
            }

            // 2. Fallback: match by driver name and date if no explicit ID
            if (!retasiInfo && driverName && allRetasiList.length > 0) {
              const driverNameLower = driverName.toLowerCase().trim()

              // Find matching retasi
              // Find ALL matching retasis
              const candidates = allRetasiList.filter(r => {
                const retasiDriver = (r.driver_name || '').toLowerCase().trim()
                const retasiDate = r.departure_date // YYYY-MM-DD string from DB

                // Flexible name matching (contains or exact)
                const nameMatch = retasiDriver.includes(driverNameLower) ||
                  driverNameLower.includes(retasiDriver) ||
                  retasiDriver === driverNameLower

                // Date matching
                const dateMatch = retasiDate === deliveryDateStr

                return nameMatch && dateMatch
              })

              if (candidates.length === 1) {
                // Exact single match
                retasiInfo = candidates[0]
              } else if (candidates.length > 1) {
                // Multiple matches (e.g., Retasi 1, Retasi 2 on same day)
                // Heuristic: Use created_at timestamps. The delivery should belong to the retasi active at that time.
                // Or, simply, associate with the retasi created most recently BEFORE the delivery.

                const deliveryTime = new Date(delivery.created_at || delivery.delivery_date).getTime()

                // Sort candidates by creation time ASC
                candidates.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

                // Find the candidate that was created most recently before deliveryTime
                // Default to the last one if all are before (or if timestamps are weird)
                let bestMatch = candidates[candidates.length - 1]

                for (let i = candidates.length - 1; i >= 0; i--) {
                  const rTime = new Date(candidates[i].created_at).getTime()
                  if (rTime <= deliveryTime) {
                    bestMatch = candidates[i]
                    break
                  }
                }
                retasiInfo = bestMatch
              }
            }

            if (!retasiInfo) {
              console.log('[Report] No retasi match for:', driverName, deliveryDateStr)
            }


            // Display just "ke-X" if found
            const retasiNumberDisplay = retasiInfo
              ? `ke-${retasiInfo.retasi_ke}`
              : '-'

            const driverNameDisplay = driverName

            delivery.delivery_items?.forEach((item: any) => {
              const matchingTxItem = transactionItems.find((ti: any) =>
                ti.product?.id === item.product_id || ti.productId === item.product_id
              )

              const isBonus = item.product_name?.toLowerCase().includes('bonus') ||
                Boolean(matchingTxItem?.isBonus)

              const priceRaw = matchingTxItem?.price || matchingTxItem?.product?.basePrice || 0
              const price = isBonus ? 0 : priceRaw

              // Double check payment account mapping
              const paymentAcctId = transaction?.payment_account_id
              const paymentAcct = paymentAccounts.find(a => a.id === paymentAcctId)

              items.push({
                transactionId: delivery.transaction_id,
                transactionDate: new Date(transaction?.order_date || delivery.delivery_date),
                soldDate: deliveryDate,
                customerName: transaction?.customer_name || 'Unknown',
                productName: item.product_name,
                quantity: item.quantity_delivered,
                unit: item.unit || 'pcs',
                price: price,
                total: item.quantity_delivered * price,
                source: 'delivery',
                driverName: driverNameDisplay,
                retasiNumber: retasiNumberDisplay,
                retasiKe: retasiInfo?.retasi_ke,
                cashierName: transaction?.cashier?.full_name || 'Unknown',
                isBonus: isBonus,
                paymentAccountId: paymentAcctId,
                paymentAccountName: paymentAcct?.name,
                paymentStatus: transaction?.payment_status || 'Belum Lunas',
                salesName: extractSalesName(transaction)
              })
            })
          })
        }
      }

      // 2. Fetch office sale transactions (laku kantor)
      if (sourceFilter === 'all' || sourceFilter === 'office_sale') {
        let officeSaleQuery = supabase
          .from('transactions')
          .select(`
            id,
            customer_name,
            order_date,
            items,
            cashier_id,
            sales_name,
            payment_account_id,
            payment_status,
            cashier:profiles!transactions_cashier_id_fkey(full_name)
          `)
          .eq('is_office_sale', true)
          .gte('order_date', fromDate.toISOString())
          .lte('order_date', toDate.toISOString())
          .eq('is_voided', false)
          .eq('is_cancelled', false)

        if (currentBranch?.id) {
          officeSaleQuery = officeSaleQuery.eq('branch_id', currentBranch.id)
        }

        const { data: officeSaleData, error: officeSaleError } = await officeSaleQuery

        if (officeSaleError) {
          console.error('Error fetching office sales:', officeSaleError)
        } else if (officeSaleData) {
          officeSaleData.forEach((transaction: any) => {
            const orderDate = new Date(transaction.order_date)
            const transactionItems = transaction.items || []

            transactionItems.forEach((item: any) => {
              // Skip metadata items (sales meta, migration meta)
              if (item._isSalesMeta || item._isMigrationMeta) return

              // Skip items without product info
              if (!item.product?.name && !item.name && !item.productName && !item.product_name) return

              const productName = item.product?.name || item.name || item.productName || item.product_name
              const isBonus = Boolean(item.isBonus) || productName.toLowerCase().includes('bonus')

              const priceRaw = item.price || item.product?.basePrice || 0
              const price = isBonus ? 0 : priceRaw
              const quantity = item.quantity || 0

              // Get payment account name
              const paymentAcct = paymentAccounts.find(a => a.id === transaction.payment_account_id)

              items.push({
                transactionId: transaction.id,
                transactionDate: orderDate,
                soldDate: orderDate, // For office sale, sold date = order date
                customerName: transaction.customer_name || 'Walk-in Customer',
                productName: productName,
                quantity: quantity,
                unit: item.unit || item.product?.unit || 'pcs',
                price: price,
                total: quantity * price,
                source: 'office_sale',
                driverName: undefined,
                cashierName: transaction.cashier?.full_name || 'Unknown',
                isBonus: isBonus,
                paymentAccountId: transaction.payment_account_id,
                paymentAccountName: paymentAcct?.name,
                paymentStatus: transaction.payment_status || 'Belum Lunas',
                salesName: extractSalesName(transaction)
              })
            })
          })
        }
      }

      // 3. Fetch retasi transactions (from Driver POS - transactions with retasi_id)
      // Driver POS = MUST have retasi (driver can't sell without active retasi)
      // Regular POS = NO retasi
      if (sourceFilter === 'all' || sourceFilter === 'retasi') {
        // Get transactions that have retasi_id (from Driver POS)
        let retasiQuery = supabase
          .from('transactions')
          .select(`
            id,
            customer_name,
            order_date,
            items,
            retasi_id,
            retasi_number,
            cashier_name,
            sales_name,
            payment_account_id,
            payment_status
          `)
          .not('retasi_id', 'is', null)
          .gte('order_date', fromDate.toISOString())
          .lte('order_date', toDate.toISOString())
          .eq('is_voided', false)
          .eq('is_cancelled', false)

        if (currentBranch?.id) {
          retasiQuery = retasiQuery.eq('branch_id', currentBranch.id)
        }

        const { data: retasiTransactions, error: retasiError } = await retasiQuery

        console.log('Retasi Transactions (Driver POS):', { retasiTransactions, retasiError })

        if (retasiError) {
          console.error('Error fetching retasi transactions:', retasiError)
        } else if (retasiTransactions && retasiTransactions.length > 0) {
          // Get retasi details for display
          const retasiIds = [...new Set(retasiTransactions.map(t => t.retasi_id).filter(Boolean))]

          let retasiDetailsMap: Record<string, any> = {}
          if (retasiIds.length > 0) {
            const { data: retasiDetails } = await supabase
              .from('retasi')
              .select('id, retasi_number, retasi_ke, driver_name')
              .in('id', retasiIds)

            if (retasiDetails) {
              retasiDetails.forEach(r => {
                retasiDetailsMap[r.id] = r
              })
            }
          }

          // Skip transactions already counted in delivery
          const deliveryTransactionIds = new Set(items.filter(i => i.source === 'delivery').map(i => i.transactionId))

          retasiTransactions.forEach((transaction: any) => {
            // Skip if already counted in delivery
            if (deliveryTransactionIds.has(transaction.id)) return

            const orderDate = new Date(transaction.order_date)
            const transactionItems = transaction.items || []
            const retasiInfo = retasiDetailsMap[transaction.retasi_id]

            transactionItems.forEach((item: any) => {
              // Skip metadata items (sales meta, migration meta)
              if (item._isSalesMeta || item._isMigrationMeta) return

              // Skip items without product info
              if (!item.product?.name && !item.name && !item.productName && !item.product_name) return

              const productName = item.product?.name || item.name || item.productName || item.product_name
              const isBonus = Boolean(item.isBonus) || productName.toLowerCase().includes('bonus')

              const priceRaw = item.price || item.product?.basePrice || 0
              const price = isBonus ? 0 : priceRaw
              const quantity = item.quantity || 0

              // Format retasi number with "ke-X" suffix
              const retasiNumberDisplay = retasiInfo
                ? `${retasiInfo.retasi_number} (ke-${retasiInfo.retasi_ke})`
                : (transaction.retasi_number || '-')

              // Get payment account name
              const paymentAcct = paymentAccounts.find(a => a.id === transaction.payment_account_id)

              items.push({
                transactionId: transaction.id,
                transactionDate: orderDate,
                soldDate: orderDate,
                customerName: transaction.customer_name || 'Customer Retasi',
                productName: productName,
                quantity: quantity,
                unit: item.unit || item.product?.unit || 'pcs',
                price: price,
                total: quantity * price,
                source: 'retasi',
                retasiNumber: retasiNumberDisplay,
                retasiKe: retasiInfo?.retasi_ke,
                driverName: retasiInfo?.driver_name || transaction.cashier_name,
                cashierName: transaction.cashier_name || 'Unknown',
                isBonus: isBonus,
                paymentAccountId: transaction.payment_account_id,
                paymentAccountName: paymentAcct?.name,
                paymentStatus: transaction.payment_status || 'Belum Lunas',
                salesName: extractSalesName(transaction)
              })
            })
          })
        }
      }

      // 4. Fetch direct sale transactions (non-office sale without delivery/retasi - includes migration data and pos kasir)
      // These are transactions that don't have delivery records and don't have retasi_id
      if (sourceFilter === 'all' || sourceFilter === 'migration' || sourceFilter === 'pos_kasir') {
        // Get all transaction IDs that already have deliveries (no date filter - we want ALL deliveries)
        // This ensures transactions with delivery records outside the date range are properly excluded
        let deliveredTxQuery = supabase
          .from('deliveries')
          .select('transaction_id')

        if (currentBranch?.id) {
          deliveredTxQuery = deliveredTxQuery.eq('branch_id', currentBranch.id)
        }

        const { data: deliveredTxData } = await deliveredTxQuery
        const deliveredTxIds = new Set((deliveredTxData || []).map(d => d.transaction_id))

        // Get transactions that are NOT office_sale, NOT retasi, and NOT delivered
        let directSaleQuery = supabase
          .from('transactions')
          .select(`
            id,
            customer_name,
            order_date,
            items,
            cashier_id,
            sales_name,
            payment_account_id,
            payment_status,
            cashier:profiles!transactions_cashier_id_fkey(full_name)
          `)
          .or('is_office_sale.eq.false,is_office_sale.is.null')
          .is('retasi_id', null)
          .gte('order_date', fromDate.toISOString())
          .lte('order_date', toDate.toISOString())
          .eq('is_voided', false)
          .eq('is_cancelled', false)

        if (currentBranch?.id) {
          directSaleQuery = directSaleQuery.eq('branch_id', currentBranch.id)
        }

        const { data: directSaleData, error: directSaleError } = await directSaleQuery

        if (directSaleError) {
          console.error('Error fetching direct sales:', directSaleError)
        } else if (directSaleData) {
          // Filter out transactions that already have deliveries
          const directSalesWithoutDelivery = directSaleData.filter(t => !deliveredTxIds.has(t.id))

          console.log('Direct Sales (without delivery):', directSalesWithoutDelivery.length)

          directSalesWithoutDelivery.forEach((transaction: any) => {
            const orderDate = new Date(transaction.order_date)
            const transactionItems = transaction.items || []

            // Check if transaction has migration metadata
            const hasMigrationMeta = transactionItems.some((item: any) => item._isMigrationMeta)
            const sourceType = hasMigrationMeta ? 'migration' : 'pos_kasir'

            transactionItems.forEach((item: any) => {
              // Skip metadata items (sales meta, migration meta)
              if (item._isSalesMeta || item._isMigrationMeta) return

              // Skip items without product info
              if (!item.product?.name && !item.name && !item.productName && !item.product_name) return

              const productName = item.product?.name || item.name || item.productName || item.product_name
              const isBonus = Boolean(item.isBonus) || productName.toLowerCase().includes('bonus')

              const priceRaw = item.price || item.product?.basePrice || 0
              const price = isBonus ? 0 : priceRaw
              const quantity = item.quantity || 0

              // Get payment account name
              const paymentAcct = paymentAccounts.find(a => a.id === transaction.payment_account_id)

              items.push({
                transactionId: transaction.id,
                transactionDate: orderDate,
                soldDate: orderDate,
                customerName: transaction.customer_name || 'Customer',
                productName: productName,
                quantity: quantity,
                unit: item.unit || item.product?.unit || 'pcs',
                price: price,
                total: quantity * price,
                source: sourceType,
                driverName: undefined,
                cashierName: transaction.cashier?.full_name || 'Unknown',
                isBonus: isBonus,
                paymentAccountId: transaction.payment_account_id,
                paymentAccountName: paymentAcct?.name,
                paymentStatus: transaction.payment_status || 'Belum Lunas',
                salesName: extractSalesName(transaction)
              })
            })
          })
        }
      }

      // Sort by sold date (newest first)
      items.sort((a, b) => b.soldDate.getTime() - a.soldDate.getTime())

      // Extract unique product names for filter dropdown
      const uniqueProducts = [...new Set(
        items.map(item => item.productName).filter(Boolean)
      )].sort()
      setAvailableProducts(uniqueProducts)

      // Extract unique driver/kasir names for filter dropdown
      const uniqueDriversKasir = [...new Set(
        items.map(item => {
          if (item.source === 'delivery' || item.source === 'retasi') {
            return item.driverName || ''
          }
          return item.cashierName || ''
        }).filter(Boolean)
      )].sort()
      setAvailableDriversKasir(uniqueDriversKasir)

      // Extract unique retasi_ke values for filter dropdown
      const uniqueRetasiKe = [...new Set(
        items
          .filter(item => item.retasiKe !== undefined && item.retasiKe !== null)
          .map(item => item.retasiKe as number)
      )].sort((a, b) => a - b)
      setAvailableRetasiKe(uniqueRetasiKe.map(ke => ({
        value: ke.toString(),
        label: `Retasi Ke-${ke}`
      })))

      // Extract unique sales names for filter dropdown
      const uniqueSales = [...new Set(
        items
          .map(item => item.salesName)
          .filter((name): name is string => !!name)
      )].sort()
      setAvailableSales(uniqueSales)

      setAllItems(items) // Store all items for client-side filtering
    } catch (error) {
      console.error('Error generating report:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const getReportTitle = () => {
    const productFilterText = productFilter === 'all' ? '' : ` (${productFilter})`
    const sourceText = sourceFilter === 'all' ? '' :
      sourceFilter === 'delivery' ? ' - Pengantaran' :
        sourceFilter === 'office_sale' ? ' - Laku Kantor' : ' - Retasi'

    if (filterType === 'monthly') {
      const monthName = months.find(m => m.value === selectedMonth)?.label
      return `Laporan Produk Laku${productFilterText}${sourceText} - ${monthName} ${selectedYear}`
    } else {
      return `Laporan Produk Laku${productFilterText}${sourceText} - ${format(new Date(startDate), 'dd MMM yyyy', { locale: id })} s/d ${format(new Date(endDate), 'dd MMM yyyy', { locale: id })}`
    }
  }

  const handlePrintReport = () => {
    const doc = new jsPDF('landscape')
    const title = getReportTitle()

    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.text(title, 14, 22)

    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text(`Digenerate pada: ${format(new Date(), 'dd MMMM yyyy HH:mm', { locale: id })}`, 14, 30)
    doc.text(`Sumber: Pengantaran + Laku Kantor + Retasi`, 14, 36)

    const tableData = reportData.map(item => [
      format(item.soldDate, 'dd/MM/yyyy'),
      item.transactionId.substring(0, 8) + '...',
      item.customerName,
      item.isBonus ? `${item.productName} [BONUS]` : item.productName,
      item.quantity.toString(),
      `Rp ${item.price.toLocaleString()}`,
      `Rp ${item.total.toLocaleString()}`,
      item.source === 'delivery' ? 'Diantar' : item.source === 'office_sale' ? 'Laku Kantor' : item.source === 'retasi' ? 'Retasi' : 'Migrasi',
      item.retasiNumber || '-',
      item.source === 'delivery' ? (item.driverName || '-') :
        item.source === 'retasi' ? (item.driverName || '-') : item.cashierName,
      item.salesName || '-',
      item.paymentAccountName || '-',
      item.paymentStatus || 'Belum Lunas'
    ])

    autoTable(doc, {
      head: [['Tanggal', 'No. Trx', 'Customer', 'Produk', 'Qty', 'Harga', 'Total', 'Sumber', 'Retasi', 'Supir/Kasir', 'Sales', 'Akun Bayar', 'Status']],
      body: tableData,
      startY: 42,
      styles: { fontSize: 6 },
      headStyles: { fillColor: [66, 139, 202] },
      columnStyles: {
        0: { cellWidth: 17 },
        1: { cellWidth: 16 },
        2: { cellWidth: 22 },
        3: { cellWidth: 30 },
        4: { cellWidth: 9 },
        5: { cellWidth: 18 },
        6: { cellWidth: 20 },
        7: { cellWidth: 14 },
        8: { cellWidth: 18 }, // Retasi
        9: { cellWidth: 22 }, // Supir/Kasir
        10: { cellWidth: 22 }, // Sales
        11: { cellWidth: 22 }, // Akun Bayar
        12: { cellWidth: 17 }  // Status
      }
    })

    const finalY = (doc as any).lastAutoTable.finalY + 10
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text('Ringkasan Produk Laku:', 14, finalY)

    // Calculate product aggregation
    const productSummaryMap: Record<string, { quantity: number, total: number, unit: string }> = {}
    reportData.forEach(item => {
      const key = item.isBonus ? `${item.productName} [BONUS]` : item.productName
      if (!productSummaryMap[key]) {
        productSummaryMap[key] = { quantity: 0, total: 0, unit: item.unit }
      }
      productSummaryMap[key].quantity += item.quantity
      productSummaryMap[key].total += item.total
    })

    const productSummaryTable = Object.entries(productSummaryMap)
      .map(([name, data]) => [
        name,
        data.quantity.toString(),
        data.unit || 'pcs',
        `Rp ${data.total.toLocaleString()}`
      ])
      .sort((a, b) => (b[1] as any) - (a[1] as any))

    autoTable(doc, {
      head: [['Produk', 'Total Qty', 'Unit', 'Total Nilai']],
      body: productSummaryTable,
      startY: finalY + 5,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [52, 152, 219] },
      columnStyles: {
        1: { halign: 'center', cellWidth: 20 },
        2: { halign: 'center', cellWidth: 20 },
        3: { halign: 'right', cellWidth: 40 }
      }
    })

    const finalSummaryY = (doc as any).lastAutoTable.finalY + 10
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text('Statistik Umum:', 14, finalSummaryY)

    const totalItems = reportData.length
    const totalQuantity = reportData.reduce((sum, item) => sum + item.quantity, 0)
    const totalValue = reportData.reduce((sum, item) => sum + item.total, 0)
    const uniqueTransactions = new Set(reportData.map(item => item.transactionId)).size
    const deliveryItems = reportData.filter(item => item.source === 'delivery').length
    const officeSaleItems = reportData.filter(item => item.source === 'office_sale').length
    const retasiItems = reportData.filter(item => item.source === 'retasi').length
    const migrationItems = reportData.filter(item => item.source === 'migration').length
    const posKasirItems = reportData.filter(item => item.source === 'pos_kasir').length
    const regularItems = reportData.filter(item => !item.isBonus).length
    const bonusItems = reportData.filter(item => item.isBonus).length

    doc.setFont('helvetica', 'normal')
    doc.text(`• Total Entri: ${totalItems} (Diantar: ${deliveryItems}, Laku Kantor: ${officeSaleItems}, Retasi: ${retasiItems}, Migrasi: ${migrationItems}, Pos Kasir: ${posKasirItems})`, 14, finalSummaryY + 8)
    if (productFilter === 'all') {
      doc.text(`• Produk Reguler: ${regularItems}, Produk Bonus: ${bonusItems}`, 14, finalSummaryY + 16)
      doc.text(`• Total Seluruh Quantity: ${totalQuantity}`, 14, finalSummaryY + 24)
      doc.text(`• Total Seluruh Nilai: Rp ${totalValue.toLocaleString()}`, 14, finalSummaryY + 32)
      doc.text(`• Total Transaksi Unik: ${uniqueTransactions}`, 14, finalSummaryY + 40)
    } else {
      doc.text(`• Total Seluruh Quantity: ${totalQuantity}`, 14, finalSummaryY + 16)
      doc.text(`• Total Seluruh Nilai: Rp ${totalValue.toLocaleString()}`, 14, finalSummaryY + 24)
      doc.text(`• Total Transaksi Unik: ${uniqueTransactions}`, 14, finalSummaryY + 32)
    }

    const filterSuffix = productFilter !== 'all' ? `-${productFilter.replace(/\s+/g, '')}` : ''
    const sourceSuffix = sourceFilter === 'delivery' ? '-Pengantaran' :
      sourceFilter === 'office_sale' ? '-LakuKantor' :
        sourceFilter === 'retasi' ? '-Retasi' : ''
    const filename = filterType === 'monthly'
      ? `Laporan-Produk-Laku${filterSuffix}${sourceSuffix}-${months.find(m => m.value === selectedMonth)?.label}-${selectedYear}.pdf`
      : `Laporan-Produk-Laku${filterSuffix}${sourceSuffix}-${format(new Date(startDate), 'dd-MM-yyyy')}-to-${format(new Date(endDate), 'dd-MM-yyyy')}.pdf`
    doc.save(filename)
  }

  const handleExportExcel = () => {
    const title = getReportTitle()

    // Prepare data for Excel
    const excelData = reportData.map(item => ({
      'Tanggal Laku': format(item.soldDate, 'dd/MM/yyyy'),
      'No. Transaksi': item.transactionId.substring(0, 8) + '...',
      'Customer': item.customerName,
      'Produk': item.isBonus ? `${item.productName} [BONUS]` : item.productName,
      'Qty': item.quantity,
      'Unit': item.unit,
      'Harga': item.price,
      'Total': item.total,
      'Sumber': item.source === 'delivery' ? 'Diantar' : item.source === 'office_sale' ? 'Laku Kantor' : item.source === 'retasi' ? 'Retasi' : item.source === 'migration' ? 'Migrasi' : 'Laku Pos Kasir',
      'Retasi': item.retasiNumber || '-',
      'Supir/Kasir': item.source === 'delivery' || item.source === 'retasi' ? (item.driverName || '-') : item.cashierName,
      'Sales': item.salesName || '-',
      'Akun Pembayaran': item.paymentAccountName || '-',
      'Status': item.paymentStatus || 'Belum Lunas'
    }))

    // Create workbook and worksheet
    const ws = XLSX.utils.json_to_sheet(excelData)

    // Add title row at the beginning
    XLSX.utils.sheet_add_aoa(ws, [[title]], { origin: 'A1' })
    XLSX.utils.sheet_add_aoa(ws, [[`Digenerate pada: ${format(new Date(), 'dd MMMM yyyy HH:mm', { locale: id })}`]], { origin: 'A2' })
    XLSX.utils.sheet_add_aoa(ws, [['']], { origin: 'A3' })

    // Re-add data with header starting from row 4
    const headers = ['Tanggal Laku', 'No. Transaksi', 'Customer', 'Produk', 'Qty', 'Unit', 'Harga', 'Total', 'Sumber', 'Retasi', 'Supir/Kasir', 'Sales', 'Akun Pembayaran', 'Status']
    XLSX.utils.sheet_add_aoa(ws, [headers], { origin: 'A4' })

    // Add data rows starting from row 5
    const dataRows = excelData.map(item => Object.values(item))
    XLSX.utils.sheet_add_aoa(ws, dataRows, { origin: 'A5' })

    // Add summary at the end
    const totalItems = reportData.length
    const totalQuantity = reportData.reduce((sum, item) => sum + item.quantity, 0)
    const totalValue = reportData.reduce((sum, item) => sum + item.total, 0)
    const uniqueTransactions = new Set(reportData.map(item => item.transactionId)).size
    const deliveryItems = reportData.filter(item => item.source === 'delivery').length
    const officeSaleItems = reportData.filter(item => item.source === 'office_sale').length
    const retasiItems = reportData.filter(item => item.source === 'retasi').length
    const migrationItems = reportData.filter(item => item.source === 'migration').length
    const posKasirItems = reportData.filter(item => item.source === 'pos_kasir').length

    // Calculate product aggregation for Excel
    const productSummaryMap: Record<string, { quantity: number, total: number, unit: string }> = {}
    reportData.forEach(item => {
      const key = item.isBonus ? `${item.productName} [BONUS]` : item.productName
      if (!productSummaryMap[key]) {
        productSummaryMap[key] = { quantity: 0, total: 0, unit: item.unit }
      }
      productSummaryMap[key].quantity += item.quantity
      productSummaryMap[key].total += item.total
    })

    const productSummaryRows = Object.entries(productSummaryMap)
      .map(([name, data]) => [name, data.quantity, data.unit, data.total])
      .sort((a, b) => (b[1] as any) - (a[1] as any))

    const summaryStartRow = 5 + excelData.length + 2
    XLSX.utils.sheet_add_aoa(ws, [
      ['RINGKASAN PER PRODUK'],
      ['Produk', 'Total Qty', 'Unit', 'Total Nilai'],
      ...productSummaryRows,
      [''],
      ['STATISTIK UMUM'],
      [`Total Entri: ${totalItems} (Diantar: ${deliveryItems}, Laku Kantor: ${officeSaleItems}, Retasi: ${retasiItems}, Migrasi: ${migrationItems}, Pos Kasir: ${posKasirItems})`],
      [`Total Seluruh Quantity: ${totalQuantity}`],
      [`Total Seluruh Nilai: Rp ${totalValue.toLocaleString()}`],
      [`Total Transaksi Unik: ${uniqueTransactions}`]
    ], { origin: `A${summaryStartRow}` })

    // Set column widths
    ws['!cols'] = [
      { wch: 12 }, // Tanggal
      { wch: 15 }, // No. Transaksi
      { wch: 25 }, // Customer
      { wch: 35 }, // Produk
      { wch: 8 },  // Qty
      { wch: 10 }, // Unit
      { wch: 15 }, // Harga
      { wch: 18 }, // Total
      { wch: 15 }, // Sumber
      { wch: 25 }, // Retasi
      { wch: 20 }, // Supir/Kasir
      { wch: 20 }, // Akun Pembayaran
      { wch: 12 }  // Status
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Produk Laku')

    // Generate filename
    const filterSuffix = productFilter !== 'all' ? `-${productFilter.replace(/\s+/g, '')}` : ''
    const sourceSuffix = sourceFilter === 'delivery' ? '-Pengantaran' :
      sourceFilter === 'office_sale' ? '-LakuKantor' :
        sourceFilter === 'retasi' ? '-Retasi' : ''
    const filename = filterType === 'monthly'
      ? `Laporan-Produk-Laku${filterSuffix}${sourceSuffix}-${months.find(m => m.value === selectedMonth)?.label}-${selectedYear}.xlsx`
      : `Laporan-Produk-Laku${filterSuffix}${sourceSuffix}-${format(new Date(startDate), 'dd-MM-yyyy')}-to-${format(new Date(endDate), 'dd-MM-yyyy')}.xlsx`

    XLSX.writeFile(wb, filename)
  }

  const getSourceBadge = (source: 'delivery' | 'office_sale' | 'retasi' | 'migration' | 'pos_kasir', retasiNumber?: string) => {
    if (source === 'delivery') {
      return (
        <Badge variant="secondary" className="bg-blue-100 text-blue-800 border-blue-300">
          <Truck className="h-3 w-3 mr-1" />
          Diantar
        </Badge>
      )
    }
    if (source === 'retasi') {
      return (
        <Badge variant="secondary" className="bg-purple-100 text-purple-800 border-purple-300">
          <Navigation className="h-3 w-3 mr-1" />
          {retasiNumber ? `Retasi ${retasiNumber}` : 'Retasi'}
        </Badge>
      )
    }
    if (source === 'migration') {
      return (
        <Badge variant="secondary" className="bg-orange-100 text-orange-800 border-orange-300">
          <Package className="h-3 w-3 mr-1" />
          Migrasi
        </Badge>
      )
    }
    if (source === 'pos_kasir') {
      return (
        <Badge variant="secondary" className="bg-cyan-100 text-cyan-800 border-cyan-300">
          <ShoppingCart className="h-3 w-3 mr-1" />
          Pos Kasir
        </Badge>
      )
    }
    return (
      <Badge variant="secondary" className="bg-green-100 text-green-800 border-green-300">
        <Store className="h-3 w-3 mr-1" />
        Laku Kantor
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Laporan Produk Laku
          </CardTitle>
          <CardDescription>
            Laporan produk yang sudah laku berdasarkan pengantaran, laku kantor, retasi, data migrasi, dan penjualan pos kasir
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            {/* Filter Type Selection */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Jenis Filter</Label>
                <Select value={filterType} onValueChange={(value: 'monthly' | 'dateRange') => setFilterType(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Bulanan</SelectItem>
                    <SelectItem value="dateRange">Rentang Tanggal</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1">
                  <Package className="h-3 w-3" />
                  Item Produk
                </Label>
                <Select value={productFilter} onValueChange={setProductFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Semua Produk" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Produk</SelectItem>
                    {availableProducts.map(product => (
                      <SelectItem key={product} value={product}>
                        {product}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Sumber</Label>
                <Select value={sourceFilter} onValueChange={(value: 'all' | 'delivery' | 'office_sale' | 'retasi' | 'migration' | 'pos_kasir') => setSourceFilter(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Sumber</SelectItem>
                    <SelectItem value="delivery">Pengantaran</SelectItem>
                    <SelectItem value="office_sale">Laku Kantor</SelectItem>
                    <SelectItem value="retasi">Retasi</SelectItem>
                    <SelectItem value="migration">Data Migrasi</SelectItem>
                    <SelectItem value="pos_kasir">Laku Pos Kasir</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1">
                  <Navigation className="h-3 w-3" />
                  Retasi Ke
                </Label>
                <Select value={retasiKeFilter} onValueChange={setRetasiKeFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Semua" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Retasi</SelectItem>
                    {availableRetasiKe.map(item => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1">
                  <User className="h-3 w-3" />
                  Supir/Kasir
                </Label>
                <Select value={driverKasirFilter} onValueChange={setDriverKasirFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Semua" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Supir/Kasir</SelectItem>
                    {availableDriversKasir.map(name => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Payment Account, Status & Sales Filter */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1">
                  <Wallet className="h-3 w-3" />
                  Akun Pembayaran
                </Label>
                <Select value={paymentAccountFilter} onValueChange={setPaymentAccountFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Semua Akun" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Akun Pembayaran</SelectItem>
                    {paymentAccounts.map(account => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.code ? `${account.code} - ${account.name}` : account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1">
                  <CreditCard className="h-3 w-3" />
                  Status Pembayaran
                </Label>
                <Select value={paymentStatusFilter} onValueChange={(value: 'all' | 'Lunas' | 'Belum Lunas') => setPaymentStatusFilter(value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Semua Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Status</SelectItem>
                    <SelectItem value="Lunas">Lunas</SelectItem>
                    <SelectItem value="Belum Lunas">Belum Lunas</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1">
                  <UserCheck className="h-3 w-3" />
                  Sales
                </Label>
                <Select value={salesFilter} onValueChange={setSalesFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Semua Sales" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Sales</SelectItem>
                    {availableSales.map(name => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Monthly Filter */}
            {filterType === 'monthly' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Bulan</Label>
                  <Select value={selectedMonth.toString()} onValueChange={(value) => setSelectedMonth(Number(value))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {months.map(month => (
                        <SelectItem key={month.value} value={month.value.toString()}>
                          {month.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Tahun</Label>
                  <Select value={selectedYear.toString()} onValueChange={(value) => setSelectedYear(Number(value))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {years.map(year => (
                        <SelectItem key={year} value={year.toString()}>
                          {year}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Date Range Filter */}
            {filterType === 'dateRange' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <CalendarDays className="h-4 w-4" />
                    Tanggal Mulai
                  </Label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <CalendarDays className="h-4 w-4" />
                    Tanggal Selesai
                  </Label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button onClick={handleGenerateReport} disabled={isLoading}>
                <Calendar className="mr-2 h-4 w-4" />
                {isLoading ? 'Generating...' : 'Generate Laporan'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <Card>
          <CardContent className="p-6">
            <div className="space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {reportData.length > 0 && !isLoading && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Hasil Laporan - {filterType === 'monthly'
                  ? `${months.find(m => m.value === selectedMonth)?.label} ${selectedYear}`
                  : `${format(new Date(startDate), 'dd MMM yyyy', { locale: id })} s/d ${format(new Date(endDate), 'dd MMM yyyy', { locale: id })}`
                }
              </CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handlePrintReport}>
                  <Download className="mr-2 h-4 w-4" />
                  Cetak PDF
                </Button>
                <Button variant="outline" size="sm" onClick={handleExportExcel}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Export Excel
                </Button>
              </div>
            </div>

            {/* Summary Cards - Moved to Header */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-9 gap-3 mt-4">
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 text-center">
                <div className="text-xl font-bold">{reportData.length}</div>
                <div className="text-xs text-muted-foreground">Total Produk</div>
              </div>
              <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-blue-600">{reportData.filter(item => item.source === 'delivery').length}</div>
                <div className="text-xs text-muted-foreground">Diantar</div>
              </div>
              <div className="bg-green-50 dark:bg-green-900/30 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-green-600">{reportData.filter(item => item.source === 'office_sale').length}</div>
                <div className="text-xs text-muted-foreground">Laku Kantor</div>
              </div>
              <div className="bg-purple-50 dark:bg-purple-900/30 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-purple-600">{reportData.filter(item => item.source === 'retasi').length}</div>
                <div className="text-xs text-muted-foreground">Retasi</div>
              </div>
              <div className="bg-orange-50 dark:bg-orange-900/30 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-orange-600">{reportData.filter(item => item.source === 'migration').length}</div>
                <div className="text-xs text-muted-foreground">Migrasi</div>
              </div>
              <div className="bg-cyan-50 dark:bg-cyan-900/30 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-cyan-600">{reportData.filter(item => item.source === 'pos_kasir').length}</div>
                <div className="text-xs text-muted-foreground">Pos Kasir</div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 text-center">
                <div className="text-xl font-bold">{reportData.reduce((sum, item) => sum + item.quantity, 0)}</div>
                <div className="text-xs text-muted-foreground">Total Qty</div>
              </div>
              <div className="bg-emerald-50 dark:bg-emerald-900/30 rounded-lg p-3 text-center">
                <div className="text-lg font-bold text-emerald-600">Rp {reportData.reduce((sum, item) => sum + item.total, 0).toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">Total Nilai</div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 text-center">
                <div className="text-xl font-bold">{new Set(reportData.map(item => item.transactionId)).size}</div>
                <div className="text-xs text-muted-foreground">Transaksi</div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            <h3 className="text-lg font-medium">Detail Produk Laku</h3>

            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal Laku</TableHead>
                    <TableHead>No. Transaksi</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Produk</TableHead>
                    <TableHead className="text-center">Qty</TableHead>
                    <TableHead className="text-center">Harga</TableHead>
                    <TableHead className="text-center">Total</TableHead>
                    <TableHead className="text-center">Sumber</TableHead>
                    <TableHead>Retasi</TableHead>
                    <TableHead>Supir/Kasir</TableHead>
                    <TableHead>Sales</TableHead>
                    <TableHead>Akun Bayar</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportData.map((item, index) => (
                    <TableRow key={`${item.transactionId}-${index}`}>
                      <TableCell className="font-mono">
                        {format(item.soldDate, 'dd/MM/yyyy')}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {item.transactionId.substring(0, 8)}...
                      </TableCell>
                      <TableCell className="font-medium">
                        {item.customerName}
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {item.productName}
                            {item.isBonus && (
                              <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-800 border-orange-300">
                                BONUS
                              </Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground">{item.unit}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center font-mono">
                        {item.quantity}
                      </TableCell>
                      <TableCell className="text-center font-mono">
                        Rp {item.price.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-center font-mono font-medium">
                        Rp {item.total.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-center">
                        {getSourceBadge(item.source, item.retasiNumber)}
                      </TableCell>
                      <TableCell className="text-sm font-mono">
                        {item.retasiNumber || '-'}
                      </TableCell>
                      <TableCell className="text-sm">
                        {item.source === 'delivery' || item.source === 'retasi'
                          ? (item.driverName || '-')
                          : item.cashierName}
                      </TableCell>
                      <TableCell className="text-sm">
                        {item.salesName || '-'}
                      </TableCell>
                      <TableCell className="text-sm">
                        {item.paymentAccountName || '-'}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant="secondary"
                          className={item.paymentStatus === 'Lunas'
                            ? 'bg-green-100 text-green-800 border-green-300'
                            : 'bg-yellow-100 text-yellow-800 border-yellow-300'}
                        >
                          {item.paymentStatus || 'Belum Lunas'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {reportData.length === 0 && !isLoading && (
        <Card>
          <CardContent className="text-center py-12">
            <ShoppingCart className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Belum Ada Data</h3>
            <p className="text-muted-foreground">
              Pilih periode dan klik "Generate Laporan" untuk melihat produk yang laku.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Laporan ini menampilkan produk dari pengantaran, laku kantor, retasi, dan data migrasi.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
