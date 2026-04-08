import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { CommissionEntry } from '@/types/commission'
import { useAuth } from './useAuth'
import { useBranch } from '@/contexts/BranchContext'


// Query keys for consistent caching
export const commissionKeys = {
  all: ['commissions'] as const,
  entries: () => [...commissionKeys.all, 'entries'] as const,
  entriesFiltered: (params: { startDate?: string, endDate?: string, role?: string, userId?: string }) => 
    [...commissionKeys.entries(), params] as const,
  rules: () => [...commissionKeys.all, 'rules'] as const,
}

// Optimized commission entries hook with React Query
export function useOptimizedCommissionEntries(
  startDate?: Date,
  endDate?: Date,
  role?: string,
  enabled: boolean = true
) {
  const { user } = useAuth()
  const { currentBranch } = useBranch()

  // Create stable query key based on parameters
  const queryKey = commissionKeys.entriesFiltered({
    startDate: startDate?.toISOString().split('T')[0],
    endDate: endDate?.toISOString().split('T')[0],
    role: role && role !== 'all' ? role : undefined,
    userId: user?.role !== 'admin' && user?.role !== 'owner' ? user?.id : undefined
  })

  return useQuery({
    queryKey: [...queryKey, currentBranch?.id],
    queryFn: async () => {
      console.log('🔄 Fetching commission entries with params:', {
        startDate: startDate?.toISOString(),
        endDate: endDate?.toISOString(),
        role,
        userId: user?.id,
        userRole: user?.role,
        branchId: currentBranch?.id,
        isAdminOrOwner: user?.role === 'admin' || user?.role === 'owner'
      })

      // Build query to View v_kalkulasi_komisi
      let query = supabase
        .from('v_kalkulasi_komisi')
        .select(`
          realization_date,
          transaction_id,
          delivery_id,
          product_id,
          product_name,
          quantity,
          user_id,
          user_name,
          role,
          rate_per_qty
        `)

      if (currentBranch?.id) {
        query = query.eq('branch_id', currentBranch.id)
      }

      if (startDate) {
        query = query.gte('realization_date', startDate.toISOString())
      }
      if (endDate) {
        query = query.lte('realization_date', endDate.toISOString())
      }
      if (role && role !== 'all') {
        query = query.eq('role', role)
      }

      if (user?.id && user?.role !== 'admin' && user?.role !== 'owner') {
        query = query.eq('user_id', user.id)
      }

      const { data, error } = await query

      if (error) {
        console.error('❌ Commission entries query error:', error)
        throw error
      }

      // Get customer names from transactions
      const transactionIds = [...new Set((data || []).map(e => e.transaction_id).filter(Boolean))]
      let customerMap: Record<string, string> = {}

      if (transactionIds.length > 0) {
        const { data: transactions } = await supabase
          .from('transactions')
          .select('id, customer_name')
          .in('id', transactionIds as string[])

        if (transactions) {
          transactions.forEach((t: any) => {
            customerMap[t.id] = t.customer_name
          })
        }
      }

      // Filter out zero-amount commissions immediately to keep UI clean
      const nonZeroData = (data || []).filter(e => e.rate_per_qty > 0 && e.quantity > 0)

      // Deduplicate overlapping entries (e.g., if a transaction appears both as retasi and delivery)
      const deduplicatedData = [];
      const seenKeys = new Set();

      for (const entry of nonZeroData) {
        // Build a unique key for the transaction, role, user, and product combination
        const uniqueKey = `${entry.transaction_id}_${entry.user_id}_${entry.role}_${entry.product_id}`;
        
        if (!seenKeys.has(uniqueKey)) {
          seenKeys.add(uniqueKey);
          deduplicatedData.push(entry);
        } else {
          // If a duplicate happens, prioritize the one WITH a delivery_id (which usually contains more precise assignment)
          if (entry.delivery_id) {
            const existingIndex = deduplicatedData.findIndex(
              e => `${e.transaction_id}_${e.user_id}_${e.role}_${e.product_id}` === uniqueKey
            );
            if (existingIndex !== -1 && !deduplicatedData[existingIndex].delivery_id) {
               deduplicatedData[existingIndex] = entry; 
            }
          }
        }
      }

      // Transform data
      const formattedEntries: CommissionEntry[] = deduplicatedData.map((entry, idx) => ({
        id: `${entry.transaction_id}_${entry.user_id}_${entry.product_id}_${idx}`, // Synthetic ID
        userId: entry.user_id,
        userName: entry.user_name,
        role: entry.role,
        productId: entry.product_id,
        productName: entry.product_name,
        quantity: entry.quantity,
        ratePerQty: entry.rate_per_qty,
        amount: entry.quantity * entry.rate_per_qty,
        transactionId: entry.transaction_id,
        deliveryId: entry.delivery_id,
        ref: 'Dinamis (Auto)',
        customerName: entry.transaction_id ? customerMap[entry.transaction_id as string] : undefined,
        createdAt: new Date(entry.realization_date || new Date()),
        status: 'pending' // Because we no longer track paid
      })) || []

      // Sort DESC dynamically since view might not sort by date reliably
      formattedEntries.sort((a,b) => b.createdAt.getTime() - a.createdAt.getTime())

      console.log(`✅ Fetched ${formattedEntries.length} dynamic commission entries`)
      return formattedEntries
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 15 * 60 * 1000, // 15 minutes
    refetchOnMount: false, // Don't auto-refetch on mount
    enabled: !!user && !!currentBranch && enabled, // Only run when user, branch, and explicit enabled flag are available
  })
}

// Optimized delete commission mutation
export function useDeleteCommissionEntry() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (entryId: string) => {
      console.log('🗑️ Deleting commission entry:', entryId)

      const { error } = await supabase
        .from('commission_entries')
        .delete()
        .eq('id', entryId)

      if (error) {
        console.error('❌ Error deleting commission entry:', error)
        throw error
      }

      console.log('✅ Commission entry deleted successfully')
    },
    onSuccess: () => {
      // Invalidate all commission-related queries
      queryClient.invalidateQueries({ queryKey: commissionKeys.all })
      queryClient.invalidateQueries({ queryKey: ['expenses'] })
    },
    onError: (error) => {
      console.error('❌ Delete commission mutation error:', error)
    }
  })
}

// Optimized delete transaction commissions mutation
export function useDeleteTransactionCommissions() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (transactionId: string) => {
      console.log('🗑️ Deleting commission entries for transaction:', transactionId)

      const { error } = await supabase
        .from('commission_entries')
        .delete()
        .eq('transaction_id', transactionId)

      if (error) {
        console.error('❌ Error deleting commission entries:', error)
        throw error
      }

      console.log('✅ All commission entries for transaction deleted')
    },
    onSuccess: () => {
      // Invalidate commission and expense queries
      queryClient.invalidateQueries({ queryKey: commissionKeys.all })
      queryClient.invalidateQueries({ queryKey: ['expenses'] })
    }
  })
}

// Hook for commission summary with caching
export function useCommissionSummary(
  startDate?: Date,
  endDate?: Date
) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['commission-summary', {
      startDate: startDate?.toISOString().split('T')[0],
      endDate: endDate?.toISOString().split('T')[0],
      userId: user?.id
    }],
    queryFn: async () => {
      // Get commission entries for summary calculation
      let query = supabase
        .from('v_kalkulasi_komisi')
        .select('user_id, user_name, role, rate_per_qty, quantity, transaction_id, product_id, delivery_id')

      if (startDate) {
        query = query.gte('realization_date', startDate.toISOString())
      }
      if (endDate) {
        query = query.lte('realization_date', endDate.toISOString())
      }
      if (user?.id && user?.role !== 'admin' && user?.role !== 'owner') {
        query = query.eq('user_id', user.id)
      }

      const { data, error } = await query

      if (error) throw error

      // Deduplicate overlapping entries for summary
      const deduplicatedData = [];
      const seenKeys = new Set();
      const nonZeroData = (data || []).filter(e => e.rate_per_qty > 0 && e.quantity > 0)

      for (const entry of nonZeroData) {
        const uniqueKey = `${entry.transaction_id}_${entry.user_id}_${entry.role}_${entry.product_id}`;
        
        if (!seenKeys.has(uniqueKey)) {
          seenKeys.add(uniqueKey);
          deduplicatedData.push(entry);
        } else {
          // If duplicate, prefer the one with delivery_id
          if (entry.delivery_id) {
            const existingIndex = deduplicatedData.findIndex(
              e => `${e.transaction_id}_${e.user_id}_${e.role}_${e.product_id}` === uniqueKey
            );
            if (existingIndex !== -1 && !deduplicatedData[existingIndex].delivery_id) {
               deduplicatedData[existingIndex] = entry; 
            }
          }
        }
      }
      
      // Calculate summary
      const summary = deduplicatedData.reduce((acc, entry) => {
        const key = `${entry.user_id}-${entry.role}`
        const amount = (entry.quantity || 0) * (entry.rate_per_qty || 0)

        // Ignore zero commissions
        if (amount <= 0) return acc;
        
        if (!acc[key]) {
          acc[key] = {
            userId: entry.user_id,
            userName: entry.user_name,
            role: entry.role,
            totalAmount: 0,
            totalQuantity: 0,
            entryCount: 0
          }
        }

        acc[key].totalAmount += amount
        acc[key].totalQuantity += entry.quantity
        acc[key].entryCount += 1

        return acc
      }, {} as Record<string, {
        userId: string
        userName: string
        role: string
        totalAmount: number
        totalQuantity: number
        entryCount: number
      }>)

      return Object.values(summary || {})
    },
    staleTime: 10 * 60 * 1000, // 10 minutes for summary
    gcTime: 20 * 60 * 1000, // 20 minutes
    enabled: !!user,
  })
}

// Prefetch hook for commission data
export function usePrefetchCommissions() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const prefetchEntries = (startDate?: Date, endDate?: Date) => {
    if (!user) return

    const queryKey = commissionKeys.entriesFiltered({
      startDate: startDate?.toISOString().split('T')[0],
      endDate: endDate?.toISOString().split('T')[0],
    })

    queryClient.prefetchQuery({
      queryKey,
      queryFn: async () => {
        let query = supabase
          .from('v_kalkulasi_komisi')
          .select('*')
          .limit(50) // Limit for prefetch

        if (startDate) query = query.gte('realization_date', startDate.toISOString())
        if (endDate) query = query.lte('realization_date', endDate.toISOString())

        const { data, error } = await query
        if (error) throw error

        const deduplicatedData = [];
        const seenKeys = new Set();
        const nonZeroData = (data || []).filter(e => e.rate_per_qty > 0 && e.quantity > 0)

        for (const entry of nonZeroData) {
          const uniqueKey = `${entry.transaction_id}_${entry.user_id}_${entry.role}_${entry.product_id}`;
          if (!seenKeys.has(uniqueKey)) {
            seenKeys.add(uniqueKey);
            deduplicatedData.push(entry);
          } else if (entry.delivery_id) {
            const existingIndex = deduplicatedData.findIndex(e => `${e.transaction_id}_${e.user_id}_${e.role}_${e.product_id}` === uniqueKey);
            if (existingIndex !== -1 && !deduplicatedData[existingIndex].delivery_id) {
               deduplicatedData[existingIndex] = entry; 
            }
          }
        }

        return deduplicatedData.map((entry, idx) => ({
          id: `${entry.transaction_id}_${entry.user_id}_${entry.product_id}_${idx}`,
          userId: entry.user_id,
          userName: entry.user_name,
          role: entry.role,
          productId: entry.product_id,
          productName: entry.product_name,
          quantity: entry.quantity,
          ratePerQty: entry.rate_per_qty,
          amount: entry.quantity * entry.rate_per_qty,
          transactionId: entry.transaction_id,
          deliveryId: entry.delivery_id,
          ref: 'Dinamis (Auto)',
          createdAt: new Date(entry.realization_date || new Date()),
          status: 'pending'
        })) || []
      },
      staleTime: 5 * 60 * 1000,
    })
  }

  return { prefetchEntries }
}