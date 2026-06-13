-- Prevent duplicate delivery creation for the same transaction within a short window
-- Applies duplicate guard to both process_delivery_atomic and process_delivery_atomic_no_stock

CREATE OR REPLACE FUNCTION public.process_delivery_atomic(
  p_transaction_id text,
  p_items jsonb,
  p_branch_id uuid,
  p_driver_id uuid DEFAULT NULL::uuid,
  p_helper_id uuid DEFAULT NULL::uuid,
  p_delivery_date timestamp with time zone DEFAULT now(),
  p_notes text DEFAULT NULL::text,
  p_photo_url text DEFAULT NULL::text,
  p_helper_id_2 uuid DEFAULT NULL::uuid,
  p_helper_id_3 uuid DEFAULT NULL::uuid
)
RETURNS TABLE(success boolean, delivery_id uuid, delivery_number integer, total_hpp numeric, journal_id uuid, error_message text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_delivery_id UUID; v_transaction RECORD; v_item JSONB; v_consume_result RECORD; v_total_hpp_real NUMERIC := 0;
  v_journal_id UUID; v_acc_tertahan TEXT; v_acc_persediaan TEXT; v_delivery_number INTEGER; v_product_id UUID;
  v_qty NUMERIC; v_product_name TEXT; v_is_bonus BOOLEAN; v_total_ordered NUMERIC; v_total_delivered NUMERIC;
  v_new_status TEXT; v_entry_number TEXT; v_counter_int INTEGER; v_item_type TEXT; v_material_id UUID;
  v_existing_delivery RECORD;
BEGIN
  IF p_branch_id IS NULL THEN RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, NULL::UUID, 'Branch ID is REQUIRED'::TEXT; RETURN; END IF;
  IF p_transaction_id IS NULL THEN RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, NULL::UUID, 'Transaction ID is required'::TEXT; RETURN; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('delivery:' || p_transaction_id));

  SELECT * INTO v_transaction FROM transactions WHERE id = p_transaction_id;
  IF v_transaction.id IS NULL THEN RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, NULL::UUID, 'Transaction not found'::TEXT; RETURN; END IF;

  SELECT d.id, d.delivery_number
  INTO v_existing_delivery
  FROM deliveries d
  WHERE d.transaction_id = p_transaction_id
    AND d.branch_id = p_branch_id
    AND d.created_at >= NOW() - INTERVAL '30 seconds'
  ORDER BY d.created_at DESC
  LIMIT 1;

  IF v_existing_delivery.id IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, v_existing_delivery.id, v_existing_delivery.delivery_number, 0::NUMERIC, NULL::UUID, 'Duplicate submit ignored - existing delivery returned'::TEXT;
    RETURN;
  END IF;

  SELECT COALESCE(MAX(d.delivery_number), 0) + 1 INTO v_delivery_number FROM deliveries d WHERE d.transaction_id = p_transaction_id;

  INSERT INTO deliveries (transaction_id, delivery_number, branch_id, status, customer_name, driver_id, helper_id, helper_id_2, helper_id_3, delivery_date, notes, photo_url, created_at, updated_at)
  VALUES (p_transaction_id, v_delivery_number, p_branch_id, 'delivered', v_transaction.customer_name, p_driver_id, p_helper_id, p_helper_id_2, p_helper_id_3, p_delivery_date, COALESCE(p_notes, format('Pengiriman ke-%s', v_delivery_number)), p_photo_url, NOW(), NOW())
  RETURNING id INTO v_delivery_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_product_id := NULL; v_material_id := NULL; v_qty := (v_item->>'quantity')::NUMERIC; v_product_name := v_item->>'product_name'; v_is_bonus := COALESCE((v_item->>'is_bonus')::BOOLEAN, FALSE); v_item_type := v_item->>'item_type';
        IF (v_item->>'product_id') LIKE 'material-%' THEN v_material_id := (v_item->>'material_id')::UUID; ELSE v_product_id := (v_item->>'product_id')::UUID; END IF;

        IF v_qty > 0 THEN
           INSERT INTO delivery_items (delivery_id, product_id, product_name, quantity_delivered, unit, is_bonus, notes, width, height, created_at)
           VALUES (v_delivery_id, v_product_id, v_product_name, v_qty, COALESCE(v_item->>'unit', 'pcs'), v_is_bonus, v_item->>'notes', (v_item->>'width')::NUMERIC, (v_item->>'height')::NUMERIC, NOW());

           IF NOT v_transaction.is_office_sale THEN
                IF v_material_id IS NOT NULL THEN
                  SELECT * INTO v_consume_result FROM consume_material_fifo_v2(v_material_id, v_qty, COALESCE(v_transaction.ref, p_transaction_id), 'delivery', p_branch_id);
                  IF NOT v_consume_result.success THEN RAISE EXCEPTION 'Gagal potong stok material: %', v_consume_result.error_message; END IF;
                  v_total_hpp_real := v_total_hpp_real + COALESCE(v_consume_result.total_cost, 0);
                ELSIF v_product_id IS NOT NULL THEN
                  SELECT * INTO v_consume_result FROM consume_stock_fifo_v2(v_product_id, v_qty, COALESCE(v_transaction.ref, p_transaction_id), 'delivery', p_branch_id);
                  IF NOT v_consume_result.success THEN RAISE EXCEPTION 'Gagal potong stok produk: %', v_consume_result.error_message; END IF;
                  v_total_hpp_real := v_total_hpp_real + COALESCE(v_consume_result.total_hpp, 0);
                END IF;
           END IF;
        END IF;
    END LOOP;

  UPDATE deliveries SET hpp_total = v_total_hpp_real WHERE id = v_delivery_id;

  SELECT COALESCE(SUM((item->>'quantity')::NUMERIC), 0) INTO v_total_ordered FROM jsonb_array_elements(v_transaction.items) item WHERE NOT COALESCE((item->>'_isSalesMeta')::BOOLEAN, FALSE);
  SELECT COALESCE(SUM(di.quantity_delivered), 0) INTO v_total_delivered FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id WHERE d.transaction_id = p_transaction_id;

  IF v_total_delivered >= v_total_ordered THEN v_new_status := 'Selesai'; ELSE v_new_status := 'Diantar Sebagian'; END IF;
  UPDATE transactions SET status = v_new_status, delivery_status = 'delivered', delivered_at = NOW(), updated_at = NOW() WHERE id = p_transaction_id;

  IF NOT v_transaction.is_office_sale AND v_total_hpp_real > 0 THEN
      SELECT id INTO v_acc_tertahan FROM accounts WHERE code = '2140' AND branch_id = p_branch_id LIMIT 1;
      IF v_acc_tertahan IS NULL THEN SELECT id INTO v_acc_tertahan FROM accounts WHERE name ILIKE '%Hutang Barang%' AND branch_id = p_branch_id LIMIT 1; END IF;
      SELECT id INTO v_acc_persediaan FROM accounts WHERE code = '1310' AND branch_id = p_branch_id LIMIT 1;

      IF v_acc_tertahan IS NOT NULL AND v_acc_persediaan IS NOT NULL THEN
         SELECT COUNT(*) INTO v_counter_int FROM journal_entries WHERE branch_id = p_branch_id AND DATE(entry_date) = DATE(p_delivery_date);
         LOOP
            v_counter_int := v_counter_int + 1;
            v_entry_number := 'JE-DEL-' || TO_CHAR(p_delivery_date, 'YYYYMMDD') || '-' || LPAD(v_counter_int::TEXT, 4, '0');
            BEGIN
                INSERT INTO journal_entries (entry_number, entry_date, description, reference_type, reference_id, branch_id, status, total_debit, total_credit)
                VALUES (v_entry_number, p_delivery_date, format('Pengiriman %s [Order %s]', COALESCE(v_transaction.ref, ''), p_transaction_id), 'transaction', v_delivery_id::TEXT, p_branch_id, 'posted', v_total_hpp_real, v_total_hpp_real) RETURNING id INTO v_journal_id;
                EXIT;
            EXCEPTION WHEN unique_violation THEN END;
         END LOOP;
         INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, description, debit_amount, credit_amount) VALUES (v_journal_id, 1, v_acc_tertahan, 'Realisasi Pengiriman', v_total_hpp_real, 0);
         INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, description, debit_amount, credit_amount) VALUES (v_journal_id, 2, v_acc_persediaan, 'Barang Keluar Gudang', 0, v_total_hpp_real);
      END IF;
  END IF;

  IF p_driver_id IS NOT NULL OR p_helper_id IS NOT NULL OR p_helper_id_2 IS NOT NULL OR p_helper_id_3 IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_product_id := (v_item->>'product_id')::UUID; v_qty := (v_item->>'quantity')::NUMERIC; v_product_name := v_item->>'product_name'; v_is_bonus := COALESCE((v_item->>'is_bonus')::BOOLEAN, FALSE);
      IF v_qty > 0 AND NOT v_is_bonus THEN
        IF p_driver_id IS NOT NULL THEN INSERT INTO commission_entries (user_id, user_name, role, product_id, product_name, quantity, rate_per_qty, amount, transaction_id, delivery_id, ref, status, branch_id, created_at) SELECT p_driver_id, (SELECT full_name FROM profiles WHERE id = p_driver_id), 'driver', v_product_id, v_product_name, v_qty, cr.rate_per_qty, v_qty * cr.rate_per_qty, p_transaction_id, v_delivery_id, 'DEL-' || v_delivery_id, 'pending', p_branch_id, NOW() FROM commission_rules cr WHERE cr.product_id = v_product_id AND cr.role = 'driver' AND cr.rate_per_qty > 0; END IF;
        IF p_helper_id IS NOT NULL THEN INSERT INTO commission_entries (user_id, user_name, role, product_id, product_name, quantity, rate_per_qty, amount, transaction_id, delivery_id, ref, status, branch_id, created_at) SELECT p_helper_id, (SELECT full_name FROM profiles WHERE id = p_helper_id), 'helper', v_product_id, v_product_name, v_qty, cr.rate_per_qty, v_qty * cr.rate_per_qty, p_transaction_id, v_delivery_id, 'DEL-' || v_delivery_id, 'pending', p_branch_id, NOW() FROM commission_rules cr WHERE cr.product_id = v_product_id AND cr.role = 'helper' AND cr.rate_per_qty > 0; END IF;
        IF p_helper_id_2 IS NOT NULL THEN INSERT INTO commission_entries (user_id, user_name, role, product_id, product_name, quantity, rate_per_qty, amount, transaction_id, delivery_id, ref, status, branch_id, created_at) SELECT p_helper_id_2, (SELECT full_name FROM profiles WHERE id = p_helper_id_2), 'helper', v_product_id, v_product_name, v_qty, cr.rate_per_qty, v_qty * cr.rate_per_qty, p_transaction_id, v_delivery_id, 'DEL-' || v_delivery_id, 'pending', p_branch_id, NOW() FROM commission_rules cr WHERE cr.product_id = v_product_id AND cr.role = 'helper' AND cr.rate_per_qty > 0; END IF;
        IF p_helper_id_3 IS NOT NULL THEN INSERT INTO commission_entries (user_id, user_name, role, product_id, product_name, quantity, rate_per_qty, amount, transaction_id, delivery_id, ref, status, branch_id, created_at) SELECT p_helper_id_3, (SELECT full_name FROM profiles WHERE id = p_helper_id_3), 'helper', v_product_id, v_product_name, v_qty, cr.rate_per_qty, v_qty * cr.rate_per_qty, p_transaction_id, v_delivery_id, 'DEL-' || v_delivery_id, 'pending', p_branch_id, NOW() FROM commission_rules cr WHERE cr.product_id = v_product_id AND cr.role = 'helper' AND cr.rate_per_qty > 0; END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN QUERY SELECT TRUE, v_delivery_id, v_delivery_number, v_total_hpp_real, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, NULL::UUID, SQLERRM::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_delivery_atomic_no_stock(
  p_transaction_id text,
  p_items jsonb,
  p_branch_id uuid,
  p_driver_id uuid DEFAULT NULL::uuid,
  p_helper_id uuid DEFAULT NULL::uuid,
  p_delivery_date timestamp with time zone DEFAULT now(),
  p_notes text DEFAULT NULL::text,
  p_photo_url text DEFAULT NULL::text,
  p_helper_id_2 uuid DEFAULT NULL::uuid,
  p_helper_id_3 uuid DEFAULT NULL::uuid
)
RETURNS TABLE(success boolean, delivery_id uuid, delivery_number integer, total_hpp numeric, journal_id uuid, error_message text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_delivery_id UUID;
  v_delivery_number INTEGER;
  v_transaction RECORD;
  v_item JSONB;
  v_total_ordered NUMERIC;
  v_total_delivered NUMERIC;
  v_new_status TEXT;
  v_existing_delivery RECORD;
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, NULL::UUID, 'Branch ID is REQUIRED'::TEXT;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('delivery:' || p_transaction_id));

  SELECT id, customer_name, customer_address, customer_phone, items INTO v_transaction FROM transactions WHERE id = p_transaction_id AND branch_id = p_branch_id;
  IF v_transaction.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, NULL::UUID, 'Transaction not found'::TEXT;
    RETURN;
  END IF;

  SELECT d.id, d.delivery_number
  INTO v_existing_delivery
  FROM deliveries d
  WHERE d.transaction_id = p_transaction_id
    AND d.branch_id = p_branch_id
    AND d.created_at >= NOW() - INTERVAL '30 seconds'
  ORDER BY d.created_at DESC
  LIMIT 1;

  IF v_existing_delivery.id IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, v_existing_delivery.id, v_existing_delivery.delivery_number, 0::NUMERIC, NULL::UUID, 'Duplicate submit ignored - existing delivery returned'::TEXT;
    RETURN;
  END IF;

  SELECT COALESCE(MAX(d.delivery_number), 0) + 1 INTO v_delivery_number FROM deliveries d WHERE d.transaction_id = p_transaction_id;

  INSERT INTO deliveries (
    transaction_id, delivery_number, branch_id, customer_name, driver_id, helper_id, helper_id_2, helper_id_3, delivery_date, status, notes, photo_url, created_at, updated_at
  ) VALUES (
    p_transaction_id, v_delivery_number, p_branch_id, v_transaction.customer_name, p_driver_id, p_helper_id, p_helper_id_2, p_helper_id_3, p_delivery_date, 'delivered', COALESCE(p_notes, format('Pengiriman ke-%s (Migrasi)', v_delivery_number)), p_photo_url, NOW(), NOW()
  ) RETURNING id INTO v_delivery_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO delivery_items (delivery_id, product_id, product_name, quantity_delivered, unit, is_bonus, notes, width, height, created_at)
    VALUES (v_delivery_id, (v_item->>'product_id')::UUID, v_item->>'product_name', (v_item->>'quantity')::NUMERIC, v_item->>'unit', COALESCE((v_item->>'is_bonus')::BOOLEAN, FALSE), v_item->>'notes', (v_item->>'width')::NUMERIC, (v_item->>'height')::NUMERIC, NOW());
  END LOOP;

  SELECT COALESCE(SUM((item->>'quantity')::NUMERIC), 0) INTO v_total_ordered FROM jsonb_array_elements(v_transaction.items) item;
  SELECT COALESCE(SUM(di.quantity_delivered), 0) INTO v_total_delivered FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id WHERE d.transaction_id = p_transaction_id;

  IF v_total_delivered >= v_total_ordered THEN v_new_status := 'Selesai'; ELSE v_new_status := 'Diantar Sebagian'; END IF;
  UPDATE transactions SET status = v_new_status WHERE id = p_transaction_id;

  RETURN QUERY SELECT TRUE, v_delivery_id, v_delivery_number, 0::NUMERIC, NULL::UUID, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, NULL::UUID, SQLERRM::TEXT;
END;
$$;
