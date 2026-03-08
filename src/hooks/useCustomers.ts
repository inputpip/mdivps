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

      // Fetch order count and last order date for each customer
      const customerIds = (data || []).map(c => c.id);
      if (customerIds.length > 0) {
        // Get all orders for these customers to calculate count and last order date
        const { data: orders, error: ordersError } = await supabase
          .from('transactions')
          .select('customer_id, order_date')
          .in('customer_id', customerIds)
          .order('order_date', { ascending: false });

        if (!ordersError && orders) {
          // Create maps for customer_id -> order count and last order date
          const orderCountMap = new Map<string, number>();
          const lastOrderMap = new Map<string, string>();

          for (const order of orders) {
            // Count orders per customer
            orderCountMap.set(order.customer_id, (orderCountMap.get(order.customer_id) || 0) + 1);

            // Set last order date (first occurrence since sorted desc)
            if (!lastOrderMap.has(order.customer_id)) {
              lastOrderMap.set(order.customer_id, order.order_date);
            }
          }

          // Enrich customers with orderCount and lastOrderDate
          return (data || []).map(customer => ({
            ...customer,
            orderCount: orderCountMap.get(customer.id) || 0,
            lastOrderDate: lastOrderMap.has(customer.id)
              ? new Date(lastOrderMap.get(customer.id)!)
              : null
          }));
        }
      }

      return (data || []).map(customer => ({
        ...customer,
        orderCount: 0,
        lastOrderDate: null
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