-- =====================================================
-- 07 EXPENSE
-- Generated: 2026-01-09T00:29:07.860Z
-- Total functions: 4
-- =====================================================

-- Functions in this file:
--   create_expense_atomic
--   delete_expense_atomic
--   get_expense_account_for_category
--   update_expense_atomic

-- =====================================================
-- Function: create_expense_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_expense_atomic(p_expense jsonb, p_branch_id uuid) RETURNS TABLE(success boolean, expense_id text, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_expense_id TEXT;
  v_description TEXT;
  v_amount NUMERIC;
  v_category TEXT;
  v_date TIMESTAMPTZ;
  v_cash_account_id TEXT;  -- accounts.id is TEXT not UUID
  v_expense_account_id TEXT;  -- accounts.id is TEXT not UUID
  v_expense_account_name TEXT;
  v_journal_id UUID;
  v_journal_lines JSONB := '[]'::JSONB;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
      'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  IF p_expense IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
      'Expense data is required'::TEXT;
    RETURN;
  END IF;

  -- ==================== PARSE DATA ====================

  v_description := COALESCE(p_expense->>'description', 'Pengeluaran');
  v_amount := COALESCE((p_expense->>'amount')::NUMERIC, 0);
  v_category := COALESCE(p_expense->>'category', 'Beban Umum');
  v_date := COALESCE((p_expense->>'date')::TIMESTAMPTZ, NOW());
  v_cash_account_id := p_expense->>'account_id';  -- TEXT, no cast needed
  v_expense_account_id := p_expense->>'expense_account_id';  -- TEXT, no cast needed
  v_expense_account_name := p_expense->>'expense_account_name';

  IF v_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
      'Amount must be greater than 0'::TEXT;
    RETURN;
  END IF;

  -- ==================== FIND ACCOUNTS ====================

  -- Find expense account by ID or fallback to category-based search
  IF v_expense_account_id IS NULL THEN
    -- Search by category name
    SELECT id INTO v_expense_account_id
    FROM accounts
    WHERE branch_id = p_branch_id
      AND is_active = TRUE
      AND is_header = FALSE
      AND (
        code LIKE '6%'  -- Expense accounts
        OR type IN ('Beban', 'Expense')
      )
      AND (
        LOWER(name) LIKE '%' || LOWER(v_category) || '%'
        OR name ILIKE '%beban umum%'
      )
    ORDER BY
      CASE WHEN LOWER(name) LIKE '%' || LOWER(v_category) || '%' THEN 1 ELSE 2 END,
      code
    LIMIT 1;

    -- Fallback to default expense account (6200 - Beban Operasional or 6100)
    IF v_expense_account_id IS NULL THEN
      SELECT id INTO v_expense_account_id
      FROM accounts
      WHERE branch_id = p_branch_id
        AND is_active = TRUE
        AND is_header = FALSE
        AND code IN ('6200', '6100', '6000')
      ORDER BY code
      LIMIT 1;
    END IF;
  END IF;

  -- Find cash/payment account
  IF v_cash_account_id IS NULL THEN
    SELECT id INTO v_cash_account_id
    FROM accounts
    WHERE branch_id = p_branch_id
      AND is_active = TRUE
      AND is_payment_account = TRUE
      AND code LIKE '11%'
    ORDER BY code
    LIMIT 1;
  END IF;

  -- Validate accounts found
  IF v_expense_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
      'Akun beban tidak ditemukan. Pastikan ada akun dengan kode 6xxx.'::TEXT;
    RETURN;
  END IF;

  IF v_cash_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
      'Akun kas tidak ditemukan. Pastikan ada akun payment dengan kode 11xx.'::TEXT;
    RETURN;
  END IF;

  -- ==================== GENERATE EXPENSE ID ====================

  v_expense_id := 'exp-' || EXTRACT(EPOCH FROM NOW())::BIGINT::TEXT ||
                  '-' || LPAD(FLOOR(RANDOM() * 1000)::TEXT, 3, '0');

  -- ==================== CREATE EXPENSE RECORD ====================

  INSERT INTO expenses (
    id,
    description,
    amount,
    category,
    date,
    account_id,
    expense_account_id,
    expense_account_name,
    branch_id,
    created_at
  ) VALUES (
    v_expense_id,
    v_description,
    v_amount,
    v_category,
    v_date,
    v_cash_account_id,
    v_expense_account_id,
    v_expense_account_name,
    p_branch_id,
    NOW()
  );

  -- ==================== CREATE JOURNAL ====================

  -- Debit: Beban (expense account)
  v_journal_lines := v_journal_lines || jsonb_build_object(
    'account_id', v_expense_account_id,
    'debit_amount', v_amount,
    'credit_amount', 0,
    'description', v_category || ': ' || v_description
  );

  -- Credit: Kas (payment account)
  v_journal_lines := v_journal_lines || jsonb_build_object(
    'account_id', v_cash_account_id,
    'debit_amount', 0,
    'credit_amount', v_amount,
    'description', 'Pengeluaran kas'
  );

  SELECT cja.journal_id INTO v_journal_id FROM create_journal_atomic(
    p_branch_id,
    v_date::DATE,  -- Journal only needs DATE
    format('Pengeluaran - %s', v_description),
    'expense',
    v_expense_id,
    v_journal_lines,
    TRUE
  ) AS cja;

  -- ==================== SUCCESS ====================

  RETURN QUERY SELECT TRUE, v_expense_id, v_journal_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, SQLERRM::TEXT;
END;
$function$;


CREATE OR REPLACE FUNCTION public.create_expense_atomic(p_expense jsonb, p_branch_id uuid, p_photo_url text DEFAULT NULL::text) RETURNS TABLE(success boolean, expense_id text, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_expense_id TEXT;
  v_description TEXT;
  v_amount NUMERIC;
  v_category TEXT;
  v_date TIMESTAMPTZ;
  v_cash_account_id TEXT;
  v_expense_account_id TEXT;
  v_expense_account_name TEXT;
  v_journal_id UUID;
  v_journal_lines JSONB := '[]'::JSONB;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
      'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  IF p_expense IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
      'Expense data is required'::TEXT;
    RETURN;
  END IF;

  -- ==================== PARSE DATA ====================

  v_description := COALESCE(p_expense->>'description', 'Pengeluaran');
  v_amount := COALESCE((p_expense->>'amount')::NUMERIC, 0);
  v_category := COALESCE(p_expense->>'category', 'Beban Umum');
  v_date := COALESCE((p_expense->>'date')::TIMESTAMPTZ, NOW());
  v_cash_account_id := p_expense->>'account_id';
  v_expense_account_id := p_expense->>'expense_account_id';
  v_expense_account_name := p_expense->>'expense_account_name';

  IF v_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
      'Amount must be greater than 0'::TEXT;
    RETURN;
  END IF;

  -- ==================== FIND ACCOUNTS ====================

  IF v_expense_account_id IS NULL THEN
    SELECT id INTO v_expense_account_id
    FROM accounts
    WHERE branch_id = p_branch_id
      AND is_active = TRUE
      AND is_header = FALSE
      AND (
        code LIKE '6%'
        OR type IN ('Beban', 'Expense')
      )
      AND (
        LOWER(name) LIKE '%' || LOWER(v_category) || '%'
        OR name ILIKE '%beban umum%'
      )
    ORDER BY
      CASE WHEN LOWER(name) LIKE '%' || LOWER(v_category) || '%' THEN 1 ELSE 2 END,
      code
    LIMIT 1;

    IF v_expense_account_id IS NULL THEN
      SELECT id INTO v_expense_account_id
      FROM accounts
      WHERE branch_id = p_branch_id
        AND is_active = TRUE
        AND is_header = FALSE
        AND code IN ('6200', '6100', '6000')
      ORDER BY code
      LIMIT 1;
    END IF;
  END IF;

  IF v_cash_account_id IS NULL THEN
    SELECT id INTO v_cash_account_id
    FROM accounts
    WHERE branch_id = p_branch_id
      AND is_active = TRUE
      AND is_payment_account = TRUE
      AND code LIKE '11%'
    ORDER BY code
    LIMIT 1;
  END IF;

  IF v_expense_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
      'Akun beban tidak ditemukan. Pastikan ada akun dengan kode 6xxx.'::TEXT;
    RETURN;
  END IF;

  IF v_cash_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
      'Akun kas tidak ditemukan. Pastikan ada akun payment dengan kode 11xx.'::TEXT;
    RETURN;
  END IF;

  -- ==================== GENERATE EXPENSE ID ====================

  v_expense_id := 'exp-' || EXTRACT(EPOCH FROM NOW())::BIGINT::TEXT ||
                  '-' || LPAD(FLOOR(RANDOM() * 1000)::TEXT, 3, '0');

  -- ==================== CREATE EXPENSE RECORD ====================

  INSERT INTO expenses (
    id,
    description,
    amount,
    category,
    date,
    account_id,
    expense_account_id,
    expense_account_name,
    branch_id,
    created_at,
    photo_url  -- ADDED
  ) VALUES (
    v_expense_id,
    v_description,
    v_amount,
    v_category,
    v_date,
    v_cash_account_id,
    v_expense_account_id,
    v_expense_account_name,
    p_branch_id,
    NOW(),
    p_photo_url -- ADDED
  );

  -- ==================== CREATE JOURNAL ====================

  v_journal_lines := v_journal_lines || jsonb_build_object(
    'account_id', v_expense_account_id,
    'debit_amount', v_amount,
    'credit_amount', 0,
    'description', v_category || ': ' || v_description
  );

  v_journal_lines := v_journal_lines || jsonb_build_object(
    'account_id', v_cash_account_id,
    'debit_amount', 0,
    'credit_amount', v_amount,
    'description', 'Pengeluaran kas'
  );

  SELECT cja.journal_id INTO v_journal_id FROM create_journal_atomic(
    p_branch_id,
    v_date::DATE,
    format('Pengeluaran - %s', v_description),
    'expense',
    v_expense_id,
    v_journal_lines,
    TRUE
  ) AS cja;

  RETURN QUERY SELECT TRUE, v_expense_id, v_journal_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, SQLERRM::TEXT;
END;
$function$;


-- =====================================================
-- Function: delete_expense_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.delete_expense_atomic(p_expense_id text, p_branch_id uuid) RETURNS TABLE(success boolean, journals_voided integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_journals_voided INTEGER := 0;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  -- Check expense exists
  IF NOT EXISTS (
    SELECT 1 FROM expenses WHERE id = p_expense_id AND branch_id = p_branch_id
  ) THEN
    RETURN QUERY SELECT FALSE, 0, 'Expense not found'::TEXT;
    RETURN;
  END IF;

  -- ==================== VOID JOURNALS ====================

  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_reason = 'Expense deleted',
    status = 'voided',
    updated_at = NOW()
  WHERE reference_id = p_expense_id
    AND reference_type = 'expense'
    AND branch_id = p_branch_id
    AND is_voided = FALSE;

  GET DIAGNOSTICS v_journals_voided = ROW_COUNT;

  -- ==================== DELETE EXPENSE ====================

  DELETE FROM expenses WHERE id = p_expense_id AND branch_id = p_branch_id;

  RETURN QUERY SELECT TRUE, v_journals_voided, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0, SQLERRM::TEXT;
END;
$function$;


-- =====================================================
-- Function: get_expense_account_for_category
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_expense_account_for_category(category_name text) RETURNS TABLE(account_id text, account_code text, account_name text)
    LANGUAGE plpgsql STABLE
    AS $function$
BEGIN
  -- Map category to account
  RETURN QUERY
  SELECT a.id::TEXT, a.code::TEXT, a.name::TEXT
  FROM accounts a
  WHERE a.type = 'Expense'
    AND (
      (category_name ILIKE '%gaji%' AND a.code = '6100') OR
      (category_name ILIKE '%listrik%' AND a.code = '6200') OR
      (category_name ILIKE '%sewa%' AND a.code = '6300') OR
      (category_name ILIKE '%transport%' AND a.code = '6400') OR
      (category_name ILIKE '%perlengkapan%' AND a.code = '6500') OR
      (category_name ILIKE '%pemeliharaan%' AND a.code = '6600') OR
      (category_name ILIKE '%bahan%' AND a.code = '5100') OR
      (a.code = '6900') -- Default: Beban Lain-lain
    )
  ORDER BY 
    CASE 
      WHEN category_name ILIKE '%gaji%' AND a.code = '6100' THEN 1
      WHEN category_name ILIKE '%listrik%' AND a.code = '6200' THEN 1
      WHEN category_name ILIKE '%sewa%' AND a.code = '6300' THEN 1
      WHEN category_name ILIKE '%transport%' AND a.code = '6400' THEN 1
      WHEN category_name ILIKE '%perlengkapan%' AND a.code = '6500' THEN 1
      WHEN category_name ILIKE '%pemeliharaan%' AND a.code = '6600' THEN 1
      WHEN category_name ILIKE '%bahan%' AND a.code = '5100' THEN 1
      ELSE 2
    END
  LIMIT 1;
  
  -- If no match, return default
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT a.id::TEXT, a.code::TEXT, a.name::TEXT
    FROM accounts a
    WHERE a.code = '6900'
    LIMIT 1;
  END IF;
END;
$function$;


-- =====================================================
-- Function: update_expense_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_expense_atomic(p_expense_id text, p_expense jsonb, p_branch_id uuid) RETURNS TABLE(success boolean, journal_updated boolean, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_old_expense RECORD;
  v_new_amount NUMERIC;
  v_new_cash_account_id TEXT;  -- accounts.id is TEXT not UUID
  v_journal_id UUID;
  v_expense_account_id TEXT;  -- accounts.id is TEXT not UUID
  v_amount_changed BOOLEAN;
  v_account_changed BOOLEAN;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, FALSE,
      'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  -- Get existing expense
  SELECT * INTO v_old_expense
  FROM expenses
  WHERE id = p_expense_id AND branch_id = p_branch_id;

  IF v_old_expense.id IS NULL THEN
    RETURN QUERY SELECT FALSE, FALSE,
      'Expense not found in this branch'::TEXT;
    RETURN;
  END IF;

  -- ==================== PARSE DATA ====================

  v_new_amount := COALESCE((p_expense->>'amount')::NUMERIC, v_old_expense.amount);
  v_new_cash_account_id := COALESCE(p_expense->>'account_id', v_old_expense.account_id);  -- TEXT, no cast

  v_amount_changed := v_new_amount != v_old_expense.amount;
  v_account_changed := v_new_cash_account_id IS DISTINCT FROM v_old_expense.account_id;

  -- ==================== UPDATE EXPENSE ====================

  UPDATE expenses SET
    description = COALESCE(p_expense->>'description', description),
    amount = v_new_amount,
    category = COALESCE(p_expense->>'category', category),
    date = COALESCE((p_expense->>'date')::TIMESTAMPTZ, date),
    account_id = v_new_cash_account_id,
    updated_at = NOW()
  WHERE id = p_expense_id;

  -- ==================== UPDATE JOURNAL IF NEEDED ====================

  IF v_amount_changed OR v_account_changed THEN
    -- Find existing journal
    SELECT id INTO v_journal_id
    FROM journal_entries
    WHERE reference_id = p_expense_id
      AND reference_type = 'expense'
      AND branch_id = p_branch_id
      AND is_voided = FALSE
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_journal_id IS NOT NULL THEN
      -- Get expense account from current expense
      v_expense_account_id := v_old_expense.expense_account_id;

      IF v_expense_account_id IS NULL THEN
        -- Fallback: find default expense account
        SELECT id INTO v_expense_account_id
        FROM accounts
        WHERE branch_id = p_branch_id
          AND is_active = TRUE
          AND code LIKE '6%'
        ORDER BY code
        LIMIT 1;
      END IF;

      IF v_expense_account_id IS NOT NULL AND v_new_cash_account_id IS NOT NULL THEN
        -- Delete old lines
        DELETE FROM journal_entry_lines WHERE journal_entry_id = v_journal_id;

        -- Insert new lines
        INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, debit_amount, credit_amount, description)
        VALUES
          (v_journal_id, 1, v_expense_account_id, v_new_amount, 0, 'Beban pengeluaran (edit)'),
          (v_journal_id, 2, v_new_cash_account_id, 0, v_new_amount, 'Pengeluaran kas (edit)');

        -- Update journal totals
        UPDATE journal_entries SET
          total_debit = v_new_amount,
          total_credit = v_new_amount,
          updated_at = NOW()
        WHERE id = v_journal_id;

        RETURN QUERY SELECT TRUE, TRUE, NULL::TEXT;
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT TRUE, FALSE, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, FALSE, SQLERRM::TEXT;
END;
$function$;


