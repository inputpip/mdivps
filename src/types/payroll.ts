// Payroll System Types
export type PayrollType = 'monthly' | 'commission_only' | 'mixed';
export type CommissionType = 'percentage' | 'fixed_amount' | 'none';
export type PayrollStatus = 'draft' | 'approved' | 'paid';

// Employee Salary Configuration
export interface EmployeeSalary {
  id: string;
  employeeId: string;
  employeeName?: string;
  employeeRole?: string;

  // Salary Configuration
  baseSalary: number;
  commissionRate: number;
  payrollType: PayrollType;
  commissionType: CommissionType;

  // Validity Period
  effectiveFrom: Date;
  effectiveUntil?: Date;
  isActive: boolean;

  // Metadata
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
  notes?: string;
}

// Payroll Record (Monthly Transaction)
export interface PayrollRecord {
  id: string;
  employeeId: string;
  employeeName?: string;
  employeeRole?: string;
  salaryConfigId?: string;

  // Period
  periodYear: number;
  periodMonth: number;
  periodStart: Date;
  periodEnd: Date;
  periodDisplay?: string; // "January 2025"

  // Salary Components
  baseSalaryAmount: number;
  commissionAmount: number;
  bonusAmount: number;
  deductionAmount: number;

  // Advance Information
  outstandingAdvances?: number;

  // Computed Totals
  grossSalary: number;
  netSalary: number;

  // Payment Information
  status: PayrollStatus;
  paymentDate?: Date;
  paymentAccountId?: string;
  paymentAccountName?: string;

  // Metadata
  createdBy?: string;
  paidBy?: string;
  createdAt: Date;
  updatedAt: Date;
  notes?: string;
}

// Payroll Calculation Result from RPC
export interface PayrollCalculation {
  employeeId: string;
  periodYear: number;
  periodMonth: number;
  periodStart: Date;
  periodEnd: Date;
  baseSalary: number;
  commissionAmount: number;
  bonusAmount: number;
  outstandingAdvances: number;
  advanceDeduction: number;
  totalDeduction: number;
  grossSalary: number;
  netSalary: number;
  salaryConfigId: string;
  payrollType: string;
}

// Payroll Summary for Dashboard
export interface PayrollSummary {
  period: {
    year: number;
    month: number;
    display: string;
  };
  totalEmployees: number;
  totalBaseSalary: number;
  totalCommission: number;
  totalBonus: number;
  totalDeductions: number;
  totalGrossSalary: number;
  totalNetSalary: number;
  paidCount: number;
  pendingCount: number;
  draftCount: number;
}

// Commission Calculation Result
export interface CommissionCalculation {
  employeeId: string;
  employeeName: string;
  period: {
    start: Date;
    end: Date;
  };
  commissionSources: {
    deliveries: number;
    sales: number;
    other: number;
  };
  commissionRate: number;
  commissionType: CommissionType;
  calculatedAmount: number;
  details: string;
}

// Payroll Form Data
export interface PayrollFormData {
  employeeId: string;
  periodYear: number;
  periodMonth: number;
  baseSalaryAmount?: number;
  commissionAmount?: number;
  bonusAmount?: number;
  deductionAmount?: number;
  paymentAccountId?: string;
  notes?: string;
}

// Salary Configuration Form Data
export interface SalaryConfigFormData {
  employeeId: string;
  baseSalary: number;
  commissionRate: number;
  payrollType: PayrollType;
  commissionType: CommissionType;
  effectiveFrom: Date;
  effectiveUntil?: Date;
  notes?: string;
}

// Payroll Filter Options
export interface PayrollFilters {
  year?: number;
  month?: number;
  employeeId?: string;
  status?: PayrollStatus;
  payrollType?: PayrollType;
}

// Salary History Item
export interface SalaryHistoryItem {
  id: string;
  employeeId: string;
  baseSalary: number;
  commissionRate: number;
  payrollType: PayrollType;
  effectiveFrom: Date;
  effectiveUntil?: Date;
  changeReason?: string;
  createdBy?: string;
  createdAt: Date;
}