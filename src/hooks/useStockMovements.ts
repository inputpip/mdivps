import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { StockMovement, CreateStockMovementData, StockConsumptionReport } from '@/types/stockMovement'
import { supabase } from '@/integrations/supabase/client'
import { startOfMonth, endOfMonth } from 'date-fns'
import { useBranch } from '@/contexts/BranchContext'

// Helper to map from DB (snake_case) to App (camelCase)
const fromDbToApp = (dbMovement: any): StockMovement => ({
  id: dbMovement.id,
  productId: dbMovement.product_id,
  productName: dbMovement.products?.name || dbMovement.product_name,
  type: dbMovement.type,
  reason: dbMovement.reason,
  quantity: Number(dbMovement.quantity),
  previousStock: Number(dbMovement.previous_stock),
  newStock: Number(dbMovement.new_stock),
  notes: dbMovement.notes,
  referenceId: dbMovement.reference_id,
  referenceType: dbMovement.reference_type,
  userId: dbMovement.user_id,
  userName: dbMovement.user_name,
  createdAt: new Date(dbMovement.created_at),
})

// Helper to map from App (camelCase) to DB (snake_case)
const fromAppToDb = (appMovement: CreateStockMovementData, branchId?: string | null) => ({
  product_id: appMovement.productId,
  type: appMovement.type,
  reason: appMovement.reason,
  quantity: appMovement.quantity,
  previous_stock: appMovement.previousStock,
  new_stock: appMovement.newStock,
  notes: appMovement.notes,
  reference_id: appMovement.referenceId,
  reference_type: appMovement.referenceType,
  user_id: appMovement.userId,
  user_name: appMovement.userName,
  branch_id: branchId || null,
})

export const useStockMovements = () => {
  const queryClient = useQueryClient()
  const { currentBranch } = useBranch()

  const { data: movements, isLoading } = useQuery({
    queryKey: ['stockMovements', currentBranch?.id],
    queryFn: async (): Promise<StockMovement[]> => {
      let query = supabase
        .from('product_stock_movements')
        .select('*, products(name)')
        .order('created_at', { ascending: false })

      if (currentBranch?.id) {
        query = query.eq('branch_id', currentBranch.id)
      }

      const { data, error } = await query

      if (error) {
        console.error('Error fetching stock movements:', error)
        if (error.code === '42P01' || error.code === 'PGRST205') {
          console.warn('product_stock_movements table does not exist, returning empty array')
          return []
        }
        throw new Error(error.message)
      }
      return data ? data.map(fromDbToApp) : []
    },
    enabled: !!currentBranch,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    retryDelay: 1000,
  })

  const createStockMovement = useMutation({
    mutationFn: async (movementData: CreateStockMovementData): Promise<StockMovement> => {
      const dbData = fromAppToDb(movementData, currentBranch?.id)
      const { data: dataRaw, error } = await supabase
        .from('product_stock_movements')
        .insert(dbData)
        .select('*, products(name)')
        .order('created_at', { ascending: false })
        .limit(1)

      if (error) {
        console.error('Error creating stock movement:', error)
        throw new Error(error.message)
      }
      const data = Array.isArray(dataRaw) ? dataRaw[0] : dataRaw
      if (!data) throw new Error('Failed to create stock movement')
      return fromDbToApp(data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stockMovements'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
    },
  })

  const getMovementsByProduct = async (productId: string): Promise<StockMovement[]> => {
    let query = supabase
      .from('product_stock_movements')
      .select('*, products(name)')
      .eq('product_id', productId)
      .order('created_at', { ascending: false })

    if (currentBranch?.id) {
      query = query.eq('branch_id', currentBranch.id)
    }

    const { data, error } = await query

    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') {
        return []
      }
      throw new Error(error.message)
    }
    return data ? data.map(fromDbToApp) : []
  }

  const getMovementsByDateRange = async (from: Date, to: Date): Promise<StockMovement[]> => {
    let query = supabase
      .from('product_stock_movements')
      .select('*, products(name)')
      .gte('created_at', from.toISOString())
      .lte('created_at', to.toISOString())
      .order('created_at', { ascending: false })

    if (currentBranch?.id) {
      query = query.eq('branch_id', currentBranch.id)
    }

    const { data, error } = await query

    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') {
        return []
      }
      throw new Error(error.message)
    }
    return data ? data.map(fromDbToApp) : []
  }

  const getMonthlyConsumptionReport = async (year: number, month: number): Promise<StockConsumptionReport[]> => {
    const startDate = startOfMonth(new Date(year, month - 1))
    const endDate = endOfMonth(new Date(year, month - 1))

    const movements = await getMovementsByDateRange(startDate, endDate)

    let productsQuery = supabase
      .from('products')
      .select('id, name, type, unit')

    if (currentBranch?.id) {
      productsQuery = productsQuery.eq('branch_id', currentBranch.id)
    }

    const { data: products, error: productsError } = await productsQuery

    if (productsError) throw new Error(productsError.message)

    let stockQuery = supabase.from('v_product_current_stock').select('product_id, current_stock')
    if (currentBranch?.id) {
      stockQuery = stockQuery.eq('branch_id', currentBranch.id)
    }

    const { data: stockData } = await stockQuery
    const stockMap = new Map<string, number>()
    if (stockData) {
      stockData.forEach((s: any) => stockMap.set(s.product_id, Number(s.current_stock) || 0))
    }

    const productMovements = movements.reduce((acc, movement) => {
      if (!acc[movement.productId]) {
        acc[movement.productId] = []
      }
      acc[movement.productId].push(movement)
      return acc
    }, {} as Record<string, StockMovement[]>)

    const reports: StockConsumptionReport[] = []

    for (const product of products || []) {
      const productMovs = productMovements[product.id] || []

      if (productMovs.length > 0 || product.type !== 'Jasa') {
        const totalIn = productMovs
          .filter(m => m.type === 'IN')
          .reduce((sum, m) => sum + m.quantity, 0)

        const totalOut = productMovs
          .filter(m => m.type === 'OUT')
          .reduce((sum, m) => sum + m.quantity, 0)

        const netMovement = totalIn - totalOut
        const endingStock = stockMap.get(product.id) || 0
        const startingStock = endingStock - netMovement

        reports.push({
          productId: product.id,
          productName: product.name,
          productType: product.type || 'Stock',
          unit: product.unit || 'pcs',
          totalIn,
          totalOut,
          netMovement,
          startingStock,
          endingStock,
          movements: productMovs,
        })
      }
    }

    return reports.sort((a, b) => a.productName.localeCompare(b.productName))
  }

  return {
    movements,
    isLoading,
    createStockMovement,
    getMovementsByProduct,
    getMovementsByDateRange,
    getMonthlyConsumptionReport,
  }
}
