-- =====================================================
-- 03 DELIVERY
-- Generated: 2026-01-09T00:29:07.859Z
-- Total functions: 15
-- =====================================================

-- Functions in this file:
--   generate_delivery_number
--   get_delivery_summary
--   get_delivery_with_employees
--   get_transactions_ready_for_delivery
--   get_undelivered_goods_liability
--   insert_delivery
--   process_delivery_atomic
--   process_delivery_atomic
--   process_delivery_atomic_no_stock
--   process_delivery_atomic_no_stock
--   process_migration_delivery_journal
--   update_delivery_atomic
--   update_transaction_delivery_status
--   update_transaction_status_from_delivery
--   void_delivery_atomic

-- =====================================================
-- Function: generate_delivery_number
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_delivery_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
DECLARE
  next_number INTEGER;
BEGIN
  -- Get the next delivery number for this transaction
  SELECT COALESCE(MAX(delivery_number), 0) + 1 
  INTO next_number
  FROM deliveries 
  WHERE transaction_id = NEW.transaction_id;
  
  -- Set the delivery number
  NEW.delivery_number = next_number;
  
  RETURN NEW;
END;
$function$;


-- =====================================================
-- Function: get_delivery_summary
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_delivery_summary(transaction_id_param text) RETURNS TABLE(product_id uuid, product_name text, is_bonus boolean, ordered_quantity integer, delivered_quantity integer, remaining_quantity integer, unit text, width numeric, height numeric)
    LANGUAGE plpgsql
    AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    p.product_id,
    p.product_name,
    p.is_bonus,
    p.ordered_quantity::INTEGER,
    COALESCE(di_summary.delivered_quantity, 0)::INTEGER,
    (p.ordered_quantity - COALESCE(di_summary.delivered_quantity, 0))::INTEGER,
    p.unit,
    p.width,
    p.height
  FROM (
    SELECT 
      COALESCE((item->>'productId')::uuid, (item->'product'->>'id')::uuid) as product_id,
      COALESCE(item->>'productName', item->'product'->>'name') as product_name,
      COALESCE((item->>'isBonus')::boolean, (item->>'is_bonus')::boolean, false) as is_bonus,
      (item->>'quantity')::integer as ordered_quantity,
      item->>'unit' as unit,
      (item->>'width')::numeric as width,
      (item->>'height')::numeric as height
    FROM transactions t
    CROSS JOIN LATERAL jsonb_array_elements(t.items) AS item
    WHERE t.id = transaction_id_param
    AND NOT COALESCE((item->>'_isSalesMeta')::boolean, (item->>'_isMigrationMeta')::boolean, false)
  ) p
  LEFT JOIN (
    SELECT 
      di.product_id,
      di.is_bonus,
      SUM(di.quantity_delivered) as delivered_quantity
    FROM deliveries d
    JOIN delivery_items di ON di.delivery_id = d.id
    WHERE d.transaction_id = transaction_id_param
    GROUP BY di.product_id, di.is_bonus
  ) di_summary ON di_summary.product_id = p.product_id 
               AND (di_summary.is_bonus = p.is_bonus OR (di_summary.is_bonus IS NULL AND p.is_bonus = false));
END;
$function$;


-- =====================================================
-- Function: get_delivery_with_employees
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_delivery_with_employees(delivery_id_param uuid) RETURNS TABLE(id uuid, transaction_id text, delivery_number integer, delivery_date timestamp with time zone, photo_url text, photo_drive_id text, notes text, driver_name text, helper_name text, created_at timestamp with time zone, updated_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    d.id,
    d.transaction_id,
    d.delivery_number,
    d.delivery_date,
    d.photo_url,
    d.photo_drive_id,
    d.notes,
    driver.name as driver_name,
    helper.name as helper_name,
    d.created_at,
    d.updated_at
  FROM deliveries d
  LEFT JOIN employees driver ON d.driver_id = driver.id
  LEFT JOIN employees helper ON d.helper_id = helper.id
  WHERE d.id = delivery_id_param;
END;
$function$;


-- =====================================================
-- Function: get_transactions_ready_for_delivery
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_transactions_ready_for_delivery() RETURNS TABLE(id text, customer_name text, order_date timestamp with time zone, items jsonb, total numeric, status text)
    LANGUAGE plpgsql
    AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    t.id,
    t.customer_name,
    t.order_date,
    t.items,
    t.total,
    t.status
  FROM transactions t
  WHERE t.status IN ('Siap Antar', 'Diantar Sebagian')
    AND (t.is_office_sale IS NULL OR t.is_office_sale = false)
  ORDER BY t.order_date ASC;
END;
$function$;


-- =====================================================
-- Function: get_undelivered_goods_liability
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_undelivered_goods_liability(p_branch_id uuid DEFAULT NULL::uuid) RETURNS TABLE(transaction_id text, customer_name text, transaction_total numeric, delivered_total numeric, undelivered_total numeric, status text, order_date timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $function$
BEGIN
  RETURN QUERY
  WITH delivered_qty AS (
    SELECT 
      d.transaction_id as txn_id,
      di.product_id,
      SUM(di.quantity_delivered) as qty_delivered
    FROM deliveries d
    JOIN delivery_items di ON di.delivery_id = d.id
    WHERE (p_branch_id IS NULL OR d.branch_id = p_branch_id)
    GROUP BY d.transaction_id, di.product_id
  ),
  transaction_items AS (
    SELECT 
      t.id as txn_id,
      t.customer_name as cust_name,
      t.total as txn_total,
      t.status as txn_status,
      t.order_date as txn_date,
      (item->>'quantity')::numeric as qty_ordered,
      item->'product'->>'id' as prod_id,
      (item->>'price')::numeric as unit_price,
      item->>'isBonus' as is_bonus
    FROM transactions t
    CROSS JOIN LATERAL jsonb_array_elements(t.items) as item
    WHERE t.is_office_sale = false
    AND t.status NOT IN ('cancelled', 'Selesai', 'complete')
    AND (p_branch_id IS NULL OR t.branch_id = p_branch_id)
  ),
  undelivered AS (
    SELECT 
      ti.txn_id,
      ti.cust_name,
      ti.txn_total,
      ti.txn_status,
      ti.txn_date,
      ti.prod_id,
      COALESCE(ti.qty_ordered, 0) as qty_ordered,
      COALESCE(dq.qty_delivered, 0) as qty_delivered,
      COALESCE(ti.unit_price, 0) as unit_price,
      ti.is_bonus
    FROM transaction_items ti
    LEFT JOIN delivered_qty dq ON dq.txn_id = ti.txn_id AND dq.product_id::text = ti.prod_id
    WHERE ti.is_bonus != 'true' OR ti.is_bonus IS NULL
  )
  SELECT 
    u.txn_id::TEXT as transaction_id,
    u.cust_name::TEXT as customer_name,
    u.txn_total as transaction_total,
    SUM(u.qty_delivered * u.unit_price) as delivered_total,
    SUM((u.qty_ordered - u.qty_delivered) * u.unit_price) as undelivered_total,
    u.txn_status::TEXT as status,
    u.txn_date as order_date
  FROM undelivered u
  WHERE u.qty_ordered > u.qty_delivered
  GROUP BY u.txn_id, u.cust_name, u.txn_total, u.txn_status, u.txn_date
  HAVING SUM((u.qty_ordered - u.qty_delivered) * u.unit_price) > 0
  ORDER BY SUM((u.qty_ordered - u.qty_delivered) * u.unit_price) DESC;
END;
$function$;


-- =====================================================
-- Function: insert_delivery
-- =====================================================
CREATE OR REPLACE FUNCTION public.insert_delivery(p_transaction_id text, p_delivery_number integer, p_customer_name text, p_customer_address text DEFAULT ''::text, p_customer_phone text DEFAULT ''::text, p_delivery_date timestamp with time zone DEFAULT now(), p_photo_url text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_driver_id uuid DEFAULT NULL::uuid, p_helper_id uuid DEFAULT NULL::uuid, p_branch_id uuid DEFAULT NULL::uuid) RETURNS TABLE(id uuid, transaction_id text, delivery_number integer, customer_name text, customer_address text, customer_phone text, delivery_date timestamp with time zone, photo_url text, notes text, driver_id uuid, helper_id uuid, branch_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $function$
DECLARE
  new_id UUID;
BEGIN
  INSERT INTO deliveries (
    transaction_id,
    delivery_number,
    customer_name,
    customer_address,
    customer_phone,
    delivery_date,
    photo_url,
    notes,
    driver_id,
    helper_id,
    branch_id
  )
  VALUES (
    p_transaction_id,
    p_delivery_number,
    p_customer_name,
    p_customer_address,
    p_customer_phone,
    p_delivery_date,
    p_photo_url,
    p_notes,
    p_driver_id,
    p_helper_id,
    p_branch_id
  )
  RETURNING deliveries.id INTO new_id;
  -- Return full row
  RETURN QUERY
  SELECT
    d.id,
    d.transaction_id,
    d.delivery_number,
    d.customer_name,
    d.customer_address,
    d.customer_phone,
    d.delivery_date,
    d.photo_url,
    d.notes,
    d.driver_id,
    d.helper_id,
    d.branch_id,
    d.created_at,
    d.updated_at
  FROM deliveries d
  WHERE d.id = new_id;
END;
$function$;


-- =====================================================
-- Function: process_delivery_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.process_delivery_atomic(p_transaction_id text, p_items jsonb, p_branch_id uuid, p_driver_id uuid DEFAULT NULL::uuid, p_helper_id uuid DEFAULT NULL::uuid, p_delivery_date timestamp with time zone DEFAULT now(), p_notes text DEFAULT NULL::text, p_photo_url text DEFAULT NULL::text, p_helper_id_2 uuid DEFAULT NULL::uuid, p_helper_id_3 uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, delivery_id uuid, delivery_number integer, total_hpp numeric, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $function$
DECLARE
  v_delivery_id UUID;
  v_transaction RECORD;
  v_item JSONB;
  v_consume_result RECORD;
  v_total_hpp_real NUMERIC := 0; 
  v_journal_id UUID;
  v_acc_tertahan TEXT;
  v_acc_persediaan TEXT;
  v_delivery_number INTEGER;
  v_product_id UUID;
  v_qty NUMERIC;
  v_product_name TEXT;
  v_is_bonus BOOLEAN;
  v_total_ordered NUMERIC;
  v_total_delivered NUMERIC;
  v_new_status TEXT;
  v_entry_number TEXT;
  v_counter_int INTEGER;
  v_item_type TEXT;
  v_material_id UUID;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, NULL::UUID, 'Branch ID is REQUIRED'::TEXT;
    RETURN;
  END IF;

  IF p_transaction_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, NULL::UUID, 'Transaction ID is required'::TEXT;
    RETURN;
  END IF;

  SELECT * INTO v_transaction FROM transactions WHERE id = p_transaction_id;
  IF v_transaction.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, NULL::UUID, 'Transaction not found'::TEXT;
    RETURN;
  END IF;

  -- ==================== CREATE DELIVERY HEADER ====================
  SELECT COALESCE(MAX(d.delivery_number), 0) + 1 INTO v_delivery_number 
  FROM deliveries d 
  WHERE d.transaction_id = p_transaction_id;

  INSERT INTO deliveries (
    transaction_id, delivery_number, branch_id, status, 
    customer_name, customer_address, customer_phone,
    driver_id, helper_id, helper_id_2, helper_id_3, delivery_date, notes, photo_url,
    created_at, updated_at
  )
  VALUES (
    p_transaction_id, v_delivery_number, p_branch_id, 'delivered',
    v_transaction.customer_name, NULL, NULL,
    p_driver_id, p_helper_id, p_helper_id_2, p_helper_id_3, p_delivery_date, 
    COALESCE(p_notes, format('Pengiriman ke-%s', v_delivery_number)), p_photo_url,
    NOW(), NOW()
  )
  RETURNING id INTO v_delivery_id;

  -- ==================== CONSUME STOCK & ITEMS ====================
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_product_id := NULL;
        v_material_id := NULL;
        v_qty := (v_item->>'quantity')::NUMERIC;
        v_product_name := v_item->>'product_name';
        v_is_bonus := COALESCE((v_item->>'is_bonus')::BOOLEAN, FALSE);
        v_item_type := v_item->>'item_type';

        IF (v_item->>'product_id') LIKE 'material-%' THEN
          v_material_id := (v_item->>'material_id')::UUID;
        ELSE
          v_product_id := (v_item->>'product_id')::UUID;
        END IF;

        IF v_qty > 0 THEN
           INSERT INTO delivery_items (
             delivery_id, product_id, product_name, quantity_delivered, unit, is_bonus, notes, width, height, created_at
           ) VALUES (
             v_delivery_id, v_product_id, v_product_name, v_qty, 
             COALESCE(v_item->>'unit', 'pcs'), v_is_bonus, v_item->>'notes', 
             (v_item->>'width')::NUMERIC, (v_item->>'height')::NUMERIC, NOW()
           );
           
           IF NOT v_transaction.is_office_sale THEN
                IF v_material_id IS NOT NULL THEN
                  SELECT * INTO v_consume_result FROM consume_material_fifo_v2(
                    v_material_id, v_qty, COALESCE(v_transaction.ref, p_transaction_id), 'delivery', p_branch_id
                  );
                  IF NOT v_consume_result.success THEN RAISE EXCEPTION 'Gagal potong stok material: %', v_consume_result.error_message; END IF;
                  v_total_hpp_real := v_total_hpp_real + COALESCE(v_consume_result.total_cost, 0);
                ELSIF v_product_id IS NOT NULL THEN
                  SELECT * INTO v_consume_result FROM consume_stock_fifo_v2(
                    v_product_id, v_qty, COALESCE(v_transaction.ref, p_transaction_id), 'delivery', p_branch_id
                  );
                  IF NOT v_consume_result.success THEN RAISE EXCEPTION 'Gagal potong stok produk: %', v_consume_result.error_message; END IF;
                  v_total_hpp_real := v_total_hpp_real + COALESCE(v_consume_result.total_hpp, 0);
                END IF;
           END IF;
        END IF;
    END LOOP;

  UPDATE deliveries SET hpp_total = v_total_hpp_real WHERE id = v_delivery_id;

  -- ==================== UPDATE TRANSACTION STATUS ====================
  SELECT COALESCE(SUM((item->>'quantity')::NUMERIC), 0) INTO v_total_ordered
  FROM jsonb_array_elements(v_transaction.items) item
  WHERE NOT COALESCE((item->>'_isSalesMeta')::BOOLEAN, FALSE);

  SELECT COALESCE(SUM(di.quantity_delivered), 0) INTO v_total_delivered
  FROM delivery_items di
  JOIN deliveries d ON d.id = di.delivery_id
  WHERE d.transaction_id = p_transaction_id;

  IF v_total_delivered >= v_total_ordered THEN
    v_new_status := 'Selesai';
  ELSE
    v_new_status := 'Diantar Sebagian';
  END IF;

  UPDATE transactions
  SET status = v_new_status, delivery_status = 'delivered', delivered_at = NOW(), updated_at = NOW()
  WHERE id = p_transaction_id;

  -- ==================== JOURNAL ENTRY ====================
  IF NOT v_transaction.is_office_sale AND v_total_hpp_real > 0 THEN
      SELECT id INTO v_acc_tertahan FROM accounts WHERE code = '2140' AND branch_id = p_branch_id LIMIT 1;
      IF v_acc_tertahan IS NULL THEN
        SELECT id INTO v_acc_tertahan FROM accounts WHERE name ILIKE '%Hutang Barang%' AND branch_id = p_branch_id LIMIT 1;
      END IF;
      SELECT id INTO v_acc_persediaan FROM accounts WHERE code = '1310' AND branch_id = p_branch_id LIMIT 1;

      IF v_acc_tertahan IS NOT NULL AND v_acc_persediaan IS NOT NULL THEN
         SELECT COUNT(*) INTO v_counter_int FROM journal_entries WHERE branch_id = p_branch_id AND DATE(entry_date) = DATE(p_delivery_date);
         LOOP
            v_counter_int := v_counter_int + 1;
            v_entry_number := 'JE-DEL-' || TO_CHAR(p_delivery_date, 'YYYYMMDD') || '-' || LPAD(v_counter_int::TEXT, 4, '0');
            BEGIN
                INSERT INTO journal_entries (
                  entry_number, entry_date, description, reference_type, reference_id, branch_id, status, total_debit, total_credit
                ) VALUES (
                  v_entry_number, p_delivery_date, format('Pengiriman %s [Order %s]', COALESCE(v_transaction.ref, ''), p_transaction_id), 'transaction', v_delivery_id::TEXT, p_branch_id, 'posted', v_total_hpp_real, v_total_hpp_real
                ) RETURNING id INTO v_journal_id;
                EXIT;
            EXCEPTION WHEN unique_violation THEN END;
         END LOOP;
         INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, description, debit_amount, credit_amount)
         VALUES (v_journal_id, 1, v_acc_tertahan, 'Realisasi Pengiriman', v_total_hpp_real, 0);
         INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, description, debit_amount, credit_amount)
         VALUES (v_journal_id, 2, v_acc_persediaan, 'Barang Keluar Gudang', 0, v_total_hpp_real);
      END IF;
  END IF;

  -- ==================== GENERATE COMMISSIONS ====================
  IF p_driver_id IS NOT NULL OR p_helper_id IS NOT NULL OR p_helper_id_2 IS NOT NULL OR p_helper_id_3 IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_product_id := (v_item->>'product_id')::UUID;
      v_qty := (v_item->>'quantity')::NUMERIC;
      v_product_name := v_item->>'product_name';
      v_is_bonus := COALESCE((v_item->>'is_bonus')::BOOLEAN, FALSE);
      IF v_qty > 0 AND NOT v_is_bonus THEN
        IF p_driver_id IS NOT NULL THEN
          INSERT INTO commission_entries (user_id, user_name, role, product_id, product_name, quantity, rate_per_qty, amount, transaction_id, delivery_id, ref, status, branch_id, created_at)
          SELECT p_driver_id, (SELECT full_name FROM profiles WHERE id = p_driver_id), 'driver', v_product_id, v_product_name, v_qty, cr.rate_per_qty, v_qty * cr.rate_per_qty, p_transaction_id, v_delivery_id, 'DEL-' || v_delivery_id, 'pending', p_branch_id, NOW()
          FROM commission_rules cr WHERE cr.product_id = v_product_id AND cr.role = 'driver' AND cr.rate_per_qty > 0;
        END IF;
        IF p_helper_id IS NOT NULL THEN
          INSERT INTO commission_entries (user_id, user_name, role, product_id, product_name, quantity, rate_per_qty, amount, transaction_id, delivery_id, ref, status, branch_id, created_at)
          SELECT p_helper_id, (SELECT full_name FROM profiles WHERE id = p_helper_id), 'helper', v_product_id, v_product_name, v_qty, cr.rate_per_qty, v_qty * cr.rate_per_qty, p_transaction_id, v_delivery_id, 'DEL-' || v_delivery_id, 'pending', p_branch_id, NOW()
          FROM commission_rules cr WHERE cr.product_id = v_product_id AND cr.role = 'helper' AND cr.rate_per_qty > 0;
        END IF;
        IF p_helper_id_2 IS NOT NULL THEN
          INSERT INTO commission_entries (user_id, user_name, role, product_id, product_name, quantity, rate_per_qty, amount, transaction_id, delivery_id, ref, status, branch_id, created_at)
          SELECT p_helper_id_2, (SELECT full_name FROM profiles WHERE id = p_helper_id_2), 'helper', v_product_id, v_product_name, v_qty, cr.rate_per_qty, v_qty * cr.rate_per_qty, p_transaction_id, v_delivery_id, 'DEL-' || v_delivery_id, 'pending', p_branch_id, NOW()
          FROM commission_rules cr WHERE cr.product_id = v_product_id AND cr.role = 'helper' AND cr.rate_per_qty > 0;
        END IF;
        IF p_helper_id_3 IS NOT NULL THEN
          INSERT INTO commission_entries (user_id, user_name, role, product_id, product_name, quantity, rate_per_qty, amount, transaction_id, delivery_id, ref, status, branch_id, created_at)
          SELECT p_helper_id_3, (SELECT full_name FROM profiles WHERE id = p_helper_id_3), 'helper', v_product_id, v_product_name, v_qty, cr.rate_per_qty, v_qty * cr.rate_per_qty, p_transaction_id, v_delivery_id, 'DEL-' || v_delivery_id, 'pending', p_branch_id, NOW()
          FROM commission_rules cr WHERE cr.product_id = v_product_id AND cr.role = 'helper' AND cr.rate_per_qty > 0;
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN QUERY SELECT TRUE, v_delivery_id, v_delivery_number, v_total_hpp_real, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, NULL::UUID, SQLERRM::TEXT;
END;
$function$;


-- =====================================================
-- Function: process_delivery_atomic
-- =====================================================



-- =====================================================
-- Function: process_delivery_atomic_no_stock
-- =====================================================
CREATE OR REPLACE FUNCTION public.process_delivery_atomic_no_stock(p_transaction_id text, p_items jsonb, p_branch_id uuid, p_driver_id uuid DEFAULT NULL::uuid, p_helper_id uuid DEFAULT NULL::uuid, p_delivery_date timestamp with time zone DEFAULT now(), p_notes text DEFAULT NULL::text, p_photo_url text DEFAULT NULL::text, p_helper_id_2 uuid DEFAULT NULL::uuid, p_helper_id_3 uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, delivery_id uuid, delivery_number integer, total_hpp numeric, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $function$
DECLARE
  v_delivery_id UUID;
  v_delivery_number INTEGER;
  v_transaction RECORD;
  v_item JSONB;
  v_product_id UUID;
  v_qty NUMERIC;
  v_product_name TEXT;
  v_is_bonus BOOLEAN;
  v_total_ordered NUMERIC;
  v_total_delivered NUMERIC;
  v_new_status TEXT;
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, NULL::UUID, 'Branch ID is REQUIRED'::TEXT;
    RETURN;
  END IF;

  SELECT id, customer_name, customer_address, customer_phone, items INTO v_transaction FROM transactions WHERE id = p_transaction_id AND branch_id = p_branch_id;
  IF v_transaction.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, NULL::UUID, 'Transaction not found'::TEXT;
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
$function$;


-- =====================================================
-- Function: process_delivery_atomic_no_stock
-- =====================================================



-- =====================================================
-- Function: process_migration_delivery_journal
-- =====================================================
CREATE OR REPLACE FUNCTION public.process_migration_delivery_journal(p_delivery_id uuid, p_delivery_value numeric, p_branch_id uuid, p_customer_name text, p_transaction_id text) RETURNS TABLE(success boolean, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_modal_tertahan_id TEXT;
  v_pendapatan_id TEXT;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is REQUIRED'::TEXT;
    RETURN;
  END IF;
  IF p_delivery_value <= 0 THEN
    RETURN QUERY SELECT TRUE, NULL::UUID, 'No journal needed for zero value'::TEXT;
    RETURN;
  END IF;
  -- ==================== LOOKUP ACCOUNTS ====================
  -- Find Modal Barang Dagang Tertahan (2140)
  SELECT id INTO v_modal_tertahan_id
  FROM accounts
  WHERE (
    LOWER(name) LIKE '%modal%barang%tertahan%' OR
    LOWER(name) LIKE '%modal%dagang%tertahan%' OR
    code = '2140'
  )
  AND is_header = FALSE
  LIMIT 1;
  IF v_modal_tertahan_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Modal Barang Dagang Tertahan (2140) tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- Find Pendapatan Penjualan (4100)
  SELECT id INTO v_pendapatan_id
  FROM accounts
  WHERE (
    LOWER(name) LIKE '%pendapatan%penjualan%' OR
    LOWER(name) LIKE '%penjualan%' OR
    code = '4100'
  )
  AND is_header = FALSE
  AND type = 'revenue'
  LIMIT 1;
  IF v_pendapatan_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Pendapatan Penjualan tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- ==================== CREATE JOURNAL ENTRY ====================
  v_entry_number := 'JE-MIG-DEL-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
                    LPAD((EXTRACT(EPOCH FROM NOW())::BIGINT % 10000)::TEXT, 4, '0');
  INSERT INTO journal_entries (
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    is_posted,
    branch_id,
    created_by,
    created_at
  ) VALUES (
    v_entry_number,
    CURRENT_DATE,
    format('[MIGRASI] Pengiriman Barang - %s', p_customer_name),
    'migration_delivery',
    p_delivery_id::TEXT,
    TRUE,
    p_branch_id,
    'System',
    NOW()
  )
  RETURNING id INTO v_journal_id;
  -- ==================== JOURNAL LINE ITEMS ====================
  -- Jurnal pengiriman migrasi:
  -- Dr Modal Barang Dagang Tertahan (2140)
  --    Cr Pendapatan Penjualan (4100)
  --
  -- Ini mengubah "utang sistem" ??? "penjualan sah"
  -- Debit: Modal Barang Dagang Tertahan
  INSERT INTO journal_entry_items (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_id, v_modal_tertahan_id, p_delivery_value, 0,
    format('Pengiriman migrasi - %s', p_customer_name));
  -- Credit: Pendapatan Penjualan
  INSERT INTO journal_entry_items (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_id, v_pendapatan_id, 0, p_delivery_value,
    format('Pendapatan penjualan migrasi - %s', p_customer_name));
  -- ==================== LOG ====================
  RAISE NOTICE '[Migration Delivery] Journal created for delivery % (Value: %)',
    p_delivery_id, p_delivery_value;
  RETURN QUERY SELECT TRUE, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$function$;


-- =====================================================
-- Function: update_delivery_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_delivery_atomic(p_delivery_id uuid, p_branch_id uuid, p_items jsonb, p_driver_id uuid DEFAULT NULL::uuid, p_helper_id uuid DEFAULT NULL::uuid, p_delivery_date timestamp with time zone DEFAULT now(), p_notes text DEFAULT NULL::text, p_photo_url text DEFAULT NULL::text, p_helper_id_2 uuid DEFAULT NULL::uuid, p_helper_id_3 uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $function$
BEGIN
  UPDATE deliveries SET
    driver_id = p_driver_id,
    helper_id = p_helper_id,
    helper_id_2 = p_helper_id_2,
    helper_id_3 = p_helper_id_3,
    delivery_date = p_delivery_date,
    notes = p_notes,
    photo_url = COALESCE(p_photo_url, photo_url),
    updated_at = NOW()
  WHERE id = p_delivery_id AND branch_id = p_branch_id;
  
  RETURN QUERY SELECT TRUE, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, SQLERRM::TEXT;
END;
$function$;


-- =====================================================
-- Function: update_transaction_delivery_status
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_transaction_delivery_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
DECLARE
  transaction_record RECORD;
  total_ordered INTEGER;
  total_delivered INTEGER;
  item_record RECORD;
BEGIN
  -- Get transaction details
  SELECT * INTO transaction_record
  FROM transactions
  WHERE id = (
    SELECT transaction_id
    FROM deliveries
    WHERE id = COALESCE(NEW.delivery_id, OLD.delivery_id)
  );
  -- Skip jika transaksi adalah laku kantor
  IF transaction_record.is_office_sale = true THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- Calculate total quantity ordered vs delivered untuk setiap item
  FOR item_record IN
    SELECT
      p.product_id,  -- FIXED: use p.product_id instead of ti.product_id
      ti.quantity as ordered_quantity,
      COALESCE(SUM(di.quantity_delivered), 0) as delivered_quantity
    FROM transactions t
    JOIN LATERAL jsonb_to_recordset(t.items) AS ti(
      product jsonb,
      quantity integer
    ) ON true
    JOIN LATERAL (SELECT (ti.product->>'id')::uuid as product_id) p ON true
    LEFT JOIN deliveries d ON d.transaction_id = t.id
    LEFT JOIN delivery_items di ON di.delivery_id = d.id AND di.product_id = p.product_id
    WHERE t.id = transaction_record.id
    GROUP BY p.product_id, ti.quantity
  LOOP
    -- Jika ada item yang belum selesai diantar
    IF item_record.delivered_quantity < item_record.ordered_quantity THEN
      -- Jika sudah ada pengantaran tapi belum lengkap
      IF item_record.delivered_quantity > 0 THEN
        UPDATE transactions
        SET status = 'Diantar Sebagian'
        WHERE id = transaction_record.id;
        RETURN COALESCE(NEW, OLD);
      ELSE
        -- Belum ada pengantaran sama sekali, tetap status saat ini
        RETURN COALESCE(NEW, OLD);
      END IF;
    END IF;
  END LOOP;
  -- Jika sampai sini, berarti semua item sudah diantar lengkap
  UPDATE transactions
  SET status = 'Selesai'
  WHERE id = transaction_record.id;
  RETURN COALESCE(NEW, OLD);
END;
$function$;


-- =====================================================
-- Function: update_transaction_status_from_delivery
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_transaction_status_from_delivery() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
DECLARE
  transaction_id TEXT;
  total_items INTEGER;
  delivered_items INTEGER;
  cancelled_deliveries INTEGER;
BEGIN
  -- Get transaction ID from delivery
  transaction_id := COALESCE(NEW.transaction_id, OLD.transaction_id);
  
  IF transaction_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  
  -- Count total items in transaction (from transaction items)
  SELECT COALESCE(jsonb_array_length(items), 0)
  INTO total_items
  FROM public.transactions 
  WHERE id = transaction_id;
  
  -- Count delivered items from all deliveries for this transaction
  SELECT 
    COALESCE(SUM(CASE WHEN d.status = 'delivered' THEN di.quantity_delivered ELSE 0 END), 0),
    COUNT(CASE WHEN d.status = 'cancelled' THEN 1 END)
  INTO delivered_items, cancelled_deliveries
  FROM public.deliveries d
  LEFT JOIN public.delivery_items di ON d.id = di.delivery_id  
  WHERE d.transaction_id = transaction_id;
  
  -- Update transaction status based on delivery progress
  IF cancelled_deliveries > 0 AND delivered_items = 0 THEN
    -- All deliveries cancelled, no items delivered
    UPDATE public.transactions 
    SET status = 'Dibatalkan' 
    WHERE id = transaction_id AND status != 'Dibatalkan';
    
  ELSIF delivered_items = 0 THEN
    -- No items delivered yet, but delivery exists
    UPDATE public.transactions 
    SET status = 'Siap Antar' 
    WHERE id = transaction_id AND status NOT IN ('Siap Antar', 'Diantar Sebagian', 'Selesai');
    
  ELSIF delivered_items > 0 AND delivered_items < total_items THEN
    -- Partial delivery completed
    UPDATE public.transactions 
    SET status = 'Diantar Sebagian' 
    WHERE id = transaction_id AND status != 'Diantar Sebagian';
    
  ELSIF delivered_items >= total_items THEN
    -- All items delivered
    UPDATE public.transactions 
    SET status = 'Selesai' 
    WHERE id = transaction_id AND status != 'Selesai';
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$function$;


-- =====================================================
-- Function: void_delivery_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.void_delivery_atomic(p_delivery_id uuid, p_branch_id uuid, p_reason text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, items_restored integer, journals_voided integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_delivery RECORD;
  v_transaction RECORD;
  v_item RECORD;
  v_restore_success BOOLEAN;
  v_items_restored INTEGER := 0;
  v_journals_voided INTEGER := 0;
  v_total_ordered NUMERIC;
  v_total_delivered NUMERIC;
  v_new_status TEXT;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0,
      'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT;
    RETURN;
  END IF;
  IF p_delivery_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0,
      'Delivery ID is required'::TEXT;
    RETURN;
  END IF;
  -- Get delivery info (deliveries table tidak punya kolom status)
  SELECT
    d.id,
    d.transaction_id,
    d.branch_id,
    d.delivery_number
  INTO v_delivery
  FROM deliveries d
  WHERE d.id = p_delivery_id AND d.branch_id = p_branch_id;
  IF v_delivery.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0,
      'Delivery not found in this branch'::TEXT;
    RETURN;
  END IF;
  -- Get transaction info (transaction_id is TEXT in deliveries table)
  SELECT * INTO v_transaction
  FROM transactions
  WHERE id::TEXT = v_delivery.transaction_id;
  IF v_transaction.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0,
      'Transaction not found for this delivery'::TEXT;
    RETURN;
  END IF;
  -- ==================== RESTORE INVENTORY ====================
  -- Restore dari delivery_items (yang benar-benar dikirim)
  FOR v_item IN
    SELECT
      di.product_id,
      di.quantity_delivered as quantity,
      di.product_name,
      di.is_bonus,
      COALESCE(p.cost_price, p.base_price, 0) as unit_cost,
      -- Some systems store product_type in specifications or dedicated column
      -- Let's check products table if it exists
      CASE WHEN (SELECT 1 FROM products p2 WHERE p2.id = di.product_id) IS NOT NULL THEN 'product' ELSE 'material' END as calculated_type
    FROM delivery_items di
    LEFT JOIN products p ON p.id = di.product_id -- This might be null for materials
    WHERE di.delivery_id = p_delivery_id
      AND di.quantity_delivered > 0
  LOOP
    IF v_item.calculated_type = 'product' THEN
      SELECT f.success INTO v_restore_success
      FROM restore_stock_fifo_v2(
        v_item.product_id,
        v_item.quantity,
        p_delivery_id::TEXT,
        'delivery',
        p_branch_id
      ) f;
    ELSE
      -- Handle Material restore
      SELECT f.success INTO v_restore_success
      FROM restore_material_fifo_v2(
        v_item.product_id, -- It's material_id here
        v_item.quantity,
        0, -- cost handled by batch
        p_delivery_id::TEXT,
        'delivery_void',
        p_branch_id
      ) f;
    END IF;

    IF v_restore_success THEN
      v_items_restored := v_items_restored + 1;
    END IF;
  END LOOP;
  -- ==================== VOID JOURNALS ====================
  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_reason = COALESCE(p_reason, 'Delivery voided')
  WHERE reference_id = p_delivery_id::TEXT
    AND branch_id = p_branch_id
    AND is_voided = FALSE;
  GET DIAGNOSTICS v_journals_voided = ROW_COUNT;
  -- ==================== DELETE COMMISSIONS ====================
  DELETE FROM commission_entries
  WHERE delivery_id = p_delivery_id::TEXT; -- FIX: Cast UUID to TEXT
  -- ==================== UPDATE TRANSACTION STATUS ====================
  -- Hitung ulang status berdasarkan sisa delivery yang masih valid
  -- Get total ordered from transaction items
  SELECT
    COALESCE(SUM(
      CASE WHEN (item->>'_isSalesMeta')::BOOLEAN THEN 0
      ELSE (item->>'quantity')::NUMERIC END
    ), 0)
  INTO v_total_ordered
  FROM jsonb_array_elements(v_transaction.items) item;
  -- Get total delivered from remaining deliveries (exclude current one being voided)
  SELECT
    COALESCE(SUM(di.quantity_delivered), 0)
  INTO v_total_delivered
  FROM delivery_items di
  JOIN deliveries d ON d.id = di.delivery_id
  WHERE d.transaction_id = v_delivery.transaction_id
    AND d.id != p_delivery_id;  -- Exclude current delivery being voided
  -- Determine new status
  IF v_total_delivered >= v_total_ordered AND v_total_delivered > 0 THEN
    v_new_status := 'Selesai';
  ELSIF v_total_delivered > 0 THEN
    v_new_status := 'Diantar Sebagian';
  ELSE
    v_new_status := 'Pesanan Masuk';
  END IF;
  UPDATE transactions
  SET
    status = v_new_status
  WHERE id = v_transaction.id;
  -- Note: Delivery record deletion will be handled by frontend after RPC returns success
  -- This RPC only handles: restore inventory + void journals + update transaction status
  RETURN QUERY SELECT
    TRUE,
    v_items_restored,
    v_journals_voided,
    NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0, 0, SQLERRM::TEXT;
END;
$function$;


