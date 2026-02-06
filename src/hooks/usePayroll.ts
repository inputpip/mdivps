import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import {
  EmployeeSalary,
  PayrollRecord,
  SalaryConfigFormData,
  PayrollFormData,
  PayrollFilters,
} from '@/types/payroll'
import { useToast } from '@/hooks/use-toast'
import { useBranch } from '@/contexts/BranchContext'
import { useAuth } from './useAuth'

const fromDbToEmployeeSalary = (dbData: any): EmployeeSalary => ({
  id: dbData.id,
  employeeId: dbData.employee_id,
  employeeName: dbData.employee_name,
  employeeRole: dbData.employee_role,
  baseSalary: Number(dbData.base_salary) || 0,
  commissionRate: Number(dbData.commission_rate) || 0,
  payrollType: dbData.payroll_type || 'monthly',
  commissionType: dbData.commission_type || 'none',
  effectiveFrom: new Date(dbData.effective_from),
  effectiveUntil: dbData.effective_until ? new Date(dbData.effective_until) : undefined,
  isActive: dbData.is_active,
  createdBy: dbData.created_by,
  createdAt: new Date(dbData.created_at),
  updatedAt: new Date(dbData.updated_at),
  notes: dbData.notes,
});

const fromDbToPayrollRecord = (dbData: any): PayrollRecord => ({
  id: dbData.id || dbData.payroll_id,
  employeeId: dbData.employee_id,
  employeeName: dbData.employee_name,
  employeeRole: dbData.employee_role,
  salaryConfigId: dbData.salary_config_id,
  periodYear: dbData.period_year,
  periodMonth: dbData.period_month,
  periodStart: new Date(dbData.period_start),
  periodEnd: new Date(dbData.period_end),
  periodDisplay: dbData.period_display,
  baseSalaryAmount: Number(dbData.base_salary_amount) || 0,
  commissionAmount: Number(dbData.commission_amount) || 0,
  bonusAmount: Number(dbData.bonus_amount) || 0,
  deductionAmount: Number(dbData.deduction_amount) || 0,
  outstandingAdvances: Number(dbData.outstanding_advances) || 0,
  grossSalary: Number(dbData.gross_salary) || 0,
  netSalary: Number(dbData.net_salary) || 0,
  status: dbData.status || 'draft',
  paymentDate: dbData.payment_date ? new Date(dbData.payment_date) : undefined,
  paymentAccountId: dbData.payment_account_id,
  paymentAccountName: dbData.payment_account_name,
  cashHistoryId: dbData.cash_history_id,
  createdBy: dbData.created_by,
  paidBy: dbData.paid_by_name || dbData.paid_by,
  createdAt: new Date(dbData.created_at),
  updatedAt: new Date(dbData.updated_at),
  notes: dbData.notes,
});

export const useEmployeeSalaries = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: salaryConfigs, isLoading } = useQuery<EmployeeSalary[]>({
    queryKey: ['employeeSalaries'],
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_salary_summary').select('*').order('employee_name', { ascending: true });
      if (error) throw error;
      return (data || []).map(fromDbToEmployeeSalary);
    },
  });

  const createSalaryConfig = useMutation({
    mutationFn: async (data: SalaryConfigFormData) => {
      const { error } = await supabase.from('employee_salaries').insert({
        employee_id: data.employeeId,
        base_salary: data.baseSalary,
        commission_rate: data.commissionRate,
        payroll_type: data.payrollType,
        commission_type: data.commissionType,
        effective_from: data.effectiveFrom.toISOString().split('T')[0],
        effective_until: data.effectiveUntil?.toISOString().split('T')[0],
        notes: data.notes,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employeeSalaries'] });
      toast({ title: 'Success', description: 'Salary configuration created successfully' });
    },
  });

  const updateSalaryConfig = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<SalaryConfigFormData> }) => {
      const updateData: any = {};
      if (data.baseSalary !== undefined) updateData.base_salary = data.baseSalary;
      if (data.commissionRate !== undefined) updateData.commission_rate = data.commissionRate;
      if (data.payrollType) updateData.payroll_type = data.payrollType;
      if (data.commissionType) updateData.commission_type = data.commissionType;
      if (data.effectiveFrom) updateData.effective_from = data.effectiveFrom.toISOString().split('T')[0];
      if (data.effectiveUntil) updateData.effective_until = data.effectiveUntil.toISOString().split('T')[0];
      if (data.notes !== undefined) updateData.notes = data.notes;

      const { error } = await supabase.from('employee_salaries').update(updateData).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employeeSalaries'] });
      toast({ title: 'Success', description: 'Salary configuration updated successfully' });
    },
  });

  const deactivateSalaryConfig = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('employee_salaries').update({ is_active: false, effective_until: new Date().toISOString().split('T')[0] }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employeeSalaries'] });
    },
  });

  return { salaryConfigs, isLoading, createSalaryConfig, updateSalaryConfig, deactivateSalaryConfig };
};

export const usePayrollRecords = (filters?: PayrollFilters) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { currentBranch } = useBranch();
  const { user } = useAuth();

  const { data: payrollRecords, isLoading } = useQuery<PayrollRecord[]>({
    queryKey: ['payrollRecords', filters, currentBranch?.id],
    queryFn: async () => {
      if (!currentBranch?.id) return [];
      let query = supabase.from('payroll_summary').select('*').eq('branch_id', currentBranch.id);
      if (filters?.year) query = query.eq('period_year', filters.year);
      if (filters?.month) query = query.eq('period_month', filters.month);
      if (filters?.employeeId) query = query.eq('employee_id', filters.employeeId);
      if (filters?.status) query = query.eq('status', filters.status);

      const { data, error } = await query.order('period_year', { ascending: false }).order('period_month', { ascending: false }).order('employee_name', { ascending: true });
      if (error) throw error;
      return (data || []).map(fromDbToPayrollRecord);
    },
    enabled: !!currentBranch,
  });

  const createPayrollRecord = useMutation({
    mutationFn: async (data: PayrollFormData & { salaryDeduction?: number }) => {
      if (!currentBranch?.id) throw new Error('Branch tidak dipilih');

      const { data: rpcRes, error } = await supabase.rpc('create_payroll_record', {
        p_payroll: {
          employee_id: data.employeeId,
          period_year: data.periodYear,
          period_month: data.periodMonth,
          base_salary: data.baseSalaryAmount || 0,
          commission: data.commissionAmount || 0,
          bonus: data.bonusAmount || 0,
          advance_deduction: data.deductionAmount || 0,
          salary_deduction: data.salaryDeduction || 0,
          notes: data.notes,
        },
        p_branch_id: currentBranch.id,
      });

      if (error) throw error;
      const res = Array.isArray(rpcRes) ? rpcRes[0] : rpcRes;
      if (!res?.success) throw new Error(res?.error_message || 'Gagal membuat record gaji');
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payrollRecords'] });
      toast({ title: 'Success', description: 'Payroll record created successfully' });
    },
  });

  const updatePayrollRecord = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<PayrollFormData> }) => {
      if (!currentBranch?.id) throw new Error('Branch tidak dipilih');

      const { data: rpcRes, error } = await supabase.rpc('update_payroll_record_atomic', {
        p_payroll_id: id,
        p_branch_id: currentBranch.id,
        p_base_salary: data.baseSalaryAmount,
        p_commission: data.commissionAmount,
        p_bonus: data.bonusAmount,
        p_advance_deduction: data.deductionAmount,
        p_salary_deduction: (data as any).salaryDeduction,
        p_notes: data.notes,
      });

      if (error) throw error;
      const res = Array.isArray(rpcRes) ? rpcRes[0] : rpcRes;
      if (!res?.success) throw new Error(res?.error_message || 'Gagal mengupdate record gaji');
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payrollRecords'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['payrollHistory'], exact: false });
      toast({ title: 'Berhasil', description: 'Data gaji berhasil diupdate' });
    },
  });

  const approvePayrollRecord = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('payroll_records').update({ status: 'approved' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payrollRecords'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['payrollHistory'], exact: false });
      toast({ title: 'Sukses', description: 'Payroll berhasil disetujui' });
    },
  });

  const processPayment = useMutation({
    mutationFn: async ({ id, paymentAccountId, paymentDate, expenseAccountId }: { id: string; paymentAccountId: string; paymentDate: Date; expenseAccountId?: string }) => {
      if (!currentBranch?.id) throw new Error('Branch tidak dipilih');

      const { data: rpcRes, error } = await supabase.rpc('process_payroll_complete', {
        p_payroll_id: id,
        p_branch_id: currentBranch.id,
        p_payment_account_id: paymentAccountId,
        p_payment_date: paymentDate.toISOString().split('T')[0],
        p_expense_account_id: expenseAccountId, // Optional param
      });

      if (error) throw error;
      const res = Array.isArray(rpcRes) ? rpcRes[0] : rpcRes;
      if (!res?.success) throw new Error(res?.error_message || 'Gagal memproses pembayaran gaji');
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payrollRecords'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['accounts'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['employeeAdvances'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['payrollHistory'], exact: false });
      toast({ title: 'Sukses', description: 'Pembayaran berhasil diproses' });
    },
  });

  const deletePayrollRecord = useMutation({
    mutationFn: async (payrollId: string) => {
      if (!currentBranch?.id) throw new Error('Branch tidak dipilih');

      try {
        const { data: rpcRes, error: rpcError } = await supabase.rpc('void_payroll_record', {
          p_payroll_id: payrollId,
          p_branch_id: currentBranch.id,
          p_reason: 'Payroll record deleted by user',
        });

        if (rpcError) {
          console.warn('⚠️ RPC void failed, attempting forced delete:', rpcError);
          // Fallback to direct delete if RPC fails
          const { error: deleteError } = await supabase
            .from('payroll_records')
            .delete()
            .eq('id', payrollId);

          if (deleteError) throw deleteError;
        } else {
          const res = Array.isArray(rpcRes) ? rpcRes[0] : rpcRes;
          if (!res?.success) {
            console.warn('⚠️ RPC logic failed, attempting forced delete:', res?.error_message);
            const { error: deleteError } = await supabase
              .from('payroll_records')
              .delete()
              .eq('id', payrollId);
            if (deleteError) throw deleteError;
          }
        }
      } catch (err) {
        console.error('❌ Delete failed:', err);
        // Last resort: direct delete
        await supabase.from('payroll_records').delete().eq('id', payrollId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payrollRecords'] });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
      toast({ title: 'Sukses', description: 'Catatan gaji berhasil dihapus' });
    },
  });

  // Calculate payroll with advances for an employee
  const calculatePayroll = useMutation({
    mutationFn: async ({ employeeId, year, month }: { employeeId: string; year: number; month: number }) => {
      if (!currentBranch?.id) throw new Error('Branch tidak dipilih');

      const { data, error } = await supabase.rpc('calculate_payroll_with_advances', {
        emp_id: employeeId,
        period_year: year,
        period_month: month
      });

      if (error) {
        console.error('Error calculating payroll:', error);
        throw error;
      }

      // RPC returns camelCase keys as defined in jsonb_build_object
      return {
        ...data,
        // Ensure numeric fields are numbers
        baseSalary: Number(data.baseSalary) || 0,
        commissionAmount: Number(data.commissionAmount) || 0,
        bonusAmount: Number(data.bonusAmount) || 0,
        outstandingAdvances: Number(data.outstandingAdvances) || 0,
        advanceDeduction: Number(data.advanceDeduction) || 0,
        grossSalary: Number(data.grossSalary) || 0,
        netSalary: Number(data.netSalary) || 0,
      };
    },
  });

  return {
    payrollRecords,
    isLoading,
    createPayrollRecord,
    updatePayrollRecord,
    approvePayrollRecord,
    processPayment,
    deletePayrollRecord,
    calculatePayroll
  };
};

// Hook to get payroll summary for a specific period
export const usePayrollSummary = (year: number, month: number) => {
  const { currentBranch } = useBranch();

  const { data: summary, isLoading } = useQuery({
    queryKey: ['payrollSummary', currentBranch?.id, year, month],
    queryFn: async () => {
      if (!currentBranch?.id) return null;

      // Calculate date range for the period
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0); // Last day of month

      const { data, error } = await supabase
        .from('payroll_records')
        .select('*')
        .eq('branch_id', currentBranch.id)
        .gte('period_start', startDate.toISOString().split('T')[0])
        .lte('period_start', endDate.toISOString().split('T')[0]);

      if (error) throw error;

      const records = (data || []).map(fromDbToPayrollRecord);

      return {
        period: {
          year,
          month,
          display: `${new Date(year, month - 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}`
        },
        totalEmployees: records.length,
        totalBaseSalary: records.reduce((sum, r) => sum + r.baseSalaryAmount, 0),
        totalCommission: records.reduce((sum, r) => sum + r.commissionAmount, 0),
        totalBonus: records.reduce((sum, r) => sum + r.bonusAmount, 0),
        totalDeduction: records.reduce((sum, r) => sum + r.deductionAmount, 0),
        totalGrossSalary: records.reduce((sum, r) => sum + r.grossSalary, 0),
        totalNetSalary: records.reduce((sum, r) => sum + r.netSalary, 0),
        paidCount: records.filter(r => r.status === 'paid').length,
        pendingCount: records.filter(r => r.status === 'approved').length,
        draftCount: records.filter(r => r.status === 'draft').length,
      };
    },
    enabled: !!currentBranch,
  });

  return { summary, isLoading };
};
