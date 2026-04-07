-- 1. Redefine the `pay_receivable_complete_rpc` function to correctly link the journal entry to the payment ID

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
        NOW() 
    ) RETURNING id INTO v_payment_id;

    -- 3. Create journal entry via RPC
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

    -- 4. FIX: Link the journal entry explicitly to this payment_id
    -- so that void_payment_history_rpc can find it when deleting!
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


-- 2. Data Migration: Update existing journal entries incorrectly using transaction_id to use payment_id
-- We find journal_entries of type 'receivable_payment' and cross-match them with 'payment_history'
-- using the transaction_id, branch_id, amount, and rough created_at timeframe.
UPDATE journal_entries je
SET reference_id = ph.id::TEXT
FROM payment_history ph
WHERE je.reference_type = 'receivable_payment'
  AND je.reference_id = ph.transaction_id
  AND je.total_debit = ph.amount 
  AND je.branch_id = ph.branch_id
  -- Match timeframe (usually within seconds)
  AND abs(extract(epoch from je.created_at) - extract(epoch from ph.created_at)) < 60;
