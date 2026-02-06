-- =====================================================
-- 12 PAYROLL SALARY
-- Generated: 2026-01-09T00:29:07.863Z
-- Total functions: 8
-- =====================================================

-- Functions in this file:
--   create_payroll_record
--   get_active_salary_config
--   notify_payroll_processed
--   process_payroll_complete
--   sync_payroll_commissions_to_entries
--   update_payroll_record_atomic
--   update_payroll_updated_at
--   void_payroll_record

-- =====================================================
-- Function: create_payroll_record
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_payroll_record(p_payroll jsonb, p_branch_id uuid)
 RETURNS TABLE(success boolean, payroll_id uuid, net_salary numeric, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_payroll_id UUID;
  v_employee_id UUID;
  v_period_year INTEGER;
  v_period_month INTEGER;
  v_period_start DATE;
  v_period_end DATE;
  v_base_salary NUMERIC;
  v_commission NUMERIC;
  v_bonus NUMERIC;
  v_advance_deduction NUMERIC;
  v_salary_deduction NUMERIC;
  v_total_deductions NUMERIC;
  v_gross_salary NUMERIC;
  v_net_salary NUMERIC;
  v_notes TEXT;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC,
      'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  IF p_payroll IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC,
      'Payroll data is required'::TEXT;
    RETURN;
  END IF;
  -- ==================== PARSE DATA ====================
  v_employee_id := (p_payroll->>'employee_id')::UUID;
  v_period_year := COALESCE((p_payroll->>'period_year')::INTEGER, EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER);
  v_period_month := COALESCE((p_payroll->>'period_month')::INTEGER, EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER);
  v_base_salary := COALESCE((p_payroll->>'base_salary')::NUMERIC, 0);
  v_commission := COALESCE((p_payroll->>'commission')::NUMERIC, 0);
  v_bonus := COALESCE((p_payroll->>'bonus')::NUMERIC, 0);
  v_advance_deduction := COALESCE((p_payroll->>'advance_deduction')::NUMERIC, 0);
  v_salary_deduction := COALESCE((p_payroll->>'salary_deduction')::NUMERIC, 0);
  v_notes := p_payroll->>'notes';
  IF v_employee_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC,
      'Employee ID is required'::TEXT;
    RETURN;
  END IF;
  -- Calculate period dates
  v_period_start := make_date(v_period_year, v_period_month, 1);
  v_period_end := (v_period_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
  -- Calculate amounts
  v_total_deductions := v_advance_deduction + v_salary_deduction;
  v_gross_salary := v_base_salary + v_commission + v_bonus;
  v_net_salary := v_gross_salary - v_total_deductions;
  -- ==================== CHECK DUPLICATE ====================
  IF EXISTS (
    SELECT 1 FROM payroll_records
    WHERE employee_id = v_employee_id
      AND period_start = v_period_start
      AND period_end = v_period_end
      AND branch_id = p_branch_id
  ) THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC,
      format('Payroll untuk karyawan ini periode %s-%s sudah ada', v_period_year, v_period_month)::TEXT;
    RETURN;
  END IF;
  -- ==================== INSERT PAYROLL RECORD ====================
  INSERT INTO payroll_records (
    employee_id,
    period_start,
    period_end,
    base_salary,
    total_commission,
    total_bonus,
    total_deductions,
    advance_deduction,
    salary_deduction,
    net_salary,
    status,
    notes,
    branch_id,
    created_at
  ) VALUES (
    v_employee_id,
    v_period_start,
    v_period_end,
    v_base_salary,
    v_commission,
    v_bonus,
    v_total_deductions,
    v_advance_deduction,
    v_salary_deduction,
    v_net_salary,
    'draft',
    v_notes,
    p_branch_id,
    NOW()
  )
  RETURNING id INTO v_payroll_id;
  RETURN QUERY SELECT TRUE, v_payroll_id, v_net_salary, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: get_active_salary_config
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_active_salary_config(emp_id uuid, check_date date)
 RETURNS employee_salaries
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  result public.employee_salaries;
BEGIN
  -- First try exact match (effective_from <= check_date)
  SELECT * INTO result
  FROM public.employee_salaries
  WHERE employee_id = emp_id
    AND is_active = true
    AND effective_from <= check_date
    AND (effective_until IS NULL OR effective_until >= check_date)
  ORDER BY effective_from DESC
  LIMIT 1;
  -- If not found, just get any active config for this employee
  IF result IS NULL THEN
    SELECT * INTO result
    FROM public.employee_salaries
    WHERE employee_id = emp_id
      AND is_active = true
    ORDER BY effective_from DESC
    LIMIT 1;
  END IF;
  RETURN result;
END;
$function$
;


-- =====================================================
-- Function: notify_payroll_processed
-- =====================================================
CREATE OR REPLACE FUNCTION public.notify_payroll_processed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Only notify for payroll payment type
    IF NEW.type = 'pembayaran_gaji' THEN
        INSERT INTO notifications (id, title, message, type, reference_type, reference_id, reference_url, priority)
        VALUES (
            'NOTIF-PAYROLL-' || NEW.id || '-' || EXTRACT(EPOCH FROM NOW())::TEXT,
            'Payroll Payment Processed',
            'Salary payment of Rp ' || TO_CHAR(NEW.amount, 'FM999,999,999,999') || ' for ' || COALESCE(NEW.reference_name, 'employee'),
            'payroll_processed',
            'payroll',
            NEW.reference_id,
            '/payroll',
            'normal'
        );
    END IF;
    RETURN NEW;
END;
$function$
;


-- =====================================================
-- Function: process_payroll_complete
-- =====================================================
CREATE OR REPLACE FUNCTION public.process_payroll_complete(p_payroll_id uuid, p_branch_id uuid, p_payment_account_id text, p_payment_date date DEFAULT CURRENT_DATE, p_expense_account_id text DEFAULT NULL)
 RETURNS TABLE(success boolean, journal_id uuid, advances_updated integer, commissions_paid integer, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_payroll RECORD;
  v_journal_id UUID;
  v_journal_lines JSONB := '[]'::JSONB;
  v_employee_name TEXT;
  v_gross_salary NUMERIC;
  v_net_salary NUMERIC;
  v_advance_deduction NUMERIC;
  v_salary_deduction NUMERIC;
  v_total_deductions NUMERIC;
  v_advances_updated INTEGER := 0;
  v_commissions_paid INTEGER := 0;
  v_remaining_deduction NUMERIC;
  v_advance RECORD;
  v_amount_to_deduct NUMERIC;
  v_beban_gaji_account TEXT;
  v_panjar_account TEXT;
  v_period_start DATE;
  v_period_end DATE;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0,
      'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  IF p_payroll_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0,
      'Payroll ID is required'::TEXT;
    RETURN;
  END IF;
  IF p_payment_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0,
      'Payment account ID is required'::TEXT;
    RETURN;
  END IF;
  -- ==================== GET PAYROLL DATA ====================
  SELECT
    pr.*,
    p.full_name as employee_name
  INTO v_payroll
  FROM payroll_records pr
  LEFT JOIN profiles p ON p.id = pr.employee_id
  WHERE pr.id = p_payroll_id AND pr.branch_id = p_branch_id;
  IF v_payroll.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0,
      'Payroll record not found in this branch'::TEXT;
    RETURN;
  END IF;
  IF v_payroll.status = 'paid' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0,
      'Payroll sudah dibayar'::TEXT;
    RETURN;
  END IF;
  -- ==================== PREPARE DATA ====================
  v_employee_name := COALESCE(v_payroll.employee_name, 'Karyawan');
  v_advance_deduction := COALESCE(v_payroll.advance_deduction, 0);
  v_salary_deduction := COALESCE(v_payroll.salary_deduction, 0);
  v_total_deductions := COALESCE(v_payroll.total_deductions, v_advance_deduction + v_salary_deduction);
  v_net_salary := v_payroll.net_salary;
  v_gross_salary := COALESCE(v_payroll.base_salary, 0) +
                    COALESCE(v_payroll.total_commission, 0) +
                    COALESCE(v_payroll.total_bonus, 0);
  v_period_start := v_payroll.period_start;
  v_period_end := v_payroll.period_end;
  -- ==================== GET ACCOUNT IDS ====================
  -- Beban Gaji (Keyword Search)
  IF p_expense_account_id IS NOT NULL THEN
    v_beban_gaji_account := p_expense_account_id;
  ELSE
    SELECT id INTO v_beban_gaji_account
    FROM accounts
    WHERE branch_id = p_branch_id 
      AND (name ILIKE '%Beban%' AND name ILIKE '%Gaji%')
      AND is_active = TRUE
    LIMIT 1;
  END IF;

  -- Panjar Karyawan / Kasbon (Keyword Search)
  SELECT id INTO v_panjar_account
  FROM accounts
  WHERE branch_id = p_branch_id 
    AND (name ILIKE '%Panjar%' OR name ILIKE '%Kasbon%' OR (name ILIKE '%Piutang%' AND name ILIKE '%Karyawan%'))
    AND is_active = TRUE
  LIMIT 1;

  IF v_beban_gaji_account IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0,
      'Akun Beban Gaji tidak ditemukan (Keyword: Beban Gaji). Mohon periksa nama akun di COA Anda.'::TEXT;
    RETURN;
  END IF;
  -- ==================== BUILD JOURNAL LINES ====================
  -- Debit: Beban Gaji (gross salary)
  v_journal_lines := v_journal_lines || jsonb_build_object(
    'account_id', v_beban_gaji_account,
    'debit_amount', v_gross_salary,
    'credit_amount', 0,
    'description', format('Beban gaji %s periode %s-%s',
      v_employee_name,
      EXTRACT(YEAR FROM v_period_start),
      EXTRACT(MONTH FROM v_period_start))
  );
  -- Credit: Kas (net salary)
  v_journal_lines := v_journal_lines || jsonb_build_object(
    'account_id', p_payment_account_id,
    'debit_amount', 0,
    'credit_amount', v_net_salary,
    'description', format('Pembayaran gaji %s', v_employee_name)
  );
  -- Credit: Panjar Karyawan (if any deductions)
  IF v_advance_deduction > 0 AND v_panjar_account IS NOT NULL THEN
    v_journal_lines := v_journal_lines || jsonb_build_object(
      'account_id', v_panjar_account,
      'debit_amount', 0,
      'credit_amount', v_advance_deduction,
      'description', format('Potongan panjar %s', v_employee_name)
    );
  END IF;

  -- Credit: Other deductions (salary deduction) - IMPORTANT: MUST BALANCE THE JOURNAL
  IF v_salary_deduction > 0 THEN
    -- Find an adjustment/income account for deductions
    DECLARE
      v_adjustment_account TEXT;
    BEGIN
      SELECT id INTO v_adjustment_account FROM accounts 
      WHERE branch_id = p_branch_id 
        AND (name ILIKE '%Pendapatan%Lain%' OR name ILIKE '%Penyesuaian%' OR name ILIKE '%Potongan%')
        AND is_active = TRUE LIMIT 1;
        
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_id', COALESCE(v_adjustment_account, p_payment_account_id), -- Fallback to payment account if no adjustment account
        'debit_amount', 0,
        'credit_amount', v_salary_deduction,
        'description', format('Potongan gaji lainnya %s', v_employee_name)
      );
    END;
  END IF;
  -- ==================== CREATE JOURNAL ====================
  SELECT c.journal_id INTO v_journal_id FROM create_journal_atomic(
    p_branch_id := p_branch_id,
    p_description := format('Pembayaran Gaji %s - %s/%s',
      v_employee_name,
      EXTRACT(MONTH FROM v_period_start),
      EXTRACT(YEAR FROM v_period_start)),
    p_reference_type := 'payroll',
    p_reference_id := p_payroll_id::TEXT,
    p_lines := v_journal_lines,
    p_entry_date := p_payment_date,
    p_auto_post := TRUE,
    p_created_by := NULL::uuid
  ) c;
  -- ==================== UPDATE PAYROLL STATUS ====================
  UPDATE payroll_records
  SET
    status = 'paid',
    paid_date = p_payment_date,
    updated_at = NOW()
  WHERE id = p_payroll_id;
  -- ==================== UPDATE EMPLOYEE ADVANCES ====================
  IF v_advance_deduction > 0 AND v_payroll.employee_id IS NOT NULL THEN
    v_remaining_deduction := v_advance_deduction;
    FOR v_advance IN
      SELECT id, remaining_amount
      FROM employee_advances
      WHERE employee_id = v_payroll.employee_id
        AND remaining_amount > 0
      ORDER BY date ASC  -- FIFO: oldest first
    LOOP
      EXIT WHEN v_remaining_deduction <= 0;
      v_amount_to_deduct := LEAST(v_remaining_deduction, v_advance.remaining_amount);
      UPDATE employee_advances
      SET remaining_amount = remaining_amount - v_amount_to_deduct
      WHERE id = v_advance.id;
      v_remaining_deduction := v_remaining_deduction - v_amount_to_deduct;
      v_advances_updated := v_advances_updated + 1;
    END LOOP;
  END IF;
  -- ==================== UPDATE COMMISSION ENTRIES ====================
  IF v_payroll.employee_id IS NOT NULL THEN
    UPDATE commission_entries
    SET status = 'paid'
    WHERE user_id = v_payroll.employee_id::TEXT
      AND branch_id = p_branch_id
      AND status = 'pending'
      AND created_at >= v_period_start
      AND created_at <= v_period_end + INTERVAL '1 day';
    GET DIAGNOSTICS v_commissions_paid = ROW_COUNT;
  END IF;
  -- ==================== SUCCESS ====================
  RETURN QUERY SELECT TRUE, v_journal_id, v_advances_updated, v_commissions_paid, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: sync_payroll_commissions_to_entries
-- =====================================================
CREATE OR REPLACE FUNCTION public.sync_payroll_commissions_to_entries()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  synced_count INTEGER := 0;
  payroll_record RECORD;
BEGIN
  -- Loop through payroll records with commissions that haven't been synced
  FOR payroll_record IN
    SELECT
      pr.*,
      p.full_name as employee_name,
      p.role as employee_role
    FROM payroll_records pr
    JOIN profiles p ON p.id = pr.employee_id
    WHERE pr.commission_amount > 0
      AND pr.status = 'paid'
      AND NOT EXISTS (
        SELECT 1 FROM commission_entries ce
        WHERE ce.source_id = pr.id AND ce.source_type = 'payroll'
      )
  LOOP
    -- Insert commission entry for the payroll commission
    INSERT INTO commission_entries (
      id,
      user_id,
      user_name,
      role,
      amount,
      quantity,
      product_name,
      delivery_id,
      source_type,
      source_id,
      created_at
    ) VALUES (
      'comm-payroll-' || payroll_record.id,
      payroll_record.employee_id,
      payroll_record.employee_name,
      payroll_record.employee_role,
      payroll_record.commission_amount,
      1, -- Quantity 1 for payroll commission
      'Komisi Gaji ' || TO_CHAR(DATE(payroll_record.period_year || '-' || payroll_record.period_month || '-01'), 'Month YYYY'),
      NULL, -- No delivery_id for payroll commissions
      'payroll',
      payroll_record.id,
      payroll_record.created_at
    );
    synced_count := synced_count + 1;
  END LOOP;
  RETURN synced_count;
END;
$function$
;


-- =====================================================
-- Function: update_payroll_record_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_payroll_record_atomic(p_payroll_id uuid, p_branch_id uuid, p_base_salary numeric, p_commission numeric, p_bonus numeric, p_advance_deduction numeric, p_salary_deduction numeric, p_notes text)
 RETURNS TABLE(success boolean, net_salary numeric, journal_id uuid, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_old_record RECORD;
  v_new_net_salary NUMERIC;
  v_new_gross_salary NUMERIC;
  v_new_total_deductions NUMERIC;
  v_journal_id UUID;
  v_beban_gaji_account TEXT;
  v_panjar_account TEXT;
  v_payment_account_id TEXT;
  v_journal_lines JSONB := '[]'::JSONB;
BEGIN
  -- 1. Get Old Record
  SELECT * INTO v_old_record FROM payroll_records 
  WHERE id = p_payroll_id AND branch_id = p_branch_id;
  
  IF v_old_record.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, NULL::UUID, 'Data gaji tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- 2. Calculate New Amounts
  v_new_gross_salary := COALESCE(p_base_salary, v_old_record.base_salary) + 
                        COALESCE(p_commission, v_old_record.total_commission) + 
                        COALESCE(p_bonus, v_old_record.total_bonus);
  
  v_new_total_deductions := COALESCE(p_advance_deduction, v_old_record.advance_deduction) + 
                           COALESCE(p_salary_deduction, v_old_record.salary_deduction);
  
  v_new_net_salary := v_new_gross_salary - v_new_total_deductions;
  -- 3. Update Record
  UPDATE payroll_records
  SET
    base_salary = COALESCE(p_base_salary, base_salary),
    total_commission = COALESCE(p_commission, total_commission),
    total_bonus = COALESCE(p_bonus, total_bonus),
    advance_deduction = COALESCE(p_advance_deduction, advance_deduction),
    salary_deduction = COALESCE(p_salary_deduction, salary_deduction),
    total_deductions = v_new_total_deductions,
    net_salary = v_new_net_salary,
    notes = COALESCE(p_notes, notes),
    updated_at = NOW()
  WHERE id = p_payroll_id;
  -- 4. Handle Journal Update if Status is 'paid'
  IF v_old_record.status = 'paid' THEN
    -- Find existing journal
    SELECT id INTO v_journal_id FROM journal_entries 
    WHERE reference_id = p_payroll_id::TEXT AND reference_type = 'payroll' AND branch_id = p_branch_id
    ORDER BY created_at DESC LIMIT 1;
    IF v_journal_id IS NOT NULL THEN
      -- Get Accounts
      SELECT id INTO v_beban_gaji_account FROM accounts WHERE branch_id = p_branch_id AND code = '6110' LIMIT 1;
      SELECT id INTO v_panjar_account FROM accounts WHERE branch_id = p_branch_id AND code = '1220' LIMIT 1;
      v_payment_account_id := v_old_record.payment_account_id;
      -- Debit: Beban Gaji (gross)
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_id', v_beban_gaji_account,
        'debit_amount', v_new_gross_salary,
        'credit_amount', 0,
        'description', 'Beban gaji (updated)'
      );
      -- Credit: Kas (net)
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_id', v_payment_account_id,
        'debit_amount', 0,
        'credit_amount', v_new_net_salary,
        'description', 'Pembayaran gaji (updated)'
      );
      -- Credit: Panjar (deductions)
      IF COALESCE(p_advance_deduction, v_old_record.advance_deduction) > 0 AND v_panjar_account IS NOT NULL THEN
        v_journal_lines := v_journal_lines || jsonb_build_object(
          'account_id', v_panjar_account,
          'debit_amount', 0,
          'credit_amount', COALESCE(p_advance_deduction, v_old_record.advance_deduction),
          'description', 'Potongan panjar (updated)'
        );
      END IF;
      -- Delete old lines and insert new ones
      DELETE FROM journal_entry_lines WHERE journal_entry_id = v_journal_id;
      
      INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, description, debit_amount, credit_amount)
      SELECT v_journal_id, row_number() OVER (), (line->>'account_id'), line->>'description', (line->>'debit_amount')::NUMERIC, (line->>'credit_amount')::NUMERIC
      FROM jsonb_array_elements(v_journal_lines) AS line;
      -- Update header totals
      UPDATE journal_entries 
      SET total_debit = v_new_gross_salary, 
          total_credit = v_new_gross_salary,
          updated_at = NOW()
      WHERE id = v_journal_id;
    END IF;
  END IF;
  RETURN QUERY SELECT TRUE, v_new_net_salary, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0::NUMERIC, NULL::UUID, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: update_payroll_updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_payroll_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$
;


-- =====================================================
-- Function: void_payroll_record
-- =====================================================
-- UPDATED: Added rollback for commissions and advances
CREATE OR REPLACE FUNCTION public.void_payroll_record(p_payroll_id uuid, p_branch_id uuid, p_reason text DEFAULT 'Cancelled'::text)
 RETURNS TABLE(success boolean, journals_voided integer, commissions_restored integer, advances_restored numeric, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_payroll RECORD;
  v_journals_voided INTEGER := 0;
  v_commissions_restored INTEGER := 0;
  v_advances_restored NUMERIC := 0;
  v_advance_record RECORD;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0::NUMERIC, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  -- Get payroll
  SELECT * INTO v_payroll
  FROM payroll_records
  WHERE id = p_payroll_id AND branch_id = p_branch_id;

  IF v_payroll.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0::NUMERIC, 'Payroll record not found'::TEXT;
    RETURN;
  END IF;

  -- ==================== ROLLBACK COMMISSIONS ====================
  -- Reset commission status from 'paid' back to 'pending'
  -- FIX: Use reference_id or check column existence
  UPDATE commission_entries
  SET
    status = 'pending',
    paid_at = NULL,
    paid_via = NULL,
    updated_at = NOW()
  WHERE (payroll_id = p_payroll_id OR reference_id = p_payroll_id::TEXT)
    AND branch_id = p_branch_id
    AND status = 'paid';
  GET DIAGNOSTICS v_commissions_restored = ROW_COUNT;

  -- ==================== ROLLBACK ADVANCE DEDUCTIONS ====================
  -- If payroll had advance deduction, restore the remaining_amount in employee_advances
  IF v_payroll.advance_deduction > 0 THEN
    -- Find advances that were deducted for this payroll and restore them
    -- We need to track which advances were deducted - check if there's a reference
    -- For now, we'll restore to the most recent active advance for this employee
    FOR v_advance_record IN
      SELECT ea.id, ea.remaining_amount, ea.amount
      FROM employee_advances ea
      WHERE ea.employee_id = v_payroll.employee_id
        AND ea.branch_id = p_branch_id
        AND ea.status = 'active'
      ORDER BY ea.created_at DESC
      LIMIT 1
    LOOP
      -- Restore the deducted amount back to remaining_amount
      UPDATE employee_advances
      SET
        remaining_amount = remaining_amount + v_payroll.advance_deduction,
        updated_at = NOW()
      WHERE id = v_advance_record.id;

      v_advances_restored := v_payroll.advance_deduction;
    END LOOP;
  END IF;

  -- ==================== VOID JOURNALS ====================
  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_reason = p_reason,
    updated_at = NOW()
  WHERE reference_type = 'payroll'
    AND reference_id = p_payroll_id::TEXT
    AND branch_id = p_branch_id
    AND is_voided = FALSE;
  GET DIAGNOSTICS v_journals_voided = ROW_COUNT;

  -- ==================== DELETE PAYROLL RECORD ====================
  -- Note: This will cascade delete related records if FK is set
  DELETE FROM payroll_records WHERE id = p_payroll_id;

  -- ==================== SUCCESS ====================
  RETURN QUERY SELECT TRUE, v_journals_voided, v_commissions_restored, v_advances_restored, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0, 0, 0::NUMERIC, SQLERRM::TEXT;
END;
$function$
;


