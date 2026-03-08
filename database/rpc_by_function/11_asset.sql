-- =====================================================
-- 11 ASSET
-- Generated: 2026-01-09T00:29:07.862Z
-- Total functions: 7
-- =====================================================

-- Functions in this file:
--   calculate_asset_current_value
--   create_asset_atomic
--   create_maintenance_reminders
--   delete_asset_atomic
--   record_depreciation_atomic
--   update_asset_atomic
--   update_overdue_maintenance

-- =====================================================
-- Function: calculate_asset_current_value
-- =====================================================
CREATE OR REPLACE FUNCTION public.calculate_asset_current_value(p_asset_id text) RETURNS numeric
    LANGUAGE plpgsql
    AS $function$
DECLARE
    v_purchase_price NUMERIC;
    v_purchase_date DATE;
    v_useful_life_years INTEGER;
    v_salvage_value NUMERIC;
    v_depreciation_method TEXT;
    v_years_elapsed NUMERIC;
    v_current_value NUMERIC;
BEGIN
    -- Get asset details
    SELECT
        purchase_price,
        purchase_date,
        useful_life_years,
        salvage_value,
        depreciation_method
    INTO
        v_purchase_price,
        v_purchase_date,
        v_useful_life_years,
        v_salvage_value,
        v_depreciation_method
    FROM assets
    WHERE id = p_asset_id;
    -- Calculate years elapsed
    v_years_elapsed := EXTRACT(YEAR FROM AGE(CURRENT_DATE, v_purchase_date)) +
                      (EXTRACT(MONTH FROM AGE(CURRENT_DATE, v_purchase_date)) / 12.0);
    -- Calculate depreciation based on method
    IF v_depreciation_method = 'straight_line' THEN
        -- Straight-line depreciation
        v_current_value := v_purchase_price -
                          ((v_purchase_price - v_salvage_value) / v_useful_life_years * v_years_elapsed);
    ELSE
        -- Declining balance (double declining)
        v_current_value := v_purchase_price * POWER(1 - (2.0 / v_useful_life_years), v_years_elapsed);
    END IF;
    -- Ensure value doesn't go below salvage value
    IF v_current_value < v_salvage_value THEN
        v_current_value := v_salvage_value;
    END IF;
    RETURN GREATEST(v_current_value, 0);
END;
$function$;


-- =====================================================
-- Function: create_asset_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_asset_atomic(p_asset jsonb, p_branch_id uuid) RETURNS TABLE(success boolean, asset_id uuid, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_asset_id UUID;
  v_name TEXT;
  v_code TEXT;
  v_category TEXT;
  v_purchase_date DATE;
  v_purchase_price NUMERIC;
  v_useful_life_years INTEGER;
  v_salvage_value NUMERIC;
  v_depreciation_method TEXT;
  v_source TEXT;  -- 'cash', 'credit', 'migration'
  v_asset_account_id UUID;
  v_cash_account_id UUID;
  v_hutang_account_id UUID;
  v_journal_id UUID;
  v_journal_lines JSONB := '[]'::JSONB;
  v_category_mapping JSONB;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID,
      'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  IF p_asset IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID,
      'Asset data is required'::TEXT;
    RETURN;
  END IF;
  -- ==================== PARSE DATA ====================
  v_name := COALESCE(p_asset->>'name', p_asset->>'asset_name', 'Aset Tetap');
  v_code := COALESCE(p_asset->>'code', p_asset->>'asset_code');
  v_category := COALESCE(p_asset->>'category', 'other');
  v_purchase_date := COALESCE((p_asset->>'purchase_date')::DATE, CURRENT_DATE);
  v_purchase_price := COALESCE((p_asset->>'purchase_price')::NUMERIC, 0);
  v_useful_life_years := COALESCE((p_asset->>'useful_life_years')::INTEGER, 5);
  v_salvage_value := COALESCE((p_asset->>'salvage_value')::NUMERIC, 0);
  v_depreciation_method := COALESCE(p_asset->>'depreciation_method', 'straight_line');
  v_source := COALESCE(p_asset->>'source', 'cash');
  IF v_name IS NULL OR v_name = '' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID,
      'Asset name is required'::TEXT;
    RETURN;
  END IF;
  -- ==================== MAP CATEGORY TO ACCOUNT ====================
  -- Category to account code mapping
  v_category_mapping := '{
    "vehicle": {"codes": ["1410"], "names": ["kendaraan"]},
    "equipment": {"codes": ["1420"], "names": ["peralatan", "mesin"]},
    "building": {"codes": ["1440"], "names": ["bangunan", "gedung"]},
    "furniture": {"codes": ["1450"], "names": ["furniture", "inventaris"]},
    "computer": {"codes": ["1460"], "names": ["komputer", "laptop"]},
    "other": {"codes": ["1490"], "names": ["aset lain"]}
  }'::JSONB;
  -- Find asset account by category
  DECLARE
    v_mapping JSONB := v_category_mapping->v_category;
    v_search_code TEXT;
    v_search_name TEXT;
  BEGIN
    IF v_mapping IS NOT NULL THEN
      -- Try by code first
      FOR v_search_code IN SELECT jsonb_array_elements_text(v_mapping->'codes')
      LOOP
        SELECT id INTO v_asset_account_id
        FROM accounts
        WHERE branch_id = p_branch_id
          AND code = v_search_code
          AND is_active = TRUE
        LIMIT 1;
        EXIT WHEN v_asset_account_id IS NOT NULL;
      END LOOP;
      -- Try by name if not found
      IF v_asset_account_id IS NULL THEN
        FOR v_search_name IN SELECT jsonb_array_elements_text(v_mapping->'names')
        LOOP
          SELECT id INTO v_asset_account_id
          FROM accounts
          WHERE branch_id = p_branch_id
            AND LOWER(name) LIKE '%' || v_search_name || '%'
            AND is_active = TRUE
            AND is_header = FALSE
          LIMIT 1;
          EXIT WHEN v_asset_account_id IS NOT NULL;
        END LOOP;
      END IF;
    END IF;
    -- Fallback to any fixed asset account
    IF v_asset_account_id IS NULL THEN
      SELECT id INTO v_asset_account_id
      FROM accounts
      WHERE branch_id = p_branch_id
        AND code LIKE '14%'
        AND is_active = TRUE
        AND is_header = FALSE
      ORDER BY code
      LIMIT 1;
    END IF;
  END;
  -- Find cash account
  SELECT id INTO v_cash_account_id
  FROM accounts
  WHERE branch_id = p_branch_id
    AND is_active = TRUE
    AND is_payment_account = TRUE
    AND code LIKE '11%'
  ORDER BY code
  LIMIT 1;
  -- Find hutang account (for credit purchases)
  SELECT id INTO v_hutang_account_id
  FROM accounts
  WHERE branch_id = p_branch_id
    AND code IN ('2100', '2110')
    AND is_active = TRUE
  LIMIT 1;
  -- Validate asset account found
  IF v_asset_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID,
      'Akun aset tetap tidak ditemukan. Pastikan ada akun dengan kode 14xx.'::TEXT;
    RETURN;
  END IF;
  -- ==================== GENERATE ASSET ID ====================
  v_asset_id := gen_random_uuid();
  -- Generate code if not provided
  IF v_code IS NULL OR v_code = '' THEN
    v_code := 'AST-' || TO_CHAR(v_purchase_date, 'YYYYMM') || '-' ||
              LPAD((SELECT COUNT(*) + 1 FROM assets WHERE branch_id = p_branch_id)::TEXT, 4, '0');
  END IF;
  -- ==================== CREATE ASSET RECORD ====================
  INSERT INTO assets (
    id,
    name,
    code,
    asset_code,
    category,
    purchase_date,
    purchase_price,
    current_value,
    useful_life_years,
    salvage_value,
    depreciation_method,
    location,
    brand,
    model,
    serial_number,
    supplier_name,
    notes,
    status,
    condition,
    account_id,
    branch_id,
    created_at
  ) VALUES (
    v_asset_id,
    v_name,
    v_code,
    v_code,
    v_category,
    v_purchase_date,
    v_purchase_price,
    v_purchase_price,  -- current_value starts at purchase_price
    v_useful_life_years,
    v_salvage_value,
    v_depreciation_method,
    p_asset->>'location',
    COALESCE(p_asset->>'brand', v_name),
    p_asset->>'model',
    p_asset->>'serial_number',
    p_asset->>'supplier_name',
    p_asset->>'notes',
    COALESCE(p_asset->>'status', 'active'),
    COALESCE(p_asset->>'condition', 'good'),
    v_asset_account_id,
    p_branch_id,
    NOW()
  );
  -- ==================== CREATE JOURNAL (if not migration) ====================
  IF v_purchase_price > 0 AND v_source != 'migration' THEN
    -- Debit: Aset Tetap
    v_journal_lines := v_journal_lines || jsonb_build_object(
      'account_id', v_asset_account_id,
      'debit_amount', v_purchase_price,
      'credit_amount', 0,
      'description', format('Pembelian %s', v_name)
    );
    -- Credit: Kas atau Hutang
    IF v_source = 'credit' AND v_hutang_account_id IS NOT NULL THEN
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_id', v_hutang_account_id,
        'debit_amount', 0,
        'credit_amount', v_purchase_price,
        'description', 'Hutang pembelian aset'
      );
    ELSIF v_cash_account_id IS NOT NULL THEN
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_id', v_cash_account_id,
        'debit_amount', 0,
        'credit_amount', v_purchase_price,
        'description', 'Pembayaran tunai aset'
      );
    ELSE
      RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID,
        'Akun pembayaran tidak ditemukan'::TEXT;
      RETURN;
    END IF;
    SELECT cja.journal_id INTO v_journal_id FROM create_journal_atomic(
      p_branch_id,
      v_purchase_date,
      format('Pembelian Aset - %s', v_name),
      'asset',
      v_asset_id::TEXT,
      v_journal_lines,
      TRUE
    );
  END IF;
  -- ==================== SUCCESS ====================
  RETURN QUERY SELECT TRUE, v_asset_id, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, SQLERRM::TEXT;
END;
$function$;


-- =====================================================
-- Function: create_maintenance_reminders
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_maintenance_reminders() RETURNS void
    LANGUAGE plpgsql
    AS $function$
BEGIN
    -- Create notifications for upcoming maintenance
    INSERT INTO notifications (id, title, message, type, reference_type, reference_id, reference_url, priority, user_id)
    SELECT
        'NOTIF-REMINDER-' || am.id || '-' || EXTRACT(EPOCH FROM NOW())::TEXT,
        'Upcoming Maintenance: ' || a.asset_name,
        'Maintenance "' || am.title || '" for asset "' || a.asset_name || '" is scheduled for ' || am.scheduled_date::TEXT,
        'maintenance_due',
        'maintenance',
        am.id,
        '/maintenance',
        CASE
            WHEN am.priority = 'critical' THEN 'urgent'
            WHEN am.priority = 'high' THEN 'high'
            ELSE 'normal'
        END,
        am.created_by
    FROM asset_maintenance am
    JOIN assets a ON am.asset_id = a.id
    WHERE am.status = 'scheduled'
      AND am.scheduled_date <= CURRENT_DATE + (am.notify_before_days || ' days')::INTERVAL
      AND am.scheduled_date >= CURRENT_DATE
      AND am.notification_sent = FALSE;
    -- Mark notifications as sent
    UPDATE asset_maintenance
    SET notification_sent = TRUE
    WHERE status = 'scheduled'
      AND scheduled_date <= CURRENT_DATE + (notify_before_days || ' days')::INTERVAL
      AND scheduled_date >= CURRENT_DATE
      AND notification_sent = FALSE;
END;
$function$;


-- =====================================================
-- Function: delete_asset_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.delete_asset_atomic(p_asset_id uuid, p_branch_id uuid) RETURNS TABLE(success boolean, journals_voided integer, error_message text)
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
  -- Check asset exists
  IF NOT EXISTS (
    SELECT 1 FROM assets WHERE id = p_asset_id AND branch_id = p_branch_id
  ) THEN
    RETURN QUERY SELECT FALSE, 0, 'Asset not found'::TEXT;
    RETURN;
  END IF;
  -- ==================== VOID JOURNALS ====================
  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_reason = 'Asset deleted',
    updated_at = NOW()
  WHERE reference_id = p_asset_id::TEXT
    AND branch_id = p_branch_id
    AND is_voided = FALSE;
  GET DIAGNOSTICS v_journals_voided = ROW_COUNT;
  -- ==================== DELETE ASSET ====================
  DELETE FROM assets WHERE id = p_asset_id AND branch_id = p_branch_id;
  RETURN QUERY SELECT TRUE, v_journals_voided, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0, SQLERRM::TEXT;
END;
$function$;


-- =====================================================
-- Function: record_depreciation_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.record_depreciation_atomic(p_asset_id uuid, p_amount numeric, p_period text, p_branch_id uuid) RETURNS TABLE(success boolean, journal_id uuid, new_current_value numeric, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_asset RECORD;
  v_journal_id UUID;
  v_journal_lines JSONB := '[]'::JSONB;
  v_beban_penyusutan_account UUID;
  v_akumulasi_account UUID;
  v_new_current_value NUMERIC;
  v_depreciation_date DATE;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC,
      'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC,
      'Depreciation amount must be greater than 0'::TEXT;
    RETURN;
  END IF;
  -- Get asset
  SELECT * INTO v_asset
  FROM assets
  WHERE id = p_asset_id AND branch_id = p_branch_id;
  IF v_asset.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC,
      'Asset not found'::TEXT;
    RETURN;
  END IF;
  -- ==================== FIND ACCOUNTS ====================
  -- Beban Penyusutan (6240)
  SELECT id INTO v_beban_penyusutan_account
  FROM accounts
  WHERE branch_id = p_branch_id
    AND code IN ('6240', '6250')
    AND is_active = TRUE
  LIMIT 1;
  -- Akumulasi Penyusutan - try to find by category
  SELECT id INTO v_akumulasi_account
  FROM accounts
  WHERE branch_id = p_branch_id
    AND (
      code IN ('1421', '1431', '1451', '1461', '1491')  -- Akumulasi accounts
      OR LOWER(name) LIKE '%akumulasi%'
    )
    AND is_active = TRUE
  ORDER BY code
  LIMIT 1;
  IF v_beban_penyusutan_account IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC,
      'Akun Beban Penyusutan tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  IF v_akumulasi_account IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC,
      'Akun Akumulasi Penyusutan tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- ==================== CALCULATE NEW VALUE ====================
  v_new_current_value := GREATEST(
    v_asset.salvage_value,
    COALESCE(v_asset.current_value, v_asset.purchase_price) - p_amount
  );
  -- Parse period to date
  BEGIN
    v_depreciation_date := (p_period || '-01')::DATE;
  EXCEPTION WHEN OTHERS THEN
    v_depreciation_date := CURRENT_DATE;
  END;
  -- ==================== CREATE JOURNAL ====================
  -- Debit: Beban Penyusutan
  v_journal_lines := v_journal_lines || jsonb_build_object(
    'account_id', v_beban_penyusutan_account,
    'debit_amount', p_amount,
    'credit_amount', 0,
    'description', format('Penyusutan %s periode %s', v_asset.name, p_period)
  );
  -- Credit: Akumulasi Penyusutan
  v_journal_lines := v_journal_lines || jsonb_build_object(
    'account_id', v_akumulasi_account,
    'debit_amount', 0,
    'credit_amount', p_amount,
    'description', format('Akumulasi penyusutan %s', v_asset.name)
  );
  SELECT cja.journal_id INTO v_journal_id FROM create_journal_atomic(
    p_branch_id,
    v_depreciation_date,
    format('Penyusutan - %s - %s', v_asset.name, p_period),
    'depreciation',
    p_asset_id::TEXT,
    v_journal_lines,
    TRUE
  );
  -- ==================== UPDATE ASSET CURRENT VALUE ====================
  UPDATE assets
  SET current_value = v_new_current_value, updated_at = NOW()
  WHERE id = p_asset_id;
  -- ==================== SUCCESS ====================
  RETURN QUERY SELECT TRUE, v_journal_id, v_new_current_value, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, SQLERRM::TEXT;
END;
$function$;


-- =====================================================
-- Function: update_asset_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_asset_atomic(p_asset_id uuid, p_asset jsonb, p_branch_id uuid) RETURNS TABLE(success boolean, journal_updated boolean, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_old_asset RECORD;
  v_new_price NUMERIC;
  v_price_changed BOOLEAN;
  v_journal_id UUID;
  v_asset_account_id UUID;
  v_cash_account_id UUID;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, FALSE,
      'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  -- Get existing asset
  SELECT * INTO v_old_asset
  FROM assets
  WHERE id = p_asset_id AND branch_id = p_branch_id;
  IF v_old_asset.id IS NULL THEN
    RETURN QUERY SELECT FALSE, FALSE,
      'Asset not found in this branch'::TEXT;
    RETURN;
  END IF;
  -- ==================== CHECK PRICE CHANGE ====================
  v_new_price := (p_asset->>'purchase_price')::NUMERIC;
  v_price_changed := v_new_price IS NOT NULL AND v_new_price != v_old_asset.purchase_price;
  -- ==================== UPDATE ASSET ====================
  UPDATE assets SET
    name = COALESCE(p_asset->>'name', p_asset->>'asset_name', name),
    code = COALESCE(p_asset->>'code', p_asset->>'asset_code', code),
    asset_code = COALESCE(p_asset->>'code', p_asset->>'asset_code', asset_code),
    category = COALESCE(p_asset->>'category', category),
    purchase_date = COALESCE((p_asset->>'purchase_date')::DATE, purchase_date),
    purchase_price = COALESCE(v_new_price, purchase_price),
    useful_life_years = COALESCE((p_asset->>'useful_life_years')::INTEGER, useful_life_years),
    salvage_value = COALESCE((p_asset->>'salvage_value')::NUMERIC, salvage_value),
    depreciation_method = COALESCE(p_asset->>'depreciation_method', depreciation_method),
    location = COALESCE(p_asset->>'location', location),
    brand = COALESCE(p_asset->>'brand', brand),
    model = COALESCE(p_asset->>'model', model),
    serial_number = COALESCE(p_asset->>'serial_number', serial_number),
    supplier_name = COALESCE(p_asset->>'supplier_name', supplier_name),
    notes = COALESCE(p_asset->>'notes', notes),
    status = COALESCE(p_asset->>'status', status),
    condition = COALESCE(p_asset->>'condition', condition),
    updated_at = NOW()
  WHERE id = p_asset_id;
  -- ==================== UPDATE JOURNAL IF PRICE CHANGED ====================
  IF v_price_changed THEN
    -- Find existing journal
    SELECT id INTO v_journal_id
    FROM journal_entries
    WHERE reference_id = p_asset_id::TEXT
      AND reference_type = 'asset'
      AND branch_id = p_branch_id
      AND is_voided = FALSE
    ORDER BY created_at DESC
    LIMIT 1;
    IF v_journal_id IS NOT NULL THEN
      v_asset_account_id := COALESCE((p_asset->>'account_id')::UUID, v_old_asset.account_id);
      -- Get cash account
      SELECT id INTO v_cash_account_id
      FROM accounts
      WHERE branch_id = p_branch_id
        AND is_payment_account = TRUE
        AND code LIKE '11%'
      ORDER BY code
      LIMIT 1;
      IF v_asset_account_id IS NOT NULL AND v_cash_account_id IS NOT NULL THEN
        -- Delete old lines
        DELETE FROM journal_entry_lines WHERE journal_entry_id = v_journal_id;
        -- Insert new lines
        INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, debit_amount, credit_amount, description)
        VALUES
          (v_journal_id, 1, v_asset_account_id, v_new_price, 0, format('Pembelian %s (edit)', v_old_asset.name)),
          (v_journal_id, 2, v_cash_account_id, 0, v_new_price, 'Pembayaran aset (edit)');
        -- Update journal totals
        UPDATE journal_entries SET
          total_debit = v_new_price,
          total_credit = v_new_price,
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


-- =====================================================
-- Function: update_overdue_maintenance
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_overdue_maintenance() RETURNS void
    LANGUAGE plpgsql
    AS $function$
BEGIN
    -- Update status to overdue for scheduled maintenance past due date
    UPDATE asset_maintenance
    SET status = 'overdue'
    WHERE status = 'scheduled'
      AND scheduled_date < CURRENT_DATE;
    -- Create notifications for overdue maintenance (if not already sent)
    INSERT INTO notifications (id, title, message, type, reference_type, reference_id, reference_url, priority, user_id)
    SELECT
        'NOTIF-OVERDUE-' || am.id || '-' || EXTRACT(EPOCH FROM NOW())::TEXT,
        'Maintenance Overdue: ' || a.asset_name,
        'Maintenance "' || am.title || '" for asset "' || a.asset_name || '" is overdue since ' || am.scheduled_date::TEXT,
        'maintenance_overdue',
        'maintenance',
        am.id,
        '/maintenance',
        'high',
        am.created_by
    FROM asset_maintenance am
    JOIN assets a ON am.asset_id = a.id
    WHERE am.status = 'overdue'
      AND am.notification_sent = FALSE;
    -- Mark notifications as sent
    UPDATE asset_maintenance
    SET notification_sent = TRUE
    WHERE status = 'overdue'
      AND notification_sent = FALSE;
END;
$function$;


