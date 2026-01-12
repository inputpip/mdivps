-- =====================================================
-- 05 ACCOUNTING JOURNAL
-- Generated: 2026-01-09T00:29:07.859Z
-- Total functions: 48
-- =====================================================

-- Functions in this file:
--   calculate_balance_delta
--   can_create_accounts
--   create_account
--   create_accounts_payable_atomic
--   create_all_opening_balance_journal_rpc
--   create_debt_journal_rpc
--   create_inventory_opening_balance_journal_rpc
--   create_journal_atomic
--   create_journal_atomic
--   create_manual_cash_in_journal_rpc
--   create_manual_cash_out_journal_rpc
--   create_material_payment_journal_rpc
--   create_migration_debt_journal_rpc
--   create_migration_receivable_journal_rpc
--   create_receivable_payment_journal_rpc
--   create_sales_journal_rpc
--   create_transfer_journal_rpc
--   delete_account
--   delete_accounts_payable_atomic
--   demo_balance_sheet
--   demo_show_chart_of_accounts
--   demo_trial_balance
--   execute_closing_entry_atomic
--   generate_journal_number
--   generate_journal_number
--   get_account_balance
--   get_account_balance_analysis
--   get_account_balance_at_date
--   get_account_balance_with_children
--   get_account_opening_balance
--   get_all_accounts_balance_analysis
--   get_next_journal_number
--   import_standard_coa
--   insert_journal_entry
--   post_journal_atomic
--   preview_closing_entry
--   reconcile_account_balance
--   set_account_initial_balance
--   sync_account_balances
--   test_balance_reconciliation_functions
--   update_account
--   update_account_balance_from_journal
--   update_account_initial_balance_atomic
--   validate_journal_balance
--   validate_journal_entry
--   void_closing_entry_atomic
--   void_journal_by_reference
--   void_journal_entry

-- =====================================================
-- Function: calculate_balance_delta
-- =====================================================
CREATE OR REPLACE FUNCTION public.calculate_balance_delta(p_account_id text, p_debit numeric, p_credit numeric)
 RETURNS numeric
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_type TEXT;
    v_delta NUMERIC;
BEGIN
    SELECT type INTO v_type FROM accounts WHERE id = p_account_id;
    
    -- Default to Aset logic if type not found (safe fallback)
    v_type := COALESCE(v_type, 'Aset');

    IF v_type IN ('Aset', 'Beban') THEN
        v_delta := p_debit - p_credit;
    ELSE
        -- Kewajiban, Modal, Pendapatan: Credit increases balance
        v_delta := p_credit - p_debit;
    END IF;

    RETURN v_delta;
END;
$function$
;


-- =====================================================
-- Function: can_create_accounts
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_create_accounts()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
BEGIN RETURN has_permission('accounts_create'); END;
$function$
;


-- =====================================================
-- Function: create_account
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_account(p_branch_id text, p_name text, p_code text, p_type text, p_initial_balance numeric DEFAULT 0, p_is_payment_account boolean DEFAULT false, p_parent_id text DEFAULT NULL::text, p_level integer DEFAULT 1, p_is_header boolean DEFAULT false, p_sort_order integer DEFAULT 0, p_employee_id text DEFAULT NULL::text)
 RETURNS TABLE(success boolean, account_id text, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_account_id UUID;
  v_code_exists BOOLEAN;
BEGIN
  -- Validate Branch ID
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'Branch ID is required';
    RETURN;
  END IF;

  -- Validate Code Uniqueness in Branch
  IF p_code IS NOT NULL AND p_code != '' THEN
    SELECT EXISTS (
      SELECT 1 FROM accounts 
      WHERE branch_id = p_branch_id::UUID 
      AND code = p_code
    ) INTO v_code_exists;
    
    IF v_code_exists THEN
      RETURN QUERY SELECT FALSE, NULL::TEXT, 'Account code already exists in this branch';
      RETURN;
    END IF;
  END IF;

  -- Generate ID Explicitly
  v_account_id := gen_random_uuid();

  -- Insert Account
  INSERT INTO accounts (
    id,
    branch_id,
    name,
    code,
    type,
    initial_balance,
    balance, -- CORRECT FIX: Initialize to 0. Journal Trigger will populate this.
    is_payment_account,
    parent_id,
    level,
    is_header,
    sort_order,
    employee_id,
    is_active
  ) VALUES (
    v_account_id,
    p_branch_id::UUID,
    p_name,
    p_code,
    p_type,
    p_initial_balance,
    0, -- Start at 0. Do NOT double count.
    p_is_payment_account,
    p_parent_id::UUID,
    p_level,
    p_is_header,
    p_sort_order,
    p_employee_id::UUID,
    true
  );

  -- Create Journal for Opening Balance if not zero
  IF p_initial_balance <> 0 THEN
      -- This creates a Journal -> Trigger Fires -> Updates Balance (+1.5M)
      PERFORM update_account_initial_balance_atomic(
          v_account_id::TEXT, 
          p_initial_balance, 
          p_branch_id::UUID
      );
  END IF;

  RETURN QUERY SELECT TRUE, v_account_id::TEXT, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::TEXT, SQLERRM;
END;
$function$
;


-- =====================================================
-- Function: create_accounts_payable_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_accounts_payable_atomic(p_branch_id uuid, p_supplier_name text, p_amount numeric, p_due_date date DEFAULT NULL::date, p_description text DEFAULT NULL::text, p_creditor_type text DEFAULT 'supplier'::text, p_purchase_order_id text DEFAULT NULL::text, p_skip_journal boolean DEFAULT false)
 RETURNS TABLE(success boolean, payable_id text, journal_id uuid, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_payable_id TEXT;
  v_journal_id UUID;
  v_entry_number TEXT;
  v_hutang_account_id TEXT;
  v_lawan_account_id TEXT; -- Usually Cash or Inventory depending on context
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
      'Branch ID is REQUIRED'::TEXT;
    RETURN;
  END IF;

  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
      'Amount must be positive'::TEXT;
    RETURN;
  END IF;

  -- ðŸ”¥ NEW: Check if AP already exists for this PO
  IF p_purchase_order_id IS NOT NULL THEN
    DECLARE
      v_existing_ap_count INTEGER;
    BEGIN
      SELECT COUNT(*) INTO v_existing_ap_count
      FROM accounts_payable
      WHERE purchase_order_id = p_purchase_order_id;

      IF v_existing_ap_count > 0 THEN
        RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
          'Accounts Payable sudah ada untuk PO ini. Gunakan approve_purchase_order_atomic untuk PO.'::TEXT;
        RETURN;
      END IF;
    END;

    -- ðŸ”¥ FORCE skip_journal for PO (journal should be created by approve_purchase_order_atomic)
    p_skip_journal := TRUE;
  END IF;

  -- Generate Sequential ID
  v_payable_id := 'AP-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');

  -- ==================== INSERT ACCOUNTS PAYABLE ====================

  INSERT INTO accounts_payable (
    id,
    branch_id,
    supplier_name,
    creditor_type,
    amount,
    due_date,
    description,
    purchase_order_id,
    status,
    paid_amount,
    created_at
  ) VALUES (
    v_payable_id,
    p_branch_id,
    p_supplier_name,
    p_creditor_type,
    p_amount,
    p_due_date,
    p_description,
    p_purchase_order_id,
    'Outstanding',
    0,
    NOW()
  );

  -- ==================== CREATE JOURNAL ENTRY ====================

  IF NOT p_skip_journal THEN
    -- Get Account IDs
    -- Default Hutang Usaha: 2110
    SELECT id INTO v_hutang_account_id FROM accounts WHERE code = '2110' AND branch_id = p_branch_id AND is_active = TRUE LIMIT 1;
    
    -- Lawan: 5110 (Pembelian) as default
    SELECT id INTO v_lawan_account_id FROM accounts WHERE code = '5110' AND branch_id = p_branch_id AND is_active = TRUE LIMIT 1;

    IF v_hutang_account_id IS NOT NULL AND v_lawan_account_id IS NOT NULL THEN
       DECLARE
         v_journal_lines JSONB;
         v_journal_res RECORD;
       BEGIN
         -- Dr. Lawan
         -- Cr. Hutang
         v_journal_lines := jsonb_build_array(
           jsonb_build_object(
             'account_id', v_lawan_account_id,
             'debit_amount', p_amount,
             'credit_amount', 0,
             'description', COALESCE(p_description, 'Hutang Baru')
           ),
           jsonb_build_object(
             'account_id', v_hutang_account_id,
             'debit_amount', 0,
             'credit_amount', p_amount,
             'description', COALESCE(p_description, 'Hutang Baru')
           )
         );

         SELECT * INTO v_journal_res FROM create_journal_atomic(
           p_branch_id,
           CURRENT_DATE,
           COALESCE(p_description, 'Hutang Baru: ' || p_supplier_name),
           'accounts_payable',
           v_payable_id,
           v_journal_lines,
           TRUE -- auto post
         );

         IF v_journal_res.success THEN
           v_journal_id := v_journal_res.journal_id;
         ELSE
           RAISE EXCEPTION 'Gagal membuat jurnal hutang: %', v_journal_res.error_message;
         END IF;
       END;
    END IF;
  END IF;

  RETURN QUERY SELECT TRUE, v_payable_id, v_journal_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: create_all_opening_balance_journal_rpc
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_all_opening_balance_journal_rpc(p_branch_id uuid, p_opening_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(success boolean, journal_id uuid, accounts_processed integer, total_debit numeric, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_laba_ditahan_id UUID;
  v_account RECORD;
  v_total_debit NUMERIC := 0;
  v_total_credit NUMERIC := 0;
  v_line_number INTEGER := 1;
  v_accounts_processed INTEGER := 0;
BEGIN
  -- VALIDASI
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  -- GET LABA DITAHAN ACCOUNT
  SELECT id INTO v_laba_ditahan_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '3200' AND is_active = TRUE LIMIT 1;
  IF v_laba_ditahan_id IS NULL THEN
    SELECT id INTO v_laba_ditahan_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '3100' AND is_active = TRUE LIMIT 1;
  END IF;
  IF v_laba_ditahan_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, 'Akun Laba Ditahan tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- GENERATE ENTRY NUMBER
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE(
      (SELECT COUNT(*) + 1 FROM journal_entries
       WHERE branch_id = p_branch_id
       AND DATE(created_at) = CURRENT_DATE),
      1
    ))::TEXT, 4, '0')
  INTO v_entry_number;
  -- CREATE JOURNAL ENTRY
  INSERT INTO journal_entries (
    id, branch_id, entry_number, entry_date, description,
    reference_type, reference_id, status, is_voided, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_branch_id, v_entry_number, p_opening_date,
    'Saldo Awal Semua Akun',
    'opening', 'ALL-OPENING', 'posted', FALSE, NOW(), NOW()
  ) RETURNING id INTO v_journal_id;
  -- LOOP THROUGH ALL ACCOUNTS WITH INITIAL BALANCE
  FOR v_account IN
    SELECT id, code, name, type, initial_balance, normal_balance
    FROM accounts
    WHERE branch_id = p_branch_id
      AND initial_balance IS NOT NULL
      AND initial_balance <> 0
      AND code NOT IN ('1310', '1320') -- Exclude inventory (handled separately)
      AND is_active = TRUE
    ORDER BY code
  LOOP
    -- Determine debit/credit based on account type and normal balance
    IF v_account.type IN ('Aset', 'Beban') OR v_account.normal_balance = 'DEBIT' THEN
      -- Debit entry for asset/expense accounts
      INSERT INTO journal_entry_lines (
        journal_entry_id, account_id, account_code, account_name,
        debit_amount, credit_amount, description, line_number
      ) VALUES (
        v_journal_id, v_account.id, v_account.code, v_account.name,
        ABS(v_account.initial_balance), 0, 'Saldo awal ' || v_account.name, v_line_number
      );
      v_total_debit := v_total_debit + ABS(v_account.initial_balance);
    ELSE
      -- Credit entry for liability/equity/revenue accounts
      INSERT INTO journal_entry_lines (
        journal_entry_id, account_id, account_code, account_name,
        debit_amount, credit_amount, description, line_number
      ) VALUES (
        v_journal_id, v_account.id, v_account.code, v_account.name,
        0, ABS(v_account.initial_balance), 'Saldo awal ' || v_account.name, v_line_number
      );
      v_total_credit := v_total_credit + ABS(v_account.initial_balance);
    END IF;
    v_line_number := v_line_number + 1;
    v_accounts_processed := v_accounts_processed + 1;
  END LOOP;
  -- ADD BALANCING ENTRY TO LABA DITAHAN
  IF v_total_debit <> v_total_credit THEN
    IF v_total_debit > v_total_credit THEN
      -- Need more credit
      INSERT INTO journal_entry_lines (
        journal_entry_id, account_id, account_code, account_name,
        debit_amount, credit_amount, description, line_number
      ) VALUES (
        v_journal_id, v_laba_ditahan_id,
        (SELECT code FROM accounts WHERE id = v_laba_ditahan_id),
        (SELECT name FROM accounts WHERE id = v_laba_ditahan_id),
        0, v_total_debit - v_total_credit, 'Penyeimbang saldo awal', v_line_number
      );
    ELSE
      -- Need more debit
      INSERT INTO journal_entry_lines (
        journal_entry_id, account_id, account_code, account_name,
        debit_amount, credit_amount, description, line_number
      ) VALUES (
        v_journal_id, v_laba_ditahan_id,
        (SELECT code FROM accounts WHERE id = v_laba_ditahan_id),
        (SELECT name FROM accounts WHERE id = v_laba_ditahan_id),
        v_total_credit - v_total_debit, 0, 'Penyeimbang saldo awal', v_line_number
      );
    END IF;
  END IF;
  RETURN QUERY SELECT TRUE, v_journal_id, v_accounts_processed, v_total_debit, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: create_debt_journal_rpc
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_debt_journal_rpc(p_branch_id uuid, p_debt_id text, p_debt_date date, p_amount numeric, p_creditor_name text, p_creditor_type text DEFAULT 'other'::text, p_description text DEFAULT NULL::text, p_cash_account_id text DEFAULT NULL::text)
 RETURNS TABLE(success boolean, journal_id uuid, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_kas_account_id TEXT;  -- Changed to TEXT
  v_hutang_account_id TEXT; -- Changed to TEXT
  v_hutang_code TEXT;
BEGIN
  -- VALIDASI
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Amount must be greater than 0'::TEXT;
    RETURN;
  END IF;

  -- GET KAS ACCOUNT
  IF p_cash_account_id IS NOT NULL THEN
    v_kas_account_id := p_cash_account_id;
  ELSE
    SELECT id INTO v_kas_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '1120' AND is_active = TRUE LIMIT 1;
  END IF;

  -- GET HUTANG ACCOUNT BASED ON CREDITOR TYPE
  CASE p_creditor_type
    WHEN 'bank' THEN v_hutang_code := '2120';
    WHEN 'supplier' THEN v_hutang_code := '2110';
    ELSE v_hutang_code := '2190';
  END CASE;

  SELECT id INTO v_hutang_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = v_hutang_code AND is_active = TRUE LIMIT 1;

  IF v_hutang_account_id IS NULL THEN
    SELECT id INTO v_hutang_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '2110' AND is_active = TRUE LIMIT 1;
    v_hutang_code := '2110';
  END IF;

  IF v_kas_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Kas/Bank tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  IF v_hutang_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Hutang tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  -- GENERATE ENTRY NUMBER (GLOBAL SEQUENCE)
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE(
      (SELECT COUNT(*) + 1 FROM journal_entries
       WHERE DATE(created_at) = CURRENT_DATE),
      1
    ))::TEXT, 4, '0')
  INTO v_entry_number;

  -- CREATE JOURNAL ENTRY
  INSERT INTO journal_entries (
    id, branch_id, entry_number, entry_date, description,
    reference_type, reference_id, status, is_voided, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_branch_id, v_entry_number, p_debt_date,
    COALESCE(p_description, 'Pinjaman dari ' || p_creditor_name),
    'payable', p_debt_id, 'posted', FALSE, NOW(), NOW()
  ) RETURNING id INTO v_journal_id;

  -- Dr. Kas
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_kas_account_id,
    (SELECT code FROM accounts WHERE id = v_kas_account_id),
    (SELECT name FROM accounts WHERE id = v_kas_account_id),
    p_amount, 0, 'Penerimaan pinjaman dari ' || p_creditor_name, 1
  );

  -- Cr. Hutang
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_hutang_account_id, v_hutang_code,
    (SELECT name FROM accounts WHERE id = v_hutang_account_id),
    0, p_amount, 'Hutang kepada ' || p_creditor_name, 2
  );

  RETURN QUERY SELECT TRUE, v_journal_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: create_inventory_opening_balance_journal_rpc
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_inventory_opening_balance_journal_rpc(p_branch_id uuid, p_products_value numeric DEFAULT 0, p_materials_value numeric DEFAULT 0, p_opening_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(success boolean, journal_id uuid, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_persediaan_barang_id UUID;
  v_persediaan_bahan_id UUID;
  v_laba_ditahan_id UUID;
  v_total_amount NUMERIC;
  v_line_number INTEGER := 1;
BEGIN
  -- VALIDASI
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  v_total_amount := COALESCE(p_products_value, 0) + COALESCE(p_materials_value, 0);
  IF v_total_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Total value must be greater than 0'::TEXT;
    RETURN;
  END IF;
  -- GET ACCOUNT IDS
  SELECT id INTO v_persediaan_barang_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1310' AND is_active = TRUE LIMIT 1;
  SELECT id INTO v_persediaan_bahan_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1320' AND is_active = TRUE LIMIT 1;
  SELECT id INTO v_laba_ditahan_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '3200' AND is_active = TRUE LIMIT 1;
  IF v_laba_ditahan_id IS NULL THEN
    -- Fallback to Modal Disetor
    SELECT id INTO v_laba_ditahan_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '3100' AND is_active = TRUE LIMIT 1;
  END IF;
  IF v_laba_ditahan_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Laba Ditahan/Modal tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- GENERATE ENTRY NUMBER
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE(
      (SELECT COUNT(*) + 1 FROM journal_entries
       WHERE branch_id = p_branch_id
       AND DATE(created_at) = CURRENT_DATE),
      1
    ))::TEXT, 4, '0')
  INTO v_entry_number;
  -- CREATE JOURNAL ENTRY
  INSERT INTO journal_entries (
    id, branch_id, entry_number, entry_date, description,
    reference_type, reference_id, status, is_voided, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_branch_id, v_entry_number, p_opening_date,
    'Saldo Awal Persediaan',
    'opening', 'INVENTORY-OPENING', 'posted', FALSE, NOW(), NOW()
  ) RETURNING id INTO v_journal_id;
  -- Dr. Persediaan Barang Dagang (if > 0)
  IF p_products_value > 0 AND v_persediaan_barang_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (
      journal_entry_id, account_id, account_code, account_name,
      debit_amount, credit_amount, description, line_number
    ) VALUES (
      v_journal_id, v_persediaan_barang_id, '1310',
      (SELECT name FROM accounts WHERE id = v_persediaan_barang_id),
      p_products_value, 0, 'Saldo awal persediaan barang dagang', v_line_number
    );
    v_line_number := v_line_number + 1;
  END IF;
  -- Dr. Persediaan Bahan Baku (if > 0)
  IF p_materials_value > 0 AND v_persediaan_bahan_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (
      journal_entry_id, account_id, account_code, account_name,
      debit_amount, credit_amount, description, line_number
    ) VALUES (
      v_journal_id, v_persediaan_bahan_id, '1320',
      (SELECT name FROM accounts WHERE id = v_persediaan_bahan_id),
      p_materials_value, 0, 'Saldo awal persediaan bahan baku', v_line_number
    );
    v_line_number := v_line_number + 1;
  END IF;
  -- Cr. Laba Ditahan (penyeimbang)
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_laba_ditahan_id,
    (SELECT code FROM accounts WHERE id = v_laba_ditahan_id),
    (SELECT name FROM accounts WHERE id = v_laba_ditahan_id),
    0, v_total_amount, 'Penyeimbang saldo awal persediaan', v_line_number
  );
  RETURN QUERY SELECT TRUE, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: create_journal_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_journal_atomic(p_branch_id uuid, p_description text, p_reference_type text DEFAULT NULL::text, p_reference_id text DEFAULT NULL::text, p_lines jsonb DEFAULT '[]'::jsonb, p_entry_date date DEFAULT CURRENT_DATE, p_auto_post boolean DEFAULT true, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS TABLE(success boolean, journal_id uuid, entry_number text, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_journal_id UUID := gen_random_uuid();
  v_entry_number TEXT;
  v_total_debit NUMERIC := 0;
  v_total_credit NUMERIC := 0;
  v_line RECORD;
  v_line_number INT := 0;
  v_account_exists BOOLEAN;
BEGIN
  -- Validate branch_id
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 'Branch ID wajib diisi'::TEXT;
    RETURN;
  END IF;

  -- Validate lines
  IF p_lines IS NULL OR jsonb_array_length(p_lines) < 2 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 'Minimal 2 baris jurnal diperlukan'::TEXT;
    RETURN;
  END IF;

  -- Calculate totals and validate accounts
  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(
    account_id TEXT,
    account_code TEXT,
    debit_amount NUMERIC,
    credit_amount NUMERIC,
    description TEXT
  )
  LOOP
    v_total_debit := v_total_debit + COALESCE(v_line.debit_amount, 0);
    v_total_credit := v_total_credit + COALESCE(v_line.credit_amount, 0);

    -- Validate account exists
    IF v_line.account_id IS NOT NULL THEN
      SELECT EXISTS(SELECT 1 FROM accounts WHERE id = v_line.account_id AND branch_id = p_branch_id) INTO v_account_exists;
    ELSIF v_line.account_code IS NOT NULL THEN
      SELECT EXISTS(SELECT 1 FROM accounts WHERE code = v_line.account_code AND branch_id = p_branch_id) INTO v_account_exists;
    ELSE
      v_account_exists := FALSE;
    END IF;

    IF NOT v_account_exists THEN
      RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT,
        format('Akun tidak ditemukan: %s', COALESCE(v_line.account_id, v_line.account_code, 'NULL'))::TEXT;
      RETURN;
    END IF;
  END LOOP;

  -- Validate balance
  IF ABS(v_total_debit - v_total_credit) > 0.01 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT,
      format('Jurnal tidak balance. Debit: %s, Credit: %s', v_total_debit, v_total_credit)::TEXT;
    RETURN;
  END IF;

  -- Generate entry number
  v_entry_number := 'JE-' || TO_CHAR(p_entry_date, 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM()*10000)::TEXT, 4, '0');

  -- Create journal entry
  INSERT INTO journal_entries (
    id,
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    status,
    total_debit,
    total_credit,
    branch_id,
    created_by,
    created_at,
    is_voided
  ) VALUES (
    v_journal_id,
    v_entry_number,
    p_entry_date,
    p_description,
    p_reference_type,
    p_reference_id,
    CASE WHEN p_auto_post THEN 'posted' ELSE 'draft' END,
    v_total_debit,
    v_total_credit,
    p_branch_id,
    p_created_by,
    NOW(),
    FALSE
  );

  -- Create journal lines with account_code and account_name from accounts table
  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(
    account_id TEXT,
    account_code TEXT,
    debit_amount NUMERIC,
    credit_amount NUMERIC,
    description TEXT
  )
  LOOP
    v_line_number := v_line_number + 1;

    INSERT INTO journal_entry_lines (
      journal_entry_id,
      line_number,
      account_id,
      account_code,
      account_name,
      description,
      debit_amount,
      credit_amount
    )
    SELECT
      v_journal_id,
      v_line_number,
      a.id,
      a.code,
      a.name,
      COALESCE(v_line.description, p_description),
      COALESCE(v_line.debit_amount, 0),
      COALESCE(v_line.credit_amount, 0)
    FROM accounts a
    WHERE a.branch_id = p_branch_id
      AND (
        (v_line.account_id IS NOT NULL AND a.id = v_line.account_id)
        OR (v_line.account_id IS NULL AND a.code = v_line.account_code)
      )
    LIMIT 1;
  END LOOP;

  -- Post if auto_post
  IF p_auto_post THEN
    UPDATE journal_entries SET status = 'posted' WHERE id = v_journal_id;
  END IF;

  RETURN QUERY SELECT TRUE, v_journal_id, v_entry_number, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: create_journal_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_journal_atomic(p_branch_id uuid, p_entry_date date, p_description text, p_reference_type text DEFAULT NULL::text, p_reference_id text DEFAULT NULL::text, p_lines jsonb DEFAULT '[]'::jsonb, p_auto_post boolean DEFAULT true)
 RETURNS TABLE(success boolean, journal_id uuid, entry_number text, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_total_debit NUMERIC := 0;
  v_total_credit NUMERIC := 0;
  v_line RECORD;
  v_line_number INTEGER := 0;
  v_period_closed BOOLEAN := FALSE;
BEGIN
  -- ==================== VALIDASI ====================

  -- Validasi branch_id WAJIB
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE AS success, NULL::UUID AS journal_id, NULL::TEXT AS entry_number,
      'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT AS error_message;
    RETURN;
  END IF;

  -- Validasi lines tidak kosong
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RETURN QUERY SELECT FALSE AS success, NULL::UUID AS journal_id, NULL::TEXT AS entry_number,
      'Journal lines are required'::TEXT AS error_message;
    RETURN;
  END IF;

  -- Validasi minimal 2 lines
  IF jsonb_array_length(p_lines) < 2 THEN
    RETURN QUERY SELECT FALSE AS success, NULL::UUID AS journal_id, NULL::TEXT AS entry_number,
      'Minimal 2 journal lines required (double-entry)'::TEXT AS error_message;
    RETURN;
  END IF;

  -- ==================== CEK PERIOD LOCK ====================

  -- Cek apakah periode sudah ditutup
  BEGIN
    SELECT EXISTS (
      SELECT 1 FROM closing_entries
      WHERE branch_id = p_branch_id
        AND closing_type = 'year_end'
        AND status = 'posted'
        AND closing_date >= p_entry_date
    ) INTO v_period_closed;
  EXCEPTION WHEN undefined_table THEN
    v_period_closed := FALSE;
  END;

  IF v_period_closed THEN
    RETURN QUERY SELECT FALSE AS success, NULL::UUID AS journal_id, NULL::TEXT AS entry_number,
      format('Periode %s sudah ditutup. Tidak dapat membuat jurnal.', p_entry_date)::TEXT AS error_message;
    RETURN;
  END IF;

  -- ==================== VALIDASI LINES ====================

  -- Hitung total dan validasi accounts
  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(
    account_id TEXT,
    account_code TEXT,
    debit_amount NUMERIC,
    credit_amount NUMERIC,
    description TEXT
  )
  LOOP
    -- Validasi account exists
    IF v_line.account_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM accounts
        WHERE id = v_line.account_id
          AND branch_id = p_branch_id
          AND is_active = TRUE
      ) THEN
        RETURN QUERY SELECT FALSE AS success, NULL::UUID AS journal_id, NULL::TEXT AS entry_number,
          format('Account ID %s tidak ditemukan di branch ini', v_line.account_id)::TEXT AS error_message;
        RETURN;
      END IF;
    ELSIF v_line.account_code IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM accounts
        WHERE code = v_line.account_code
          AND branch_id = p_branch_id
          AND is_active = TRUE
      ) THEN
         -- Fallback validation for 2140
         IF v_line.account_code = '2140' AND EXISTS (
            SELECT 1 FROM accounts WHERE name ILIKE '%Hutang Barang%' AND branch_id = p_branch_id AND is_active = TRUE
         ) THEN
            -- Valid by fallback
            NULL;
         ELSE
            RETURN QUERY SELECT FALSE AS success, NULL::UUID AS journal_id, NULL::TEXT AS entry_number,
              format('Account code %s tidak ditemukan di branch ini', v_line.account_code)::TEXT AS error_message;
            RETURN;
         END IF;
      END IF;
    ELSE
      RETURN QUERY SELECT FALSE AS success, NULL::UUID AS journal_id, NULL::TEXT AS entry_number,
        'Setiap line harus memiliki account_id atau account_code'::TEXT AS error_message;
      RETURN;
    END IF;

    v_total_debit := v_total_debit + COALESCE(v_line.debit_amount, 0);
    v_total_credit := v_total_credit + COALESCE(v_line.credit_amount, 0);
  END LOOP;

  -- ==================== VALIDASI BALANCE ====================

  IF v_total_debit != v_total_credit THEN
    RETURN QUERY SELECT FALSE AS success, NULL::UUID AS journal_id, NULL::TEXT AS entry_number,
      format('Jurnal tidak balance! Debit: %s, Credit: %s', v_total_debit, v_total_credit)::TEXT AS error_message;
    RETURN;
  END IF;

  IF v_total_debit = 0 THEN
    RETURN QUERY SELECT FALSE AS success, NULL::UUID AS journal_id, NULL::TEXT AS entry_number,
      'Total debit/credit tidak boleh 0'::TEXT AS error_message;
    RETURN;
  END IF;

  -- ==================== GENERATE ENTRY NUMBER ====================

  v_entry_number := 'JE-' || TO_CHAR(p_entry_date, 'YYYYMMDD') || '-' ||
    LPAD((SELECT COUNT(*) + 1 FROM journal_entries
          WHERE branch_id = p_branch_id
          AND DATE(created_at) = DATE(p_entry_date))::TEXT, 4, '0') ||
    LPAD(FLOOR(RANDOM() * 1000)::TEXT, 3, '0');

  -- ==================== CREATE JOURNAL HEADER ====================

  -- Create as draft first (trigger may block lines on posted)
  INSERT INTO journal_entries (
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    branch_id,
    status,
    total_debit,
    total_credit
  ) VALUES (
    v_entry_number,
    p_entry_date,
    p_description,
    p_reference_type,
    p_reference_id,
    p_branch_id,
    'draft',
    v_total_debit,
    v_total_credit
  )
  RETURNING id INTO v_journal_id;

  -- ==================== CREATE JOURNAL LINES ====================

  v_line_number := 0;
  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(
    account_id TEXT,
    account_code TEXT,
    debit_amount NUMERIC,
    credit_amount NUMERIC,
    description TEXT
  )
  LOOP
    v_line_number := v_line_number + 1;

    DECLARE
      v_resolved_id TEXT;
    BEGIN
       IF v_line.account_id IS NOT NULL THEN
          v_resolved_id := v_line.account_id;
       ELSE
          SELECT id INTO v_resolved_id FROM accounts WHERE code = v_line.account_code AND branch_id = p_branch_id LIMIT 1;
          
          -- Fallback
          IF v_resolved_id IS NULL AND v_line.account_code = '2140' THEN
             SELECT id INTO v_resolved_id FROM accounts WHERE name ILIKE '%Hutang Barang%' AND branch_id = p_branch_id LIMIT 1;
          END IF;
       END IF;

       INSERT INTO journal_entry_lines (
         journal_entry_id,
         line_number,
         account_id,
         account_code,
         description,
         debit_amount,
         credit_amount
       ) VALUES (
         v_journal_id,
         v_line_number,
         v_resolved_id,
         COALESCE(v_line.account_code,
           (SELECT code FROM accounts WHERE id = v_resolved_id LIMIT 1)),
         COALESCE(v_line.description, p_description),
         COALESCE(v_line.debit_amount, 0),
         COALESCE(v_line.credit_amount, 0)
       );
    END;
  END LOOP;

  -- ==================== POST JOURNAL ====================

  IF p_auto_post THEN
    UPDATE journal_entries SET status = 'posted' WHERE id = v_journal_id;
  END IF;

  RETURN QUERY SELECT TRUE AS success, v_journal_id AS journal_id, v_entry_number AS entry_number, NULL::TEXT AS error_message;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE AS success, NULL::UUID AS journal_id, NULL::TEXT AS entry_number, SQLERRM::TEXT AS error_message;
END;
$function$
;


-- =====================================================
-- Function: create_manual_cash_in_journal_rpc
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_manual_cash_in_journal_rpc(p_branch_id uuid, p_reference_id text, p_transaction_date date, p_amount numeric, p_description text, p_cash_account_id text)
 RETURNS TABLE(success boolean, journal_id uuid, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_pendapatan_lain_account_id TEXT;  -- Changed to TEXT
BEGIN
  IF p_branch_id IS NULL THEN RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is REQUIRED!'::TEXT; RETURN; END IF;
  IF p_amount <= 0 THEN RETURN QUERY SELECT FALSE, NULL::UUID, 'Amount must be greater than 0'::TEXT; RETURN; END IF;
  IF p_cash_account_id IS NULL THEN RETURN QUERY SELECT FALSE, NULL::UUID, 'Cash account is required'::TEXT; RETURN; END IF;

  SELECT id INTO v_pendapatan_lain_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code IN ('4200', '4900') AND is_active = TRUE ORDER BY code LIMIT 1;

  IF v_pendapatan_lain_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Pendapatan Lain-lain tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  -- GLOBAL SEQUENCE
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE((SELECT COUNT(*) + 1 FROM journal_entries WHERE DATE(created_at) = CURRENT_DATE), 1))::TEXT, 4, '0')
  INTO v_entry_number;

  INSERT INTO journal_entries (
    id, branch_id, entry_number, entry_date, description,
    reference_type, reference_id, status, is_voided, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_branch_id, v_entry_number, p_transaction_date,
    'Kas Masuk: ' || p_description, 'manual', p_reference_id, 'posted', FALSE, NOW(), NOW()
  ) RETURNING id INTO v_journal_id;

  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, p_cash_account_id,
    (SELECT code FROM accounts WHERE id = p_cash_account_id),
    (SELECT name FROM accounts WHERE id = p_cash_account_id),
    p_amount, 0, 'Kas masuk - ' || p_description, 1
  );

  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_pendapatan_lain_account_id,
    (SELECT code FROM accounts WHERE id = v_pendapatan_lain_account_id),
    (SELECT name FROM accounts WHERE id = v_pendapatan_lain_account_id),
    0, p_amount, 'Pendapatan lain-lain', 2
  );

  RETURN QUERY SELECT TRUE, v_journal_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: create_manual_cash_out_journal_rpc
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_manual_cash_out_journal_rpc(p_branch_id uuid, p_reference_id text, p_transaction_date date, p_amount numeric, p_description text, p_cash_account_id text)
 RETURNS TABLE(success boolean, journal_id uuid, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_beban_lain_account_id TEXT;  -- Changed to TEXT
BEGIN
  IF p_branch_id IS NULL THEN RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is REQUIRED!'::TEXT; RETURN; END IF;
  IF p_amount <= 0 THEN RETURN QUERY SELECT FALSE, NULL::UUID, 'Amount must be greater than 0'::TEXT; RETURN; END IF;
  IF p_cash_account_id IS NULL THEN RETURN QUERY SELECT FALSE, NULL::UUID, 'Cash account is required'::TEXT; RETURN; END IF;

  SELECT id INTO v_beban_lain_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code IN ('8100', '6900') AND is_active = TRUE ORDER BY code LIMIT 1;

  IF v_beban_lain_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Beban Lain-lain tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  -- GLOBAL SEQUENCE
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE((SELECT COUNT(*) + 1 FROM journal_entries WHERE DATE(created_at) = CURRENT_DATE), 1))::TEXT, 4, '0')
  INTO v_entry_number;

  INSERT INTO journal_entries (
    id, branch_id, entry_number, entry_date, description,
    reference_type, reference_id, status, is_voided, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_branch_id, v_entry_number, p_transaction_date,
    'Kas Keluar: ' || p_description, 'manual', p_reference_id, 'posted', FALSE, NOW(), NOW()
  ) RETURNING id INTO v_journal_id;

  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_beban_lain_account_id,
    (SELECT code FROM accounts WHERE id = v_beban_lain_account_id),
    (SELECT name FROM accounts WHERE id = v_beban_lain_account_id),
    p_amount, 0, 'Beban lain-lain - ' || p_description, 1
  );

  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, p_cash_account_id,
    (SELECT code FROM accounts WHERE id = p_cash_account_id),
    (SELECT name FROM accounts WHERE id = p_cash_account_id),
    0, p_amount, 'Kas keluar - ' || p_description, 2
  );

  RETURN QUERY SELECT TRUE, v_journal_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: create_material_payment_journal_rpc
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_material_payment_journal_rpc(p_branch_id uuid, p_reference_id text, p_transaction_date date, p_amount numeric, p_material_id uuid, p_material_name text, p_description text, p_cash_account_id text)
 RETURNS TABLE(success boolean, journal_id uuid, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_beban_bahan_account_id TEXT;  -- Changed to TEXT
BEGIN
  IF p_branch_id IS NULL THEN RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is REQUIRED!'::TEXT; RETURN; END IF;
  IF p_amount <= 0 THEN RETURN QUERY SELECT FALSE, NULL::UUID, 'Amount must be greater than 0'::TEXT; RETURN; END IF;
  IF p_cash_account_id IS NULL THEN RETURN QUERY SELECT FALSE, NULL::UUID, 'Cash account is required'::TEXT; RETURN; END IF;

  SELECT id INTO v_beban_bahan_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code IN ('5300', '6300', '6310') AND is_active = TRUE ORDER BY code LIMIT 1;

  IF v_beban_bahan_account_id IS NULL THEN
    SELECT id INTO v_beban_bahan_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '6100' AND is_active = TRUE LIMIT 1;
  END IF;

  IF v_beban_bahan_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Beban Bahan Baku tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  -- GLOBAL SEQUENCE
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE((SELECT COUNT(*) + 1 FROM journal_entries WHERE DATE(created_at) = CURRENT_DATE), 1))::TEXT, 4, '0')
  INTO v_entry_number;

  INSERT INTO journal_entries (
    id, branch_id, entry_number, entry_date, description,
    reference_type, reference_id, status, is_voided, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_branch_id, v_entry_number, p_transaction_date,
    COALESCE(p_description, 'Pembayaran bahan - ' || p_material_name),
    'expense', p_reference_id, 'posted', FALSE, NOW(), NOW()
  ) RETURNING id INTO v_journal_id;

  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_beban_bahan_account_id,
    (SELECT code FROM accounts WHERE id = v_beban_bahan_account_id),
    (SELECT name FROM accounts WHERE id = v_beban_bahan_account_id),
    p_amount, 0, 'Beban bahan - ' || p_material_name, 1
  );

  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, p_cash_account_id,
    (SELECT code FROM accounts WHERE id = p_cash_account_id),
    (SELECT name FROM accounts WHERE id = p_cash_account_id),
    0, p_amount, 'Pembayaran bahan ' || p_material_name, 2
  );

  RETURN QUERY SELECT TRUE, v_journal_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: create_migration_debt_journal_rpc
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_migration_debt_journal_rpc(p_branch_id uuid, p_debt_id text, p_debt_date date, p_amount numeric, p_creditor_name text, p_creditor_type text DEFAULT 'other'::text, p_description text DEFAULT NULL::text)
 RETURNS TABLE(success boolean, journal_id uuid, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_saldo_awal_account_id UUID;
  v_hutang_account_id UUID;
  v_hutang_code TEXT;
BEGIN
  -- VALIDASI
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Amount must be greater than 0'::TEXT;
    RETURN;
  END IF;
  -- GET SALDO AWAL ACCOUNT
  SELECT id INTO v_saldo_awal_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '3100' AND is_active = TRUE LIMIT 1;
  -- GET HUTANG ACCOUNT BASED ON CREDITOR TYPE
  CASE p_creditor_type
    WHEN 'bank' THEN v_hutang_code := '2120';
    WHEN 'supplier' THEN v_hutang_code := '2110';
    ELSE v_hutang_code := '2190';
  END CASE;
  SELECT id INTO v_hutang_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = v_hutang_code AND is_active = TRUE LIMIT 1;
  IF v_hutang_account_id IS NULL THEN
    SELECT id INTO v_hutang_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '2110' AND is_active = TRUE LIMIT 1;
    v_hutang_code := '2110';
  END IF;
  IF v_saldo_awal_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Saldo Awal (3100) tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  IF v_hutang_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Hutang tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- GENERATE ENTRY NUMBER
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE(
      (SELECT COUNT(*) + 1 FROM journal_entries
       WHERE branch_id = p_branch_id
       AND DATE(created_at) = CURRENT_DATE),
      1
    ))::TEXT, 4, '0')
  INTO v_entry_number;
  -- CREATE JOURNAL ENTRY
  INSERT INTO journal_entries (
    id, branch_id, entry_number, entry_date, description,
    reference_type, reference_id, status, is_voided, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_branch_id, v_entry_number, p_debt_date,
    COALESCE(p_description, 'Migrasi hutang dari ' || p_creditor_name),
    'payable', p_debt_id, 'posted', FALSE, NOW(), NOW()
  ) RETURNING id INTO v_journal_id;
  -- Dr. Saldo Awal (penyeimbang)
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_saldo_awal_account_id, '3100',
    (SELECT name FROM accounts WHERE id = v_saldo_awal_account_id),
    p_amount, 0, 'Saldo awal hutang migrasi', 1
  );
  -- Cr. Hutang
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_hutang_account_id, v_hutang_code,
    (SELECT name FROM accounts WHERE id = v_hutang_account_id),
    0, p_amount, 'Hutang migrasi - ' || p_creditor_name, 2
  );
  RETURN QUERY SELECT TRUE, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: create_migration_receivable_journal_rpc
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_migration_receivable_journal_rpc(p_branch_id uuid, p_receivable_id text, p_receivable_date date, p_amount numeric, p_customer_name text, p_description text DEFAULT NULL::text)
 RETURNS TABLE(success boolean, journal_id uuid, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_piutang_account_id UUID;
  v_saldo_awal_account_id UUID;
BEGIN
  -- VALIDASI
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Amount must be greater than 0'::TEXT;
    RETURN;
  END IF;

  -- GET ACCOUNT IDS
  
  -- Try 1210 (Piutang Usaha) then 1130 (Piutang Dagang)
  SELECT id INTO v_piutang_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1210' AND is_active = TRUE LIMIT 1;

  IF v_piutang_account_id IS NULL THEN
    SELECT id INTO v_piutang_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '1130' AND is_active = TRUE LIMIT 1;
  END IF;

  -- Try 3200 (Laba Ditahan) then 3100 (Modal Disetor)
  SELECT id INTO v_saldo_awal_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '3200' AND is_active = TRUE LIMIT 1;

  IF v_saldo_awal_account_id IS NULL THEN
    SELECT id INTO v_saldo_awal_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '3100' AND is_active = TRUE LIMIT 1;
  END IF;

  IF v_piutang_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Piutang Usaha (1210/1130) tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  IF v_saldo_awal_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Saldo Awal (3200/3100) tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  -- GENERATE ENTRY NUMBER
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE(
      (SELECT COUNT(*) + 1 FROM journal_entries
       WHERE branch_id = p_branch_id
       AND DATE(created_at) = CURRENT_DATE),
      1
    ))::TEXT, 4, '0')
  INTO v_entry_number;

  -- CREATE JOURNAL ENTRY
  INSERT INTO journal_entries (
    id, branch_id, entry_number, entry_date, description,
    reference_type, reference_id, status, is_voided, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_branch_id, v_entry_number, p_receivable_date,
    COALESCE(p_description, 'Piutang Migrasi - ' || p_customer_name),
    'receivable', p_receivable_id, 'posted', FALSE, NOW(), NOW()
  ) RETURNING id INTO v_journal_id;

  -- Dr. Piutang Usaha
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_piutang_account_id, 
    (SELECT code FROM accounts WHERE id = v_piutang_account_id),
    (SELECT name FROM accounts WHERE id = v_piutang_account_id),
    p_amount, 0, 'Piutang migrasi - ' || p_customer_name, 1
  );

  -- Cr. Saldo Awal / Laba Ditahan
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_saldo_awal_account_id, 
    (SELECT code FROM accounts WHERE id = v_saldo_awal_account_id),
    (SELECT name FROM accounts WHERE id = v_saldo_awal_account_id),
    0, p_amount, 'Saldo awal piutang migrasi', 2
  );

  RETURN QUERY SELECT TRUE, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: create_receivable_payment_journal_rpc
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_receivable_payment_journal_rpc(p_branch_id uuid, p_transaction_id text, p_payment_date date, p_amount numeric, p_customer_name text DEFAULT 'Pelanggan'::text, p_payment_account_id text DEFAULT NULL::text)
 RETURNS TABLE(success boolean, journal_id uuid, entry_number text, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_kas_account_id TEXT;
  v_piutang_account_id TEXT;
BEGIN
  -- Validate
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 'Branch ID is required'::TEXT;
    RETURN;
  END IF;

  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 'Amount must be positive'::TEXT;
    RETURN;
  END IF;

  -- Get account IDs
  IF p_payment_account_id IS NOT NULL THEN
    v_kas_account_id := p_payment_account_id;
  ELSE
    SELECT id INTO v_kas_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '1110' AND is_active = TRUE LIMIT 1;
  END IF;

  SELECT id INTO v_piutang_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1210' AND is_active = TRUE LIMIT 1;

  IF v_kas_account_id IS NULL OR v_piutang_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 'Required accounts not found'::TEXT;
    RETURN;
  END IF;

  -- Generate entry number (global sequence)
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE(
      (SELECT COUNT(*) + 1 FROM journal_entries
       WHERE DATE(created_at) = CURRENT_DATE),
      1
    ))::TEXT, 4, '0')
  INTO v_entry_number;

  -- Create journal entry header
  INSERT INTO journal_entries (
    branch_id,
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    status,
    is_voided,
    total_debit,
    total_credit,
    created_at,
    updated_at
  ) VALUES (
    p_branch_id,
    v_entry_number,
    p_payment_date,
    'Pembayaran Piutang - ' || p_transaction_id || ' - ' || p_customer_name,
    'receivable_payment', -- FIXED: was 'receivable', now 'receivable_payment'
    p_transaction_id,
    'posted',
    FALSE,
    p_amount,
    p_amount,
    NOW(),
    NOW()
  ) RETURNING id INTO v_journal_id;

  -- Dr. Kas
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_kas_account_id,
    (SELECT name FROM accounts WHERE id = v_kas_account_id),
    p_amount, 0, 'Penerimaan kas pembayaran piutang', 1
  );

  -- Cr. Piutang
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_piutang_account_id,
    (SELECT name FROM accounts WHERE id = v_piutang_account_id),
    0, p_amount, 'Pelunasan piutang usaha', 2
  );

  RETURN QUERY SELECT TRUE, v_journal_id, v_entry_number, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: create_sales_journal_rpc
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_sales_journal_rpc(p_branch_id uuid, p_transaction_id text, p_transaction_date date, p_total_amount numeric, p_paid_amount numeric DEFAULT 0, p_customer_name text DEFAULT 'Umum'::text, p_hpp_amount numeric DEFAULT 0, p_hpp_bonus_amount numeric DEFAULT 0, p_ppn_enabled boolean DEFAULT false, p_ppn_amount numeric DEFAULT 0, p_subtotal numeric DEFAULT 0, p_is_office_sale boolean DEFAULT false, p_payment_account_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(success boolean, journal_id uuid, entry_number text, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_line_number INTEGER := 1;
  v_cash_amount NUMERIC;
  v_credit_amount NUMERIC;
  v_revenue_amount NUMERIC;
  v_total_hpp NUMERIC;
  -- Account IDs
  v_kas_account_id UUID;
  v_piutang_account_id UUID;
  v_pendapatan_account_id UUID;
  v_hpp_account_id UUID;
  v_hpp_bonus_account_id UUID;
  v_persediaan_account_id UUID;
  v_hutang_bd_account_id UUID;
  v_ppn_account_id UUID;
BEGIN
  -- Validate branch
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 'Branch ID is required'::TEXT;
    RETURN;
  END IF;
  -- Calculate amounts
  v_cash_amount := LEAST(p_paid_amount, p_total_amount);
  v_credit_amount := p_total_amount - v_cash_amount;
  v_revenue_amount := CASE WHEN p_ppn_enabled AND p_subtotal > 0 THEN p_subtotal ELSE p_total_amount END;
  v_total_hpp := p_hpp_amount + p_hpp_bonus_amount;
  -- Get account IDs
  -- Kas account (use payment account if specified, otherwise default 1110)
  IF p_payment_account_id IS NOT NULL THEN
    v_kas_account_id := p_payment_account_id;
  ELSE
    SELECT id INTO v_kas_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '1110' AND is_active = TRUE LIMIT 1;
  END IF;
  SELECT id INTO v_piutang_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1210' AND is_active = TRUE LIMIT 1;
  SELECT id INTO v_pendapatan_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '4100' AND is_active = TRUE LIMIT 1;
  SELECT id INTO v_hpp_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '5100' AND is_active = TRUE LIMIT 1;
  SELECT id INTO v_hpp_bonus_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '5210' AND is_active = TRUE LIMIT 1;
  SELECT id INTO v_persediaan_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1310' AND is_active = TRUE LIMIT 1;
  SELECT id INTO v_hutang_bd_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '2140' AND is_active = TRUE LIMIT 1;
  
  -- Fallback for 2140
  IF v_hutang_bd_account_id IS NULL THEN
    SELECT id INTO v_hutang_bd_account_id FROM accounts
    WHERE branch_id = p_branch_id AND name ILIKE '%Hutang Barang%' AND is_active = TRUE LIMIT 1;
  END IF;

  SELECT id INTO v_ppn_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '2130' AND is_active = TRUE LIMIT 1;
  -- Generate entry number
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE(
      (SELECT COUNT(*) + 1 FROM journal_entries
       WHERE branch_id = p_branch_id
       AND DATE(created_at) = CURRENT_DATE),
      1
    ))::TEXT, 4, '0')
  INTO v_entry_number;
  -- Create journal entry header
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
    p_transaction_date,
    'Penjualan ' ||
    CASE
      WHEN v_credit_amount > 0 AND v_cash_amount = 0 THEN 'Kredit'
      WHEN v_credit_amount > 0 AND v_cash_amount > 0 THEN 'Sebagian'
      ELSE 'Tunai'
    END || ' - ' || p_transaction_id || ' - ' || p_customer_name,
    'transaction',
    p_transaction_id,
    'posted',
    FALSE,
    NOW(),
    NOW()
  ) RETURNING id INTO v_journal_id;
  -- Insert journal lines
  -- 1. Dr. Kas (if cash payment)
  IF v_cash_amount > 0 AND v_kas_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (
      journal_entry_id, account_id, account_name,
      debit_amount, credit_amount, description, line_number
    ) VALUES (
      v_journal_id, v_kas_account_id,
      (SELECT name FROM accounts WHERE id = v_kas_account_id),
      v_cash_amount, 0, 'Penerimaan kas penjualan', v_line_number
    );
    v_line_number := v_line_number + 1;
  END IF;
  -- 2. Dr. Piutang (if credit)
  IF v_credit_amount > 0 AND v_piutang_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (
      journal_entry_id, account_id, account_name,
      debit_amount, credit_amount, description, line_number
    ) VALUES (
      v_journal_id, v_piutang_account_id,
      (SELECT name FROM accounts WHERE id = v_piutang_account_id),
      v_credit_amount, 0, 'Piutang usaha', v_line_number
    );
    v_line_number := v_line_number + 1;
  END IF;
  -- 3. Cr. Pendapatan
  IF v_pendapatan_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (
      journal_entry_id, account_id, account_name,
      debit_amount, credit_amount, description, line_number
    ) VALUES (
      v_journal_id, v_pendapatan_account_id,
      (SELECT name FROM accounts WHERE id = v_pendapatan_account_id),
      0, v_revenue_amount, 'Pendapatan penjualan', v_line_number
    );
    v_line_number := v_line_number + 1;
  END IF;
  -- 4. Cr. PPN Keluaran (if PPN enabled)
  IF p_ppn_enabled AND p_ppn_amount > 0 AND v_ppn_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (
      journal_entry_id, account_id, account_name,
      debit_amount, credit_amount, description, line_number
    ) VALUES (
      v_journal_id, v_ppn_account_id,
      (SELECT name FROM accounts WHERE id = v_ppn_account_id),
      0, p_ppn_amount, 'PPN Keluaran', v_line_number
    );
    v_line_number := v_line_number + 1;
  END IF;
  -- 5. Dr. HPP (regular items)
  IF p_hpp_amount > 0 AND v_hpp_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (
      journal_entry_id, account_id, account_name,
      debit_amount, credit_amount, description, line_number
    ) VALUES (
      v_journal_id, v_hpp_account_id,
      (SELECT name FROM accounts WHERE id = v_hpp_account_id),
      p_hpp_amount, 0, 'Harga Pokok Penjualan', v_line_number
    );
    v_line_number := v_line_number + 1;
  END IF;
  -- 6. Dr. HPP Bonus
  IF p_hpp_bonus_amount > 0 AND v_hpp_bonus_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (
      journal_entry_id, account_id, account_name,
      debit_amount, credit_amount, description, line_number
    ) VALUES (
      v_journal_id, v_hpp_bonus_account_id,
      (SELECT name FROM accounts WHERE id = v_hpp_bonus_account_id),
      p_hpp_bonus_amount, 0, 'HPP Bonus/Gratis', v_line_number
    );
    v_line_number := v_line_number + 1;
  END IF;
  -- 7. Cr. Persediaan or Hutang Barang Dagang
  IF v_total_hpp > 0 THEN
    IF p_is_office_sale THEN
      -- Office Sale: Cr. Persediaan (stok langsung berkurang)
      IF v_persediaan_account_id IS NOT NULL THEN
        INSERT INTO journal_entry_lines (
          journal_entry_id, account_id, account_name,
          debit_amount, credit_amount, description, line_number
        ) VALUES (
          v_journal_id, v_persediaan_account_id,
          (SELECT name FROM accounts WHERE id = v_persediaan_account_id),
          0, v_total_hpp, 'Pengurangan persediaan', v_line_number
        );
      END IF;
    ELSE
      -- Non-Office Sale: Cr. Hutang Barang Dagang (kewajiban kirim)
      IF v_hutang_bd_account_id IS NOT NULL THEN
        INSERT INTO journal_entry_lines (
          journal_entry_id, account_id, account_name,
          debit_amount, credit_amount, description, line_number
        ) VALUES (
          v_journal_id, v_hutang_bd_account_id,
          (SELECT name FROM accounts WHERE id = v_hutang_bd_account_id),
          0, v_total_hpp, 'Hutang barang dagang', v_line_number
        );
      END IF;
    END IF;
  END IF;
  RETURN QUERY SELECT TRUE, v_journal_id, v_entry_number, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: create_transfer_journal_rpc
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_transfer_journal_rpc(p_branch_id uuid, p_transfer_id text, p_transfer_date date, p_amount numeric, p_from_account_id text, p_to_account_id text, p_description text DEFAULT NULL::text)
 RETURNS TABLE(success boolean, journal_id uuid, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_from_account RECORD;
  v_to_account RECORD;
BEGIN
  -- VALIDASI
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Amount must be greater than 0'::TEXT;
    RETURN;
  END IF;

  IF p_from_account_id IS NULL OR p_to_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'From and To accounts are required'::TEXT;
    RETURN;
  END IF;

  IF p_from_account_id = p_to_account_id THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Cannot transfer to same account'::TEXT;
    RETURN;
  END IF;

  -- GET ACCOUNT INFO
  SELECT id, code, name INTO v_from_account FROM accounts WHERE id = p_from_account_id;
  SELECT id, code, name INTO v_to_account FROM accounts WHERE id = p_to_account_id;

  IF v_from_account.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun asal tidak ditemukan: ' || p_from_account_id::TEXT;
    RETURN;
  END IF;

  IF v_to_account.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun tujuan tidak ditemukan: ' || p_to_account_id::TEXT;
    RETURN;
  END IF;

  -- GENERATE ENTRY NUMBER (GLOBAL SEQUENCE)
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE(
      (SELECT COUNT(*) + 1 FROM journal_entries
       WHERE DATE(created_at) = CURRENT_DATE),
      1
    ))::TEXT, 4, '0')
  INTO v_entry_number;

  -- CREATE JOURNAL ENTRY
  INSERT INTO journal_entries (
    id, branch_id, entry_number, entry_date, description,
    reference_type, reference_id, status, is_voided, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_branch_id, v_entry_number, p_transfer_date,
    COALESCE(p_description, 'Transfer dari ' || v_from_account.name || ' ke ' || v_to_account.name),
    'transfer', p_transfer_id, 'posted', FALSE, NOW(), NOW()
  ) RETURNING id INTO v_journal_id;

  -- Dr. Akun Tujuan (kas bertambah)
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, p_to_account_id, v_to_account.code, v_to_account.name,
    p_amount, 0, 'Transfer masuk dari ' || v_from_account.name, 1
  );

  -- Cr. Akun Asal (kas berkurang)
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, p_from_account_id, v_from_account.code, v_from_account.name,
    0, p_amount, 'Transfer keluar ke ' || v_to_account.name, 2
  );

  RETURN QUERY SELECT TRUE, v_journal_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: delete_account
-- =====================================================
CREATE OR REPLACE FUNCTION public.delete_account(p_account_id text)
 RETURNS TABLE(success boolean, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_has_transactions BOOLEAN;
  v_has_children BOOLEAN;
BEGIN
  -- Cek Transactions
  SELECT EXISTS (
    SELECT 1 FROM journal_entry_lines WHERE account_id = p_account_id
  ) INTO v_has_transactions;

  IF v_has_transactions THEN
    RETURN QUERY SELECT FALSE, 'Cannot delete account with existing transactions. Deactivate it instead.';
    RETURN;
  END IF;

  -- Cek Children
  SELECT EXISTS (
    SELECT 1 FROM accounts WHERE parent_id = p_account_id
  ) INTO v_has_children;

  IF v_has_children THEN
    RETURN QUERY SELECT FALSE, 'Cannot delete account with sub-accounts';
    RETURN;
  END IF;

  DELETE FROM accounts WHERE id = p_account_id;

  RETURN QUERY SELECT TRUE, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, SQLERRM;
END;
$function$
;


-- =====================================================
-- Function: delete_accounts_payable_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.delete_accounts_payable_atomic(p_payable_id text, p_branch_id uuid)
 RETURNS TABLE(success boolean, journals_voided integer, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_journals_voided INTEGER := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM accounts_payable_payments WHERE accounts_payable_id = p_payable_id) THEN RETURN QUERY SELECT FALSE, 0, 'Ada pembayaran'::TEXT; RETURN; END IF;
  UPDATE journal_entries SET is_voided = TRUE, voided_at = NOW(), voided_reason = 'AP Deleted', status = 'voided' WHERE reference_id = p_payable_id AND reference_type = 'payable' AND branch_id = p_branch_id AND is_voided = FALSE;
  GET DIAGNOSTICS v_journals_voided = ROW_COUNT;
  DELETE FROM accounts_payable WHERE id = p_payable_id AND branch_id = p_branch_id;
  RETURN QUERY SELECT TRUE, v_journals_voided, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN RETURN QUERY SELECT FALSE, 0, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: demo_balance_sheet
-- =====================================================
CREATE OR REPLACE FUNCTION public.demo_balance_sheet()
 RETURNS TABLE(section text, code character varying, account_name text, amount numeric)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  -- ASET
  SELECT 
    'ASET' as section,
    a.code,
    a.name as account_name,
    a.balance as amount
  FROM public.accounts a
  WHERE a.type = 'ASET' 
    AND a.is_header = false
    AND a.is_active = true
    AND a.code IS NOT NULL
  
  UNION ALL
  
  -- KEWAJIBAN
  SELECT 
    'KEWAJIBAN' as section,
    a.code,
    a.name as account_name, 
    a.balance as amount
  FROM public.accounts a
  WHERE a.type = 'KEWAJIBAN'
    AND a.is_header = false
    AND a.is_active = true
    AND a.code IS NOT NULL
    
  UNION ALL
  
  -- MODAL
  SELECT 
    'MODAL' as section,
    a.code,
    a.name as account_name,
    a.balance as amount  
  FROM public.accounts a
  WHERE a.type = 'MODAL'
    AND a.is_header = false
    AND a.is_active = true
    AND a.code IS NOT NULL
    
  ORDER BY section, code;
END;
$function$
;


-- =====================================================
-- Function: demo_show_chart_of_accounts
-- =====================================================
CREATE OR REPLACE FUNCTION public.demo_show_chart_of_accounts()
 RETURNS TABLE(level_indent text, code character varying, account_name text, account_type text, normal_bal character varying, current_balance numeric, is_header_account boolean)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    REPEAT('  ', a.level - 1) || 
    CASE 
      WHEN a.is_header THEN '???? '
      ELSE '???? '
    END as level_indent,
    a.code,
    a.name as account_name,
    a.type as account_type,
    a.normal_balance as normal_bal,
    a.balance as current_balance,
    a.is_header as is_header_account
  FROM public.accounts a
  WHERE a.is_active = true
    AND (a.code IS NOT NULL OR a.id LIKE 'acc-%')
  ORDER BY a.sort_order, a.code;
END;
$function$
;


-- =====================================================
-- Function: demo_trial_balance
-- =====================================================
CREATE OR REPLACE FUNCTION public.demo_trial_balance()
 RETURNS TABLE(code character varying, account_name text, debit_balance numeric, credit_balance numeric)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    a.code,
    a.name as account_name,
    CASE 
      WHEN a.normal_balance = 'DEBIT' AND a.balance >= 0 THEN a.balance
      WHEN a.normal_balance = 'DEBIT' AND a.balance < 0 THEN 0
      WHEN a.normal_balance = 'CREDIT' AND a.balance < 0 THEN ABS(a.balance)
      ELSE 0
    END as debit_balance,
    CASE 
      WHEN a.normal_balance = 'CREDIT' AND a.balance >= 0 THEN a.balance  
      WHEN a.normal_balance = 'CREDIT' AND a.balance < 0 THEN 0
      WHEN a.normal_balance = 'DEBIT' AND a.balance < 0 THEN ABS(a.balance)
      ELSE 0
    END as credit_balance
  FROM public.accounts a
  WHERE a.is_active = true 
    AND a.is_header = false
    AND a.code IS NOT NULL
    AND a.balance != 0
  ORDER BY a.code;
END;
$function$
;


-- =====================================================
-- Function: execute_closing_entry_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.execute_closing_entry_atomic(p_branch_id uuid, p_year integer)
 RETURNS TABLE(success boolean, journal_id uuid, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_total_revenue NUMERIC := 0;
  v_total_expense NUMERIC := 0;
  v_net_income NUMERIC := 0;
  v_laba_ditahan_id TEXT;
  v_ikhtisar_id TEXT;
BEGIN
  -- Validasi
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is required'::TEXT;
    RETURN;
  END IF;
  -- Cek apakah sudah ada closing entry untuk tahun ini
  IF EXISTS (
    SELECT 1 FROM journal_entries 
    WHERE branch_id = p_branch_id 
      AND reference_type = 'closing_entry' 
      AND EXTRACT(YEAR FROM entry_date) = p_year
      AND voided = FALSE
  ) THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, format('Tutup buku tahun %s sudah ada', p_year)::TEXT;
    RETURN;
  END IF;
  -- Get account IDs
  SELECT id INTO v_laba_ditahan_id FROM accounts WHERE code = '3200' AND branch_id = p_branch_id LIMIT 1;
  SELECT id INTO v_ikhtisar_id FROM accounts WHERE code = '3900' AND branch_id = p_branch_id LIMIT 1;
  IF v_laba_ditahan_id IS NULL THEN
    -- Create Laba Ditahan account if not exists
    INSERT INTO accounts (id, code, name, type, category, branch_id)
    VALUES ('acc-3200-' || p_branch_id, '3200', 'Laba Ditahan', 'Equity', 'Laba Ditahan', p_branch_id)
    RETURNING id INTO v_laba_ditahan_id;
  END IF;
  -- Calculate totals from journal_entry_lines for the year
  SELECT 
    COALESCE(SUM(CASE WHEN a.type = 'Revenue' THEN jel.credit - jel.debit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.type = 'Expense' THEN jel.debit - jel.credit ELSE 0 END), 0)
  INTO v_total_revenue, v_total_expense
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounts a ON a.id = jel.account_id
  WHERE je.branch_id = p_branch_id
    AND EXTRACT(YEAR FROM je.entry_date) = p_year
    AND je.status = 'Posted'
    AND je.voided = FALSE
    AND a.type IN ('Revenue', 'Expense');
  v_net_income := v_total_revenue - v_total_expense;
  -- Generate entry number
  v_entry_number := 'CLS-' || p_year || '-' || LPAD(EXTRACT(EPOCH FROM NOW())::BIGINT % 10000::TEXT, 4, '0');
  -- Create closing journal entry
  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, branch_id, created_at
  ) VALUES (
    v_entry_number,
    make_date(p_year, 12, 31),
    format('Jurnal Penutup Tahun %s - Laba Bersih: %s', p_year, v_net_income),
    'closing_entry',
    'CLOSING-' || p_year,
    'Posted',
    p_branch_id,
    NOW()
  ) RETURNING id INTO v_journal_id;
  -- Create journal lines
  IF v_net_income >= 0 THEN
    -- Laba: Dr. Ikhtisar L/R, Cr. Laba Ditahan
    IF v_ikhtisar_id IS NOT NULL THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit) 
      VALUES (v_journal_id, v_ikhtisar_id, v_net_income, 0);
    END IF;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit) 
    VALUES (v_journal_id, v_laba_ditahan_id, 0, v_net_income);
  ELSE
    -- Rugi: Dr. Laba Ditahan, Cr. Ikhtisar L/R
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit) 
    VALUES (v_journal_id, v_laba_ditahan_id, ABS(v_net_income), 0);
    IF v_ikhtisar_id IS NOT NULL THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit) 
      VALUES (v_journal_id, v_ikhtisar_id, 0, ABS(v_net_income));
    END IF;
  END IF;
  RETURN QUERY SELECT TRUE, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: generate_journal_number
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_journal_number()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
    current_year TEXT;
    next_number INTEGER;
    new_entry_number TEXT;
BEGIN
    current_year := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
    -- Get next sequence number for this year
    SELECT COALESCE(MAX(
        CAST(SUBSTRING(entry_number FROM 'JE-' || current_year || '-(\d+)') AS INTEGER)
    ), 0) + 1
    INTO next_number
    FROM public.journal_entries
    WHERE entry_number LIKE 'JE-' || current_year || '-%';
    -- Format: JE-2024-000001
    new_entry_number := 'JE-' || current_year || '-' || LPAD(next_number::TEXT, 6, '0');
    RETURN new_entry_number;
END;
$function$
;


-- =====================================================
-- Function: generate_journal_number
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_journal_number(entry_date date)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  date_str TEXT;
  sequence_num INTEGER;
  journal_number TEXT;
BEGIN
  -- Format: MJE-YYYYMMDD-XXX (Manual Journal Entry)
  date_str := to_char(entry_date, 'YYYYMMDD');
  
  -- Get next sequence for this date
  SELECT COALESCE(MAX(
    CAST(
      SUBSTRING(journal_number FROM 'MJE-\d{8}-(\d+)') AS INTEGER
    )
  ), 0) + 1
  INTO sequence_num
  FROM public.manual_journal_entries
  WHERE journal_number LIKE 'MJE-' || date_str || '-%';
  
  -- Generate journal number
  journal_number := 'MJE-' || date_str || '-' || LPAD(sequence_num::TEXT, 3, '0');
  
  RETURN journal_number;
END;
$function$
;


-- =====================================================
-- Function: get_account_balance
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_account_balance(p_account_id text)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
    v_balance NUMERIC;
    v_account_type TEXT;
    v_total_debit NUMERIC;
    v_total_credit NUMERIC;
BEGIN
    SELECT type INTO v_account_type FROM accounts WHERE id = p_account_id;
    IF NOT FOUND THEN RETURN NULL; END IF;

    SELECT
        COALESCE(SUM(jel.debit_amount), 0),
        COALESCE(SUM(jel.credit_amount), 0)
    INTO v_total_debit, v_total_credit
    FROM journal_entry_lines jel
    INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = p_account_id
      AND je.status = 'posted'
      AND je.is_voided = FALSE;

    IF v_account_type IN ('Aset', 'Beban') THEN
        v_balance := v_total_debit - v_total_credit;
    ELSE
        v_balance := v_total_credit - v_total_debit;
    END IF;

    RETURN v_balance;
END;
$function$
;


-- =====================================================
-- Function: get_account_balance_analysis
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_account_balance_analysis(p_account_id text)
 RETURNS TABLE(account_id text, account_name text, account_type text, current_balance numeric, calculated_balance numeric, difference numeric, transaction_breakdown jsonb, needs_reconciliation boolean)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_account RECORD;
  v_pos_sales NUMERIC := 0;
  v_receivables NUMERIC := 0;
  v_cash_income NUMERIC := 0;
  v_cash_expense NUMERIC := 0;
  v_expenses NUMERIC := 0;
  v_advances NUMERIC := 0;
  v_calculated NUMERIC;
BEGIN
  -- Get account info
  SELECT id, name, COALESCE(account_type, type) as account_type, 
         current_balance, initial_balance
  INTO v_account
  FROM accounts 
  WHERE id = p_account_id;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  -- Calculate POS sales (check if payment_account column exists in transactions)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'transactions' AND column_name = 'payment_account'
  ) THEN
    SELECT COALESCE(SUM(total), 0) INTO v_pos_sales
    FROM transactions 
    WHERE payment_account = p_account_id 
    AND payment_status = 'Lunas';
  END IF;
  -- Calculate receivables payments (if table exists)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'transaction_payments') THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_receivables
    FROM transaction_payments 
    WHERE account_id = p_account_id 
    AND status = 'active';
  END IF;
  -- Calculate cash history
  SELECT 
    COALESCE(SUM(CASE WHEN transaction_type = 'income' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN transaction_type = 'expense' THEN amount ELSE 0 END), 0)
  INTO v_cash_income, v_cash_expense
  FROM cash_history 
  WHERE account_id = p_account_id;
  -- Calculate expenses (if table exists)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'expenses') THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_expenses
    FROM expenses 
    WHERE account_id = p_account_id 
    AND status = 'approved';
  END IF;
  -- Calculate advances (if table exists)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employee_advances') THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_advances
    FROM employee_advances 
    WHERE account_id = p_account_id 
    AND status = 'approved';
  END IF;
  -- Calculate total
  v_calculated := COALESCE(v_account.initial_balance, 0) + v_pos_sales + v_receivables + v_cash_income - v_cash_expense - v_expenses - v_advances;
  RETURN QUERY SELECT 
    p_account_id,
    v_account.name,
    v_account.account_type,
    v_account.current_balance,
    v_calculated,
    (v_account.current_balance - v_calculated),
    json_build_object(
      'initial_balance', COALESCE(v_account.initial_balance, 0),
      'pos_sales', v_pos_sales,
      'receivables_payments', v_receivables,
      'cash_income', v_cash_income,
      'cash_expense', v_cash_expense,
      'expenses', v_expenses,
      'advances', v_advances
    )::JSONB,
    (ABS(v_account.current_balance - v_calculated) > 1000);
END;
$function$
;


-- =====================================================
-- Function: get_account_balance_at_date
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_account_balance_at_date(p_account_id text, p_as_of_date date)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
    v_balance NUMERIC;
    v_account_type TEXT;
    v_total_debit NUMERIC;
    v_total_credit NUMERIC;
BEGIN
    SELECT type INTO v_account_type FROM accounts WHERE id = p_account_id;
    IF NOT FOUND THEN RETURN NULL; END IF;

    SELECT
        COALESCE(SUM(jel.debit_amount), 0),
        COALESCE(SUM(jel.credit_amount), 0)
    INTO v_total_debit, v_total_credit
    FROM journal_entry_lines jel
    INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = p_account_id
      AND je.status = 'posted'
      AND je.is_voided = FALSE
      AND je.entry_date <= p_as_of_date;

    IF v_account_type IN ('Aset', 'Beban') THEN
        v_balance := v_total_debit - v_total_credit;
    ELSE
        v_balance := v_total_credit - v_total_debit;
    END IF;

    RETURN v_balance;
END;
$function$
;


-- =====================================================
-- Function: get_account_balance_with_children
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_account_balance_with_children(account_id text)
 RETURNS numeric
 LANGUAGE plpgsql
AS $function$
DECLARE
  total_balance NUMERIC := 0;
BEGIN
  -- Get sum of all child account balances
  WITH RECURSIVE account_tree AS (
    SELECT id, balance FROM public.accounts WHERE id = account_id
    UNION ALL
    SELECT a.id, a.balance 
    FROM public.accounts a
    JOIN account_tree at ON a.parent_id = at.id
  )
  SELECT COALESCE(SUM(balance), 0) INTO total_balance
  FROM account_tree
  WHERE id != account_id OR NOT EXISTS(
    SELECT 1 FROM public.accounts WHERE parent_id = account_id
  );
  
  RETURN total_balance;
END;
$function$
;


-- =====================================================
-- Function: get_account_opening_balance
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_account_opening_balance(p_account_id text, p_branch_id uuid)
 RETURNS TABLE(opening_balance numeric, journal_id uuid, journal_date date, last_updated timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_account RECORD;
  v_journal_balance NUMERIC;
  v_journal_id UUID;
  v_journal_date DATE;
  v_journal_updated TIMESTAMPTZ;
BEGIN
  -- Get account info
  SELECT id, type, initial_balance, updated_at INTO v_account
  FROM accounts
  WHERE id = p_account_id AND branch_id = p_branch_id;

  IF v_account.id IS NULL THEN
    RETURN QUERY SELECT 0::NUMERIC, NULL::UUID, NULL::DATE, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- Try to get opening balance from journal first (Single Source of Truth)
  SELECT
    CASE
      WHEN v_account.type IN ('Aset', 'Beban') THEN jel.debit_amount
      ELSE jel.credit_amount
    END,
    je.id,
    je.entry_date,
    je.updated_at
  INTO v_journal_balance, v_journal_id, v_journal_date, v_journal_updated
  FROM journal_entries je
  INNER JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
  WHERE je.reference_id = p_account_id
    AND je.reference_type = 'opening_balance'
    AND je.branch_id = p_branch_id
    AND je.is_voided = FALSE
    AND jel.account_id = p_account_id
  ORDER BY je.created_at DESC
  LIMIT 1;

  -- If journal found, return journal data
  IF v_journal_id IS NOT NULL THEN
    RETURN QUERY SELECT v_journal_balance, v_journal_id, v_journal_date, v_journal_updated;
    RETURN;
  END IF;

  -- Fallback: return initial_balance from accounts column (for legacy data)
  IF COALESCE(v_account.initial_balance, 0) != 0 THEN
    RETURN QUERY SELECT v_account.initial_balance, NULL::UUID, NULL::DATE, v_account.updated_at;
    RETURN;
  END IF;

  -- No opening balance found
  RETURN QUERY SELECT 0::NUMERIC, NULL::UUID, NULL::DATE, NULL::TIMESTAMPTZ;
END;
$function$
;


-- =====================================================
-- Function: get_all_accounts_balance_analysis
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_all_accounts_balance_analysis()
 RETURNS TABLE(account_id text, account_name text, account_type text, current_balance numeric, calculated_balance numeric, difference numeric, needs_reconciliation boolean, last_updated timestamp with time zone)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    analysis.account_id,
    analysis.account_name,
    analysis.account_type,
    analysis.current_balance,
    analysis.calculated_balance,
    analysis.difference,
    analysis.needs_reconciliation,
    COALESCE(acc.updated_at, acc.created_at, NOW()) as last_updated
  FROM accounts acc,
  LATERAL get_account_balance_analysis(acc.id) analysis
  ORDER BY ABS(analysis.difference) DESC;
END;
$function$
;


-- =====================================================
-- Function: get_next_journal_number
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_next_journal_number(p_prefix text DEFAULT 'JU'::text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_date_part TEXT;
  v_last_number INTEGER;
  v_new_number TEXT;
BEGIN
  v_date_part := TO_CHAR(NOW(), 'YYMMDD');
  -- Get the last journal number with this prefix and date
  SELECT COALESCE(
    MAX(
      CASE
        WHEN entry_number ~ ('^' || p_prefix || '-' || v_date_part || '-[0-9]+$')
        THEN SUBSTRING(entry_number FROM '[0-9]+$')::INTEGER
        ELSE 0
      END
    ),
    0
  ) INTO v_last_number
  FROM journal_entries
  WHERE entry_number LIKE p_prefix || '-' || v_date_part || '-%';
  v_new_number := p_prefix || '-' || v_date_part || '-' || LPAD((v_last_number + 1)::TEXT, 3, '0');
  RETURN v_new_number;
END;
$function$
;


-- =====================================================
-- Function: import_standard_coa
-- =====================================================
CREATE OR REPLACE FUNCTION public.import_standard_coa(p_branch_id uuid, p_items jsonb)
 RETURNS TABLE(success boolean, imported_count integer, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_item JSONB;
  v_count INTEGER := 0;
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 'Branch ID is required';
    RETURN;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    -- Insert or ignore if code exists (or update?)
    -- Logic similar to useAccounts: upsert based on some key, but here we don't have predictable IDs.
    -- We'll check by code.
    
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE branch_id = p_branch_id AND code = (v_item->>'code')) THEN
       INSERT INTO accounts (
         branch_id,
         name,
         code,
         type,
         level,
         is_header,
         sort_order,
         is_active,
         balance,
         initial_balance,
         created_at,
         updated_at
       ) VALUES (
         p_branch_id,
         v_item->>'name',
         v_item->>'code',
         v_item->>'type',
         (v_item->>'level')::INTEGER,
         (v_item->>'isHeader')::BOOLEAN,
         (v_item->>'sortOrder')::INTEGER,
         TRUE,
         0,
         0,
         NOW(),
         NOW()
       );
       v_count := v_count + 1;
    END IF;
  END LOOP;
  
  -- Second pass for parents? 
  -- Simplified: Assumes hierarchy is handled by codes or manual update later if needed.
  -- Or implemented if 'parentCode' provided.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
     IF (v_item->>'parentCode') IS NOT NULL THEN
        UPDATE accounts child
        SET parent_id = parent.id
        FROM accounts parent
        WHERE child.branch_id = p_branch_id AND child.code = (v_item->>'code')
          AND parent.branch_id = p_branch_id AND parent.code = (v_item->>'parentCode');
     END IF;
  END LOOP;

  RETURN QUERY SELECT TRUE, v_count, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0, SQLERRM;
END;
$function$
;


-- =====================================================
-- Function: insert_journal_entry
-- =====================================================
CREATE OR REPLACE FUNCTION public.insert_journal_entry(p_entry_number text, p_entry_date date, p_description text, p_reference_type text, p_reference_id text DEFAULT NULL::text, p_status text DEFAULT 'draft'::text, p_total_debit numeric DEFAULT 0, p_total_credit numeric DEFAULT 0, p_branch_id uuid DEFAULT NULL::uuid, p_created_by uuid DEFAULT NULL::uuid, p_approved_by uuid DEFAULT NULL::uuid, p_approved_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id uuid, entry_number text, entry_date date, description text, reference_type text, reference_id text, status text, total_debit numeric, total_credit numeric, branch_id uuid, created_by uuid, approved_by uuid, approved_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_id UUID;
BEGIN
  INSERT INTO journal_entries (
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    status,
    total_debit,
    total_credit,
    branch_id,
    created_by,
    approved_by,
    approved_at
  )
  VALUES (
    p_entry_number,
    p_entry_date,
    p_description,
    p_reference_type,
    p_reference_id,
    p_status,
    p_total_debit,
    p_total_credit,
    p_branch_id,
    p_created_by,
    p_approved_by,
    p_approved_at
  )
  RETURNING journal_entries.id INTO new_id;
  RETURN QUERY
  SELECT
    j.id,
    j.entry_number,
    j.entry_date,
    j.description,
    j.reference_type,
    j.reference_id,
    j.status,
    j.total_debit,
    j.total_credit,
    j.branch_id,
    j.created_by,
    j.approved_by,
    j.approved_at,
    j.created_at
  FROM journal_entries j
  WHERE j.id = new_id;
END;
$function$
;


-- =====================================================
-- Function: post_journal_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.post_journal_atomic(p_journal_id uuid, p_branch_id uuid)
 RETURNS TABLE(success boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_journal RECORD;
BEGIN
  SELECT id, status, total_debit, total_credit INTO v_journal
  FROM journal_entries
  WHERE id = p_journal_id AND branch_id = p_branch_id;

  IF v_journal.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Journal entry not found'::TEXT;
    RETURN;
  END IF;

  IF v_journal.status = 'posted' THEN
    RETURN QUERY SELECT TRUE, 'Journal already posted'::TEXT;
    RETURN;
  END IF;

  IF v_journal.total_debit != v_journal.total_credit THEN
    RETURN QUERY SELECT FALSE, 'Journal is not balanced'::TEXT;
    RETURN;
  END IF;

  UPDATE journal_entries
  SET status = 'posted',
      updated_at = NOW()
  WHERE id = p_journal_id;

  RETURN QUERY SELECT TRUE, 'Journal posted successfully'::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: preview_closing_entry
-- =====================================================
CREATE OR REPLACE FUNCTION public.preview_closing_entry(p_branch_id uuid, p_year integer)
 RETURNS TABLE(total_pendapatan numeric, total_beban numeric, laba_rugi_bersih numeric, pendapatan_accounts jsonb, beban_accounts jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_closing_date DATE := (p_year || '-12-31')::DATE;
  v_total_pendapatan NUMERIC := 0;
  v_total_beban NUMERIC := 0;
  v_pendapatan_json JSONB := '[]'::JSONB;
  v_beban_json JSONB := '[]'::JSONB;
  v_acc RECORD;
BEGIN
  -- Pendapatan
  FOR v_acc IN 
    SELECT a.id, a.code, a.name, ABS(SUM(l.debit_amount - l.credit_amount)) as balance
    FROM accounts a
    JOIN journal_entry_lines l ON l.account_id = a.id
    JOIN journal_entries j ON j.id = l.journal_entry_id
    WHERE a.branch_id = p_branch_id 
      AND a.type = 'Pendapatan'
      AND j.status = 'posted' AND j.is_voided = FALSE
      AND j.entry_date BETWEEN (p_year || '-01-01')::DATE AND v_closing_date
    GROUP BY a.id, a.code, a.name
    HAVING SUM(l.debit_amount - l.credit_amount) != 0
  LOOP
    v_total_pendapatan := v_total_pendapatan + v_acc.balance;
    v_pendapatan_json := v_pendapatan_json || jsonb_build_object(
      'id', v_acc.id,
      'code', v_acc.code,
      'name', v_acc.name,
      'balance', v_acc.balance
    );
  END LOOP;
  -- Beban
  FOR v_acc IN 
    SELECT a.id, a.code, a.name, ABS(SUM(l.debit_amount - l.credit_amount)) as balance
    FROM accounts a
    JOIN journal_entry_lines l ON l.account_id = a.id
    JOIN journal_entries j ON j.id = l.journal_entry_id
    WHERE a.branch_id = p_branch_id 
      AND a.type = 'Beban'
      AND j.status = 'posted' AND j.is_voided = FALSE
      AND j.entry_date BETWEEN (p_year || '-01-01')::DATE AND v_closing_date
    GROUP BY a.id, a.code, a.name
    HAVING SUM(l.debit_amount - l.credit_amount) != 0
  LOOP
    v_total_beban := v_total_beban + v_acc.balance;
    v_beban_json := v_beban_json || jsonb_build_object(
      'id', v_acc.id,
      'code', v_acc.code,
      'name', v_acc.name,
      'balance', v_acc.balance
    );
  END LOOP;
  RETURN QUERY SELECT 
    v_total_pendapatan, 
    v_total_beban, 
    v_total_pendapatan - v_total_beban,
    v_pendapatan_json,
    v_beban_json;
END;
$function$
;


-- =====================================================
-- Function: reconcile_account_balance
-- =====================================================
CREATE OR REPLACE FUNCTION public.reconcile_account_balance(p_account_id text, p_new_balance numeric, p_reason text, p_user_id uuid, p_user_name text)
 RETURNS TABLE(success boolean, message text, old_balance numeric, new_balance numeric, adjustment_amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_old_balance NUMERIC;
  v_adjustment NUMERIC;
  v_account_name TEXT;
BEGIN
  -- Check if user is owner
  IF NOT EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = p_user_id AND role = 'owner'
  ) THEN
    RETURN QUERY SELECT 
      false as success,
      'Access denied. Only owners can reconcile account balances.' as message,
      0::NUMERIC as old_balance,
      0::NUMERIC as new_balance,
      0::NUMERIC as adjustment_amount;
    RETURN;
  END IF;
  -- Get current account info
  SELECT current_balance, name INTO v_old_balance, v_account_name
  FROM accounts 
  WHERE id = p_account_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT 
      false as success,
      'Account not found.' as message,
      0::NUMERIC as old_balance,
      0::NUMERIC as new_balance,
      0::NUMERIC as adjustment_amount;
    RETURN;
  END IF;
  -- Calculate adjustment
  v_adjustment := p_new_balance - v_old_balance;
  -- Update account balance
  UPDATE accounts 
  SET 
    current_balance = p_new_balance,
    updated_at = NOW()
  WHERE id = p_account_id;
  -- Log the reconciliation in cash_history table
  INSERT INTO cash_history (
    account_id,
    transaction_type,
    amount,
    description,
    reference_number,
    created_by,
    created_by_name,
    source_type
  ) VALUES (
    p_account_id,
    CASE WHEN v_adjustment >= 0 THEN 'income'::TEXT ELSE 'expense'::TEXT END,
    ABS(v_adjustment),
    COALESCE(p_reason, 'Balance reconciliation by owner'),
    'RECON-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS'),
    p_user_id,
    p_user_name,
    'reconciliation'
  );
  RETURN QUERY SELECT 
    true as success,
    'Account balance successfully reconciled from ' || v_old_balance::TEXT || ' to ' || p_new_balance::TEXT as message,
    v_old_balance as old_balance,
    p_new_balance as new_balance,
    v_adjustment as adjustment_amount;
END;
$function$
;


-- =====================================================
-- Function: set_account_initial_balance
-- =====================================================
CREATE OR REPLACE FUNCTION public.set_account_initial_balance(p_account_id text, p_initial_balance numeric, p_reason text, p_user_id uuid, p_user_name text)
 RETURNS TABLE(success boolean, message text, old_initial_balance numeric, new_initial_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_old_initial NUMERIC;
  v_account_name TEXT;
BEGIN
  -- Check if user is owner
  IF NOT EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = p_user_id AND role = 'owner'
  ) THEN
    RETURN QUERY SELECT 
      false as success,
      'Access denied. Only owners can set initial balances.' as message,
      0::NUMERIC as old_initial_balance,
      0::NUMERIC as new_initial_balance;
    RETURN;
  END IF;
  -- Get current initial balance
  SELECT initial_balance, name INTO v_old_initial, v_account_name
  FROM accounts 
  WHERE id = p_account_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT 
      false as success,
      'Account not found.' as message,
      0::NUMERIC as old_initial_balance,
      0::NUMERIC as new_initial_balance;
    RETURN;
  END IF;
  -- Update initial balance
  UPDATE accounts 
  SET 
    initial_balance = p_initial_balance,
    updated_at = NOW()
  WHERE id = p_account_id;
  -- Log the change in cash_history
  INSERT INTO cash_history (
    account_id,
    transaction_type,
    amount,
    description,
    reference_number,
    created_by,
    created_by_name,
    source_type
  ) VALUES (
    p_account_id,
    'income',
    p_initial_balance,
    'Initial balance set: ' || COALESCE(p_reason, 'Initial balance setup'),
    'INIT-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS'),
    p_user_id,
    p_user_name,
    'initial_balance'
  );
  RETURN QUERY SELECT 
    true as success,
    'Initial balance set for ' || v_account_name || ' from ' || COALESCE(v_old_initial::TEXT, 'null') || ' to ' || p_initial_balance::TEXT as message,
    v_old_initial as old_initial_balance,
    p_initial_balance as new_initial_balance;
END;
$function$
;


-- =====================================================
-- Function: sync_account_balances
-- =====================================================
CREATE OR REPLACE FUNCTION public.sync_account_balances()
 RETURNS TABLE(account_id text, account_code character varying, account_name text, old_balance numeric, new_balance numeric, difference numeric)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    WITH updated AS (
        UPDATE accounts a
        SET balance = vab.calculated_balance,
            updated_at = NOW()
        FROM v_account_balances vab
        WHERE a.id = vab.account_id
          AND ABS(a.balance - vab.calculated_balance) > 0.01
        RETURNING
            a.id, a.code, a.name,
            vab.stored_balance as old_bal,
            vab.calculated_balance as new_bal
    )
    SELECT u.id, u.code, u.name, u.old_bal, u.new_bal, u.new_bal - u.old_bal as diff
    FROM updated u;
END;
$function$
;


-- =====================================================
-- Function: test_balance_reconciliation_functions
-- =====================================================
CREATE OR REPLACE FUNCTION public.test_balance_reconciliation_functions()
 RETURNS TABLE(test_name text, status text, message text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_account_id TEXT;
  v_test_user_id UUID;
BEGIN
  -- Get first account for testing
  SELECT id INTO v_account_id FROM accounts LIMIT 1;
  
  -- Get first owner user for testing
  SELECT id INTO v_test_user_id FROM profiles WHERE role = 'owner' LIMIT 1;
  
  -- Test 1: Check if get_all_accounts_balance_analysis works
  BEGIN
    PERFORM * FROM get_all_accounts_balance_analysis() LIMIT 1;
    RETURN QUERY SELECT 
      'get_all_accounts_balance_analysis' as test_name,
      'SUCCESS' as status,
      'Function exists and executes successfully' as message;
  EXCEPTION WHEN others THEN
    RETURN QUERY SELECT 
      'get_all_accounts_balance_analysis' as test_name,
      'FAILED' as status,
      SQLERRM as message;
  END;
  
  -- Test 2: Check if get_account_balance_analysis works
  IF v_account_id IS NOT NULL THEN
    BEGIN
      PERFORM * FROM get_account_balance_analysis(v_account_id) LIMIT 1;
      RETURN QUERY SELECT 
        'get_account_balance_analysis' as test_name,
        'SUCCESS' as status,
        'Function exists and executes successfully' as message;
    EXCEPTION WHEN others THEN
      RETURN QUERY SELECT 
        'get_account_balance_analysis' as test_name,
        'FAILED' as status,
        SQLERRM as message;
    END;
  END IF;
  
  -- Test 3: Check if balance_adjustments table exists
  BEGIN
    PERFORM 1 FROM balance_adjustments LIMIT 1;
    RETURN QUERY SELECT 
      'balance_adjustments_table' as test_name,
      'SUCCESS' as status,
      'Table exists and accessible' as message;
  EXCEPTION WHEN others THEN
    RETURN QUERY SELECT 
      'balance_adjustments_table' as test_name,
      'FAILED' as status,
      SQLERRM as message;
  END;
  
  -- Test 4: Check if cash_history table exists
  BEGIN
    PERFORM 1 FROM cash_history LIMIT 1;
    RETURN QUERY SELECT 
      'cash_history_table' as test_name,
      'SUCCESS' as status,
      'Table exists and accessible' as message;
  EXCEPTION WHEN others THEN
    RETURN QUERY SELECT 
      'cash_history_table' as test_name,
      'FAILED' as status,
      SQLERRM as message;
  END;
  
END;
$function$
;


-- =====================================================
-- Function: update_account
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_account(p_account_id text, p_branch_id text, p_name text, p_code text, p_type text, p_initial_balance numeric, p_is_payment_account boolean, p_parent_id text, p_level integer, p_is_header boolean, p_is_active boolean, p_sort_order integer, p_employee_id text)
 RETURNS TABLE(success boolean, account_id text, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_code_exists BOOLEAN;
  v_current_code TEXT;
BEGIN
  -- Validasi Branch (untuk security check, pastikan akun milik branch yg benar)
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = p_account_id AND (branch_id = p_branch_id::UUID OR branch_id IS NULL)) THEN
     RETURN QUERY SELECT FALSE, NULL::TEXT, 'Account not found or access denied';
     RETURN;
  END IF;

  -- Get current code
  SELECT code INTO v_current_code FROM accounts WHERE id = p_account_id;

  -- Validasi Kode Unik (jika berubah)
  IF p_code IS NOT NULL AND p_code != '' AND (v_current_code IS NULL OR p_code != v_current_code) THEN
    SELECT EXISTS (
      SELECT 1 FROM accounts 
      WHERE code = p_code AND branch_id = p_branch_id::UUID AND id != p_account_id AND is_active = TRUE
    ) INTO v_code_exists;
    
    IF v_code_exists THEN
      RETURN QUERY SELECT FALSE, NULL::TEXT, 'Account code already exists in this branch';
      RETURN;
    END IF;
  END IF;

  UPDATE accounts
  SET
    name = COALESCE(p_name, name),
    code = NULLIF(p_code, ''),
    type = COALESCE(p_type, type),
    initial_balance = COALESCE(p_initial_balance, initial_balance),
    is_payment_account = COALESCE(p_is_payment_account, is_payment_account),
    parent_id = p_parent_id, -- No cast
    level = COALESCE(p_level, level),
    is_header = COALESCE(p_is_header, is_header),
    is_active = COALESCE(p_is_active, is_active),
    sort_order = COALESCE(p_sort_order, sort_order),
    employee_id = CASE WHEN p_employee_id = '' THEN NULL ELSE p_employee_id::UUID END,
    updated_at = NOW()
  WHERE id = p_account_id;

  RETURN QUERY SELECT TRUE, p_account_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::TEXT, SQLERRM;
END;
$function$
;


-- =====================================================
-- Function: update_account_balance_from_journal
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_account_balance_from_journal()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    line_record RECORD;
    account_record RECORD;
    balance_change NUMERIC;
    is_debit_normal BOOLEAN;
BEGIN
    -- Hanya proses jika status berubah ke 'posted'
    IF NEW.status = 'posted' AND (OLD.status IS NULL OR OLD.status != 'posted') THEN
        FOR line_record IN
            SELECT * FROM public.journal_entry_lines
            WHERE journal_entry_id = NEW.id
        LOOP
            SELECT * INTO account_record
            FROM public.accounts
            WHERE id = line_record.account_id;
            -- Determine if account has debit normal balance based on type
            is_debit_normal := account_record.type IN ('Aset', 'Beban');
            IF is_debit_normal THEN
                balance_change := line_record.debit_amount - line_record.credit_amount;
            ELSE
                balance_change := line_record.credit_amount - line_record.debit_amount;
            END IF;
            UPDATE public.accounts
            SET balance = COALESCE(balance, 0) + balance_change,
                updated_at = NOW()
            WHERE id = line_record.account_id;
        END LOOP;
    END IF;
    -- Handle voiding: reverse all balance changes
    IF NEW.is_voided = TRUE AND (OLD.is_voided IS NULL OR OLD.is_voided = FALSE) THEN
        FOR line_record IN
            SELECT * FROM public.journal_entry_lines
            WHERE journal_entry_id = NEW.id
        LOOP
            SELECT * INTO account_record
            FROM public.accounts
            WHERE id = line_record.account_id;
            is_debit_normal := account_record.type IN ('Aset', 'Beban');
            IF is_debit_normal THEN
                balance_change := line_record.credit_amount - line_record.debit_amount;
            ELSE
                balance_change := line_record.debit_amount - line_record.credit_amount;
            END IF;
            UPDATE public.accounts
            SET balance = COALESCE(balance, 0) + balance_change,
                updated_at = NOW()
            WHERE id = line_record.account_id;
        END LOOP;
    END IF;
    RETURN NEW;
END;
$function$
;


-- =====================================================
-- Function: update_account_initial_balance_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_account_initial_balance_atomic(p_account_id text, p_new_initial_balance numeric, p_branch_id uuid, p_user_id uuid DEFAULT NULL::uuid, p_user_name text DEFAULT 'System'::text)
 RETURNS TABLE(success boolean, journal_id uuid, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_account RECORD;
  v_old_journal_id UUID;
  v_new_journal_id UUID;
  v_entry_number TEXT;
  v_current_journal_amount NUMERIC;
  v_equity_account_id TEXT;
  v_description TEXT;
BEGIN
  -- 1. Validate inputs
  IF p_account_id IS NULL OR p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Account ID and Branch ID are required'::TEXT;
    RETURN;
  END IF;

  -- 2. Get account info
  SELECT id, code, name, type INTO v_account
  FROM accounts
  WHERE id = p_account_id AND branch_id = p_branch_id;

  IF v_account.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Account not found'::TEXT;
    RETURN;
  END IF;

  -- 3. Cek jurnal saldo awal existing
  SELECT je.id, je.total_debit INTO v_old_journal_id, v_current_journal_amount
  FROM journal_entries je
  WHERE je.reference_id = p_account_id
    AND je.reference_type = 'opening_balance'
    AND je.branch_id = p_branch_id
    AND je.is_voided = FALSE
  ORDER BY je.created_at DESC
  LIMIT 1;

  v_current_journal_amount := COALESCE(v_current_journal_amount, 0);

  -- No change needed if journal amount equals new balance
  IF v_old_journal_id IS NOT NULL AND v_current_journal_amount = ABS(p_new_initial_balance) THEN
    RETURN QUERY SELECT TRUE, v_old_journal_id, NULL::TEXT;
    RETURN;
  END IF;

  -- 4. VOID existing opening balance journal (audit trail)
  IF v_old_journal_id IS NOT NULL THEN
    UPDATE journal_entries
    SET is_voided = TRUE,
        voided_at = NOW(),
        voided_by = p_user_id,
        updated_at = NOW()
    WHERE id = v_old_journal_id;
  END IF;

  -- 5. Handle saldo awal = 0: just void, don't create new journal
  IF p_new_initial_balance = 0 THEN
    RETURN QUERY SELECT TRUE, NULL::UUID, NULL::TEXT;
    RETURN;
  END IF;


  -- 6. Find equity/modal account for balancing (3xxx)
  -- Priority 1: 'Modal Disetor'
  SELECT id INTO v_equity_account_id
  FROM accounts
  WHERE code LIKE '3%' 
    AND branch_id = p_branch_id 
    AND is_active = TRUE
    AND name ILIKE '%Modal Disetor%'
  LIMIT 1;

  -- Priority 2: Code '3110' (Common standard)
  IF v_equity_account_id IS NULL THEN
    SELECT id INTO v_equity_account_id
    FROM accounts
    WHERE code = '3110'
      AND branch_id = p_branch_id 
      AND is_active = TRUE
    LIMIT 1;
  END IF;

  -- Priority 3: Any Equity account
  IF v_equity_account_id IS NULL THEN
    SELECT id INTO v_equity_account_id
    FROM accounts
    WHERE code LIKE '3%' 
      AND branch_id = p_branch_id 
      AND is_active = TRUE
    ORDER BY code ASC
    LIMIT 1;
  END IF;

  IF v_equity_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Modal (3xxx) tidak ditemukan untuk pasangan jurnal'::TEXT;
    RETURN;
  END IF;

  -- Prevent self-reference for equity accounts
  IF p_account_id = v_equity_account_id THEN
    SELECT id INTO v_equity_account_id
    FROM accounts
    WHERE code LIKE '3%'
      AND branch_id = p_branch_id
      AND is_active = TRUE
      AND id != p_account_id
    ORDER BY code ASC
    LIMIT 1;

    IF v_equity_account_id IS NULL THEN
      RETURN QUERY SELECT FALSE, NULL::UUID, 'Tidak ada akun Modal lain untuk pasangan jurnal saldo awal Modal'::TEXT;
      RETURN;
    END IF;
  END IF;

  v_description := format('Saldo Awal: %s - %s', v_account.code, v_account.name);

  -- 7. Create NEW journal (always new, for audit trail)
  v_entry_number := 'OB-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 1000)::TEXT, 3, '0');

  INSERT INTO journal_entries (
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    branch_id,
    status,
    total_debit,
    total_credit,
    created_by
  ) VALUES (
    v_entry_number,
    DATE_TRUNC('year', NOW())::DATE,
    v_description,
    'opening_balance',
    p_account_id,
    p_branch_id,
    'draft',
    ABS(p_new_initial_balance),
    ABS(p_new_initial_balance),
    p_user_id
  ) RETURNING id INTO v_new_journal_id;

  -- 8. Create journal lines based on account type
  IF v_account.type IN ('Aset', 'Beban') THEN
    INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, description, debit_amount, credit_amount)
    VALUES
      (v_new_journal_id, 1, p_account_id, v_description, ABS(p_new_initial_balance), 0),
      (v_new_journal_id, 2, v_equity_account_id, v_description, 0, ABS(p_new_initial_balance));
  ELSE
    INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, description, debit_amount, credit_amount)
    VALUES
      (v_new_journal_id, 1, p_account_id, v_description, 0, ABS(p_new_initial_balance)),
      (v_new_journal_id, 2, v_equity_account_id, v_description, ABS(p_new_initial_balance), 0);
  END IF;

  -- 9. Post the journal
  UPDATE journal_entries SET status = 'posted' WHERE id = v_new_journal_id;

  -- 10. UPDATE accounts column (CACHE for Tree/List View)
  UPDATE accounts 
  SET initial_balance = p_new_initial_balance,
      updated_at = NOW()
  WHERE id = p_account_id;

  RETURN QUERY SELECT TRUE, v_new_journal_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: validate_journal_balance
-- =====================================================
CREATE OR REPLACE FUNCTION public.validate_journal_balance(journal_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
DECLARE
  total_debits NUMERIC;
  total_credits NUMERIC;
BEGIN
  -- Calculate total debits and credits
  SELECT 
    COALESCE(SUM(debit_amount), 0),
    COALESCE(SUM(credit_amount), 0)
  INTO total_debits, total_credits
  FROM public.manual_journal_entry_lines
  WHERE journal_id = validate_journal_balance.journal_id;
  
  -- Return true if balanced (difference less than 0.01 for rounding)
  RETURN ABS(total_debits - total_credits) < 0.01;
END;
$function$
;


-- =====================================================
-- Function: validate_journal_entry
-- =====================================================
CREATE OR REPLACE FUNCTION public.validate_journal_entry(p_journal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
    total_dr NUMERIC;
    total_cr NUMERIC;
    line_count INTEGER;
    result JSONB;
BEGIN
    -- Get totals
    SELECT
        COALESCE(SUM(debit_amount), 0),
        COALESCE(SUM(credit_amount), 0),
        COUNT(*)
    INTO total_dr, total_cr, line_count
    FROM public.journal_entry_lines
    WHERE journal_entry_id = p_journal_id;
    -- Build result
    result := jsonb_build_object(
        'is_valid', (total_dr = total_cr AND total_dr > 0 AND line_count >= 2),
        'total_debit', total_dr,
        'total_credit', total_cr,
        'line_count', line_count,
        'is_balanced', (total_dr = total_cr),
        'has_amount', (total_dr > 0),
        'has_minimum_lines', (line_count >= 2),
        'errors', CASE
            WHEN total_dr != total_cr THEN 'Debit dan Credit tidak seimbang'
            WHEN total_dr = 0 THEN 'Jumlah transaksi harus lebih dari 0'
            WHEN line_count < 2 THEN 'Minimal harus ada 2 baris jurnal'
            ELSE NULL
        END
    );
    RETURN result;
END;
$function$
;


-- =====================================================
-- Function: void_closing_entry_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.void_closing_entry_atomic(p_branch_id uuid, p_year integer)
 RETURNS TABLE(success boolean, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_journal_id UUID;
BEGIN
  -- 1. Ambil data closing
  SELECT journal_entry_id INTO v_journal_id
  FROM closing_periods
  WHERE year = p_year AND branch_id = p_branch_id;
  IF v_journal_id IS NULL THEN
    RETURN QUERY SELECT FALSE, format('Tidak ada tutup buku untuk tahun %s', p_year)::TEXT;
    RETURN;
  END IF;
  -- 2. Cek apakah ada transaksi di tahun berikutnya (Opsional, tapi bagus untuk kontrol)
  -- Untuk saat ini kita biarkan void selama journal belum di-audit/lock manual
  
  -- 3. Void Journal
  UPDATE journal_entries
  SET is_voided = TRUE, status = 'voided', voided_reason = format('Pembatalan tutup buku tahun %s', p_year)
  WHERE id = v_journal_id;
  -- 4. Hapus Closing Period
  DELETE FROM closing_periods WHERE year = p_year AND branch_id = p_branch_id;
  RETURN QUERY SELECT TRUE, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: void_journal_by_reference
-- =====================================================
CREATE OR REPLACE FUNCTION public.void_journal_by_reference(p_reference_id text, p_reference_type text, p_user_id uuid DEFAULT NULL::uuid, p_user_name text DEFAULT NULL::text, p_reason text DEFAULT 'Cancelled'::text)
 RETURNS TABLE(success boolean, journals_voided integer, message text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_count INTEGER := 0;
BEGIN
  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_by = p_user_id,
    voided_by_name = COALESCE(p_user_name, 'System'),
    void_reason = p_reason,
    status = 'voided'
  WHERE reference_id = p_reference_id
    AND reference_type = p_reference_type
    AND (is_voided = FALSE OR is_voided IS NULL);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 THEN
    RETURN QUERY SELECT TRUE, v_count, format('Voided %s journal(s) for %s: %s', v_count, p_reference_type, p_reference_id)::TEXT;
  ELSE
    RETURN QUERY SELECT FALSE, 0, format('No journals found for %s: %s', p_reference_type, p_reference_id)::TEXT;
  END IF;
END;
$function$
;


-- =====================================================
-- Function: void_journal_entry
-- =====================================================
CREATE OR REPLACE FUNCTION public.void_journal_entry(p_journal_id uuid, p_branch_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS TABLE(success boolean, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_journal RECORD;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE,
      'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT;
    RETURN;
  END IF;

  IF p_journal_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Journal ID is required'::TEXT;
    RETURN;
  END IF;

  -- Get journal
  SELECT * INTO v_journal
  FROM journal_entries
  WHERE id = p_journal_id AND branch_id = p_branch_id;

  IF v_journal.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Journal not found in this branch'::TEXT;
    RETURN;
  END IF;

  IF v_journal.is_voided = TRUE THEN
    RETURN QUERY SELECT FALSE, 'Journal already voided'::TEXT;
    RETURN;
  END IF;

  -- ==================== VOID JOURNAL ====================

  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_reason = COALESCE(p_reason, 'Voided via RPC'),
    updated_at = NOW()
  WHERE id = p_journal_id;

  RETURN QUERY SELECT TRUE, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE AS success, SQLERRM::TEXT AS error_message;
END;
$function$
;


