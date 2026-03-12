import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useBranch } from '@/contexts/BranchContext';
import { useToast } from '@/hooks/use-toast';

export interface DeliveryReport {
    id: string;
    transactionId: string;
    deliveryId?: string;
    driverId: string;
    driverName?: string;
    customerName?: string;
    customerAddress?: string;
    status: 'delivered' | 'partial' | 'failed' | 'returned' | 'rescheduled';
    notes?: string;
    photoUrl?: string;
    latitude?: number;
    longitude?: number;
    reportedAt: Date;
    createdAt: Date;
    // Joined data
    deliveryNumber?: number;
    deliveryDate?: Date;
    items?: any[];
}

export interface CreateDeliveryReportInput {
    transactionId: string;
    deliveryId?: string;
    status: string;
    notes?: string;
    photoUrl?: string;
    latitude?: number;
    longitude?: number;
}

/**
 * Hook to get deliveries assigned to the current user (driver/helper)
 */
export function useMyDeliveries() {
    const { user } = useAuth();
    const { currentBranch } = useBranch();

    return useQuery({
        queryKey: ['my-deliveries', user?.id, currentBranch?.id],
        queryFn: async () => {
            if (!user?.id || !currentBranch?.id) return [];

            // Get deliveries where user is driver or helper
            const { data, error } = await supabase
                .from('deliveries')
                .select(`
          id,
          transaction_id,
          delivery_number,
          customer_name,
          customer_address,
          customer_phone,
          delivery_date,
          status,
          photo_url,
          notes,
          driver_id,
          helper_id,
          helper_id_2,
          helper_id_3,
          branch_id,
          created_at,
          updated_at
        `)
                .eq('branch_id', currentBranch.id)
                .or(`driver_id.eq.${user.id},helper_id.eq.${user.id},helper_id_2.eq.${user.id},helper_id_3.eq.${user.id}`)
                .order('delivery_date', { ascending: false })
                .limit(100);

            if (error) throw error;

            // Get delivery items for each delivery
            const deliveryIds = data?.map(d => d.id) || [];
            let itemsMap: Record<string, any[]> = {};

            if (deliveryIds.length > 0) {
                const { data: items } = await supabase
                    .from('delivery_items')
                    .select('*')
                    .in('delivery_id', deliveryIds);

                items?.forEach(item => {
                    if (!itemsMap[item.delivery_id]) itemsMap[item.delivery_id] = [];
                    itemsMap[item.delivery_id].push(item);
                });
            }

            // Get driver names
            const driverIds = [...new Set(data?.map(d => d.driver_id).filter(Boolean) || [])];
            let driverMap: Record<string, string> = {};
            if (driverIds.length > 0) {
                const { data: profiles } = await supabase
                    .from('profiles')
                    .select('id, full_name')
                    .in('id', driverIds);
                profiles?.forEach(p => { driverMap[p.id] = p.full_name; });
            }

            // Check which deliveries already have reports
            const { data: existingReports } = await supabase
                .from('delivery_reports')
                .select('transaction_id, status')
                .in('transaction_id', data?.map(d => d.transaction_id) || [])
                .eq('driver_id', user.id);

            const reportedMap: Record<string, string> = {};
            existingReports?.forEach(r => {
                reportedMap[r.transaction_id] = r.status;
            });

            return (data || []).map(d => ({
                id: d.id,
                transactionId: d.transaction_id,
                deliveryNumber: d.delivery_number,
                customerName: d.customer_name,
                customerAddress: d.customer_address,
                customerPhone: d.customer_phone,
                deliveryDate: new Date(d.delivery_date),
                status: d.status,
                driverId: d.driver_id,
                driverName: driverMap[d.driver_id] || '-',
                notes: d.notes,
                photoUrl: d.photo_url,
                transactionTotal: 0, // Not currently in deliveries table
                items: itemsMap[d.id] || [],
                reportStatus: reportedMap[d.transaction_id] || null,
                createdAt: new Date(d.created_at),
            }));
        },
        enabled: !!user?.id && !!currentBranch?.id,
    });
}

/**
 * Hook to get all delivery reports (for admin web view)
 */
export function useDeliveryReports() {
    const { currentBranch } = useBranch();

    return useQuery({
        queryKey: ['delivery-reports', currentBranch?.id],
        queryFn: async () => {
            if (!currentBranch?.id) return [];

            const { data, error } = await supabase
                .from('delivery_reports')
                .select('*')
                .order('reported_at', { ascending: false })
                .limit(200);

            if (error) throw error;

            // Get driver names
            const driverIds = [...new Set(data?.map(d => d.driver_id).filter(Boolean) || [])];
            let driverMap: Record<string, string> = {};
            if (driverIds.length > 0) {
                const { data: profiles } = await supabase
                    .from('profiles')
                    .select('id, full_name')
                    .in('id', driverIds);
                profiles?.forEach(p => { driverMap[p.id] = p.full_name; });
            }

            // Get transaction info (customer name)
            const txnIds = [...new Set(data?.map(d => d.transaction_id).filter(Boolean) || [])];
            let txnMap: Record<string, { customerName: string; total: number }> = {};
            if (txnIds.length > 0) {
                const { data: txns } = await supabase
                    .from('transactions')
                    .select('id, customer_name, total')
                    .in('id', txnIds);
                txns?.forEach(t => { txnMap[t.id] = { customerName: t.customer_name, total: t.total }; });
            }

            return (data || []).map(d => ({
                id: d.id,
                transactionId: d.transaction_id,
                driverId: d.driver_id,
                driverName: driverMap[d.driver_id] || '-',
                customerName: txnMap[d.transaction_id]?.customerName || '-',
                transactionTotal: txnMap[d.transaction_id]?.total || 0,
                status: d.status,
                notes: d.notes,
                photoUrl: d.photo_url,
                latitude: d.latitude,
                longitude: d.longitude,
                reportedAt: new Date(d.reported_at),
                createdAt: new Date(d.created_at),
            }));
        },
        enabled: !!currentBranch?.id,
    });
}

/**
 * Hook to create a delivery report
 */
export function useCreateDeliveryReport() {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: async (input: CreateDeliveryReportInput) => {
            if (!user?.id) throw new Error('User not authenticated');

            const { data, error } = await supabase
                .rpc('create_delivery_report', {
                    p_transaction_id: input.transactionId,
                    p_driver_id: user.id,
                    p_status: input.status,
                    p_notes: input.notes || null,
                    p_photo_url: input.photoUrl || null,
                    p_latitude: input.latitude || null,
                    p_longitude: input.longitude || null,
                });

            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['delivery-reports'] });
            queryClient.invalidateQueries({ queryKey: ['my-deliveries'] });
            toast({ title: 'Berhasil', description: 'Laporan pengantaran berhasil dikirim' });
        },
        onError: (error: any) => {
            toast({ variant: 'destructive', title: 'Gagal', description: error.message });
        },
    });
}
