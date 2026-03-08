-- =====================================================
-- 20 TRIGGER FUNCTIONS
-- Generated: 2026-01-09T00:29:07.865Z
-- Total functions: 10
-- =====================================================

-- Functions in this file:
--   audit_trigger_func
--   prevent_posted_journal_lines_update
--   prevent_posted_journal_update
--   tf_update_balance_on_journal_change
--   tf_update_balance_on_line_change
--   trigger_migration_delivery_journal
--   trigger_process_advance_repayment
--   trigger_sync_payroll_commission
--   update_product_materials_updated_at
--   update_updated_at_column

-- =====================================================
-- Function: audit_trigger_func
-- =====================================================
CREATE OR REPLACE FUNCTION public.audit_trigger_func() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  old_data jsonb := NULL;
  new_data jsonb := NULL;
  changed_fields jsonb := NULL;
  record_id text := NULL;
  current_user_id uuid := NULL;
  current_user_email text := NULL;
  current_user_role text := NULL;
  key text;
  old_value jsonb;
  new_value jsonb;
BEGIN
  -- Coba ambil info user dari JWT
  BEGIN
    current_user_id := (current_setting('request.jwt.claims', true)::jsonb->>'sub')::uuid;
    current_user_email := current_setting('request.jwt.claims', true)::jsonb->>'email';
    current_user_role := current_setting('request.jwt.claims', true)::jsonb->>'role';
  EXCEPTION WHEN OTHERS THEN
    current_user_email := current_user;
  END;
  IF (TG_OP = 'DELETE') THEN
    old_data := to_jsonb(OLD);
    record_id := COALESCE(OLD.id::text, 'unknown');
  ELSIF (TG_OP = 'UPDATE') THEN
    old_data := to_jsonb(OLD);
    new_data := to_jsonb(NEW);
    record_id := COALESCE(NEW.id::text, OLD.id::text, 'unknown');
    -- Hitung field yang berubah
    changed_fields := '{}'::jsonb;
    FOR key IN SELECT jsonb_object_keys(new_data)
    LOOP
      old_value := old_data->key;
      new_value := new_data->key;
      IF old_value IS DISTINCT FROM new_value AND key NOT IN ('updated_at') THEN
        changed_fields := changed_fields || jsonb_build_object(
          key, jsonb_build_object('old', old_value, 'new', new_value)
        );
      END IF;
    END LOOP;
    IF changed_fields = '{}'::jsonb THEN
      RETURN NEW;
    END IF;
  ELSIF (TG_OP = 'INSERT') THEN
    new_data := to_jsonb(NEW);
    record_id := COALESCE(NEW.id::text, 'unknown');
  END IF;
  INSERT INTO audit_logs (table_name, operation, record_id, old_data, new_data, changed_fields, user_id, user_email, user_role, created_at)
  VALUES (TG_TABLE_NAME, TG_OP, record_id, old_data, new_data, changed_fields, current_user_id, current_user_email, current_user_role, NOW());
  IF (TG_OP = 'DELETE') THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;


-- =====================================================
-- Function: prevent_posted_journal_lines_update
-- =====================================================
CREATE OR REPLACE FUNCTION public.prevent_posted_journal_lines_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
DECLARE
  v_journal_status TEXT;
  v_is_voided BOOLEAN;
BEGIN
  -- Get parent journal status
  SELECT status, is_voided
  INTO v_journal_status, v_is_voided
  FROM journal_entries
  WHERE id = COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  -- Allow changes if journal is draft
  IF v_journal_status = 'draft' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- Allow deletes if journal is being voided
  IF v_is_voided = TRUE THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- Prevent changes on posted journal lines
  IF v_journal_status = 'posted' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Cannot delete lines from posted journal. Void the journal instead.';
    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.debit_amount IS DISTINCT FROM NEW.debit_amount
         OR OLD.credit_amount IS DISTINCT FROM NEW.credit_amount
         OR OLD.account_id IS DISTINCT FROM NEW.account_id THEN
        RAISE EXCEPTION 'Cannot update lines in posted journal. Void the journal instead.';
      END IF;
    ELSIF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Cannot add lines to posted journal. Void and create new instead.';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;


-- =====================================================
-- Function: prevent_posted_journal_update
-- =====================================================
CREATE OR REPLACE FUNCTION public.prevent_posted_journal_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
BEGIN
  -- Allow if changing from draft to posted
  IF OLD.status = 'draft' AND NEW.status = 'posted' THEN
    RETURN NEW;
  END IF;
  -- Allow if voiding (is_voided changing to true)
  IF OLD.is_voided IS DISTINCT FROM NEW.is_voided THEN
    RETURN NEW;
  END IF;
  -- Allow if changing status to voided
  IF NEW.status = 'voided' AND OLD.status != 'voided' THEN
    RETURN NEW;
  END IF;
  -- Prevent other updates on posted journals
  IF OLD.status = 'posted' THEN
    -- Check if any significant field changed
    IF OLD.total_debit IS DISTINCT FROM NEW.total_debit
       OR OLD.total_credit IS DISTINCT FROM NEW.total_credit
       OR OLD.entry_date IS DISTINCT FROM NEW.entry_date
       OR OLD.description IS DISTINCT FROM NEW.description THEN
      RAISE EXCEPTION 'Cannot update posted journal entry. Use void and create new instead. Journal: %', OLD.entry_number;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;


-- =====================================================
-- Function: tf_update_balance_on_journal_change
-- =====================================================
CREATE OR REPLACE FUNCTION public.tf_update_balance_on_journal_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
DECLARE
    r_line RECORD;
    v_delta NUMERIC;
BEGIN
    IF OLD.is_voided = NEW.is_voided THEN
        RETURN NULL;
    END IF;

    -- If BECOMING VOIDED (False -> True): Remove impact
    IF NEW.is_voided = TRUE THEN
        FOR r_line IN SELECT * FROM journal_entry_lines WHERE journal_entry_id = NEW.id LOOP
            v_delta := calculate_balance_delta(r_line.account_id, r_line.debit_amount, r_line.credit_amount);
            UPDATE accounts SET balance = COALESCE(balance, 0) - v_delta WHERE id = r_line.account_id;
        END LOOP;
    END IF;

    -- If BECOMING ACTIVE (True -> False): Add impact
    IF NEW.is_voided = FALSE THEN
        FOR r_line IN SELECT * FROM journal_entry_lines WHERE journal_entry_id = NEW.id LOOP
            v_delta := calculate_balance_delta(r_line.account_id, r_line.debit_amount, r_line.credit_amount);
            UPDATE accounts SET balance = COALESCE(balance, 0) + v_delta WHERE id = r_line.account_id;
        END LOOP;
    END IF;

    RETURN NULL;
END;
$function$;


-- =====================================================
-- Function: tf_update_balance_on_line_change
-- =====================================================
CREATE OR REPLACE FUNCTION public.tf_update_balance_on_line_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
DECLARE
    v_is_voided BOOLEAN;
    v_delta NUMERIC;
BEGIN
    -- Check parent journal status first
    IF TG_OP = 'DELETE' THEN
        SELECT is_voided INTO v_is_voided FROM journal_entries WHERE id = OLD.journal_entry_id;
    ELSE
        SELECT is_voided INTO v_is_voided FROM journal_entries WHERE id = NEW.journal_entry_id;
    END IF;

    -- If journal is voided, lines don't affect active balance.
    IF v_is_voided THEN
        RETURN NULL;
    END IF;

    IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
        -- Reverse OLD impact
        v_delta := calculate_balance_delta(OLD.account_id, OLD.debit_amount, OLD.credit_amount);
        UPDATE accounts SET balance = COALESCE(balance, 0) - v_delta WHERE id = OLD.account_id;
    END IF;

    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        -- Apply NEW impact
        v_delta := calculate_balance_delta(NEW.account_id, NEW.debit_amount, NEW.credit_amount);
        UPDATE accounts SET balance = COALESCE(balance, 0) + v_delta WHERE id = NEW.account_id;
    END IF;

    RETURN NULL;
END;
$function$;


-- =====================================================
-- Function: trigger_migration_delivery_journal
-- =====================================================
CREATE OR REPLACE FUNCTION public.trigger_migration_delivery_journal() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
DECLARE
  v_transaction RECORD;
  v_is_migration BOOLEAN := FALSE;
  v_delivery_value NUMERIC := 0;
  v_item RECORD;
  v_result RECORD;
BEGIN
  -- Check if this delivery is for a migration transaction
  SELECT
    t.id,
    t.customer_name,
    t.notes,
    t.branch_id,
    t.items
  INTO v_transaction
  FROM transactions t
  WHERE t.id = NEW.transaction_id;
  -- Check if it's a migration transaction (notes contains [MIGRASI])
  IF v_transaction.notes IS NOT NULL AND v_transaction.notes LIKE '%[MIGRASI]%' THEN
    v_is_migration := TRUE;
  END IF;
  -- If migration, calculate delivery value and create journal
  IF v_is_migration THEN
    -- Calculate value of delivered items
    SELECT COALESCE(SUM(
      di.quantity_delivered * COALESCE(
        (SELECT (item->>'price')::NUMERIC
         FROM jsonb_array_elements(v_transaction.items) item
         WHERE item->>'product_id' = di.product_id::TEXT
         LIMIT 1
        ), 0)
    ), 0)
    INTO v_delivery_value
    FROM delivery_items di
    WHERE di.delivery_id = NEW.id;
    -- Create migration delivery journal
    IF v_delivery_value > 0 THEN
      SELECT * INTO v_result
      FROM process_migration_delivery_journal(
        NEW.id,
        v_delivery_value,
        v_transaction.branch_id,
        v_transaction.customer_name,
        v_transaction.id::TEXT
      );
      IF NOT v_result.success THEN
        RAISE WARNING 'Failed to create migration delivery journal: %', v_result.error_message;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;


-- =====================================================
-- Function: trigger_process_advance_repayment
-- =====================================================
CREATE OR REPLACE FUNCTION public.trigger_process_advance_repayment() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
BEGIN
  -- Only process when payroll status changes to 'paid' and there are deductions
  IF NEW.status = 'paid' AND OLD.status != 'paid' AND NEW.deduction_amount > 0 THEN
    -- Process advance repayments
    PERFORM public.process_advance_repayment_from_salary(NEW.id, NEW.deduction_amount);
  END IF;
  RETURN NEW;
END;
$function$;


-- =====================================================
-- Function: trigger_sync_payroll_commission
-- =====================================================
CREATE OR REPLACE FUNCTION public.trigger_sync_payroll_commission() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
BEGIN
  -- When payroll status changes to 'paid' and has commission amount
  IF NEW.status = 'paid' AND OLD.status != 'paid' AND NEW.commission_amount > 0 THEN
    -- Check if commission entry doesn't already exist
    IF NOT EXISTS (
      SELECT 1 FROM commission_entries ce
      WHERE ce.source_id = NEW.id AND ce.source_type = 'payroll'
    ) THEN
      -- Get employee info
      DECLARE
        emp_name TEXT;
        emp_role TEXT;
      BEGIN
        SELECT p.full_name, p.role INTO emp_name, emp_role
        FROM profiles p WHERE p.id = NEW.employee_id;
        -- Insert commission entry
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
          'comm-payroll-' || NEW.id,
          NEW.employee_id,
          emp_name,
          emp_role,
          NEW.commission_amount,
          1,
          'Komisi Gaji ' || TO_CHAR(DATE(NEW.period_year || '-' || NEW.period_month || '-01'), 'Month YYYY'),
          NULL,
          'payroll',
          NEW.id,
          NOW()
        );
      END;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;


-- =====================================================
-- Function: update_product_materials_updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_product_materials_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$function$;


-- =====================================================
-- Function: update_updated_at_column
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;


