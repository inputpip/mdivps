-- =====================================================
-- 27 TAX
-- Generated: 2026-01-09T00:29:07.867Z
-- Total functions: 2
-- =====================================================

-- Functions in this file:
--   create_tax_payment_atomic
--   create_tax_payment_atomic

-- =====================================================
-- Function: create_tax_payment_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_tax_payment_atomic(p_branch_id uuid, p_period text, p_ppn_masukan_used numeric, p_ppn_keluaran_paid numeric, p_payment_account_id text, p_notes text DEFAULT NULL::text)
 RETURNS TABLE(success boolean, journal_id uuid, net_payment numeric, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_reference_id TEXT;
  v_ppn_keluaran_account_id TEXT;
  v_ppn_masukan_account_id TEXT;
  v_net_payment NUMERIC;
  v_description TEXT;
  v_payment_date DATE := CURRENT_DATE;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, 'Branch ID is REQUIRED'::TEXT;
    RETURN;
  END IF;
  IF p_ppn_keluaran_paid <= 0 AND p_ppn_masukan_used <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, 'Jumlah PPN harus lebih dari 0'::TEXT;
    RETURN;
  END IF;
  IF p_payment_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, 'Akun pembayaran harus dipilih'::TEXT;
    RETURN;
  END IF;
  -- ==================== LOOKUP ACCOUNTS ====================
  -- Find PPN Keluaran account (2130)
  SELECT id INTO v_ppn_keluaran_account_id
  FROM accounts
  WHERE (
    LOWER(name) LIKE '%ppn%keluaran%' OR
    code = '2130'
  )
  AND is_header = FALSE
  AND branch_id = p_branch_id
  LIMIT 1;
  IF v_ppn_keluaran_account_id IS NULL THEN
    -- Try without branch filter (global accounts)
    SELECT id INTO v_ppn_keluaran_account_id
    FROM accounts
    WHERE (
      LOWER(name) LIKE '%ppn%keluaran%' OR
      code = '2130'
    )
    AND is_header = FALSE
    LIMIT 1;
  END IF;
  IF v_ppn_keluaran_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, 'Akun PPN Keluaran (2130) tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- Find PPN Masukan account (1230)
  SELECT id INTO v_ppn_masukan_account_id
  FROM accounts
  WHERE (
    LOWER(name) LIKE '%ppn%masukan%' OR
    code = '1230'
  )
  AND is_header = FALSE
  AND branch_id = p_branch_id
  LIMIT 1;
  IF v_ppn_masukan_account_id IS NULL THEN
    -- Try without branch filter (global accounts)
    SELECT id INTO v_ppn_masukan_account_id
    FROM accounts
    WHERE (
      LOWER(name) LIKE '%ppn%masukan%' OR
      code = '1230'
    )
    AND is_header = FALSE
    LIMIT 1;
  END IF;
  IF v_ppn_masukan_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, 'Akun PPN Masukan (1230) tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- ==================== CALCULATE NET PAYMENT ====================
  -- Net payment = PPN Keluaran - PPN Masukan
  -- Jika positif, kita bayar ke negara
  -- Jika negatif, kita punya lebih bayar (kredit)
  v_net_payment := COALESCE(p_ppn_keluaran_paid, 0) - COALESCE(p_ppn_masukan_used, 0);
  -- ==================== BUILD DESCRIPTION & REFERENCE ====================
  v_description := 'Pembayaran PPN';
  IF p_period IS NOT NULL THEN
    v_description := v_description || ' periode ' || p_period;
  END IF;
  -- Create reference_id in format TAX-YYYYMM-xxx for period parsing
  -- Extract YYYYMM from period (handles both "2024-01" and "Januari 2024" formats)
  DECLARE
    v_year_month TEXT;
  BEGIN
    -- Try to match YYYY-MM format
    IF p_period ~ '^\d{4}-\d{2}$' THEN
      v_year_month := REPLACE(p_period, '-', '');
    ELSE
      -- Default to current month
      v_year_month := TO_CHAR(v_payment_date, 'YYYYMM');
    END IF;
    v_reference_id := 'TAX-' || v_year_month || '-' ||
                      LPAD((EXTRACT(EPOCH FROM NOW())::BIGINT % 10000)::TEXT, 4, '0');
  END;
  -- ==================== CREATE JOURNAL ENTRY ====================
  v_entry_number := 'JE-TAX-' || TO_CHAR(v_payment_date, 'YYYYMMDD') || '-' ||
                    LPAD((EXTRACT(EPOCH FROM NOW())::BIGINT % 10000)::TEXT, 4, '0');
  INSERT INTO journal_entries (
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    is_posted,
    status,
    branch_id,
    created_by,
    created_at
  ) VALUES (
    v_entry_number,
    v_payment_date,
    CASE WHEN p_notes IS NOT NULL AND p_notes != ''
      THEN v_description || ' - ' || p_notes
      ELSE v_description
    END,
    'tax_payment',
    v_reference_id,
    TRUE,
    'posted',
    p_branch_id,
    'System',
    NOW()
  )
  RETURNING id INTO v_journal_id;
  -- ==================== JOURNAL LINE ITEMS ====================
  -- Jurnal Pembayaran PPN:
  -- Untuk mengOffset PPN Keluaran (liability) dan PPN Masukan (asset)
  --
  -- Dr PPN Keluaran (2130) - menghapus kewajiban
  -- Cr PPN Masukan (1230) - menghapus hak kredit
  -- Cr Kas - selisihnya (net payment)
  -- 1. Debit PPN Keluaran (mengurangi liability)
  IF p_ppn_keluaran_paid > 0 THEN
    INSERT INTO journal_entry_items (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_journal_id, v_ppn_keluaran_account_id, p_ppn_keluaran_paid, 0,
      'Offset PPN Keluaran periode ' || COALESCE(p_period, ''));
  END IF;
  -- 2. Credit PPN Masukan (mengurangi asset/hak kredit)
  IF p_ppn_masukan_used > 0 THEN
    INSERT INTO journal_entry_items (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_journal_id, v_ppn_masukan_account_id, 0, p_ppn_masukan_used,
      'Offset PPN Masukan periode ' || COALESCE(p_period, ''));
  END IF;
  -- 3. Kas - selisih pembayaran
  IF v_net_payment > 0 THEN
    -- Kita bayar ke negara (Credit Kas)
    INSERT INTO journal_entry_items (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_journal_id, p_payment_account_id, 0, v_net_payment,
      'Pembayaran PPN ke negara periode ' || COALESCE(p_period, ''));
  ELSIF v_net_payment < 0 THEN
    -- Lebih bayar - record as Debit to Kas (refund or carry forward)
    INSERT INTO journal_entry_items (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_journal_id, p_payment_account_id, ABS(v_net_payment), 0,
      'Lebih bayar PPN periode ' || COALESCE(p_period, ''));
  END IF;
  -- ==================== UPDATE ACCOUNT BALANCES ====================
  -- Update PPN Keluaran balance (liability decreases = subtract from balance)
  IF p_ppn_keluaran_paid > 0 THEN
    UPDATE accounts
    SET balance = COALESCE(balance, 0) - p_ppn_keluaran_paid,
        updated_at = NOW()
    WHERE id = v_ppn_keluaran_account_id;
  END IF;
  -- Update PPN Masukan balance (asset decreases = subtract from balance)
  IF p_ppn_masukan_used > 0 THEN
    UPDATE accounts
    SET balance = COALESCE(balance, 0) - p_ppn_masukan_used,
        updated_at = NOW()
    WHERE id = v_ppn_masukan_account_id;
  END IF;
  -- Update Kas/Bank balance
  IF v_net_payment > 0 THEN
    -- Payment to government: decrease cash
    UPDATE accounts
    SET balance = COALESCE(balance, 0) - v_net_payment,
        updated_at = NOW()
    WHERE id = p_payment_account_id;
  ELSIF v_net_payment < 0 THEN
    -- Overpayment refund: increase cash
    UPDATE accounts
    SET balance = COALESCE(balance, 0) + ABS(v_net_payment),
        updated_at = NOW()
    WHERE id = p_payment_account_id;
  END IF;
  -- ==================== LOG ====================
  RAISE NOTICE '[Tax Payment] Journal % created. PPN Keluaran: %, PPN Masukan: %, Net: %',
    v_entry_number, p_ppn_keluaran_paid, p_ppn_masukan_used, v_net_payment;
  RETURN QUERY SELECT TRUE, v_journal_id, v_net_payment, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: create_tax_payment_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_tax_payment_atomic(p_branch_id uuid, p_period text, p_ppn_masukan_used numeric DEFAULT 0, p_ppn_keluaran_paid numeric DEFAULT 0, p_payment_account_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
 RETURNS TABLE(success boolean, payment_id uuid, journal_id uuid, net_payment numeric, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_payment_id UUID;
  v_journal_id UUID;
  v_net_payment NUMERIC;
  v_kas_account_id UUID;
  v_ppn_masukan_id UUID;
  v_ppn_keluaran_id UUID;
  v_entry_number TEXT;
  v_line_number INTEGER := 1;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  v_net_payment := p_ppn_keluaran_paid - p_ppn_masukan_used;

  IF v_net_payment <= 0 AND p_ppn_keluaran_paid = 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, 'Tidak ada pajak untuk disetor'::TEXT;
    RETURN;
  END IF;

  -- ==================== GET ACCOUNT IDS ====================

  IF p_payment_account_id IS NOT NULL THEN
    v_kas_account_id := p_payment_account_id;
  ELSE
    SELECT id INTO v_kas_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '1110' AND is_active = TRUE LIMIT 1;
  END IF;

  SELECT id INTO v_ppn_masukan_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1230' AND is_active = TRUE LIMIT 1;

  SELECT id INTO v_ppn_keluaran_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '2130' AND is_active = TRUE LIMIT 1;

  v_payment_id := gen_random_uuid();

  -- ==================== INSERT TAX PAYMENT RECORD ====================

  INSERT INTO tax_payments (
    id, branch_id, period, ppn_masukan_used, ppn_keluaran_paid,
    net_payment, payment_account_id, notes, created_by, created_at
  ) VALUES (
    v_payment_id, p_branch_id, p_period, p_ppn_masukan_used, p_ppn_keluaran_paid,
    v_net_payment, p_payment_account_id, p_notes, auth.uid(), NOW()
  );

  -- ==================== CREATE JOURNAL ENTRY ====================

  -- Generate entry number (Global across all branches)
  SELECT 'JE-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(
    (COALESCE(
      (SELECT MAX(CAST(SUBSTRING(entry_number FROM '-(\d+)$') AS INTEGER))
       FROM journal_entries
       WHERE DATE(entry_date) = CURRENT_DATE),
      0
    ) + 1)::TEXT, 4, '0')
  INTO v_entry_number;

  INSERT INTO journal_entries (id, branch_id, entry_number, entry_date, description, reference_type, reference_id, status, is_voided, created_at, updated_at)
  VALUES (gen_random_uuid(), p_branch_id, v_entry_number, CURRENT_DATE, 'Setor Pajak Periode ' || p_period, 'tax_payment', v_payment_id::TEXT, 'posted', FALSE, NOW(), NOW())
  RETURNING id INTO v_journal_id;

  -- Dr. PPN Keluaran (mengurangi kewajiban)
  IF p_ppn_keluaran_paid > 0 AND v_ppn_keluaran_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_name, debit_amount, credit_amount, description, line_number)
    VALUES (v_journal_id, v_ppn_keluaran_id, (SELECT name FROM accounts WHERE id = v_ppn_keluaran_id), p_ppn_keluaran_paid, 0, 'Setor PPN Keluaran', v_line_number);
    v_line_number := v_line_number + 1;
  END IF;

  -- Cr. PPN Masukan (menggunakan kredit pajak)
  IF p_ppn_masukan_used > 0 AND v_ppn_masukan_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_name, debit_amount, credit_amount, description, line_number)
    VALUES (v_journal_id, v_ppn_masukan_id, (SELECT name FROM accounts WHERE id = v_ppn_masukan_id), 0, p_ppn_masukan_used, 'Kompensasi PPN Masukan', v_line_number);
    v_line_number := v_line_number + 1;
  END IF;

  -- Cr. Kas (pembayaran netto)
  IF v_net_payment > 0 AND v_kas_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_name, debit_amount, credit_amount, description, line_number)
    VALUES (v_journal_id, v_kas_account_id, (SELECT name FROM accounts WHERE id = v_kas_account_id), 0, v_net_payment, 'Pembayaran pajak', v_line_number);
  END IF;

  RETURN QUERY SELECT TRUE, v_payment_id, v_journal_id, v_net_payment, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, SQLERRM::TEXT;
END;
$function$
;


