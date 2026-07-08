import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PurchaseOrder, PurchaseOrderStatus } from '@/types/purchaseOrder'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from './useAuth'
import { useBranch } from '@/contexts/BranchContext'
import { useTimezone } from '@/contexts/TimezoneContext'
import { getOfficeDateString } from '@/utils/officeTime'
import { useAccountsPayable } from './useAccountsPayable'

const fromDb = (dbPo: any): PurchaseOrder => ({
  id: dbPo.id,
  poNumber: dbPo.po_number,
  materialId: dbPo.material_id,
  materialName: dbPo.material_name,
  quantity: dbPo.quantity,
  unit: dbPo.unit,
  unitPrice: dbPo.unit_price,
  requestedBy: dbPo.requested_by,
  status: dbPo.status,
  createdAt: new Date(dbPo.created_at),
  notes: dbPo.notes,
  totalCost: dbPo.total_cost,
  subtotal: dbPo.subtotal,
  includePpn: dbPo.include_ppn,
  ppnMode: dbPo.ppn_mode || 'exclude',
  ppnAmount: dbPo.ppn_amount,
  paymentAccountId: dbPo.payment_account_id,
  orderDate: dbPo.order_date ? new Date(dbPo.order_date) : undefined,
  receivedDate: dbPo.received_date ? new Date(dbPo.received_date) : undefined,
  paymentDate: dbPo.payment_date ? new Date(dbPo.payment_date) : undefined,
  supplierName: dbPo.supplier_name,
  supplierContact: dbPo.supplier_contact,
  supplierId: dbPo.supplier_id,
  quotedPrice: dbPo.quoted_price,
  expedition: dbPo.expedition,
  expectedDeliveryDate: dbPo.expected_delivery_date ? new Date(dbPo.expected_delivery_date) : undefined,
  branchId: dbPo.branch_id,
  updatedAt: dbPo.updated_at ? new Date(dbPo.updated_at) : undefined,
  approvedAt: dbPo.approved_at ? new Date(dbPo.approved_at) : undefined,
  approvedBy: dbPo.approved_by,
});

export const usePurchaseOrders = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { currentBranch } = useBranch();
  const { timezone } = useTimezone();
  const { payAccountsPayable } = useAccountsPayable();

  const { data: purchaseOrders, isLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ['purchaseOrders', currentBranch?.id],
    queryFn: async () => {
      if (!currentBranch?.id) return [];
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('*')
        .eq('branch_id', currentBranch.id)
        .order('created_at', { ascending: false });

      if (error) throw new Error(error.message);
      return data ? data.map(fromDb) : [];
    },
    enabled: !!currentBranch,
  });

  const addPurchaseOrder = useMutation({
    mutationFn: async (newPoData: any): Promise<PurchaseOrder> => {
      if (!currentBranch?.id) throw new Error('Branch tidak dipilih');

      const poHeader = {
        requested_by: newPoData.requestedBy,
        supplier_id: newPoData.supplierId,
        supplier_name: newPoData.supplierName,
        total_cost: newPoData.totalCost,
        subtotal: newPoData.subtotal,
        include_ppn: newPoData.includePpn,
        ppn_mode: newPoData.ppnMode,
        ppn_amount: newPoData.ppnAmount,
        expedition: newPoData.expedition,
        order_date: newPoData.orderDate,
        expected_delivery_date: newPoData.expectedDeliveryDate,
        notes: newPoData.notes,
      };

      const poItems = (newPoData.items || []).map((item: any) => ({
        material_id: item.materialId,
        product_id: item.productId,
        material_name: item.materialName,
        product_name: item.productName,
        item_type: item.itemType,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        unit: item.unit,
        subtotal: item.subtotal,
        notes: item.notes,
      }));

      const { data, error } = await supabase.rpc('create_purchase_order_atomic', {
        p_po_header: poHeader,
        p_po_items: poItems,
        p_branch_id: currentBranch.id,
      });

      if (error) throw error;
      const res = Array.isArray(data) ? data[0] : data;
      if (!res?.success) throw new Error(res?.error_message || 'Gagal membuat PO');

      const { data: poData } = await supabase.from('purchase_orders').select('*').eq('id', res.po_id).single();
      return fromDb(poData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
    },
  });

  const updatePoStatus = useMutation({
    mutationFn: async ({ poId, status, updateData }: { poId: string, status: PurchaseOrderStatus, updateData?: any }): Promise<PurchaseOrder> => {
      if (!currentBranch?.id) throw new Error('Branch tidak dipilih');

      if (status === 'Approved') {
        if (!user) throw new Error('User tidak terautentikasi');
        const { data, error } = await supabase.rpc('approve_purchase_order_atomic', {
          p_po_id: poId,
          p_branch_id: currentBranch.id,
          p_user_id: user.id,
          p_user_name: user.name || user.email || 'Unknown'
        });

        if (error) throw error;
        const res = Array.isArray(data) ? data[0] : data;
        if (!res?.success) throw new Error(res?.error_message || 'Gagal menyetujui PO');
      } else {
        const { error } = await supabase.from('purchase_orders').update({ status, ...updateData }).eq('id', poId);
        if (error) throw error;
      }

      const { data: poData } = await supabase.from('purchase_orders').select('*').eq('id', poId).single();
      return fromDb(poData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      queryClient.invalidateQueries({ queryKey: ['accountsPayable'] });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });

  const payPurchaseOrder = useMutation({
    mutationFn: async ({ poId, totalCost, paymentAccountId }: { poId: string, totalCost: number, paymentAccountId: string }) => {
      // Find corresponding accounts payable
      const { data: payableData } = await supabase
        .from('accounts_payable')
        .select('*')
        .eq('purchase_order_id', poId)
        .eq('status', 'Outstanding')
        .maybeSingle();

      if (payableData) {
        return await payAccountsPayable.mutateAsync({
          payableId: payableData.id,
          amount: totalCost,
          paymentAccountId,
          liabilityAccountId: '', // This is handled inside payAccountsPayable RPC now
          notes: `Payment for PO #${poId}`,
        });
      } else {
        // Fallback for POs without AP (should not happen in new flow)
        const { error } = await supabase.from('purchase_orders')
          .update({ status: 'Dibayar', payment_date: getOfficeDateString(timezone), payment_account_id: paymentAccountId })
          .eq('id', poId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      queryClient.invalidateQueries({ queryKey: ['accountsPayable'] });
    }
  });

  const receivePurchaseOrder = useMutation({
    mutationFn: async (po: PurchaseOrder) => {
      if (!currentBranch?.id || !user) throw new Error('Konteks tidak lengkap');

      const { data, error } = await supabase.rpc('receive_po_atomic', {
        p_po_id: po.id,
        p_branch_id: currentBranch.id,
        p_received_date: po.receivedDate ? po.receivedDate.toISOString().split('T')[0] : getOfficeDateString(timezone),
        p_user_id: user.id,
        p_user_name: po.requestedBy || user.name || 'Unknown'
      });

      if (error) throw error;
      const res = Array.isArray(data) ? data[0] : data;
      if (!res?.success) throw new Error(res?.error_message || 'Gagal menerima PO');

      const { data: updatedPo } = await supabase.from('purchase_orders').select('*').eq('id', po.id).single();
      return fromDb(updatedPo);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['materialMovements'] });
    }
  });

  const deletePurchaseOrder = useMutation({
    mutationFn: async ({ poId, skipValidation = false }: { poId: string; skipValidation?: boolean }) => {
      if (!currentBranch?.id) throw new Error('Branch tidak dipilih');

      const { data, error } = await supabase.rpc('delete_po_atomic', {
        p_po_id: poId,
        p_branch_id: currentBranch.id,
        p_skip_validation: skipValidation
      });

      if (error) throw error;
      const res = Array.isArray(data) ? data[0] : data;
      if (!res?.success) throw new Error(res?.error_message || 'Gagal menghapus PO');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
      queryClient.invalidateQueries({ queryKey: ['accountsPayable'] });
    }
  });

  return {
    purchaseOrders,
    isLoading,
    addPurchaseOrder,
    updatePoStatus,
    payPurchaseOrder,
    receivePurchaseOrder,
    deletePurchaseOrder,
  }
}