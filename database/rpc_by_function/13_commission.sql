-- =====================================================
-- 13 COMMISSION
-- Generated: 2026-01-09T00:29:07.863Z
-- Updated: Added void_commission_payment function
-- Total functions: 7
-- =====================================================

-- Functions in this file:
--   calculate_commission_amount
--   calculate_commission_for_period
--   get_commission_summary
--   get_pending_commissions
--   pay_commission_atomic
--   populate_commission_product_info
--   void_commission_payment (NEW)

-- =====================================================
-- Function: calculate_commission_amount
-- =====================================================
CREATE OR REPLACE FUNCTION public.calculate_commission_amount() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
BEGIN
  NEW.amount = NEW.quantity * NEW.rate_per_qty;
  RETURN NEW;
END;
$function$;


-- =====================================================
-- Function: calculate_commission_for_period
-- =====================================================
CREATE OR REPLACE FUNCTION public.calculate_commission_for_period(emp_id uuid, start_date date, end_date date) RETURNS numeric
    LANGUAGE plpgsql
    AS $function$
DECLARE
  total_commission DECIMAL(15,2) := 0;
BEGIN
  -- Calculate commission from commission_entries table
  SELECT COALESCE(SUM(amount), 0) INTO total_commission
  FROM commission_entries
  WHERE user_id = emp_id::text
    AND status = 'pending'
    AND created_at >= start_date
    AND created_at < (end_date + INTERVAL '1 day');
  RETURN total_commission;
END;
$function$;


-- =====================================================
-- Function: get_commission_summary
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_commission_summary(p_branch_id uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date) RETURNS TABLE(employee_id uuid, employee_name text, role text, total_pending numeric, total_paid numeric, pending_count bigint, paid_count bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
BEGIN
  RETURN QUERY
  SELECT
    ce.user_id,
    MAX(ce.user_name),
    MAX(ce.role),
    COALESCE(SUM(CASE WHEN ce.status = 'pending' THEN ce.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ce.status = 'paid' THEN ce.amount ELSE 0 END), 0),
    COUNT(CASE WHEN ce.status = 'pending' THEN 1 END),
    COUNT(CASE WHEN ce.status = 'paid' THEN 1 END)
  FROM commission_entries ce
  WHERE ce.branch_id = p_branch_id
    AND (p_date_from IS NULL OR ce.entry_date >= p_date_from)
    AND (p_date_to IS NULL OR ce.entry_date <= p_date_to)
  GROUP BY ce.user_id
  ORDER BY MAX(ce.user_name);
END;
$function$;


-- =====================================================
-- Function: get_pending_commissions
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_pending_commissions(p_employee_id uuid, p_branch_id uuid) RETURNS TABLE(commission_id uuid, amount numeric, commission_type text, product_name text, transaction_id text, delivery_id uuid, entry_date date, created_at timestamp without time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
BEGIN
  RETURN QUERY
  SELECT
    ce.id,
    ce.amount,
    ce.commission_type,
    p.name,
    ce.transaction_id,
    ce.delivery_id,
    ce.entry_date,
    ce.created_at
  FROM commission_entries ce
  LEFT JOIN products p ON p.id = ce.product_id
  WHERE ce.user_id = p_employee_id
    AND ce.branch_id = p_branch_id
    AND ce.status = 'pending'
  ORDER BY ce.created_at;
END;
$function$;


-- =====================================================
-- Function: pay_commission_atomic
-- =====================================================
-- UPDATED: Added p_payment_account_id parameter to support user-selected payment account
CREATE OR REPLACE FUNCTION public.pay_commission_atomic(p_employee_id uuid, p_branch_id uuid, p_amount numeric, p_payment_date date DEFAULT CURRENT_DATE, p_payment_method text DEFAULT 'cash'::text, p_commission_ids uuid[] DEFAULT NULL::uuid[], p_notes text DEFAULT NULL::text, p_paid_by uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, payment_id uuid, journal_id uuid, commissions_paid integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_payment_id UUID;
  v_journal_id UUID;
  v_employee_name TEXT;
  v_kas_account_id UUID;
  v_beban_komisi_id UUID;
  v_entry_number TEXT;
  v_commissions_paid INTEGER := 0;
  v_total_pending NUMERIC;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  IF p_employee_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, 'Employee ID is required'::TEXT;
    RETURN;
  END IF;
  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, 'Amount must be positive'::TEXT;
    RETURN;
  END IF;
  -- Get employee name from profiles table (localhost uses profiles, not employees)
  SELECT full_name INTO v_employee_name FROM profiles WHERE id = p_employee_id;
  IF v_employee_name IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, 'Karyawan tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- Check total pending commissions
  SELECT COALESCE(SUM(amount), 0) INTO v_total_pending
  FROM commission_entries
  WHERE user_id = p_employee_id
    AND branch_id = p_branch_id
    AND status = 'pending';
  IF v_total_pending < p_amount THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0,
      format('Jumlah pembayaran (%s) melebihi total komisi pending (%s)', p_amount, v_total_pending)::TEXT;
    RETURN;
  END IF;
  -- ==================== GET ACCOUNT IDS ====================
  SELECT id INTO v_kas_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1110' AND is_active = TRUE LIMIT 1;
  -- Beban Komisi (biasanya 6200 atau sesuai chart of accounts)
  SELECT id INTO v_beban_komisi_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '6200' AND is_active = TRUE LIMIT 1;
  -- Fallback: cari akun dengan nama mengandung "Komisi"
  IF v_beban_komisi_id IS NULL THEN
    SELECT id INTO v_beban_komisi_id FROM accounts
    WHERE branch_id = p_branch_id AND name ILIKE '%komisi%' AND type = 'expense' AND is_active = TRUE LIMIT 1;
  END IF;
  -- Fallback: gunakan Beban Gaji (6100)
  IF v_beban_komisi_id IS NULL THEN
    SELECT id INTO v_beban_komisi_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '6100' AND is_active = TRUE LIMIT 1;
  END IF;
  IF v_kas_account_id IS NULL OR v_beban_komisi_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, 'Akun Kas atau Beban Komisi tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- ==================== UPDATE COMMISSION ENTRIES ====================
  v_payment_id := gen_random_uuid();
  IF p_commission_ids IS NOT NULL AND array_length(p_commission_ids, 1) > 0 THEN
    -- Pay specific commission entries
    UPDATE commission_entries
    SET
      status = 'paid',
      paid_at = NOW(),
      payment_id = v_payment_id,
      updated_at = NOW()
    WHERE id = ANY(p_commission_ids)
      AND user_id = p_employee_id
      AND branch_id = p_branch_id
      AND status = 'pending';
    GET DIAGNOSTICS v_commissions_paid = ROW_COUNT;
  ELSE
    -- Pay oldest pending commissions up to amount
    WITH to_pay AS (
      SELECT id, amount,
        SUM(amount) OVER (ORDER BY created_at) as running_total
      FROM commission_entries
      WHERE user_id = p_employee_id
        AND branch_id = p_branch_id
        AND status = 'pending'
      ORDER BY created_at
    )
    UPDATE commission_entries ce
    SET
      status = 'paid',
      paid_at = NOW(),
      payment_id = v_payment_id,
      updated_at = NOW()
    FROM to_pay tp
    WHERE ce.id = tp.id
      AND tp.running_total <= p_amount;
    GET DIAGNOSTICS v_commissions_paid = ROW_COUNT;
  END IF;
  -- ==================== INSERT PAYMENT RECORD ====================
  INSERT INTO commission_payments (
    id,
    employee_id,
    employee_name,
    branch_id,
    amount,
    payment_date,
    payment_method,
    notes,
    paid_by,
    created_at
  ) VALUES (
    v_payment_id,
    p_employee_id,
    v_employee_name,
    p_branch_id,
    p_amount,
    p_payment_date,
    p_payment_method,
    p_notes,
    p_paid_by,
    NOW()
  );
  -- ==================== CREATE JOURNAL ENTRY ====================
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE(
      (SELECT COUNT(*) + 1 FROM journal_entries
       WHERE branch_id = p_branch_id
       AND DATE(created_at) = CURRENT_DATE),
      1
    ))::TEXT, 4, '0')
  INTO v_entry_number;
  INSERT INTO journal_entries (
    id,
    branch_id,
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    status,
    is_voided,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    p_branch_id,
    v_entry_number,
    p_payment_date,
    'Pembayaran Komisi - ' || v_employee_name,
    'commission_payment',
    v_payment_id::TEXT,
    'posted',
    FALSE,
    NOW(),
    NOW()
  ) RETURNING id INTO v_journal_id;
  -- Dr. Beban Komisi
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_beban_komisi_id,
    (SELECT name FROM accounts WHERE id = v_beban_komisi_id),
    p_amount, 0, 'Beban komisi ' || v_employee_name, 1
  );
  -- Cr. Kas
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_kas_account_id,
    (SELECT name FROM accounts WHERE id = v_kas_account_id),
    0, p_amount, 'Pengeluaran kas untuk komisi', 2
  );
  -- ==================== SUCCESS ====================
  RETURN QUERY SELECT TRUE, v_payment_id, v_journal_id, v_commissions_paid, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, SQLERRM::TEXT;
END;
$function$;


CREATE OR REPLACE FUNCTION public.pay_commission_atomic(p_employee_id uuid, p_branch_id uuid, p_amount numeric, p_payment_date date DEFAULT CURRENT_DATE, p_payment_account_id uuid DEFAULT NULL::uuid, p_payment_method text DEFAULT 'cash'::text, p_commission_ids uuid[] DEFAULT NULL::uuid[], p_notes text DEFAULT NULL::text, p_paid_by uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, payment_id uuid, journal_id uuid, commissions_paid integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_payment_id UUID;
  v_journal_id UUID;
  v_employee_name TEXT;
  v_kas_account_id UUID;
  v_beban_komisi_id UUID;
  v_commissions_paid INTEGER := 0;
  v_total_pending NUMERIC;
  v_journal_res RECORD;
  v_journal_lines JSONB;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  IF p_employee_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, 'Employee ID is required'::TEXT;
    RETURN;
  END IF;
  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, 'Amount must be positive'::TEXT;
    RETURN;
  END IF;
  -- Get employee name from profiles table (localhost uses profiles, not employees)
  SELECT full_name INTO v_employee_name FROM profiles WHERE id = p_employee_id;
  IF v_employee_name IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, 'Karyawan tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- Check total pending commissions
  SELECT COALESCE(SUM(amount), 0) INTO v_total_pending
  FROM commission_entries
  WHERE user_id = p_employee_id
    AND branch_id = p_branch_id
    AND status = 'pending';
  IF v_total_pending < p_amount THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0,
      format('Jumlah pembayaran (%s) melebihi total komisi pending (%s)', p_amount, v_total_pending)::TEXT;
    RETURN;
  END IF;
  -- ==================== GET ACCOUNT IDS ====================
  -- Use provided payment account ID, or fallback to default 1110
  IF p_payment_account_id IS NOT NULL THEN
    v_kas_account_id := p_payment_account_id;
  ELSE
    SELECT id INTO v_kas_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '1110' AND is_active = TRUE LIMIT 1;
  END IF;
  -- Beban Komisi (biasanya 6200 atau sesuai chart of accounts)
  SELECT id INTO v_beban_komisi_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '6200' AND is_active = TRUE LIMIT 1;
  -- Fallback: cari akun dengan nama mengandung "Komisi"
  IF v_beban_komisi_id IS NULL THEN
    SELECT id INTO v_beban_komisi_id FROM accounts
    WHERE branch_id = p_branch_id AND name ILIKE '%komisi%' AND type = 'expense' AND is_active = TRUE LIMIT 1;
  END IF;
  -- Fallback: gunakan Beban Gaji (6100)
  IF v_beban_komisi_id IS NULL THEN
    SELECT id INTO v_beban_komisi_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '6100' AND is_active = TRUE LIMIT 1;
  END IF;
  IF v_kas_account_id IS NULL OR v_beban_komisi_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, 'Akun Kas atau Beban Komisi tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- ==================== UPDATE COMMISSION ENTRIES ====================
  v_payment_id := gen_random_uuid();
  IF p_commission_ids IS NOT NULL AND array_length(p_commission_ids, 1) > 0 THEN
    -- Pay specific commission entries
    UPDATE commission_entries
    SET
      status = 'paid',
      paid_at = NOW(),
      payment_id = v_payment_id,
      updated_at = NOW()
    WHERE id = ANY(p_commission_ids)
      AND user_id = p_employee_id
      AND branch_id = p_branch_id
      AND status = 'pending';
    GET DIAGNOSTICS v_commissions_paid = ROW_COUNT;
  ELSE
    -- Pay oldest pending commissions up to amount
    WITH to_pay AS (
      SELECT id, amount,
        SUM(amount) OVER (ORDER BY created_at) as running_total
      FROM commission_entries
      WHERE user_id = p_employee_id
        AND branch_id = p_branch_id
        AND status = 'pending'
      ORDER BY created_at
    )
    UPDATE commission_entries ce
    SET
      status = 'paid',
      paid_at = NOW(),
      payment_id = v_payment_id,
      updated_at = NOW()
    FROM to_pay tp
    WHERE ce.id = tp.id
      AND tp.running_total <= p_amount;
    GET DIAGNOSTICS v_commissions_paid = ROW_COUNT;
  END IF;
  -- ==================== INSERT PAYMENT RECORD ====================
  INSERT INTO commission_payments (
    id,
    employee_id,
    employee_name,
    branch_id,
    amount,
    payment_date,
    payment_method,
    notes,
    paid_by,
    created_at
  ) VALUES (
    v_payment_id,
    p_employee_id,
    v_employee_name,
    p_branch_id,
    p_amount,
    p_payment_date,
    p_payment_method,
    p_notes,
    p_paid_by,
    NOW()
  );
  -- ==================== CREATE JOURNAL ENTRY ====================

  v_journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_beban_komisi_id,
      'debit_amount', p_amount,
      'credit_amount', 0,
      'description', 'Bevan komisi ' || v_employee_name
    ),
    jsonb_build_object(
      'account_id', v_kas_account_id,
      'debit_amount', 0,
      'credit_amount', p_amount,
      'description', 'Pengeluaran kas untuk komisi'
    )
  );

  SELECT * INTO v_journal_res FROM public.create_journal_atomic(
    p_branch_id,
    'Pembayaran Komisi - ' || v_employee_name,
    'commission_payment',
    v_payment_id::TEXT,
    v_journal_lines,
    p_payment_date,
    TRUE -- auto_post
  );

  IF NOT v_journal_res.success THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, v_journal_res.error_message;
    RETURN;
  END IF;

  v_journal_id := v_journal_res.journal_id;
  -- ==================== SUCCESS ====================
  RETURN QUERY SELECT TRUE, v_payment_id, v_journal_id, v_commissions_paid, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, SQLERRM::TEXT;
END;
$function$;


-- =====================================================
-- Function: populate_commission_product_info
-- =====================================================
CREATE OR REPLACE FUNCTION public.populate_commission_product_info() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
BEGIN
  -- Try to get product name from products table
  SELECT p.name 
  INTO NEW.product_name
  FROM products p 
  WHERE p.id = NEW.product_id;
  
  -- If product name not found, use product_id as fallback
  IF NEW.product_name IS NULL THEN
    NEW.product_name = COALESCE(NEW.product_name, NEW.product_id::text);
  END IF;
  
  NEW.updated_at = NOW();

  RETURN NEW;
END;
$function$;


-- =====================================================
-- Function: void_commission_payment
-- =====================================================
-- Void/Cancel a commission payment and restore commission entries to pending
CREATE OR REPLACE FUNCTION public.void_commission_payment(p_payment_id uuid, p_branch_id uuid, p_reason text DEFAULT 'Cancelled'::text) RETURNS TABLE(success boolean, journals_voided integer, commissions_restored integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_payment RECORD;
  v_journals_voided INTEGER := 0;
  v_commissions_restored INTEGER := 0;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  IF p_payment_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 'Payment ID is required'::TEXT;
    RETURN;
  END IF;

  -- Get payment record
  SELECT * INTO v_payment
  FROM commission_payments
  WHERE id = p_payment_id AND branch_id = p_branch_id;

  IF v_payment.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 'Commission payment not found'::TEXT;
    RETURN;
  END IF;

  -- ==================== RESTORE COMMISSION ENTRIES ====================
  -- Reset commission status from 'paid' back to 'pending'
  UPDATE commission_entries
  SET
    status = 'pending',
    paid_at = NULL,
    payment_id = NULL,
    updated_at = NOW()
  WHERE payment_id = p_payment_id
    AND branch_id = p_branch_id
    AND status = 'paid';
  GET DIAGNOSTICS v_commissions_restored = ROW_COUNT;

  -- ==================== VOID JOURNALS ====================
  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_reason = p_reason,
    updated_at = NOW()
  WHERE reference_type = 'commission_payment'
    AND reference_id = p_payment_id::TEXT
    AND branch_id = p_branch_id
    AND is_voided = FALSE;
  GET DIAGNOSTICS v_journals_voided = ROW_COUNT;

  -- ==================== DELETE PAYMENT RECORD ====================
  DELETE FROM commission_payments WHERE id = p_payment_id;

  -- ==================== SUCCESS ====================
  RETURN QUERY SELECT TRUE, v_journals_voided, v_commissions_restored, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0, 0, SQLERRM::TEXT;
END;
$function$;


