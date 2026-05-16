import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Customer } from '@/types/customer'
import { supabase } from '@/integrations/supabase/client'
import { useBranch } from '@/contexts/BranchContext'

export const useCustomers = () => {
  const queryClient = useQueryClient();
  const { currentBranch, canAccessAllBranches } = useBranch();

  const { data: customers, isLoading, refetch } = useQuery<Customer[]>({
    queryKey: ['customers', currentBranch?.id],
    queryFn: async () => {
      let query = supabase
        .from('customers')
        .select('*')
        .order('name', { ascending: true });

      // Apply branch filter (only if not head office viewing all branches)
      if (currentBranch?.id) {
        query = query.eq('branch_id', currentBranch.id);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      // Fetch order count, last order date, receivable summary, and last gallon movement for each customer
      const customerIds = (data || []).map(c => c.id);
      if (customerIds.length > 0) {
        const [ordersResult, receivablesResult, gallonMovementsResult] = await Promise.all([
          supabase
            .from('transactions')
            .select('customer_id, order_date')
            .in('customer_id', customerIds)
            .order('order_date', { ascending: false }),
          supabase
            .from('receivables')
            .select('customer_id, amount, paid_amount, due_date, status')
            .in('customer_id', customerIds)
            .in('status', ['pending', 'partial']),
          supabase
            .from('gallon_movements')
            .select('customer_id, delta, type, created_at')
            .in('customer_id', customerIds)
            .order('created_at', { ascending: false })
        ]);

        const { data: orders, error: ordersError } = ordersResult;
        const { data: receivables, error: receivablesError } = receivablesResult;
        const { data: gallonMovements, error: gallonMovementsError } = gallonMovementsResult;

        const orderCountMap = new Map<string, number>();
        const lastOrderMap = new Map<string, string>();
        const lastGallonMovementMap = new Map<string, { delta: number; type: string; created_at: string }>();
        const receivableSummaryMap = new Map<string, {
          totalPiutang: number;
          sisaPiutang: number;
          jumlahPiutang: number;
          jatuhTempoTerdekat: string | null;
        }>();

        if (!gallonMovementsError && gallonMovements) {
          for (const m of gallonMovements) {
            // Take only the latest per customer (results sorted desc by created_at)
            if (!lastGallonMovementMap.has(m.customer_id)) {
              lastGallonMovementMap.set(m.customer_id, {
                delta: m.delta,
                type: m.type,
                created_at: m.created_at,
              });
            }
          }
        }

        if (!ordersError && orders) {
          for (const order of orders) {
            orderCountMap.set(order.customer_id, (orderCountMap.get(order.customer_id) || 0) + 1);

            if (!lastOrderMap.has(order.customer_id)) {
              lastOrderMap.set(order.customer_id, order.order_date);
            }
          }
        }

        if (!receivablesError && receivables) {
          for (const receivable of receivables) {
            const customerId = receivable.customer_id;
            const totalPiutang = Number(receivable.amount) || 0;
            const paidAmount = Number(receivable.paid_amount) || 0;
            const sisaPiutang = Math.max(0, totalPiutang - paidAmount);

            if (sisaPiutang <= 0) continue;

            const current = receivableSummaryMap.get(customerId) || {
              totalPiutang: 0,
              sisaPiutang: 0,
              jumlahPiutang: 0,
              jatuhTempoTerdekat: null,
            };

            const dueDate = receivable.due_date || null;
            const nextDueDate = dueDate && (!current.jatuhTempoTerdekat || dueDate < current.jatuhTempoTerdekat)
              ? dueDate
              : current.jatuhTempoTerdekat;

            receivableSummaryMap.set(customerId, {
              totalPiutang: current.totalPiutang + totalPiutang,
              sisaPiutang: current.sisaPiutang + sisaPiutang,
              jumlahPiutang: current.jumlahPiutang + 1,
              jatuhTempoTerdekat: nextDueDate,
            });
          }
        }

        return (data || []).map(customer => {
          const receivableSummary = receivableSummaryMap.get(customer.id);
          const lastGallon = lastGallonMovementMap.get(customer.id);
          return {
            ...customer,
            totalPiutang: receivableSummary?.totalPiutang || 0,
            sisaPiutang: receivableSummary?.sisaPiutang || 0,
            jumlahPiutang: receivableSummary?.jumlahPiutang || 0,
            jatuhTempoTerdekat: receivableSummary?.jatuhTempoTerdekat || null,
            orderCount: orderCountMap.get(customer.id) || 0,
            lastOrderDate: lastOrderMap.has(customer.id)
              ? new Date(lastOrderMap.get(customer.id)!)
              : null,
            lastGallonDelta: lastGallon?.delta ?? null,
            lastGallonType: lastGallon?.type ?? null,
            lastGallonChangeAt: lastGallon ? new Date(lastGallon.created_at) : null,
          };
        });
      }

      return (data || []).map(customer => ({
        ...customer,
        totalPiutang: 0,
        sisaPiutang: 0,
        jumlahPiutang: 0,
        jatuhTempoTerdekat: null,
        orderCount: 0,
        lastOrderDate: null,
        lastGallonDelta: null,
        lastGallonType: null,
        lastGallonChangeAt: null,
      }));
    },
    enabled: !!currentBranch,
    // Optimized for POS and customer management usage
    staleTime: 5 * 60 * 1000, // 5 minutes - customers change less frequently
    gcTime: 10 * 60 * 1000, // 10 minutes cache
    refetchOnWindowFocus: false, // Don't refetch on window focus
    refetchOnReconnect: false, // Don't refetch on reconnect
    retry: 1, // Only retry once
    retryDelay: 1000,
  });

  const addCustomer = useMutation({
    mutationFn: async (newCustomerData: Omit<Customer, 'id' | 'createdAt' | 'orderCount'>): Promise<Customer> => {
      const customerToInsert = {
        name: newCustomerData.name,
        phone: newCustomerData.phone,
        address: newCustomerData.address,
        latitude: newCustomerData.latitude,
        longitude: newCustomerData.longitude,
        full_address: newCustomerData.full_address,
        store_photo_url: newCustomerData.store_photo_url,
        jumlah_galon_titip: newCustomerData.jumlah_galon_titip,
        classification: newCustomerData.classification || null,
        branch_id: currentBranch?.id || null,
      };

      // Use .order().limit(1) - PostgREST requires explicit order when using limit
      const { data: dataRaw, error } = await supabase
        .from('customers')
        .insert([customerToInsert])
        .select()
        .order('id')
        .limit(1);
      if (error) throw new Error(error.message);
      const data = Array.isArray(dataRaw) ? dataRaw[0] : dataRaw;
      if (!data) throw new Error('Failed to create customer');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });

  const updateCustomer = useMutation({
    mutationFn: async (customerData: Partial<Customer> & { id: string }): Promise<Customer> => {
      const { id, ...updateData } = customerData;

      const customerToUpdate = {
        name: updateData.name,
        phone: updateData.phone,
        address: updateData.address,
        latitude: updateData.latitude,
        longitude: updateData.longitude,
        full_address: updateData.full_address,
        store_photo_url: updateData.store_photo_url,
        jumlah_galon_titip: updateData.jumlah_galon_titip,
        classification: updateData.classification || null,
      };

      // Use .order().limit(1) - PostgREST requires explicit order when using limit
      const { data: dataRaw, error } = await supabase
        .from('customers')
        .update(customerToUpdate)
        .eq('id', id)
        .select()
        .order('id')
        .limit(1);

      if (error) throw new Error(error.message);
      const data = Array.isArray(dataRaw) ? dataRaw[0] : dataRaw;
      if (!data) throw new Error('Failed to update customer');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });

  const deleteCustomer = useMutation({
    mutationFn: async (customerId: string) => {
      const { error } = await supabase
        .from('customers')
        .delete()
        .eq('id', customerId);

      if (error) {
        if (error.code === '23503') {
          throw new Error('Gagal: Pelanggan ini memiliki transaksi terkait.');
        }
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });

  return {
    customers,
    isLoading,
    refetch,
    addCustomer,
    updateCustomer,
    deleteCustomer,
  };
}

export const useCustomerById = (id: string) => {
  const { data: customer, isLoading } = useQuery<Customer | undefined>({
    queryKey: ['customer', id],
    queryFn: async () => {
      // Use .order().limit(1) - PostgREST requires explicit order when using limit
      const { data: dataRaw, error } = await supabase
        .from('customers')
        .select('*')
        .eq('id', id)
        .order('id')
        .limit(1);
      if (error) throw new Error(error.message);
      const data = Array.isArray(dataRaw) ? dataRaw[0] : dataRaw;
      return data;
    },
    enabled: !!id,
  });
  return { customer, isLoading };
}