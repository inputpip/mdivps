-- UPDATED: Added status check for cancelled advances
CREATE OR REPLACE FUNCTION public.repay_employee_advance_atomic(p_advance_id uuid, p_branch_id uuid, p_amount numeric, p_payment_date date DEFAULT CURRENT_DATE, p_payment_account_id uuid DEFAULT NULL::uuid, p_payment_method text DEFAULT 'cash'::text, p_notes text DEFAULT NULL::text) RETURNS TABLE(success boolean, payment_id uuid, journal_id uuid, remaining_amount numeric, is_fully_paid boolean, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
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
  WHERE id = p_advance_id::text AND branch_id = p_branch_id
  FOR UPDATE;

  IF v_advance.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, FALSE, 'Kasbon tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  IF v_advance.status = 'paid' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, FALSE, 'Kasbon sudah lunas'::TEXT;
    RETURN;
  END IF;

  IF v_advance.status = 'cancelled' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, FALSE, 'Kasbon sudah dibatalkan'::TEXT;
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
  WHERE id = p_advance_id::text;

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
$function$;
