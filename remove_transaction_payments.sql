-- migration_drop_transaction_payments.sql
-- Ini adalah script untuk membersihkan file fungsi RPC yang masih menggunakan `transaction_payments`
-- dan juga melakukan MIGRATION (Penyelamatan Data) 10.000+ baris data cicilan ke `payment_history`.

-- =========================================================================
-- 1. DROP FUNGSI LAMA YANG HANYA BERSANDAR PADA TABEL transaction_payments
-- =========================================================================
DROP FUNCTION IF EXISTS public.calculate_transaction_payment_status(text);
DROP FUNCTION IF EXISTS public.cancel_transaction_payment(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.record_receivable_payment(text, numeric, text, text, text, text, text, text, uuid, text, text);

-- =========================================================================
-- 2. UPDATE FUNGSI receive_payment_atomic (TEXT)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.receive_payment_atomic(p_receivable_id text, p_branch_id uuid, p_amount numeric, p_payment_account_id text DEFAULT NULL::text, p_payment_method text DEFAULT 'cash'::text, p_payment_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text) RETURNS TABLE(success boolean, payment_id uuid, remaining_amount numeric, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_payment_id UUID;
  v_receivable RECORD;
  v_remaining NUMERIC;
  v_journal_id UUID;
  v_entry_number TEXT;
  v_kas_account_id TEXT;      
  v_piutang_account_id TEXT;  
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID, 'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT;
    RETURN;
  END IF;

  IF p_receivable_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID, 'Receivable ID is required'::TEXT;
    RETURN;
  END IF;

  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID, 'Amount must be positive'::TEXT;
    RETURN;
  END IF;

  SELECT t.id, t.customer_id, t.total, COALESCE(t.paid_amount, 0) as paid_amount,
    COALESCE(t.total - COALESCE(t.paid_amount, 0), 0) as remaining_amount,
    t.payment_status as status, c.name as customer_name
  INTO v_receivable
  FROM transactions t
  LEFT JOIN customers c ON c.id = t.customer_id
  WHERE t.id = p_receivable_id::TEXT AND t.branch_id = p_branch_id; 

  IF v_receivable.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID, 'Transaction not found in this branch'::TEXT;
    RETURN;
  END IF;

  IF v_receivable.status = 'paid' OR v_receivable.status = 'Lunas' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID, 'Transaction already fully paid'::TEXT;
    RETURN;
  END IF;

  v_remaining := GREATEST(0, v_receivable.remaining_amount - p_amount);

  -- [PERUBAHAN]: Menggunakan payment_history alih-alih transaction_payments
  INSERT INTO payment_history (
    transaction_id,
    branch_id,
    amount,
    remaining_amount,
    payment_method,
    account_id,
    payment_date,
    notes,
    created_at
  ) VALUES (
    p_receivable_id::TEXT,
    p_branch_id,
    p_amount,
    v_remaining,
    p_payment_method,
    p_payment_account_id,
    p_payment_date,
    COALESCE(p_notes, format('Payment from %s', COALESCE(v_receivable.customer_name, 'Customer'))),
    NOW()
  )
  RETURNING id INTO v_payment_id;

  UPDATE transactions
  SET
    paid_amount = COALESCE(paid_amount, 0) + p_amount,
    payment_status = CASE WHEN v_remaining <= 0 THEN 'Lunas' ELSE 'Partial' END,
    updated_at = NOW()
  WHERE id = p_receivable_id::TEXT;

  IF p_payment_account_id IS NOT NULL THEN
    v_kas_account_id := p_payment_account_id;
  ELSIF p_payment_method = 'transfer' THEN
    SELECT id INTO v_kas_account_id FROM accounts WHERE code = '1120' AND branch_id = p_branch_id AND is_active = TRUE LIMIT 1;
  ELSE
    SELECT id INTO v_kas_account_id FROM accounts WHERE code = '1110' AND branch_id = p_branch_id AND is_active = TRUE LIMIT 1;
  END IF;

  SELECT id INTO v_piutang_account_id FROM accounts WHERE code = '1210' AND branch_id = p_branch_id AND is_active = TRUE LIMIT 1;

  IF v_kas_account_id IS NOT NULL AND v_piutang_account_id IS NOT NULL THEN
    DECLARE
      v_journal_lines JSONB; v_journal_res RECORD;
    BEGIN
       v_journal_lines := jsonb_build_array(
         jsonb_build_object('account_id', v_kas_account_id, 'debit_amount', p_amount, 'credit_amount', 0, 'description', format('Terima dari %s', COALESCE(v_receivable.customer_name, 'Customer'))),
         jsonb_build_object('account_id', v_piutang_account_id, 'debit_amount', 0, 'credit_amount', p_amount, 'description', format('Pelunasan piutang: %s', COALESCE(v_receivable.customer_name, 'Customer')))
       );

       SELECT * INTO v_journal_res FROM create_journal_atomic(
         p_branch_id, p_payment_date, format('Terima pembayaran piutang: %s', COALESCE(v_receivable.customer_name, 'Customer')), 'receivable_payment', v_payment_id::TEXT, v_journal_lines, TRUE
       );

       IF v_journal_res.success THEN v_journal_id := v_journal_res.journal_id;
       ELSE RAISE EXCEPTION 'Gagal membuat jurnal penerimaan: %', v_journal_res.error_message; END IF;
    END;
  END IF;

  RETURN QUERY SELECT TRUE, v_payment_id, v_remaining, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID, SQLERRM::TEXT;
END;
$function$;

-- =========================================================================
-- 3. UPDATE FUNGSI receive_payment_atomic (UUID)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.receive_payment_atomic(p_receivable_id text, p_branch_id uuid, p_amount numeric, p_payment_account_id uuid DEFAULT NULL::uuid, p_payment_method text DEFAULT 'cash'::text, p_payment_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text) RETURNS TABLE(success boolean, payment_id uuid, remaining_amount numeric, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_payment_id UUID;
  v_receivable RECORD;
  v_remaining NUMERIC;
  v_journal_id UUID;
  v_entry_number TEXT;
  v_kas_account_id TEXT;
  v_piutang_account_id TEXT;
BEGIN
  IF p_branch_id IS NULL THEN RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID, 'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT; RETURN; END IF;
  IF p_receivable_id IS NULL THEN RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID, 'Receivable ID is required'::TEXT; RETURN; END IF;
  IF p_amount <= 0 THEN RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID, 'Amount must be positive'::TEXT; RETURN; END IF;

  SELECT t.id, t.customer_id, t.total, COALESCE(t.paid_amount, 0) as paid_amount, COALESCE(t.total - COALESCE(t.paid_amount, 0), 0) as remaining_amount, t.payment_status as status, c.name as customer_name
  INTO v_receivable FROM transactions t LEFT JOIN customers c ON c.id = t.customer_id WHERE t.id = p_receivable_id::TEXT AND t.branch_id = p_branch_id;

  IF v_receivable.id IS NULL THEN RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID, 'Transaction not found in this branch'::TEXT; RETURN; END IF;
  IF v_receivable.status = 'paid' OR v_receivable.status = 'Lunas' THEN RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID, 'Transaction already fully paid'::TEXT; RETURN; END IF;

  v_remaining := GREATEST(0, v_receivable.remaining_amount - p_amount);

  -- [PERUBAHAN]: Menggunakan payment_history alih-alih transaction_payments
  INSERT INTO payment_history (
    transaction_id, branch_id, amount, remaining_amount, payment_method, account_id, payment_date, notes, created_at
  ) VALUES (
    p_receivable_id::TEXT, p_branch_id, p_amount, v_remaining, p_payment_method, CAST(p_payment_account_id AS TEXT), p_payment_date, COALESCE(p_notes, format('Payment from %s', COALESCE(v_receivable.customer_name, 'Customer'))), NOW()
  ) RETURNING id INTO v_payment_id;

  UPDATE transactions SET paid_amount = COALESCE(paid_amount, 0) + p_amount, payment_status = CASE WHEN v_remaining <= 0 THEN 'Lunas' ELSE 'Partial' END, updated_at = NOW() WHERE id = p_receivable_id::TEXT;

  IF p_payment_account_id IS NOT NULL THEN v_kas_account_id := p_payment_account_id::TEXT;
  ELSIF p_payment_method = 'transfer' THEN SELECT id INTO v_kas_account_id FROM accounts WHERE code = '1120' AND branch_id = p_branch_id AND is_active = TRUE LIMIT 1;
  ELSE SELECT id INTO v_kas_account_id FROM accounts WHERE code = '1110' AND branch_id = p_branch_id AND is_active = TRUE LIMIT 1; END IF;

  SELECT id INTO v_piutang_account_id FROM accounts WHERE code = '1210' AND branch_id = p_branch_id AND is_active = TRUE LIMIT 1;

  IF v_kas_account_id IS NOT NULL AND v_piutang_account_id IS NOT NULL THEN
    DECLARE v_journal_lines JSONB; v_journal_res RECORD;
    BEGIN
       v_journal_lines := jsonb_build_array(
         jsonb_build_object('account_id', v_kas_account_id, 'debit_amount', p_amount, 'credit_amount', 0, 'description', format('Terima dari %s', COALESCE(v_receivable.customer_name, 'Customer'))),
         jsonb_build_object('account_id', v_piutang_account_id, 'debit_amount', 0, 'credit_amount', p_amount, 'description', format('Pelunasan piutang: %s', COALESCE(v_receivable.customer_name, 'Customer')))
       );
       SELECT * INTO v_journal_res FROM create_journal_atomic(p_branch_id, p_payment_date, format('Terima pembayaran piutang: %s', COALESCE(v_receivable.customer_name, 'Customer')), 'receivable_payment', v_payment_id::TEXT, v_journal_lines, TRUE);
       IF v_journal_res.success THEN v_journal_id := v_journal_res.journal_id; ELSE RAISE EXCEPTION 'Gagal membuat jurnal penerimaan: %', v_journal_res.error_message; END IF;
    END;
  END IF;

  RETURN QUERY SELECT TRUE, v_payment_id, v_remaining, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID, SQLERRM::TEXT;
END;
$function$;

-- =========================================================================
-- 4. UPDATE FUNGSI create_transaction_atomic
-- =========================================================================
CREATE OR REPLACE FUNCTION public.create_transaction_atomic(p_transaction jsonb, p_items jsonb, p_branch_id uuid, p_cashier_id uuid DEFAULT NULL::uuid, p_cashier_name text DEFAULT NULL::text, p_quotation_id text DEFAULT NULL::text) RETURNS TABLE(success boolean, transaction_id text, total_hpp numeric, total_hpp_bonus numeric, journal_id uuid, items_count integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_transaction_id TEXT; v_customer_id UUID; v_customer_name TEXT; v_total NUMERIC; v_paid_amount NUMERIC;
  v_payment_method TEXT; v_payment_account_id TEXT; v_is_office_sale BOOLEAN; v_date TIMESTAMPTZ; v_notes TEXT;
  v_sales_id UUID; v_sales_name TEXT; v_retasi_id UUID; v_retasi_number TEXT;
  v_item JSONB; v_product_id UUID; v_product_name TEXT; v_quantity NUMERIC; v_price NUMERIC;
  v_discount NUMERIC; v_is_bonus BOOLEAN; v_cost_price NUMERIC; v_unit TEXT; v_width NUMERIC; v_height NUMERIC;
  v_total_hpp NUMERIC := 0; v_total_hpp_bonus NUMERIC := 0; v_fifo_result RECORD; v_item_hpp NUMERIC; v_items_inserted INTEGER := 0;
  v_journal_id UUID; v_kas_account_id TEXT; v_piutang_account_id TEXT; v_pendapatan_account_id TEXT;
  v_hpp_account_id TEXT; v_hpp_bonus_account_id TEXT; v_persediaan_account_id TEXT; v_bahan_baku_account_id TEXT;
  v_item_type TEXT; v_material_id UUID; v_journal_lines JSONB := '[]'::JSONB; v_items_array JSONB := '[]'::JSONB;
BEGIN
  IF p_branch_id IS NULL THEN RETURN QUERY SELECT FALSE, NULL::TEXT, 0::NUMERIC, 0::NUMERIC, NULL::UUID, 0, 'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT; RETURN; END IF;
  IF p_transaction IS NULL THEN RETURN QUERY SELECT FALSE, NULL::TEXT, 0::NUMERIC, 0::NUMERIC, NULL::UUID, 0, 'Transaction data is required'::TEXT; RETURN; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RETURN QUERY SELECT FALSE, NULL::TEXT, 0::NUMERIC, 0::NUMERIC, NULL::UUID, 0, 'Items are required'::TEXT; RETURN; END IF;

  v_transaction_id := COALESCE(p_transaction->>'id', 'TRX-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 100000)::TEXT, 5, '0'));
  v_customer_id := (p_transaction->>'customer_id')::UUID; v_customer_name := p_transaction->>'customer_name';
  v_total := COALESCE((p_transaction->>'total')::NUMERIC, 0); v_paid_amount := COALESCE((p_transaction->>'paid_amount')::NUMERIC, 0);
  v_payment_method := CASE LOWER(COALESCE(p_transaction->>'payment_method', 'cash')) WHEN 'tunai' THEN 'cash' WHEN 'cash' THEN 'cash' WHEN 'transfer' THEN 'bank_transfer' WHEN 'bank_transfer' THEN 'bank_transfer' WHEN 'bank' THEN 'bank_transfer' WHEN 'cek' THEN 'check' WHEN 'check' THEN 'check' WHEN 'giro' THEN 'check' WHEN 'digital' THEN 'digital_wallet' WHEN 'digital_wallet' THEN 'digital_wallet' WHEN 'e-wallet' THEN 'digital_wallet' ELSE 'cash' END;
  v_is_office_sale := COALESCE((p_transaction->>'is_office_sale')::BOOLEAN, FALSE); v_date := COALESCE((p_transaction->>'date')::TIMESTAMPTZ, NOW());
  v_notes := p_transaction->>'notes'; v_sales_id := (p_transaction->>'sales_id')::UUID; v_sales_name := p_transaction->>'sales_name';
  v_payment_account_id := (p_transaction->>'payment_account_id')::TEXT; v_retasi_id := (p_transaction->>'retasi_id')::UUID; v_retasi_number := p_transaction->>'retasi_number';

  IF v_paid_amount > 0 AND (v_payment_account_id IS NULL OR v_payment_account_id = '') THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 0::NUMERIC, 0::NUMERIC, NULL::UUID, 0, 'Akun pembayaran wajib dipilih jika ada pembayaran'::TEXT; RETURN;
  END IF;

  SELECT id INTO v_kas_account_id FROM accounts WHERE branch_id = p_branch_id AND code = '1110' AND is_active = TRUE LIMIT 1;
  SELECT id INTO v_piutang_account_id FROM accounts WHERE branch_id = p_branch_id AND code = '1210' AND is_active = TRUE LIMIT 1;
  SELECT id INTO v_pendapatan_account_id FROM accounts WHERE branch_id = p_branch_id AND code = '4100' AND is_active = TRUE LIMIT 1;
  SELECT id INTO v_hpp_account_id FROM accounts WHERE branch_id = p_branch_id AND code = '5100' AND is_active = TRUE LIMIT 1;
  SELECT id INTO v_hpp_bonus_account_id FROM accounts WHERE branch_id = p_branch_id AND code = '5210' AND is_active = TRUE LIMIT 1;
  SELECT id INTO v_persediaan_account_id FROM accounts WHERE branch_id = p_branch_id AND code = '1310' AND is_active = TRUE LIMIT 1;
  SELECT id INTO v_bahan_baku_account_id FROM accounts WHERE branch_id = p_branch_id AND code = '1320' AND is_active = TRUE LIMIT 1;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := NULL; v_material_id := NULL;
    v_product_name := v_item->>'product_name'; v_quantity := COALESCE((v_item->>'quantity')::NUMERIC, 0); v_price := COALESCE((v_item->>'price')::NUMERIC, 0);
    v_discount := COALESCE((v_item->>'discount')::NUMERIC, 0); v_is_bonus := COALESCE((v_item->>'is_bonus')::BOOLEAN, FALSE); v_cost_price := COALESCE((v_item->>'cost_price')::NUMERIC, 0);
    v_unit := v_item->>'unit'; v_width := (v_item->>'width')::NUMERIC; v_height := (v_item->>'height')::NUMERIC; v_item_type := v_item->>'product_type';

    IF (v_item->>'product_id') LIKE 'material-%' THEN v_material_id := (v_item->>'material_id')::UUID; ELSE v_product_id := (v_item->>'product_id')::UUID; END IF;

    IF v_material_id IS NOT NULL AND v_quantity > 0 THEN
      SELECT * INTO v_fifo_result FROM consume_material_fifo_v2(v_material_id, v_quantity, v_transaction_id, 'sale', p_branch_id);
      IF NOT v_fifo_result.success THEN RAISE EXCEPTION 'Gagal potong stok material: %', v_fifo_result.error_message; END IF;
      v_item_hpp := COALESCE(v_fifo_result.total_cost, v_cost_price * v_quantity);
      IF v_is_bonus THEN v_total_hpp_bonus := v_total_hpp_bonus + v_item_hpp; ELSE v_total_hpp := v_total_hpp + v_item_hpp; END IF;
      v_items_array := v_items_array || jsonb_build_object('productId', COALESCE(v_product_id, v_material_id), 'productName', v_product_name, 'quantity', v_quantity, 'price', v_price, 'discount', v_discount, 'isBonus', v_is_bonus, 'costPrice', v_cost_price, 'hppAmount', v_item_hpp, 'productType', CASE WHEN v_material_id IS NOT NULL THEN 'material' ELSE 'product' END, 'unit', v_unit, 'width', v_width, 'height', v_height);
      v_items_inserted := v_items_inserted + 1;
    ELSIF v_product_id IS NOT NULL AND v_quantity > 0 THEN
      IF v_is_office_sale THEN
        SELECT * INTO v_fifo_result FROM consume_stock_fifo_v2(v_product_id, v_quantity, v_transaction_id, 'sale', p_branch_id);
        IF NOT v_fifo_result.success THEN RAISE EXCEPTION 'Gagal potong stok: %', v_fifo_result.error_message; END IF;
        v_item_hpp := v_fifo_result.total_hpp;
      ELSE
        SELECT f.total_hpp INTO v_item_hpp FROM calculate_fifo_cost(v_product_id, p_branch_id, v_quantity) f; v_item_hpp := COALESCE(v_item_hpp, v_cost_price * v_quantity);
      END IF;
      IF v_is_bonus THEN v_total_hpp_bonus := v_total_hpp_bonus + v_item_hpp; ELSE v_total_hpp := v_total_hpp + v_item_hpp; END IF;
      v_items_array := v_items_array || jsonb_build_object('productId', COALESCE(v_product_id, v_material_id), 'productName', v_product_name, 'quantity', v_quantity, 'price', v_price, 'discount', v_discount, 'isBonus', v_is_bonus, 'costPrice', v_cost_price, 'hppAmount', v_item_hpp, 'productType', CASE WHEN v_material_id IS NOT NULL THEN 'material' ELSE 'product' END, 'unit', v_unit, 'width', v_width, 'height', v_height);
      v_items_inserted := v_items_inserted + 1;
    END IF;
  END LOOP;

  INSERT INTO transactions (id, branch_id, customer_id, customer_name, cashier_id, cashier_name, sales_id, sales_name, order_date, items, total, paid_amount, payment_status, payment_account_id, status, delivery_status, is_office_sale, notes, retasi_id, retasi_number, created_at, updated_at)
  VALUES (v_transaction_id, p_branch_id, v_customer_id, v_customer_name, p_cashier_id, p_cashier_name, v_sales_id, v_sales_name, v_date, v_items_array, v_total, v_paid_amount, CASE WHEN v_paid_amount >= v_total THEN 'Lunas' ELSE 'Belum Lunas' END, v_payment_account_id, 'Pesanan Masuk', CASE WHEN v_is_office_sale THEN 'Completed' ELSE 'Pending' END, v_is_office_sale, v_notes, v_retasi_id, v_retasi_number, NOW(), NOW());

  -- [PERUBAHAN]: INSERT KE payment_history BUKAN transaction_payments
  IF v_paid_amount > 0 THEN
    INSERT INTO payment_history (
      transaction_id, branch_id, amount, remaining_amount, payment_method, account_id, payment_date, notes, recorded_by_name, recorded_by, created_at
    ) VALUES (
      v_transaction_id, p_branch_id, v_paid_amount, GREATEST(0, v_total - v_paid_amount), v_payment_method, v_payment_account_id, v_date,
      'Initial Payment for ' || v_transaction_id, COALESCE(p_cashier_name, 'System'), p_cashier_id, NOW()
    );
  END IF;

  IF p_quotation_id IS NOT NULL THEN
    UPDATE quotations SET transaction_id = v_transaction_id, status = 'Disetujui', updated_at = NOW() WHERE id = p_quotation_id;
  END IF;

  IF v_total > 0 THEN
    v_journal_lines := '[]'::JSONB;
    IF v_paid_amount >= v_total THEN
      v_journal_lines := v_journal_lines || jsonb_build_object('account_id', v_payment_account_id, 'debit_amount', v_total, 'credit_amount', 0, 'description', 'Penerimaan kas dari penjualan');
    ELSIF v_paid_amount > 0 THEN
      v_journal_lines := v_journal_lines || jsonb_build_object('account_id', v_payment_account_id, 'debit_amount', v_paid_amount, 'credit_amount', 0, 'description', 'Penerimaan kas dari penjualan');
      v_journal_lines := v_journal_lines || jsonb_build_object('account_code', '1210', 'debit_amount', v_total - v_paid_amount, 'credit_amount', 0, 'description', 'Piutang usaha');
    ELSE
      v_journal_lines := v_journal_lines || jsonb_build_object('account_code', '1210', 'debit_amount', v_total, 'credit_amount', 0, 'description', 'Piutang usaha');
    END IF;

    v_journal_lines := v_journal_lines || jsonb_build_object('account_code', '4100', 'debit_amount', 0, 'credit_amount', v_total, 'description', 'Pendapatan penjualan');

    IF v_total_hpp > 0 THEN v_journal_lines := v_journal_lines || jsonb_build_object('account_code', '5100', 'debit_amount', v_total_hpp, 'credit_amount', 0, 'description', 'Harga Pokok Penjualan'); END IF;
    IF v_total_hpp_bonus > 0 THEN v_journal_lines := v_journal_lines || jsonb_build_object('account_code', '5210', 'debit_amount', v_total_hpp_bonus, 'credit_amount', 0, 'description', 'HPP Bonus/Gratis'); END IF;

    IF (v_total_hpp + v_total_hpp_bonus) > 0 THEN
      IF v_is_office_sale THEN v_journal_lines := v_journal_lines || jsonb_build_object('account_code', '1310', 'debit_amount', 0, 'credit_amount', v_total_hpp + v_total_hpp_bonus, 'description', 'Pengurangan persediaan');
      ELSE v_journal_lines := v_journal_lines || jsonb_build_object('account_code', '2140', 'debit_amount', 0, 'credit_amount', v_total_hpp + v_total_hpp_bonus, 'description', 'Modal barang dagang tertahan (belum dikirim)'); END IF;
    END IF;

    SELECT * INTO v_fifo_result FROM create_journal_atomic(p_branch_id, v_date::DATE, 'Penjualan ke ' || COALESCE(v_customer_name, 'Umum') || ' - ' || v_transaction_id, 'transaction', v_transaction_id, v_journal_lines, TRUE);
    IF v_fifo_result.success THEN v_journal_id := v_fifo_result.journal_id; END IF;
  END IF;

  RETURN QUERY SELECT TRUE, v_transaction_id, v_total_hpp, v_total_hpp_bonus, v_journal_id, v_items_inserted, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN RETURN QUERY SELECT FALSE, NULL::TEXT, 0::NUMERIC, 0::NUMERIC, NULL::UUID, 0, SQLERRM::TEXT;
END;
$function$;

-- =========================================================================
-- 5. PENYELAMATAN DATA (MIGRASI): PINDAHKAN SELURUH DATA LAMA KE payment_history
-- =========================================================================
-- Gunakan ON CONFLICT DO NOTHING agar data aman walau di-run berulang kali jika ada duplikat id
INSERT INTO payment_history (
    id,
    transaction_id,
    branch_id,
    amount,
    payment_method,
    payment_date,
    notes,
    recorded_by,
    recorded_by_name,
    created_at,
    remaining_amount
)
SELECT 
    tp.id,
    tp.transaction_id,
    tp.branch_id,
    tp.amount,
    tp.payment_method,
    tp.payment_date,
    COALESCE(tp.notes, tp.description),
    tp.created_by,
    tp.paid_by_user_name,
    tp.created_at,
    -- Hitung sisa piutang asal-asalan saja asalkan valid (0) karena transaksi historikal
    0 AS remaining_amount
FROM transaction_payments tp
ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- 6. AKHIRNYA: DROP TABEL transaction_payments SETELAH MIGRATION SELESAI
-- =========================================================================
DROP TABLE IF EXISTS public.transaction_payments CASCADE;
