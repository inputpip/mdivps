-- =====================================================
-- 09 RECEIVABLE PAYABLE
-- Generated: 2026-02-09 (Added Backdate Support)
-- Total functions: 8
-- =====================================================

-- Functions in this file:
--   notify_debt_payment
--   pay_receivable
--   pay_receivable_complete_rpc
--   pay_receivable_complete_rpc
--   pay_receivable_with_history
--   record_receivable_payment
--   update_overdue_installments_atomic
--   update_remaining_amount

-- =====================================================
-- Function: notify_debt_payment
-- =====================================================
CREATE OR REPLACE FUNCTION public.notify_debt_payment() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
BEGIN
    -- Only notify for debt payment type
    IF NEW.type = 'pembayaran_utang' THEN
        INSERT INTO notifications (id, title, message, type, reference_type, reference_id, reference_url, priority)
        VALUES (
            'NOTIF-DEBT-' || NEW.id || '-' || EXTRACT(EPOCH FROM NOW())::TEXT,
            'Debt Payment Recorded',
            'Payment of Rp ' || TO_CHAR(NEW.amount, 'FM999,999,999,999') || ' for ' || COALESCE(NEW.description, 'debt payment'),
            'debt_payment',
            'accounts_payable',
            NEW.reference_id,
            '/accounts-payable',
            'normal'
        );
    END IF;
    RETURN NEW;
END;
$function$;


-- =====================================================
-- Function: pay_receivable
-- =====================================================
CREATE OR REPLACE FUNCTION public.pay_receivable(p_transaction_id text, p_amount numeric) RETURNS void
    LANGUAGE plpgsql
    AS $function$
DECLARE
  current_paid_amount numeric;
  new_paid_amount numeric;
  total_amount numeric;
BEGIN
  SELECT paid_amount, total INTO current_paid_amount, total_amount
  FROM public.transactions
  WHERE id = p_transaction_id;
  new_paid_amount := current_paid_amount + p_amount;
  UPDATE public.transactions
  SET
    paid_amount = new_paid_amount,
    payment_status = CASE
      WHEN new_paid_amount >= total_amount THEN 'Lunas'
      ELSE 'Belum Lunas'
    END
  WHERE id = p_transaction_id;
END;
$function$;


-- =====================================================
-- Function: pay_receivable_complete_rpc
-- =====================================================
CREATE OR REPLACE FUNCTION public.pay_receivable_complete_rpc(p_branch_id uuid, p_receivable_id uuid, p_amount numeric, p_payment_method text DEFAULT 'cash'::text, p_payment_account_id text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_created_by uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, payment_id uuid, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_payment_id UUID := gen_random_uuid();
  v_journal_id UUID := gen_random_uuid();
  v_journal_number TEXT;
  v_receivable RECORD;
  v_kas_account_id TEXT;
  v_piutang_account_id TEXT;
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Branch ID wajib diisi'::TEXT;
    RETURN;
  END IF;

  SELECT r.*, c.name as customer_name INTO v_receivable
  FROM receivables r LEFT JOIN customers c ON r.customer_id = c.id
  WHERE r.id = p_receivable_id AND r.branch_id = p_branch_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Piutang tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  IF p_payment_account_id IS NOT NULL THEN
    v_kas_account_id := p_payment_account_id;
  ELSE
    SELECT id INTO v_kas_account_id FROM accounts WHERE code = '1110' AND branch_id = p_branch_id;
  END IF;

  SELECT id INTO v_piutang_account_id FROM accounts WHERE code = '1210' AND branch_id = p_branch_id;

  IF v_kas_account_id IS NULL OR v_piutang_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Akun kas atau piutang tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  v_journal_number := 'JE-PAY-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM()*10000)::TEXT, 4, '0');

  INSERT INTO journal_entries (id, entry_number, entry_date, description, reference_type, reference_id, status, total_debit, total_credit, branch_id, created_by, created_at, is_voided)
  VALUES (v_journal_id, v_journal_number, CURRENT_DATE, format('Pembayaran piutang: %s', COALESCE(v_receivable.customer_name, 'Customer')), 'payment', v_payment_id::TEXT, 'posted', p_amount, p_amount, p_branch_id, p_created_by, NOW(), FALSE);

  INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, account_code, account_name, description, debit_amount, credit_amount)
  SELECT v_journal_id, 1, a.id, a.code, a.name, format('Terima dari %s', COALESCE(v_receivable.customer_name, 'Customer')), p_amount, 0
  FROM accounts a WHERE a.id = v_kas_account_id;

  INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, account_code, account_name, description, debit_amount, credit_amount)
  SELECT v_journal_id, 2, a.id, a.code, a.name, format('Pelunasan piutang: %s', COALESCE(v_receivable.customer_name, 'Customer')), 0, p_amount
  FROM accounts a WHERE a.id = v_piutang_account_id;

  INSERT INTO receivable_payments (id, receivable_id, amount, payment_method, payment_date, notes, journal_id, created_by, created_at)
  VALUES (v_payment_id, p_receivable_id, p_amount, p_payment_method, CURRENT_DATE, p_notes, v_journal_id, p_created_by, NOW());

  UPDATE receivables SET paid_amount = paid_amount + p_amount, status = CASE WHEN paid_amount + p_amount >= total_amount THEN 'paid' ELSE 'partial' END WHERE id = p_receivable_id;

  RETURN QUERY SELECT TRUE, v_payment_id, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, SQLERRM::TEXT;
END;
$function$;


CREATE OR REPLACE FUNCTION public.pay_receivable_complete_rpc(p_transaction_id text, p_amount numeric, p_payment_account_id text, p_notes text DEFAULT NULL::text, p_branch_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid, p_recorded_by_name text DEFAULT NULL::text, p_payment_date date DEFAULT CURRENT_DATE) RETURNS TABLE(success boolean, payment_id uuid, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
    v_transaction RECORD;
    v_payment_id UUID;
    v_journal_result RECORD;
    v_new_paid_amount NUMERIC;
    v_new_status TEXT;
    v_payment_date DATE;
BEGIN
    -- Set payment date
    v_payment_date := COALESCE(p_payment_date, CURRENT_DATE);

    -- Get transaction info
    SELECT 
        t.id,
        t.total,
        t.paid_amount,
        t.payment_status,
        t.branch_id,
        t.customer_name
    INTO v_transaction
    FROM transactions t
    WHERE t.id = p_transaction_id;

    IF v_transaction.id IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Transaction not found'::TEXT;
        RETURN;
    END IF;

    -- Use transaction's branch_id if not provided
    IF p_branch_id IS NULL THEN
        p_branch_id := v_transaction.branch_id;
    END IF;

    -- Validate amount
    IF p_amount <= 0 THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Amount must be positive'::TEXT;
        RETURN;
    END IF;

    v_new_paid_amount := COALESCE(v_transaction.paid_amount, 0) + p_amount;
    
    IF v_new_paid_amount > v_transaction.total THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Payment exceeds remaining balance'::TEXT;
        RETURN;
    END IF;

    -- Determine new payment status
    IF v_new_paid_amount >= v_transaction.total THEN
        v_new_status := 'Lunas';
    ELSIF v_new_paid_amount > 0 THEN
        v_new_status := 'Partial';
    ELSE
        v_new_status := 'Belum Lunas';
    END IF;

    -- 1. Update transaction
    UPDATE transactions
    SET 
        paid_amount = v_new_paid_amount,
        payment_status = v_new_status,
        updated_at = NOW()
    WHERE id = p_transaction_id;

    -- 2. Insert payment history
    INSERT INTO payment_history (
        transaction_id,
        branch_id,
        amount,
        remaining_amount,
        payment_method,
        account_id,
        payment_date,
        notes,
        recorded_by,
        recorded_by_name,
        created_at
    ) VALUES (
        p_transaction_id,
        p_branch_id,
        p_amount,
        (v_transaction.total - v_new_paid_amount),
        'Tunai',
        p_payment_account_id,
        v_payment_date,
        p_notes,
        p_user_id,
        p_recorded_by_name,
        NOW() -- CreatedAt remains NOW even for backdated payments
    ) RETURNING id INTO v_payment_id;

    -- 3. Create journal entry via RPC
    -- Note: Ensure create_receivable_payment_journal_rpc accepts date parameter
    -- Usually it is signature: (p_branch_id, p_transaction_id, p_date, p_amount, p_customer_name, p_account_id)
    SELECT * INTO v_journal_result
    FROM create_receivable_payment_journal_rpc(
        p_branch_id,
        p_transaction_id,
        v_payment_date,
        p_amount,
        v_transaction.customer_name,
        p_payment_account_id
    );

    IF NOT v_journal_result.success THEN
        RAISE EXCEPTION 'Failed to create journal: %', v_journal_result.error_message;
    END IF;

    -- FIX: Re-link journal reference_id to payment_id (bukan transaction_id)
    -- Supaya void_payment_history_rpc bisa menemukan jurnal ini via payment_id
    UPDATE journal_entries
    SET reference_id = v_payment_id::TEXT
    WHERE id = v_journal_result.journal_id;

    RETURN QUERY SELECT 
        TRUE, 
        v_payment_id, 
        v_journal_result.journal_id,
        NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, SQLERRM::TEXT;
END;
$function$;


-- =====================================================
-- Function: pay_receivable_complete_rpc (OVERLOAD)
-- =====================================================



-- =====================================================
-- Function: pay_receivable_with_history
-- =====================================================
CREATE OR REPLACE FUNCTION public.pay_receivable_with_history(p_transaction_id text, p_amount numeric, p_account_id text DEFAULT NULL::text, p_account_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_recorded_by text DEFAULT NULL::text, p_recorded_by_name text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $_$
DECLARE
  v_transaction RECORD;
  v_remaining_amount NUMERIC;
BEGIN
  -- Get current transaction
  SELECT * INTO v_transaction FROM public.transactions WHERE id = p_transaction_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;
  
  -- Calculate remaining amount after this payment
  v_remaining_amount := v_transaction.total - (v_transaction.paid_amount + p_amount);
  
  IF v_remaining_amount < 0 THEN
    RAISE EXCEPTION 'Payment amount exceeds remaining balance';
  END IF;
  
  -- Update transaction
  UPDATE public.transactions 
  SET 
    paid_amount = paid_amount + p_amount,
    payment_status = CASE 
      WHEN paid_amount + p_amount >= total THEN 'Lunas'
      ELSE 'Belum Lunas'
    END
  WHERE id = p_transaction_id;
  
  -- Record payment history
  INSERT INTO public.payment_history (
    transaction_id,
    amount,
    payment_date,
    remaining_amount,
    account_id,
    account_name,
    notes,
    recorded_by,
    recorded_by_name
  ) VALUES (
    p_transaction_id,
    p_amount,
    NOW(),
    v_remaining_amount,
    p_account_id,
    p_account_name,
    p_notes,
    CASE WHEN p_recorded_by IS NOT NULL AND p_recorded_by ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' 
         THEN p_recorded_by::uuid 
         ELSE NULL 
    END,
    p_recorded_by_name
  );
END;
$_$;


-- =====================================================
-- Function: record_receivable_payment
-- =====================================================
CREATE OR REPLACE FUNCTION public.record_receivable_payment(p_transaction_id text, p_amount numeric, p_payment_method text DEFAULT 'cash'::text, p_account_id text DEFAULT NULL::text, p_account_name text DEFAULT 'Kas'::text, p_description text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_reference_number text DEFAULT NULL::text, p_paid_by_user_id uuid DEFAULT NULL::uuid, p_paid_by_user_name text DEFAULT 'System'::text, p_paid_by_user_role text DEFAULT 'staff'::text) RETURNS uuid
    LANGUAGE plpgsql
    AS $function$
DECLARE
  payment_id UUID;
  transaction_total NUMERIC;
  current_paid NUMERIC;
  new_payment_description TEXT;
BEGIN
  -- Validate transaction exists
  SELECT total INTO transaction_total FROM transactions WHERE id = p_transaction_id;
  IF transaction_total IS NULL THEN
    RAISE EXCEPTION 'Transaction not found: %', p_transaction_id;
  END IF;
  
  -- Calculate current paid amount
  SELECT COALESCE(SUM(amount), 0) INTO current_paid
  FROM transaction_payments 
  WHERE transaction_id = p_transaction_id AND status = 'active';
  
  -- Validate payment amount
  IF (current_paid + p_amount) > transaction_total THEN
    RAISE EXCEPTION 'Payment amount exceeds remaining balance';
  END IF;
  
  -- Generate description
  new_payment_description := COALESCE(p_description, 'Pembayaran piutang - ' || 
    CASE 
      WHEN (current_paid + p_amount) >= transaction_total THEN 'Pelunasan'
      ELSE 'Pembayaran ke-' || ((SELECT COUNT(*) FROM transaction_payments WHERE transaction_id = p_transaction_id AND status = 'active') + 1)
    END
  );
  
  -- Insert payment record
  INSERT INTO transaction_payments (
    transaction_id, amount, payment_method, account_id, account_name,
    description, notes, reference_number,
    paid_by_user_id, paid_by_user_name, paid_by_user_role, created_by
  ) VALUES (
    p_transaction_id, p_amount, p_payment_method, p_account_id, p_account_name,
    new_payment_description, p_notes, p_reference_number,
    p_paid_by_user_id, p_paid_by_user_name, p_paid_by_user_role, p_paid_by_user_id
  )
  RETURNING id INTO payment_id;
  
  -- Update transaction
  UPDATE transactions 
  SET 
    paid_amount = current_paid + p_amount,
    payment_status = CASE 
      WHEN current_paid + p_amount >= total THEN 'Lunas'::text
      ELSE 'Belum Lunas'::text
    END
  WHERE id = p_transaction_id;
  
  RETURN payment_id;
END;
$function$;


-- =====================================================
-- Function: update_overdue_installments_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_overdue_installments_atomic() RETURNS TABLE(updated_count integer, success boolean, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_updated_count INTEGER := 0;
BEGIN
  -- Update all pending installments that are past due date
  UPDATE debt_installments
  SET
    status = 'overdue'
  WHERE status = 'pending'
    AND due_date < CURRENT_DATE;
  
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  
  RETURN QUERY SELECT 
    v_updated_count,
    TRUE,
    NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT 
    0,
    FALSE,
    SQLERRM::TEXT;
END;
$function$;


-- =====================================================
-- Function: update_remaining_amount
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_remaining_amount(p_advance_id text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_total_repaid NUMERIC := 0;
  v_original_amount NUMERIC := 0;
  v_new_remaining NUMERIC := 0;
BEGIN
  -- Get the original advance amount
  SELECT amount INTO v_original_amount
  FROM public.employee_advances 
  WHERE id = p_advance_id;
  
  IF v_original_amount IS NULL THEN
    RAISE EXCEPTION 'Advance with ID % not found', p_advance_id;
  END IF;
  
  -- Calculate total repaid amount for this advance
  SELECT COALESCE(SUM(amount), 0) INTO v_total_repaid
  FROM public.advance_repayments 
  WHERE advance_id = p_advance_id;
  
  -- Calculate new remaining amount
  v_new_remaining := v_original_amount - v_total_repaid;
  
  -- Ensure remaining amount doesn't go below 0
  IF v_new_remaining < 0 THEN
    v_new_remaining := 0;
  END IF;
  
  -- Update the remaining amount
  UPDATE public.employee_advances 
  SET remaining_amount = v_new_remaining
  WHERE id = p_advance_id;
  
END;
$function$;
