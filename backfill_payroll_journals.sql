DO $$
DECLARE
  r RECORD;
  v_journal_id UUID;
  v_entry_number TEXT;
  v_beban_gaji_id TEXT;
  v_panjar_id TEXT;
  v_payment_account_id TEXT;
  v_gross_salary NUMERIC;
  v_desc TEXT;
  v_prefix TEXT;
  v_seq INTEGER;
BEGIN
  -- Iterate over paid payrolls with NO journal
  FOR r IN 
    SELECT 
      pr.*, 
      p.full_name as employee_name
    FROM payroll_records pr
    LEFT JOIN journal_entries je ON je.reference_id = pr.id::TEXT AND je.reference_type = 'payroll'
    LEFT JOIN profiles p ON p.id = pr.employee_id
    WHERE pr.status = 'paid' AND je.id IS NULL
  LOOP
    
    RAISE NOTICE 'Creating missing journal for: % (Period: %)', r.employee_name, r.period_start;

    -- 1. Determine Accounts
    SELECT id::TEXT INTO v_beban_gaji_id FROM accounts 
    WHERE branch_id = r.branch_id AND (code = '6100' OR code = '6110' OR name ILIKE '%Beban Gaji%') LIMIT 1;

    SELECT id::TEXT INTO v_panjar_id FROM accounts 
    WHERE branch_id = r.branch_id AND (code = '1220' OR name ILIKE '%Piutang Karyawan%') LIMIT 1;
    
    SELECT id::TEXT INTO v_payment_account_id FROM accounts 
    WHERE branch_id = r.branch_id AND code = '1110' LIMIT 1;

    IF v_beban_gaji_id IS NULL OR v_payment_account_id IS NULL THEN
      RAISE NOTICE 'Skipping %: Accounts not found', r.employee_name;
      CONTINUE;
    END IF;

    -- 2. Generate Entry Number (Robust matching by prefix)
    v_prefix := 'JE-' || TO_CHAR(r.paid_date, 'YYYYMMDD') || '-';
    
    SELECT COALESCE(MAX(CAST(SUBSTRING(entry_number FROM '-(\d+)$') AS INTEGER)), 0)
    INTO v_seq
    FROM journal_entries 
    WHERE entry_number LIKE v_prefix || '%';

    -- Increment loop to ensure finding a free number
    LOOP
      v_seq := v_seq + 1;
      v_entry_number := v_prefix || LPAD(v_seq::TEXT, 4, '0');
      
      -- Double check if exists (paranoid check)
      IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE entry_number = v_entry_number) THEN
        EXIT; -- Found free number
      END IF;
    END LOOP;

    v_gross_salary := COALESCE(r.base_salary, 0) + COALESCE(r.total_commission, 0) + COALESCE(r.total_bonus, 0);
    v_desc := format('Pembayaran Gaji %s - %s/%s (Susulan)', r.employee_name, EXTRACT(MONTH FROM r.period_start), EXTRACT(YEAR FROM r.period_start));

    -- 3. Insert Journal
    v_journal_id := gen_random_uuid();
    
    INSERT INTO journal_entries (
      id, branch_id, entry_number, entry_date, description, reference_type, reference_id, status, is_voided, created_at, updated_at, total_debit, total_credit
    ) VALUES (
      v_journal_id, r.branch_id, v_entry_number, r.paid_date, v_desc, 'payroll', r.id::TEXT, 'posted', FALSE, NOW(), NOW(), v_gross_salary, v_gross_salary
    );

    -- 4. Lines
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_name, description, debit_amount, credit_amount, line_number)
    VALUES (v_journal_id, v_beban_gaji_id, (SELECT name FROM accounts WHERE id::TEXT = v_beban_gaji_id), 'Beban Gaji ' || r.employee_name, v_gross_salary, 0, 1);

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_name, description, debit_amount, credit_amount, line_number)
    VALUES (v_journal_id, v_payment_account_id, (SELECT name FROM accounts WHERE id::TEXT = v_payment_account_id), 'Pembayaran Gaji via Kas', 0, r.net_salary, 2);

    IF COALESCE(r.advance_deduction, 0) > 0 AND v_panjar_id IS NOT NULL THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_name, description, debit_amount, credit_amount, line_number)
      VALUES (v_journal_id, v_panjar_id, (SELECT name FROM accounts WHERE id::TEXT = v_panjar_id), 'Potongan Panjar', 0, r.advance_deduction, 3);
    END IF;

    IF COALESCE(r.salary_deduction, 0) > 0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_name, description, debit_amount, credit_amount, line_number)
      VALUES (v_journal_id, v_payment_account_id, (SELECT name FROM accounts WHERE id::TEXT = v_payment_account_id), 'Potongan Lainnya', 0, r.salary_deduction, 4);
    END IF;
    
    RAISE NOTICE 'Journal created: %', v_entry_number;

  END LOOP;
END $$;
