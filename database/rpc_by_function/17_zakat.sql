-- =====================================================
-- 17 ZAKAT
-- Generated: 2026-01-09T00:29:07.865Z
-- Total functions: 7
-- =====================================================

-- Functions in this file:
--   calculate_zakat_amount
--   create_zakat_cash_entry
--   create_zakat_payment_atomic
--   delete_zakat_record_atomic
--   get_current_nishab
--   upsert_zakat_record_atomic
--   void_zakat_payment_atomic

-- =====================================================
-- Function: calculate_zakat_amount
-- =====================================================
CREATE OR REPLACE FUNCTION public.calculate_zakat_amount(p_asset_value numeric, p_nishab_type text DEFAULT 'gold'::text) RETURNS TABLE(asset_value numeric, nishab_value numeric, is_obligatory boolean, zakat_amount numeric, rate numeric)
    LANGUAGE plpgsql
    AS $function$
DECLARE
  v_nishab_value NUMERIC;
  v_rate NUMERIC;
BEGIN
  -- Get current nishab values
  SELECT 
    CASE WHEN p_nishab_type = 'gold' THEN nr.gold_price * nr.gold_nishab
         ELSE nr.silver_price * nr.silver_nishab END,
    nr.zakat_rate
  INTO v_nishab_value, v_rate
  FROM nishab_reference nr
  WHERE nr.effective_date <= CURRENT_DATE
  ORDER BY nr.effective_date DESC
  LIMIT 1;
  
  -- Use defaults if not found
  IF v_nishab_value IS NULL THEN
    v_nishab_value := CASE WHEN p_nishab_type = 'gold' THEN 93500000 ELSE 8925000 END;
    v_rate := 0.025;
  END IF;
  
  RETURN QUERY SELECT
    p_asset_value,
    v_nishab_value,
    (p_asset_value >= v_nishab_value),
    CASE WHEN p_asset_value >= v_nishab_value THEN p_asset_value * v_rate ELSE 0 END,
    v_rate * 100; -- Convert to percentage
END;
$function$;


-- =====================================================
-- Function: create_zakat_cash_entry
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_zakat_cash_entry() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
DECLARE
    v_account_name TEXT;
    v_cash_history_id TEXT;
BEGIN
    -- Only create cash entry if status is 'paid' and payment account is specified
    IF NEW.status = 'paid' AND NEW.payment_account_id IS NOT NULL AND NEW.cash_history_id IS NULL THEN
        -- Get account name
        SELECT name INTO v_account_name FROM accounts WHERE id = NEW.payment_account_id;
        -- Generate cash history ID
        v_cash_history_id := 'CH-ZAKAT-' || NEW.id || '-' || EXTRACT(EPOCH FROM NOW())::TEXT;
        -- Insert into cash_history
        INSERT INTO cash_history (
            id,
            account_id,
            account_name,
            amount,
            type,
            description,
            reference_type,
            reference_id,
            reference_name,
            created_at
        ) VALUES (
            v_cash_history_id,
            NEW.payment_account_id,
            v_account_name,
            NEW.amount,
            CASE
                WHEN NEW.category = 'zakat' THEN 'zakat'
                ELSE 'sedekah'
            END,
            NEW.title || COALESCE(' - ' || NEW.description, ''),
            CASE
                WHEN NEW.category = 'zakat' THEN 'zakat'
                ELSE 'charity'
            END,
            NEW.id,
            NEW.title,
            NEW.payment_date
        );
        -- Update the zakat record with cash_history_id
        NEW.cash_history_id := v_cash_history_id;
        -- Update account balance
        UPDATE accounts
        SET balance = balance - NEW.amount
        WHERE id = NEW.payment_account_id;
    END IF;
    RETURN NEW;
END;
$function$;


-- =====================================================
-- Function: create_zakat_payment_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_zakat_payment_atomic(p_zakat jsonb, p_branch_id uuid, p_created_by uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, zakat_id uuid, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_zakat_id UUID;
  v_journal_id UUID;
  v_amount NUMERIC;
  v_zakat_type TEXT;
  v_payment_date DATE;
  v_recipient TEXT;
  v_notes TEXT;
  v_payment_account_id UUID;
  v_kas_account_id UUID;
  v_beban_zakat_id UUID;
  v_entry_number TEXT;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  -- ==================== PARSE DATA ====================
  v_zakat_id := COALESCE((p_zakat->>'id')::UUID, gen_random_uuid());
  v_amount := COALESCE((p_zakat->>'amount')::NUMERIC, 0);
  v_zakat_type := COALESCE(p_zakat->>'zakat_type', 'maal'); -- maal, fitrah, profesi
  v_payment_date := COALESCE((p_zakat->>'payment_date')::DATE, CURRENT_DATE);
  v_recipient := COALESCE(p_zakat->>'recipient', 'Lembaga Amil Zakat');
  v_notes := p_zakat->>'notes';
  v_payment_account_id := (p_zakat->>'payment_account_id')::UUID;
  IF v_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Amount must be positive'::TEXT;
    RETURN;
  END IF;
  -- ==================== GET ACCOUNT IDS ====================
  -- Kas account
  IF v_payment_account_id IS NOT NULL THEN
    v_kas_account_id := v_payment_account_id;
  ELSE
    SELECT id INTO v_kas_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '1110' AND is_active = TRUE LIMIT 1;
  END IF;
  -- Beban Zakat (6xxx - Beban Operasional, atau buat khusus 6500)
  SELECT id INTO v_beban_zakat_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '6500' AND is_active = TRUE LIMIT 1;
  -- Fallback: cari akun dengan nama mengandung "Zakat"
  IF v_beban_zakat_id IS NULL THEN
    SELECT id INTO v_beban_zakat_id FROM accounts
    WHERE branch_id = p_branch_id AND name ILIKE '%zakat%' AND is_active = TRUE LIMIT 1;
  END IF;
  -- Fallback: gunakan Beban Lain-lain (8100)
  IF v_beban_zakat_id IS NULL THEN
    SELECT id INTO v_beban_zakat_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '8100' AND is_active = TRUE LIMIT 1;
  END IF;
  IF v_kas_account_id IS NULL OR v_beban_zakat_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Akun Kas atau Beban Zakat tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- ==================== INSERT ZAKAT RECORD ====================
  INSERT INTO zakat_payments (
    id,
    branch_id,
    amount,
    zakat_type,
    payment_date,
    recipient,
    notes,
    status,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    v_zakat_id,
    p_branch_id,
    v_amount,
    v_zakat_type,
    v_payment_date,
    v_recipient,
    v_notes,
    'paid',
    p_created_by,
    NOW(),
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
    v_payment_date,
    'Pembayaran Zakat ' || INITCAP(v_zakat_type) || ' - ' || v_recipient,
    'zakat',
    v_zakat_id::TEXT,
    'posted',
    FALSE,
    NOW(),
    NOW()
  ) RETURNING id INTO v_journal_id;
  -- Dr. Beban Zakat
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_beban_zakat_id,
    (SELECT name FROM accounts WHERE id = v_beban_zakat_id),
    v_amount, 0, 'Beban Zakat ' || INITCAP(v_zakat_type), 1
  );
  -- Cr. Kas
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_kas_account_id,
    (SELECT name FROM accounts WHERE id = v_kas_account_id),
    0, v_amount, 'Pengeluaran kas untuk zakat', 2
  );
  -- ==================== SUCCESS ====================
  RETURN QUERY SELECT TRUE, v_zakat_id, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, SQLERRM::TEXT;
END;
$function$;


-- =====================================================
-- Function: delete_zakat_record_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.delete_zakat_record_atomic(p_branch_id uuid, p_zakat_id text) RETURNS TABLE(success boolean, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
BEGIN
  -- Void Journals
  UPDATE journal_entries
  SET is_voided = TRUE, status = 'voided', voided_reason = 'Zakat record deleted'
  WHERE reference_id = p_zakat_id AND reference_type = 'zakat' AND is_voided = FALSE;
  -- Delete Record
  DELETE FROM zakat_records WHERE id = p_zakat_id AND branch_id = p_branch_id;
  RETURN QUERY SELECT TRUE, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, SQLERRM::TEXT;
END;
$function$;


-- =====================================================
-- Function: get_current_nishab
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_current_nishab() RETURNS TABLE(gold_price numeric, silver_price numeric, gold_nishab numeric, silver_nishab numeric, zakat_rate numeric, gold_nishab_value numeric, silver_nishab_value numeric)
    LANGUAGE plpgsql
    AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    n.gold_price,
    n.silver_price,
    n.gold_nishab,
    n.silver_nishab,
    n.zakat_rate,
    (n.gold_price * n.gold_nishab) as gold_nishab_value,
    (n.silver_price * n.silver_nishab) as silver_nishab_value
  FROM nishab_reference n
  WHERE n.effective_date <= CURRENT_DATE
  ORDER BY n.effective_date DESC
  LIMIT 1;
  
  -- If no data, return defaults
  IF NOT FOUND THEN
    RETURN QUERY SELECT 
      1100000::NUMERIC, -- gold_price per gram
      15000::NUMERIC,   -- silver_price per gram
      85::NUMERIC,      -- gold_nishab grams
      595::NUMERIC,     -- silver_nishab grams
      0.025::NUMERIC,   -- zakat_rate 2.5%
      93500000::NUMERIC, -- gold_nishab_value
      8925000::NUMERIC;  -- silver_nishab_value
  END IF;
END;
$function$;


-- =====================================================
-- Function: upsert_zakat_record_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.upsert_zakat_record_atomic(p_branch_id uuid, p_zakat_id text, p_data jsonb) RETURNS TABLE(success boolean, zakat_id text, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_zakat_id TEXT := p_zakat_id;
  v_journal_id UUID;
  v_beban_acc_id UUID;
  v_payment_acc_id UUID;
  v_amount NUMERIC;
  v_date DATE;
  v_journal_lines JSONB;
  v_category TEXT;
  v_title TEXT;
BEGIN
  -- ==================== VALIDASI & EKSTRAKSI ====================
  
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, 'Branch ID is REQUIRED'::TEXT;
    RETURN;
  END IF;
  v_amount := (p_data->>'amount')::NUMERIC;
  v_date := (p_data->>'payment_date')::DATE;
  v_payment_acc_id := (p_data->>'payment_account_id')::UUID;
  v_category := p_data->>'category';
  v_title := p_data->>'title';
  IF v_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, 'Amount must be positive'::TEXT;
    RETURN;
  END IF;
  -- Cari atau buat akun Beban Zakat/Sosial (6260-ish)
  -- Jika tidak ada, fallback ke Beban Umum (6200)
  SELECT id INTO v_beban_acc_id
  FROM accounts
  WHERE branch_id = p_branch_id
    AND (name ILIKE '%Beban Zakat%' OR name ILIKE '%Beban Sosial%' OR name ILIKE '%Beban Sumbangan%')
    AND is_header = FALSE
  LIMIT 1;
  IF v_beban_acc_id IS NULL THEN
    -- Fallback ke Beban Umum & Administrasi
    SELECT id INTO v_beban_acc_id
    FROM accounts
    WHERE branch_id = p_branch_id
      AND (code = '6200' OR name ILIKE '%Beban Umum%')
      AND is_header = FALSE
    LIMIT 1;
  END IF;
  IF v_beban_acc_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, 'Akun Beban (6200) tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- ==================== UPSERT ZAKAT RECORD ====================
  
  IF v_zakat_id IS NULL THEN
    v_zakat_id := 'ZAKAT-' || TO_CHAR(v_date, 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 1000)::TEXT, 3, '0');
  END IF;
  INSERT INTO zakat_records (
    id,
    type,
    category,
    title,
    description,
    recipient,
    recipient_type,
    amount,
    nishab_amount,
    percentage_rate,
    payment_date,
    payment_account_id,
    payment_method,
    status,
    receipt_number,
    calculation_basis,
    calculation_notes,
    is_anonymous,
    notes,
    attachment_url,
    hijri_year,
    hijri_month,
    created_by,
    branch_id,
    created_at,
    updated_at
  ) VALUES (
    v_zakat_id,
    p_data->>'type',
    v_category,
    v_title,
    p_data->>'description',
    p_data->>'recipient',
    p_data->>'recipient_type',
    v_amount,
    (p_data->>'nishab_amount')::NUMERIC,
    (p_data->>'percentage_rate')::NUMERIC,
    v_date,
    v_payment_acc_id,
    p_data->>'payment_method',
    'paid',
    p_data->>'receipt_number',
    p_data->>'calculation_basis',
    p_data->>'calculation_notes',
    (p_data->>'is_anonymous')::BOOLEAN,
    p_data->>'notes',
    p_data->>'attachment_url',
    (p_data->>'hijri_year')::INTEGER,
    p_data->>'hijri_month',
    auth.uid(),
    p_branch_id,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    type = EXCLUDED.type,
    category = EXCLUDED.category,
    title = EXCLUDED.title,
    amount = EXCLUDED.amount,
    payment_date = EXCLUDED.payment_date,
    payment_account_id = EXCLUDED.payment_account_id,
    updated_at = NOW();
  -- ==================== CREATE JOURNAL ====================
  
  -- Void existing journal if updating
  UPDATE journal_entries 
  SET is_voided = TRUE, status = 'voided', voided_reason = 'Updated zakat record'
  WHERE reference_id = v_zakat_id AND reference_type = 'zakat' AND is_voided = FALSE;
  -- Dr. Beban Zakat/Umum
  --   Cr. Kas/Bank
  v_journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_beban_acc_id,
      'debit_amount', v_amount,
      'credit_amount', 0,
      'description', format('%s: %s', INITCAP(v_category), v_title)
    ),
    jsonb_build_object(
      'account_id', v_payment_acc_id,
      'debit_amount', 0,
      'credit_amount', v_amount,
      'description', format('Pembayaran %s (%s)', v_category, v_zakat_id)
    )
  );
  SELECT journal_id INTO v_journal_id
  FROM create_journal_atomic(
    p_branch_id,
    v_date,
    format('Pembayaran %s - %s', INITCAP(v_category), v_title),
    'zakat',
    v_zakat_id,
    v_journal_lines,
    TRUE -- auto post
  );
  -- Link journal to zakat record
  UPDATE zakat_records SET journal_entry_id = v_journal_id WHERE id = v_zakat_id;
  RETURN QUERY SELECT TRUE, v_zakat_id, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, SQLERRM::TEXT;
END;
$function$;


-- =====================================================
-- Function: void_zakat_payment_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.void_zakat_payment_atomic(p_zakat_id uuid, p_branch_id uuid, p_reason text DEFAULT 'Dibatalkan'::text, p_user_id uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, journals_voided integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_zakat RECORD;
  v_journals_voided INTEGER := 0;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  -- Get zakat record
  SELECT * INTO v_zakat
  FROM zakat_payments
  WHERE id = p_zakat_id AND branch_id = p_branch_id
  FOR UPDATE;
  IF v_zakat.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 'Pembayaran zakat tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  IF v_zakat.status = 'cancelled' THEN
    RETURN QUERY SELECT FALSE, 0, 'Pembayaran zakat sudah dibatalkan'::TEXT;
    RETURN;
  END IF;
  -- ==================== VOID JOURNALS ====================
  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_reason = p_reason,
    status = 'voided',
    updated_at = NOW()
  WHERE reference_type = 'zakat'
    AND reference_id = p_zakat_id::TEXT
    AND branch_id = p_branch_id
    AND is_voided = FALSE;
  GET DIAGNOSTICS v_journals_voided = ROW_COUNT;
  -- ==================== UPDATE STATUS ====================
  UPDATE zakat_payments
  SET
    status = 'cancelled',
    updated_at = NOW()
  WHERE id = p_zakat_id;
  -- ==================== SUCCESS ====================
  RETURN QUERY SELECT TRUE, v_journals_voided, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0, SQLERRM::TEXT;
END;
$function$;


