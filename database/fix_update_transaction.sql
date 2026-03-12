-- =====================================================
-- FIX: update_transaction_atomic v4
-- Opsi B: Edit In-Place + Penandaan jurnal yang diedit
-- UPDATE: Juga update sales person di commission_entries
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_transaction_atomic(
  p_transaction_id text,
  p_transaction jsonb,
  p_branch_id uuid,
  p_user_id uuid DEFAULT NULL::uuid,
  p_user_name text DEFAULT NULL::text
) RETURNS TABLE(success boolean, transaction_id text, journal_id uuid, changes_made text[], error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_old_transaction RECORD;
  v_new_total NUMERIC;
  v_new_paid_amount NUMERIC;
  v_new_subtotal NUMERIC;
  v_new_customer_id UUID;
  v_new_customer_name TEXT;
  v_new_payment_account_id TEXT;
  v_new_sales_id UUID;
  v_new_sales_name TEXT;
  v_new_order_date TIMESTAMPTZ;
  v_new_due_date TIMESTAMPTZ;
  v_new_items JSONB;
  v_new_ppn_enabled BOOLEAN;
  v_new_ppn_mode TEXT;
  v_new_ppn_percentage NUMERIC;
  v_new_ppn_amount NUMERIC;
  v_new_is_office_sale BOOLEAN;
  v_new_notes TEXT;
  v_changes TEXT[] := '{}';
  v_journal_id UUID;
  v_date DATE;
  v_total_hpp NUMERIC := 0;
  v_total_hpp_bonus NUMERIC := 0;

  -- Account IDs
  v_piutang_account_id TEXT;
  v_pendapatan_account_id TEXT;
  v_hpp_account_id TEXT;
  v_hpp_bonus_account_id TEXT;
  v_persediaan_account_id TEXT;
  v_modal_tertahan_account_id TEXT;

  -- Journal edit in-place
  v_existing_journal_id UUID;
  v_line_number INTEGER;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, '{}'::TEXT[],
      'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  IF p_transaction_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, '{}'::TEXT[],
      'Transaction ID is required'::TEXT;
    RETURN;
  END IF;

  -- Get existing transaction
  SELECT * INTO v_old_transaction
  FROM transactions
  WHERE id = p_transaction_id AND branch_id = p_branch_id;

  IF v_old_transaction.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, '{}'::TEXT[],
      'Transaction not found in this branch'::TEXT;
    RETURN;
  END IF;

  -- ==================== RESOLVE ACCOUNT IDs ====================

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

  SELECT id INTO v_modal_tertahan_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '2140' AND is_active = TRUE LIMIT 1;

  IF v_modal_tertahan_account_id IS NULL THEN
    SELECT id INTO v_modal_tertahan_account_id FROM accounts
    WHERE branch_id = p_branch_id AND name ILIKE '%Hutang Barang%' AND is_active = TRUE LIMIT 1;
  END IF;

  -- ==================== PARSE NEW DATA ====================

  v_new_total := COALESCE((p_transaction->>'total')::NUMERIC, v_old_transaction.total);
  v_new_paid_amount := COALESCE((p_transaction->>'paid_amount')::NUMERIC, COALESCE(v_old_transaction.paid_amount, 0));
  v_new_subtotal := COALESCE((p_transaction->>'subtotal')::NUMERIC, v_old_transaction.subtotal);
  v_new_customer_id := COALESCE((p_transaction->>'customer_id')::UUID, v_old_transaction.customer_id);
  v_new_customer_name := COALESCE(p_transaction->>'customer_name', v_old_transaction.customer_name);
  v_new_payment_account_id := COALESCE(
    NULLIF(p_transaction->>'payment_account_id', ''),
    v_old_transaction.payment_account_id
  );
  v_new_sales_id := CASE
    WHEN p_transaction ? 'sales_id' THEN (p_transaction->>'sales_id')::UUID
    ELSE v_old_transaction.sales_id
  END;
  v_new_sales_name := CASE
    WHEN p_transaction ? 'sales_name' THEN p_transaction->>'sales_name'
    ELSE v_old_transaction.sales_name
  END;
  v_new_order_date := CASE
    WHEN p_transaction->>'order_date' IS NOT NULL THEN (p_transaction->>'order_date')::TIMESTAMPTZ
    ELSE v_old_transaction.order_date
  END;
  v_new_due_date := CASE
    WHEN p_transaction ? 'due_date' THEN
      CASE WHEN p_transaction->>'due_date' IS NOT NULL AND p_transaction->>'due_date' != ''
        THEN (p_transaction->>'due_date')::TIMESTAMPTZ
        ELSE NULL
      END
    ELSE v_old_transaction.due_date
  END;
  v_new_items := CASE
    WHEN p_transaction->'items' IS NOT NULL AND jsonb_typeof(p_transaction->'items') = 'array'
      THEN p_transaction->'items'
    ELSE v_old_transaction.items
  END;
  v_new_ppn_enabled := COALESCE((p_transaction->>'ppn_enabled')::BOOLEAN, v_old_transaction.ppn_enabled);
  v_new_ppn_mode := COALESCE(p_transaction->>'ppn_mode', v_old_transaction.ppn_mode);
  v_new_ppn_percentage := COALESCE((p_transaction->>'ppn_percentage')::NUMERIC, v_old_transaction.ppn_percentage);
  v_new_ppn_amount := COALESCE((p_transaction->>'ppn_amount')::NUMERIC, v_old_transaction.ppn_amount);
  v_new_is_office_sale := COALESCE((p_transaction->>'is_office_sale')::BOOLEAN, v_old_transaction.is_office_sale);
  v_new_notes := COALESCE(p_transaction->>'notes', v_old_transaction.notes);
  v_date := COALESCE(v_new_order_date::DATE, CURRENT_DATE);

  -- Detect changes
  IF v_new_total != v_old_transaction.total THEN
    v_changes := array_append(v_changes, 'total');
  END IF;
  IF v_new_paid_amount != COALESCE(v_old_transaction.paid_amount, 0) THEN
    v_changes := array_append(v_changes, 'paid_amount');
  END IF;
  IF v_new_customer_name != v_old_transaction.customer_name THEN
    v_changes := array_append(v_changes, 'customer_name');
  END IF;
  IF v_new_items::TEXT != v_old_transaction.items::TEXT THEN
    v_changes := array_append(v_changes, 'items');
  END IF;
  IF COALESCE(v_new_sales_id::TEXT, '') != COALESCE(v_old_transaction.sales_id::TEXT, '') THEN
    v_changes := array_append(v_changes, 'sales');
  END IF;

  -- ==================== UPDATE TRANSACTION (ALL FIELDS) ====================

  UPDATE transactions SET
    total = v_new_total,
    subtotal = v_new_subtotal,
    paid_amount = v_new_paid_amount,
    payment_status = CASE WHEN v_new_paid_amount >= v_new_total THEN 'Lunas' ELSE 'Belum Lunas' END,
    customer_id = v_new_customer_id,
    customer_name = v_new_customer_name,
    payment_account_id = v_new_payment_account_id,
    sales_id = v_new_sales_id,
    sales_name = v_new_sales_name,
    order_date = v_new_order_date,
    due_date = v_new_due_date,
    items = v_new_items,
    ppn_enabled = v_new_ppn_enabled,
    ppn_mode = v_new_ppn_mode,
    ppn_percentage = v_new_ppn_percentage,
    ppn_amount = v_new_ppn_amount,
    is_office_sale = v_new_is_office_sale,
    notes = v_new_notes,
    updated_at = NOW()
  WHERE id = p_transaction_id;

  -- ==================== SYNC SALES TO COMMISSIONS ====================

  IF 'sales' = ANY(v_changes) THEN
    UPDATE commission_entries
    SET
      user_id = v_new_sales_id,
      user_name = v_new_sales_name,
      updated_at = NOW()
    WHERE transaction_id = p_transaction_id
      AND branch_id = p_branch_id
      AND status = 'pending';
    
    v_changes := array_append(v_changes, 'commission_salesman_updated');
  END IF;

  -- ==================== EDIT JOURNAL IN-PLACE ====================

  IF 'total' = ANY(v_changes) OR 'paid_amount' = ANY(v_changes)
     OR 'payment_account' = ANY(v_changes) OR 'items' = ANY(v_changes)
     OR 'is_office_sale' = ANY(v_changes) THEN

    -- Find existing journal
    SELECT id INTO v_existing_journal_id
    FROM journal_entries
    WHERE reference_type = 'transaction'
      AND reference_id = p_transaction_id
      AND branch_id = p_branch_id
      AND is_voided = FALSE
    ORDER BY created_at DESC
    LIMIT 1;

    -- Calculate HPP from new items
    SELECT
      COALESCE(SUM(CASE WHEN COALESCE((item->>'isBonus')::BOOLEAN, FALSE) IS NOT TRUE
        THEN COALESCE((item->>'hppAmount')::NUMERIC, 0) ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN COALESCE((item->>'isBonus')::BOOLEAN, FALSE) IS TRUE
        THEN COALESCE((item->>'hppAmount')::NUMERIC, 0) ELSE 0 END), 0)
    INTO v_total_hpp, v_total_hpp_bonus
    FROM jsonb_array_elements(v_new_items) AS item;

    IF v_existing_journal_id IS NOT NULL THEN
      DELETE FROM journal_entry_lines WHERE journal_entry_id = v_existing_journal_id;
      v_line_number := 0;

      IF v_new_paid_amount >= v_new_total THEN
        v_line_number := v_line_number + 1;
        INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, account_code, account_name, debit_amount, credit_amount, description)
        SELECT v_existing_journal_id, v_line_number, a.id, a.code, a.name, v_new_total, 0, 'Penerimaan kas dari penjualan'
        FROM accounts a WHERE a.id = v_new_payment_account_id;
      ELSIF v_new_paid_amount > 0 THEN
        v_line_number := v_line_number + 1;
        INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, account_code, account_name, debit_amount, credit_amount, description)
        SELECT v_existing_journal_id, v_line_number, a.id, a.code, a.name, v_new_paid_amount, 0, 'Penerimaan kas dari penjualan'
        FROM accounts a WHERE a.id = v_new_payment_account_id;

        v_line_number := v_line_number + 1;
        INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, account_code, account_name, debit_amount, credit_amount, description)
        SELECT v_existing_journal_id, v_line_number, a.id, a.code, a.name, v_new_total - v_new_paid_amount, 0, 'Piutang usaha'
        FROM accounts a WHERE a.id = v_piutang_account_id;
      ELSE
        v_line_number := v_line_number + 1;
        INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, account_code, account_name, debit_amount, credit_amount, description)
        SELECT v_existing_journal_id, v_line_number, a.id, a.code, a.name, v_new_total, 0, 'Piutang usaha'
        FROM accounts a WHERE a.id = v_piutang_account_id;
      END IF;

      v_line_number := v_line_number + 1;
      INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, account_code, account_name, debit_amount, credit_amount, description)
      SELECT v_existing_journal_id, v_line_number, a.id, a.code, a.name, 0, v_new_total, 'Pendapatan penjualan'
      FROM accounts a WHERE a.id = v_pendapatan_account_id;

      IF v_total_hpp > 0 THEN
        v_line_number := v_line_number + 1;
        INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, account_code, account_name, debit_amount, credit_amount, description)
        SELECT v_existing_journal_id, v_line_number, a.id, a.code, a.name, v_total_hpp, 0, 'Harga Pokok Penjualan'
        FROM accounts a WHERE a.id = v_hpp_account_id;
      END IF;

      IF v_total_hpp_bonus > 0 AND v_hpp_bonus_account_id IS NOT NULL THEN
        v_line_number := v_line_number + 1;
        INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, account_code, account_name, debit_amount, credit_amount, description)
        SELECT v_existing_journal_id, v_line_number, a.id, a.code, a.name, v_total_hpp_bonus, 0, 'HPP Bonus/Gratis'
        FROM accounts a WHERE a.id = v_hpp_bonus_account_id;
      END IF;

      IF (v_total_hpp + v_total_hpp_bonus) > 0 THEN
        v_line_number := v_line_number + 1;
        IF v_new_is_office_sale THEN
          INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, account_code, account_name, debit_amount, credit_amount, description)
          SELECT v_existing_journal_id, v_line_number, a.id, a.code, a.name, 0, v_total_hpp + v_total_hpp_bonus, 'Pengurangan persediaan'
          FROM accounts a WHERE a.id = v_persediaan_account_id;
        ELSE
          INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, account_code, account_name, debit_amount, credit_amount, description)
          SELECT v_existing_journal_id, v_line_number, a.id, a.code, a.name, 0, v_total_hpp + v_total_hpp_bonus, 'Modal barang dagang tertahan (belum dikirim)'
          FROM accounts a WHERE a.id = v_modal_tertahan_account_id;
        END IF;
      END IF;

      UPDATE journal_entries SET
        description = 'Penjualan ke ' || COALESCE(v_new_customer_name, 'Umum') || ' - ' || p_transaction_id
          || ' ✏️ Diedit ' || TO_CHAR(NOW(), 'DD/MM/YYYY HH24:MI'),
        entry_date = v_date,
        total_debit = v_new_total + v_total_hpp + v_total_hpp_bonus,
        total_credit = v_new_total + v_total_hpp + v_total_hpp_bonus,
        updated_at = NOW()
      WHERE id = v_existing_journal_id;

      v_journal_id := v_existing_journal_id;
      v_changes := array_append(v_changes, 'journal_edited_in_place');

    ELSE
      -- FALLBACK: Create new journal
      DECLARE
        v_journal_lines JSONB := '[]'::JSONB;
        v_fifo_result RECORD;
      BEGIN
        IF v_new_paid_amount >= v_new_total THEN
          v_journal_lines := v_journal_lines || jsonb_build_object('account_id', v_new_payment_account_id, 'debit_amount', v_new_total, 'credit_amount', 0, 'description', 'Penerimaan kas dari penjualan');
        ELSIF v_new_paid_amount > 0 THEN
          v_journal_lines := v_journal_lines || jsonb_build_object('account_id', v_new_payment_account_id, 'debit_amount', v_new_paid_amount, 'credit_amount', 0, 'description', 'Penerimaan kas dari penjualan');
          v_journal_lines := v_journal_lines || jsonb_build_object('account_id', v_piutang_account_id, 'debit_amount', v_new_total - v_new_paid_amount, 'credit_amount', 0, 'description', 'Piutang usaha');
        ELSE
          v_journal_lines := v_journal_lines || jsonb_build_object('account_id', v_piutang_account_id, 'debit_amount', v_new_total, 'credit_amount', 0, 'description', 'Piutang usaha');
        END IF;

        v_journal_lines := v_journal_lines || jsonb_build_object('account_id', v_pendapatan_account_id, 'debit_amount', 0, 'credit_amount', v_new_total, 'description', 'Pendapatan penjualan');

        IF v_total_hpp > 0 THEN
          v_journal_lines := v_journal_lines || jsonb_build_object('account_id', v_hpp_account_id, 'debit_amount', v_total_hpp, 'credit_amount', 0, 'description', 'Harga Pokok Penjualan');
        END IF;
        IF (v_total_hpp + v_total_hpp_bonus) > 0 THEN
          IF v_new_is_office_sale THEN
            v_journal_lines := v_journal_lines || jsonb_build_object('account_id', v_persediaan_account_id, 'debit_amount', 0, 'credit_amount', v_total_hpp + v_total_hpp_bonus, 'description', 'Pengurangan persediaan');
          ELSE
            v_journal_lines := v_journal_lines || jsonb_build_object('account_id', v_modal_tertahan_account_id, 'debit_amount', 0, 'credit_amount', v_total_hpp + v_total_hpp_bonus, 'description', 'Modal barang dagang tertahan');
          END IF;
        END IF;

        SELECT * INTO v_fifo_result FROM create_journal_atomic(
          p_branch_id, v_date,
          'Penjualan ke ' || COALESCE(v_new_customer_name, 'Umum') || ' - ' || p_transaction_id,
          'transaction', p_transaction_id, v_journal_lines, TRUE
        );

        IF v_fifo_result.success THEN
          v_journal_id := v_fifo_result.journal_id;
        END IF;
        v_changes := array_append(v_changes, 'journal_created_new');
      END;
    END IF;
  END IF;

  RETURN QUERY SELECT TRUE, p_transaction_id, v_journal_id, v_changes, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, '{}'::TEXT[], SQLERRM::TEXT;
END;
$function$;
