-- =====================================================
-- 06 EMPLOYEE ADVANCE
-- Generated: 2026-01-09T00:29:07.860Z
-- Total functions: 6
-- =====================================================

-- Functions in this file:
--   calculate_payroll_with_advances
--   create_employee_advance_atomic
--   get_outstanding_advances
--   process_advance_repayment_from_salary
--   repay_employee_advance_atomic
--   void_employee_advance_atomic

-- =====================================================
-- Function: calculate_payroll_with_advances
-- =====================================================
CREATE OR REPLACE FUNCTION public.calculate_payroll_with_advances(emp_id uuid, period_year integer, period_month integer)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  salary_config public.employee_salaries;
  period_start DATE;
  period_end DATE;
  base_salary DECIMAL(15,2) := 0;
  commission_amount DECIMAL(15,2) := 0;
  outstanding_advances DECIMAL(15,2) := 0;
  advance_deduction DECIMAL(15,2) := 0;
  bonus_amount DECIMAL(15,2) := 0;
  total_deduction DECIMAL(15,2) := 0;
  gross_salary DECIMAL(15,2) := 0;
  net_salary DECIMAL(15,2) := 0;
  result JSONB;
BEGIN
  -- Calculate period dates
  period_start := DATE(period_year || '-' || period_month || '-01');
  period_end := (period_start + INTERVAL '1 month - 1 day')::DATE;
  -- Get active salary configuration
  SELECT * INTO salary_config FROM public.get_active_salary_config(emp_id, period_start);
  IF salary_config IS NULL THEN
    RAISE EXCEPTION 'No active salary configuration found for employee';
  END IF;
  -- Calculate base salary
  IF salary_config.payroll_type IN ('monthly', 'mixed') THEN
    base_salary := salary_config.base_salary;
  END IF;
  -- ALWAYS calculate commission from commission_entries table
  -- (regardless of commission_rate setting in salary config)
  IF salary_config.payroll_type IN ('commission_only', 'mixed') THEN
    commission_amount := public.calculate_commission_for_period(emp_id, period_start, period_end);
  END IF;
  -- Calculate outstanding advances (up to end of payroll period)
  outstanding_advances := public.get_outstanding_advances(emp_id, period_end);
  -- Calculate gross salary
  gross_salary := base_salary + commission_amount + bonus_amount;
  -- Calculate advance deduction (don't deduct more than net salary)
  advance_deduction := LEAST(outstanding_advances, gross_salary);
  total_deduction := advance_deduction;
  -- Calculate net salary
  net_salary := gross_salary - total_deduction;
  -- Build result JSON
  result := jsonb_build_object(
    'employeeId', emp_id,
    'periodYear', period_year,
    'periodMonth', period_month,
    'periodStart', period_start,
    'periodEnd', period_end,
    'baseSalary', base_salary,
    'commissionAmount', commission_amount,
    'bonusAmount', bonus_amount,
    'outstandingAdvances', outstanding_advances,
    'advanceDeduction', advance_deduction,
    'totalDeduction', total_deduction,
    'grossSalary', gross_salary,
    'netSalary', net_salary,
    'salaryConfigId', salary_config.id,
    'payrollType', salary_config.payroll_type
  );
  RETURN result;
END;
$function$
;


-- =====================================================
-- Function: create_employee_advance_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_employee_advance_atomic(p_advance jsonb, p_branch_id uuid)
 RETURNS TABLE(success boolean, advance_id uuid, journal_id uuid, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_advance_id UUID;
  v_journal_id UUID;
  v_employee_id UUID;
  v_employee_name TEXT;
  v_amount NUMERIC;
  v_advance_date DATE;
  v_reason TEXT;
  v_payment_account_id TEXT;

  v_kas_account_id TEXT;
  v_piutang_karyawan_id TEXT;
  v_journal_res RECORD;
  v_journal_lines JSONB;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  -- Permission check
  IF auth.uid() IS NOT NULL THEN
    IF NOT check_user_permission(auth.uid(), 'advances_manage') THEN
      RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Tidak memiliki akses untuk membuat kasbon'::TEXT;
      RETURN;
    END IF;
  END IF;

  -- ==================== PARSE DATA ====================

  v_advance_id := COALESCE((p_advance->>'id')::UUID, gen_random_uuid());
  v_employee_id := (p_advance->>'employee_id')::UUID;
  v_employee_name := p_advance->>'employee_name';
  v_amount := COALESCE((p_advance->>'amount')::NUMERIC, 0);
  v_advance_date := COALESCE((p_advance->>'advance_date')::DATE, CURRENT_DATE);
  v_reason := COALESCE(p_advance->>'reason', 'Kasbon karyawan');
  v_payment_account_id := (p_advance->>'payment_account_id'); -- No cast to UUID, it's TEXT

  IF v_employee_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Employee ID is required'::TEXT;
    RETURN;
  END IF;

  IF v_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Amount must be positive'::TEXT;
    RETURN;
  END IF;

  -- Get employee name if not provided (localhost uses profiles, not employees)
  IF v_employee_name IS NULL THEN
    SELECT full_name INTO v_employee_name FROM profiles WHERE id = v_employee_id;
  END IF;

  -- ==================== GET ACCOUNT IDS ====================

  -- Kas account
  IF v_payment_account_id IS NOT NULL THEN
    v_kas_account_id := v_payment_account_id;
  ELSE
    SELECT id INTO v_kas_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '1110' AND is_active = TRUE LIMIT 1;
  END IF;

  -- Piutang Karyawan (1220 atau sesuai chart of accounts)
  SELECT id INTO v_piutang_karyawan_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1220' AND is_active = TRUE LIMIT 1;

  -- Fallback: cari akun dengan nama mengandung "Piutang Karyawan"
  IF v_piutang_karyawan_id IS NULL THEN
    SELECT id INTO v_piutang_karyawan_id FROM accounts
    WHERE branch_id = p_branch_id AND name ILIKE '%piutang karyawan%' AND is_active = TRUE LIMIT 1;
  END IF;

  IF v_kas_account_id IS NULL OR v_piutang_karyawan_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Akun Kas atau Piutang Karyawan tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  -- ==================== INSERT ADVANCE RECORD ====================

  INSERT INTO employee_advances (
    id,
    branch_id,
    employee_id,
    employee_name,
    amount,
    remaining_amount,
    date,      -- Correct column name
    notes,     -- Map reason to notes
    status,
    created_at, -- No created_by column in schema output, let's omit or check if it exists differently? schema said no created_by
    account_id  -- Map payment account
  ) VALUES (
    v_advance_id::TEXT, -- Cast to TEXT as ID in table is TEXT
    p_branch_id,
    v_employee_id,
    v_employee_name,
    v_amount,
    v_amount, 
    v_advance_date,
    v_reason,
    'active',
    NOW(),
    v_payment_account_id
  );

  -- ==================== CREATE JOURNAL ENTRY ====================

  v_journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_piutang_karyawan_id,
      'debit_amount', v_amount,
      'credit_amount', 0,
      'description', 'Kasbon ' || v_employee_name
    ),
    jsonb_build_object(
      'account_id', v_kas_account_id,
      'debit_amount', 0,
      'credit_amount', v_amount,
      'description', 'Pengeluaran kas untuk kasbon'
    )
  );

  SELECT * INTO v_journal_res FROM public.create_journal_atomic(
    p_branch_id,
    'Kasbon Karyawan - ' || v_employee_name || ' - ' || v_reason,
    'advance',
    v_advance_id::TEXT,
    v_journal_lines,
    v_advance_date,
    TRUE -- auto_post
  );

  IF NOT v_journal_res.success THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, v_journal_res.error_message;
    RETURN;
  END IF;

  v_journal_id := v_journal_res.journal_id;

  -- ==================== SUCCESS ====================

  RETURN QUERY SELECT TRUE, v_advance_id, v_journal_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: get_outstanding_advances
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_outstanding_advances(emp_id uuid, up_to_date date DEFAULT CURRENT_DATE)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  total_advances DECIMAL(15,2) := 0;
  total_repayments DECIMAL(15,2) := 0;
  outstanding DECIMAL(15,2) := 0;
BEGIN
  -- Calculate total advances up to the specified date
  SELECT COALESCE(SUM(amount), 0) INTO total_advances
  FROM public.employee_advances
  WHERE employee_id = emp_id
    AND date <= up_to_date;
  -- Calculate total repayments up to the specified date
  SELECT COALESCE(SUM(ar.amount), 0) INTO total_repayments
  FROM public.advance_repayments ar
  JOIN public.employee_advances ea ON ea.id = ar.advance_id
  WHERE ea.employee_id = emp_id
    AND ar.date <= up_to_date;
  -- Calculate outstanding amount
  outstanding := total_advances - total_repayments;
  -- Return 0 if negative (overpaid)
  RETURN GREATEST(outstanding, 0);
END;
$function$
;


-- =====================================================
-- Function: process_advance_repayment_from_salary
-- =====================================================
CREATE OR REPLACE FUNCTION public.process_advance_repayment_from_salary(payroll_record_id uuid, advance_deduction_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  payroll_record RECORD;
  remaining_deduction DECIMAL(15,2);
  advance_record RECORD;
  repayment_amount DECIMAL(15,2);
BEGIN
  -- Get payroll record details
  SELECT pr.*, p.full_name as employee_name
  INTO payroll_record
  FROM public.payroll_records pr
  JOIN public.profiles p ON p.id = pr.employee_id
  WHERE pr.id = payroll_record_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll record not found';
  END IF;
  remaining_deduction := advance_deduction_amount;
  -- Process advances in chronological order (FIFO)
  FOR advance_record IN
    SELECT ea.*, (ea.amount - COALESCE(SUM(ar.amount), 0)) as remaining_amount
    FROM public.employee_advances ea
    LEFT JOIN public.advance_repayments ar ON ar.advance_id = ea.id
    WHERE ea.employee_id = payroll_record.employee_id
      AND ea.date <= payroll_record.period_end
    GROUP BY ea.id, ea.amount, ea.date, ea.employee_id, ea.employee_name, ea.notes, ea.created_at, ea.account_id, ea.account_name
    HAVING (ea.amount - COALESCE(SUM(ar.amount), 0)) > 0
    ORDER BY ea.date ASC
  LOOP
    -- Calculate repayment amount for this advance
    repayment_amount := LEAST(remaining_deduction, advance_record.remaining_amount);
    -- Create repayment record
    INSERT INTO public.advance_repayments (
      id,
      advance_id,
      amount,
      date,
      recorded_by,
      notes
    ) VALUES (
      'rep-' || extract(epoch from now())::bigint || '-' || substring(advance_record.id from 5),
      advance_record.id,
      repayment_amount,
      payroll_record.payment_date,
      payroll_record.created_by,
      'Pemotongan gaji ' || TO_CHAR(DATE(payroll_record.period_year || '-' || payroll_record.period_month || '-01'), 'Month YYYY')
    );
    -- Update remaining deduction
    remaining_deduction := remaining_deduction - repayment_amount;
    -- Update remaining amount using RPC
    PERFORM public.update_remaining_amount(advance_record.id);
    -- Exit if all deduction is processed
    IF remaining_deduction <= 0 THEN
      EXIT;
    END IF;
  END LOOP;
  -- Update account balances for the repayments
  -- Decrease panjar karyawan account (1220)
  PERFORM public.update_account_balance('acc-1220', -advance_deduction_amount);
END;
$function$
;


-- =====================================================
-- Function: repay_employee_advance_atomic
-- =====================================================
-- UPDATED: Added p_payment_account_id parameter to support user-selected payment account
CREATE OR REPLACE FUNCTION public.repay_employee_advance_atomic(
  p_advance_id uuid,
  p_branch_id uuid,
  p_amount numeric,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_payment_account_id uuid DEFAULT NULL,
  p_payment_method text DEFAULT 'cash'::text,
  p_notes text DEFAULT NULL::text
)
 RETURNS TABLE(success boolean, payment_id uuid, journal_id uuid, remaining_amount numeric, is_fully_paid boolean, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_advance RECORD;
  v_payment_id UUID;
  v_journal_id UUID;
  v_kas_account_id TEXT;
  v_piutang_karyawan_id TEXT;
  v_new_remaining NUMERIC;
  v_journal_res RECORD;
  v_journal_lines JSONB;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, FALSE, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, FALSE, 'Amount must be positive'::TEXT;
    RETURN;
  END IF;

  -- Get advance record
  SELECT * INTO v_advance
  FROM employee_advances
  WHERE id = p_advance_id AND branch_id = p_branch_id
  FOR UPDATE;

  IF v_advance.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, FALSE, 'Kasbon tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  IF v_advance.status = 'paid' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, FALSE, 'Kasbon sudah lunas'::TEXT;
    RETURN;
  END IF;

  IF p_amount > v_advance.remaining_amount THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, FALSE,
      format('Jumlah pembayaran (%s) melebihi sisa kasbon (%s)', p_amount, v_advance.remaining_amount)::TEXT;
    RETURN;
  END IF;

  -- ==================== GET ACCOUNT IDS ====================

  -- Use provided payment account ID, or fallback to default 1110
  IF p_payment_account_id IS NOT NULL THEN
    v_kas_account_id := p_payment_account_id::TEXT;
  ELSE
    SELECT id INTO v_kas_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '1110' AND is_active = TRUE LIMIT 1;
  END IF;

  SELECT id INTO v_piutang_karyawan_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1220' AND is_active = TRUE LIMIT 1;

  IF v_piutang_karyawan_id IS NULL THEN
    SELECT id INTO v_piutang_karyawan_id FROM accounts
    WHERE branch_id = p_branch_id AND name ILIKE '%piutang karyawan%' AND is_active = TRUE LIMIT 1;
  END IF;

  -- ==================== CALCULATE NEW REMAINING ====================

  v_new_remaining := v_advance.remaining_amount - p_amount;
  v_payment_id := gen_random_uuid();

  -- ==================== UPDATE ADVANCE RECORD ====================

  UPDATE employee_advances
  SET
    remaining_amount = v_new_remaining,
    status = CASE WHEN v_new_remaining <= 0 THEN 'paid' ELSE 'active' END,
    updated_at = NOW()
  WHERE id = p_advance_id;

  -- ==================== INSERT PAYMENT RECORD ====================

  INSERT INTO employee_advance_payments (
    id,
    advance_id,
    branch_id,
    amount,
    payment_date,
    payment_method,
    notes,
    created_by,
    created_at
  ) VALUES (
    v_payment_id,
    p_advance_id,
    p_branch_id,
    p_amount,
    p_payment_date,
    p_payment_method,
    p_notes,
    auth.uid(),
    NOW()
  );

  -- ==================== CREATE JOURNAL ENTRY ====================

  v_journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_kas_account_id,
      'debit_amount', p_amount,
      'credit_amount', 0,
      'description', 'Penerimaan pembayaran kasbon'
    ),
    jsonb_build_object(
      'account_id', v_piutang_karyawan_id,
      'debit_amount', 0,
      'credit_amount', p_amount,
      'description', 'Pelunasan piutang karyawan'
    )
  );

  SELECT * INTO v_journal_res FROM public.create_journal_atomic(
    p_branch_id,
    'Pembayaran Kasbon - ' || v_advance.employee_name,
    'advance_payment',
    v_payment_id::TEXT,
    v_journal_lines,
    p_payment_date,
    TRUE -- auto_post
  );

  IF NOT v_journal_res.success THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, FALSE, v_journal_res.error_message;
    RETURN;
  END IF;

  v_journal_id := v_journal_res.journal_id;

  -- ==================== SUCCESS ====================

  RETURN QUERY SELECT TRUE, v_payment_id, v_journal_id, v_new_remaining, (v_new_remaining <= 0), NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, FALSE, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: void_employee_advance_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.void_employee_advance_atomic(p_advance_id uuid, p_branch_id uuid, p_reason text DEFAULT 'Dibatalkan'::text)
 RETURNS TABLE(success boolean, journals_voided integer, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_advance RECORD;
  v_journals_voided INTEGER := 0;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  -- Get advance
  SELECT * INTO v_advance
  FROM employee_advances
  WHERE id = p_advance_id::TEXT AND branch_id = p_branch_id
  FOR UPDATE;

  IF v_advance.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 'Kasbon tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  -- Cannot void if there are payments
  IF v_advance.remaining_amount < v_advance.amount THEN
    RETURN QUERY SELECT FALSE, 0, 'Tidak bisa membatalkan kasbon yang sudah ada pembayaran'::TEXT;
    RETURN;
  END IF;

  -- ==================== VOID JOURNALS ====================

  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_reason = p_reason,
    status = 'voided',
    updated_at = NOW()
  WHERE reference_type = 'advance'
    AND reference_id = p_advance_id::TEXT
    AND branch_id = p_branch_id
    AND is_voided = FALSE;

  GET DIAGNOSTICS v_journals_voided = ROW_COUNT;

  -- ==================== UPDATE ADVANCE STATUS ====================

  UPDATE employee_advances
  SET
    status = 'cancelled'
    -- updated_at doesn't exist in schema, removing it
  WHERE id = p_advance_id::TEXT;

  -- ==================== SUCCESS ====================

  RETURN QUERY SELECT TRUE, v_journals_voided, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0, SQLERRM::TEXT;
END;
$function$
;


