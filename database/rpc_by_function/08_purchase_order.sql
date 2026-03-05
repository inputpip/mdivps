-- =====================================================
-- 08 PURCHASE ORDER
-- Generated: 2026-01-09T00:29:07.861Z
-- Updated: 2026-01-09 - Removed duplicate pay_supplier_atomic
-- Total functions: 7
-- =====================================================

-- Functions in this file:
--   approve_purchase_order_atomic
--   create_purchase_order_atomic
--   delete_po_atomic
--   notify_purchase_order_created
--   pay_supplier_atomic
--   receive_payment_atomic
--   receive_po_atomic

-- =====================================================
-- Function: approve_purchase_order_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.approve_purchase_order_atomic(p_po_id text, p_branch_id uuid, p_user_id uuid, p_user_name text)
 RETURNS TABLE(success boolean, journal_ids uuid[], ap_id text, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_po RECORD;
  v_item RECORD;
  v_journal_id UUID;
  v_journal_ids UUID[] := ARRAY[]::UUID[];
  v_ap_id TEXT;
  v_entry_number TEXT;
  v_acc_persediaan_bahan TEXT;
  v_acc_persediaan_produk TEXT;
  v_acc_hutang_usaha TEXT;
  v_acc_piutang_pajak TEXT;
  v_total_material NUMERIC := 0;
  v_total_product NUMERIC := 0;
  v_material_ppn NUMERIC := 0;
  v_product_ppn NUMERIC := 0;
  v_material_names TEXT := '';
  v_product_names TEXT := '';
  v_subtotal_all NUMERIC := 0;
  v_days INTEGER;
  v_due_date DATE;
  v_supplier_terms TEXT;
  v_existing_journal_count INTEGER;
  v_existing_ap_count INTEGER;
BEGIN
  -- 1. Get PO Header
  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id AND branch_id = p_branch_id;
  IF v_po.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID[], NULL::TEXT, 'Purchase Order tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  IF v_po.status <> 'Pending' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID[], NULL::TEXT, 'Hanya PO status Pending yang bisa disetujui'::TEXT;
    RETURN;
  END IF;

  -- ðŸ”¥ NEW: Check if journal already exists for this PO
  SELECT COUNT(*) INTO v_existing_journal_count
  FROM journal_entries
  WHERE reference_id = p_po_id
    AND reference_type = 'purchase_order'
    AND is_voided = FALSE;

  IF v_existing_journal_count > 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID[], NULL::TEXT, 
      format('Journal sudah ada untuk PO ini (%s entries). Tidak dapat approve lagi.', v_existing_journal_count)::TEXT;
    RETURN;
  END IF;

  -- ðŸ”¥ NEW: Check if AP already exists for this PO
  SELECT COUNT(*) INTO v_existing_ap_count
  FROM accounts_payable
  WHERE purchase_order_id = p_po_id;

  IF v_existing_ap_count > 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID[], NULL::TEXT, 
      'Accounts Payable sudah ada untuk PO ini. Tidak dapat approve lagi.'::TEXT;
    RETURN;
  END IF;

  -- 2. Get Accounts
  SELECT id INTO v_acc_persediaan_bahan FROM accounts WHERE code = '1320' AND branch_id = p_branch_id LIMIT 1;
  SELECT id INTO v_acc_persediaan_produk FROM accounts WHERE code = '1310' AND branch_id = p_branch_id LIMIT 1;
  SELECT id INTO v_acc_hutang_usaha FROM accounts WHERE code = '2110' AND branch_id = p_branch_id LIMIT 1;
  SELECT id INTO v_acc_piutang_pajak FROM accounts WHERE code = '1230' AND branch_id = p_branch_id LIMIT 1;

  IF v_acc_hutang_usaha IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID[], NULL::TEXT, 'Akun Hutang Usaha (2110) tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  -- Validate: If PPN is enabled, the PPN account MUST exist
  IF v_po.include_ppn AND v_po.ppn_amount > 0 AND v_acc_piutang_pajak IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID[], NULL::TEXT, 
      'PPN diaktifkan tapi Akun Piutang Pajak / PPN Masukan (1230) tidak ditemukan. Buat akun tersebut terlebih dahulu.'::TEXT;
    RETURN;
  END IF;

  -- 3. Calculate Totals and Names
  FOR v_item IN SELECT * FROM purchase_order_items WHERE purchase_order_id = p_po_id LOOP
    v_subtotal_all := v_subtotal_all + COALESCE(v_item.subtotal, 0);
    IF v_item.item_type = 'material' OR v_item.material_id IS NOT NULL THEN
      v_total_material := v_total_material + COALESCE(v_item.subtotal, 0);
      v_material_names := v_material_names || v_item.material_name || ' x' || v_item.quantity || ', ';
    ELSE
      v_total_product := v_total_product + COALESCE(v_item.subtotal, 0);
      v_product_names := v_product_names || v_item.product_name || ' x' || v_item.quantity || ', ';
    END IF;
  END LOOP;

  v_material_names := RTRIM(v_material_names, ', ');
  v_product_names := RTRIM(v_product_names, ', ');

  -- Proportional PPN
  IF v_po.include_ppn AND v_po.ppn_amount > 0 AND v_subtotal_all > 0 THEN
    v_material_ppn := ROUND(v_po.ppn_amount * (v_total_material / v_subtotal_all));
    v_product_ppn := v_po.ppn_amount - v_material_ppn;
  END IF;

  -- 4. Create Material Journal
  IF v_total_material > 0 THEN
    IF v_acc_persediaan_bahan IS NULL THEN
      RETURN QUERY SELECT FALSE, NULL::UUID[], NULL::TEXT, 'Akun Persediaan Bahan Baku (1320) tidak ditemukan'::TEXT;
      RETURN;
    END IF;

    DECLARE
       v_journal_lines JSONB := '[]'::JSONB;
       v_journal_res RECORD;
       v_material_ppn_applied NUMERIC := 0;
    BEGIN
       -- Dr. Persediaan Bahan Baku
       v_journal_lines := v_journal_lines || jsonb_build_object(
          'account_id', v_acc_persediaan_bahan,
          'debit_amount', v_total_material,
          'credit_amount', 0,
          'description', 'Persediaan: ' || v_material_names
       );
       
       -- Dr. Piutang Pajak (PPN Masukan) jika ada
       IF v_material_ppn > 0 AND v_acc_piutang_pajak IS NOT NULL THEN
          v_journal_lines := v_journal_lines || jsonb_build_object(
            'account_id', v_acc_piutang_pajak,
            'debit_amount', v_material_ppn,
            'credit_amount', 0,
            'description', 'PPN Masukan (PO ' || p_po_id || ')'
          );
          v_material_ppn_applied := v_material_ppn;
       END IF;

       -- Cr. Hutang Usaha (must match total debit = persediaan + ppn actually applied)
       v_journal_lines := v_journal_lines || jsonb_build_object(
          'account_id', v_acc_hutang_usaha,
          'debit_amount', 0,
          'credit_amount', v_total_material + v_material_ppn_applied,
          'description', 'Hutang: ' || v_po.supplier_name
       );

       SELECT * INTO v_journal_res FROM create_journal_atomic(
         p_branch_id,
         CURRENT_DATE,
         'Pembelian Bahan Baku: ' || v_po.supplier_name || ' (' || p_po_id || ')',
         'purchase_order',
         p_po_id,
         v_journal_lines,
         TRUE
       );

       IF v_journal_res.success THEN
         v_journal_ids := array_append(v_journal_ids, v_journal_res.journal_id);
       ELSE
         RAISE EXCEPTION 'Gagal membuat jurnal bahan baku PO: %', v_journal_res.error_message;
       END IF;
    END;
  END IF;

  -- 5. Create Product Journal
  IF v_total_product > 0 THEN
    IF v_acc_persediaan_produk IS NULL THEN
      RETURN QUERY SELECT FALSE, NULL::UUID[], NULL::TEXT, 'Akun Persediaan Barang Dagang (1310) tidak ditemukan'::TEXT;
      RETURN;
    END IF;

    DECLARE
       v_journal_lines JSONB := '[]'::JSONB;
       v_journal_res RECORD;
       v_product_ppn_applied NUMERIC := 0;
    BEGIN
       -- Dr. Persediaan Produk Jadi
       v_journal_lines := v_journal_lines || jsonb_build_object(
          'account_id', v_acc_persediaan_produk,
          'debit_amount', v_total_product,
          'credit_amount', 0,
          'description', 'Persediaan: ' || v_product_names
       );

       -- Dr. Piutang Pajak (PPN Masukan) jika ada
       IF v_product_ppn > 0 AND v_acc_piutang_pajak IS NOT NULL THEN
           v_journal_lines := v_journal_lines || jsonb_build_object(
            'account_id', v_acc_piutang_pajak,
            'debit_amount', v_product_ppn,
            'credit_amount', 0,
            'description', 'PPN Masukan (PO ' || p_po_id || ')'
           );
           v_product_ppn_applied := v_product_ppn;
       END IF;

       -- Cr. Hutang Usaha (must match total debit = persediaan + ppn actually applied)
       v_journal_lines := v_journal_lines || jsonb_build_object(
          'account_id', v_acc_hutang_usaha,
          'debit_amount', 0,
          'credit_amount', v_total_product + v_product_ppn_applied,
          'description', 'Hutang: ' || v_po.supplier_name
       );
       
       SELECT * INTO v_journal_res FROM create_journal_atomic(
         p_branch_id,
         CURRENT_DATE,
         'Pembelian Produk Jadi: ' || v_po.supplier_name || ' (' || p_po_id || ')',
         'purchase_order',
         p_po_id,
         v_journal_lines,
         TRUE
       );

       IF v_journal_res.success THEN
         v_journal_ids := array_append(v_journal_ids, v_journal_res.journal_id);
       ELSE
         RAISE EXCEPTION 'Gagal membuat jurnal produk PO: %', v_journal_res.error_message;
       END IF;
    END;
  END IF;

  -- 6. Create Accounts Payable (AP)
  v_due_date := NOW()::DATE + INTERVAL '30 days'; -- Default
  SELECT payment_terms INTO v_supplier_terms FROM suppliers WHERE id = v_po.supplier_id;
  IF v_supplier_terms ILIKE '%net%' THEN
    v_days := (regexp_matches(v_supplier_terms, '\\d+'))[1]::INTEGER;
    v_due_date := NOW()::DATE + (v_days || ' days')::INTERVAL;
  ELSIF v_supplier_terms ILIKE '%cash%' THEN
    v_due_date := NOW()::DATE;
  END IF;

  v_ap_id := 'AP-PO-' || p_po_id;

  INSERT INTO accounts_payable (
    id, purchase_order_id, supplier_name, amount, due_date,
    description, status, paid_amount, branch_id, created_at
  ) VALUES (
    v_ap_id, p_po_id, v_po.supplier_name, v_po.total_cost, v_due_date,
    'Purchase Order ' || p_po_id || ' - ' || COALESCE(v_material_names, '') || COALESCE(v_product_names, ''), 
    'Outstanding', 0, p_branch_id, NOW()
  );

  -- 7. Update PO Status
  UPDATE purchase_orders
  SET
    status = 'Approved',
    approved_at = NOW(),
    approved_by = p_user_name
  WHERE id = p_po_id;

  RETURN QUERY SELECT TRUE, v_journal_ids, v_ap_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID[], NULL::TEXT, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: create_purchase_order_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_purchase_order_atomic(p_po_header jsonb, p_po_items jsonb, p_branch_id uuid)
 RETURNS TABLE(success boolean, po_id text, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_po_id TEXT;
  v_item JSONB;
BEGIN
  -- Validate required fields
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'Branch ID is required'::TEXT;
    RETURN;
  END IF;

  IF p_po_header->>'supplier_id' IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'Supplier ID is required'::TEXT;
    RETURN;
  END IF;

  -- Generate PO ID if not provided
  v_po_id := p_po_header->>'id';
  IF v_po_id IS NULL THEN
    v_po_id := 'PO-' || EXTRACT(EPOCH FROM NOW())::TEXT;
  END IF;

  -- Insert Header
  INSERT INTO purchase_orders (
    id,
    po_number,
    status,
    requested_by,
    supplier_id,
    supplier_name,
    total_cost,
    subtotal,
    include_ppn,
    ppn_mode,
    ppn_amount,
    expedition,
    order_date,
    expected_delivery_date,
    notes,
    branch_id,
    created_at
  ) VALUES (
    v_po_id,
    p_po_header->>'po_number',
    'Pending',
    COALESCE(p_po_header->>'requested_by', 'System'),
    (p_po_header->>'supplier_id')::UUID,
    p_po_header->>'supplier_name',
    (p_po_header->>'total_cost')::NUMERIC,
    (p_po_header->>'subtotal')::NUMERIC,
    COALESCE((p_po_header->>'include_ppn')::BOOLEAN, FALSE),
    COALESCE(p_po_header->>'ppn_mode', 'exclude'),
    COALESCE((p_po_header->>'ppn_amount')::NUMERIC, 0),
    p_po_header->>'expedition',
    COALESCE((p_po_header->>'order_date')::TIMESTAMP, NOW()),
    (p_po_header->>'expected_delivery_date')::TIMESTAMP,
    p_po_header->>'notes',
    p_branch_id,
    NOW()
  );

  -- Insert Items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_po_items)
  LOOP
    INSERT INTO purchase_order_items (
      purchase_order_id,
      material_id,
      product_id,
      material_name,
      product_name,
      item_type,
      quantity,
      unit_price,
      unit,
      subtotal,
      notes
    ) VALUES (
      v_po_id,
      (v_item->>'material_id')::UUID,
      (v_item->>'product_id')::UUID,
      v_item->>'material_name',
      v_item->>'product_name',
      COALESCE(v_item->>'item_type', CASE WHEN v_item->>'material_id' IS NOT NULL THEN 'material' ELSE 'product' END),
      (v_item->>'quantity')::NUMERIC,
      (v_item->>'unit_price')::NUMERIC,
      v_item->>'unit',
      COALESCE((v_item->>'subtotal')::NUMERIC, (v_item->>'quantity')::NUMERIC * (v_item->>'unit_price')::NUMERIC),
      v_item->>'notes'
    );
  END LOOP;

  RETURN QUERY SELECT TRUE, v_po_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::TEXT, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: delete_po_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.delete_po_atomic(p_po_id text, p_branch_id uuid, p_skip_validation boolean DEFAULT false)
 RETURNS TABLE(success boolean, batches_deleted integer, stock_rolled_back integer, journals_voided integer, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_po RECORD;
  v_batch RECORD;
  v_batches_deleted INTEGER := 0;
  v_stock_rolled_back INTEGER := 0;
  v_journals_voided INTEGER := 0;
  v_current_stock NUMERIC;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0,
      'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT;
    RETURN;
  END IF;

  IF p_po_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0,
      'Purchase Order ID is required'::TEXT;
    RETURN;
  END IF;

  -- Get PO info
  SELECT id, status INTO v_po
  FROM purchase_orders
  WHERE id = p_po_id AND branch_id = p_branch_id;

  IF v_po.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0,
      'Purchase Order not found in this branch'::TEXT;
    RETURN;
  END IF;

  -- ==================== CHECK IF BATCHES USED ====================
  IF NOT p_skip_validation THEN
    -- Check if any batch has been used (remaining < initial)
    IF EXISTS (
      SELECT 1 FROM inventory_batches
      WHERE purchase_order_id = p_po_id
        AND remaining_quantity < initial_quantity
    ) THEN
      RETURN QUERY SELECT FALSE, 0, 0, 0,
        'Tidak dapat menghapus PO karena batch inventory sudah terpakai (FIFO)'::TEXT;
      RETURN;
    END IF;

    -- Check if any payable has been paid
    IF EXISTS (
      SELECT 1 FROM accounts_payable
      WHERE purchase_order_id = p_po_id
        AND paid_amount > 0
    ) THEN
      RETURN QUERY SELECT FALSE, 0, 0, 0,
        'Tidak dapat menghapus PO karena hutang sudah ada pembayaran'::TEXT;
      RETURN;
    END IF;
  END IF;

  -- ==================== VOID JOURNALS ====================

  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_reason = format('PO %s dihapus', p_po_id),
    updated_at = NOW()
  WHERE reference_id = p_po_id
    AND branch_id = p_branch_id
    AND is_voided = FALSE;

  GET DIAGNOSTICS v_journals_voided = ROW_COUNT;

  -- ==================== ROLLBACK STOCK FROM BATCHES ====================

  FOR v_batch IN
    SELECT id, material_id, product_id, remaining_quantity
    FROM inventory_batches
    WHERE purchase_order_id = p_po_id
  LOOP
    -- Rollback material stock
    IF v_batch.material_id IS NOT NULL THEN
      SELECT stock INTO v_current_stock
      FROM materials
      WHERE id = v_batch.material_id;

      UPDATE materials
      SET stock = GREATEST(0, COALESCE(v_current_stock, 0) - v_batch.remaining_quantity),
          updated_at = NOW()
      WHERE id = v_batch.material_id;

      v_stock_rolled_back := v_stock_rolled_back + 1;
    END IF;

    -- products.current_stock is DEPRECATED - deleting batch auto-updates via VIEW
    IF v_batch.product_id IS NOT NULL THEN
      v_stock_rolled_back := v_stock_rolled_back + 1;
    END IF;

    v_batches_deleted := v_batches_deleted + 1;
  END LOOP;

  -- ==================== DELETE RELATED RECORDS ====================

  -- Delete inventory batches
  DELETE FROM inventory_batches WHERE purchase_order_id = p_po_id;

  -- Delete material movements
  DELETE FROM material_stock_movements
  WHERE reference_id = p_po_id
    AND reference_type = 'purchase_order';

  -- Delete accounts payable
  DELETE FROM accounts_payable WHERE purchase_order_id = p_po_id;

  -- Delete PO items
  DELETE FROM purchase_order_items WHERE purchase_order_id = p_po_id;

  -- Delete PO
  DELETE FROM purchase_orders WHERE id = p_po_id;

  RETURN QUERY SELECT
    TRUE,
    v_batches_deleted,
    v_stock_rolled_back,
    v_journals_voided,
    NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0, 0, 0, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: notify_purchase_order_created
-- =====================================================
CREATE OR REPLACE FUNCTION public.notify_purchase_order_created()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    INSERT INTO notifications (id, title, message, type, reference_type, reference_id, reference_url, priority)
    VALUES (
        'NOTIF-PO-' || NEW.id || '-' || EXTRACT(EPOCH FROM NOW())::TEXT,
        'New Purchase Order Created',
        'PO #' || COALESCE(NEW.po_number, NEW.id::TEXT) || ' for supplier ' || COALESCE(NEW.supplier_name, 'Unknown') || ' - ' ||
        'Total: Rp ' || TO_CHAR(COALESCE(NEW.total_cost, 0), 'FM999,999,999,999'),
        'purchase_order_created',
        'purchase_order',
        NEW.id,
        '/purchase-orders/' || NEW.id,
        'normal'
    );
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Don't fail the insert if notification fails
    RETURN NEW;
END;
$function$
;


-- =====================================================
-- Function: pay_supplier_atomic
-- =====================================================
-- UPDATED: Added p_payment_account_id parameter to support user-selected payment account
CREATE OR REPLACE FUNCTION public.pay_supplier_atomic(
  p_payable_id text,
  p_branch_id uuid,
  p_amount numeric,
  p_payment_account_id text DEFAULT NULL,
  p_payment_method text DEFAULT 'cash'::text,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL::text
)
 RETURNS TABLE(success boolean, payment_id uuid, remaining_amount numeric, journal_id uuid, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_payment_id UUID;
  v_payable RECORD;
  v_remaining NUMERIC;
  v_new_paid_amount NUMERIC;
  v_journal_id UUID;
  v_entry_number TEXT;
  v_kas_account_id TEXT;      -- accounts.id is TEXT
  v_hutang_account_id TEXT;   -- accounts.id is TEXT
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT;
    RETURN;
  END IF;

  IF p_payable_id IS NULL OR p_payable_id = '' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Payable ID is required'::TEXT;
    RETURN;
  END IF;

  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Amount must be positive'::TEXT;
    RETURN;
  END IF;

  -- Get payable info (struktur sesuai tabel accounts_payable yang ada)
  SELECT
    ap.id,
    ap.supplier_name,
    ap.amount,              -- Total amount hutang
    COALESCE(ap.paid_amount, 0) as paid_amount,
    ap.status
  INTO v_payable
  FROM accounts_payable ap
  WHERE ap.id = p_payable_id AND ap.branch_id = p_branch_id;

  IF v_payable.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Payable not found in this branch'::TEXT;
    RETURN;
  END IF;

  IF v_payable.status = 'Paid' OR v_payable.status = 'paid' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Hutang sudah lunas'::TEXT;
    RETURN;
  END IF;

  -- Calculate new amounts
  v_new_paid_amount := v_payable.paid_amount + p_amount;
  v_remaining := GREATEST(0, v_payable.amount - v_new_paid_amount);

  -- ==================== UPDATE PAYABLE (langsung, tanpa payment record terpisah) ====================

  UPDATE accounts_payable
  SET
    paid_amount = v_new_paid_amount,
    status = CASE WHEN v_remaining <= 0 THEN 'Paid' ELSE 'Partial' END,
    paid_at = CASE WHEN v_remaining <= 0 THEN NOW() ELSE paid_at END,
    notes = COALESCE(p_notes, notes)
  WHERE id = p_payable_id;

  -- Generate a payment ID for tracking
  v_payment_id := gen_random_uuid();

  -- ==================== CREATE JOURNAL ENTRY ====================

  -- Get account IDs
  -- Use provided payment account ID, or fallback based on payment method
  IF p_payment_account_id IS NOT NULL THEN
    v_kas_account_id := p_payment_account_id;
  ELSIF p_payment_method = 'transfer' THEN
    SELECT id INTO v_kas_account_id
    FROM accounts
    WHERE code = '1120' AND branch_id = p_branch_id AND is_active = TRUE
    LIMIT 1;
  ELSE
    SELECT id INTO v_kas_account_id
    FROM accounts
    WHERE code = '1110' AND branch_id = p_branch_id AND is_active = TRUE
    LIMIT 1;
  END IF;

  SELECT id INTO v_hutang_account_id
  FROM accounts
  WHERE code = '2110' AND branch_id = p_branch_id AND is_active = TRUE
  LIMIT 1;

  IF v_kas_account_id IS NOT NULL AND v_hutang_account_id IS NOT NULL THEN
    DECLARE
       v_journal_lines JSONB;
       v_journal_res RECORD;
    BEGIN
       -- Dr. Hutang Usaha
       -- Cr. Kas/Bank
       v_journal_lines := jsonb_build_array(
         jsonb_build_object(
           'account_id', v_hutang_account_id,
           'debit_amount', p_amount,
           'credit_amount', 0,
           'description', format('Bayar ke %s', COALESCE(v_payable.supplier_name, 'Supplier'))
         ),
         jsonb_build_object(
           'account_id', v_kas_account_id,
           'debit_amount', 0,
           'credit_amount', p_amount,
           'description', format('Pembayaran hutang: %s', COALESCE(v_payable.supplier_name, 'Supplier'))
         )
       );

       SELECT * INTO v_journal_res FROM create_journal_atomic(
         p_branch_id,
         p_payment_date,
         format('Bayar hutang ke: %s', COALESCE(v_payable.supplier_name, 'Supplier')),
         'payable_payment',
         v_payment_id::TEXT,
         v_journal_lines,
         TRUE
       );

       IF v_journal_res.success THEN
         v_journal_id := v_journal_res.journal_id;
       ELSE
         RAISE EXCEPTION 'Gagal membuat jurnal pembayaran hutang: %', v_journal_res.error_message;
       END IF;
    END;
  END IF;

  RETURN QUERY SELECT
    TRUE,
    v_payment_id,
    v_remaining,
    v_journal_id,
    NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: receive_payment_atomic
-- =====================================================
-- UPDATED: Added p_payment_account_id parameter to support user-selected payment account
CREATE OR REPLACE FUNCTION public.receive_payment_atomic(
  p_receivable_id text,
  p_branch_id uuid,
  p_amount numeric,
  p_payment_account_id text DEFAULT NULL,
  p_payment_method text DEFAULT 'cash'::text,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL::text
)
 RETURNS TABLE(success boolean, payment_id uuid, remaining_amount numeric, journal_id uuid, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_payment_id UUID;
  v_receivable RECORD;
  v_remaining NUMERIC;
  v_journal_id UUID;
  v_entry_number TEXT;
  v_kas_account_id TEXT;      -- accounts.id is TEXT
  v_piutang_account_id TEXT;  -- accounts.id is TEXT
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT;
    RETURN;
  END IF;

  IF p_receivable_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Receivable ID is required'::TEXT;
    RETURN;
  END IF;

  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Amount must be positive'::TEXT;
    RETURN;
  END IF;

  -- Get transaction info (acting as receivable)
  SELECT
    t.id,
    t.customer_id,
    t.total,
    COALESCE(t.paid_amount, 0) as paid_amount,
    COALESCE(t.total - COALESCE(t.paid_amount, 0), 0) as remaining_amount,
    t.payment_status as status,
    c.name as customer_name
  INTO v_receivable
  FROM transactions t
  LEFT JOIN customers c ON c.id = t.customer_id
  WHERE t.id = p_receivable_id::TEXT AND t.branch_id = p_branch_id; -- Cast UUID param to TEXT for transactions.id

  IF v_receivable.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Transaction not found in this branch'::TEXT;
    RETURN;
  END IF;

  IF v_receivable.status = 'paid' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Transaction already fully paid'::TEXT;
    RETURN;
  END IF;

  -- Calculate new remaining
  v_remaining := GREATEST(0, v_receivable.remaining_amount - p_amount);

  -- ==================== CREATE PAYMENT RECORD ====================
  -- Using transaction_payments table
  
  INSERT INTO transaction_payments (
    transaction_id,
    branch_id,
    amount,
    payment_method,
    payment_date,
    notes,
    created_at
  ) VALUES (
    p_receivable_id::TEXT,
    p_branch_id,
    p_amount,
    p_payment_method,
    p_payment_date,
    COALESCE(p_notes, format('Payment from %s', COALESCE(v_receivable.customer_name, 'Customer'))),
    NOW()
  )
  RETURNING id INTO v_payment_id;

  -- ==================== UPDATE TRANSACTION ====================

  UPDATE transactions
  SET
    paid_amount = COALESCE(paid_amount, 0) + p_amount,
    payment_status = CASE WHEN v_remaining <= 0 THEN 'Lunas' ELSE 'Partial' END,
    updated_at = NOW()
  WHERE id = p_receivable_id::TEXT;

  -- ==================== CREATE JOURNAL ENTRY ====================

  -- Get account IDs
  -- Use provided payment account ID, or fallback based on payment method
  IF p_payment_account_id IS NOT NULL THEN
    v_kas_account_id := p_payment_account_id;
  ELSIF p_payment_method = 'transfer' THEN
    SELECT id INTO v_kas_account_id
    FROM accounts
    WHERE code = '1120' AND branch_id = p_branch_id AND is_active = TRUE
    LIMIT 1;
  ELSE
    SELECT id INTO v_kas_account_id
    FROM accounts
    WHERE code = '1110' AND branch_id = p_branch_id AND is_active = TRUE
    LIMIT 1;
  END IF;

  SELECT id INTO v_piutang_account_id
  FROM accounts
  WHERE code = '1210' AND branch_id = p_branch_id AND is_active = TRUE
  LIMIT 1;

  IF v_kas_account_id IS NOT NULL AND v_piutang_account_id IS NOT NULL THEN
    DECLARE
      v_journal_lines JSONB;
      v_journal_res RECORD;
    BEGIN
       -- Dr. Kas/Bank
       -- Cr. Piutang Usaha
       v_journal_lines := jsonb_build_array(
         jsonb_build_object(
           'account_id', v_kas_account_id,
           'debit_amount', p_amount,
           'credit_amount', 0,
           'description', format('Terima dari %s', COALESCE(v_receivable.customer_name, 'Customer'))
         ),
         jsonb_build_object(
           'account_id', v_piutang_account_id,
           'debit_amount', 0,
           'credit_amount', p_amount,
           'description', format('Pelunasan piutang: %s', COALESCE(v_receivable.customer_name, 'Customer'))
         )
       );

       SELECT * INTO v_journal_res FROM create_journal_atomic(
         p_branch_id,
         p_payment_date,
         format('Terima pembayaran piutang: %s', COALESCE(v_receivable.customer_name, 'Customer')),
         'receivable_payment',
         v_payment_id::TEXT,
         v_journal_lines,
         TRUE
       );

       IF v_journal_res.success THEN
          v_journal_id := v_journal_res.journal_id;
       ELSE
          RAISE EXCEPTION 'Gagal membuat jurnal penerimaan: %', v_journal_res.error_message;
       END IF;
    END;
  END IF;

  RETURN QUERY SELECT
    TRUE,
    v_payment_id,
    v_remaining,
    v_journal_id,
    NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: receive_po_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.receive_po_atomic(p_po_id text, p_branch_id uuid, p_received_date date DEFAULT CURRENT_DATE, p_user_id uuid DEFAULT NULL::uuid, p_user_name text DEFAULT NULL::text)
 RETURNS TABLE(success boolean, materials_received integer, products_received integer, batches_created integer, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_po RECORD;
  v_item RECORD;
  v_material RECORD;
  v_materials_received INTEGER := 0;
  v_products_received INTEGER := 0;
  v_batches_created INTEGER := 0;
  v_previous_stock NUMERIC;
  v_new_stock NUMERIC;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0,
      'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT;
    RETURN;
  END IF;

  IF p_po_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0,
      'Purchase Order ID is required'::TEXT;
    RETURN;
  END IF;

  -- Get PO info
  SELECT
    po.id,
    po.status,
    po.supplier_id,
    po.supplier_name,
    po.material_id,
    po.material_name,
    po.quantity,
    po.unit_price,
    po.branch_id
  INTO v_po
  FROM purchase_orders po
  WHERE po.id = p_po_id AND po.branch_id = p_branch_id;

  IF v_po.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0,
      'Purchase Order not found in this branch'::TEXT;
    RETURN;
  END IF;

  IF v_po.status = 'Diterima' THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0,
      'Purchase Order sudah diterima sebelumnya'::TEXT;
    RETURN;
  END IF;

  IF v_po.status NOT IN ('Approved', 'Pending', 'Dikirim') THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0,
      format('Status PO harus Approved, Pending, atau Dikirim, status saat ini: %s', v_po.status)::TEXT;
    RETURN;
  END IF;

  -- ==================== PROCESS MULTI-ITEM PO ====================

  FOR v_item IN
    SELECT
      poi.id,
      poi.material_id,
      poi.product_id,
      poi.item_type,
      poi.quantity,
      poi.unit_price,
      poi.unit,
      poi.material_name,
      poi.product_name,
      m.name as material_name_from_rel,
      m.stock as material_current_stock,
      p.name as product_name_from_rel
    FROM purchase_order_items poi
    LEFT JOIN materials m ON m.id = poi.material_id
    LEFT JOIN products p ON p.id = poi.product_id
    WHERE poi.purchase_order_id = p_po_id
  LOOP
    IF v_item.material_id IS NOT NULL THEN
      -- ==================== PROCESS MATERIAL ====================
      v_previous_stock := COALESCE(v_item.material_current_stock, 0);
      v_new_stock := v_previous_stock + v_item.quantity;

      -- Update material stock
      UPDATE materials
      SET stock = v_new_stock,
          updated_at = NOW()
      WHERE id = v_item.material_id;

      -- Create material movement record
      INSERT INTO material_stock_movements (
        material_id,
        material_name,
        type,
        reason,
        quantity,
        previous_stock,
        new_stock,
        reference_id,
        reference_type,
        notes,
        user_id,
        user_name,
        branch_id,
        created_at
      ) VALUES (
        v_item.material_id,
        COALESCE(v_item.material_name_from_rel, v_item.material_name, 'Unknown'),
        'IN',
        'PURCHASE',
        v_item.quantity,
        v_previous_stock,
        v_new_stock,
        p_po_id,
        'purchase_order',
        format('PO %s - Stock received', p_po_id),
        p_user_id,
        p_user_name,
        p_branch_id,
        NOW()
      );

      -- Create inventory batch for FIFO tracking
      INSERT INTO inventory_batches (
        material_id,
        branch_id,
        purchase_order_id,
        supplier_id,
        initial_quantity,
        remaining_quantity,
        unit_cost,
        batch_date,
        notes,
        created_at
      ) VALUES (
        v_item.material_id,
        p_branch_id,
        p_po_id,
        v_po.supplier_id,
        v_item.quantity,
        v_item.quantity,
        COALESCE(v_item.unit_price, 0),
        p_received_date,
        format('PO %s - %s', p_po_id, COALESCE(v_item.material_name_from_rel, v_item.material_name, 'Unknown')),
        NOW()
      );

      v_materials_received := v_materials_received + 1;
      v_batches_created := v_batches_created + 1;

    ELSIF v_item.product_id IS NOT NULL THEN
      -- ==================== PROCESS PRODUCT ====================
      -- products.current_stock is DEPRECATED - stock derived from inventory_batches
      -- Only create inventory_batches, stock will be calculated via v_product_current_stock VIEW

      -- Create inventory batch for FIFO tracking - this IS the stock
      INSERT INTO inventory_batches (
        product_id,
        branch_id,
        purchase_order_id,
        supplier_id,
        initial_quantity,
        remaining_quantity,
        unit_cost,
        batch_date,
        notes,
        created_at
      ) VALUES (
        v_item.product_id,
        p_branch_id,
        p_po_id,
        v_po.supplier_id,
        v_item.quantity,
        v_item.quantity,
        COALESCE(v_item.unit_price, 0),
        p_received_date,
        format('PO %s - %s', p_po_id, COALESCE(v_item.product_name_from_rel, v_item.product_name, 'Unknown')),
        NOW()
      );

      v_products_received := v_products_received + 1;
      v_batches_created := v_batches_created + 1;
    END IF;
  END LOOP;

  -- ==================== PROCESS LEGACY SINGLE-ITEM PO ====================
  -- For backward compatibility with old PO format (material_id on PO table)

  IF v_materials_received = 0 AND v_products_received = 0 AND v_po.material_id IS NOT NULL THEN
    -- Get current material stock
    SELECT stock INTO v_previous_stock
    FROM materials
    WHERE id = v_po.material_id;

    v_previous_stock := COALESCE(v_previous_stock, 0);
    v_new_stock := v_previous_stock + v_po.quantity;

    -- Update material stock
    UPDATE materials
    SET stock = v_new_stock,
        updated_at = NOW()
    WHERE id = v_po.material_id;

    -- Create material movement record
    INSERT INTO material_stock_movements (
      material_id,
      material_name,
      type,
      reason,
      quantity,
      previous_stock,
      new_stock,
      reference_id,
      reference_type,
      notes,
      user_id,
      user_name,
      branch_id,
      created_at
    ) VALUES (
      v_po.material_id,
      v_po.material_name,
      'IN',
      'PURCHASE',
      v_po.quantity,
      v_previous_stock,
      v_new_stock,
      p_po_id,
      'purchase_order',
      format('PO %s - Stock received (legacy)', p_po_id),
      p_user_id,
      p_user_name,
      p_branch_id,
      NOW()
    );

    -- Create inventory batch
    INSERT INTO inventory_batches (
      material_id,
      branch_id,
      purchase_order_id,
      supplier_id,
      initial_quantity,
      remaining_quantity,
      unit_cost,
      batch_date,
      notes,
      created_at
    ) VALUES (
      v_po.material_id,
      p_branch_id,
      p_po_id,
      v_po.supplier_id,
      v_po.quantity,
      v_po.quantity,
      COALESCE(v_po.unit_price, 0),
      p_received_date,
      format('PO %s - %s (legacy)', p_po_id, v_po.material_name),
      NOW()
    );

    v_materials_received := 1;
    v_batches_created := 1;
  END IF;

  -- ==================== UPDATE PO STATUS ====================

  UPDATE purchase_orders
  SET
    status = 'Diterima',
    received_date = p_received_date
  WHERE id = p_po_id;

  RETURN QUERY SELECT
    TRUE,
    v_materials_received,
    v_products_received,
    v_batches_created,
    NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0, 0, 0, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: receive_po_partial
-- Supports partial receiving of PO items
-- =====================================================
CREATE OR REPLACE FUNCTION public.receive_po_partial(
  p_po_id text,
  p_branch_id uuid,
  p_items jsonb,
  p_received_date date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_user_name text DEFAULT NULL
)
 RETURNS TABLE(success boolean, materials_received integer, products_received integer, batches_created integer, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_po RECORD;
  v_item_input JSONB;
  v_poi RECORD;
  v_materials_received INTEGER := 0;
  v_products_received INTEGER := 0;
  v_batches_created INTEGER := 0;
  v_previous_stock NUMERIC;
  v_new_stock NUMERIC;
  v_qty_to_receive NUMERIC;
  v_item_id TEXT;
  v_material_id UUID;
  v_product_id UUID;
  v_all_received BOOLEAN := TRUE;
BEGIN
  -- ==================== VALIDATION ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0, 'Branch ID is required'::TEXT;
    RETURN;
  END IF;

  IF p_po_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0, 'Purchase Order ID is required'::TEXT;
    RETURN;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0, 'Tidak ada item yang akan diterima'::TEXT;
    RETURN;
  END IF;

  -- Get PO info
  SELECT po.id, po.status, po.supplier_id, po.supplier_name, po.branch_id
  INTO v_po
  FROM purchase_orders po
  WHERE po.id = p_po_id AND po.branch_id = p_branch_id;

  IF v_po.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0, 'Purchase Order not found in this branch'::TEXT;
    RETURN;
  END IF;

  IF v_po.status NOT IN ('Approved', 'Pending', 'Dikirim') THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0,
      format('Status PO harus Approved, Pending, atau Dikirim. Status saat ini: %s', v_po.status)::TEXT;
    RETURN;
  END IF;

  -- ==================== PROCESS EACH ITEM ======================================
  FOR v_item_input IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := v_item_input->>'item_id';
    v_material_id := (v_item_input->>'material_id')::UUID;
    v_product_id := (v_item_input->>'product_id')::UUID;
    v_qty_to_receive := COALESCE((v_item_input->>'quantity')::NUMERIC, 0);

    IF v_qty_to_receive <= 0 THEN
      CONTINUE;
    END IF;

    -- Get the PO item record
    SELECT * INTO v_poi
    FROM purchase_order_items
    WHERE id = v_item_id AND purchase_order_id = p_po_id;

    IF v_poi.id IS NULL THEN
      CONTINUE; -- Skip items not found
    END IF;

    -- Validate: don't receive more than remaining
    IF v_qty_to_receive > (v_poi.quantity - COALESCE(v_poi.quantity_received, 0)) THEN
      v_qty_to_receive := v_poi.quantity - COALESCE(v_poi.quantity_received, 0);
    END IF;

    IF v_qty_to_receive <= 0 THEN
      CONTINUE;
    END IF;

    -- Update quantity_received on the PO item
    UPDATE purchase_order_items
    SET quantity_received = COALESCE(quantity_received, 0) + v_qty_to_receive,
        updated_at = NOW()
    WHERE id = v_item_id;

    -- Process based on item type
    IF v_material_id IS NOT NULL THEN
      -- ==================== MATERIAL ====================
      SELECT stock INTO v_previous_stock FROM materials WHERE id = v_material_id;
      v_previous_stock := COALESCE(v_previous_stock, 0);
      v_new_stock := v_previous_stock + v_qty_to_receive;

      -- Update material stock
      UPDATE materials
      SET stock = v_new_stock, updated_at = NOW()
      WHERE id = v_material_id;

      -- Create material movement record
      INSERT INTO material_stock_movements (
        material_id, material_name, type, reason, quantity,
        previous_stock, new_stock, reference_id, reference_type,
        notes, user_id, user_name, branch_id, created_at
      ) VALUES (
        v_material_id,
        COALESCE(v_poi.material_name, 'Unknown'),
        'IN', 'PURCHASE', v_qty_to_receive,
        v_previous_stock, v_new_stock,
        p_po_id, 'purchase_order',
        format('PO %s - Partial receive (%s)', p_po_id, COALESCE(p_notes, '')),
        p_user_id, p_user_name, p_branch_id, NOW()
      );

      -- Create inventory batch for FIFO tracking
      INSERT INTO inventory_batches (
        material_id, branch_id, purchase_order_id, supplier_id,
        initial_quantity, remaining_quantity, unit_cost,
        batch_date, notes, created_at
      ) VALUES (
        v_material_id, p_branch_id, p_po_id, v_po.supplier_id,
        v_qty_to_receive, v_qty_to_receive,
        COALESCE(v_poi.unit_price, 0),
        p_received_date,
        format('PO %s - %s (partial)', p_po_id, COALESCE(v_poi.material_name, 'Unknown')),
        NOW()
      );

      v_materials_received := v_materials_received + 1;
      v_batches_created := v_batches_created + 1;

    ELSIF v_product_id IS NOT NULL THEN
      -- ==================== PRODUCT ====================
      INSERT INTO inventory_batches (
        product_id, branch_id, purchase_order_id, supplier_id,
        initial_quantity, remaining_quantity, unit_cost,
        batch_date, notes, created_at
      ) VALUES (
        v_product_id, p_branch_id, p_po_id, v_po.supplier_id,
        v_qty_to_receive, v_qty_to_receive,
        COALESCE(v_poi.unit_price, 0),
        p_received_date,
        format('PO %s - %s (partial)', p_po_id, COALESCE(v_poi.product_name, 'Unknown')),
        NOW()
      );

      v_products_received := v_products_received + 1;
      v_batches_created := v_batches_created + 1;
    END IF;
  END LOOP;

  -- ==================== CHECK IF ALL ITEMS FULLY RECEIVED ====================
  SELECT bool_and(COALESCE(quantity_received, 0) >= quantity) INTO v_all_received
  FROM purchase_order_items
  WHERE purchase_order_id = p_po_id;

  -- Update PO status
  IF v_all_received THEN
    UPDATE purchase_orders
    SET status = 'Diterima', received_date = p_received_date
    WHERE id = p_po_id;
  ELSE
    -- Keep status or move to Dikirim if was Approved
    IF v_po.status = 'Approved' OR v_po.status = 'Pending' THEN
      UPDATE purchase_orders
      SET status = 'Dikirim', received_date = NULL
      WHERE id = p_po_id;
    END IF;
  END IF;

  RETURN QUERY SELECT
    TRUE,
    v_materials_received,
    v_products_received,
    v_batches_created,
    NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0, 0, 0, SQLERRM::TEXT;
END;
$function$;

