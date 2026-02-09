-- =====================================================
-- 24 PAYMENT HISTORY
-- Generated: 2026-02-09 (Updated with Filter Support)
-- Total functions: 4
-- =====================================================

-- Functions in this file:
--   get_payment_history_rpc
--   record_payment_history
--   update_payment_status
--   void_payment_history_rpc

-- =====================================================
-- Function: get_payment_history_rpc
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_payment_history_rpc(p_branch_id uuid, p_limit integer DEFAULT 100, p_date_from date DEFAULT NULL, p_date_to date DEFAULT NULL, p_account_id text DEFAULT NULL)
 RETURNS TABLE(id uuid, payment_date timestamp with time zone, amount numeric, transaction_id text, customer_name text, payment_method text, notes text, account_name text, user_name text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        ph.id,
        ph.payment_date,
        ph.amount,
        ph.transaction_id,
        t.customer_name,
        ph.payment_method,
        ph.notes,
        COALESCE(a.name, 'Kas Besar') as account_name,
        COALESCE(pr.full_name, ph.recorded_by_name, 'System') as user_name,
        ph.created_at
    FROM payment_history ph
    LEFT JOIN transactions t ON ph.transaction_id = t.id
    LEFT JOIN accounts a ON ph.account_id = a.id
    LEFT JOIN profiles pr ON ph.recorded_by = pr.id
    WHERE ph.branch_id = p_branch_id
      AND (p_date_from IS NULL OR DATE(ph.payment_date) >= p_date_from)
      AND (p_date_to IS NULL OR DATE(ph.payment_date) <= p_date_to)
      AND (p_account_id IS NULL OR p_account_id = 'all' OR ph.account_id = p_account_id)
    ORDER BY ph.payment_date DESC
    LIMIT p_limit;
END;
$function$
;


-- =====================================================
-- Function: record_payment_history
-- =====================================================
CREATE OR REPLACE FUNCTION public.record_payment_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- Only trigger if paid_amount increased
  IF NEW.paid_amount > OLD.paid_amount THEN
    INSERT INTO public.payment_history (
      transaction_id,
      amount,
      payment_date,
      remaining_amount,
      recorded_by_name
    ) VALUES (
      NEW.id,
      NEW.paid_amount - OLD.paid_amount,
      NOW(),
      NEW.total - NEW.paid_amount,
      'System Auto-Record'
    );
  END IF;
  RETURN NEW;
END;
$function$
;


-- =====================================================
-- Function: update_payment_status
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_payment_status()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Auto-update payment status based on paid amount vs total
  IF NEW.paid_amount >= NEW.total THEN
    NEW.payment_status := 'Lunas';
  ELSIF NEW.paid_amount > 0 THEN
    NEW.payment_status := 'Belum Lunas';
  ELSE
    -- Keep existing payment_status if no payment yet
    -- Could be 'Kredit' or 'Belum Lunas'
  END IF;
  
  RETURN NEW;
END;
$function$
;


-- =====================================================
-- Function: void_payment_history_rpc
-- =====================================================
CREATE OR REPLACE FUNCTION public.void_payment_history_rpc(p_payment_id uuid, p_branch_id uuid, p_reason text DEFAULT 'Pembayaran dibatalkan'::text)
 RETURNS TABLE(success boolean, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_payment RECORD;
    v_transaction RECORD;
BEGIN
    -- Validasi branch_id
    IF p_branch_id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Branch ID is required'::TEXT;
        RETURN;
    END IF;

    -- Get payment info
    SELECT 
        ph.id,
        ph.transaction_id,
        ph.amount,
        ph.branch_id,
        ph.payment_date
    INTO v_payment
    FROM payment_history ph
    WHERE ph.id = p_payment_id
      AND ph.branch_id = p_branch_id;

    IF v_payment.id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Payment not found in this branch'::TEXT;
        RETURN;
    END IF;

    -- Get transaction info
    SELECT 
        t.id,
        t.total,
        t.paid_amount,
        t.payment_status
    INTO v_transaction
    FROM transactions t
    WHERE t.id = v_payment.transaction_id;

    IF v_transaction.id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Transaction not found'::TEXT;
        RETURN;
    END IF;

    -- Update transaction: reduce paid_amount
    UPDATE transactions
    SET 
        paid_amount = GREATEST(0, COALESCE(paid_amount, 0) - v_payment.amount),
        payment_status = CASE 
            WHEN GREATEST(0, COALESCE(paid_amount, 0) - v_payment.amount) >= total THEN 'Lunas'
            WHEN GREATEST(0, COALESCE(paid_amount, 0) - v_payment.amount) > 0 THEN 'Partial'
            ELSE 'Belum Lunas'
        END,
        updated_at = NOW()
    WHERE id = v_payment.transaction_id;

    -- Delete payment history record
    DELETE FROM payment_history
    WHERE id = p_payment_id;

    -- Void related journal entry if exists
    UPDATE journal_entries
    SET 
        is_voided = TRUE,
        voided_at = NOW(),
        void_reason = p_reason
    WHERE reference_type = 'receivable_payment'
      AND reference_id = p_payment_id::TEXT
      AND branch_id = p_branch_id;

    RETURN QUERY SELECT TRUE, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT FALSE, SQLERRM::TEXT;
END;
$function$
;
