-- Keep the legacy receivables projection aligned with transactions while all
-- user-facing outstanding balances read the same canonical transaction fields.
-- This migration is non-destructive: receivables remains available for legacy RPCs.

CREATE OR REPLACE FUNCTION public.sync_receivable_projection_from_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_status text;
BEGIN
  -- Serialize projection creation for the same transaction. This prevents two
  -- concurrent writers from creating duplicate receivable rows without relying
  -- on destructive cleanup or a new uniqueness constraint over legacy data.
  PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(NEW.branch_id::text, '') || ':' || NEW.id, 0));

  v_status := CASE
    WHEN COALESCE(NEW.is_voided, false) OR COALESCE(NEW.is_cancelled, false) THEN 'cancelled'
    WHEN COALESCE(NEW.paid_amount, 0) >= COALESCE(NEW.total, 0) THEN 'paid'
    WHEN COALESCE(NEW.paid_amount, 0) > 0 THEN 'partial'
    ELSE 'pending'
  END;

  UPDATE public.receivables
  SET
    branch_id = NEW.branch_id,
    customer_id = NEW.customer_id,
    customer_name = NEW.customer_name,
    amount = COALESCE(NEW.total, 0),
    paid_amount = LEAST(COALESCE(NEW.paid_amount, 0), COALESCE(NEW.total, 0)),
    status = v_status,
    due_date = NEW.due_date,
    updated_at = NOW()
  WHERE transaction_id = NEW.id
    AND branch_id IS NOT DISTINCT FROM NEW.branch_id;

  -- Paid/voided transactions do not need a new legacy outstanding projection.
  -- Existing rows are retained with their terminal status for compatibility.
  IF NOT FOUND
     AND v_status IN ('pending', 'partial')
     AND COALESCE(NEW.total, 0) > COALESCE(NEW.paid_amount, 0) THEN
    INSERT INTO public.receivables (
      transaction_id, branch_id, customer_id, customer_name,
      amount, paid_amount, status, due_date, created_at, updated_at
    ) VALUES (
      NEW.id, NEW.branch_id, NEW.customer_id, NEW.customer_name,
      COALESCE(NEW.total, 0),
      LEAST(COALESCE(NEW.paid_amount, 0), COALESCE(NEW.total, 0)),
      v_status, NEW.due_date, NOW(), NOW()
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- Repair existing projections from the canonical transaction state.
UPDATE public.receivables r
SET
  branch_id = t.branch_id,
  customer_id = t.customer_id,
  customer_name = t.customer_name,
  amount = COALESCE(t.total, 0),
  paid_amount = LEAST(COALESCE(t.paid_amount, 0), COALESCE(t.total, 0)),
  status = CASE
    WHEN COALESCE(t.is_voided, false) OR COALESCE(t.is_cancelled, false) THEN 'cancelled'
    WHEN COALESCE(t.paid_amount, 0) >= COALESCE(t.total, 0) THEN 'paid'
    WHEN COALESCE(t.paid_amount, 0) > 0 THEN 'partial'
    ELSE 'pending'
  END,
  due_date = t.due_date,
  updated_at = NOW()
FROM public.transactions t
WHERE r.transaction_id = t.id
  AND r.branch_id IS NOT DISTINCT FROM t.branch_id;

-- Backfill missing projections, including manual/migrated receivables that were
-- inserted directly into transactions and bypassed create_transaction_atomic.
INSERT INTO public.receivables (
  transaction_id, branch_id, customer_id, customer_name,
  amount, paid_amount, status, due_date, created_at, updated_at
)
SELECT
  t.id, t.branch_id, t.customer_id, t.customer_name,
  COALESCE(t.total, 0),
  LEAST(COALESCE(t.paid_amount, 0), COALESCE(t.total, 0)),
  CASE WHEN COALESCE(t.paid_amount, 0) > 0 THEN 'partial' ELSE 'pending' END,
  t.due_date, NOW(), NOW()
FROM public.transactions t
WHERE COALESCE(t.is_voided, false) = false
  AND COALESCE(t.is_cancelled, false) = false
  AND COALESCE(t.total, 0) > COALESCE(t.paid_amount, 0)
  AND NOT EXISTS (
    SELECT 1
    FROM public.receivables r
    WHERE r.transaction_id = t.id
      AND r.branch_id IS NOT DISTINCT FROM t.branch_id
  );

DROP TRIGGER IF EXISTS trg_sync_receivable_projection_from_transaction
ON public.transactions;

CREATE TRIGGER trg_sync_receivable_projection_from_transaction
AFTER INSERT OR UPDATE OF paid_amount, payment_status, total, customer_id, customer_name, due_date, branch_id, is_voided, is_cancelled
ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.sync_receivable_projection_from_transaction();

COMMENT ON FUNCTION public.sync_receivable_projection_from_transaction() IS
'Keeps the legacy receivables projection synchronized with canonical transaction payment state for compatibility.';
