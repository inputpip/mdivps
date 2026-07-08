import { useState, useMemo, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ShoppingCart, Truck, Store, Navigation, Loader2, Package, RefreshCw, Search, ChevronDown, ChevronUp, Filter } from 'lucide-react'
import { format } from 'date-fns'
import { id } from 'date-fns/locale/id'
import { supabase } from '@/integrations/supabase/client'
import { useBranch } from '@/contexts/BranchContext'

interface SoldProduct {
  transactionId: string
  soldDate: Date
  customerName: string
  productName: string
  quantity: number
  unit: string
  price: number
  total: number
  source: 'delivery' | 'office_sale' | 'retasi'
  driverName?: string
  cashierName?: string
  retasiKe?: number
  isBonus: boolean
}

export default function MobileSoldItemsPage() {
  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const [startDate, setStartDate] = useState(todayStr)
  const [endDate, setEndDate] = useState(todayStr)
  const [sourceFilter, setSourceFilter] = useState<'all' | 'delivery' | 'office_sale' | 'retasi'>('all')
  const [itemFilter, setItemFilter] = useState<'all' | 'regular' | 'bonus'>('all')
  const [driverFilter, setDriverFilter] = useState<string>('all')
  const [retasiKeFilter, setRetasiKeFilter] = useState<string>('all')
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [reportData, setReportData] = useState<SoldProduct[]>([])
  const [isLoading, setIsLoading] = useState(true) // Start with loading true
  const [hasSearched, setHasSearched] = useState(true) // Start with searched true
  const [initialLoad, setInitialLoad] = useState(true)

  const { currentBranch } = useBranch()

  // Auto-generate report on page load (default: today's data)
  useEffect(() => {
    if (initialLoad) {
      setInitialLoad(false)
      generateReport(todayStr, todayStr, 'all')
    }
  }, [initialLoad])

  const generateReport = async (fromDateStr: string, toDateStr: string, source: 'all' | 'delivery' | 'office_sale' | 'retasi') => {
    setIsLoading(true)
    setHasSearched(true)
    try {
      const fromDate = new Date(fromDateStr)
      const toDate = new Date(toDateStr)
      toDate.setHours(23, 59, 59, 999)

      const items: SoldProduct[] = []

      // 1. Fetch delivered items
      if (source === 'all' || source === 'delivery') {
        let deliveryQuery = supabase
          .from('deliveries')
          .select(`
            id,
            transaction_id,
            delivery_date,
            driver:profiles!deliveries_driver_id_fkey(full_name),
            delivery_items(product_name, quantity_delivered, unit),
            transaction:transactions!deliveries_transaction_id_fkey(
              customer_name,
              items
            )
          `)
          .gte('delivery_date', fromDate.toISOString())
          .lte('delivery_date', toDate.toISOString())

        if (currentBranch?.id) {
          deliveryQuery = deliveryQuery.eq('branch_id', currentBranch.id)
        }

        const { data: deliveryData } = await deliveryQuery

        if (deliveryData) {
          deliveryData.forEach((delivery: any) => {
            const deliveryDate = new Date(delivery.delivery_date)
            const transaction = delivery.transaction
            const transactionItems = transaction?.items || []

            delivery.delivery_items?.forEach((item: any) => {
              const matchingTxItem = transactionItems.find((ti: any) =>
                ti.product?.id === item.product_id || ti.productId === item.product_id
              )

              const isBonus = item.product_name?.includes('BONUS') || Boolean(matchingTxItem?.isBonus)
              const price = matchingTxItem?.price || 0

              items.push({
                transactionId: delivery.transaction_id,
                soldDate: deliveryDate,
                customerName: transaction?.customer_name || 'Unknown',
                productName: item.product_name,
                quantity: item.quantity_delivered,
                unit: item.unit || 'pcs',
                price,
                total: item.quantity_delivered * price,
                source: 'delivery',
                driverName: delivery.driver?.full_name,
                isBonus
              })
            })
          })
        }
      }

      // 2. Fetch office sales
      if (source === 'all' || source === 'office_sale') {
        let officeSaleQuery = supabase
          .from('transactions')
          .select(`
            id, customer_name, order_date, items,
            cashier:profiles!transactions_cashier_id_fkey(full_name)
          `)
          .eq('is_office_sale', true)
          .gte('order_date', fromDate.toISOString())
          .lte('order_date', toDate.toISOString())

        if (currentBranch?.id) {
          officeSaleQuery = officeSaleQuery.eq('branch_id', currentBranch.id)
        }

        const { data: officeSaleData } = await officeSaleQuery

        if (officeSaleData) {
          officeSaleData.forEach((transaction: any) => {
            const orderDate = new Date(transaction.order_date)
            const transactionItems = transaction.items || []
            const cashierName = transaction.cashier?.full_name || 'Unknown'

            transactionItems.forEach((item: any) => {
              const productName = item.product?.name || item.name || 'Unknown'
              const isBonus = Boolean(item.isBonus) || productName.includes('BONUS')
              const price = item.price || 0
              const quantity = item.quantity || 0

              items.push({
                transactionId: transaction.id,
                soldDate: orderDate,
                customerName: transaction.customer_name || 'Walk-in',
                productName,
                quantity,
                unit: item.unit || 'pcs',
                price,
                total: quantity * price,
                source: 'office_sale',
                cashierName,
                isBonus
              })
            })
          })
        }
      }

      // 3. Fetch retasi transactions
      if (source === 'all' || source === 'retasi') {
        let retasiQuery = supabase
          .from('transactions')
          .select('id, customer_name, order_date, items, retasi_id')
          .not('retasi_id', 'is', null)
          .gte('order_date', fromDate.toISOString())
          .lte('order_date', toDate.toISOString())

        if (currentBranch?.id) {
          retasiQuery = retasiQuery.eq('branch_id', currentBranch.id)
        }

        const { data: retasiTransactions } = await retasiQuery

        if (retasiTransactions && retasiTransactions.length > 0) {
          const retasiIds = [...new Set(retasiTransactions.map(t => t.retasi_id).filter(Boolean))]

          let retasiDetailsMap: Record<string, any> = {}
          if (retasiIds.length > 0) {
            const { data: retasiDetails } = await supabase
              .from('retasi')
              .select('id, retasi_ke, driver_name')
              .in('id', retasiIds)

            if (retasiDetails) {
              retasiDetails.forEach(r => {
                retasiDetailsMap[r.id] = r
              })
            }
          }

          const deliveryTransactionIds = new Set(items.filter(i => i.source === 'delivery').map(i => i.transactionId))

          retasiTransactions.forEach((transaction: any) => {
            if (deliveryTransactionIds.has(transaction.id)) return

            const orderDate = new Date(transaction.order_date)
            const transactionItems = transaction.items || []
            const retasiInfo = retasiDetailsMap[transaction.retasi_id]

            transactionItems.forEach((item: any) => {
              if (item._isSalesMeta) return

              const productName = item.product?.name || item.name || 'Unknown'
              const isBonus = Boolean(item.isBonus) || productName.includes('BONUS')
              const price = item.price || 0
              const quantity = item.quantity || 0

              items.push({
                transactionId: transaction.id,
                soldDate: orderDate,
                customerName: transaction.customer_name || 'Customer',
                productName,
                quantity,
                unit: item.unit || 'pcs',
                price,
                total: quantity * price,
                source: 'retasi',
                retasiKe: retasiInfo?.retasi_ke,
                driverName: retasiInfo?.driver_name,
                isBonus
              })
            })
          })
        }
      }

      items.sort((a, b) => b.soldDate.getTime() - a.soldDate.getTime())
      setReportData(items)
    } catch (error) {
      console.error('Error generating report:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleGenerateReport = () => {
    generateReport(startDate, endDate, sourceFilter)
  }

  // Available filter options (derived from data)
  const availableDrivers = useMemo(() => {
    const drivers = new Set<string>()
    reportData.forEach(item => {
      if (item.driverName) drivers.add(item.driverName)
      if (item.cashierName) drivers.add(item.cashierName)
    })
    return Array.from(drivers).sort()
  }, [reportData])

  const availableRetasiKe = useMemo(() => {
    const retasiKes = new Set<number>()
    reportData.forEach(item => {
      if (item.retasiKe) retasiKes.add(item.retasiKe)
    })
    return Array.from(retasiKes).sort((a, b) => a - b)
  }, [reportData])

  // Filtered data
  const filteredData = useMemo(() => {
    return reportData.filter(item => {
      // Item type filter
      if (itemFilter === 'regular' && item.isBonus) return false
      if (itemFilter === 'bonus' && !item.isBonus) return false

      // Driver/Cashier filter
      if (driverFilter !== 'all') {
        const name = item.driverName || item.cashierName || ''
        if (name !== driverFilter) return false
      }

      // Retasi Ke filter
      if (retasiKeFilter !== 'all') {
        if (item.retasiKe !== parseInt(retasiKeFilter)) return false
      }

      return true
    })
  }, [reportData, itemFilter, driverFilter, retasiKeFilter])

  // Summary calculations (using filtered data)
  const summary = useMemo(() => {
    const totalItems = filteredData.length
    const totalQty = filteredData.reduce((sum, item) => sum + item.quantity, 0)
    const totalValue = filteredData.reduce((sum, item) => sum + item.total, 0)
    const deliveryCount = filteredData.filter(i => i.source === 'delivery').length
    const officeCount = filteredData.filter(i => i.source === 'office_sale').length
    const retasiCount = filteredData.filter(i => i.source === 'retasi').length

    return { totalItems, totalQty, totalValue, deliveryCount, officeCount, retasiCount }
  }, [filteredData])

  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0
    if (itemFilter !== 'all') count++
    if (driverFilter !== 'all') count++
    if (retasiKeFilter !== 'all') count++
    return count
  }, [itemFilter, driverFilter, retasiKeFilter])

  const getSourceBadge = (source: 'delivery' | 'office_sale' | 'retasi', retasiKe?: number) => {
    if (source === 'delivery') {
      return (
        <Badge className="bg-blue-100 text-blue-700 text-xs">
          <Truck className="h-3 w-3 mr-1" />
          Antar
        </Badge>
      )
    }
    if (source === 'retasi') {
      return (
        <Badge className="bg-purple-100 text-purple-700 text-xs">
          <Navigation className="h-3 w-3 mr-1" />
          R{retasiKe || '-'}
        </Badge>
      )
    }
    return (
      <Badge className="bg-green-100 text-green-700 text-xs">
        <Store className="h-3 w-3 mr-1" />
        Kantor
      </Badge>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-green-600" />
            <h1 className="text-lg font-bold">Produk Laku</h1>
          </div>
          <div className="text-xs text-muted-foreground">
            {format(new Date(), 'dd MMM yyyy', { locale: id })}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Dari</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Sampai</Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Select value={sourceFilter} onValueChange={(v: any) => setSourceFilter(v)}>
            <SelectTrigger className="flex-1 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Sumber</SelectItem>
              <SelectItem value="delivery">Pengantaran</SelectItem>
              <SelectItem value="office_sale">Laku Kantor</SelectItem>
              <SelectItem value="retasi">Retasi</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className="h-9 px-3 relative"
          >
            <Filter className="h-4 w-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-[10px] rounded-full h-4 w-4 flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </Button>

          <Button onClick={handleGenerateReport} disabled={isLoading} className="h-9 px-4">
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : hasSearched ? (
              <RefreshCw className="h-4 w-4" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Advanced Filters */}
        {showAdvancedFilters && (
          <Card className="bg-gray-50 border-dashed">
            <CardContent className="p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-600">Filter Tambahan</span>
                {activeFilterCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-blue-600"
                    onClick={() => {
                      setItemFilter('all')
                      setDriverFilter('all')
                      setRetasiKeFilter('all')
                    }}
                  >
                    Reset
                  </Button>
                )}
              </div>

              {/* Item Type Filter */}
              <div className="space-y-1">
                <Label className="text-xs">Tipe Item</Label>
                <Select value={itemFilter} onValueChange={(v: any) => setItemFilter(v)}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Item</SelectItem>
                    <SelectItem value="regular">Regular (Non-Bonus)</SelectItem>
                    <SelectItem value="bonus">Bonus Saja</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Driver/Cashier Filter */}
              {availableDrivers.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs">Driver / Kasir</Label>
                  <Select value={driverFilter} onValueChange={setDriverFilter}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua</SelectItem>
                      {availableDrivers.map(name => (
                        <SelectItem key={name} value={name}>{name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Retasi Ke Filter */}
              {availableRetasiKe.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs">Retasi Ke</Label>
                  <Select value={retasiKeFilter} onValueChange={setRetasiKeFilter}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua Retasi</SelectItem>
                      {availableRetasiKe.map(ke => (
                        <SelectItem key={ke} value={ke.toString()}>Retasi {ke}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Summary Cards */}
      {hasSearched && !isLoading && (
        <div className="px-4 grid grid-cols-3 gap-2 mb-4">
          <Card className="bg-white">
            <CardContent className="p-3 text-center">
              <div className="text-lg font-bold text-blue-600">{summary.totalQty}</div>
              <div className="text-xs text-muted-foreground">Total Qty</div>
            </CardContent>
          </Card>
          <Card className="bg-white">
            <CardContent className="p-3 text-center">
              <div className="text-lg font-bold text-green-600">{summary.totalItems}</div>
              <div className="text-xs text-muted-foreground">Item</div>
            </CardContent>
          </Card>
          <Card className="bg-white">
            <CardContent className="p-3 text-center">
              <div className="text-sm font-bold text-slate-700">
                {(summary.totalValue / 1000).toFixed(0)}K
              </div>
              <div className="text-xs text-muted-foreground">Nilai</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Source breakdown */}
      {hasSearched && !isLoading && filteredData.length > 0 && (
        <div className="px-4 mb-3">
          <div className="flex gap-2 text-xs">
            <span className="text-blue-600">{summary.deliveryCount} Antar</span>
            <span className="text-muted-foreground">|</span>
            <span className="text-green-600">{summary.officeCount} Kantor</span>
            <span className="text-muted-foreground">|</span>
            <span className="text-purple-600">{summary.retasiCount} Retasi</span>
          </div>
        </div>
      )}

      {/* Results */}
      <div className="px-4">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !hasSearched ? (
          <Card className="bg-white">
            <CardContent className="p-8 text-center text-muted-foreground">
              <Search className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Pilih tanggal dan tap tombol cari</p>
            </CardContent>
          </Card>
        ) : filteredData.length === 0 ? (
          <Card className="bg-white">
            <CardContent className="p-8 text-center text-muted-foreground">
              <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">
                {reportData.length > 0
                  ? 'Tidak ada data yang sesuai dengan filter'
                  : 'Tidak ada produk laku di periode ini'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredData.map((item, index) => (
              <Card key={`${item.transactionId}-${index}`} className="bg-white">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate flex items-center gap-1">
                        {item.productName}
                        {item.isBonus && (
                          <Badge className="bg-orange-100 text-orange-700 text-[10px] px-1">
                            BONUS
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {item.customerName}
                      </div>
                    </div>
                    <div className="text-right ml-2">
                      <div className="font-bold text-sm">{item.quantity} {item.unit}</div>
                      <div className="text-xs text-muted-foreground">
                        Rp {item.total.toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      {getSourceBadge(item.source, item.retasiKe)}
                      {item.driverName && (
                        <span className="text-muted-foreground">{item.driverName}</span>
                      )}
                    </div>
                    <span className="text-muted-foreground">
                      {format(item.soldDate, 'dd/MM HH:mm', { locale: id })}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
