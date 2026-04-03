-- =========================================================================
-- AQUVIT ERP - PRODUCTION PATCH SCRIPT
-- Jalankan seluruh script ini di SQL Editor Supabase VPS Anda
-- Memuat: View Arus Kas Cepat & Perbaikan Hitung FIFO Update Transaksi
-- =========================================================================

-- 1. PEMBUATAN DATABASE VIEW UNTUK ARUS KAS KILAT
CREATE OR REPLACE VIEW public.v_arus_kas_lengkap AS
SELECT 
    jel.id as line_id,
    jel.account_id,
    jel.account_code,
    jel.account_name,
    jel.debit_amount,
    jel.credit_amount,
    jel.description as line_description,
    je.id as journal_id,
    je.entry_number,
    je.entry_date,
    je.description as journal_description,
    je.reference_type,
    je.reference_id,
    je.branch_id,
    je.created_at,
    CASE
        WHEN je.reference_type = 'transaction' THEN COALESCE(t.customer_name, 'Pelanggan')
        WHEN je.reference_type = 'expense' THEN e.description
        WHEN je.reference_type = 'advance' THEN 'Panjar: ' || COALESCE(ea.employee_name, 'Karyawan')
        WHEN je.reference_type = 'payable' THEN 'Hutang: ' || COALESCE(ap.supplier_name, 'Supplier')
        WHEN je.reference_type = 'payroll' THEN 'Gaji'
        WHEN je.reference_type = 'receivable' THEN 'Piutang: ' || COALESCE(t2.customer_name, 'Pelanggan')
        WHEN je.reference_type = 'receivable_payment' THEN 'Bayar Piutang'
        ELSE je.description
    END as reference_name
FROM journal_entry_lines jel
JOIN journal_entries je ON jel.journal_entry_id = je.id
LEFT JOIN transactions t ON je.reference_type = 'transaction' AND je.reference_id = t.id
LEFT JOIN transactions t2 ON je.reference_type = 'receivable' AND je.reference_id = t2.id
LEFT JOIN expenses e ON je.reference_type = 'expense' AND je.reference_id::text = e.id::text
LEFT JOIN employee_advances ea ON je.reference_type = 'advance' AND je.reference_id::text = ea.id::text
LEFT JOIN accounts_payable ap ON je.reference_type = 'payable' AND je.reference_id::text = ap.id::text
WHERE je.status = 'posted' AND je.is_voided = false;

-- Wajib memberikan Izin Akses pada View baru ke Supabase API
GRANT SELECT ON public.v_arus_kas_lengkap TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';

-- =========================================================================

-- 2. PENYEMBUHAN BUG STOK GAIB (FUNGSI EDIT TRANSAKSI ATOMIK + FIFO)
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
  v_new_payment_account_id TEXT;
  v_changes TEXT[] := '{}';
  v_journal_id UUID;
  v_journal_lines JSONB := '[]'::JSONB;
  v_customer_name TEXT;
  v_date DATE;
  v_total_hpp NUMERIC := 0;
  v_fifo_result RECORD;
  
  -- Tambahan untuk FIFO
  v_old_item RECORD;
  v_new_item JSONB;
  v_new_items_in JSONB;
  v_rebuilt_items JSONB := '[]'::JSONB;
  v_product_id UUID;
  v_material_id UUID;
  v_quantity NUMERIC;
  v_item_type TEXT;
  v_item_hpp NUMERIC;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, '{}'::TEXT[], 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  IF p_transaction_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, '{}'::TEXT[], 'Transaction ID is required'::TEXT;
    RETURN;
  END IF;

  SELECT * INTO v_old_transaction FROM transactions WHERE id = p_transaction_id AND branch_id = p_branch_id FOR UPDATE;

  IF v_old_transaction.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, '{}'::TEXT[], 'Transaction not found in this branch'::TEXT;
    RETURN;
  END IF;

  -- Kunci Pengaman: Pesanan yang sudah di-delivery (Non-Laku Kantor) tidak boleh diedit bebas itemnya!
  IF v_old_transaction.is_office_sale = FALSE AND v_old_transaction.delivery_status != 'Pending' THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, '{}'::TEXT[], 'Pesanan Non-Laku Kantor yang sudah dikirim tidak boleh diedit langsung. Edit akan menyebabkan kekacauan gudang. Lakukan retur atau batalkan.'::TEXT;
    RETURN;
  END IF;

  -- ==================== PARSE NEW DATA ====================
  v_new_total := COALESCE((p_transaction->>'total')::NUMERIC, v_old_transaction.total);
  v_new_paid_amount := COALESCE((p_transaction->>'paid_amount')::NUMERIC, v_old_transaction.paid_amount);
  
  v_new_payment_account_id := v_old_transaction.payment_account_id;
  IF p_transaction ? 'payment_account_id' THEN
    IF (p_transaction->>'payment_account_id') IS NULL OR (p_transaction->>'payment_account_id') = '' THEN
      v_new_payment_account_id := NULL;
    ELSE
      v_new_payment_account_id := (p_transaction->>'payment_account_id')::TEXT;
    END IF;
  END IF;

  v_customer_name := COALESCE(p_transaction->>'customer_name', v_old_transaction.customer_name);
  v_date := COALESCE(v_old_transaction.order_date, CURRENT_DATE);
  v_new_items_in := p_transaction->'items';

  -- Mengecek apakah ada perubahan harga atau kas
  IF v_new_total != v_old_transaction.total THEN v_changes := array_append(v_changes, 'total'); END IF;
  IF v_new_paid_amount != v_old_transaction.paid_amount THEN v_changes := array_append(v_changes, 'paid_amount'); END IF;
  IF COALESCE(v_new_payment_account_id::TEXT, '') != COALESCE(v_old_transaction.payment_account_id::TEXT, '') THEN v_changes := array_append(v_changes, 'payment_account_id'); END IF;

  -- ==================== FIFO HPP RECALCULATION & STOCK UPDATE ====================
  -- Cek apakah items berubah (perlu dikalkulasi uang)
  IF v_new_items_in IS NOT NULL AND v_new_items_in::TEXT != v_old_transaction.items::TEXT THEN
    v_changes := array_append(v_changes, 'items');

    -- TAHAP 1: KEMBALIKAN SEMUA STOK LAMA (Restore)
    IF v_old_transaction.is_office_sale THEN
      FOR v_old_item IN 
        SELECT 
          (elem->>'productId')::TEXT as product_id_str,
          (elem->>'quantity')::NUMERIC as quantity,
          (elem->>'productType')::TEXT as product_type
        FROM jsonb_array_elements(v_old_transaction.items) as elem
        WHERE (elem->>'productId') IS NOT NULL
      LOOP
        IF v_old_item.product_type IS NULL OR v_old_item.product_type = 'product' THEN
          PERFORM public.restore_stock_fifo_v2(v_old_item.product_id_str::UUID, v_old_item.quantity, p_transaction_id, 'sale', p_branch_id);
        ELSIF v_old_item.product_type = 'material' THEN
          PERFORM public.restore_material_fifo_v2(v_old_item.product_id_str::UUID, v_old_item.quantity, 0, p_transaction_id, 'sale', p_branch_id);
        END IF;
      END LOOP;
    END IF;

    -- TAHAP 2: POTONG STOK BARU DAN REKALKULASI HPP
    FOR v_new_item IN SELECT * FROM jsonb_array_elements(v_new_items_in) LOOP
      v_product_id := NULL; v_material_id := NULL; v_item_hpp := 0;
      v_quantity := COALESCE((v_new_item->>'quantity')::NUMERIC, 0);
      
      IF (v_new_item->>'productId') LIKE 'material-%' OR (v_new_item->>'productType') = 'material' THEN
        -- Untuk handling prefix material jika ada
        IF (v_new_item->>'productId') LIKE 'material-%' THEN
           v_material_id := SUBSTRING(v_new_item->>'productId' FROM 10)::UUID;
        ELSE
           v_material_id := (v_new_item->>'productId')::UUID;
        END IF;
        v_item_type := 'material';
      ELSE
        v_product_id := (v_new_item->>'productId')::UUID;
        v_item_type := 'product';
      END IF;

      -- Laku Kantor = Potong Fisik Stok
      IF v_old_transaction.is_office_sale AND v_quantity > 0 THEN
        IF v_item_type = 'material' THEN
           SELECT * INTO v_fifo_result FROM consume_material_fifo_v2(v_material_id, v_quantity, p_transaction_id, 'sale', p_branch_id);
           v_item_hpp := COALESCE(v_fifo_result.total_cost, 0);
        ELSE
           SELECT * INTO v_fifo_result FROM consume_stock_fifo_v2(v_product_id, v_quantity, p_transaction_id, 'sale', p_branch_id);
           v_item_hpp := COALESCE(v_fifo_result.total_hpp, 0);
        END IF;
      ELSE
        -- Non-Laku Kantor = Hanya Kalkulasi Bayangan HPP (Stock dipotong saat delivery nanti)
        IF v_item_type = 'product' THEN
           SELECT f.total_hpp INTO v_item_hpp FROM calculate_fifo_cost(v_product_id, p_branch_id, v_quantity) f;
           v_item_hpp := COALESCE(v_item_hpp, COALESCE((v_new_item->>'costPrice')::NUMERIC, 0) * v_quantity);
        ELSE
           v_item_hpp := COALESCE((v_new_item->>'hppAmount')::NUMERIC, 0);
        END IF;
      END IF;

      -- Bangun kembali JSON Item lengkap dengan HPP terbaru yang asli!
      v_rebuilt_items := v_rebuilt_items || jsonb_set(v_new_item, '{hppAmount}', to_jsonb(v_item_hpp));
      v_total_hpp := v_total_hpp + v_item_hpp;
    END LOOP;

  ELSE
    -- Jika items tidak berubah, pakai hpp yang lama
    v_rebuilt_items := v_old_transaction.items;
    SELECT COALESCE(SUM((elem->>'hppAmount')::NUMERIC), 0) INTO v_total_hpp FROM jsonb_array_elements(v_rebuilt_items) AS elem;
  END IF;

  -- ==================== UPDATE TRANSACTION ====================
  UPDATE transactions SET
    total = v_new_total,
    paid_amount = v_new_paid_amount,
    payment_account_id = v_new_payment_account_id,
    payment_status = CASE WHEN v_new_paid_amount >= v_new_total THEN 'Lunas' ELSE 'Belum Lunas' END,
    customer_name = v_customer_name,
    notes = COALESCE(p_transaction->>'notes', notes),
    items = v_rebuilt_items,
    updated_at = NOW()
  WHERE id = p_transaction_id;

  -- ==================== UPDATE JOURNAL IF AMOUNTS CHANGED ====================
  IF 'total' = ANY(v_changes) OR 'paid_amount' = ANY(v_changes) OR 'payment_account_id' = ANY(v_changes) OR 'items' = ANY(v_changes) THEN
    -- Void old journal
    UPDATE journal_entries SET is_voided = TRUE, voided_at = NOW(), voided_reason = 'Transaction updated'
    WHERE reference_type = 'transaction' AND reference_id = p_transaction_id AND branch_id = p_branch_id AND is_voided = FALSE;

    -- Build new journal lines
    v_journal_lines := '[]'::JSONB;

    -- Kas/Piutang Debit
    IF v_new_paid_amount >= v_new_total THEN
      v_journal_lines := v_journal_lines || jsonb_build_object('account_id', v_new_payment_account_id, 'debit_amount', v_new_total, 'credit_amount', 0, 'description', 'Penerimaan kas dari penjualan');
    ELSIF v_new_paid_amount > 0 THEN
      v_journal_lines := v_journal_lines || jsonb_build_object('account_id', v_new_payment_account_id, 'debit_amount', v_new_paid_amount, 'credit_amount', 0, 'description', 'Penerimaan kas dari penjualan');
      v_journal_lines := v_journal_lines || jsonb_build_object('account_code', '1210', 'debit_amount', v_new_total - v_new_paid_amount, 'credit_amount', 0, 'description', 'Piutang usaha');
    ELSE
      v_journal_lines := v_journal_lines || jsonb_build_object('account_code', '1210', 'debit_amount', v_new_total, 'credit_amount', 0, 'description', 'Piutang usaha');
    END IF;

    -- Pendapatan Kredit
    v_journal_lines := v_journal_lines || jsonb_build_object('account_code', '4100', 'debit_amount', 0, 'credit_amount', v_new_total, 'description', 'Pendapatan penjualan');

    -- HPP
    IF v_total_hpp > 0 THEN
      v_journal_lines := v_journal_lines || jsonb_build_object('account_code', '5100', 'debit_amount', v_total_hpp, 'credit_amount', 0, 'description', 'Harga Pokok Penjualan');
      IF COALESCE(v_old_transaction.is_office_sale, FALSE) = TRUE THEN
        v_journal_lines := v_journal_lines || jsonb_build_object('account_code', '1310', 'debit_amount', 0, 'credit_amount', v_total_hpp, 'description', 'Pengurangan persediaan');
      ELSE
        v_journal_lines := v_journal_lines || jsonb_build_object('account_code', '2140', 'debit_amount', 0, 'credit_amount', v_total_hpp, 'description', 'Modal barang dagang tertahan');
      END IF;
    END IF;

    -- Create new journal
    SELECT * INTO v_fifo_result FROM create_journal_atomic(
      p_branch_id, v_date, 'Penjualan ke ' || COALESCE(v_customer_name, 'Umum') || ' - ' || p_transaction_id || ' (Updated)',
      'transaction', p_transaction_id, v_journal_lines, TRUE
    );

    IF v_fifo_result.success THEN v_journal_id := v_fifo_result.journal_id; END IF;
    v_changes := array_append(v_changes, 'journal_updated');
  END IF;

  RETURN QUERY SELECT TRUE, p_transaction_id, v_journal_id, v_changes, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, '{}'::TEXT[], SQLERRM::TEXT;
END;
$function$;
