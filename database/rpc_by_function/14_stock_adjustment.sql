-- =====================================================
-- 14 STOCK ADJUSTMENT
-- Generated: 2026-01-09T00:29:07.864Z
-- Total functions: 10
-- =====================================================

-- Functions in this file:
--   add_material_stock
--   create_material_stock_adjustment_atomic
--   create_product_stock_adjustment_atomic
--   get_material_stock
--   get_product_stock
--   get_product_weighted_avg_cost
--   migrate_material_stock_to_batches
--   search_products_with_stock
--   sync_material_initial_stock_atomic
--   sync_product_initial_stock_atomic

-- =====================================================
-- Function: add_material_stock
-- =====================================================
CREATE OR REPLACE FUNCTION public.add_material_stock(material_id uuid, quantity_to_add numeric)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.materials
  SET stock = stock + quantity_to_add
  WHERE id = material_id;
END;
$function$
;


-- =====================================================
-- Function: create_material_stock_adjustment_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_material_stock_adjustment_atomic(p_material_id uuid, p_branch_id uuid, p_quantity_change numeric, p_reason text DEFAULT 'Stock Adjustment'::text, p_unit_cost numeric DEFAULT 0)
 RETURNS TABLE(success boolean, adjustment_id uuid, journal_id uuid, new_stock numeric, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_adjustment_id UUID;
  v_journal_id UUID;
  v_material_name TEXT;
  v_current_stock NUMERIC;
  v_new_stock NUMERIC;
  v_adjustment_value NUMERIC;
  v_bahan_baku_account_id UUID;
  v_selisih_account_id UUID;
  v_entry_number TEXT;
  v_fifo_success BOOLEAN;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  IF p_material_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, 'Material ID is required'::TEXT;
    RETURN;
  END IF;

  IF p_quantity_change = 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, 'Quantity change cannot be zero'::TEXT;
    RETURN;
  END IF;

  -- Get material info
  SELECT name, COALESCE(stock, 0) INTO v_material_name, v_current_stock
  FROM materials WHERE id = p_material_id;

  IF v_material_name IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, 'Material tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  v_new_stock := v_current_stock + p_quantity_change;
  IF v_new_stock < 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC,
      format('Stok tidak cukup. Stok saat ini: %s', v_current_stock)::TEXT;
    RETURN;
  END IF;

  v_adjustment_value := ABS(p_quantity_change) * COALESCE(p_unit_cost, 0);

  -- ==================== GET ACCOUNT IDS ====================

  SELECT id INTO v_bahan_baku_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1320' AND is_active = TRUE LIMIT 1;

  SELECT id INTO v_selisih_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '8100' AND is_active = TRUE LIMIT 1;

  -- Generate primary key for adjustment
  v_adjustment_id := gen_random_uuid();

  -- LEGACY UPDATE REMOVED: Using v2 FIFO functions instead


  -- ==================== CREATE/CONSUME MATERIAL BATCH ====================
  -- NEW: Using v2 functions that handle batches and movements correctly
  IF p_quantity_change > 0 THEN
    SELECT f.success INTO v_fifo_success
    FROM restore_material_fifo_v2(
      p_material_id,
      p_quantity_change,
      COALESCE(p_unit_cost, 0),
      v_adjustment_id::TEXT,
      'adjustment',
      p_branch_id
    ) f;
  ELSE
    SELECT f.success INTO v_fifo_success
    FROM consume_material_fifo_v2(
      p_material_id,
      ABS(p_quantity_change),
      v_adjustment_id::TEXT,
      'adjustment',
      p_branch_id
    ) f;
  END IF;

  IF NOT v_fifo_success THEN
    RAISE EXCEPTION 'Gagal memproses FIFO adjustment';
  END IF;


  -- ==================== CREATE JOURNAL ENTRY ====================

  IF v_adjustment_value > 0 AND v_bahan_baku_account_id IS NOT NULL AND v_selisih_account_id IS NOT NULL THEN
    SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
      (COALESCE((SELECT COUNT(*) + 1 FROM journal_entries WHERE branch_id = p_branch_id AND DATE(created_at) = CURRENT_DATE), 1))::TEXT, 4, '0')
    INTO v_entry_number;

    INSERT INTO journal_entries (id, branch_id, entry_number, entry_date, description, reference_type, reference_id, status, is_voided, created_at, updated_at)
    VALUES (gen_random_uuid(), p_branch_id, v_entry_number, CURRENT_DATE, 'Penyesuaian Stok Bahan - ' || v_material_name || ' - ' || p_reason, 'adjustment', v_adjustment_id::TEXT, 'posted', FALSE, NOW(), NOW())
    RETURNING id INTO v_journal_id;

    IF p_quantity_change > 0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_name, debit_amount, credit_amount, description, line_number)
      VALUES (v_journal_id, v_bahan_baku_account_id, (SELECT name FROM accounts WHERE id = v_bahan_baku_account_id), v_adjustment_value, 0, 'Penambahan bahan baku', 1);
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_name, debit_amount, credit_amount, description, line_number)
      VALUES (v_journal_id, v_selisih_account_id, (SELECT name FROM accounts WHERE id = v_selisih_account_id), 0, v_adjustment_value, 'Selisih stok', 2);
    ELSE
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_name, debit_amount, credit_amount, description, line_number)
      VALUES (v_journal_id, v_selisih_account_id, (SELECT name FROM accounts WHERE id = v_selisih_account_id), v_adjustment_value, 0, 'Selisih stok', 1);
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_name, debit_amount, credit_amount, description, line_number)
      VALUES (v_journal_id, v_bahan_baku_account_id, (SELECT name FROM accounts WHERE id = v_bahan_baku_account_id), 0, v_adjustment_value, 'Pengurangan bahan baku', 2);
    END IF;
  END IF;

  RETURN QUERY SELECT TRUE, v_adjustment_id, v_journal_id, v_new_stock, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: create_product_stock_adjustment_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_product_stock_adjustment_atomic(p_product_id uuid, p_branch_id uuid, p_quantity_change numeric, p_reason text DEFAULT 'Stock Adjustment'::text, p_unit_cost numeric DEFAULT 0)
 RETURNS TABLE(success boolean, adjustment_id uuid, journal_id uuid, new_stock numeric, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_adjustment_id UUID;
  v_journal_id UUID;
  v_product_name TEXT;
  v_current_stock NUMERIC;
  v_new_stock NUMERIC;
  v_adjustment_value NUMERIC;
  v_persediaan_account_id UUID;
  v_selisih_account_id UUID;
  v_entry_number TEXT;
  v_fifo_success BOOLEAN;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  IF p_product_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, 'Product ID is required'::TEXT;
    RETURN;
  END IF;

  IF p_quantity_change = 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, 'Quantity change cannot be zero'::TEXT;
    RETURN;
  END IF;

  -- Get product info
  SELECT name, COALESCE(current_stock, 0) INTO v_product_name, v_current_stock
  FROM products WHERE id = p_product_id;

  IF v_product_name IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, 'Produk tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  -- Calculate new stock (cannot go negative)
  v_new_stock := v_current_stock + p_quantity_change;
  IF v_new_stock < 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC,
      format('Stok tidak cukup. Stok saat ini: %s, pengurangan: %s', v_current_stock, ABS(p_quantity_change))::TEXT;
    RETURN;
  END IF;

  -- Calculate adjustment value
  v_adjustment_value := ABS(p_quantity_change) * COALESCE(p_unit_cost, 0);

  -- ==================== GET ACCOUNT IDS ====================

  SELECT id INTO v_persediaan_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1310' AND is_active = TRUE LIMIT 1;

  -- Selisih Stok account (usually 8100 or specific)
  SELECT id INTO v_selisih_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '8100' AND is_active = TRUE LIMIT 1;

  -- Generate primary key for adjustment
  v_adjustment_id := gen_random_uuid();

  -- LEGACY UPDATE REMOVED: Using v2 FIFO functions instead


  -- ==================== CREATE/CONSUME PRODUCT BATCH ====================
  -- NEW: Using v2 functions
  IF p_quantity_change > 0 THEN
    SELECT f.success INTO v_fifo_success
    FROM restore_stock_fifo_v2(
      p_product_id,
      p_quantity_change,
      v_adjustment_id::TEXT,
      'adjustment',
      p_branch_id
    ) f;
  ELSE
    SELECT f.success INTO v_fifo_success
    FROM consume_stock_fifo_v2(
      p_product_id,
      ABS(p_quantity_change),
      v_adjustment_id::TEXT,
      'adjustment',
      p_branch_id
    ) f;
  END IF;

  IF NOT v_fifo_success THEN
    RAISE EXCEPTION 'Gagal memproses FIFO adjustment';
  END IF;


  -- ==================== CREATE JOURNAL ENTRY (if value > 0) ====================

  IF v_adjustment_value > 0 AND v_persediaan_account_id IS NOT NULL AND v_selisih_account_id IS NOT NULL THEN
    SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
      (COALESCE(
        (SELECT COUNT(*) + 1 FROM journal_entries
         WHERE branch_id = p_branch_id
         AND DATE(created_at) = CURRENT_DATE),
        1
      ))::TEXT, 4, '0')
    INTO v_entry_number;

    INSERT INTO journal_entries (
      id, branch_id, entry_number, entry_date, description,
      reference_type, reference_id, status, is_voided, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), p_branch_id, v_entry_number, CURRENT_DATE,
      'Penyesuaian Stok - ' || v_product_name || ' - ' || p_reason,
      'adjustment', v_adjustment_id::TEXT, 'posted', FALSE, NOW(), NOW()
    ) RETURNING id INTO v_journal_id;

    IF p_quantity_change > 0 THEN
      -- Stock IN: Dr. Persediaan, Cr. Selisih
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_name, debit_amount, credit_amount, description, line_number)
      VALUES (v_journal_id, v_persediaan_account_id, (SELECT name FROM accounts WHERE id = v_persediaan_account_id), v_adjustment_value, 0, 'Penambahan persediaan', 1);

      INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_name, debit_amount, credit_amount, description, line_number)
      VALUES (v_journal_id, v_selisih_account_id, (SELECT name FROM accounts WHERE id = v_selisih_account_id), 0, v_adjustment_value, 'Selisih stok', 2);
    ELSE
      -- Stock OUT: Dr. Selisih, Cr. Persediaan
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_name, debit_amount, credit_amount, description, line_number)
      VALUES (v_journal_id, v_selisih_account_id, (SELECT name FROM accounts WHERE id = v_selisih_account_id), v_adjustment_value, 0, 'Selisih stok', 1);

      INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_name, debit_amount, credit_amount, description, line_number)
      VALUES (v_journal_id, v_persediaan_account_id, (SELECT name FROM accounts WHERE id = v_persediaan_account_id), 0, v_adjustment_value, 'Pengurangan persediaan', 2);
    END IF;
  END IF;

  RETURN QUERY SELECT TRUE, v_adjustment_id, v_journal_id, v_new_stock, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: get_material_stock
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_material_stock(p_material_id uuid, p_branch_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch ID is REQUIRED';
  END IF;

  RETURN COALESCE(
    (SELECT SUM(remaining_quantity)
      FROM inventory_batches
      WHERE material_id = p_material_id
        AND (branch_id = p_branch_id OR branch_id IS NULL)
        AND remaining_quantity > 0),
    0
  );
END;
$function$
;


-- =====================================================
-- Function: get_product_stock
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_product_stock(p_product_id uuid, p_branch_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch ID is REQUIRED';
  END IF;

  RETURN COALESCE(
    (SELECT SUM(remaining_quantity)
     FROM inventory_batches
     WHERE product_id = p_product_id
       AND branch_id = p_branch_id
       AND remaining_quantity > 0),
    0
  );
END;
$function$
;


-- =====================================================
-- Function: get_product_weighted_avg_cost
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_product_weighted_avg_cost(p_product_id uuid, p_branch_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_avg_cost numeric;
BEGIN
    SELECT CASE WHEN SUM(remaining_quantity) > 0 THEN SUM(remaining_quantity * unit_cost) / SUM(remaining_quantity) ELSE NULL END INTO v_avg_cost
    FROM public.inventory_batches
    WHERE product_id = p_product_id
      AND (branch_id = p_branch_id OR branch_id IS NULL)
      AND remaining_quantity > 0;
    IF v_avg_cost IS NULL THEN
        SELECT cost_price INTO v_avg_cost FROM public.products WHERE id = p_product_id;
    END IF;
    RETURN COALESCE(v_avg_cost, 0);
END;
$function$
;


-- =====================================================
-- Function: migrate_material_stock_to_batches
-- =====================================================
CREATE OR REPLACE FUNCTION public.migrate_material_stock_to_batches()
 RETURNS TABLE(material_id uuid, material_name text, migrated_quantity numeric, batch_id uuid)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_material RECORD;
  v_new_batch_id UUID;
BEGIN
  FOR v_material IN
    SELECT m.id, m.name, m.stock, m.branch_id, m.price_per_unit
    FROM materials m
    WHERE m.stock > 0
      AND NOT EXISTS (
        SELECT 1 FROM inventory_batches ib
        WHERE ib.material_id = m.id AND ib.remaining_quantity > 0
      )
  LOOP
    INSERT INTO inventory_batches (
      material_id,
      branch_id,
      initial_quantity,
      remaining_quantity,
      unit_cost,
      batch_date,
      notes
    ) VALUES (
      v_material.id,
      v_material.branch_id,
      v_material.stock,
      v_material.stock,
      COALESCE(v_material.price_per_unit, 0),
      NOW(),
      'Migrated from materials.stock (initial)'
    )
    RETURNING id INTO v_new_batch_id;
    RETURN QUERY SELECT v_material.id, v_material.name, v_material.stock, v_new_batch_id;
  END LOOP;
END;
$function$
;


-- =====================================================
-- Function: search_products_with_stock
-- =====================================================
CREATE OR REPLACE FUNCTION public.search_products_with_stock(search_term text DEFAULT ''::text, category_filter text DEFAULT NULL::text, limit_count integer DEFAULT 50)
 RETURNS TABLE(id uuid, name text, category text, base_price numeric, unit text, current_stock numeric, min_order integer, is_low_stock boolean)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.name,
    p.category,
    p.base_price,
    p.unit,
    COALESCE((p.specifications->>'stock')::NUMERIC, 0) as current_stock,
    p.min_order,
    COALESCE((p.specifications->>'stock')::NUMERIC, 0) <= p.min_order as is_low_stock
  FROM public.products p
  WHERE 
    (search_term = '' OR p.name ILIKE '%' || search_term || '%')
    AND (category_filter IS NULL OR p.category = category_filter)
  ORDER BY p.name
  LIMIT limit_count;
END;
$function$
;


-- =====================================================
-- Function: sync_material_initial_stock_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.sync_material_initial_stock_atomic(p_material_id uuid, p_branch_id uuid, p_new_initial_stock numeric, p_unit_cost numeric DEFAULT 0)
 RETURNS TABLE(success boolean, batch_id uuid, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_batch_id UUID;
  v_old_initial NUMERIC;
  v_qty_diff NUMERIC;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is REQUIRED'::TEXT;
    RETURN;
  END IF;

  -- Cari batch "Stok Awal" yang ada
  SELECT id, initial_quantity INTO v_batch_id, v_old_initial
  FROM inventory_batches
  WHERE material_id = p_material_id AND branch_id = p_branch_id AND notes = 'Stok Awal'
  LIMIT 1;

  IF v_batch_id IS NOT NULL THEN
    v_qty_diff := p_new_initial_stock - v_old_initial;
    
    UPDATE inventory_batches
    SET initial_quantity = p_new_initial_stock,
        remaining_quantity = GREATEST(0, remaining_quantity + v_qty_diff),
        unit_cost = p_unit_cost,
        updated_at = NOW()
    WHERE id = v_batch_id;
  ELSE
    INSERT INTO inventory_batches (
      material_id, 
      branch_id, 
      initial_quantity, 
      remaining_quantity, 
      unit_cost, 
      notes, 
      batch_date
    ) VALUES (
      p_material_id, 
      p_branch_id, 
      p_new_initial_stock, 
      p_new_initial_stock, 
      p_unit_cost, 
      'Stok Awal', 
      NOW()
    ) RETURNING id INTO v_batch_id;
  END IF;

  RETURN QUERY SELECT TRUE, v_batch_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: sync_product_initial_stock_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.sync_product_initial_stock_atomic(p_product_id uuid, p_branch_id uuid, p_new_initial_stock numeric, p_unit_cost numeric DEFAULT 0)
 RETURNS TABLE(success boolean, batch_id uuid, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_batch_id UUID;
  v_old_initial NUMERIC;
  v_qty_diff NUMERIC;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is REQUIRED'::TEXT;
    RETURN;
  END IF;

  -- Cari batch "Stok Awal" yang ada
  SELECT id, initial_quantity INTO v_batch_id, v_old_initial
  FROM inventory_batches
  WHERE product_id = p_product_id AND branch_id = p_branch_id AND notes = 'Stok Awal'
  LIMIT 1;

  IF v_batch_id IS NOT NULL THEN
    v_qty_diff := p_new_initial_stock - v_old_initial;
    
    UPDATE inventory_batches
    SET initial_quantity = p_new_initial_stock,
        remaining_quantity = GREATEST(0, remaining_quantity + v_qty_diff),
        unit_cost = p_unit_cost,
        updated_at = NOW()
    WHERE id = v_batch_id;
  ELSE
    INSERT INTO inventory_batches (
      product_id, 
      branch_id, 
      initial_quantity, 
      remaining_quantity, 
      unit_cost, 
      notes, 
      batch_date
    ) VALUES (
      p_product_id, 
      p_branch_id, 
      p_new_initial_stock, 
      p_new_initial_stock, 
      p_unit_cost, 
      'Stok Awal', 
      NOW()
    ) RETURNING id INTO v_batch_id;
  END IF;

  RETURN QUERY SELECT TRUE, v_batch_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$function$
;


