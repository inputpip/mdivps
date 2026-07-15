\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_transaction record;
BEGIN
  SELECT
    t.id,
    t.branch_id,
    t.total,
    t.paid_amount
  INTO v_transaction
  FROM public.transactions t
  WHERE COALESCE(t.is_voided, false) = false
    AND COALESCE(t.is_cancelled, false) = false
    AND COALESCE(t.total, 0) > COALESCE(t.paid_amount, 0)
  ORDER BY t.order_date DESC NULLS LAST, t.id
  LIMIT 1;

  IF NOT FOUND THEN
    -- A tenant may currently have no outstanding row. Reuse one fully paid,
    -- active transaction inside this rollback-only test and temporarily make it
    -- partial so the INSERT branch of the trigger is still exercised.
    SELECT
      t.id,
      t.branch_id,
      t.total,
      GREATEST(COALESCE(t.total, 0) - 1, 0) AS paid_amount
    INTO v_transaction
    FROM public.transactions t
    WHERE COALESCE(t.total, 0) > 0
    ORDER BY
      (COALESCE(t.is_voided, false) OR COALESCE(t.is_cancelled, false)) ASC,
      t.order_date DESC NULLS LAST,
      t.id
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE NOTICE 'SKIP: no safe active transaction fixture';
      RETURN;
    END IF;

    UPDATE public.transactions t
    SET
      paid_amount = v_transaction.paid_amount,
      payment_status = 'Partial',
      is_voided = false,
      is_cancelled = false
    WHERE t.id = v_transaction.id
      AND t.branch_id IS NOT DISTINCT FROM v_transaction.branch_id;
  END IF;

  DELETE FROM public.receivables r
  WHERE r.transaction_id = v_transaction.id
    AND r.branch_id IS NOT DISTINCT FROM v_transaction.branch_id;

  UPDATE public.transactions t
  SET paid_amount = paid_amount
  WHERE t.id = v_transaction.id
    AND t.branch_id IS NOT DISTINCT FROM v_transaction.branch_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.receivables r
    WHERE r.transaction_id = v_transaction.id
      AND r.branch_id IS NOT DISTINCT FROM v_transaction.branch_id
      AND COALESCE(r.amount, 0) = COALESCE(v_transaction.total, 0)
      AND COALESCE(r.paid_amount, 0) = LEAST(
        COALESCE(v_transaction.paid_amount, 0),
        COALESCE(v_transaction.total, 0)
      )
      AND r.status IN ('pending', 'partial')
  ) THEN
    RAISE EXCEPTION 'receivable projection was not recreated correctly for transaction %', v_transaction.id;
  END IF;

  RAISE NOTICE 'PASS: projection recreated for transaction %', v_transaction.id;
END;
$test$;

ROLLBACK;
